import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviourEngine, EMOTIONS, ACTIONS } from '../src/live/behaviour-engine.js';

const STEP = 1000 / 60;
// Runs the engine for `ms` and records the extremes of every control it produced.
function run(e, ms, state, { user = () => 0, agent = () => 0, each } = {}) {
  const seen = { maxPitch: -1, minPitch: 1, maxYawAbs: 0, maxRollAbs: 0, maxBrow: 0, maxSmile: 0, maxBlink: 0, maxGazeAbs: 0,
    maxShrug: 0, breathMin: 9, breathMax: -9, maxJaw: 0, maxWide: 0, frames: 0 };
  for (let t = 0; t < ms; t += STEP) {
    const p = e.update(STEP, { state, userLevel: user(t), agentLevel: agent(t) });
    seen.maxPitch = Math.max(seen.maxPitch, p.head.pitch); seen.minPitch = Math.min(seen.minPitch, p.head.pitch);
    seen.maxYawAbs = Math.max(seen.maxYawAbs, Math.abs(p.head.yaw)); seen.maxRollAbs = Math.max(seen.maxRollAbs, Math.abs(p.head.roll));
    seen.maxBrow = Math.max(seen.maxBrow, p.face.browUp); seen.maxSmile = Math.max(seen.maxSmile, p.face.smile);
    seen.maxBlink = Math.max(seen.maxBlink, p.lids.blink); seen.maxWide = Math.max(seen.maxWide, p.lids.wide);
    seen.maxGazeAbs = Math.max(seen.maxGazeAbs, Math.abs(p.gaze.yaw), Math.abs(p.gaze.pitch));
    seen.maxShrug = Math.max(seen.maxShrug, p.body.shrugLeft); seen.maxJaw = Math.max(seen.maxJaw, p.face.jawDrop);
    seen.breathMin = Math.min(seen.breathMin, p.body.breath); seen.breathMax = Math.max(seen.breathMax, p.body.breath);
    seen.frames++; each?.(p, t);
  }
  return seen;
}
const engine = () => new BehaviourEngine({ rand: () => 0.5 });
const talkThenPause = (talkMs, period) => t => (t % period) < talkMs ? 0.3 : 0;

// ---- alive while silent ----------------------------------------------------

test('silent and idle: breathes, blinks, shifts, but only subtly', () => {
  const e = new BehaviourEngine();
  const seen = run(e, 60000, 'idle');
  assert.ok(seen.breathMax > 0.8 && seen.breathMin < -0.8, 'breathing never stops');
  assert.ok(e.counts.blinks >= 8 && e.counts.blinks <= 30, `blinks in a minute: ${e.counts.blinks}`);
  assert.ok(seen.maxGazeAbs > 0.5, 'eyes move');
  // Idle movement is deliberately visible (a person sitting on a call shifts by a few degrees) but stays small.
  assert.ok(seen.maxPitch < 0.09 && seen.minPitch > -0.09 && seen.maxYawAbs < 0.09 && seen.maxRollAbs < 0.09, 'head stays within about 5 degrees');
  assert.equal(seen.maxJaw, 0, 'mouth stays shut');
  assert.equal(e.counts.nods, 0);
});

test('blink intervals are irregular', () => {
  const e = new BehaviourEngine(); const times = []; let was = 0;
  run(e, 90000, 'idle', { each: (p, t) => { if (p.lids.blink > 0.5 && was <= 0.5) times.push(t); was = p.lids.blink; } });
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter(g => g > 600);
  assert.ok(gaps.length >= 8);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 1200, 'gaps vary by more than a second');
});

// ---- listening -------------------------------------------------------------

test('listening: nods once at the pause after a phrase', () => {
  const e = engine();
  const seen = run(e, 2500, 'listening', { user: t => t < 1300 ? 0.3 : 0 });
  assert.equal(e.counts.nods, 1);
  assert.ok(seen.maxPitch > 0.03 && seen.minPitch < -0.005, 'dips then rebounds');
});

test('listening: no nod at a short sound or in silence, and short gaps do not end a phrase', () => {
  const e = engine();
  run(e, 3000, 'listening', { user: t => t < 250 ? 0.3 : 0 });
  run(e, 3000, 'listening');
  assert.equal(e.counts.nods, 0);
  const f = engine();
  run(f, 2000, 'listening', { user: talkThenPause(400, 500) });
  assert.equal(f.counts.nods, 0);
  run(f, 600, 'listening');
  assert.equal(f.counts.nods, 1);
});

test('listening: nods are rate limited and never continuous', () => {
  const e = engine();
  run(e, 12000, 'listening', { user: talkThenPause(1000, 1400) });
  assert.ok(e.counts.nods >= 3 && e.counts.nods <= 6, `nods=${e.counts.nods}`);
  const f = engine();
  run(f, 15000, 'listening', { user: () => 0.3 });
  assert.ok(f.counts.nods >= 2 && f.counts.nods <= 4, `nods=${f.counts.nods}`);
});

test('listening: mouth is never driven as if speaking, and she does not smile when the mood is sombre', () => {
  const e = engine();
  const seen = run(e, 4000, 'listening', { user: () => 0.3 });
  assert.equal(seen.maxJaw, 0);
  assert.ok(seen.maxSmile > 0.04, 'a faint attentive smile');
  const f = engine(); f.express('concerned', 0.8);
  run(f, 1500, 'listening');
  assert.ok(f.pose.face.smile < 0.02, 'no smile while concerned');
});

// ---- thinking --------------------------------------------------------------

test('thinking: gaze leaves the person, movement quietens, and it varies between turns', () => {
  const e = new BehaviourEngine(); const variants = new Set(); let previous = null, repeats = 0;
  for (let i = 0; i < 12; i++) {
    const seen = run(e, 700, 'thinking');
    assert.ok(seen.maxGazeAbs > 2.5, 'looks away');
    variants.add(e.think.variant);
    if (e.think.variant === previous) repeats++;
    previous = e.think.variant;
    run(e, 400, 'speaking');
  }
  assert.ok(variants.size >= 3, 'uses several ways of thinking');
  assert.equal(repeats, 0, 'never the same one twice in a row');
});

test('thinking does not always mean looking up', () => {
  const e = new BehaviourEngine(); let up = 0, down = 0;
  for (let i = 0; i < 20; i++) { run(e, 600, 'thinking'); (e.pose.gaze.pitch > 1 ? up++ : e.pose.gaze.pitch < -1 ? down++ : 0); run(e, 300, 'idle'); }
  assert.ok(up > 0 && down > 0 && up < 20);
});

// ---- speaking --------------------------------------------------------------

test('speaking: eyes return to the person as she starts, with a breath in', () => {
  const e = engine();
  run(e, 900, 'thinking');
  assert.ok(Math.abs(e.pose.gaze.yaw) + Math.abs(e.pose.gaze.pitch) > 2.5);
  const breathBefore = e.pose.body.breath;
  let peak = -9;
  run(e, 500, 'speaking', { agent: () => 0.2, each: p => { peak = Math.max(peak, p.body.breath); } });
  assert.ok(Math.abs(e.pose.gaze.yaw) < 2 && Math.abs(e.pose.gaze.pitch) < 2, 'eye contact');
  assert.ok(peak > breathBefore + 0.5, 'visible inhale');
});

test('speaking: stress gives head beats and brow lifts; a flat tone does not', () => {
  const stressed = engine();
  const seen = run(stressed, 5000, 'speaking', { agent: t => (t % 900) < 200 ? 0.5 : 0.12 });
  assert.ok(stressed.counts.beats >= 3, `beats=${stressed.counts.beats}`);
  assert.ok(seen.maxBrow > 0.2);
  const flat = engine();
  run(flat, 800, 'speaking', { agent: () => 0.2 });
  const before = flat.counts.beats;
  run(flat, 4000, 'speaking', { agent: () => 0.2 });
  assert.equal(flat.counts.beats, before);
});

test('speaking: the engine never opens the jaw itself beyond a breath, and feelings only tint the mouth', () => {
  const e = engine(); e.express('happy', 1);
  run(e, 1500, 'idle'); const idleSmile = e.pose.face.smile;
  run(e, 1500, 'speaking', { agent: () => 0.2 });
  assert.ok(e.pose.face.smile < idleSmile * 0.7, 'smile is reduced while lips are articulating');
  const s = engine(); s.express('surprised', 1);
  const seen = run(s, 600, 'speaking', { agent: () => 0.2 });
  assert.ok(seen.maxJaw <= 0.05, 'surprise does not drop the jaw mid-word');
});

// ---- interruption ----------------------------------------------------------

test('interruption: speech gestures stop, she attends, and nothing restarts', () => {
  const e = engine();
  run(e, 3000, 'speaking', { agent: t => (t % 900) < 200 ? 0.5 : 0.12 });
  const beats = e.counts.beats;
  e.interrupt();
  assert.ok(e.actions.every(a => a.def.tag !== 'speech' || a.cut), 'speech gestures are released');
  const seen = run(e, 1500, 'listening', { user: () => 0.3 });
  assert.equal(e.counts.beats, beats, 'no new speech beats while listening');
  assert.ok(seen.maxGazeAbs < 2.5, 'eyes stay on the person');
  assert.equal(seen.maxJaw < 0.05, true);
});

test('rapid repeated interruptions stay bounded', () => {
  const e = new BehaviourEngine();
  for (let i = 0; i < 30; i++) { run(e, 150, 'speaking', { agent: () => Math.random() }); e.interrupt(); run(e, 120, 'listening', { user: () => Math.random() }); }
  assert.ok(e.actions.length < 12, `running actions: ${e.actions.length}`);
  const p = e.pose; assert.ok(Math.abs(p.head.pitch) < 0.22 && Math.abs(p.head.yaw) < 0.3);
});

// ---- emotions --------------------------------------------------------------

test('every emotion changes the face, with continuous intensity, and recovers to neutral', () => {
  for (const name of Object.keys(EMOTIONS).filter(n => n !== 'neutral')) {
    const lo = engine(); lo.express(name, 0.3, { holdMs: 60000 }); run(lo, 1500, 'idle');
    const hi = engine(); hi.express(name, 1, { holdMs: 60000 }); run(hi, 1500, 'idle');
    const size = p => Object.values(p.face).reduce((a, b) => a + b, 0) + p.lids.squint + p.lids.wide + Math.abs(p.head.pitch) * 5 + Math.abs(p.head.roll) * 5;
    assert.ok(size(hi.pose) > 0.15, `${name} is visible`);
    assert.ok(size(hi.pose) > size(lo.pose) * 1.8, `${name} scales with intensity`);
    assert.equal(hi.pose.mood, name);
    hi.express('neutral'); run(hi, 3000, 'idle');
    const faceOnly = p => Object.values(p.face).reduce((a, b) => a + b, 0) + p.lids.squint + p.lids.wide;
    assert.ok(faceOnly(hi.pose) < 0.06, `${name} recovers`);
    assert.equal(hi.pose.mood, 'neutral');
  }
});

test('emotions cross-fade instead of stacking or snapping', () => {
  const e = engine(); e.express('happy', 1); run(e, 1500, 'idle');
  e.express('sad', 1); let maxStep = 0, last = e.pose.face.smile;
  run(e, 2500, 'idle', { each: p => { maxStep = Math.max(maxStep, Math.abs(p.face.smile - last)); last = p.face.smile; } });
  assert.ok(maxStep < 0.03, `largest per-frame change ${maxStep}`);   // a full smile still takes over half a second to fade
  assert.ok(e.pose.face.smile < 0.03 && e.pose.face.browInnerUp > 0.4, 'happy has gone, sad has arrived');
});

test('surprise fades by itself; other feelings expire after their hold', () => {
  const e = engine(); e.express('surprised', 1);
  const seen = run(e, 900, 'idle'); assert.ok(seen.maxWide > 0.4);
  run(e, 3000, 'idle'); assert.ok(e.pose.lids.wide < 0.03);
  const f = engine(); f.express('amused', 0.8, { holdMs: 1000 }); run(f, 800, 'idle'); assert.ok(f.pose.face.smile > 0.15);
  run(f, 3000, 'idle'); assert.ok(f.pose.face.smile < 0.02);
});

test('asymmetric feelings are asymmetric', () => {
  const e = engine(); e.express('skeptical', 1, { holdMs: 60000 }); run(e, 1500, 'idle');
  assert.ok(e.pose.face.browLeftUp > 0.4 && e.pose.face.browRightDown > 0.1 && e.pose.face.mouthSkew > 0.15);
});

// ---- actions ---------------------------------------------------------------

test('every action runs, moves something, and returns to rest', () => {
  for (const name of Object.keys(ACTIONS)) {
    const e = engine(); run(e, 300, 'idle');
    assert.equal(e.perform(name), true, name);
    let moved = 0; const rest = JSON.stringify(e.pose);
    run(e, 400, 'idle', { each: p => { moved = Math.max(moved, Math.abs(p.head.pitch) + Math.abs(p.head.yaw) + Math.abs(p.head.roll) + Math.abs(p.gaze.yaw) / 20 + Math.abs(p.gaze.pitch) / 20
      + p.lids.blink + p.lids.squint + p.lids.wide + p.face.browUp + p.face.smile + Math.abs(p.body.shrugLeft) + Math.abs(p.body.lean) * 10 + Math.abs(p.body.breath) / 10); } });
    assert.ok(moved > 0.05, `${name} moves something`);
    run(e, 4000, 'idle');
    assert.equal(e.actions.length, 0, `${name} finished`);
  }
});

test('eyes can look left and right without the head; the head can turn while eyes stay on the person', () => {
  const e = engine(); run(e, 200, 'idle'); e.perform('lookLeft'); run(e, 500, 'idle');
  assert.ok(e.pose.gaze.yaw < -10 && Math.abs(e.pose.head.yaw) < 0.02);
  const f = engine(); run(f, 200, 'idle'); f.perform('turnRight'); f.perform('eyeContact'); run(f, 900, 'idle');
  assert.ok(f.pose.head.yaw > 0.18 && Math.abs(f.pose.gaze.yaw) < 1.5);
});

test('a shrug is shoulders, brows and mouth together, then recovers', () => {
  const e = engine(); run(e, 300, 'idle'); e.perform('shrug');
  const seen = run(e, 600, 'idle');
  assert.ok(seen.maxShrug > 0.8 && seen.maxBrow > 0.3);
  run(e, 2500, 'idle'); assert.ok(Math.abs(e.pose.body.shrugLeft) < 0.2);
});

test('two head turns do not fight: the newer one takes over', () => {
  const e = engine(); run(e, 200, 'idle'); e.perform('turnLeft'); run(e, 700, 'idle');
  assert.ok(e.pose.head.yaw < -0.18);
  e.perform('turnRight'); run(e, 1000, 'idle');
  assert.ok(e.pose.head.yaw > 0.15, 'now facing the other way');
  assert.ok(Math.abs(e.pose.head.yaw) <= 0.3);
});

test('no scheduled blink in the first instant of surprise, and closed eyes are not wide', () => {
  const e = new BehaviourEngine(); run(e, 500, 'idle'); e.blinks.next = e.t + 150; e.blinks.start = -1;
  e.perform('surprise'); const seen = run(e, 450, 'idle');
  assert.ok(seen.maxWide > 0.5 && seen.maxBlink < 0.2);
  const f = engine(); run(f, 300, 'idle'); f.perform('widen'); f.perform('eyesClosed'); run(f, 300, 'idle');
  assert.ok(f.pose.lids.blink > 0.9 && f.pose.lids.wide < 0.1);
});

test('a cheerful action is refused while the mood is sombre', () => {
  const e = engine(); e.express('sad', 0.9); run(e, 1200, 'idle');
  assert.equal(e.perform('bigSmile'), false);
  assert.equal(e.perform('nod'), true);
});

test('unknown inputs are ignored safely', () => {
  const e = engine();
  assert.equal(e.perform('cartwheel'), false); assert.equal(e.express('hangry', 1), false);
  assert.doesNotThrow(() => { e.update(NaN, {}); e.update(16, { state: 'nonsense', userLevel: NaN, agentLevel: undefined }); e.update(1e9, { state: 'idle' }); });
  const p = e.update(16, { state: 'idle' });
  assert.ok(Number.isFinite(e.t) && Number.isFinite(p.head.pitch) && Number.isFinite(p.body.breath), 'bad input does not poison the state');
});

// ---- bounds, smoothness, slow devices ---------------------------------------

test('everything stays within human limits under random input and random actions', () => {
  const e = new BehaviourEngine(); const names = Object.keys(ACTIONS), moods = Object.keys(EMOTIONS);
  for (const s of ['listening', 'thinking', 'speaking', 'listening', 'idle', 'off']) {
    run(e, 8000, s, { user: () => Math.random(), agent: () => Math.random(), each: (p, t) => {
      if (Math.random() < 0.01) e.perform(names[Math.floor(Math.random() * names.length)]);
      if (Math.random() < 0.003) e.express(moods[Math.floor(Math.random() * moods.length)], Math.random());
      assert.ok(Math.abs(p.head.pitch) <= 0.22 + 1e-9 && Math.abs(p.head.yaw) <= 0.3 + 1e-9 && Math.abs(p.head.roll) <= 0.2 + 1e-9);
      assert.ok(Math.abs(p.gaze.yaw) <= 18 && Math.abs(p.gaze.pitch) <= 12);
      for (const v of [...Object.values(p.face), ...Object.values(p.lids)]) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v));
    } });
  }
});

test('the head never snaps: per-frame change is small even when actions start', () => {
  const e = engine(); let last = null, worst = 0;
  const watch = p => { if (last) worst = Math.max(worst, Math.abs(p.head.yaw - last.yaw), Math.abs(p.head.pitch - last.pitch), Math.abs(p.head.roll - last.roll)); last = { ...p.head }; };
  run(e, 500, 'idle', { each: watch });
  for (const a of ['turnLeft', 'nod', 'tiltRight', 'shake', 'turnRight', 'headUp', 'shrug']) { e.perform(a); run(e, 700, 'idle', { each: watch }); }
  assert.ok(worst < 0.02, `largest per-frame head change ${worst} rad`);
});

test('a slow device (10 frames a second) gets the same behaviour, not a slower one', () => {
  const e = engine();
  for (let t = 0; t < 2500; t += 100) e.update(100, { state: 'listening', userLevel: t < 1300 ? 0.3 : 0 });
  assert.equal(e.counts.nods, 1);
  const f = new BehaviourEngine(); let blinks = 0;
  for (let t = 0; t < 60000; t += 100) f.update(100, { state: 'idle' });
  blinks = f.counts.blinks; assert.ok(blinks >= 8 && blinks <= 30, `blinks=${blinks}`);
});

test('ending a conversation closes with a small warm gesture, then settles', () => {
  const e = engine(); run(e, 2000, 'listening'); const before = e.counts.actions;
  const seen = run(e, 1500, 'off');
  assert.ok(e.counts.actions > before && seen.maxSmile > 0.15);
  run(e, 5000, 'off'); assert.ok(e.pose.face.smile < 0.05);
});
