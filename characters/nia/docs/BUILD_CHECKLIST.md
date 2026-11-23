# Nia — Implementation and Quality Checklist

Legend: [x] completed and checked; [ ] not implemented. Design documentation is not runtime completion.

## P0 — Character definition and validation
- [x] Original Nia profile, visual direction and consent constraints
- [x] Explicit animation parameters and state/transition definitions
- [x] Voice command vocabulary and provider-agnostic architecture
- [x] Asset manifest and acceptance criteria
- [ ] Generate or obtain original consent-safe high-resolution Nia portrait
- [ ] Validate source face, lighting and visual quality

## P1 — Photorealistic silent presence (blocking visual milestone)
- [ ] Facial-landmark/segmentation baseline on Nia portrait
- [ ] Compare 2D, 2.5D, reconstructed 3D, and motion assets
- [ ] Select representation based on realistic head/eye footage, not static screenshots
- [ ] Independent eyes, eyelids and blink geometry with correct occlusion
- [ ] Gaze and small head turns with convincing depth/parallax
- [ ] Subtle breathing, expression variation and shoulder motion
- [ ] Natural continuous 60-second recording; subjective realism evaluation
- [ ] No full-photo pan/rotation passed off as facial animation

## P2 — Voice-first user experience
- [ ] Working mic permission and VAD
- [ ] STT recognizes spoken intent (with supported-browser fallback)
- [ ] Spoken 'look', 'nod', 'smile', 'stay still' modify true avatar parameters
- [ ] Conversation adapter and responsive speech output
- [ ] Listening/thinking/speaking states and interruptions
- [ ] No normal operation dependent on clicking motion controls

## P3 — Speech and full conversational avatar
- [ ] Real audio-driven mouth blendshapes/visemes
- [ ] Coarticulation, natural pauses, facial prosody and listening reaction
- [ ] Mouth/eye/head rendering remain temporally coherent
- [ ] Round-trip voice latency and audio-video sync measured

## P4 — Streaming/production efficiency
- [ ] Lazy load, prioritized prefetch, bounded cache and GPU disposal
- [ ] 720p 30 FPS on actual test target measured with p50/p95/p99 frame timing
- [ ] Avatar memory monitored during 30-minute stress test
- [ ] Runtime without continuous expensive neural video inference
- [ ] Model/code/asset commercial licenses audited
- [ ] Subject authorization and privacy tests

## Blockers
An actual original portrait and appearance/geometry assets are missing. Browser SpeechRecognition is not universally reliable and may use vendor cloud services. Current root canvas app is an early control demonstration, not a realistic-avatar product.

## Done means
Show one continuous, recorded, realistic 60-second silent demo AND an end-to-end spoken command and reply on real hardware. User must be able to evaluate quality, latency and memory firsthand.
