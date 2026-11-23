// Behaviour lab (live.html?lab). It is not a simulation: it runs inside the
// production page and drives the same stage (renderer adapter), behaviour
// engine and conversation state that a live call uses. It only adds ways to
// trigger things by hand, a real-audio speaking test, photographs of every
// state beside its reference picture, and measurements.
import { EMOTIONS, ACTIONS } from './behaviour-engine.js';
import { syntheticVoice } from './voice-provider.js';

const INTERNAL = ['beat', 'inhale', 'attend', 'eyeContact'];
const REF_DIR = './characters/nia/reference/';
// Which of the user's corrected reference pictures shows each state. Anything
// not listed has NO reference picture; it is built from anatomy alone.
export const REFERENCE = {
  rest: '02_neutral_front', turnRight: '03_three_quarter_image_right', turnLeft: '04_side_gaze_image_left',
  bigSmile: '05_big_smile', happy: '05_big_smile', lookUp: '06_eyes_up', lookDown: '07_eyes_down', lookRight: '09_side_gaze_image_right_alternate',
  surprise: '10_surprised_brows_raised', surprised: '10_surprised_brows_raised', shrug: '11_shoulder_shrug', shouldersUp: '11_shoulder_shrug',
  sad: '13_sad', eyesClosed: '14_eyes_closed', blink: '14_eyes_closed', headDown: '15_head_down',
  'turnRight + lookRight': '01_side_gaze_image_right',
};
const SPEECH_NOTE = 'Approximate audio-driven lip-sync: mouth shapes are estimated from the sound itself. It is not phoneme-accurate; the voice provider sends no phoneme timing.';
const wait = ms => new Promise(r => setTimeout(r, ms));
const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

export function mountLab({ stage, behaviour, convo }) {
  const errors = [];
  addEventListener('error', e => errors.push(String(e.message)));
  addEventListener('unhandledrejection', e => errors.push('rejection: ' + String(e.reason?.message ?? e.reason)));
  const origError = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); origError(...a); };

  // Frame timing, measured on the page's own animation frames.
  const frames = []; let lastFrame = 0;
  (function tick(t) { if (lastFrame) { frames.push(t - lastFrame); if (frames.length > 3000) frames.shift(); } lastFrame = t; requestAnimationFrame(tick); })(0);
  const perf = () => {
    const s = [...frames].sort((a, b) => a - b), info = stage.renderer?.viewer?.renderer?.info;
    return { frames: s.length, fps: round(1000 / (s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)), 1), p50ms: round(pct(s, 0.5), 1), p95ms: round(pct(s, 0.95), 1), p99ms: round(pct(s, 0.99), 1),
      worstMs: round(s[s.length - 1] ?? 0, 1), jsHeapMB: performance.memory ? round(performance.memory.usedJSHeapSize / 1048576, 0) : 'not exposed by this browser',
      gpuTextures: info?.memory?.textures ?? 'n/a', gpuMemory: 'not measurable from a web page' };
  };

  const panel = document.createElement('section');
  panel.className = 'lab';
  panel.innerHTML = `<h2>Behaviour lab</h2>
    <p>This drives the real Nia above: same renderer, same face controls, same behaviour engine as a live call.</p>
    <div class="lab-row"><b>Conversation state</b><span id="labStates"></span></div>
    <div class="lab-row"><b>Intensity</b><input id="labGain" type="range" min="0" max="1" step="0.05" value="0.8"><output id="labGainOut">0.80</output>
      <span class="lab-hint">applies to the next feeling or action you trigger</span></div>
    <div class="lab-row"><b>Feelings</b><span id="labFeel"></span></div>
    <div class="lab-row"><b>Actions</b><span id="labAct"></span></div>
    <p class="lab-hint">A dot after a name means one of your reference pictures shows it. No dot: no reference picture exists for it.</p>
    <p class="lab-hint" id="labSpeechNote">${SPEECH_NOTE}</p>
    <div class="lab-row"><button type="button" id="labRun" class="primary">Photograph everything</button><span id="labStatus"></span></div>
    <pre id="labRead"></pre><canvas id="labSheet" hidden></canvas>`;
  document.querySelector('.app').appendChild(panel);
  const q = id => panel.querySelector('#' + id);
  const gain = () => Number(q('labGain').value);
  q('labGain').oninput = () => { q('labGainOut').textContent = gain().toFixed(2); };
  const button = (parent, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; parent.appendChild(b); return b; };
  const dot = name => (REFERENCE[name] ? ' •' : '');

  const lab = new LabDriver({ stage, behaviour, convo });
  for (const [label, fn] of [['Silent / idle', () => lab.idle()], ['Listening', () => lab.listen()], ['Thinking', () => lab.think()],
    ['Speaking (real audio)', () => lab.speak()], ['Interrupt her', () => lab.interrupt()], ['End', () => lab.end()]]) button(q('labStates'), label, fn);
  for (const name of Object.keys(EMOTIONS)) button(q('labFeel'), name + dot(name), () => behaviour.express(name, gain(), { holdMs: 6000 }));
  for (const name of Object.keys(ACTIONS).filter(n => !INTERNAL.includes(n))) button(q('labAct'), name + dot(name), () => behaviour.perform(name, { gain: gain() }));
  q('labRun').onclick = () => runAll({ stage, behaviour, convo, lab, panel, perf, errors });

  setInterval(() => {
    const p = behaviour.pose, f = stage.faceFrame?.() ?? {};
    const live = Object.entries(f).filter(([, v]) => v > 0.03).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ');
    q('labRead').textContent = `state ${convo.state}   feeling ${p.mood}   her voice audible: ${stage.speaking ? 'yes' : 'no'}\n`
      + `head  pitch ${round(p.head.pitch * 57.3, 1)}°  yaw ${round(p.head.yaw * 57.3, 1)}°  roll ${round(p.head.roll * 57.3, 1)}°   eyes  ${round(p.gaze.yaw, 1)}°, ${round(p.gaze.pitch, 1)}°   shoulders ${round(p.body.shrugLeft)} / ${round(p.body.shrugRight)}\n`
      + `face  ${live || '(at rest)'}\n${JSON.stringify(perf())}\nerrors: ${errors.length ? errors.slice(-3).join(' | ') : 'none'}`;
  }, 400);
  window.__LAB = { run: () => runAll({ stage, behaviour, convo, lab, panel, perf, errors }), results: null, lab, perf, errors };
}

// Puts the production conversation state machine through its states by hand.
class LabDriver {
  constructor({ stage, behaviour, convo }) { Object.assign(this, { stage, behaviour, convo, userCtx: null, clip: null }); }
  async begin() { await this.stage.wake(); if (this.convo.state === 'off') this.convo.connected(); }
  stopUser() { if (this.userCtx) { this.userCtx.close().catch(() => {}); this.userCtx = null; this.stage.detachUserStream(); } if (this.convo.userTalking) this.convo.userSpeechStop(); }
  stopClip() { if (this.clip) { this.clip.pause(); this.clip = null; } this.stage.detachStream(); }
  async idle() { await this.begin(); this.stopUser(); this.stopClip(); this.convo.set('idle'); }
  // A stand-in voice plays as the person, so listening behaviour reacts to real sound levels.
  async listen(seconds = 12) {
    await this.begin(); this.stopUser();
    this.userCtx = new AudioContext(); await this.userCtx.resume();
    this.stage.attachUserStream(syntheticVoice(this.userCtx, seconds, () => this.stopUser()));
    this.convo.userSpeechStart();
  }
  async think() { await this.begin(); this.stopUser(); this.convo.set('thinking'); }
  // Real recorded speech through the same path a live call's voice takes.
  async speak() {
    await this.begin(); this.stopUser(); this.stopClip();
    const ctx = this.stage.audioCtx ?? this.stage.head?.audioCtx;
    // Loaded as a typed blob because the local server does not label .mp3 files.
    this.clipUrl ??= URL.createObjectURL(await typedBlob('./characters/nia/assets/audio/lab-speech.mp3', 'audio/mpeg'));
    const audio = this.clip = new Audio(this.clipUrl);
    this.out = ctx.createMediaStreamDestination(); ctx.createMediaElementSource(audio).connect(this.out);
    this.stage.attachStream(this.out.stream, { monitor: true });
    audio.onended = () => { if (this.clip === audio) { this.clip = null; setTimeout(() => this.stage.detachStream(), 800); } };
    await audio.play();
  }
  // What a live call does when the person talks over her: the provider cuts her audio and reports their speech.
  async interrupt() { if (this.clip) { this.clip.pause(); this.clip = null; } this.convo.userSpeechStart(); setTimeout(() => { if (this.convo.userTalking) this.convo.userSpeechStop(); }, 1500); }
  async end() { this.stopUser(); this.stopClip(); this.convo.closed(); }
}

// What reached the renderer for the current frame.
function readback(stage, behaviour, convo) {
  const f = stage.faceFrame(), p = behaviour.pose;
  return {
    state: convo.state, feeling: p.mood, audible: stage.speaking,
    face: Object.fromEntries(Object.entries(f).filter(([, v]) => v > 0.03).map(([k, v]) => [k, round(v)])),
    headDeg: [p.head.pitch, p.head.yaw, p.head.roll].map(r => round(r * 57.3, 1)), gazeDeg: [round(p.gaze.yaw, 1), round(p.gaze.pitch, 1)],
    shrug: [round(p.body.shrugLeft), round(p.body.shrugRight)], leanDeg: round(p.body.lean * 57.3, 1), bonesDriven: Object.keys(stage.bonePose?.() ?? {}).length,
  };
}

const typedBlob = async (url, type) => new Blob([await (await fetch(url)).arrayBuffer()], { type });
const loadImage = async src => {
  try { const url = URL.createObjectURL(await typedBlob(src, 'image/jpeg')); return await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = url; }); }
  catch { return null; }
};

async function runAll({ stage, behaviour, convo, lab, panel, perf, errors }) {
  const status = panel.querySelector('#labStatus'), sheet = panel.querySelector('#labSheet');
  const shots = [], results = [];
  const shoot = (label, group, ref = REFERENCE[label]) => { shots.push({ label, ref, image: stage.snapshot(200) }); results.push({ label, group, reference: ref ?? 'MISSING', ...readback(stage, behaviour, convo) }); };
  const settle = async (ms = 900) => { behaviour.express('neutral'); await wait(ms); };
  const say = t => { status.textContent = t; };

  await lab.idle(); say('rest'); await settle(1200); shoot('rest', 'state');
  // Conversation states, driven through the real state machine.
  say('listening'); await lab.listen(6); await wait(2600); shoot('listening', 'state', null);
  await wait(1600); behaviour.perform('blink'); await wait(85); shoot('blinking while listening', 'combo', null);
  lab.stopUser(); await wait(500); say('thinking'); shoot('thinking', 'state', null);
  say('speaking'); await lab.speak(); await wait(1300); shoot('speaking (real audio)', 'state', null);
  await wait(500); shoot('speaking, a moment later', 'state', null);
  behaviour.express('happy', 0.8, { holdMs: 3000 }); await wait(900); shoot('speaking while smiling', 'combo', null);
  behaviour.perform('blink'); await wait(85); shoot('blinking while speaking', 'combo', null);
  behaviour.perform('shrug'); await wait(420); shoot('shrug while speaking', 'combo', null);
  await wait(900); say('interruption'); const jawBefore = stage.faceFrame().jawOpen;
  await lab.interrupt(); await wait(250); shoot('interrupted mid-sentence (250 ms after)', 'combo', null);
  results[results.length - 1].jawJustBeforeInterrupt = round(jawBefore);
  await wait(1700); shoot('after interruption: listening, mouth at rest', 'state', null);
  await lab.idle(); await settle(1200);

  for (const name of Object.keys(EMOTIONS).filter(n => n !== 'neutral')) {
    say(name); behaviour.express(name, 1, { holdMs: 5000 }); await wait(name === 'surprised' ? 450 : 1100);
    shoot(name, 'feeling'); await settle();
  }
  for (const half of ['happy', 'sad']) { say(half + ' at half'); behaviour.express(half, 0.4, { holdMs: 5000 }); await wait(1100); shoot(half + ' at 0.4 intensity', 'feeling', null); await settle(); }
  for (const name of Object.keys(ACTIONS).filter(n => !INTERNAL.includes(n))) {
    say(name); const d = ACTIONS[name];
    behaviour.perform(name);
    await wait(d.curve === 'nod' ? 170 : d.curve === 'shake' ? 150 : d.a + Math.min(d.h, 500) / 2);
    shoot(name, 'action'); await wait(d.a + d.h + d.r + 350);
  }
  say('combinations');
  behaviour.perform('turnRight'); behaviour.perform('lookRight'); await wait(800); shoot('turnRight + lookRight', 'combo'); await wait(2200);
  behaviour.perform('turnRight'); behaviour.perform('eyeContact'); await wait(900); shoot('head turned, eyes held on you', 'combo', null); await wait(2200);
  behaviour.express('skeptical', 0.9, { holdMs: 4000 }); await wait(800); behaviour.perform('shrug'); await wait(420); shoot('skeptical + shrug', 'combo', null); await settle(1500);
  behaviour.perform('headDown'); behaviour.perform('lookDown'); await wait(650); shoot('headDown + lookDown', 'combo', '15_head_down'); await wait(2200);
  shoot('recovered to rest', 'state', '02_neutral_front');
  await lab.end();

  // Contact sheet: each cell is the rendered shot beside its reference picture, or a "no reference" panel.
  say('building sheet');
  const refs = {}; for (const s of shots) if (s.ref && !(s.ref in refs)) refs[s.ref] = await loadImage(`${REF_DIR}${s.ref}.jpg`);
  const cols = 5, w = 200, rw = 120, h = shots[0].image.height, pad = 18, cw = w + rw + 8;
  sheet.width = cols * cw; sheet.height = Math.ceil(shots.length / cols) * (h + pad + 6); sheet.hidden = false;
  const g = sheet.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, sheet.width, sheet.height); g.font = '12px Segoe UI, sans-serif';
  shots.forEach((s, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * (h + pad + 6);
    g.fillStyle = '#111'; g.fillText(s.label, x + 4, y + 13); g.drawImage(s.image, x, y + pad);
    const img = s.ref ? refs[s.ref] : null;
    if (img) { const rh = rw * img.height / img.width; g.drawImage(img, x + w + 2, y + pad, rw, rh); g.fillStyle = '#555'; g.fillText('your reference', x + w + 4, y + pad + rh + 12); }
    else { g.fillStyle = '#f1f1f1'; g.fillRect(x + w + 2, y + pad, rw, 60); g.fillStyle = '#a33'; g.fillText(s.ref === null ? 'no reference' : 'reference', x + w + 8, y + pad + 26); g.fillText(s.ref === null ? 'picture exists' : 'MISSING', x + w + 8, y + pad + 42); }
  });
  const report = { when: new Date().toISOString(), speech: SPEECH_NOTE, controls: stage.controls, axes: stage.axes, performance: perf(), errors: [...errors], results };
  window.__LAB.results = report;
  // Saved into tests/artifacts when the local receiver (tools/save-artifact.mjs) is running.
  const post = (name, body) => fetch(`http://127.0.0.1:8770/?name=${name}`, { method: 'POST', body }).then(r => r.text()).catch(() => 'not saved');
  const blob = await new Promise(r => sheet.toBlob(r, 'image/jpeg', 0.88));
  const saved = [await post('nia-behaviour-sheet.jpg', blob), await post('nia-behaviour-results.json', JSON.stringify(report, null, 1))];
  say(`done: ${shots.length} states photographed (${saved.join(', ')})`);
  return report;
}
