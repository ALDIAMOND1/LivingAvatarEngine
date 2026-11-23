// Video face drawn by the local face service (tools/face-service): real video
// frames of the avatar with the mouth area repainted to match her voice, made
// on this computer's processor. No graphics card and no outside service.
//
// Her voice is sent to the service as it arrives. The service needs a moment
// to hear a sound before it can draw the mouth for it, so the voice is played
// to the speakers a little late (`delay`) and each frame is shown at the
// moment its sound is heard. The delay grows on its own if this computer is
// slower than expected, so picture and sound stay together.
//
// Same interface as the other stages. The behaviour engine's pose is not used:
// head movement, blinks and breathing come from the avatar's own video.
import { LevelMeter } from './audio-meter.js';

const SERVICE = 'ws://127.0.0.1:8768';
const RATE = 16000, CHUNK = 1600;            // sound goes to the service in 100 ms pieces
const SPEECH_HANGOVER_MS = 450;

export class VideoStage extends EventTarget {
  constructor(container, character) {
    super();
    Object.assign(this, { container, character, ready: false, ws: null, canvas: null, g: null, capCtx: null, playCtx: null,
      queue: [], sent: 0, anchor: null, delay: character.avatar?.delaySec ?? 0.95, slackMin: Infinity, slackAt: 0,
      speaking: false, lastSpeechFrame: 0, mutedUntil: 0, info: null, drawn: 0, shownAt: 0, shownFps: 0,
      pending: new Int16Array(CHUNK), fill: 0, agentMeter: null, userMeter: null, onFrame: null, lastTick: 0,
      lipsyncStatus: 'video mouth (connecting)' });
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async load() {
    this.canvas = Object.assign(document.createElement('canvas'), { className: 'face-video', width: 480, height: 634 });
    this.g = this.canvas.getContext('2d');
    this.container.append(this.canvas);
    await this.connect();
    if (this.info.latency) this.delay = this.info.latency + 0.12;
    // Two audio paths: a 16 kHz one that feeds the service, and a full-quality one for the speakers.
    this.capCtx = new AudioContext({ sampleRate: RATE });
    await this.capCtx.audioWorklet.addModule('./src/live/pcm-worklet.js');
    this.tap = new AudioWorkletNode(this.capCtx, 'pcm-tap', { numberOfOutputs: 1 });
    this.tap.connect(new GainNode(this.capCtx, { gain: 0 })).connect(this.capCtx.destination);
    this.tap.port.onmessage = e => this.push(e.data);
    this.playCtx = new AudioContext();
    this.bus = new GainNode(this.playCtx);
    this.delayNode = new DelayNode(this.playCtx, { delayTime: this.delay, maxDelayTime: 3 });
    this.bus.connect(this.delayNode).connect(this.playCtx.destination);
    // Until the page has been clicked the browser keeps audio paused; a timer
    // stands in for the sound clock so she is already moving while she waits.
    this.standIn = setInterval(() => { if (this.capCtx.state !== 'running') this.push(new Float32Array(CHUNK)); }, 100);
    const tick = now => {
      if (!this.canvas) return;
      const dt = this.lastTick ? now - this.lastTick : 16; this.lastTick = now;
      this.draw(now); this.onFrame?.(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await this.calibrate();
    this.ready = true;
  }

  // Before she is allowed to speak, time the real path once: how long after a
  // moment of sound does its frame arrive on this computer? Her voice is then
  // held back by exactly that (plus a small margin), so the first word and the
  // first lip movement land together instead of the voice running ahead.
  async calibrate() {
    this.lipsyncStatus = 'video mouth (getting her ready)';
    this.probe = []; const until = performance.now() + 2200;
    while (performance.now() < until || this.probe.length < 12) {
      if (performance.now() > until + 6000) break;             // never hang the page on a slow start
      await new Promise(r => setTimeout(r, 100));
    }
    const lag = this.probe.slice(5).sort((a, b) => a - b); this.probe = null;
    const worst = lag.length ? lag[Math.floor(lag.length * 0.95)] / 1000 : 0;
    this.setDelay(Math.min(2.4, Math.max((this.info.latency ?? 0.8) + 0.25, worst + 0.32)));
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket(SERVICE); ws.binaryType = 'arraybuffer';
      const fail = setTimeout(() => reject(new Error('The face service is not running. Start the app with START_LIVE.cmd and wait for "face service: listening".')), 6000);
      ws.onerror = () => { clearTimeout(fail); reject(new Error('The face service is not running. Start the app with START_LIVE.cmd and wait for "face service: listening".')); };
      ws.onclose = () => { if (this.ready) { this.lipsyncStatus = 'video mouth (service stopped)'; this.emit('error', { message: 'The face service stopped. Restart START_LIVE.cmd.' }); } };
      ws.onmessage = e => {
        if (typeof e.data === 'string') {
          const m = JSON.parse(e.data);
          if (m.type === 'hello') { this.info = m; this.canvas.width = m.width; this.canvas.height = m.height; clearTimeout(fail); resolve(); }
          return;
        }
        const head = new DataView(e.data, 0, 16), t = head.getFloat64(4, true), flags = head.getUint32(12, true);
        createImageBitmap(new Blob([new Uint8Array(e.data, 16)], { type: 'image/jpeg' })).then(bmp => this.arrive({ t, flags, bmp }));
      };
    });
  }

  // Sound for the service: collected into 100 ms pieces of 16-bit samples.
  push(block) {
    for (let i = 0; i < block.length; i++) {
      const v = Math.max(-1, Math.min(1, block[i]));
      this.pending[this.fill++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.fill === CHUNK) {
        if (this.ws?.readyState === 1) this.ws.send(this.pending.slice().buffer);
        this.fill = 0; this.sent += CHUNK;
        // Wall-clock time at which sample 0 of the stream was heard, kept steady against timer jitter.
        const a = performance.now() - this.sent / RATE * 1000;
        this.anchor = this.anchor === null ? a : Math.min(a, this.anchor + 0.5);
      }
    }
  }

  dueAt(frame) { return this.anchor + frame.t * 1000 + this.delay * 1000; }

  arrive(frame) {
    if (frame.t < 0 || this.anchor === null) { this.show(frame); return; }
    const now = performance.now(), slack = this.dueAt(frame) - now;
    this.probe?.push(now - (this.anchor + frame.t * 1000));
    // Frames that keep arriving after their moment mean this computer needs a longer head start.
    this.slackMin = Math.min(this.slackMin, slack);
    if (now - this.slackAt > 600) {
      if (this.slackMin < 30 && this.delay < 2.4) this.setDelay(this.delay + Math.min(0.5, (40 - this.slackMin) / 1000 + 0.1));
      this.slackMin = Infinity; this.slackAt = now;
    }
    this.queue.push(frame);
  }

  setDelay(seconds) {
    this.delay = Math.round(seconds * 100) / 100;
    this.delayNode.delayTime.setTargetAtTime(this.delay, this.playCtx.currentTime, 0.15);
  }

  draw(now) {
    let frame = null;
    while (this.queue.length && this.dueAt(this.queue[0]) <= now) { frame?.bmp.close(); frame = this.queue.shift(); }
    if (frame) this.show(frame);
    if (this.speaking && now - this.lastSpeechFrame > SPEECH_HANGOVER_MS) this.setSpeaking(false);
    if (now - this.shownAt >= 1000) {
      this.shownFps = Math.round(this.drawn * 1000 / (now - this.shownAt)); this.drawn = 0; this.shownAt = now;
      if (this.info && this.ws?.readyState === 1) this.lipsyncStatus = `video mouth · ${this.shownFps} frames/s · voice delayed ${this.delay.toFixed(2)} s`;
    }
  }

  show(frame) {
    this.g.drawImage(frame.bmp, 0, 0, this.canvas.width, this.canvas.height); frame.bmp.close(); this.drawn++;
    if (frame.flags & 1 && performance.now() >= this.mutedUntil) { this.lastSpeechFrame = performance.now(); this.setSpeaking(true); }
  }

  setSpeaking(on) { if (this.speaking !== on) { this.speaking = on; this.emit(on ? 'speech-start' : 'speech-end'); } }

  // Talked over: her voice fades at once, frames already drawn for the cut-off
  // words are thrown away, and the service treats what it still holds as silence.
  interrupt() {
    this.mutedUntil = performance.now() + this.delay * 1000 + 300;
    const t = this.playCtx.currentTime, gain = this.bus.gain;
    gain.cancelScheduledValues(t); gain.setTargetAtTime(0, t, 0.012); gain.setTargetAtTime(1, t + this.delay + 0.3, 0.02);
    // The delay line still holds her voice; empty it by rebuilding it.
    this.bus.disconnect(); this.delayNode.disconnect();
    this.delayNode = new DelayNode(this.playCtx, { delayTime: this.delay, maxDelayTime: 3 });
    this.bus.connect(this.delayNode).connect(this.playCtx.destination);
    if (this.ws?.readyState === 1) this.ws.send('reset');
    for (const f of this.queue) if (f.flags & 1) f.flags = 0;
    this.setSpeaking(false);
  }

  async wake() {
    for (const ctx of [this.capCtx, this.playCtx]) if (ctx.state !== 'running') await ctx.resume();
  }

  attachStream(stream, { monitor = true } = {}) {
    this.detachStream();
    // Chrome only feeds a remote WebRTC stream into Web Audio once a media element also consumes it.
    this.keepAlive = new Audio(); this.keepAlive.muted = true; this.keepAlive.srcObject = stream;
    this.keepAlive.play?.().catch(() => {});
    this.capSource = this.capCtx.createMediaStreamSource(stream); this.capSource.connect(this.tap);
    this.playSource = this.playCtx.createMediaStreamSource(stream);
    if (monitor) this.playSource.connect(this.bus);
    this.agentMeter = new LevelMeter(this.playCtx, this.playSource);
  }

  detachStream() {
    if (!this.capSource && !this.playSource) return;
    for (const node of [this.capSource, this.playSource]) { try { node?.disconnect(); } catch { /* not connected */ } }
    this.capSource = this.playSource = null; this.agentMeter = null;
    if (this.keepAlive) { this.keepAlive.srcObject = null; this.keepAlive = null; }
    this.interrupt();                        // nothing of her voice is heard or mouthed after the call ends
  }

  attachUserStream(stream) {
    this.detachUserStream();
    this.userSource = this.playCtx.createMediaStreamSource(stream);
    this.userMeter = new LevelMeter(this.playCtx, this.userSource);
  }
  detachUserStream() { this.userMeter?.close?.(); this.userMeter = null; this.userSource = null; }

  agentLevel() { return this.agentMeter ? this.agentMeter.read() : 0; }
  userLevel() { return this.userMeter ? this.userMeter.read() : 0; }
  applyPose() {} setState() {}
  strongestViseme() { return { name: 'sil', value: 0 }; }

  snapshot(width = 240) {
    const out = Object.assign(document.createElement('canvas'), { width, height: Math.round(width * this.canvas.height / this.canvas.width) });
    out.getContext('2d').drawImage(this.canvas, 0, 0, out.width, out.height);
    return out;
  }
}
