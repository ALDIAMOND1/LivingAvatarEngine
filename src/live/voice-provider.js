// Voice providers. The avatar only ever sees this contract, so any speech model
// that can hand over a MediaStream of the agent's voice can drive it.
//
// Events (CustomEvent, payload in .detail):
//   'agent-audio'        { stream, monitor }  agent voice; monitor=false means do not play it
//   'user-audio'         { stream }           the person's microphone, for listening behaviour
//   'user-video'         { stream }           the person's camera, for the self-view only
//   'saw'                { count }            a camera frame was shown to the model
//   'agent-expression'   { emotion, intensity }  how the agent feels now, judged from the conversation
//   'agent-gesture'      { name }             a physical gesture the agent chose to make
//   'user-speech-start'  {}                   the person started talking (also the barge-in signal)
//   'user-speech-stop'   {}                   the person stopped talking
//   'agent-text'         { text, done }       running transcript of the agent's reply
//   'user-text'          { text }             transcript of the person, when the provider sends one
//   'closed'             { reason }
//   'error'              { message }
export class VoiceProvider extends EventTarget {
  emit(type, detail = {}) { if (this.ended && type !== 'closed') return; this.dispatchEvent(new CustomEvent(type, { detail })); }
  // Every microphone and camera stream a provider opens is registered here, so
  // ending a call can stop them all, whatever stage the connection had reached.
  hold(stream) { (this.streams ??= []).push(stream); return stream; }
  releaseDevices() { for (const s of this.streams ?? []) s.getTracks().forEach(t => t.stop()); }
  devicesReleased() { return (this.streams ?? []).every(s => s.getTracks().every(t => t.readyState === 'ended')); }
  async start() { throw new Error('not implemented'); }
  stop() {}
}

const FRAME_MAX_SIDE = 512;
const FRAME_MIN_GAP_MS = 4000;
// How she talks matters as much as what she says: the default delivery of a
// speech model is a polished announcer, which is what makes it "sound AI".
const PERSONA = 'You are Nia, on a relaxed one-to-one video call. You are warm, quick, curious and a little playful. '
  + 'HOW YOU SPEAK: like a real person chatting with a friend, never like an assistant or a narrator. '
  + 'Keep turns short, usually one or two sentences, and often end by handing the conversation back. '
  + 'Vary your pace and pitch; let sentences trail or restart the way people do. Use small natural sounds and words sparingly '
  + '("mm", "yeah", "oh", "right", "hmm", a soft laugh, a breath before a thought). Use contractions. React first, then answer. '
  + 'Show real feeling in your voice: amused, surprised, thoughtful, sympathetic, whatever fits. '
  + 'Never list options, never say "certainly" or "how can I help", never summarise what was just said, never describe yourself as an assistant. '
  + 'If interrupted, stop at once and listen. Never copy or imitate the person. If asked, be honest that you are an AI.';
const SEEING = ' YOU CAN SEE THEM: images in the conversation are the latest frames from their camera. '
  + 'Use what you see the way a person on a call would: notice their expression, what they are holding or showing, and their surroundings, '
  + 'and mention it only when it is relevant or when asked. Do not describe every frame, and say so plainly if you cannot make something out.';
const BLIND = ' Their camera is off, so you cannot see them; say so if asked.';
// Her expressions come from what the conversation actually means to her, as
// judged by the same model that is speaking, not from keywords in the text.
const EMBODIED = ' YOUR FACE AND BODY: the person sees you on video. Call feel() whenever how you feel changes, in the same turn as you speak, '
  + 'never instead of speaking, and never mention it. Use a low intensity for most things; strong feelings are rare. '
  + 'Match the moment: if they share something painful, be concerned or sad with them, never amused or happy. '
  + 'Call gesture() only when a real person would move: a nod of agreement, a shrug when you honestly do not know, a head tilt when puzzled. '
  + 'At most one gesture in a turn, and none in most turns.';
export const FEELINGS = ['neutral', 'happy', 'sad', 'surprised', 'confused', 'curious', 'concerned', 'amused', 'skeptical', 'serious', 'excited'];
// Names the model may ask for, and the engine action each one runs.
export const GESTURES = { nod: 'nod', shake_head: 'shake', shrug: 'shrug', tilt_head: 'tiltRight', lean_in: 'leanIn', lean_back: 'leanBack',
  raise_eyebrows: 'browRaise', look_away: 'lookAway', smile: 'softSmile', big_smile: 'bigSmile', squint: 'squint' };
const BODY_TOOLS = [
  { type: 'function', name: 'feel', description: 'Set the feeling showing on your face. Call it as your feeling changes while you talk and listen.',
    parameters: { type: 'object', properties: { emotion: { type: 'string', enum: FEELINGS }, intensity: { type: 'number', description: '0 to 1; most feelings are 0.3 to 0.6' } }, required: ['emotion'] } },
  { type: 'function', name: 'gesture', description: 'Make one physical gesture now.',
    parameters: { type: 'object', properties: { name: { type: 'string', enum: Object.keys(GESTURES) } }, required: ['name'] } },
];

// OpenAI Realtime over WebRTC. The browser never holds an API key: the SDP
// offer goes to the local server (server.mjs), which adds the key and session.
export class OpenAIRealtimeProvider extends VoiceProvider {
  constructor({ statusUrl = '/api/status', sessionUrl = '/api/realtime/session', camera = true, voice = null } = {}) {
    super();
    Object.assign(this, { statusUrl, sessionUrl, camera, voice, pc: null, channel: null, mic: null, cam: null, eye: null, frames: 0, reply: '' });
  }

  async start() {
    const status = await fetch(this.statusUrl).then(r => r.json()).catch(() => null);
    if (!status) throw new Error('The local server is not running. Start it with: node server.mjs');
    if (!status.ready) throw new Error('No OPENAI_API_KEY in the server’s environment. See README_LIVE.md.');
    // Ending the call while it is still connecting must leave nothing running:
    // after every wait, check whether it was ended in the meantime.
    const alive = () => { if (this.ended) { this.release(); throw new Error('Call ended while connecting'); } };
    alive();
    this.mic = this.hold(await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }));
    alive();
    this.emit('user-audio', { stream: this.mic });
    if (this.camera) await this.openCamera();
    alive();
    const pc = this.pc = new RTCPeerConnection();
    pc.ontrack = e => { if (e.track.kind === 'audio') this.emit('agent-audio', { stream: e.streams[0], monitor: true }); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && this.pc === pc) this.stop('Connection lost');
    };
    for (const track of this.mic.getTracks()) pc.addTrack(track, this.mic);
    this.channel = pc.createDataChannel('oai-events');
    this.channel.onmessage = e => { try { this.onServerEvent(JSON.parse(e.data)); } catch { /* ignore non-JSON */ } };
    const opened = new Promise((resolve, reject) => {
      this.channel.onopen = resolve;
      setTimeout(() => reject(new Error('Timed out connecting to the voice provider')), 20000);
    });
    await pc.setLocalDescription(await pc.createOffer());
    alive();
    const res = await fetch(this.sessionUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
    alive();
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      this.release();
      throw new Error(err.detail || err.error || `Session failed (HTTP ${res.status})`);
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    alive();
    await opened;
    alive();
    const session = { type: 'realtime', instructions: PERSONA + (this.cam ? SEEING : BLIND) + EMBODIED, tools: BODY_TOOLS, tool_choice: 'auto' };
    if (this.voice) session.audio = { output: { voice: this.voice } };   // only settable before she first speaks
    this.send({ type: 'session.update', session });
    // She speaks first, so the person hears the moment the line is truly live
    // instead of talking into a connection that is still warming up.
    this.send({ type: 'response.create', response: { instructions: 'Say a very short, natural hello, as if you just picked up a video call from someone you like. One short sentence, under eight words.' } });
  }

  send(event) { if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event)); }

  // The camera is optional: if it is refused or missing, the conversation is voice only.
  async openCamera() {
    try {
      this.cam = this.hold(await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } }));
      if (this.ended) { this.releaseDevices(); return; }
    } catch (err) {
      this.cam = null; this.emit('error', { message: 'Camera unavailable, so she can hear but not see you.' }); return;
    }
    this.eye = document.createElement('video');
    Object.assign(this.eye, { muted: true, playsInline: true, srcObject: this.cam });
    await this.eye.play().catch(() => {});
    this.emit('user-video', { stream: this.cam });
  }

  // Shows the model what the camera sees right now. Sent as a still image at
  // the start of each thing the person says, so her reply is about the present
  // moment. Only the two most recent frames are kept in the conversation, which
  // keeps cost and context small.
  look() {
    const v = this.eye;
    if (!v || !v.videoWidth) return;
    // At most one frame every few seconds, however many short turns there are.
    const now = performance.now();
    if (this.lastLook && now - this.lastLook < FRAME_MIN_GAP_MS) return;
    this.lastLook = now;
    const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(v.videoWidth * scale), height: Math.round(v.videoHeight * scale) });
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    const n = ++this.frames;
    this.send({ type: 'conversation.item.create', item: { id: `cam_${n}`, type: 'message', role: 'user',
      content: [{ type: 'input_image', image_url: canvas.toDataURL('image/jpeg', 0.6) }] } });
    if (n > 2) this.send({ type: 'conversation.item.delete', item_id: `cam_${n - 2}` });
    this.emit('saw', { count: n });
  }

  onServerEvent(e) {
    switch (e.type) {
      case 'input_audio_buffer.speech_started': this.look(); this.emit('user-speech-start'); break;
      case 'input_audio_buffer.speech_stopped': this.emit('user-speech-stop'); break;
      case 'response.created': this.reply = ''; this.turn = { calls: [], spoke: false }; break;
      case 'response.output_item.done': {
        const item = e.item ?? {};
        if (item.type === 'message') this.turn.spoke = true;
        if (item.type === 'function_call') { this.turn.calls.push(item.call_id); this.onBodyCall(item.name, item.arguments); }
        break;
      }
      case 'response.done': {
        const { calls = [], spoke = false } = this.turn ?? {};
        // Her first look at the camera comes after her hello, so the greeting is not held up by a picture.
        if (!this.greeted) { this.greeted = true; this.look(); }
        for (const id of calls) this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: id, output: 'ok' } });
        // If she only moved and said nothing, let her speak now. Never twice in a
        // row, and never after a reply that was cut off by the person.
        const finished = (e.response?.status ?? 'completed') === 'completed';
        if (calls.length && !spoke && finished && !this.followedUp) { this.followedUp = true; this.send({ type: 'response.create' }); }
        else this.followedUp = false;
        break;
      }
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        this.reply += e.delta || ''; this.emit('agent-text', { text: this.reply, done: false }); break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        this.emit('agent-text', { text: e.transcript || this.reply, done: true }); break;
      case 'conversation.item.input_audio_transcription.completed':
        this.emit('user-text', { text: e.transcript || '' }); break;
      case 'error': this.emit('error', { message: e.error?.message || 'Voice provider error' }); break;
    }
  }

  onBodyCall(name, json) {
    let args = {};
    try { args = JSON.parse(json || '{}'); } catch { return; }
    if (name === 'feel' && FEELINGS.includes(args.emotion)) {
      const intensity = Number.isFinite(args.intensity) ? Math.min(1, Math.max(0, args.intensity)) : 0.5;
      this.emit('agent-expression', { emotion: args.emotion, intensity });
    }
    if (name === 'gesture' && GESTURES[args.name]) this.emit('agent-gesture', { name: GESTURES[args.name] });
  }

  stop(reason = 'Ended') {
    if (this.ended) return;                       // one click or ten: the same single shutdown
    this.ended = true;
    this.release();
    this.emit('closed', { reason });
  }

  // Stops every device and closes the connection. Safe at any stage and any number of times.
  release() {
    const { pc, channel, eye } = this;
    this.pc = this.channel = this.mic = this.cam = this.eye = null;
    this.releaseDevices();
    if (eye) { eye.pause(); eye.srcObject = null; }
    try { channel?.close(); } catch { /* already closed */ }
    try { pc?.close(); } catch { /* already closed */ }
  }
}

// A synthetic vowel-like voice: glottal buzz through formant filters, in
// syllable bursts with a pause every few syllables, like phrases. Stands in for
// a real voice on machines or test browsers without a microphone.
export function syntheticVoice(ctx, seconds, onEnded) {
  const out = ctx.createMediaStreamDestination();
  const buzz = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 190 });
  const envelope = new GainNode(ctx, { gain: 0 });
  const vowels = [[800, 1150], [350, 2000], [270, 2300], [450, 800], [325, 700]]; // a e i o u
  const formants = [0, 1].map(() => new BiquadFilterNode(ctx, { type: 'bandpass', Q: 9 }));
  const mix = new GainNode(ctx, { gain: 0.35 });
  buzz.connect(envelope);
  formants.forEach(f => { envelope.connect(f); f.connect(mix); });
  mix.connect(out);
  const t0 = ctx.currentTime + 0.3;
  let t = t0, i = 0;
  while (t < t0 + seconds) {
    const pause = i % 6 === 5;
    if (!pause) {
      const v = vowels[i % vowels.length];
      formants.forEach((f, k) => f.frequency.setValueAtTime(v[k], t));
      envelope.gain.setValueAtTime(0, t);
      envelope.gain.linearRampToValueAtTime(1, t + 0.04);
      envelope.gain.setValueAtTime(1, t + 0.17);
      envelope.gain.linearRampToValueAtTime(0, t + 0.24);
    }
    t += pause ? 0.6 : 0.27; i++;
  }
  buzz.start(t0); buzz.stop(t);
  buzz.onended = onEnded;
  return out.stream;
}

// No key, no microphone: the synthetic voice plays as the agent.
export class SyntheticProvider extends VoiceProvider {
  constructor({ seconds = 8, monitor = true } = {}) { super(); Object.assign(this, { seconds, monitor, ctx: null }); }
  async start() {
    this.ctx = new AudioContext();
    await this.ctx.resume();
    const stream = syntheticVoice(this.ctx, this.seconds, () => this.stop('Finished'));
    this.emit('agent-audio', { stream, monitor: this.monitor });
  }
  stop(reason = 'Ended') {
    if (!this.ctx) return;
    this.ctx.close().catch(() => {}); this.ctx = null;
    this.emit('closed', { reason });
  }
}

// No key, no network: the avatar only listens. A simple loudness-based voice
// detector on your microphone marks when you start and stop talking, so the
// listening behaviour (eye contact, nods at your pauses) can be seen on its own.
// `simulate` swaps the microphone for the synthetic voice, for automated checks.
export class ListenProvider extends VoiceProvider {
  constructor({ simulate = false, seconds = 12, onLevel = 0.05, startMs = 150, stopMs = 900 } = {}) {
    super(); Object.assign(this, { simulate, seconds, onLevel, startMs, stopMs, ctx: null, mic: null, timer: 0 });
  }
  async start() {
    const ctx = this.ctx = new AudioContext();
    await ctx.resume();
    const stream = this.simulate
      ? syntheticVoice(ctx, this.seconds, () => setTimeout(() => this.stop('Finished'), 1500))
      : (this.mic = this.hold(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })));
    if (this.ended) { this.releaseDevices(); ctx.close().catch(() => {}); return; }
    const analyser = new AnalyserNode(ctx, { fftSize: 512 });
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    let talking = false, loudMs = 0, quietMs = 0, last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now(), dt = now - last; last = now;
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0; for (const x of buffer) sum += x * x;
      const loud = Math.sqrt(sum / buffer.length) * 4 > this.onLevel;
      loudMs = loud ? loudMs + dt : 0; quietMs = loud ? 0 : quietMs + dt;
      if (!talking && loudMs >= this.startMs) { talking = true; this.emit('user-speech-start'); }
      if (talking && quietMs >= this.stopMs) { talking = false; this.emit('user-speech-stop'); }
    }, 40);
    this.emit('user-audio', { stream });
  }
  stop(reason = 'Ended') {
    if (!this.ctx) return;
    clearInterval(this.timer);
    this.ended = true; this.releaseDevices(); this.mic = null;
    this.ctx.close().catch(() => {}); this.ctx = null;
    this.emit('closed', { reason });
  }
}
