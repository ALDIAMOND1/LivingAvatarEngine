// Behaviour engine: decides, every frame, what Nia's eyes, lids, brows, mouth
// corners, head, shoulders and torso are doing, from what is happening in the
// conversation. It knows nothing about any renderer: its output is a plain
// "pose" of named controls that a renderer adapter maps onto whatever the
// renderer really supports. No model and no GPU; pure arithmetic, unit-tested
// under Node.
//
// Speech articulation (the lips forming sounds) is NOT decided here. It is
// owned by the audio-driven lip-sync in the renderer adapter and always wins
// over anything this engine asks of the mouth.
//
// Layers, lowest priority first. Higher layers take controls away from lower
// ones instead of fighting them:
//   1 idle life      breathing, posture drift, tiny head movement, eye darts, blinks
//   2 emotion        a continuous mix of feelings, each with its own intensity
//   3 state          listening, thinking, speaking postures and their habits
//   4 actions        one-off composed movements (nod, shrug, glance, surprise...)
//   5 speech/interruption rules   mouth handed to lip-sync; speech gestures cancelled on barge-in
//
// Conventions: angles in radians for head and body (positive pitch = chin
// down, positive yaw = toward the viewer's right, positive roll = toward the
// viewer's right); gaze in degrees away from eye contact (positive yaw =
// viewer's right, positive pitch = up); everything else 0..1.

export const TUNING = {
  voiceOn: 0.05, voiceOff: 0.03, gapToleranceMs: 180,
  phraseMinMs: 900, pauseMs: 220, nodMinGapMs: 2200, nodChance: 0.7,
  sustainedNodMs: [3500, 6000], nodAmp: 0.09, nodMs: 750,
  listenRoll: 0.06, listenSmile: 0.08,
  beatRatio: 1.6, beatFloor: 0.03, beatMinGapMs: 450, beatAmp: 0.06, beatMs: 380, beatBrow: 0.45,
  swayYaw: 0.07, swayRoll: 0.06, swayPitch: 0.035,
  emotionHoldMs: 9000, emotionEaseMs: 380,
};

// What each feeling does to the controls at full intensity. `energy` scales
// how lively idle and speech movement are; `transientMs` makes a feeling fade
// by itself (nobody stays surprised).
export const EMOTIONS = {
  neutral: {},
  happy: { smile: 0.8, cheek: 0.8, squint: 0.35, dimple: 0.4, energy: 1.15 },
  sad: { browInnerUp: 0.9, frown: 0.6, droop: 0.08, headPitch: 0.045, lean: -0.01, energy: 0.6 },
  surprised: { browUp: 1, wide: 0.9, jawDrop: 0.38, headPitch: -0.03, lean: -0.02, transientMs: 1400 },
  confused: { browL: 0.5, browDownR: 0.35, headRoll: 0.06, squint: 0.18, press: 0.2 },
  curious: { browUp: 0.3, wide: 0.1, lean: 0.02, headRoll: 0.03 },
  concerned: { browInnerUp: 0.4, browDown: 0.12, squint: 0.08, lean: 0.015, frown: 0.1, energy: 0.8 },
  amused: { smile: 0.55, smileSkew: 0.15, cheek: 0.5, squint: 0.35, dimple: 0.2, energy: 1.1 },
  skeptical: { browL: 0.6, browDownR: 0.2, mouthSkew: 0.25, press: 0.18, headRoll: -0.04 },
  serious: { frown: 0.12, press: 0.15, browDown: 0.15, energy: 0.55 },
  excited: { smile: 0.7, cheek: 0.6, dimple: 0.3, browUp: 0.35, wide: 0.3, energy: 1.5 },
};
// Feelings during which a cheerful reflex (a listening smile, a big grin) would read as mocking.
const SOMBRE = ['sad', 'concerned', 'serious'];

// One-off movements. ch = controls at the peak; a/h/r = attack, hold, release
// in ms; slot = actions in the same slot replace each other instead of adding
// up (two head turns cannot both own the neck); curve = special motion shape.
export const ACTIONS = {
  nod: { ch: { headPitch: 0.09, smile: 0.06 }, a: 0, h: 750, r: 0, curve: 'nod', slot: 'headGesture', cooldown: 500 },
  shake: { ch: { headYaw: 0.085, browDown: 0.1 }, a: 0, h: 1100, r: 0, curve: 'shake', slot: 'headGesture', cooldown: 900 },
  tiltLeft: { ch: { headRoll: -0.1 }, a: 350, h: 900, r: 500, slot: 'headPose' },
  tiltRight: { ch: { headRoll: 0.1 }, a: 350, h: 900, r: 500, slot: 'headPose' },
  turnLeft: { ch: { headYaw: -0.24, turn: -0.04 }, a: 450, h: 1200, r: 650, slot: 'headPose' },
  turnRight: { ch: { headYaw: 0.24, turn: 0.04 }, a: 450, h: 1200, r: 650, slot: 'headPose' },
  headUp: { ch: { headPitch: -0.12 }, a: 400, h: 900, r: 550, slot: 'headPose' },
  headDown: { ch: { headPitch: 0.13 }, a: 400, h: 900, r: 550, slot: 'headPose' },
  lookLeft: { ch: { gazeYaw: -14 }, a: 90, h: 900, r: 160, slot: 'gaze' },
  lookRight: { ch: { gazeYaw: 14 }, a: 90, h: 900, r: 160, slot: 'gaze' },
  lookUp: { ch: { gazePitch: 10, browUp: 0.12 }, a: 90, h: 900, r: 160, slot: 'gaze' },
  lookDown: { ch: { gazePitch: -10, droop: 0.28 }, a: 90, h: 900, r: 160, slot: 'gaze' },
  lookAway: { ch: { gazeYaw: 10, gazePitch: -3 }, a: 100, h: 700, r: 180, slot: 'gaze' },
  eyeContact: { ch: {}, a: 60, h: 1400, r: 200, slot: 'gaze' },          // owns the eyes and holds them on the viewer
  blink: { ch: { blink: 1 }, a: 70, h: 30, r: 95, slot: 'lids' },
  eyesClosed: { ch: { blink: 1 }, a: 120, h: 520, r: 170, slot: 'lids' },
  squint: { ch: { squint: 0.7, browDown: 0.2 }, a: 200, h: 900, r: 300, slot: 'lids' },
  widen: { ch: { wide: 0.8, browUp: 0.3 }, a: 150, h: 700, r: 300, slot: 'lids' },
  browRaise: { ch: { browUp: 0.6 }, a: 200, h: 900, r: 400, slot: 'brows' },
  browFlash: { ch: { browUp: 0.4 }, a: 150, h: 220, r: 350, slot: 'brows', cooldown: 1500 },
  softSmile: { ch: { smile: 0.5, cheek: 0.5, squint: 0.2 }, a: 400, h: 1600, r: 800, slot: 'mouth', cheerful: true },
  // A real smile is cheeks and eyes as much as lips, and it does not open the jaw.
  bigSmile: { ch: { smile: 1, cheek: 1, squint: 0.5, dimple: 0.6 }, a: 350, h: 1400, r: 700, slot: 'mouth', cheerful: true },
  // Best available on this face: the reconstruction shows little of the teeth, so these read as a broad smile with parted lips.
  grin: { ch: { smile: 1, cheek: 1, squint: 0.55, dimple: 0.5, teeth: 0.5, jawDrop: 0.1 }, a: 350, h: 1400, r: 700, slot: 'mouth', cheerful: true },
  laugh: { ch: { smile: 1, cheek: 1, squint: 0.7, dimple: 0.4, teeth: 0.6, jawDrop: 0.32, headPitch: -0.05, shrugL: 0.3, shrugR: 0.3 }, a: 250, h: 900, r: 900, slot: 'mouth', cheerful: true },
  surprise: { ch: { browUp: 1, wide: 1, jawDrop: 0.42, headPitch: -0.035, lean: -0.02 }, a: 140, h: 450, r: 600, slot: 'reaction' },
  shrug: { ch: { shrugL: 1, shrugR: 0.85, browUp: 0.45, press: 0.3, frown: 0.15, headRoll: 0.05 }, a: 260, h: 420, r: 420, slot: 'body' },
  shouldersUp: { ch: { shrugL: 0.7, shrugR: 0.7 }, a: 300, h: 600, r: 500, slot: 'body' },
  shouldersDown: { ch: { shrugL: -0.5, shrugR: -0.5 }, a: 400, h: 900, r: 600, slot: 'body' },
  leanIn: { ch: { lean: 0.035, headPitch: 0.02 }, a: 500, h: 1500, r: 700, slot: 'body' },
  leanBack: { ch: { lean: -0.03, headPitch: -0.015 }, a: 500, h: 1500, r: 700, slot: 'body' },
  // Internal habits, started by the engine itself.
  beat: { ch: { headPitch: 0.06, browUp: 0.45 }, a: 0, h: 380, r: 0, curve: 'pulse', tag: 'speech' },
  inhale: { ch: { breathKick: 1, browUp: 0.12, jawDrop: 0.04 }, a: 120, h: 80, r: 260, tag: 'speech' },
  attend: { ch: { browUp: 0.18, headPitch: -0.012 }, a: 120, h: 300, r: 450, slot: 'reaction' },
};

const CHANNELS = ['headPitch', 'headYaw', 'headRoll', 'gazeYaw', 'gazePitch', 'blink', 'droop', 'squint', 'wide',
  'browUp', 'browDown', 'browInnerUp', 'browL', 'browDownR', 'smile', 'smileSkew', 'cheek', 'frown', 'press', 'jawDrop',
  'mouthSkew', 'teeth', 'dimple', 'shrugL', 'shrugR', 'lean', 'turn', 'tilt', 'breathKick'];
// How fast each group of controls can move. Eyes dart, brows follow, the head
// settles with a hint of overshoot, the body is slow. [omega rad/s, damping]
const DYNAMICS = { gaze: [70, 1], lids: [38, 1], brows: [22, 0.9], mouth: [14, 1], head: [11, 0.78], body: [4.5, 1] };
const GROUP = { headPitch: 'head', headYaw: 'head', headRoll: 'head', gazeYaw: 'gaze', gazePitch: 'gaze', droop: 'lids',
  squint: 'lids', wide: 'lids', browUp: 'brows', browDown: 'brows', browInnerUp: 'brows', browL: 'brows', browDownR: 'brows',
  smile: 'mouth', smileSkew: 'mouth', cheek: 'mouth', frown: 'mouth', press: 'mouth', jawDrop: 'mouth', mouthSkew: 'mouth', teeth: 'mouth', dimple: 'mouth',
  shrugL: 'body', shrugR: 'body', lean: 'body', turn: 'body', tilt: 'body' };
const MOUTH = ['smile', 'smileSkew', 'frown', 'press', 'mouthSkew', 'teeth', 'dimple'];
const LIMIT = { headPitch: 0.22, headYaw: 0.3, headRoll: 0.2, gazeYaw: 18, gazePitch: 12, lean: 0.1, turn: 0.14, tilt: 0.09 };
const BLINK_GAP = { off: [2800, 6000], idle: [2800, 6000], listening: [3500, 7000], thinking: [2500, 5000], speaking: [2000, 4500] };
const EYE_CONTACT = { off: 0.7, idle: 0.7, listening: 0.86, thinking: 0.2, speaking: 0.66 };

const smoothstep = p => p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (current, target, dtMs, tauMs) => current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
const CURVES = {
  nod: p => Math.exp(-2.5 * p) * Math.sin(p * Math.PI * 3),      // down, up, small down, rest
  shake: p => Math.exp(-2 * p) * Math.sin(p * Math.PI * 4),      // side to side, dying away
  pulse: p => Math.sin(p * Math.PI) ** 2,
};

export class BehaviourEngine {
  constructor({ rand = Math.random, tuning = {} } = {}) {
    this.rand = rand; this.k = { ...TUNING, ...tuning };
    this.t = 0; this.state = 'off';
    this.spring = Object.fromEntries(Object.keys(GROUP).map(c => [c, { x: 0, v: 0 }]));
    this.feel = {};                                   // emotion -> { level, target, until }
    this.actions = [];                                // running one-off movements
    this.lastStart = {};                              // action name -> time, for cooldowns
    this.voiced = false; this.phraseMs = 0; this.silenceMs = 0; this.sinceNodInPhrase = 0;
    this.lastNodAt = -1e9; this.nextSustained = this.pick(this.k.sustainedNodMs); this.userSlow = 0;
    this.fast = 0; this.slow = 0; this.lastBeatAt = -1e9; this.speakBlend = 0; this.agentQuietMs = 0; this.agentSpoke = false;
    this.think = { recent: [], variant: null, side: 1 };
    this.blinks = { next: 2200, start: -1, ms: 170, again: false };
    this.eyes = { yaw: 0, pitch: 0, next: 0 };
    this.drift = { next: 0, lean: 0, turn: 0, tilt: 0, shrugL: 0, shrugR: 0 };
    this.breath = 0; this.contactUntil = 0;
    this.counts = { nods: 0, beats: 0, blinks: 0, actions: 0 };
    this.pose = this.assemble(Object.fromEntries(CHANNELS.map(c => [c, 0])), 1);
  }

  pick([a, b]) { return a + (b - a) * this.rand(); }
  mood() {                                            // the strongest feeling right now
    let best = 'neutral', top = 0.12;
    for (const [name, f] of Object.entries(this.feel)) if (f.level > top) { top = f.level; best = name; }
    return best;
  }
  sombre() { return SOMBRE.includes(this.mood()); }

  // ---- inputs from outside -------------------------------------------------

  // Set how she feels. Intensity is continuous; a new feeling fades the others out.
  express(emotion, intensity = 0.7, { holdMs } = {}) {
    if (!(emotion in EMOTIONS)) return false;
    const level = clamp(intensity, 0, 1);
    for (const f of Object.values(this.feel)) f.target = 0;
    if (emotion !== 'neutral' && level > 0) {
      const hold = holdMs ?? EMOTIONS[emotion].transientMs ?? this.k.emotionHoldMs;
      this.feel[emotion] = { level: this.feel[emotion]?.level ?? 0, target: level, until: this.t + hold };
    }
    return true;
  }

  // Start a one-off movement. Returns false when it is unknown, on cooldown, or
  // would be inappropriate (a grin while she is sad for you).
  perform(name, { gain = 1 } = {}) {
    const def = ACTIONS[name];
    if (!def) return false;
    if (def.cheerful && this.sombre()) return false;
    if (this.t - (this.lastStart[name] ?? -1e9) < (def.cooldown ?? 0)) return false;
    if (def.slot) for (const a of this.actions) if (a.def.slot === def.slot) this.release(a);
    this.actions.push({ name, def, start: this.t, gain, end: this.t + def.a + def.h + def.r, releaseAt: this.t + def.a + def.h });
    this.lastStart[name] = this.t; this.counts.actions++;
    if (name === 'nod') { this.counts.nods++; this.lastNodAt = this.t; this.sinceNodInPhrase = 0; this.nextSustained = this.pick(this.k.sustainedNodMs); }
    if (name === 'beat') { this.counts.beats++; this.lastBeatAt = this.t; }
    return true;
  }

  release(action) {                                   // let go early, at its own release speed
    if (action.cut || this.t >= action.end) return;
    const gain = this.gainOf(action);
    Object.assign(action, { cut: true, cutGain: gain, releaseAt: this.t, end: this.t + Math.max(120, action.def.r || 160) });
  }

  // The person started talking over her: drop everything that belonged to her
  // speech, look at them, and listen. Nothing cancelled here comes back.
  interrupt() {
    for (const a of this.actions) if (a.def.tag === 'speech') this.release(a);
    this.lastBeatAt = this.t; this.fast = this.slow = 0;
    this.contactUntil = this.t + 1200;
    this.perform('attend');
  }

  // ---- internals -----------------------------------------------------------

  gainOf(a) {
    const { def } = a, t = this.t - a.start;
    if (a.cut) return a.cutGain * (1 - smoothstep((this.t - a.releaseAt) / (a.end - a.releaseAt)));
    if (def.curve) return CURVES[def.curve](clamp(t / def.h, 0, 1));
    if (t < def.a) return smoothstep(t / def.a);
    if (this.t <= a.releaseAt) return 1;
    return 1 - smoothstep((this.t - a.releaseAt) / Math.max(1, a.end - a.releaseAt));
  }

  enter(state, previous) {
    if (state === 'thinking') {
      const options = [0, 1, 2, 3].filter(i => !this.think.recent.includes(i));
      const i = options[Math.floor(this.rand() * options.length) % options.length];
      this.think.recent = [...this.think.recent, i].slice(-2);
      this.think.side = this.rand() < 0.5 ? -1 : 1; this.think.variant = i;
    }
    if (state === 'listening') { this.voiced = false; this.phraseMs = 0; this.silenceMs = 0; this.sinceNodInPhrase = 0; }
    if (state === 'speaking') {
      this.fast = this.slow = 0; this.agentQuietMs = 0; this.agentSpoke = false;
      this.contactUntil = this.t + 900;                // eyes come back to the person before she starts
      if (previous !== 'speaking') this.perform('inhale');
    }
    if (state === 'off' && previous !== 'off' && this.t > 0) { if (!this.perform('softSmile')) this.perform('attend'); }
  }

  thinkingTargets(s) {
    const side = this.think.side;
    return [
      { gazeYaw: side * 9, gazePitch: 5, headRoll: side * 0.03 },
      { gazeYaw: side * 7, gazePitch: -6, headPitch: 0.02, droop: 0.12 },
      { gazeYaw: side * 11, headYaw: side * 0.05, press: 0.15 },
      { gazePitch: 3, gazeYaw: -side * 4, browUp: 0.2, headRoll: -side * 0.04 },
    ][this.think.variant ?? 0];
  }

  trackListener(dt, level) {
    const k = this.k;
    this.userSlow = ease(this.userSlow, level, dt, 1500);
    const loud = this.voiced ? level > k.voiceOff : level > k.voiceOn;
    if (loud) {
      if (!this.voiced && this.silenceMs > k.gapToleranceMs) { this.phraseMs = 0; this.sinceNodInPhrase = 0; }
      this.voiced = true; this.silenceMs = 0; this.phraseMs += dt; this.sinceNodInPhrase += dt;
      if (this.sinceNodInPhrase >= this.nextSustained && this.t - this.lastNodAt >= k.nodMinGapMs) this.perform('nod', { gain: 0.6 });
      // A sudden rise in their voice gets a flash of interest, not a nod.
      if (level > this.userSlow * 1.9 + 0.12 && this.phraseMs > 600 && this.rand() < 0.02) this.perform('browFlash');
    } else {
      const before = this.silenceMs; this.silenceMs += dt; this.voiced = false;
      const pauseReached = before < k.pauseMs && this.silenceMs >= k.pauseMs;
      if (pauseReached && this.phraseMs >= k.phraseMinMs && this.t - this.lastNodAt >= k.nodMinGapMs && this.rand() < k.nodChance) this.perform('nod');
    }
  }

  trackSpeaker(dt, level) {
    const k = this.k;
    this.fast = ease(this.fast, level, dt, 60); this.slow = ease(this.slow, level, dt, 900);
    if (this.fast > this.slow * k.beatRatio + k.beatFloor && this.t - this.lastBeatAt >= k.beatMinGapMs) this.perform('beat');
    // A gap between phrases: breathe in, and often blink, before the next one.
    if (level > k.voiceOn) {
      if (this.agentSpoke && this.agentQuietMs > 300) { this.perform('inhale'); if (this.rand() < 0.6) this.startBlink(); }
      this.agentQuietMs = 0; this.agentSpoke = true;
    } else this.agentQuietMs += dt;
  }

  startBlink() { if (this.blinks.start < 0) { this.blinks.start = this.t; this.blinks.ms = this.pick([150, 200]); this.blinks.again = this.rand() < 0.12; this.counts.blinks++; } }

  blinkValue(suppressed) {
    const b = this.blinks;
    if (b.start < 0 && this.t >= b.next && !suppressed) this.startBlink();
    if (b.start < 0) return 0;
    const p = (this.t - b.start) / b.ms;
    if (p >= 1) {
      b.start = -1;
      b.next = this.t + (b.again ? 110 : this.pick(BLINK_GAP[this.state] ?? BLINK_GAP.idle));
      b.again = false;
      return 0;
    }
    return Math.sin(p * Math.PI) ** 0.7;
  }

  idleEyes(owned) {
    const e = this.eyes;
    if (this.t >= e.next) {
      const contact = this.t < this.contactUntil ? 1 : (EYE_CONTACT[this.state] ?? 0.7);
      if (this.rand() >= contact) {                   // a glance away
        e.yaw = this.pick([5, 11]) * (this.rand() < 0.5 ? -1 : 1); e.pitch = this.pick([-4, 3]); e.next = this.t + this.pick([500, 1400]);
        if (this.rand() < 0.35) this.startBlink();    // people often blink as their eyes move
      } else {                                        // tiny darts around the viewer's face
        e.yaw = this.pick([-1.2, 1.2]); e.pitch = this.pick([-0.8, 0.8]); e.next = this.t + this.pick([900, 3200]);
      }
    }
    return { yaw: e.yaw * (1 - owned), pitch: e.pitch * (1 - owned) };
  }

  update(dtMs, { state = 'off', userLevel = 0, agentLevel = 0 } = {}) {
    const k = this.k, dt = Number.isFinite(dtMs) ? clamp(dtMs, 0, 1000) : 0;
    if (!Number.isFinite(userLevel)) userLevel = 0;
    if (!Number.isFinite(agentLevel)) agentLevel = 0;
    this.t += dt;
    if (state !== this.state) { const previous = this.state; this.state = state; this.enter(state, previous); }
    if (state === 'listening') this.trackListener(dt, userLevel);
    if (state === 'speaking') this.trackSpeaker(dt, agentLevel);
    const speaking = state === 'speaking';

    // Emotion: every feeling eases toward its target; expired ones fade out.
    const target = Object.fromEntries(Object.keys(GROUP).map(c => [c, 0]));
    let energy = 1;
    for (const [name, f] of Object.entries(this.feel)) {
      if (this.t > f.until) f.target = 0;
      f.level = ease(f.level, f.target, dt, k.emotionEaseMs);
      if (f.level < 0.004 && f.target === 0) { delete this.feel[name]; continue; }
      for (const [c, v] of Object.entries(EMOTIONS[name])) {
        if (c === 'energy') energy += (v - 1) * f.level;
        else if (c in target) target[c] += v * f.level;
      }
    }
    energy = clamp(energy, 0.45, 1.6);
    const sombre = this.sombre();

    // State posture.
    if (state === 'listening') { target.headRoll += k.listenRoll; if (!sombre) target.smile += k.listenSmile + 0.03 * Math.sin(this.t / 2300); }
    if (state === 'thinking') for (const [c, v] of Object.entries(this.thinkingTargets())) target[c] += v;
    this.speakBlend = ease(this.speakBlend, speaking ? 1 : 0, dt, 300);
    target.headYaw += this.speakBlend * energy * (k.swayYaw * Math.sin(this.t / 1700) + 0.5 * k.swayYaw * Math.sin(this.t / 730 + 1));
    target.headRoll += this.speakBlend * energy * k.swayRoll * (0.7 * Math.sin(this.t / 2100 + 2) + 0.3 * Math.sin(this.t / 870));
    target.headPitch += this.speakBlend * energy * k.swayPitch * Math.sin(this.t / 1300 + 0.7);

    // Idle life: slow posture drift, and a head that is never perfectly still.
    const d = this.drift;
    if (this.t >= d.next) {
      const lively = (speaking ? 1.6 : state === 'thinking' ? 0.5 : state === 'listening' ? 0.8 : 1) * energy;
      d.lean = this.pick([-0.025, 0.045]) * lively; d.turn = this.pick([-0.06, 0.06]) * lively; d.tilt = this.pick([-0.035, 0.035]) * lively;
      d.shrugL = this.pick([-0.15, 0.3]) * lively; d.shrugR = this.pick([-0.15, 0.3]) * lively;   // shoulders are never perfectly even
      d.next = this.t + this.pick(speaking ? [1400, 3200] : [4000, 9000]);
    }
    for (const c of ['lean', 'turn', 'tilt', 'shrugL', 'shrugR']) target[c] += d[c];
    const still = state === 'thinking' ? 0.4 : 1;     // she quietens while she thinks
    target.headPitch += still * 0.008 * Math.sin(this.t / 1900) + 0.25 * target.lean;
    target.headYaw += still * 0.012 * Math.sin(this.t / 2700 + 1.3) + 0.5 * d.turn;
    target.headRoll += still * 0.01 * Math.sin(this.t / 3300 + 0.4) + 0.6 * d.tilt;

    // The mouth belongs to speech while she is talking: feelings may only tint it.
    if (speaking) { for (const c of MOUTH) target[c] *= 0.5; target.jawDrop = 0; }

    // Springs: each group of controls moves at its own natural speed.
    const out = Object.fromEntries(CHANNELS.map(c => [c, 0]));
    for (let left = dt; left > 0; left -= 8) {
      const h = Math.min(8, left) / 1000;
      for (const c of Object.keys(GROUP)) {
        const s = this.spring[c], [w, z] = DYNAMICS[GROUP[c]];
        s.v += (w * w * (target[c] - s.x) - 2 * z * w * s.v) * h; s.x += s.v * h;
      }
    }
    for (const c of Object.keys(GROUP)) out[c] = this.spring[c].x;

    // One-off actions ride on top. Gaze actions take the eyes away from idle wandering.
    this.actions = this.actions.filter(a => this.t < a.end);
    let gazeOwned = this.t < this.contactUntil ? 1 : 0;
    for (const a of this.actions) {
      const g = this.gainOf(a) * a.gain;
      if (a.def.slot === 'gaze') gazeOwned = Math.max(gazeOwned, Math.min(1, g));
      for (const [c, v] of Object.entries(a.def.ch)) {
        if (speaking && (MOUTH.includes(c) || c === 'jawDrop') && a.def.tag !== 'speech') out[c] += v * g * 0.5;
        else out[c] += v * g;
      }
    }
    if (state === 'thinking') gazeOwned = Math.max(gazeOwned, 0.85);
    const wander = this.idleEyes(gazeOwned);
    out.gazeYaw += wander.yaw; out.gazePitch += wander.pitch;

    // Lids: no scheduled blink in the first instant of wide-eyed surprise, and
    // eyes that are closed are not also looking around.
    const blink = Math.max(out.blink, this.blinkValue(out.wide > 0.3));
    out.blink = clamp(Math.max(blink, out.droop * 0.6), 0, 1);
    if (out.blink > 0.6) { out.wide *= 1 - out.blink; }

    // Breathing: about 14 breaths a minute at rest, quicker and deeper when speaking or excited.
    this.breath += dt / (speaking ? 3300 : 4300) * Math.PI * 2 * (0.85 + 0.15 * energy);
    const breath = (Math.sin(this.breath) + 0.3 * Math.sin(2 * this.breath + 0.6)) * (speaking ? 1.25 : 1) + 1.4 * out.breathKick;

    return (this.pose = this.assemble(out, breath, energy));
  }

  assemble(c, breath, energy = 1) {
    for (const [name, max] of Object.entries(LIMIT)) c[name] = clamp(c[name], -max, max);
    const w = v => clamp(v, 0, 1);
    const head = { pitch: c.headPitch, yaw: c.headYaw, roll: c.headRoll };
    return {
      head,
      gaze: { yaw: c.gazeYaw, pitch: c.gazePitch },
      lids: { blink: w(c.blink), squint: w(c.squint), wide: w(c.wide) },
      face: { browUp: w(c.browUp), browDown: w(c.browDown), browInnerUp: w(c.browInnerUp), browLeftUp: w(c.browL), browRightDown: w(c.browDownR),
        smile: w(c.smile), smileSkew: w(c.smileSkew), cheek: w(c.cheek), frown: w(c.frown), press: w(c.press), jawDrop: w(c.jawDrop), mouthSkew: w(c.mouthSkew), teeth: w(c.teeth), dimple: w(c.dimple) },
      body: { shrugLeft: clamp(c.shrugL, -1, 1), shrugRight: clamp(c.shrugR, -1, 1), lean: c.lean, turn: c.turn, tilt: c.tilt, breath },
      energy, mood: this.mood(), state: this.state,
      // Kept for renderers that only understand the first version of the pose.
      pitch: head.pitch, yaw: head.yaw, roll: head.roll, brow: w(c.browUp), smile: w(c.smile),
    };
  }
}
