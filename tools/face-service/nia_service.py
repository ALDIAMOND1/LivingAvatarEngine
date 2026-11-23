# Live face service for a FeatherTalk avatar (Nia): her voice goes in as it is
# spoken, video frames of her face come out, made on the processor only.
#
#   python nia_service.py --avatar <avatar folder> [--port 8768]
#
# Needs only: onnxruntime, opencv-python, numpy, websockets.
#
# Protocol (WebSocket, one page at a time, local only) — same as face_service.py:
#   page -> service   binary: 16 kHz mono 16-bit sound, continuously (silence included)
#                     text "reset": she was interrupted, treat what is buffered as silence
#   service -> page   text  {"type":"hello", fps, width, height, latency}
#                     binary: uint32 frame number, float64 time of the sound this frame
#                             belongs to (seconds since the stream began; -1 = show now),
#                             uint32 flags (1 = speaking), then a JPEG
#
# Timing. The mouth model looks 0.4 s ahead in the sound, and the voice model
# needs a little sound after a moment to describe it, so a frame can only be
# drawn about 0.7 s after its sound arrives. The page plays her voice that much
# late, which is what keeps lips and sound exactly together.
import argparse, asyncio, json, os, queue, struct, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np, cv2, websockets
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nia_runtime import Avatar, Footage, SR, HALF, TOKENS_PER_FRAME

ap = argparse.ArgumentParser()
ap.add_argument('--avatar', required=True); ap.add_argument('--port', type=int, default=8768)
ap.add_argument('--origin', default='http://127.0.0.1:8766')
args = ap.parse_args()

FPS = 25; ROW = 320                          # one sound-feature row per 320 samples (50 a second)
HOP_FRAMES = 3; HOP = HOP_FRAMES * 640        # work is done every 3 frames (120 ms) of new sound
WIN = 64 * ROW                               # the voice model re-reads the last 1.28 s each step
EDGE = 8                                     # its newest 8 rows (160 ms) are not trusted yet
SPEECH_RMS = 110.0                           # 16-bit level below which a moment counts as silence
JPEG = [cv2.IMWRITE_JPEG_QUALITY, 82]

print('face service: loading Nia...', flush=True)
av = Avatar(args.avatar, threads=2)
pool = ThreadPoolExecutor(3)                 # the frames of one step are drawn side by side
_probe = Footage(av, seed=0)
first_jpg = cv2.imencode('.jpg', av.base(_probe.rest[0]), JPEG)[1].tobytes()
# Measure this computer once, so the page knows how much head start the picture needs.
_f = np.zeros((2 * HALF * TOKENS_PER_FRAME, 1024), np.float32)
av.speak(av.base(300), 300, _f); t0 = time.perf_counter()
def draw(job):
    k, img, window, M = job
    if window is not None: av.speak(img, k, window)
    return cv2.imencode('.jpg', cv2.warpAffine(img, M, av.size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE), JPEG)[1].tobytes()
for i in range(3): list(pool.map(draw, [(*_probe.next(True), _f, _probe.sway()) for _ in range(3)]))      # warm up
t0 = time.perf_counter()
for i in range(4): list(pool.map(draw, [(*_probe.next(True), _f, _probe.sway()) for _ in range(3)]))
frame_ms = (time.perf_counter() - t0) / 12 * 1000
av.features(np.zeros(WIN, np.float32)); t0 = time.perf_counter(); av.features(np.zeros(WIN, np.float32)); voice_ms = (time.perf_counter() - t0) * 1000
LOOKAHEAD = (HALF * 640 + EDGE * ROW + HOP) / SR          # sound that must arrive after a frame's own moment
LATENCY = LOOKAHEAD + (voice_ms + HOP_FRAMES * frame_ms) / 1000
print(f'face service: {av.n} footage frames at {av.size[0]}x{av.size[1]}; {frame_ms:.0f} ms per frame, {voice_ms:.0f} ms per voice step; picture trails sound by about {LATENCY:.2f} s', flush=True)


class Session:
    def __init__(self, send):
        self.send, self.q, self.alive = send, queue.Queue(), True
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        audio = np.zeros(0, np.float32)          # all sound not yet dropped; audio[0] is sample `base`
        base = 0; received = 0                   # stream positions, in samples
        feats = {}                               # sound-feature rows by global row number
        voiced = {}                              # whether each row actually has her voice in it
        rows_done = 0; frame = 0; pending = 0
        footage = Footage(av)
        level = 2500.0                           # running loudness of her speech, for the voice model's input scale
        while self.alive:
            items = [self.q.get()]
            while not self.q.empty(): items.append(self.q.get())
            for item in items:
                if item is None: return
                if isinstance(item, str):            # interrupted: everything still waiting becomes silence
                    audio[:] = 0
                    for r in list(feats): feats[r] = None
                    voiced.clear()
                else:
                    chunk = np.frombuffer(item, np.int16).astype(np.float32)
                    audio = np.concatenate([audio, chunk]); received += len(chunk); pending += len(chunk)
            if received - base > SR * 6:             # hopelessly behind: jump ahead rather than drift
                skip = ((received - base - SR * 2) // HOP) * HOP
                audio = audio[skip:]; base += skip; frame = max(frame, (base + WIN) // 640); rows_done = max(rows_done, base // ROW)
            while pending >= HOP and self.alive:
                pending -= HOP
                end = received - pending             # the step covers sound up to here
                lo = end - WIN
                win = np.zeros(WIN, np.float32); a = max(lo, base)
                win[a - lo:] = audio[a - base:end - base]
                newest = win[-HOP:]; rms = float(np.sqrt(np.mean(newest ** 2)))
                if rms > SPEECH_RMS: level += 0.05 * (rms - level)
                loud_recent = float(np.sqrt(np.mean(win[-(HOP + EDGE * ROW + 12800):] ** 2))) > SPEECH_RMS * 0.6
                first_row, last_row = rows_done, end // ROW - EDGE          # rows that are now final
                if last_row > first_row:
                    for r in range(first_row, last_row):
                        j = (r - lo // ROW) * ROW
                        voiced[r] = j >= 0 and float(np.sqrt(np.mean(win[j:j + ROW] ** 2))) > SPEECH_RMS
                    if loud_recent:
                        out = av.features(win / max(level * 0.9, 300.0))
                        j0 = first_row - lo // ROW
                        for r in range(first_row, last_row):
                            j = j0 + (r - first_row)
                            feats[r] = out[j] if 0 <= j < len(out) else None
                    else:
                        for r in range(first_row, last_row): feats[r] = None
                    rows_done = last_row
                # Every frame whose whole sound window is final can be drawn now.
                jobs, heads = [], []
                while (frame + HALF) * TOKENS_PER_FRAME <= rows_done and self.alive:
                    r0 = (frame - HALF) * TOKENS_PER_FRAME; rows = [feats.get(r) for r in range(r0, r0 + 2 * HALF * TOKENS_PER_FRAME)]
                    speaking = any(voiced.get(r) for r in range(frame * 2 - 3, frame * 2 + 5))
                    behind = (received - frame * 640) / SR > LATENCY + 0.6        # this computer is not keeping up
                    if behind and frame % 2: frame += 1; continue                  # draw every other frame until caught up
                    active = any(x is not None for x in rows)                      # her voice is somewhere in this frame's window
                    k, img = footage.next(active)
                    jobs.append((k, img, np.stack([x if x is not None else np.zeros(1024, np.float32) for x in rows]) if active else None, footage.sway()))
                    heads.append(struct.pack('<IdI', frame & 0xffffffff, frame / FPS, 1 if speaking else 0))
                    for r in range(r0 - 4, r0): feats.pop(r, None); voiced.pop(r, None)
                    frame += 1
                for head, jpg in zip(heads, pool.map(draw, jobs)): self.send(head + jpg)
                keep_from = max(base, end - WIN)                                   # sound older than one window is no longer needed
                if keep_from > base: audio = audio[keep_from - base:]; base = keep_from


async def handler(ws):
    loop = asyncio.get_running_loop()
    session = Session(lambda data: asyncio.run_coroutine_threadsafe(ws.send(data), loop))
    try:
        await ws.send(json.dumps({'type': 'hello', 'fps': FPS, 'width': av.size[0], 'height': av.size[1],
                                  'frameMs': round(frame_ms), 'latency': round(LATENCY, 3), 'avatar': 'Nia'}))
        await ws.send(struct.pack('<IdI', 0, -1.0, 0) + first_jpg)
        async for msg in ws: session.q.put(msg)
    except websockets.ConnectionClosed: pass
    finally: session.alive = False; session.q.put(None)


async def main():
    origins = [args.origin, args.origin.replace('127.0.0.1', 'localhost')]
    async with websockets.serve(handler, '127.0.0.1', args.port, origins=origins, max_size=2 ** 20):
        print(f'face service: listening on ws://127.0.0.1:{args.port}', flush=True)
        await asyncio.Future()

asyncio.run(main())
