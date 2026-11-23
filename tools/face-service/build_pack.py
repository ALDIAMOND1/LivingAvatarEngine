# Builds an avatar's footage pack from its training video: every frame, scaled
# to the size that is shown and stored as JPEG in a few large files, with the
# face points scaled to match and a per-frame "was she speaking here" flag.
#
#   python build_pack.py <train.mp4> <landmarks dir (0.lms ...)> <16 kHz wav of the same video> <avatar folder> [--width 448]
#
# Output in the avatar folder: footage_00.pack ..., footage.json
import argparse, json, os, wave
import numpy as np, cv2

ap = argparse.ArgumentParser()
ap.add_argument('video'); ap.add_argument('landmarks'); ap.add_argument('wav'); ap.add_argument('out')
ap.add_argument('--width', type=int, default=448); ap.add_argument('--quality', type=int, default=88)
a = ap.parse_args()

w = wave.open(a.wav); pcm = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)
cap = cv2.VideoCapture(a.video); n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
W0, H0 = int(cap.get(3)), int(cap.get(4)); k = a.width / W0; size = (a.width, int(round(H0 * k / 2) * 2))
LIMIT = 90 * 1024 * 1024                      # keep each file under GitHub's 100 MB limit
packs, index, points, voiced = [], [], [], []
buf = bytearray(); part = 0
for i in range(n):
    ok, img = cap.read()
    if not ok: break
    jpg = cv2.imencode('.jpg', cv2.resize(img, size, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, a.quality])[1].tobytes()
    if len(buf) + len(jpg) > LIMIT:
        open(os.path.join(a.out, f'footage_{part:02d}.pack'), 'wb').write(buf); packs.append(f'footage_{part:02d}.pack'); buf = bytearray(); part += 1
    index.append([part, len(buf), len(jpg)]); buf += jpg
    pts = np.loadtxt(os.path.join(a.landmarks, f'{i}.lms')) * k
    points.append(np.round(pts, 1).tolist())
    seg = pcm[max(0, i * 640 - 1600):i * 640 + 2240]            # 240 ms around the frame
    voiced.append(bool(len(seg) and float(np.sqrt(np.mean(seg ** 2))) > 110.0))
open(os.path.join(a.out, f'footage_{part:02d}.pack'), 'wb').write(buf); packs.append(f'footage_{part:02d}.pack')
json.dump(dict(frames=len(index), size=size, fps=25, packs=packs, index=index, voiced=voiced, points=points), open(os.path.join(a.out, 'footage.json'), 'w'))
print(f'{len(index)} frames at {size[0]}x{size[1]}, {sum(voiced)} with speech, {len(packs)} pack file(s), {sum(os.path.getsize(os.path.join(a.out, p)) for p in packs) / 1e6:.0f} MB')
