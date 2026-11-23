# Runs a FeatherTalk avatar (github.com/anliyuan/FeatherTalk, Apache-2.0) on the
# processor with ONNX Runtime: voice -> sound features -> the mouth of real
# video frames of the avatar, repainted to match.
#
# An avatar folder holds (see build_pack.py):
#   footage.json + footage_NN.pack   every frame of her training video at display size, with face points
#   feathertalk_144.onnx             her own mouth model
#   feather_hubert.onnx              the shared voice model
import json, os, time
import numpy as np, cv2, onnxruntime as ort

SR = 16000
TOKENS_PER_FRAME = 2          # the voice model gives 50 feature rows a second; video is 25 frames a second
HALF = 10                     # the mouth model looks at 10 frames of sound either side of the frame it draws
CROP, INNER, BORDER, GEO = 152, 144, 4, 160
MASK_RECT = (5, 5, 150, 145)
# Face points (98-point layout): jaw line 0-32 with the chin at 16, nose base 57, mouth 76-95.
CHIN, NOSE_BASE, MOUTH = 16, 57, slice(76, 96)
POSE_POINTS = [0, 8, 16, 24, 32, 51, 54, 57, 60, 64, 68, 72]   # enough to compare two frames' head position


def _session(path, threads):
    so = ort.SessionOptions(); so.intra_op_num_threads = threads
    return ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])


class Avatar:
    def __init__(self, folder, threads=4):
        self.visual = _session(os.path.join(folder, 'feathertalk_144.onnx'), threads)
        self.voice = _session(os.path.join(folder, 'feather_hubert.onnx'), threads)
        meta = json.load(open(os.path.join(folder, 'footage.json')))
        self.packs = [open(os.path.join(folder, p), 'rb').read() for p in meta['packs']]
        self.index = meta['index']; self.n = meta['frames']; self.size = tuple(meta['size'])
        self.points = np.asarray(meta['points'], np.float32)            # [frames, 98, 2] in display pixels
        self.voiced = np.asarray(meta['voiced'], bool)
        self.pose = self.points[:, POSE_POINTS].reshape(self.n, -1)
        s = INNER / GEO; x, y, w, h = MASK_RECT
        self.rect = (round(x * s), round(y * s), round(w * s), round(h * s))
        edge = np.clip(np.minimum(np.arange(INNER), np.arange(INNER)[::-1]) / 7.0, 0, 1).astype(np.float32)
        self.edge = np.minimum.outer(edge, edge)                        # fades to nothing at the border of the repainted square

    def base(self, i):                        # one frame of her footage, as a BGR image
        part, off, size = self.index[i]
        return cv2.imdecode(np.frombuffer(self.packs[part], np.uint8, size, off), cv2.IMREAD_COLOR)

    def features(self, wave):                 # float32 16 kHz, level-normalised -> [rows, 1024], 50 rows a second
        return self.voice.run(None, {'waveform': wave[None].astype(np.float32)})[0][0]

    def box(self, i):
        p = self.points[i]; W, H = self.size
        x1 = int(max(0, p[1][0])); y1 = int(max(0, p[52][1])); x2 = int(min(W, p[31][0])); side = min(x2 - x1, H - y1)
        return x1, y1, x1 + side, y1 + side

    def mouth_mask(self, i, box):
        """Where the repainted mouth replaces the footage: a soft-edged oval from under the nose to the chin.
        Outside it her real pixels are kept untouched, which is what stops the repaint looking like a mask."""
        x1, y1, x2, _ = box; k = CROP / (x2 - x1)
        p = (self.points[i] - (x1, y1)) * k - BORDER
        m = p[MOUTH]; cx = float(m[:, 0].mean()); mw = float(m[:, 0].max() - m[:, 0].min())
        top = (p[NOSE_BASE][1] + m[:, 1].min()) / 2; bottom = min(INNER - 2, p[CHIN][1] + 7)
        mask = np.zeros((INNER, INNER), np.float32)
        cv2.ellipse(mask, (int(round(cx)), int(round((top + bottom) / 2))), (int(max(mw * 0.82, 30)), int(max((bottom - top) / 2, 20))), 0, 0, 360, 1.0, -1)
        return cv2.GaussianBlur(mask, (0, 0), 5.5) * self.edge

    def speak(self, img, i, window):
        """Repaint the mouth of footage frame `i` (already decoded as `img`) for this moment of sound. Edits `img`."""
        box = self.box(i); x1, y1, x2, y2 = box; w = x2 - x1
        crop = cv2.resize(img[y1:y2, x1:x2], (CROP, CROP), interpolation=cv2.INTER_AREA if w > CROP else cv2.INTER_LINEAR)
        inner = crop[BORDER:BORDER + INNER, BORDER:BORDER + INNER]
        masked = cv2.rectangle(inner.copy(), self.rect, (0, 0, 0), -1)
        chw = lambda a: a.transpose(2, 0, 1).astype(np.float32) / 255.0
        inp = np.concatenate([chw(inner), chw(masked)])[None]
        pred = self.visual.run(None, {'input': inp, 'audio': window[None].astype(np.float32)})[0][0].transpose(1, 2, 0) * 255.0
        pred = cv2.addWeighted(pred, 1.55, cv2.GaussianBlur(pred, (0, 0), 1.1), -0.55, 0)          # the model's output is a little soft
        s = w / CROP; rx, ry = x1 + int(round(BORDER * s)), y1 + int(round(BORDER * s)); side = int(round(INNER * s))
        side = min(side, img.shape[1] - rx, img.shape[0] - ry)
        up = cv2.resize(pred, (side, side), interpolation=cv2.INTER_CUBIC)
        a = cv2.resize(self.mouth_mask(i, box), (side, side), interpolation=cv2.INTER_LINEAR)[:, :, None]
        region = img[ry:ry + side, rx:rx + side].astype(np.float32)
        img[ry:ry + side, rx:rx + side] = np.clip(up * a + region * (1 - a), 0, 255).astype(np.uint8)
        return img


def window_at(feats, frame):
    """Sound features for one video frame: rows for frames [frame-10, frame+10), zero where there is no sound."""
    lo, hi = (frame - HALF) * TOKENS_PER_FRAME, (frame + HALF) * TOKENS_PER_FRAME
    out = np.zeros((hi - lo, feats.shape[1]), np.float32)
    a, b = max(lo, 0), min(hi, len(feats))
    if b > a: out[a - lo:b - lo] = feats[a:b]
    return out


class Footage:
    """Chooses which frame of her footage sits under each output frame.

    While she is quiet it wanders through her resting footage; while she speaks
    it plays footage of her speaking, so her head, brows and shoulders move the
    way they do when she talks. Each change picks a frame where her head is in
    nearly the same place and cross-fades over a quarter of a second, and a slow
    drift is added on top so no stretch ever plays back exactly the same."""
    FADE = 7

    def __init__(self, av, seed=None):
        self.av = av; self.rng = np.random.default_rng(seed)
        quiet = np.flatnonzero(~av.voiced); runs = np.split(quiet, np.flatnonzero(np.diff(quiet) > 1) + 1)
        rest = max(runs, key=len)                                   # her longest stretch of silence is the resting clip
        self.rest = (int(rest[0]), int(rest[-1])); self.talk = (int(rest[-1]) + 1, av.n - 1)
        self.mode = 'rest'; self.at = self.rest[0]; self.dir = 1
        self.old = None; self.fade = 0; self.t = float(self.rng.uniform(0, 100))

    def _step(self, at, direction, span):
        if at + direction > span[1] or at + direction < span[0]: direction = -direction
        return at + direction, direction

    def _jump(self, span):
        lo, hi = span[0] + 20, span[1] - 20
        d = np.linalg.norm(self.av.pose[lo:hi] - self.av.pose[self.at], axis=1)
        best = np.argsort(d)[:60]
        pick = best[int(self.rng.integers(0, min(len(best), 12)))]   # among the closest, not always the same one
        return lo + int(pick)

    def next(self, speaking):
        """-> (frame number to repaint on, image). Call once per output frame."""
        want = 'talk' if speaking else 'rest'
        if want != self.mode and self.fade == 0:
            self.old = (self.at, self.dir, self.rest if self.mode == 'rest' else self.talk)
            self.mode = want; span = self.talk if want == 'talk' else self.rest
            self.at = self._jump(span); self.dir = 1; self.fade = self.FADE
        else:
            self.at, self.dir = self._step(self.at, self.dir, self.talk if self.mode == 'talk' else self.rest)
        img = self.av.base(self.at)
        if self.fade:
            oa, od, ospan = self.old; oa, od = self._step(oa, od, ospan); self.old = (oa, od, ospan)
            a = 1 - self.fade / (self.FADE + 1); a = a * a * (3 - 2 * a)
            img = cv2.addWeighted(img, a, self.av.base(oa), 1 - a, 0); self.fade -= 1
        return self.at, img

    def sway(self, dt=0.04):
        """A slow, never-repeating sway of the whole picture: a degree of tilt, a few pixels of shift. -> affine matrix"""
        self.t += dt; t = self.t; W, H = self.av.size
        ang = 0.55 * np.sin(t / 7.3 * 6.283) + 0.35 * np.sin(t / 3.1 * 6.283 + 1.3)
        tx = 2.2 * np.sin(t / 11.9 * 6.283 + 0.4) + 1.0 * np.sin(t / 4.7 * 6.283)
        ty = 1.4 * np.sin(t / 5.9 * 6.283 + 2.0); zoom = 1.012 + 0.004 * np.sin(t / 17.1 * 6.283)
        M = cv2.getRotationMatrix2D((W / 2, H * 0.62), float(ang), float(zoom)); M[0, 2] += tx; M[1, 2] += ty
        return M

    def drift(self, img):
        return cv2.warpAffine(img, self.sway(), self.av.size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


if __name__ == '__main__':                    # offline check: python nia_runtime.py <avatar folder> <16 kHz wav> <out.mp4>
    import sys, wave, subprocess, imageio_ffmpeg
    av = Avatar(sys.argv[1]); fo = Footage(av, seed=1)
    w = wave.open(sys.argv[2]); pcm = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)
    pcm = np.concatenate([np.zeros(SR * 2, np.float32), pcm, np.zeros(SR * 2, np.float32)])     # quiet before and after, to see her change over
    wav2 = sys.argv[3] + '.wav'; ww = wave.open(wav2, 'wb'); ww.setnchannels(1); ww.setsampwidth(2); ww.setframerate(SR); ww.writeframes(pcm.astype(np.int16).tobytes()); ww.close()
    loud = pcm[np.abs(pcm) > 200]; feats = av.features(pcm / (np.sqrt(np.mean(loud ** 2)) * 0.9))
    rows_loud = np.array([np.sqrt(np.mean(pcm[r * 320:r * 320 + 320] ** 2)) > 110 for r in range(len(feats))])
    frames = len(feats) // TOKENS_PER_FRAME; silent = sys.argv[3] + '.silent.mp4'
    vw = cv2.VideoWriter(silent, cv2.VideoWriter_fourcc(*'mp4v'), 25, av.size); times = []
    for i in range(frames):
        t = time.perf_counter()
        active = bool(rows_loud[max(0, (i - HALF) * 2):(i + HALF) * 2].any())
        k, img = fo.next(active)
        if active: av.speak(img, k, window_at(feats, i))
        img = fo.drift(img); times.append((time.perf_counter() - t) * 1000); vw.write(img)
    vw.release()
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error', '-i', silent, '-i', wav2, '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sys.argv[3]], check=True)
    os.remove(silent); os.remove(wav2); ts = np.array(times[5:])
    print(json.dumps(dict(footage_frames=av.n, resting=fo.rest, talking=fo.talk, size=av.size, frame_ms_mean=round(float(ts.mean()), 1),
        frame_ms_p95=round(float(np.percentile(ts, 95)), 1), frames_per_second_possible=round(1000 / float(ts.mean()), 1)), indent=1))
