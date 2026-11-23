# NIA / Character 01 — Voice-first photorealistic avatar

**ID:** nia-001 | **Character status:** Design specified; visual assets and photorealistic engine NOT yet built.

Nia is an **original fictional** adult digital-human presenter. The user's Nuance Labs screenshot sets the **quality and framing direction**, not a license to reproduce that person's identity, photo, or proprietary technology.

## Goal
One character that appears convincingly human while silently resting, listens to voice, understands spoken commands, gives spoken answers, and synchronizes mouth and facial motion with actual audio. No button-driven workflow as the primary product. No continuous neural video inference at runtime.

## This character pack
- `config/profile.json` — original character identity, visual appearance and personality
- `config/states.json` — idle/listening/thinking/speaking/gesture/error states
- `config/motions.json` — timing, degrees, blink/gaze/head/expression parameterization
- `config/voice.json` — microphone workflow, intents, dialogue adapters and privacy
- `config/assets.json` — required asset paths, readiness and cache strategy
- `config/quality-gates.json` — acceptance criteria and provisional performance budgets
- `docs/CHARACTER_BIBLE.md` — creative direction and behavior rules
- `docs/ASSET_PIPELINE.md` — preparation and realism experiments
- `docs/VOICE_FIRST_WORKFLOW.md` — conversational interaction architecture
- `docs/BUILD_CHECKLIST.md` — prioritized implementation and validation tasks
- `docs/RESOURCE_BUDGET.md` — performance targets and measurement approach
- `assets/` — intended placement for future approved/generated source and prepared assets
- `validate.mjs` — schema/consistency check of pack configuration
- `intent-parser.mjs` — dependency-free deterministic spoken-command recognizer

## What exists versus what doesn't
**Exists:** complete metadata/configuration, command vocabulary, engineering plan and validation tool.

**Missing (blocking true lifelike interaction):** a unique original portrait, suitable reconstructed eyelids/eyes and head geometry, tested photorealistic motion/rendering, an integrated microphone + speech pipeline, TTS/Realtime output and audio-driven facial deformation.

The earlier root `index.html` is a simple motion-controller demo, **not** proof of avatar realism and not the final user experience.

## Test the pack
Open PowerShell in this folder and run `node .\validate.mjs`.
No npm installation, API key, cloud connection, or model download is required for the pack check.

## Principles
Commercial-use licensing and subject consent; natural restraint; one identity across poses; privacy; measurable quality; affordable runtime; no invented completion claims.
