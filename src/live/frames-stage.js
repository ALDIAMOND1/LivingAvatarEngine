// Nia from her real frames. Her face is her own portrait, and her mouth is one of
// fifteen real pictures of her making each speech shape (characters/nia/assets/frames,
// built by tools/frames/build_frames.py). As she speaks, the sound is classified
// into mouth-shape classes many times a second and the matching real pictures are
// blended in, sixty times a second. Nothing is drawn or guessed, and everything
// runs in the browser on an ordinary computer: no graphics card, no helper program.
//
// Same interface as the other stages.
import { lipsync } from './config.js';
import { LevelMeter } from './audio-meter.js';

const SPEECH_HANGOVER_MS = 350;
// Which of her pictures each sound class shows, and how strongly. Left: the sound
// classes the classifier reports (Oculus set). Right: her picture(s).
const SOUND_TO_SHAPE = {
  PP: { MB: 1 },                 // m b p: lips together
  FF: { F: 0.6, V: 0.4 },        // f v: teeth on lower lip
  TH: { T: 1 },                  // th: tongue toward the teeth
  DD: { T: 0.9 },                // t d
  nn: { T: 0.8 },                // n l
  kk: { H: 0.75 },               // k g: open, back of the mouth
  CH: { S: 0.8, U: 0.2 },        // ch j sh
  SS: { S: 1 },                  // s z: teeth together
  RR: { U: 0.55, H: 0.25 },      // r
  aa: { A: 0.6, H: 0.4 },        // ah: open (her full "A" picture is shout-sized, so it is mixed with the half-open one)
  E: { H: 0.6, E: 0.3 },         // eh: half open, slightly spread
  I: { E: 0.5, S: 0.4 },         // ee: spread, teeth close together
  O: { O: 1 },                   // oh: rounded
  U: { U: 1 },                   // oo: pursed
};
const FEELING_SHAPE = { happy: 'smile', amused: 'smile', warm: 'smile', laugh: 'laugh', grin: 'grin' };

export class FramesStage extends EventTarget {
  constructor(container, character) {
    super();
    Object.assign(this, { container, character, ready: false, canvas: null, g: null, atlas: null, base: null, shapes: {},
      audioCtx: null, headaudio: null, source: null, keepAlive: null, speaking: false, hangover: 0, visemes: {}, mutedUntil: 0,
      weights: {}, agentMeter: null, userMeter: null, onFrame: null, pose: null, lastTick: 0, gain: character.avatar?.mouthGain ?? 1.6,
      lipsyncStatus: 'real frames (loading)', shown: 'neutral' });
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async load() {
    const dir = this.character.avatar.frames;
    const image = async file => createImageBitmap(await (await fetch(`${dir}/${file}`)).blob());
    this.atlas = await (await fetch(`${dir}/atlas.json`)).json();
    this.base = await image('base.jpg');
    await Promise.all(Object.entries(this.atlas.shapes).map(async ([name, s]) => { this.shapes[name] = await image(s.file); }));
    this.canvas = Object.assign(document.createElement('canvas'), { className: 'face-video', width: this.atlas.width, height: this.atlas.height });
    this.g = this.canvas.getContext('2d'); this.g.imageSmoothingQuality = 'high';
    this.container.append(this.canvas);

    const ctx = this.audioCtx = new AudioContext();
    const { HeadAudio } = await import(lipsync.module);
    await ctx.audioWorklet.addModule(lipsync.worklet);
    const ha = this.headaudio = new HeadAudio(ctx, { visemeMinMs: 60 });
    await ha.loadModel(lipsync.model);
    // Her voice goes to the classifier at once and to the speakers a moment later, so the picture and the sound land together.
    this.speechBus = new GainNode(ctx);
    this.delay = new DelayNode(ctx, { delayTime: lipsync.playbackDelaySec, maxDelayTime: 2 });
    this.speechBus.connect(this.delay).connect(ctx.destination);
    ha.onvalue = (key, value) => { this.visemes[key.replace('viseme_', '')] = value; };
    ha.onstarted = () => { if (performance.now() < this.mutedUntil) return; clearTimeout(this.hangover); this.setSpeaking(true); };
    ha.onended = () => { clearTimeout(this.hangover); this.hangover = setTimeout(() => this.setSpeaking(false), SPEECH_HANGOVER_MS); };

    const tick = now => {
      if (!this.canvas) return;
      const dt = this.lastTick ? Math.min(100, now - this.lastTick) : 16; this.lastTick = now;
      ha.update(dt); this.onFrame?.(dt); this.draw(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.lipsyncStatus = 'real frames'; this.ready = true;
  }

  // How much of each of her pictures should show right now.
  targets() {
    const t = {};
    if (this.speaking && performance.now() >= this.mutedUntil) {
      for (const [sound, v] of Object.entries(this.visemes)) {
        const map = SOUND_TO_SHAPE[sound]; if (!map || v < 0.03) continue;
        for (const [shape, share] of Object.entries(map)) t[shape] = (t[shape] ?? 0) + v * share * this.gain;
      }
      // Lips-together sounds must fully close, however loud the vowel around them.
      if ((t.MB ?? 0) > 0.45) for (const k of Object.keys(t)) if (k !== 'MB') t[k] *= 0.25;
    } else {
      const mood = FEELING_SHAPE[this.pose?.mood]; const smile = this.pose?.face?.smile ?? 0;
      if (mood) t[mood] = Math.min(1, 0.35 + smile); else if (smile > 0.25) t.smile = Math.min(1, smile);
    }
    // Keep the two strongest; more than two real pictures blended at once turns to mush.
    const top = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 2);
    const sum = top.reduce((s, [, v]) => s + v, 0), scale = sum > 1 ? 1 / sum : 1;
    return Object.fromEntries(top.map(([k, v]) => [k, v * scale]));
  }

  draw(dt) {
    const target = this.targets(), w = this.weights;
    for (const name of new Set([...Object.keys(w), ...Object.keys(target)])) {
      const goal = target[name] ?? 0, cur = w[name] ?? 0;
      // Shapes arrive quickly and leave a little more slowly, which is how real mouths overlap one sound into the next.
      const tau = goal > cur ? (name === 'MB' ? 22 : 38) : 62;
      const next = cur + (goal - cur) * (1 - Math.exp(-dt / tau));
      if (next < 0.004 && goal === 0) delete w[name]; else w[name] = next;
    }
    const g = this.g, { width: W, height: H, box } = this.atlas;
    // A little life from the behaviour engine: the whole portrait sways, tilts and breathes with her pose.
    const head = this.pose?.head ?? { pitch: 0, yaw: 0, roll: 0 }, breath = this.pose?.body?.breath ?? 0;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#f7f7f6'; g.fillRect(0, 0, W, H);
    g.translate(W / 2 + head.yaw * W * 0.10, H * 0.62 + head.pitch * H * 0.06 - breath * 1.2);
    g.rotate(head.roll * 0.7); g.scale(1.05 + breath * 0.004, 1.05 + breath * 0.004); g.translate(-W / 2, -H * 0.62);
    g.drawImage(this.base, 0, 0);
    const live = Object.entries(w).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1]);
    let covered = 0;
    for (const [name, v] of live) {                         // weighted mix of her pictures over her resting mouth
      covered += v; g.globalAlpha = Math.min(1, v / covered);
      g.drawImage(this.shapes[name], box[0], box[1]);
    }
    g.globalAlpha = 1; this.shown = live[0]?.[0] ?? 'neutral';
  }

  setSpeaking(on) { if (this.speaking !== on) { this.speaking = on; this.emit(on ? 'speech-start' : 'speech-end'); } }

  interrupt() {
    this.mutedUntil = performance.now() + 450;
    const t = this.audioCtx.currentTime, gain = this.speechBus.gain;
    gain.cancelScheduledValues(t); gain.setTargetAtTime(0, t, 0.012); gain.setTargetAtTime(1, t + 0.45, 0.02);
    clearTimeout(this.hangover); this.visemes = {}; this.setSpeaking(false);
  }

  async wake() { if (this.audioCtx.state !== 'running') await this.audioCtx.resume(); }

  attachStream(stream, { monitor = true } = {}) {
    this.detachStream();
    // Chrome only feeds a remote WebRTC stream into Web Audio once a media element also consumes it.
    this.keepAlive = new Audio(); this.keepAlive.muted = true; this.keepAlive.srcObject = stream;
    this.keepAlive.play?.().catch(() => {});
    this.source = this.audioCtx.createMediaStreamSource(stream);
    this.source.connect(this.headaudio);
    if (monitor) this.source.connect(this.speechBus);
    this.agentMeter = new LevelMeter(this.audioCtx, this.source);
  }

  detachStream() {
    this.agentMeter = null;
    if (this.speechBus) { const t = this.audioCtx.currentTime, gain = this.speechBus.gain; gain.cancelScheduledValues(t); gain.setTargetAtTime(0, t, 0.01); gain.setTargetAtTime(1, t + 0.6, 0.02); }
    try { this.source?.disconnect(); } catch { /* not connected */ }
    this.source = null;
    if (this.keepAlive) { this.keepAlive.srcObject = null; this.keepAlive = null; }
    clearTimeout(this.hangover); this.visemes = {}; this.setSpeaking(false);
  }

  attachUserStream(stream) {
    this.detachUserStream();
    this.userSource = this.audioCtx.createMediaStreamSource(stream);
    this.userMeter = new LevelMeter(this.audioCtx, this.userSource);
  }
  detachUserStream() { this.userMeter?.close?.(); this.userMeter = null; this.userSource = null; }

  agentLevel() { return this.agentMeter ? this.agentMeter.read() : 0; }
  userLevel() { return this.userMeter ? this.userMeter.read() : 0; }
  applyPose(pose) { this.pose = pose?.head ? pose : null; }
  setState() {}

  strongestViseme() {
    let best = 'sil', max = 0;
    for (const [k, v] of Object.entries(this.visemes)) if (k !== 'sil' && v > max) { max = v; best = k; }
    return { name: best, value: max };
  }

  snapshot(width = 240) {
    const out = Object.assign(document.createElement('canvas'), { width, height: Math.round(width * this.canvas.height / this.canvas.width) });
    out.getContext('2d').drawImage(this.canvas, 0, 0, out.width, out.height);
    return out;
  }
}
