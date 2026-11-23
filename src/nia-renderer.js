import {NiaMotion, clamp} from './nia-motion.js';

const FACE_SIZE = 512;
const PATCH_Y = 155;
const PATCH_HEIGHT = 102;
const PHOTO_URL = './characters/nia/assets/portrait/nia-master.webp';
const ATLAS_URL = './characters/nia/assets/face/nia-eye-atlas.webp';

// Lightweight photographic compositing: neutral portrait + three local eye overlays.
// NOT 3D reconstruction or an audio-viseme renderer.
export class NiaRenderer {
  constructor(canvas, motion = new NiaMotion()) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', {alpha: false, desynchronized: true});
    this.motion = motion;
    this.photo = new Image();
    this.atlas = new Image();
    this.ready = false;
    this.loadError = null;
    this.headLayer = null;
    this.running = false;
    this.prev = 0;
    this.frames = 0;
    this.rollingFrames = 0;
    this.fpsAt = 0;
    this.fps = 0;
    this.photo.onload = () => this.checkReady();
    this.atlas.onload = () => this.checkReady();
    this.photo.onerror = () => { this.loadError = 'Nia portrait could not load'; };
    this.atlas.onerror = () => { this.loadError = 'Nia eye animation could not load'; };
    this.photo.src = PHOTO_URL;
    this.atlas.src = ATLAS_URL;
  }

  checkReady() {
    if (this.ready || !this.photo.naturalWidth || !this.atlas.naturalWidth) return;
    if (this.atlas.naturalWidth !== FACE_SIZE || this.atlas.naturalHeight !== PATCH_HEIGHT * 3) {
      this.loadError = 'Nia eye atlas has incorrect dimensions'; return;
    }
    this.makeHeadLayer();
    this.ready = true;
  }

  makeHeadLayer() {
    const layer = document.createElement('canvas');
    layer.width = FACE_SIZE;
    layer.height = FACE_SIZE;
    const g = layer.getContext('2d', {willReadFrequently: true});
    g.drawImage(this.photo, 0, 0, FACE_SIZE, FACE_SIZE);
    const image = g.getImageData(0, 0, FACE_SIZE, FACE_SIZE);
    // Small feathered upper-head animation only. Eye overlays remain separate.
    for (let y = 0; y < FACE_SIZE; y++) {
      for (let x = 0; x < FACE_SIZE; x++) {
        const rr = Math.hypot((x - 256) / 236, (y - 232) / 254);
        const a = clamp((1.065 - rr) / 0.165, 0, 1);
        image.data[(y * FACE_SIZE + x) * 4 + 3] = Math.round(255 * a);
      }
    }
    g.putImageData(image, 0, 0);
    this.headLayer = layer;
  }

  paint() {
    const {canvas, ctx, motion} = this;
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#68666a';
    ctx.fillRect(0, 0, w, h);
    if (!this.ready) {
      ctx.fillStyle = '#f8f8fa'; ctx.textAlign = 'center';
      ctx.font = '22px Segoe UI';
      ctx.fillText(this.loadError || 'Preparing Nia…', w / 2, h / 2);
      return;
    }
    const s = Math.max(w / FACE_SIZE, h / FACE_SIZE);
    const side = FACE_SIZE * s;
    const dx = (w - side) / 2;
    const dy = (h - side) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.photo, dx, dy, side, side);

    // Tiny head stabilization is only a 2D research approximation.
    // Do not exaggerate pose or claim actual 3D rotation.
    ctx.save();
    ctx.translate(dx + side / 2, dy + side * 0.51);
    ctx.rotate(motion.headRoll * 0.5);
    ctx.translate(-side / 2, -side * 0.51);
    ctx.translate(0, (motion.headY || 0) * s * 0.18);
    if (this.headLayer) ctx.drawImage(this.headLayer, 0, 0, FACE_SIZE, FACE_SIZE, dx, dy, side, side);

    // Aligned, feathered photographic eye overlays in compact vertical atlas.
    const overlay = (index, opacity) => {
      if (opacity < 0.005) return;
      ctx.save();
      ctx.globalAlpha = clamp(opacity, 0, 1);
      ctx.drawImage(this.atlas, 0, index * PATCH_HEIGHT, FACE_SIZE, PATCH_HEIGHT,
        dx, dy + PATCH_Y * s, side, PATCH_HEIGHT * s);
      ctx.restore();
    };
    // Nia atlas: row 0 blink; row 1 look right; row 2 look left.
    if (motion.gaze > 0) overlay(1, motion.gaze);
    else if (motion.gaze < 0) overlay(2, -motion.gaze);
    overlay(0, motion.blink);
    ctx.restore();
  }

  start(onFrame) {
    if (this.running) return;
    this.running = true;
    this.prev = performance.now();
    this.fpsAt = this.prev;
    const tick = now => {
      if (!this.running) return;
      const dt = Math.min((now - this.prev) / 1000, 0.07);
      this.prev = now;
      this.motion.tick(dt);
      this.paint();
      this.frames++;
      this.rollingFrames++;
      if (now - this.fpsAt >= 1000) {
        this.fps = Math.round(this.rollingFrames * 1000 / (now - this.fpsAt));
        this.fpsAt = now;
        this.rollingFrames = 0;
        if (onFrame) onFrame(this.fps, this.motion);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  stop() { this.running = false; }
}
