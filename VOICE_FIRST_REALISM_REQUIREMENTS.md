# Voice-First Photorealistic Avatar — Corrected Acceptance Contract

Updated: 2026-11-22

## User correction
The initial placeholder canvas and click-driven motion demo were NOT the requested product. Do not treat them as completion. The target is a realistic human you can talk to naturally, who looks, listens, speaks, and responds with lifelike movement. Motion controls are debugging aids only, not the primary user interface.

## Required end-to-end interaction
1. A photorealistic, authorized human avatar is visible at rest with natural blinking, gaze, breathing and subtle head motion.
2. User speaks into the microphone; voice activity detection identifies speech.
3. Spoken commands such as 'look left', 'look at me', 'nod', 'smile' cause visible, smooth gestures without pressing buttons.
4. General speech is understood and receives a spoken answer, with listening/speaking states.
5. Avatar mouth and facial behavior follow actual response audio, with reasonable perceptual synchronization.
6. The system runs with bounded memory, without a continuous expensive generative-video model.
7. Realism and performance must be demonstrated on the actual connected machine; no placeholder is called photorealistic.

## Technical separation
- Conversational layer: microphone capture, VAD, speech recognition or realtime speech API, intent routing, spoken reply.
- Motion layer: independent animation state machine (idle/listen/speak, eye, head, expression, mouth).
- Appearance layer: actual identity-consistent photorealistic portrait reconstruction or prepared view-dependent appearance; avoid global 2D portrait transforms as final solution.
- Asset layer: compact manifests, lazy load, bounded cache, explicit GPU texture disposal.
- Test layer: recorded command/response latency, FPS, memory, identity and perceptual realism review.

## Dependencies and constraints
A source portrait with explicit authorization is required for a particular person's likeness. If the user prefers a fictional avatar, obtain or generate a consent-safe synthetic reference. A single frontal photo may not be sufficient for photorealistic unseen angles, eyelids and mouth interior. Offline preprocessing may need temporary GPU resources. Browser speech recognition support varies and may rely on external services; do not misrepresent it as fully local. OpenAI Realtime requires user-authorized credentials and usage costs; never fabricate or embed API keys. No .env modifications without authorization.

## Acceptance gate
Reject any build whose only animation is translating or rotating a whole portrait. Reject button-only interaction. Report partial functionality honestly and keep implementing toward a real, voice-first photorealistic avatar.
