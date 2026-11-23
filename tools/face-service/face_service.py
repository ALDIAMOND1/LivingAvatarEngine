# Local face service: her voice goes in, video frames of her face come out.
# Runs on the processor only (no graphics card) using LiteAvatar
# (github.com/HumanAIGC/lite-avatar, MIT): a speech model turns sound into 32
# mouth numbers per frame, and a 1 MB per-avatar network repaints the mouth
# area on real video frames of the avatar.
#
#   python face_service.py --repo <lite-avatar checkout> --avatar <avatar data dir> [--port 8768] [--fps 16]
#
# Protocol (WebSocket, one page at a time, local only):
#   page -> service   binary: 16 kHz mono 16-bit sound, continuously (silence included)
#                     text "reset": she was interrupted, treat what is buffered as silence
#   service -> page   text  {"type":"hello", fps, hop, width, height}
#                     binary: uint32 frame number, float64 time of the sound this
#                             frame belongs to (seconds since the stream began; -1 =
#                             show now), uint32 flags (1 = speaking), then a JPEG
import argparse, asyncio, json, os, queue, struct, sys, threading, time

ap = argparse.ArgumentParser()
ap.add_argument('--repo', required=True); ap.add_argument('--avatar', required=True)
ap.add_argument('--port', type=int, default=8768); ap.add_argument('--fps', type=int, default=0, help='0 = chosen from how fast this computer draws a frame')
ap.add_argument('--origin', default='http://127.0.0.1:8766')
args = ap.parse_args()
AVATAR = os.path.abspath(args.avatar)
os.chdir(args.repo); sys.path.insert(0, os.getcwd())     # LiteAvatar loads ./weights relative to its own folder

import numpy as np, cv2, torch, onnxruntime as ort, websockets
from lite_avatar import liteAvatar

SR = 16000
SPEECH_RMS = 120                            # below this a step is treated as silence and costs almost nothing
torch.set_num_threads(4)

print('face service: loading the speech model and the avatar...', flush=True)
GPU = torch.cuda.is_available() and 'CUDAExecutionProvider' in ort.get_available_providers()   # used when present, never required
la = liteAvatar(data_dir=AVATAR, num_threads=1, generate_offline=False, use_gpu=GPU)
la.fps = 30
la.load_dynamic_model(AVATAR)
feats = [[t.detach().cpu().numpy() for t in f] for f in la.ref_img_list]
neutral = np.asarray(la.neutral_pose[:32], np.float32)
n_bg = la.bg_video_frame_count
x1, x2, y1, y2 = la.x1, la.x2, la.y1, la.y2
full_h, full_w = la.bg_data_list[0].shape[:2]
CROP_H = min(full_h, max(y2 + 60, int(full_w * 1.32)))    # head and shoulders, not the whole standing figure
OUT_W = 480; OUT_H = int(round(CROP_H * OUT_W / full_w / 2) * 2)
# Everything is composited at the size that is sent, so no time goes into pixels nobody sees.
scale = OUT_W / full_w
sx1, sx2, sy1, sy2 = [int(round(v * scale)) for v in (x1, x2, y1, y2)]
mask = cv2.resize(la.merge_mask.astype(np.float32), (sx2 - sx1, sy2 - sy1))
bg_small = [cv2.resize(la.bg_data_list[f][:CROP_H], (OUT_W, OUT_H), interpolation=cv2.INTER_AREA) for f in range(n_bg)]

# The generator is converted once to ONNX: same picture, about twice as fast on a processor.
onnx_path = os.path.join(AVATAR, 'net_decode.onnx')
if not os.path.exists(onnx_path):
    class Wrap(torch.nn.Module):
        def __init__(self, g): super().__init__(); self.g = g
        def forward(self, f0, f1, f2, f3, param): return self.g([f0, f1, f2, f3], param)
    ex = (*[t.detach().cpu() for t in la.ref_img_list[0]], torch.from_numpy(neutral).unsqueeze(0))
    la.generator.to('cpu')
    torch.onnx.export(torch.jit.trace(Wrap(la.generator), ex, check_trace=False), ex, onnx_path,
                      input_names=['f0', 'f1', 'f2', 'f3', 'param'], output_names=['img'], opset_version=17)
so = ort.SessionOptions(); so.intra_op_num_threads = 4
gen = ort.InferenceSession(onnx_path, so, providers=(['CUDAExecutionProvider'] if GPU else []) + ['CPUExecutionProvider'])


def frame_id(k):                            # the background clip is played forward then backward, endlessly
    return k % n_bg if (k // n_bg) % 2 == 0 else n_bg - 1 - k % n_bg


def render(param, fid):
    feed = {f'f{i}': feats[fid][i] for i in range(4)}; feed['param'] = param[None].astype(np.float32)
    y = gen.run(None, feed)[0][0]
    m = (np.clip(y / 2 + 0.5, 0, 1).transpose(1, 2, 0) * 255).astype(np.uint8)
    m = cv2.resize(m, (sx2 - sx1, sy2 - sy1), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32)
    out = bg_small[fid].copy()
    out[sy1:sy2, sx1:sx2] = (m * (1 - mask) + out[sy1:sy2, sx1:sx2] * mask).astype(np.uint8)
    return cv2.imencode('.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 84])[1].tobytes()


t0 = time.time()
idle = [render(neutral, f) for f in range(n_bg)]          # resting frames, drawn once
per_frame_ms = (time.time() - t0) / n_bg * 1000
# How much this computer can do live is measured, not assumed: time one mouth
# step, then take the best frame rate and step length whose total work fits in
# about 80% of real time. Short steps mean a shorter voice delay but cost more.
_noise = (np.random.default_rng(0).standard_normal(SR) * 3000).astype(np.int16)
la.audio2param(_noise.tobytes()); t0 = time.time(); la.audio2param(_noise.tobytes()); step_ms = (time.time() - t0) * 1000
CHOICES = [(30, .5), (24, .5), (20, .5), (16, .5), (12, .5), (16, 1), (12, 1), (10, 1), (8, 1)]
FPS, HOP_S = next(((f, h) for f, h in CHOICES if (not args.fps or f == args.fps) and f * per_frame_ms + step_ms / h <= 800), (args.fps or 8, 1))
HOP = int(SR * HOP_S); N = int(FPS * HOP_S); ROWS = int(30 * HOP_S)
print(f'face service: one mouth step takes {step_ms:.0f} ms; using {FPS} frames a second in {HOP_S} s steps' + (' (graphics card)' if GPU else ' (processor only)'), flush=True)
print(f'face service: {n_bg} resting frames drawn, {per_frame_ms:.0f} ms per frame at {OUT_W}x{OUT_H}', flush=True)


def mouth_params(window):                   # one second of sound -> mouth numbers for its newest step
    res = la.audio2param(window.tobytes())
    p = np.array([[d[str(j)] for j in range(32)] for d in res], np.float32)[-ROWS:]
    src = np.linspace(0, 1, len(p)); dst = (np.arange(N) + 0.5) / N
    return np.stack([np.interp(dst, src, p[:, j]) for j in range(32)], 1).astype(np.float32)


class Session:
    def __init__(self, send):
        self.send, self.q, self.alive = send, queue.Queue(), True
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        buf = np.zeros(0, np.int16); ctx = np.zeros(SR - HOP, np.int16)
        k = done = 0; prev = neutral; was_loud = False
        while self.alive:
            items = [self.q.get()]
            while not self.q.empty(): items.append(self.q.get())
            for item in items:
                if item is None: return
                if isinstance(item, str):                    # interrupted: what is waiting becomes silence
                    buf[:] = 0; ctx[:] = 0; was_loud = False
                else: buf = np.concatenate([buf, np.frombuffer(item, np.int16)])
            if len(buf) > SR * 4:                            # hopelessly behind: skip ahead rather than drift
                skip = (len(buf) - SR) // HOP * HOP; buf = buf[skip:]; done += skip; ctx[:] = 0
            while len(buf) >= HOP and self.alive:
                chunk, buf = buf[:HOP], buf[HOP:]
                window = np.concatenate([ctx, chunk]); ctx = window[HOP:] if HOP < SR else ctx
                loud = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2))) > SPEECH_RMS
                params = None
                if loud or was_loud:
                    try:
                        params = mouth_params(window)
                        params[0] = 0.6 * prev + 0.4 * params[0]; params[1] = 0.25 * prev + 0.75 * params[1]
                    except Exception as err: print('face service: mouth step failed:', err, flush=True)
                behind = len(buf) / SR > 1.0                 # this computer cannot keep up: draw every other frame
                for i in range(N):
                    fid = frame_id(k); t = (done + i * HOP / N) / SR
                    if params is None: jpg = idle[fid]
                    elif behind and i % 2: k += 1; continue
                    else: jpg = render(params[i], fid)
                    self.send(struct.pack('<IdI', k & 0xffffffff, t, 1 if loud else 0) + jpg); k += 1
                done += HOP; prev = params[-1] if params is not None else neutral; was_loud = loud


async def handler(ws):
    loop = asyncio.get_running_loop()
    def send(data):
        asyncio.run_coroutine_threadsafe(ws.send(data), loop)
    session = Session(send)
    try:
        await ws.send(json.dumps({'type': 'hello', 'fps': FPS, 'hop': HOP_S, 'width': OUT_W, 'height': OUT_H, 'frameMs': round(per_frame_ms)}))
        await ws.send(struct.pack('<IdI', 0, -1.0, 0) + idle[0])
        async for msg in ws: session.q.put(msg if isinstance(msg, (bytes, str)) else bytes(msg))
    except websockets.ConnectionClosed: pass
    finally: session.alive = False; session.q.put(None)


async def main():
    origins = [args.origin, args.origin.replace('127.0.0.1', 'localhost')]
    async with websockets.serve(handler, '127.0.0.1', args.port, origins=origins, max_size=2 ** 20):
        print(f'face service: listening on ws://127.0.0.1:{args.port}', flush=True)
        await asyncio.Future()

asyncio.run(main())
