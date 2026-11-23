# Builds Nia's "real frames" mouth set from the reference sheets:
#   - cuts each labelled mouth shape out of the shape sheet,
#   - finds the face points in every cut-out and in the neutral portrait,
#   - turns/scales/shifts each cut-out so its eyes and nose sit exactly on the portrait's,
#   - matches its skin tone to the portrait, and
#   - saves the lower face of each shape as a soft-edged patch that drops onto the portrait.
#
#   python build_frames.py <FeatherTalk checkout (for its face-point detector)> <portrait> <shape sheet> <out folder>
import json, os, sys
import numpy as np, cv2

FT, PORTRAIT, SHEET, OUT = sys.argv[1:5]
os.makedirs(OUT, exist_ok=True)
SHAPES = ['MB', 'P', 'A', 'E', 'O', 'U', 'S', 'V', 'F', 'T', 'H', 'smile', 'grin', 'laugh', 'sharp']      # the sheet, row by row
COLS, ROWS, BASE_W = 5, 3, 450
ANCHOR = [66, 70, 82, 78, 51, 52, 53, 54, 33, 37, 42, 46]      # eye corners, nose bridge, brow ends: parts that speech does not move
JAW = list(range(5, 28)); NOSE_BASE = 60; MOUTH = list(range(90, 110))

cwd = os.getcwd(); os.chdir(os.path.join(FT, 'data_utils')); sys.path.insert(0, os.getcwd())
from get_landmark import Landmark
detector = Landmark(); tmp = os.path.join(OUT, '_tmp.jpg')
def points(img, up=1):                       # face points of a BGR image, in that image's own pixels
    big = cv2.resize(img, None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC) if up != 1 else img
    cv2.imwrite(tmp, big, [cv2.IMWRITE_JPEG_QUALITY, 96]); pts, x1, y1 = detector.detect(tmp)
    return (np.asarray(pts, np.float32) + (x1, y1)) / up
os.chdir(cwd)

portrait = cv2.imread(PORTRAIT); k = BASE_W / portrait.shape[1]
base = cv2.resize(portrait, (BASE_W, int(round(portrait.shape[0] * k))), interpolation=cv2.INTER_AREA); H, W = base.shape[:2]
bp = points(portrait) * k
sheet = cv2.imread(SHEET); th, tw = sheet.shape[0] / ROWS, sheet.shape[1] / COLS

aligned, pts_all, report = {}, {}, []
for i, name in enumerate(SHAPES):
    r, c = divmod(i, COLS); tile = sheet[int(r * th) + 3:int((r + 1) * th) - 3, int(c * tw) + 3:int((c + 1) * tw) - 3]
    tp = points(tile, up=3)
    M, _ = cv2.estimateAffinePartial2D(tp[ANCHOR], bp[ANCHOR], method=cv2.LMEDS)
    warped = cv2.warpAffine(tile, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    wp = tp @ M[:, :2].T + M[:, 2]
    aligned[name] = warped; pts_all[name] = wp.astype(np.float32)
    report.append((name, round(float(np.hypot(M[0, 0], M[1, 0])), 2), round(float(np.abs(wp[ANCHOR] - bp[ANCHOR]).mean()), 2)))
pts_all['neutral'] = bp; aligned['neutral'] = base

# One box that holds the lower face of every shape (the jaw drops for open shapes).
allp = np.concatenate([p[JAW + MOUTH + [NOSE_BASE]] for p in pts_all.values()])
x0, x1 = int(max(0, allp[:, 0].min() - 10)), int(min(W, allp[:, 0].max() + 10))
y0, y1 = int(max(0, bp[NOSE_BASE][1] - 14)), int(min(H, allp[:, 1].max() + 26))
box = [x0, y0, x1 - x0, y1 - y0]

def soft_mask(p):                             # lower face of this shape: from just under the nose, round the jaw
    m = np.zeros((H, W), np.float32); top = p[NOSE_BASE][1] + 3
    poly = [(p[5][0] + 6, top)] + [(x, y + 5) for x, y in p[7:26]] + [(p[27][0] - 6, top)]
    cv2.fillPoly(m, [np.round(np.array(poly)).astype(np.int32)], 1.0)
    m = cv2.erode(m, np.ones((9, 9), np.uint8)); return cv2.GaussianBlur(m, (0, 0), 7)

base_f = base.astype(np.float32); atlas = {'width': W, 'height': H, 'box': box, 'shapes': {}}
sheet_rows = []
for name in ['neutral'] + SHAPES:
    img = aligned[name].astype(np.float32); p = pts_all[name]; m = soft_mask(p)
    if name != 'neutral':                     # match skin tone to the portrait on the cheeks and chin, away from lips and teeth
        skin = (m > 0.5).astype(np.uint8); cv2.fillPoly(skin, [cv2.convexHull(np.round(p[MOUTH]).astype(np.int32))], 0)
        skin = cv2.erode(skin, np.ones((5, 5), np.uint8)).astype(bool)
        for ch in range(3):
            a, b = img[..., ch][skin], base_f[..., ch][skin]
            img[..., ch] = (img[..., ch] - a.mean()) * min(1.25, max(0.8, b.std() / (a.std() + 1e-6))) + b.mean()
    rgba = np.dstack([np.clip(img, 0, 255), m * 255]).astype(np.uint8)[y0:y1, x0:x1]
    cv2.imwrite(os.path.join(OUT, f'shape_{name}.png'), rgba)
    mo = p[MOUTH]; inner = p[102:110]
    atlas['shapes'][name] = {'file': f'shape_{name}.png', 'open': round(float(inner[:, 1].max() - inner[:, 1].min()) / float(mo[:, 0].max() - mo[:, 0].min()), 3),
                             'wide': round(float(mo[:, 0].max() - mo[:, 0].min()) / float(bp[MOUTH][:, 0].max() - bp[MOUTH][:, 0].min()), 3)}
    comp = (img * m[..., None] + base_f * (1 - m[..., None])).clip(0, 255).astype(np.uint8)
    tile = comp[max(0, y0 - 150):y1 + 10, max(0, x0 - 30):x1 + 30].copy()
    cv2.putText(tile, name, (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 3); cv2.putText(tile, name, (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (30, 30, 30), 1)
    sheet_rows.append(tile)
cv2.imwrite(os.path.join(OUT, 'base.jpg'), base, [cv2.IMWRITE_JPEG_QUALITY, 93])
json.dump(atlas, open(os.path.join(OUT, 'atlas.json'), 'w'), indent=1)
rows = [np.hstack(sheet_rows[i:i + 8]) for i in range(0, 16, 8)]
cv2.imwrite(os.path.join(OUT, '_check.jpg'), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 90]); os.remove(tmp)
print('base', (W, H), 'box', box)
for r in report: print(f'{r[0]:7s} scale x{r[1]}  anchor error {r[2]} px')
