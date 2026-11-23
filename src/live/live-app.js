import { pickCharacter } from './config.js';
import { ConversationState } from './conversation-state.js';
import { BehaviourEngine } from './behaviour-engine.js';
import { OpenAIRealtimeProvider, SyntheticProvider, ListenProvider } from './voice-provider.js';

const $ = id => document.getElementById(id);
const character = await pickCharacter();
// The renderer is chosen by the character: 'splat' is the photoreal head,
// 'rig' the stylised stand-in. Both expose the same stage interface.
const { Stage } = character.renderer === 'splat' ? { Stage: (await import('./splat-stage.js')).SplatStage }
  : character.renderer === 'simli' ? { Stage: (await import('./simli-stage.js')).SimliStage }
  : { Stage: (await import('./avatar-stage.js')).AvatarStage };
const stage = new Stage($('avatar'), character);
const LABELS = {
  off: 'Not connected', idle: 'Here with you', listening: 'Listening…',
  thinking: 'Thinking…', speaking: 'Speaking',
};
const PROVIDERS = {
  // ?voice=cedar (or another OpenAI voice name) tries a different voice.
  talk: () => new OpenAIRealtimeProvider({ camera: $('camera').checked, voice: new URLSearchParams(location.search).get('voice') }),
  listen: () => new ListenProvider({ simulate: new URLSearchParams(location.search).has('simulate') }),
  synthetic: () => new SyntheticProvider(),
};
let provider = null, mode = null, thinkTimer = 0;

const convo = new ConversationState((state, previous) => {
  document.body.dataset.state = state;
  $('status').textContent = LABELS[state];
  clearTimeout(thinkTimer);
  stage.setState(state);
  // Talked over mid-sentence: her lips stop and relax at once, speech gestures
  // are dropped, and she turns to listen. Nothing that was cancelled restarts.
  if (state === 'listening' && previous === 'speaking') { stage.interrupt?.(); behaviour.interrupt(); }
  // Without a reply (keyless listening mode, or a dropped turn) settle back to idle.
  if (state === 'thinking') thinkTimer = setTimeout(() => convo.set('idle'), mode === 'listen' ? 1500 : 8000);
});

const behaviour = new BehaviourEngine();
// Timed by the wall clock rather than the renderer's frame delta, so behaviour
// keeps real-time pace on slow devices and when frames are dropped.
let lastFrameAt = performance.now();
stage.onFrame = () => {
  const now = performance.now(), dt = now - lastFrameAt; lastFrameAt = now;
  stage.applyPose(behaviour.update(dt, {
    state: convo.state, userLevel: stage.userLevel(), agentLevel: stage.agentLevel(),
  }));
};

stage.addEventListener('error', e => setNote(e.detail.message, true));
stage.addEventListener('speech-start', () => convo.agentSpeechStart());
stage.addEventListener('speech-end', () => convo.agentSpeechEnd());

function setNote(text, isError = false) {
  $('note').textContent = text; $('note').classList.toggle('error', isError);
}

function refreshButtons() {
  for (const b of document.querySelectorAll('[data-mode]')) {
    const mine = b.dataset.mode === mode;
    b.classList.toggle('active', mine);
    b.disabled = !stage.ready || (mode !== null && !mine);
    b.textContent = mine ? 'Stop' : b.dataset.label;
  }
}

async function start(which) {
  mode = which; refreshButtons(); setNote('Connecting…'); $('camera').disabled = true;
  const p = provider = PROVIDERS[which]();
  p.addEventListener('agent-audio', e => stage.attachStream(e.detail.stream, { monitor: e.detail.monitor }));
  p.addEventListener('user-audio', e => stage.attachUserStream(e.detail.stream));
  p.addEventListener('user-video', e => { $('selfView').srcObject = e.detail.stream; $('selfView').hidden = false; });
  p.addEventListener('saw', e => { $('seen').textContent = `saw you ${e.detail.count}×`; });
  p.addEventListener('agent-expression', e => behaviour.express(e.detail.emotion, e.detail.intensity));
  p.addEventListener('agent-gesture', e => behaviour.perform(e.detail.name));
  p.addEventListener('user-speech-start', () => convo.userSpeechStart());
  p.addEventListener('user-speech-stop', () => convo.userSpeechStop());
  p.addEventListener('agent-text', e => { $('agentText').textContent = e.detail.text; });
  p.addEventListener('user-text', e => { $('userText').textContent = e.detail.text; });
  p.addEventListener('error', e => setNote(e.detail.message, true));
  p.addEventListener('closed', e => { if (provider === p) finish(e.detail.reason); });
  try {
    await stage.wake();
    await p.start();
    if (provider !== p) return;
    convo.connected();
    setNote({
      talk: 'Line open — she’ll say hello as soon as she’s ready. Then just talk; you can talk over her to interrupt.',
      listen: 'Talk for a while, pausing naturally: she listens and nods at your pauses. Nothing is sent anywhere.',
      synthetic: 'Playing a synthetic test voice through the lip-sync pipeline.',
    }[which]);
  } catch (err) {
    if (provider === p) { provider = null; p.stop(); finish(err.message || 'Could not start', true); }
  }
}

function finish(reason, isError = false) {
  provider = null; mode = null;
  stage.detachStream(); stage.detachUserStream();
  $('selfView').srcObject = null; $('selfView').hidden = true; $('camera').disabled = false; $('seen').textContent = '';
  convo.closed(); refreshButtons(); setNote(reason, isError);
}

for (const b of document.querySelectorAll('[data-mode]')) {
  b.dataset.label = b.textContent;
  b.addEventListener('click', () => {
    if (mode === b.dataset.mode) {
      const p = provider; provider = null; p?.stop();
      const freed = !p?.devicesReleased || p.devicesReleased();
      finish(freed ? 'Ended. Microphone and camera are off.' : 'Ended, but a microphone or camera is still active: close this tab to release it.', !freed);
    }
    else if (mode === null) start(b.dataset.mode);
  });
}

// Small readout so lip-sync can be judged and measured, not just eyeballed.
let frames = 0, last = performance.now();
(function meter(now) {
  frames++;
  if (now - last >= 500) {
    const v = stage.strongestViseme();
    $('viseme').textContent = stage.lipsyncStatus ?? (v.value > 0.05 ? `${v.name} ${v.value.toFixed(2)}` : '—');
    $('rate').textContent = `${Math.round(frames * 1000 / (now - last))} fps`;
    $('cues').textContent = `${behaviour.pose.mood} · ${behaviour.counts.nods} nods · ${behaviour.counts.beats} beats`;
    frames = 0; last = now;
  }
  requestAnimationFrame(meter);
})(last);

$('characterName').textContent = character.name;
$('characterNote').textContent = character.note;
refreshButtons();
setNote('Loading the avatar…');
try {
  // The CDN compresses the model, so loaded bytes can exceed the advertised total.
  await stage.load(e => { if (e?.lengthComputable) setNote(`Loading the avatar… ${Math.min(99, Math.round(100 * e.loaded / e.total))}%`); });
  refreshButtons();
  const status = await fetch('/api/status').then(r => r.json()).catch(() => null);
  setNote(status?.ready ? 'Ready.' : 'Ready. Live conversation needs the local server with an API key; the other buttons work without one.');
} catch (err) {
  console.error(err);
  setNote(`The avatar could not load: ${err.message || err}`, true);
}

window.__LIVE_DEBUG = { stage, convo, behaviour, get provider() { return provider; } };
// live.html?lab adds a panel that triggers every feeling and action and
// photographs the result, for checking the face against its references.
if (new URLSearchParams(location.search).has('lab')) (await import('./lab.js')).mountLab({ stage, behaviour, convo });
