// The 3D head with a real-video mouth.
//
// Everything the 3D head already did well stays exactly as it was: the same
// renderer, the same behaviour engine driving her head, eyes, brows, shoulders
// and breathing. Only her mouth changes. The drawn mouth shapes are switched
// off, and while she speaks the mouth produced by her trained video model
// (tools/face-service/nia_service.py, "patch" mode) is laid over her lips. The
// patch is pinned to the head's own lip and chin points every frame, so it
// turns, tilts and nods with her.
//
// As in the video stage, her voice is played a little late so each mouth
// picture is shown at the moment its sound is heard.
import { SplatStage } from './splat-stage.js';
import { LevelMeter } from './audio-meter.js';

const SERVICE = 'ws://127.0.0.1:8768';
const RATE = 16000, CHUNK = 1600;
const SPEECH_HANGOVER_MS = 450;
const REST_DOWN_OVER_ACROSS = 0.552;          // (upper lip -> chin) / (lip corner -> lip corner) on this head, facing the viewer
// How the patch sits on the 3D face; tuned by eye against the rendered head.
const FIT = { width: 0.92, height: 0.92, up: 0.06, right: 0, feather: 0.34, tone: 'none' };   // up/right are fractions of the mouth's width

export class HybridStage extends SplatStage {
  constructor(container, character) {
    super(container, character);
    Object.assign(this, { externalMouth: true, ws: null, info: null, capCtx: null, queue: [], sent: 0, anchor: null,
      voiceDelay: 0.95, slackMin: Infinity, slackAt: 0, lastSpeechFrame: 0, pending: new Int16Array(CHUNK), fill: 0,
      patch: null, patchAlpha: 0, overlay: null, og: null, fit: { ...FIT, ...(character.avatar?.mouthFit ?? {}) }, probe: null });
  }

  async load(onProgress) {
    await super.load(onProgress);
    this.ready = false;                                   // not until the mouth path has been timed
    this.overlay = Object.assign(document.createElement('canvas'), { className: 'mouth-overlay' });
    this.og = this.overlay.getContext('2d');
    this.container.append(this.overlay);
    await this.connect();
    this.voiceDelay = (this.info.latency ?? 0.8) + 0.2;
    this.capCtx = new AudioContext({ sampleRate: RATE });
    await this.capCtx.audioWorklet.addModule('./src/live/pcm-worklet.js');
    this.tap = new AudioWorkletNode(this.capCtx, 'pcm-tap', { numberOfOutputs: 1 });
    this.tap.connect(new GainNode(this.capCtx, { gain: 0 })).connect(this.capCtx.destination);
    this.tap.port.onmessage = e => this.push(e.data);
    this.standIn = setInterval(() => { if (this.capCtx.state !== 'running') this.push(new Float32Array(CHUNK)); }, 100);
    this.buildMask();
    const paint = now => { if (!this.overlay) return; this.paint(now); requestAnimationFrame(paint); };
    requestAnimationFrame(paint);
    await this.timeMouthPath();
    this.ready = true;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket(SERVICE); ws.binaryType = 'arraybuffer';
      const message = 'The face service is not running. Start the app with START_LIVE.cmd and wait for "face service: listening".';
      const fail = setTimeout(() => reject(new Error(message)), 6000);
      ws.onerror = () => { clearTimeout(fail); reject(new Error(message)); };
      ws.onclose = () => { if (this.ready) { this.lipsyncStatus = 'video mouth (service stopped)'; this.emit('error', { message: 'The face service stopped. Restart START_LIVE.cmd.' }); } };
      ws.onmessage = e => {
        if (typeof e.data === 'string') {
          const m = JSON.parse(e.data);
          if (m.type === 'hello') { this.info = m; ws.send('mode:patch'); clearTimeout(fail); resolve(); }
          return;
        }
        const head = new DataView(e.data, 0, 16), t = head.getFloat64(4, true), flags = head.getUint32(12, true);
        if (t < 0) return;                                 // the service's still picture is not used here
        if (e.data.byteLength <= 16) { this.arrive({ t, flags, bmp: null }); return; }
        createImageBitmap(new Blob([new Uint8Array(e.data, 16)], { type: 'image/jpeg' })).then(bmp => this.arrive({ t, flags, bmp }));
      };
    });
  }

  push(block) {
    for (let i = 0; i < block.length; i++) {
      const v = Math.max(-1, Math.min(1, block[i]));
      this.pending[this.fill++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.fill === CHUNK) {
        if (this.ws?.readyState === 1) this.ws.send(this.pending.slice().buffer);
        this.fill = 0; this.sent += CHUNK;
        const a = performance.now() - this.sent / RATE * 1000;
        this.anchor = this.anchor === null ? a : Math.min(a, this.anchor + 0.5);
      }
    }
  }

  dueAt(frame) { return this.anchor + frame.t * 1000 + this.voiceDelay * 1000; }

  arrive(frame) {
    if (this.anchor === null) { frame.bmp?.close(); return; }
    const now = performance.now(), slack = this.dueAt(frame) - now;
    this.probe?.push(now - (this.anchor + frame.t * 1000));
    this.slackMin = Math.min(this.slackMin, slack);
    if (now - this.slackAt > 600) {
      if (this.slackMin < 30 && this.voiceDelay < 2.4) this.setVoiceDelay(this.voiceDelay + Math.min(0.5, (40 - this.slackMin) / 1000 + 0.1));
      this.slackMin = Infinity; this.slackAt = now;
    }
    this.queue.push(frame);
  }

  // Times the real path once, so her voice can be held back by exactly as long as her mouth pictures take.
  async timeMouthPath() {
    this.lipsyncStatus = 'video mouth (getting her ready)';
    this.probe = []; const until = performance.now() + 2200;
    while (performance.now() < until || this.probe.length < 12) {
      if (performance.now() > until + 6000) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const lag = this.probe.slice(5).sort((a, b) => a - b); this.probe = null;
    const worst = lag.length ? lag[Math.floor(lag.length * 0.95)] / 1000 : 0;
    this.setVoiceDelay(Math.min(2.4, Math.max((this.info.latency ?? 0.8) + 0.2, worst + 0.3)));
    this.lipsyncStatus = `video mouth on 3D head · voice delayed ${this.voiceDelay.toFixed(2)} s`;
  }

  setVoiceDelay(seconds) {
    this.voiceDelay = Math.round(seconds * 100) / 100;
    this.delay?.delayTime.setTargetAtTime(this.voiceDelay, this.audioCtx.currentTime, 0.15);
    if (this.ready) this.lipsyncStatus = `video mouth on 3D head · voice delayed ${this.voiceDelay.toFixed(2)} s`;
  }
  syncDelay() { this.delay?.delayTime.setTargetAtTime(this.voiceDelay, this.audioCtx.currentTime, 0.15); }

  // ---- drawing the mouth onto the head ---------------------------------------

  buildMask() {                                           // soft-edged oval: only lips, teeth and chin come from the patch
    const p = this.info.patch, n = p.size, f = this.fit;
    const cx = (p.cornerA[0] + p.cornerB[0]) / 2, top = (p.noseBase[1] + p.upper[1]) / 2, bottom = Math.min(n - 4, p.chin[1] + 6);
    const rx = Math.abs(p.cornerB[0] - p.cornerA[0]) * 0.78, ry = (bottom - top) / 2, cy = (top + bottom) / 2;
    const m = this.mask = Object.assign(document.createElement('canvas'), { width: n, height: n }), g = m.getContext('2d');
    g.translate(cx, cy); g.scale(rx, ry);
    const grad = g.createRadialGradient(0, 0, 1 - f.feather * 2, 0, 0, 1);
    grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(0, 0, 1, 0, 6.2832); g.fill();
    this.cut = Object.assign(document.createElement('canvas'), { width: n, height: n });
    this.cg = this.cut.getContext('2d');
  }

  // Screen position of one of the head's own points, in overlay pixels.
  where(name, rect, box) {
    const bone = this.bones?.[name]; if (!bone) return null;
    const v = bone.getWorldPosition(new bone.position.constructor()).project(this.renderer.viewer.camera);
    return [(v.x * 0.5 + 0.5) * rect.width + rect.left - box.left, (-v.y * 0.5 + 0.5) * rect.height + rect.top - box.top];
  }

  paint(now) {
    // Take the newest mouth picture whose moment has come.
    let next = null;
    while (this.queue.length && this.dueAt(this.queue[0]) <= now) { next?.bmp?.close(); next = this.queue.shift(); }
    if (next) {
      if (next.bmp && now >= this.mutedUntil) { this.patch?.close(); this.patch = next.bmp; this.patchAt = now; } else next.bmp?.close();
      if (next.flags & 1 && now >= this.mutedUntil) { this.lastSpeechFrame = now; this.setSpeaking(true); }
    }
    if (this.speaking && now - this.lastSpeechFrame > SPEECH_HANGOVER_MS) this.setSpeaking(false);
    // The patch fades in as she starts to speak and out when she stops.
    const fresh = this.patch && now - this.patchAt < 160;
    this.patchAlpha += ((fresh ? 1 : 0) - this.patchAlpha) * (fresh ? 0.45 : 0.2);
    const box = this.container.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
    if (this.overlay.width !== W || this.overlay.height !== H) { this.overlay.width = W; this.overlay.height = H; }
    const g = this.og; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    if (!this.patch || this.patchAlpha < 0.02 || !this.bones) return;
    const rect = this.container.querySelector('canvas:not(.mouth-overlay)').getBoundingClientRect();
    const A = this.where('rLipCorner', rect, box), B = this.where('lLipCorner', rect, box);
    const U = this.where('LipUpperMiddle', rect, box), C = this.where('Chin', rect, box);
    if (!A || !B || !U || !C) return;
    const p = this.info.patch, f = this.fit;
    // Patch axes -> screen axes: across the lips, and from the upper lip down to the chin.
    // Across: lip corner to lip corner. Down: the direction from upper lip to chin, at the same scale as
    // across, shortened or lengthened only as far as the head's own proportions change when she nods.
    const pw = p.cornerB[0] - p.cornerA[0];
    const lenX = Math.hypot(B[0] - A[0], B[1] - A[1]), lenY = Math.hypot(C[0] - U[0], C[1] - U[1]);
    const k = lenX / pw * f.width, nod = (lenY / lenX) / REST_DOWN_OVER_ACROSS;
    const ex = [(B[0] - A[0]) / lenX * k, (B[1] - A[1]) / lenX * k];
    const ey = [(C[0] - U[0]) / lenY * k * nod * f.height, (C[1] - U[1]) / lenY * k * nod * f.height];
    const pcx = (p.cornerA[0] + p.cornerB[0]) / 2, pcy = (p.cornerA[1] + p.cornerB[1]) / 2;
    const sx = (A[0] + B[0]) / 2 + f.right * lenX - ey[0] / Math.hypot(ey[0], ey[1]) * f.up * lenX, sy = (A[1] + B[1]) / 2 - ey[1] / Math.hypot(ey[0], ey[1]) * f.up * lenX;
    this.cg.globalCompositeOperation = 'copy'; this.cg.filter = f.tone; this.cg.drawImage(this.patch, 0, 0, p.size, p.size);
    this.cg.filter = 'none'; this.cg.globalCompositeOperation = 'destination-in'; this.cg.drawImage(this.mask, 0, 0);
    g.setTransform(ex[0] * dpr, ex[1] * dpr, ey[0] * dpr, ey[1] * dpr, (sx - ex[0] * pcx - ey[0] * pcy) * dpr, (sy - ex[1] * pcx - ey[1] * pcy) * dpr);
    g.globalAlpha = this.patchAlpha; g.drawImage(this.cut, 0, 0); g.globalAlpha = 1;
  }

  // ---- audio -------------------------------------------------------------------

  async wake() { await super.wake(); if (this.capCtx.state !== 'running') await this.capCtx.resume(); }

  attachStream(stream, { monitor = true } = {}) {
    this.detachStream();
    this.keepAlive = new Audio(); this.keepAlive.muted = true; this.keepAlive.srcObject = stream;
    this.keepAlive.play?.().catch(() => {});
    this.source = this.audioCtx.createMediaStreamSource(stream);
    if (monitor) this.source.connect(this.speechBus);       // not to the drawn-mouth lip-sync: the video mouth replaces it
    this.syncDelay();
    this.capSource = this.capCtx.createMediaStreamSource(stream); this.capSource.connect(this.tap);
    this.agentMeter = new LevelMeter(this.audioCtx, this.source);
  }

  detachStream() {
    const had = !!this.source;
    try { this.capSource?.disconnect(); } catch { /* not connected */ }
    this.capSource = null;
    super.detachStream();
    if (had) this.dropMouth();
  }

  dropMouth() {
    if (this.ws?.readyState === 1) this.ws.send('reset');
    for (const f of this.queue) f.bmp?.close();
    this.queue = []; this.patchAt = 0;
  }

  interrupt() {
    super.interrupt();
    this.mutedUntil = performance.now() + this.voiceDelay * 1000 + 300;
    // Her voice still inside the delay line is thrown away by rebuilding it.
    this.speechBus.disconnect(); this.delay.disconnect();
    this.delay = new DelayNode(this.audioCtx, { delayTime: this.voiceDelay, maxDelayTime: 3 });
    this.speechBus.connect(this.delay).connect(this.audioCtx.destination);
    const t = this.audioCtx.currentTime, gain = this.speechBus.gain;
    gain.cancelScheduledValues(t); gain.setTargetAtTime(0, t, 0.012); gain.setTargetAtTime(1, t + this.voiceDelay + 0.3, 0.02);
    this.dropMouth();
  }
}
