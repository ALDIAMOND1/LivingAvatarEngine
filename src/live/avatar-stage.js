// 3D avatar whose mouth follows whatever audio stream it is given.
// Rendering and lip-sync both run in the viewer's browser; nothing is rendered
// on a server. TalkingHead draws the rigged head, HeadAudio turns the audio
// into viseme blend-shape values on an audio worklet thread.
import { Euler, Quaternion } from 'three';
import { TalkingHead } from 'talkinghead';
import { lipsync } from './config.js';

const FACE_KEYS = {
  brow: ['browInnerUp', 'browOuterUpLeft', 'browOuterUpRight'],
  smile: ['mouthSmileLeft', 'mouthSmileRight'],
};

// Loudness of an audio node as 0..1 (RMS, scaled so normal speech sits around 0.2-0.5).
class LevelMeter {
  constructor(ctx, node) {
    this.analyser = new AnalyserNode(ctx, { fftSize: 512 });
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.node = node; node.connect(this.analyser);
  }
  read() {
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0; for (const x of this.buffer) sum += x * x;
    return Math.min(1, Math.sqrt(sum / this.buffer.length) * 4);
  }
  close() { try { this.node.disconnect(this.analyser); } catch { /* already gone */ } }
}

const SPEECH_HANGOVER_MS = 600; // bridges the short gaps between words and phrases

export class AvatarStage extends EventTarget {
  constructor(container, character) {
    super();
    Object.assign(this, { container, character, head: null, headaudio: null, source: null, keepAlive: null,
      speaking: false, hangover: 0, visemes: {}, counts: { values: 0, started: 0, ended: 0 },
      agentMeter: null, userMeter: null, userSource: null, onFrame: null,
      euler: new Euler(), quat: new Quaternion() });
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async load(onProgress) {
    const head = this.head = new TalkingHead(this.container, {
      ttsEndpoint: 'N/A',            // speech comes from the voice provider, not TalkingHead's TTS
      lipsyncModules: [],            // text-driven lip-sync is unused; HeadAudio drives the mouth
      cameraRotateEnable: false,
      avatarIdleEyeContact: 0.3,
      avatarListeningEyeContact: 0.8,
      ...this.character.view,
    });
    await head.showAvatar(this.character.avatar, onProgress);

    const { HeadAudio } = await import(lipsync.module);
    await head.audioCtx.audioWorklet.addModule(lipsync.worklet);
    const ha = this.headaudio = new HeadAudio(head.audioCtx, { visemeMinMs: 120 });
    await ha.loadModel(lipsync.model);

    // Lip-sync taps the speech bus; playback of that bus is delayed to match.
    head.audioSpeechGainNode.connect(ha);
    const delay = new DelayNode(head.audioCtx, { delayTime: lipsync.playbackDelaySec });
    head.audioSpeechGainNode.disconnect(head.audioReverbNode);
    head.audioSpeechGainNode.connect(delay);
    delay.connect(head.audioReverbNode);

    ha.onvalue = (key, value) => {
      this.visemes[key] = value; this.counts.values++;
      Object.assign(head.mtAvatar[key], { newvalue: value, needsUpdate: true });
    };
    ha.onstarted = () => { this.counts.started++; clearTimeout(this.hangover); this.setSpeaking(true); };
    ha.onended = () => {
      this.counts.ended++; clearTimeout(this.hangover);
      this.hangover = setTimeout(() => this.setSpeaking(false), SPEECH_HANGOVER_MS);
    };
    // Called by TalkingHead every frame, after it has posed the skeleton and
    // before it draws, so anything applied in onFrame adds to its own animation.
    head.opt.update = dt => { ha.update(dt); this.onFrame?.(dt); };
  }

  // Adds a small rotation to the head on top of the current pose, and sets the
  // brow and smile. TalkingHead rebuilds the pose from scratch each frame, so
  // the rotation never accumulates.
  applyPose({ pitch = 0, yaw = 0, roll = 0, brow = 0, smile = 0 }) {
    const bone = this.head.objectHead;
    if (bone) bone.quaternion.multiply(this.quat.setFromEuler(this.euler.set(pitch, yaw, roll, 'YXZ')));
    for (const [name, value] of [['brow', brow], ['smile', smile]]) {
      for (const key of FACE_KEYS[name]) {
        const target = this.head.mtAvatar[key];
        if (target) Object.assign(target, { realtime: value > 0.01 ? value : null, needsUpdate: true });
      }
    }
  }

  agentLevel() { return this.agentMeter ? this.agentMeter.read() : 0; }
  userLevel() { return this.userMeter ? this.userMeter.read() : 0; }

  // The person's microphone, for listening behaviour only. Never played back.
  attachUserStream(stream) {
    this.detachUserStream();
    this.userSource = this.head.audioCtx.createMediaStreamSource(stream);
    this.userMeter = new LevelMeter(this.head.audioCtx, this.userSource);
  }

  detachUserStream() {
    this.userMeter?.close(); this.userMeter = null; this.userSource = null;
  }

  // Whether the avatar is speaking is decided by the sound itself, not by
  // provider events: the model finishes generating a reply well before the
  // audio of that reply has finished playing.
  setSpeaking(on) {
    if (this.speaking === on) return;
    this.speaking = on;
    this.emit(on ? 'speech-start' : 'speech-end');
  }

  async wake() {
    this.head.start();
    if (this.head.audioCtx.state !== 'running') await this.head.audioCtx.resume();
  }

  // monitor=true plays the voice through the speakers; false only animates.
  attachStream(stream, { monitor = true } = {}) {
    this.detachStream();
    // Chrome only feeds a remote WebRTC stream into Web Audio once a media
    // element is also consuming it.
    this.keepAlive = new Audio(); this.keepAlive.muted = true; this.keepAlive.srcObject = stream;
    this.keepAlive.play?.().catch(() => {});
    this.source = this.head.audioCtx.createMediaStreamSource(stream);
    this.source.connect(monitor ? this.head.audioAnalyzerNode : this.headaudio);
    this.agentMeter = new LevelMeter(this.head.audioCtx, this.source);
  }

  detachStream() {
    this.agentMeter = null;
    try { this.source?.disconnect(); } catch { /* not connected */ }
    this.source = null;
    if (this.keepAlive) { this.keepAlive.srcObject = null; this.keepAlive = null; }
    clearTimeout(this.hangover);
    this.setSpeaking(false);
  }

  // Eye contact while listening or starting to speak. Head and face movement
  // come from the behaviour engine.
  setState(state) {
    if (state === 'listening') { this.head.lookAtCamera(600); this.head.makeEyeContact(4000); }
    if (state === 'speaking') this.head.lookAtCamera(500);
  }

  get ready() { return !!this.headaudio; }

  strongestViseme() {
    let best = 'viseme_sil', max = 0;
    for (const [k, v] of Object.entries(this.visemes)) if (k !== 'viseme_sil' && v > max) { max = v; best = k; }
    return { name: best.replace('viseme_', ''), value: max };
  }
}
