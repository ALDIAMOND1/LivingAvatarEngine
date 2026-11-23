# Nia — Real-time Conversation Milestone

The default Nia UI now uses browser WebRTC streaming audio rather than Web Speech or scripted commands.

## Start
Run `node server.mjs` from the project directory and open http://127.0.0.1:8766.

The app needs an OpenAI API key supplied to the **server process environment**, never pasted into the website or checked into source. Do not modify .env files. In PowerShell, set `$env:OPENAI_API_KEY` in a private terminal session before running `node server.mjs`. Never send the key in chat. You must have an active API account with billing enabled; a ChatGPT subscription alone does not provide API credit.

Without a key, the UI and avatar run locally, but attempting a live conversation returns a clear setup error. No provider call is made.

## Architecture
- `server.mjs` binds 127.0.0.1:8766, serves static assets and proxies a WebRTC SDP offer to OpenAI Realtime `/v1/realtime/calls`. Standard API key never reaches browser.
- `src/nia-realtime.js` opens microphone and RTCPeerConnection, receives streamed model audio, supports interruption via server VAD, forwards data-channel events to UI.
- `src/nia-app.js` integrates conversation state with Nia's existing locally rendered portrait.
- `src/nia-motion.js` and `src/nia-renderer.js` remain lightweight. Full lip sync and 3D geometry are NOT completed.

## Limitations
- Realtime conversation requires an API key and network; this implementation has not been verified with a live paid session.
- Real microphone, barge-in and audio quality must be tested interactively with the user's permission.
- Audio amplitude is available for future mouth animation but not yet used to paint a fake mouth. Genuine viseme assets are needed.
- Input transcription is dependent on provider events; if not enabled, your words may not display as text even though audio conversation works.
- Server is local-development only; before deployment, add authentication, session limits, rate limiting, CSRF protection, user identity and budget controls.
- Do not expose port 8766 publicly.
