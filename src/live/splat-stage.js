// Renderer adapter for the photoreal head: a Gaussian-splat avatar drawn with
// WebGL on the viewer's own device. It does two jobs and nothing else:
//
//   1. Speech articulation. The voice is turned into mouth shapes here and
//      those shapes own the lips while she is audible.
//   2. Mapping. The behaviour engine's renderer-independent pose (head, gaze,
//      lids, brows, mouth corners, shoulders, torso, breath) is translated into
//      the controls this renderer really has: 52 ARKit face weights, a
//      camera-anchored gaze offset, and rotations on named skeleton bones.
//
// It makes no behavioural decisions. Controls the loaded avatar lacks are
// listed in `controls.missing` instead of being silently faked.
import { GaussianSplatRenderer } from '@myned-ai/gsplat-flame-avatar-renderer';
import { lipsync } from './config.js';
import { LevelMeter } from './audio-meter.js';
import { visemesToArkit, smoothFace } from './viseme-arkit.js';
import { Wav2ArkitLipsync } from './wav2arkit-lipsync.js';

const SPEECH_HANGOVER_MS = 600;
const DEFAULT_FRAME = { centerY: 0.46, height: 0.54 }; // where head and shoulders sit in the asset's default view
const REST = { head: { pitch: 0, yaw: 0, roll: 0 }, gaze: { yaw: 0, pitch: 0 }, lids: { blink: 0, squint: 0, wide: 0 },
  face: {}, body: { shrugLeft: 0, shrugRight: 0, lean: 0, turn: 0, tilt: 0, breath: 0 } };
const ARKIT_ZERO = Object.fromEntries(('browDownLeft browDownRight browInnerUp browOuterUpLeft browOuterUpRight cheekPuff cheekSquintLeft '
  + 'cheekSquintRight eyeBlinkLeft eyeBlinkRight eyeLookDownLeft eyeLookDownRight eyeLookInLeft eyeLookInRight eyeLookOutLeft eyeLookOutRight '
  + 'eyeLookUpLeft eyeLookUpRight eyeSquintLeft eyeSquintRight eyeWideLeft eyeWideRight jawForward jawLeft jawOpen jawRight mouthClose '
  + 'mouthDimpleLeft mouthDimpleRight mouthFrownLeft mouthFrownRight mouthFunnel mouthLeft mouthLowerDownLeft mouthLowerDownRight '
  + 'mouthPressLeft mouthPressRight mouthPucker mouthRight mouthRollLower mouthRollUpper mouthShrugLower mouthShrugUpper mouthSmileLeft '
  + 'mouthSmileRight mouthStretchLeft mouthStretchRight mouthUpperUpLeft mouthUpperUpRight noseSneerLeft noseSneerRight tongueOut')
  .split(' ').map(k => [k, 0]));
// Bones this adapter drives, and what each is for.
const BONES = { head: 'head', neck: 'neckUpper', chest: 'chestUpper', torso: 'abdomenUpper', leftCollar: 'lCollar', rightCollar: 'rCollar' };

export class SplatStage extends EventTarget {
  constructor(container, character) {
    super();
    Object.assign(this, { container, character, renderer: null, audioCtx: null, headaudio: null, ready: false,
      source: null, keepAlive: null, speaking: false, hangover: 0, visemes: {}, mutedUntil: 0,
      counts: { values: 0, started: 0, ended: 0 }, agentMeter: null, userMeter: null, userSource: null, onFrame: null,
      state: 'off', pose: REST, bones: null, axes: null, mouth: {}, faceAt: 0, lastTick: 0,
      controls: { face: 'ARKit 52', gaze: 'camera-anchored offset', bones: [], missing: [] } });
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async load(onProgress) {
    this.renderer = await GaussianSplatRenderer.create(this.container, this.character.avatar.url, {
      backgroundColor: this.character.avatar.backgroundColor ?? '0xd9d8d6',
      getChatState: () => 'Idle',
      getExpressionData: () => this.faceFrame(),
      getNeckPose: () => this.bonePose(),
      getGazeOffset: () => ({ yawDeg: this.pose.gaze?.yaw ?? 0, pitchDeg: this.pose.gaze?.pitch ?? 0 }),
      downloadProgress: p => onProgress?.({ lengthComputable: true, loaded: p, total: p <= 1 ? 1 : 100 }),
    });
    this.frameBust();
    // Loop the asset's own idle clip (a seated person's small weight shifts)
    // underneath; everything the behaviour engine asks for is added on top.
    const clips = this.renderer.listClips?.() ?? [];
    const idle = clips.find(c => c.name === this.character.avatar.idleClip) ?? clips.find(c => /idle/i.test(c.name));
    if (idle) this.renderer.playClip(idle.name, true);

    const ctx = this.audioCtx = new AudioContext();
    const { HeadAudio } = await import(lipsync.module);
    await ctx.audioWorklet.addModule(lipsync.worklet);
    const ha = this.headaudio = new HeadAudio(ctx, { visemeMinMs: 100 });
    await ha.loadModel(lipsync.model);
    // Voice goes to the lip-sync directly and to the speakers after a short
    // delay, so the mouth and the sound line up.
    this.speechBus = new GainNode(ctx);
    this.delay = new DelayNode(ctx, { delayTime: lipsync.playbackDelaySec, maxDelayTime: 2 });
    this.speechBus.connect(this.delay).connect(ctx.destination);
    // Preferred mouth driver: a neural audio-to-face model. It loads in the
    // background (a large one-time download); until it is ready, or if this
    // device cannot run it in real time, the sound-class mapping is used.
    this.w2a = new Wav2ArkitLipsync(ctx, { ...(this.character.avatar.mouthModel ?? {}), onStatus: s => { this.lipsyncStatus = s; this.syncDelay(); } });
    this.lipsyncStatus = this.w2a.status();
    // Off unless asked for (live.html?lipsync=model): on a modest graphics card the
    // model competes with the avatar for the GPU, which freezes the picture for a
    // moment when she starts to speak and makes her mouth trail her voice.
    if (this.character.avatar.lipsync === 'model') this.w2a.load();
    ha.onvalue = (key, value) => { this.visemes[key] = value; this.counts.values++; };
    ha.onstarted = () => {
      if (performance.now() < this.mutedUntil) return;   // the tail of audio she was cut off in
      this.counts.started++; clearTimeout(this.hangover); this.setSpeaking(true);
    };
    ha.onended = () => {
      this.counts.ended++; clearTimeout(this.hangover);
      this.hangover = setTimeout(() => this.setSpeaking(false), SPEECH_HANGOVER_MS);
    };

    const tick = now => {
      if (!this.renderer) return;
      const dt = this.lastTick ? now - this.lastTick : 16; this.lastTick = now;
      ha.update(dt); this.onFrame?.(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.ready = true;
  }

  // The asset's own camera leaves a lot of empty space; crop to head and shoulders.
  frameBust() {
    const camera = this.renderer?.viewer?.camera;
    if (!camera?.isPerspectiveCamera) return;
    const frame = this.character.avatar.frame ?? DEFAULT_FRAME;
    const zoom = 1 / frame.height, aspect = camera.aspect;
    camera.setViewOffset(aspect * zoom, zoom, (aspect * zoom - aspect) / 2, frame.centerY * zoom - 0.5, aspect, 1);
  }

  setSpeaking(on) {
    if (this.speaking === on) return;
    this.speaking = on;
    this.emit(on ? 'speech-start' : 'speech-end');
  }

  // She was talked over: the lips stop following speech at once and relax,
  // and the cut-off tail of her audio is not allowed to restart them.
  interrupt() {
    this.mutedUntil = performance.now() + 450;
    // Silence her voice locally as well, without waiting for the provider to
    // cut it: fade out in 40 ms, then reopen once the cut-off tail has passed.
    const t = this.audioCtx.currentTime, g = this.speechBus.gain;
    g.cancelScheduledValues(t); g.setTargetAtTime(0, t, 0.012); g.setTargetAtTime(1, t + 0.45, 0.02);
    clearTimeout(this.hangover); this.visemes = {}; this.w2a?.clear();
    this.setSpeaking(false);
  }

  // Her voice is played slightly late so it lands together with the mouth
  // movement computed from it: longer when the model is driving the mouth.
  syncDelay() {
    if (!this.delay) return;
    const seconds = this.w2a?.ready ? Math.min(1.2, Math.max(0.15, this.w2a.latencyMs / 1000)) : lipsync.playbackDelaySec;
    this.delay.delayTime.setTargetAtTime(seconds, this.audioCtx.currentTime, 0.2);
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
    this.w2a.attach(this.source); this.syncDelay();
    this.agentMeter = new LevelMeter(this.audioCtx, this.source);
  }

  detachStream() {
    this.agentMeter = null; this.w2a?.detach();
    // Whatever of her voice is still inside the playback delay is silenced, so nothing is heard after the call ends.
    if (this.speechBus) { const t = this.audioCtx.currentTime, g = this.speechBus.gain; g.cancelScheduledValues(t); g.setTargetAtTime(0, t, 0.01); g.setTargetAtTime(1, t + 1.6, 0.02); }
    try { this.source?.disconnect(); } catch { /* not connected */ }
    this.source = null;
    if (this.keepAlive) { this.keepAlive.srcObject = null; this.keepAlive = null; }
    clearTimeout(this.hangover);
    this.visemes = {};
    this.setSpeaking(false);
  }

  attachUserStream(stream) {
    this.detachUserStream();
    this.userSource = this.audioCtx.createMediaStreamSource(stream);
    this.userMeter = new LevelMeter(this.audioCtx, this.userSource);
  }
  detachUserStream() { this.userMeter?.close(); this.userMeter = null; this.userSource = null; }

  agentLevel() { return this.agentMeter ? this.agentMeter.read() : 0; }
  userLevel() { return this.userMeter ? this.userMeter.read() : 0; }

  applyPose(pose) { this.pose = pose?.head ? pose : REST; }
  setState(state) { this.state = state; }

  // ---- face: 52 ARKit weights, pulled by the renderer once per drawn frame --

  faceFrame() {
    const now = performance.now(), dt = this.faceAt ? Math.min(100, now - this.faceAt) : 16; this.faceAt = now;
    // Mouth shapes only count while her voice is audible; otherwise the last
    // shape heard would stay frozen on her face when the audio stops.
    const muted = now < this.mutedUntil;
    const modelled = muted ? null : this.w2a?.frame(now);
    let target = modelled;
    if (!target) {
      target = this.speaking ? visemesToArkit(this.visemes, {}, this.character.avatar.mouthGain ?? 1) : {};
      // Loudness adds a little jaw movement so the mouth never sits still while sound is playing.
      if (this.speaking) target.jawOpen = Math.min(0.4, (target.jawOpen ?? 0) + 0.07 * this.agentLevel());
    }
    this.mouthDriver = modelled ? 'model' : 'approximate';
    const f = { ...ARKIT_ZERO, ...smoothFace(this.mouth, target, dt, modelled ? 28 : 55) };
    const add = (key, v) => { if (v > 0.004) f[key] = Math.min(1, (f[key] ?? 0) + v); };
    const { face = {}, lids = {} } = this.pose;
    // "Left" and "Right" are the character's own left and right, as in ARKit.
    add('browInnerUp', (face.browUp ?? 0) * 0.9 + (face.browInnerUp ?? 0) + (face.browLeftUp ?? 0) * 0.3);
    add('browOuterUpLeft', (face.browUp ?? 0) * 0.75 + (face.browLeftUp ?? 0));
    add('browOuterUpRight', (face.browUp ?? 0) * 0.75);
    add('browDownLeft', face.browDown ?? 0);
    add('browDownRight', (face.browDown ?? 0) + (face.browRightDown ?? 0));
    add('mouthSmileLeft', (face.smile ?? 0) + (face.smileSkew ?? 0));
    add('mouthSmileRight', Math.max(0, (face.smile ?? 0) - (face.smileSkew ?? 0) * 0.5));
    add('cheekSquintLeft', face.cheek ?? 0); add('cheekSquintRight', face.cheek ?? 0);
    add('mouthDimpleLeft', face.dimple ?? 0); add('mouthDimpleRight', face.dimple ?? 0);
    add('mouthFrownLeft', face.frown ?? 0); add('mouthFrownRight', face.frown ?? 0);
    add('mouthPressLeft', face.press ?? 0); add('mouthPressRight', face.press ?? 0);
    add('mouthLeft', face.mouthSkew ?? 0);
    add('jawOpen', face.jawDrop ?? 0);
    // A broad smile parts the lips and shows the upper teeth.
    add('mouthUpperUpLeft', (face.teeth ?? 0) * 0.7); add('mouthUpperUpRight', (face.teeth ?? 0) * 0.7);
    add('mouthLowerDownLeft', (face.teeth ?? 0) * 0.35); add('mouthLowerDownRight', (face.teeth ?? 0) * 0.35);
    add('eyeSquintLeft', lids.squint ?? 0); add('eyeSquintRight', lids.squint ?? 0);
    add('eyeWideLeft', lids.wide ?? 0); add('eyeWideRight', lids.wide ?? 0);
    f.eyeBlinkLeft = f.eyeBlinkRight = lids.blink ?? 0;
    return f;
  }

  // ---- skeleton: rotations added on top of the idle clip each frame --------

  // Works out, once, which way each bone has to turn for "chin down", "toward
  // the viewer's right", "shoulder up" and so on, by nudging the bone and
  // seeing where a child moves on screen. Avatars differ; guessing signs would
  // give a shrug that pushes the shoulders down on the next avatar.
  calibrate() {
    const bones = this.renderer?._getOverridableBones?.();
    if (!bones) return false;
    this.bones = bones;
    const cam = this.renderer.viewer.camera, V = bones.head?.position.constructor;
    const present = Object.fromEntries(Object.entries(BONES).map(([role, name]) => [role, bones[name] ?? null]));
    this.controls.bones = Object.entries(present).filter(([, b]) => b).map(([role]) => role);
    this.controls.missing = Object.entries(present).filter(([, b]) => !b).map(([role]) => role);
    const axes = { head: [1, 1, 1], torso: [1, 1, 1], chest: 1, leftCollar: { axis: 2, sign: 1 }, rightCollar: { axis: 2, sign: -1 } };
    try {
      const right = new V(1, 0, 0).applyQuaternion(cam.quaternion), up = new V(0, 1, 0).applyQuaternion(cam.quaternion);
      const toCam = new V(0, 0, 1).applyQuaternion(cam.quaternion);
      const root = this.renderer.viewer.boneRoot;
      const where = b => { root.updateWorldMatrix(true, true); return b.getWorldPosition(new V()); };
      // How far `probe` moves when `bone` is rotated a little about one axis.
      const nudge = (bone, axis, probe) => {
        const saved = bone.quaternion.clone(), before = where(probe);
        const v = [0, 0, 0]; v[axis] = 0.2;
        bone.quaternion.multiply(saved.clone().setFromAxisAngle(new V(...v).normalize(), 0.2));
        const moved = where(probe).sub(before);
        bone.quaternion.copy(saved); root.updateWorldMatrix(true, true);
        return moved;
      };
      const sign = v => (v < 0 ? -1 : 1);
      const nose = bones.Nose ?? bones.CenterBrow ?? bones.lEye, brow = bones.CenterBrow ?? bones.lEye;
      if (present.head && nose && brow) {
        axes.head = [sign(-nudge(present.head, 0, nose).dot(up)),         // +pitch: nose goes down
          sign(nudge(present.head, 1, nose).dot(right)),                  // +yaw: nose goes to the viewer's right
          sign(nudge(present.head, 2, brow).dot(right))];                 // +roll: top of the head goes to the viewer's right
      }
      if (present.torso && present.head) {
        axes.torso = [sign(nudge(present.torso, 0, present.head).dot(toCam)),   // +lean: toward the viewer
          sign(nudge(present.torso, 1, nose ?? present.head).dot(right)),
          sign(nudge(present.torso, 2, present.head).dot(right))];
      }
      if (present.chest && present.leftCollar) axes.chest = sign(nudge(present.chest, 0, present.leftCollar).dot(up));
      for (const [role, tip] of [['leftCollar', 'lShldrBend'], ['rightCollar', 'rShldrBend']]) {
        if (!present[role] || !bones[tip]) continue;
        let best = { axis: 2, lift: 0 };
        for (const axis of [0, 1, 2]) { const lift = nudge(present[role], axis, bones[tip]).dot(up); if (Math.abs(lift) > Math.abs(best.lift)) best = { axis, lift }; }
        axes[role] = { axis: best.axis, sign: sign(best.lift) };          // +shrug: the shoulder goes up
      }
    } catch (err) { console.warn('Bone calibration failed; using default directions', err); }
    this.axes = axes;
    return true;
  }

  bonePose() {
    if (!this.axes && !this.calibrate()) return null;       // rig not ready yet
    const b = this.bones, a = this.axes, { head = REST.head, body = REST.body } = this.pose, out = {};
    const hp = head.pitch * a.head[0], hy = head.yaw * a.head[1], hr = head.roll * a.head[2];
    const share = b[BONES.neck] ? 0.6 : 1;                  // the neck carries part of every head movement
    if (b[BONES.head]) out[BONES.head] = [hp * share, hy * share, hr * share];
    if (b[BONES.neck]) out[BONES.neck] = [hp * 0.4, hy * 0.4, hr * 0.4];
    if (b[BONES.torso]) out[BONES.torso] = [body.lean * a.torso[0], body.turn * a.torso[1], body.tilt * a.torso[2]];
    const breath = body.breath ?? 0;
    if (b[BONES.chest]) out[BONES.chest] = [0.010 * breath * a.chest, 0, 0];
    for (const [role, shrug] of [['leftCollar', body.shrugLeft], ['rightCollar', body.shrugRight]]) {
      if (!b[BONES[role]]) continue;
      const v = [0, 0, 0];
      v[a[role].axis] = a[role].sign * (0.012 * breath + 0.14 * (shrug ?? 0));   // shoulders rise a little with each breath, and a lot in a shrug
      out[BONES[role]] = v;
    }
    return this.guardAccumulation(out);
  }

  // The renderer applies each rotation as "bone = bone x delta" every frame and
  // relies on its animation clip to put the bone back first. A bone the clip
  // does not animate is never put back, so the delta would pile up frame after
  // frame and the bone would spin. Here each driven bone is returned to its own
  // base whenever nothing else has moved it since our last delta.
  guardAccumulation(out) {
    const memo = this.boneMemo ??= {};
    for (const [name, v] of Object.entries(out)) {
      const bone = this.bones[name], q = bone.quaternion;
      const rec = memo[name] ??= { base: q.clone(), result: null };
      if (rec.result && q.angleTo(rec.result) < 1e-5) q.copy(rec.base);   // untouched since last frame: undo our delta
      rec.base.copy(q);
      const E = bone.rotation.constructor;
      rec.result = (rec.result ?? q.clone()).copy(q).multiply(q.clone().setFromEuler(new E(v[0], v[1], v[2], 'YXZ')));
    }
    return out;
  }

  strongestViseme() {
    let best = 'viseme_sil', max = 0;
    for (const [k, v] of Object.entries(this.visemes)) if (k !== 'viseme_sil' && v > max) { max = v; best = k; }
    return { name: best.replace('viseme_', ''), value: max };
  }

  // Draws the current frame of the avatar into a 2D canvas (for the test lab's contact sheet).
  snapshot(width = 240) {
    const src = this.container.querySelector('canvas');
    const out = Object.assign(document.createElement('canvas'), { width, height: Math.round(width * src.height / src.width) });
    // A WebGL canvas can only be copied in the same task it was drawn in.
    try { this.renderer.viewer.update?.(); this.renderer.viewer.render?.(); } catch { /* fall back to whatever is on the canvas */ }
    out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
    return out;
  }
}
