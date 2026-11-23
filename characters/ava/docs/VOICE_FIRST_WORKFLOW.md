# Voice-First Interaction — No Motion Buttons Required

## User experience
User opens Ava -> grants microphone permission -> says a command or asks a question -> Ava displays listening state -> intent or dialogue is resolved -> Ava performs a gesture or talks back. Buttons may exist in internal debugging tools but cannot be the primary interaction mechanism.

## Event path
Mic PCM -> local VAD -> utterance end -> STT/realtime speech adapter -> intent router:
- known physical instruction -> motion event on head/eyes/expression controller;
- ordinary question -> conversation provider -> generated speech/audio;
- speech playback -> mouth and facial controller using actual audio chunks.
Throughout: natural idle blink/gaze and carefully gated listening/speaking behavior.

## Example commands
"Look left" => smooth gaze left, optional small delayed head follow.
"Look at me" => gaze and head return to front.
"Nod" => short restrained nod.
"Smile" => subtle expression; smile must include cheeks/eye corners.
"Stay still" => optional motion stopped.
"Introduce yourself" => spoken reply; no claim of a working speech provider before tested.

## First functional implementation (sequential)
1. Local microphone permission, visual error handling and start/stop status.
2. Browser speech recognition where supported; note many browser implementations are online and require permission.
3. Dependency-free command parser in `intent-parser.mjs`; dispatch to a real face controller, not to a flat image pan.
4. Speech output using browser `speechSynthesis` for initial smoke testing only; document inconsistent voices/latency.
5. Pluggable STT/TTS or OpenAI Realtime provider once access and usage authorization are supplied.
6. Audio-synchronized mouth blendshapes: use PCM and a phoneme/viseme predictor if possible; amplitude-only is not final-grade speech sync.
7. Barge-in: interrupt answer when user starts speaking, flush speech queue, resume listening.
8. Consent, permissions, failure fallback, network errors, microphone device changes.

## Privacy
Do not record audio by default, and never silently upload user audio. Explicitly disclose when processing is cloud-based. Never put provider API keys in browser JavaScript or repository. For a product deployment use a server-managed session/token flow.

## Reliability tests
Permission denied, muted mic, noisy room, partial transcription, interruptions, unsupported SpeechRecognition, offline status, short commands, and overlapping gesture and speech.
