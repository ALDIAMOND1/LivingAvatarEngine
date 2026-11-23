# Living Avatar Engine — Project Master Specification
Version: 0.1 | Created: 2026-11-22 | Status: Architecture and prototype planning

## 1. Vision
Build a photorealistic, interactive digital-human animation engine that turns one authorized still portrait into a believable, continuously living on-screen presenter. The avatar should blink, shift its gaze, subtly move its head and shoulders, show microexpressions, listen, and eventually speak with audio-driven lip synchronization. The animation must be economical enough for ordinary consumer hardware and future SaaS deployment.

The near-term success criterion is a **silent, realistic 60-second avatar demonstration** before integrating speech, livestreaming, CRM, or multi-agent orchestration. We want a person who appears naturally alive even when saying nothing.

## 2. Product context and long-term business
The intended commercial product is a subscription SaaS where customers create one or multiple autonomous AI presenters or employees. Future roles may include teaching, customer service, sales, answering livestream comments, hosting classes, and lead capture. Future integrations may include TikTok LIVE, YouTube, OpenAI Realtime, CRM, courses, payments, schedules, and multi-avatar orchestration.

**Current scope is ONLY the avatar animation engine and a local proof of concept.** Do not build account systems, billing, dashboards, TikTok connectors, broadcasting, OBS, CRM, or course systems during this milestone. The eventual product should be commercially licensable and support consented likenesses.

## 3. Key observations and decisions
- Nuance Labs' live AI persona appears especially convincing through its face, eyes, head behavior, and natural idle motion. The user observed that its mouth does not necessarily match speech exactly; therefore, perceptual realism must not be reduced to perfect lip-sync.
- We are not copying or assuming Nuance's undisclosed internal implementation. We are developing a separate economical architecture.
- Waveforms react to audio using lightweight signal processing. We can apply the same real-time principle to mouth and facial controls, but waveform amplitude alone cannot infer accurate speech mouth shapes.
- Precompute reusable high-quality facial appearance and movements where possible; animate and blend locally at runtime instead of running a large neural video generator on every frame.
- Use a Netflix-like strategy for **loading**, not for animation logic: segmented/compressed assets, lazy loading, prefetch, bounded caches, and frame eviction.
- Avoid requiring OBS, LiveKit, or cloud GPU inference for the initial local demo.
- The eventual live audio source should be provider-agnostic; OpenAI Realtime is the preferred first conversational/audio provider.
- We will build our own TikTok connector later rather than depending on TikFinity for the commercial product; TikTok broadcasting and event access are separate integrations and may require platform authorization.

## 4. What realism means
Realism is a combination of:
1. Identity preservation across poses: same face, skin, hair, lighting, and facial proportions.
2. Photorealistic surface details: eyes, eyelids, skin, mouth interior, teeth, shadows.
3. Continuous temporal consistency: no popping, wobbling, jitter, or sudden texture changes.
4. Biological motion: irregular blinks, eye saccades, micro-gaze shifts, subtle head stabilization, breathing, and asymmetric facial behavior.
5. Context-sensitive behavior: listening, thinking, speaking, and natural pauses.
6. Later: intelligible speech, audio-to-viseme alignment, and facial coarticulation.
A 30 FPS display does not itself imply convincing animation. Realism is an independently evaluated quality gate.

## 5. Prototype boundaries
### In scope — Phase 1
- One consented portrait, preferably frontal or near-frontal, good lighting, high resolution.
- Neutral face and appearance preparation.
- Silent idle animation for at least 60 seconds.
- Natural blink timing and eyelid motion.
- Gaze shifts with eyes leading small head movements.
- Subtle head nod, tilt, yaw, and return to neutral.
- Slight breathing/posture motion where image framing permits.
- Seamless motion transitions, variation, no obvious repetitive loops.
- Local playback, measurement, caching, and memory profiling.
- Browser/WebGL prototype or other lightweight renderer chosen after feasibility tests.

### Out of scope — Phase 1
- Hand waving and full-body animation; future phase requires body/arm/hand representation.
- Audio speech generation and speech-to-viseme model.
- TikTok/YouTube comments, broadcasting, OBS, LiveKit, CRM, subscriptions, multi-tenancy.
- Claims of indistinguishability from a filmed person before evaluation.

## 6. Fundamental technical challenge
A single photograph does not contain hidden facial geometry, unseen side views, eyelid closure, accurate teeth, or a complete 3D head. Purely moving or warping a flat image can look like a puppet, particularly during head turns. The system needs either a plausible reconstructed/rigged 3D or 2.5D representation, carefully generated view-dependent assets, or a hybrid. We must compare approaches rather than assume a set of sprites will look realistic.

## 7. Candidate rendering architectures
### A. 2D mesh warp + layered face details
Use one high-resolution portrait, face landmarks, a deformable 2D mesh, independent eye/eyelid layers, subtle texture-space deformation, and limited head rotation. Advantages: very low memory, fast startup, CPU/WebGL friendly. Risks: flatness, uncanny eyes, limited parallax, difficult occlusions. Best baseline.

### B. 2.5D / depth-aware portrait
Estimate facial depth and segment foreground/background, deform a depth-aware mesh and fill small disocclusions. Advantages: stronger head parallax, still lightweight runtime. Risks: hallucinated hidden surfaces and unstable geometry.

### C. Rigged 3D face with photorealistic texture
Reconstruct/fit head mesh, textures, blendshapes, eye geometry and eyelids; render with WebGL. Advantages: continuous head pose and physically coherent animation. Risks: difficult reconstruction from one image, likeness/texture mismatch, eye and hair artifacts.

### D. Pre-generated motion clips / view-dependent appearance
Prepare a compact library of photorealistic blink, gaze, nod, tilt, and idle motion assets. Decode only needed segments; blend via mesh/optical flow or controlled transitions. Advantages: strong offline quality potential. Risks: visible seams, clip combinatorial explosion, transitions between motions, decoded frame memory.

### Preferred research direction: HYBRID
Use a stable 2.5D or 3D base for head motion and gaze, plus high-quality appearance assets for eyelids, eyes, mouth, and challenging poses. Keep motions parameterized; avoid enumerating every combination as separate video. Select the simplest approach that passes realism tests.

## 8. Motion controller
Define continuous parameters, not only discrete clip names:
- eye_gaze_x, eye_gaze_y
- eyelid_left, eyelid_right
- head_yaw, head_pitch, head_roll
- brow_left, brow_right
- breath_phase / shoulder_offset
- expression_intensity
- later: jaw_open, lip_round, lip_spread, viseme_weights
Implement a deterministic seeded motion scheduler for reproducible tests and a natural stochastic mode for production. Include blink intervals, occasional double blinks, brief eye saccades, gaze dwell, eyes-leading-head behavior, low-amplitude head drift, nods, and smooth return to neutral. Use constraints and easing to avoid exaggerated robotic behavior. Separate idle/listening/speaking state machines. No need for AI inference for basic idle scheduling.

## 9. Asset delivery — Netflix principle
The entire avatar library must NOT be loaded into memory.
- Load a tiny manifest and neutral/base assets first.
- Keep core idle/blink/gaze resources ready.
- Prefetch probable next movements opportunistically.
- Load optional head motion segments on demand.
- Keep compressed assets on disk/browser cache; decode only current and near-future data.
- Use a bounded LRU cache and explicit resource disposal for decoded frames and GPU textures.
- Avoid network streaming for the first local prototype; it introduces latency and complexity without benefit.
- For future web delivery use cacheable object storage/CDN and HTTP range requests or independently addressable chunks; evaluate WebCodecs or ordinary video decoding depending on actual asset format.
- Parameterized mesh animation may be substantially smaller than streaming motion videos; do not force video chunks if a few keyframes and rig parameters suffice.

## 10. Runtime architecture
Input portrait -> offline preprocessing -> compact avatar package
Avatar package -> manifest + asset manager -> face renderer
Motion scheduler -> animation parameters -> compositor -> video canvas
Metrics collector -> FPS, CPU, RAM, GPU memory estimate, startup latency, frame-time variance, cache hits, stutters
Later: streaming audio -> lightweight speech/viseme predictor -> mouth controller -> same compositor.

Suggested modular code:
- src/avatar/loader
- src/avatar/manifest
- src/avatar/renderer
- src/avatar/motion-controller
- src/avatar/eye-controller
- src/avatar/head-controller
- src/avatar/cache
- src/avatar/metrics
- src/avatar/asset-prep (offline tools)
- tests/fixtures
- docs/benchmarks

## 11. Technology candidates (evaluate, not blindly install)
Runtime: TypeScript, Vite, Three.js/WebGL, Canvas where adequate, requestAnimationFrame.
Asset preparation: Python isolated environment, image/mesh tools, FFmpeg for compressed clips, facial landmark estimation, optional depth/3D reconstruction models.
Video decoding if needed: browser video element first, then WebCodecs for frame control when supported.
Asset storage: local filesystem initially, browser Cache API/IndexedDB as needed.
Testing: browser performance tools, Playwright for deterministic behavior, frame capture, scripted movement scenarios.
Review the licenses of ALL code, model weights, datasets, and output-use terms before commercial integration. In particular, research-only or noncommercial lip-sync models cannot simply be included in a paid SaaS.

## 12. Hardware and resource plan
Available development computer (previously reported): Windows, NVIDIA GTX 1660 Ti 6 GB, approximately 16 GB RAM; verify on this connected machine before relying on it.
Runtime goal: 720p / 30 FPS, low CPU/GPU use, no continuously running neural generative video model.
Preliminary avatar-specific memory design target: 100–200 MB excluding browser/OS and speech model; not measured or guaranteed.
Compressed cache design target: approximately 8–16 MB for immediately relevant motion assets, adjustable based on fidelity.
A CPU-only VPS may serve metadata/assets but should not be assumed capable of photorealistic neural inference.
Offline avatar preparation may require a GPU or occasional cloud GPU. One-time GPU work is acceptable; continuous per-frame cloud GPU inference is undesirable.
Integrated graphics support is an aspiration that must be benchmarked.

## 13. Performance and quality acceptance criteria
Functional:
- Start from one authorized image.
- Maintain continuous silent animation for >= 60 seconds.
- Blink, gaze left/right, nod, and tilt without freezing or visible cuts.
- Motion transitions do not visibly reset to neutral abruptly.
Performance targets (to be measured):
- Sustained >= 30 rendered FPS at 720p on target hardware.
- No persistent stutter; record frame-time p50/p95/p99.
- Avatar-specific runtime memory initially <= 200 MB where feasible.
- Bounded cache with no unbounded growth during a 30-minute soak test.
- Record startup latency, asset decode costs, CPU usage, and GPU memory.
Quality:
- Blind side-by-side review against a real recorded reference of similar framing.
- Rate likeness preservation, natural blink, eye realism, head depth, texture stability, and absence of uncanny artifacts.
- Do not declare production realism solely from screenshots or one successful scripted demo.

## 14. Milestones and decision gates
M0 — Machine and environment audit: verify OS, GPU, drivers, Python/Node, existing tools; create repository/docs. No destructive changes or .env edits.
M1 — Baseline static portrait player: display, measure, resource accounting, asset manifest.
M2 — Eyes alive: blink, gaze, micro-saccades, eyelid deformation, natural randomness.
M3 — Head alive: subtle yaw/pitch/roll, nod, tilt, depth/occlusion, seamless blending.
M4 — Silent realism gate: 60-second natural sequence, benchmark, subjective review.
M5 — Audio integration: waveform-driven jaw prototype, then lightweight audio-to-viseme prediction using actual speech chunks, timing and coarticulation.
M6 — Live conversation: OpenAI Realtime audio, idle/listening/speaking state machine, lip-sync latency measurement.
M7 — Gestures: shoulders and later hands/arms after additional avatar representation.
M8 — Commercial SaaS and platform integrations only after the engine works.

## 15. Experiments to settle architecture
E1: 2D mesh blink/gaze on a real portrait — evaluate unnatural eyelid/eye texture.
E2: depth-aware head turn versus 3D rig versus short prepared clip — same image and motion.
E3: compressed texture/clip cache — compare decoded-memory and startup tradeoffs.
E4: 30-minute idle stress test — monitor drift, repetition, cache growth, FPS.
E5: visual comparison with a real human silent video; log failure cases.
Every experiment must include reproducible inputs, screenshots/video, resource metrics, and a written pass/fail decision.

## 16. Safety, consent, and integrity
Only use images the uploader owns or is authorized to animate; require explicit likeness consent in eventual product. Label AI-generated presenters appropriately where platform policy/law requires. Prevent impersonation and deceptive uses. Do not store private portrait uploads or API keys in public repositories. Keep .env files untouched unless specifically authorized.

## 17. Open questions
- Can we achieve convincing 3D head turns from one photo without neural inference at runtime?
- Which offline reconstruction method has commercially usable weights and acceptable identity preservation?
- How far can we move eyes and head before appearance assets break?
- Are blink and gaze better rendered by a mesh, neural-prepared layers, or hybrid?
- How much asset memory is actually required at 720p for convincing appearance?
- What device classes can run the renderer at 30 FPS?
- What exact facial realism tradeoff is acceptable for first commercial release?
- For eventual autonomous 24/7 streaming, what server-side rendering and broadcasting infrastructure is necessary?

## 18. Immediate next actions
1. Inspect connected machine hardware/software.
2. Create minimal source project and benchmark harness.
3. Select a consented test portrait (user-provided or properly licensed synthetic portrait).
4. Implement baseline portrait renderer and natural blink/gaze proof of concept.
5. Benchmark and compare head movement representations.
6. Document actual results rather than speculative performance.

## 19. Non-negotiable engineering rules
- Prioritize end-to-end working prototypes over mockups and claims.
- Keep the renderer independent of OpenAI, TikTok, and any particular speech provider.
- No unnecessary paid vendor subscriptions.
- No full animation library decoded into RAM.
- No continuously running generative GPU model unless cheaper approaches fail quality gates.
- No unexplained heavy dependencies.
- Measure before optimizing, and do not claim performance without tests.
- Preserve modularity, reproducibility, commercial-license diligence, and identity consistency.

This document is the project's starting source of truth. Update it as experiments confirm or reject assumptions.
