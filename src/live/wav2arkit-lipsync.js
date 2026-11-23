// Model-driven lip-sync: turns her voice into mouth, jaw and cheek movement
// with a neural audio-to-face model instead of the rough sound-class mapping in
// viseme-arkit.js. It listens to the audio in 200 ms windows, runs each through
// the model in a worker, and hands back face frames at 30 a second.
//
// It is still audio-driven (no phoneme timing exists to drive it), but the
// model was trained on real speech, so shapes and transitions between sounds
// come from data instead of a hand-written table. If the device cannot run the
// model in real time, it reports itself as too slow and the caller falls back.
const NAMES = ('browDownLeft browDownRight browInnerUp browOuterUpLeft browOuterUpRight cheekPuff cheekSquintLeft cheekSquintRight eyeBlinkLeft '
  + 'eyeBlinkRight eyeLookDownLeft eyeLookDownRight eyeLookInLeft eyeLookInRight eyeLookOutLeft eyeLookOutRight eyeLookUpLeft eyeLookUpRight '
  + 'eyeSquintLeft eyeSquintRight eyeWideLeft eyeWideRight jawForward jawLeft jawOpen jawRight mouthClose mouthDimpleLeft mouthDimpleRight '
  + 'mouthFrownLeft mouthFrownRight mouthFunnel mouthLeft mouthLowerDownLeft mouthLowerDownRight mouthPressLeft mouthPressRight mouthPucker '
  + 'mouthRight mouthRollLower mouthRollUpper mouthShrugLower mouthShrugUpper mouthSmileLeft mouthSmileRight mouthStretchLeft mouthStretchRight '
  + 'mouthUpperUpLeft mouthUpperUpRight noseSneerLeft noseSneerRight tongueOut').split(' ');
// Only the lower face is taken from the model. Eyes and brows belong to the behaviour engine.
const USED = NAMES.map((n, i) => [n, i]).filter(([n]) => /^(jaw|mouth|cheek|noseSneer|tongue)/.test(n));
// The model's raw output is small (real speech peaks near 0.13 on the jaw), so
// it is amplified along a curve that flattens toward a ceiling instead of clipping.
const BOOSTED = new Set(['jawOpen', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'mouthFunnel', 'mouthPucker',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthClose', 'mouthPressLeft', 'mouthPressRight', 'mouthRollLower', 'mouthRollUpper']);
const CEILING_SCALE = { mouthLowerDownLeft: 0.5, mouthLowerDownRight: 0.5 };   // the lower lip smears on splat avatars if pulled far
const CHUNK_MS = 200, FRAME_MS = 1000 / 30, MAX_QUEUE = 12, SILENT_PEAK = 0.001;

export class Wav2ArkitLipsync {
  constructor(ctx, { gain = 10, ceiling = 0.5, onStatus = () => {} } = {}) {
    Object.assign(this, { ctx, gain, ceiling, onStatus, worker: null, state: 'idle', progress: 0, analyser: null, buffer: null,
      timer: 0, busy: false, pending: null, queue: [], current: null, lastShown: 0, lastArrival: 0, silent: 0, runs: 0, avgMs: 0, id: 0 });
  }

  get ready() { return this.state === 'ready'; }
  // How far the mouth trails the sound: the window being listened to, plus the time to run it, plus a frame.
  get latencyMs() { return CHUNK_MS + (this.avgMs || 150) + FRAME_MS; }
  status() {
    return { idle: 'approximate', loading: `model loading ${Math.round(this.progress * 100)}%`, ready: `model on ${this.device ?? 'device'} (${Math.round(this.avgMs)} ms)`,
      slow: 'approximate (this device is too slow for the model)', error: 'approximate (model failed to load)' }[this.state];
  }
  set(state) { this.state = state; this.onStatus(this.status()); }

  load() {
    if (this.worker) return;
    this.set('loading');
    this.worker = new Worker(new URL('./w2a-worker.js', import.meta.url), { type: 'module' });
    this.worker.onerror = e => { console.error('lip-sync model worker', e.message); this.set('error'); };
    this.worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') { this.progress = m.value; this.onStatus(this.status()); }
      if (m.type === 'ready') { this.device = m.device; this.set('ready'); }
      if (m.type === 'error') { console.error('lip-sync model', m.message); if (this.state !== 'ready') this.set('error'); this.busy = false; }
      if (m.type === 'stored') this.stored = { ...(this.stored ?? {}), [m.name]: m.error ?? m.bytes };
      if (m.type === 'frames') this.receive(m);
    };
    this.worker.postMessage({ type: 'load' });
  }

  attach(sourceNode) {
    this.detach();
    const chunk = Math.round(CHUNK_MS / 1000 * this.ctx.sampleRate);
    let fft = 32; while (fft < chunk) fft *= 2;
    this.analyser = new AnalyserNode(this.ctx, { fftSize: fft });
    this.buffer = new Float32Array(fft); this.chunk = chunk; this.node = sourceNode;
    sourceNode.connect(this.analyser);
    this.timer = setInterval(() => this.capture(), CHUNK_MS);
  }

  detach() {
    clearInterval(this.timer); this.timer = 0;
    try { this.node?.disconnect(this.analyser); } catch { /* already gone */ }
    this.analyser = this.node = null; this.clear();
  }

  clear() { this.queue = []; this.current = null; this.pending = null; this.silent = 0; }

  capture() {
    if (!this.analyser || !this.ready) return;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const raw = this.buffer.subarray(this.buffer.length - this.chunk);
    let peak = 0; for (const x of raw) { const a = Math.abs(x); if (a > peak) peak = a; }
    this.silent = peak < SILENT_PEAK ? this.silent + 1 : 0;
    if (this.silent >= 2) { this.pending = null; this.queue.push(null); this.lastArrival = performance.now(); return; }   // real silence: rest the mouth
    // Down to 16 kHz by averaging, which is all the model needs.
    const ratio = this.ctx.sampleRate / 16000, out = new Float32Array(Math.floor(raw.length / ratio));
    for (let i = 0; i < out.length; i++) { let s = 0, n = 0; for (let j = Math.floor(i * ratio); j < Math.floor((i + 1) * ratio); j++) { s += raw[j]; n++; } out[i] = n ? s / n : 0; }
    this.pending = out;                                       // always the freshest window; never a backlog
    this.pump();
  }

  pump() {
    if (this.busy || !this.pending) return;
    const audio = this.pending; this.pending = null; this.busy = true;
    this.worker.postMessage({ type: 'run', id: ++this.id, audio }, [audio.buffer]);
  }

  receive({ count, data, ms }) {
    this.busy = false; this.runs++;
    this.avgMs = this.avgMs ? this.avgMs * 0.8 + ms * 0.2 : ms;
    // Slower than real time (a 200 ms window must take well under 200 ms) means the mouth would fall behind for good.
    if (this.runs >= 6 && this.avgMs > CHUNK_MS * 0.9) { this.set('slow'); this.clear(); return; }
    if (this.runs % 5 === 0) this.onStatus(this.status());
    for (let f = 0; f < count; f++) {
      const frame = {};
      for (const [name, i] of USED) {
        let v = data[f * NAMES.length + i];
        if (!(v > 0)) continue;
        if (BOOSTED.has(name)) v = this.ceiling * (CEILING_SCALE[name] ?? 1) * (1 - Math.exp(-this.gain * v));
        if (v > 0.01) frame[name] = Math.min(1, v);
      }
      this.queue.push(frame);
    }
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.lastArrival = performance.now();
    this.pump();
  }

  // The face frame to show now, or null when the model has nothing current (the caller then uses its fallback).
  frame(now = performance.now()) {
    if (!this.ready) return null;
    // Frames are due one every 1/30 s of real time, however often this is called:
    // elapsed time is banked and spent a frame at a time, so none are left to pile up.
    this.bank = Math.min(8 * FRAME_MS, (this.bank ?? 0) + (this.lastShown ? now - this.lastShown : FRAME_MS)); this.lastShown = now;
    while (this.queue.length && this.bank >= FRAME_MS) { this.current = this.queue.shift() ?? {}; this.bank -= FRAME_MS; }
    if (!this.queue.length) this.bank = Math.min(this.bank, FRAME_MS);
    if (now - this.lastArrival > 450 && !this.queue.length) this.current = null;   // stale: stop holding an old shape
    return this.current;
  }
}
