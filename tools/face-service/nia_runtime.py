# Runs a FeatherTalk avatar (github.com/anliyuan/FeatherTalk, Apache-2.0) on the
# processor with ONNX Runtime: voice -> sound features -> the mouth area of real
# video frames of the avatar, repainted to match.
#
# An avatar folder holds:
#   frames/0.jpg ...      resting video frames (the first seconds of the training video)
#   landmarks/0.lms ...   face points for each of those frames
#   feathertalk_144.onnx  the avatar's own mouth model
#   feather_hubert.onnx   the shared voice model
import os, time
import numpy as np, cv2, onnxruntime as ort

SR = 16000
TOKENS_PER_FRAME = 2          # the voice model gives 50 feature rows a second; video is 25 frames a second
HALF = 10                     # the mouth model looks at 10 frames of sound either side of the frame it draws
CROP, INNER, BORDER, GEO = 152, 144, 4, 160
MASK_RECT = (5, 5, 150, 145)


def _session(path, threads):
    so = ort.SessionOptions(); so.intra_op_num_threads = threads
    return ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])


class Avatar:
    def __init__(self, folder, out_width=480, threads=4):
        self.visual = _session(os.path.join(folder, 'feathertalk_144.onnx'), threads)
        self.voice = _session(os.path.join(folder, 'feather_hubert.onnx'), threads)
        names = sorted((f for f in os.listdir(os.path.join(folder, 'frames')) if f.endswith('.jpg')), key=lambda n: int(n[:-4]))
        s = INNER / GEO; x, y, w, h = MASK_RECT
        self.items = []
        for n in names:
            img = cv2.imread(os.path.join(folder, 'frames', n))
            pts = np.loadtxt(os.path.join(folder, 'landmarks', n[:-4] + '.lms')).astype(np.int32)
            xmin, ymin, xmax = int(pts[1][0]), int(pts[52][1]), int(pts[31][0]); ymax = ymin + (xmax - xmin)
            crop = cv2.resize(img[ymin:ymax, xmin:xmax], (CROP, CROP), interpolation=cv2.INTER_AREA)
            inner = crop[BORDER:BORDER + INNER, BORDER:BORDER + INNER].copy()
            masked = cv2.rectangle(inner.copy(), (round(x * s), round(y * s), round(w * s), round(h * s)), (0, 0, 0), -1)
            chw = lambda a: a.transpose(2, 0, 1).astype(np.float32) / 255.0
            # Everything is composited at the size that is shown, so no time goes into pixels nobody sees.
            k = out_width / img.shape[1]; small = cv2.resize(img, (out_width, int(round(img.shape[0] * k / 2) * 2)), interpolation=cv2.INTER_AREA)
            box = tuple(int(round(v * k)) for v in (xmin, ymin, xmax, ymax))
            self.items.append(dict(inp=np.concatenate([chw(inner), chw(masked)])[None], crop=crop, small=small, box=box))
        self.n = len(self.items); self.size = self.items[0]['small'].shape[1::-1]

    def frame_index(self, k):                 # the resting clip is played forward then backward, endlessly
        n = self.n - 1; m = k % (2 * n)
        return m if m <= n else 2 * n - m

    def features(self, wave):                 # float32 16 kHz, already level-normalised -> [rows, 1024], 50 rows a second
        return self.voice.run(None, {'waveform': wave[None].astype(np.float32)})[0][0]

    def render(self, k, window):              # window: [40, 1024] sound features centred on this frame -> BGR image
        it = self.items[self.frame_index(k)]
        pred = self.visual.run(None, {'input': it['inp'], 'audio': window[None].astype(np.float32)})[0][0]
        pred = (pred.transpose(1, 2, 0) * 255.0).clip(0, 255).astype(np.uint8)
        crop = it['crop'].copy(); crop[BORDER:BORDER + INNER, BORDER:BORDER + INNER] = pred
        x1, y1, x2, y2 = it['box']; out = it['small'].copy()
        out[y1:y2, x1:x2] = cv2.resize(crop, (x2 - x1, y2 - y1), interpolation=cv2.INTER_LINEAR)
        return out

    def idle(self, k): return self.items[self.frame_index(k)]['small']


def window_at(feats, frame, total_frames=None):
    """Sound features for one video frame: rows for frames [frame-10, frame+10), zero where there is no sound."""
    lo, hi = (frame - HALF) * TOKENS_PER_FRAME, (frame + HALF) * TOKENS_PER_FRAME
    out = np.zeros((hi - lo, feats.shape[1]), np.float32)
    a, b = max(lo, 0), min(hi, len(feats))
    if b > a: out[a - lo:b - lo] = feats[a:b]
    return out


if __name__ == '__main__':                    # offline check: python nia_runtime.py <avatar folder> <16 kHz wav> <out.mp4>
    import sys, wave, json, subprocess, imageio_ffmpeg
    av = Avatar(sys.argv[1]); w = wave.open(sys.argv[2]); pcm = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)
    t = time.perf_counter(); feats = av.features((pcm - pcm.mean()) / np.sqrt(pcm.var() + 1e-7)); voice_ms = (time.perf_counter() - t) * 1000
    frames = len(feats) // TOKENS_PER_FRAME; silent = sys.argv[3] + '.silent.mp4'
    vw = cv2.VideoWriter(silent, cv2.VideoWriter_fourcc(*'mp4v'), 25, av.size); times = []
    for i in range(frames):
        t = time.perf_counter(); img = av.render(i, window_at(feats, i)); times.append((time.perf_counter() - t) * 1000); vw.write(img)
    vw.release()
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error', '-i', silent, '-i', sys.argv[2], '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sys.argv[3]], check=True)
    os.remove(silent); ts = np.array(times[5:])
    print(json.dumps(dict(resting_frames=av.n, size=av.size, speech_seconds=round(len(pcm) / SR, 2), voice_model_ms=round(voice_ms, 1),
        frame_ms_mean=round(float(ts.mean()), 1), frame_ms_p95=round(float(np.percentile(ts, 95)), 1), frames_per_second_possible=round(1000 / float(ts.mean()), 1)), indent=1))
