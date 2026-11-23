// Hosted video face (Simli). Her face is generated as real video on Simli's
// servers from the sound of her voice and streamed back, so mouth, cheeks and
// expression come from a video model instead of from blend-shapes drawn on
// this device. Billed per minute by Simli; nothing is rendered on the local GPU.
//
// Same interface as the other stages. What differs: the picture and the voice
// both come back from Simli already in sync, so this stage plays no audio of
// its own, and the behaviour engine's pose is ignored (the video has its own
// head movement). A session is only opened while a call is running.
const SDK = 'https://esm.sh/simli-client@3.2.0';
const TOKEN_URL = 'http://127.0.0.1:8767/simli/token';

export class SimliStage extends EventTarget {
  constructor(container, character) {
    super();
    Object.assign(this, { container, character, ready: false, client: null, video: null, audio: null, speaking: false,
      onFrame: null, lipsyncStatus: 'hosted video (not connected)', opening: null, generation: 0 });
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async load() {
    this.video = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true, muted: true });   // sound comes from the audio element; muted video may always autoplay
    this.audio = Object.assign(document.createElement('audio'), { autoplay: true });
    this.poster = Object.assign(document.createElement('p'), { className: 'hosted-poster', textContent: 'Her face appears when the conversation starts.' });
    this.container.append(this.video, this.audio, this.poster);
    this.ready = true;
  }

  async wake() {}
  setSpeaking(on) { if (this.speaking !== on) { this.speaking = on; this.emit(on ? 'speech-start' : 'speech-end'); } }

  // Her voice arrives from the speech provider; it is handed to Simli, which
  // returns matching video and the same voice, in sync.
  attachStream(stream) {
    const mine = ++this.generation;
    this.opening = (async () => {
      this.lipsyncStatus = 'hosted video (connecting)';
      const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faceId: this.character.avatar.faceId }) })
        .catch(() => { throw new Error('The Simli token service is not running. Start the app with START_LIVE.cmd.'); });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.session_token) throw new Error(body.error || `Simli refused the session (HTTP ${res.status})`);
      const { SimliClient, LogLevel } = await import(SDK);
      if (mine !== this.generation) return;                       // the call ended while this was connecting
      const verbose = new URLSearchParams(location.search).has('simlilog');
      const client = new SimliClient(body.session_token, this.video, this.audio, null, verbose ? LogLevel?.DEBUG : LogLevel?.ERROR);
      this.pending = client;                                      // so ending the call also stops a session that is still connecting
      client.on('speaking', () => this.setSpeaking(true));
      client.on('silent', () => this.setSpeaking(false));
      client.on('error', detail => this.emit('error', { message: `Simli: ${detail}` }));
      client.on('startup_error', detail => this.emit('error', { message: `Simli could not start: ${detail}` }));
      await client.start();
      if (mine !== this.generation) { client.stop().catch(() => {}); return; }
      this.pending = null; this.client = client; this.poster.hidden = true;
      client.listenToMediastreamTrack(stream.getAudioTracks()[0]);
      this.lipsyncStatus = 'hosted video (Simli)';
    })().catch(err => { if (mine !== this.generation) return; this.pending = null; this.lipsyncStatus = 'hosted video (failed)'; this.emit('error', { message: err.message || String(err) }); });
  }

  detachStream() {
    this.generation++;
    for (const client of [this.client, this.pending]) { try { client?.stop()?.catch?.(() => {}); } catch { /* already closed */ } }
    this.client = null; this.pending = null;
    if (this.video) this.video.srcObject = null;
    if (this.audio) this.audio.srcObject = null;
    if (this.poster) this.poster.hidden = false;
    this.lipsyncStatus = 'hosted video (not connected)';
    this.setSpeaking(false);
  }

  interrupt() { try { this.client?.ClearBuffer(); } catch { /* not connected */ } this.setSpeaking(false); }
  attachUserStream() {} detachUserStream() {}
  agentLevel() { return 0; } userLevel() { return 0; }
  applyPose() {} setState() {}
  strongestViseme() { return { name: 'sil', value: 0 }; }
}
