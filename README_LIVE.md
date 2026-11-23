# Live avatar — Phases 1 and 2

A 3D head, drawn in the viewer's browser, whose mouth follows the sound of any voice stream. No GPU is rented or owned: rendering and lip-sync run on the viewer's device, and the only running cost is the speech model.

This page is separate from the Nia portrait app (`index.html`) and changes none of its files. It reuses `server.mjs` as it is.

## The face

The default face is now a photoreal head: a Gaussian-splat avatar drawn with WebGL on the viewer's device (`src/live/splat-stage.js`, renderer `@myned-ai/gsplat-flame-avatar-renderer`, MIT). It takes 52 ARKit face weights, a neck rotation and a gaze offset each frame. Lip-sync comes from HeadAudio's mouth shapes converted in `src/live/viseme-arkit.js`; head, brow and smile come from the behaviour engine; blinking and eye movement are in the stage itself. Measured about 45–50 fps on this machine's Quadro K1200.

- The face in use is Nia's own, at `characters/nia/assets/avatar/nia.zip`, converted on 2026-11-22 from `nia-master.webp` with Alibaba's LAM pipeline (LAM-20K) on a rented L40S; `nia-preview.jpg` beside it shows the converter's own test render. If that file is missing the page falls back to a sample head ("Jane") from the gsplat-talkinghead project, whose origin and likeness rights are not documented.
- LAM's model weights are licensed non-commercial (CC BY-NC 4.0). That has to be cleared before Nia's avatar is used in a paid product.
- To convert another portrait: the converter, its Python environment and the scripts (`setup.sh`, `fix.sh`, `export_nia.py`, `run.sh`) are kept in the Higgsfield account's persistent storage under `/workspace/lam`. A new box needs `build-essential`, `cuda-nvcc-12-5` and the `lib*-dev-12-5` CUDA packages reinstalled with apt, then `run.sh` with the new image. The exported zip must contain an explicit folder entry (`name/`) or the renderer rejects it.
- The source portrait shows a smile, so Nia's resting face keeps a slight smile. A neutral, higher-resolution portrait would give a cleaner mouth.
- It is not Nuance-level: Nuance generates every video frame on server GPUs. Here the mouth interior, hair and shoulders are weaker and expressions are driven by rules, not generated.
- The stylised rig is still available for comparison at `live.html?character=standin`.

## Open it

Without a key (lip-sync tests only), any static server works, including the one `OPEN_NIA.cmd` starts:

    http://127.0.0.1:8765/live.html

For live conversation, start the server with the launcher, which reads the OpenAI key from a private text file (the first `sk-...` token in it) without printing it. The file can be filled in after the server has started.

    node tools/start-live.mjs "C:\path\to\key-file.txt"

Then open (use 127.0.0.1, not localhost; the server rejects other origins):

    http://127.0.0.1:8766/live.html

The launcher sets the model to `gpt-realtime-2.1-mini` unless `NIA_REALTIME_MODEL` is already set.

## The three buttons

- **Start conversation** — OpenAI Realtime over WebRTC through the local server. Full-duplex: talk over her and she stops and listens. With **Let her see me** ticked she also sees you: a still frame from your camera is sent each time you start speaking, and only the two most recent frames are kept in the conversation. Your own picture appears small in the corner. She uses what she sees to understand the moment; she never mirrors you. Billed by OpenAI.
- **Listen to me** — she only listens: eye contact, a slight tilt and smile, and nods at the pauses in what you say. Nothing leaves the machine. Add `?simulate` to the address to drive it with the synthetic voice instead of a microphone.
- **Play test voice** — a synthetic vowel voice run through the same pipeline, for machines without a microphone.

## How it fits together

    voice provider  ->  MediaStream of the agent's voice  ->  AvatarStage
                    ->  user-speech-start / stop          ->  ConversationState

- `src/live/voice-provider.js` — the provider contract and the providers behind the three buttons, including camera vision for OpenAI Realtime. Any speech model that yields a MediaStream can be added as another class; the avatar never sees which one is in use.
- `src/live/avatar-stage.js` — TalkingHead (three.js) draws the head; HeadAudio turns audio into viseme values on an audio worklet. Playback is delayed 100 ms so sound and mouth line up.
- `src/live/conversation-state.js` — off / idle / listening / thinking / speaking, with barge-in. "Speaking" is decided by the audio itself, because the model finishes generating a reply well before that reply has finished playing.
- `src/live/behaviour-engine.js` — the behaviour engine. From the conversation state and the loudness of each voice it produces small head and face movements: nods at the end of your phrases (and now and then during long ones), a glance away while thinking, and head beats with brow lifts on the stressed syllables of her own speech. All thresholds are in `TUNING` at the top of the file.
- `src/live/config.js` — character and library settings as data. A new character is a new entry, not a copy of the source.

## Starting it

Double-click `START_LIVE.cmd`. It starts the server with the key from `Desktop\API SPEECH.txt` and opens the page. Start the server from a normal shell or that script: when it is started through the Claude app's preview launcher it has no internet access and every conversation fails with "fetch failed".

## Live test, 2026-11-22

One live session against OpenAI Realtime (`gpt-realtime-2.1-mini`) with a silent test microphone, a test camera image (blue background, yellow circle, the text "HELLO 42" running off the right edge) and one typed question asking what she could see. She answered aloud, "I see a solid blue background with a yellow circle on the left, and the text 'HELLO 4' to the right", which matches the image as sent. Her mouth followed the reply, the state went idle, speaking, idle, and the provider reported no errors. JPEG camera frames are accepted.

## Changes after the first real call, 2026-11-22

Feedback from the first call with a real microphone: hair cut off, a white halo in the hair, a shovel-shaped mouth with poor lip-sync, a delay before she actually responded, a voice that sounded synthetic, and no body movement.

- Framing: Nia's source portrait is cropped through the top of her hair, so the frame is now a close video-call crop that ends inside that edge (`frame` in `config.js`). The real fix is a new portrait with the whole head in shot.
- Halo: the converter composites onto white, which leaves pale fringes around hair. The backdrop is now a light studio grey (`0xd9d8d6`) so the fringe blends in instead of glowing against a dark background.
- Mouth: `viseme-arkit.js` retuned for a real face (small jaw opening, lips do the work, no lower lip pulled straight down), shapes are eased between frames, and the mouth returns to rest when the audio stops (it used to freeze on the last shape).
- Body: the avatar file has a full upper-body skeleton. `splat-stage.js` now loops the asset's own idle clip and adds breathing through the chest and collar bones, slow posture shifts through the torso, and shares head movement with the neck.
- Connection: she now says hello as soon as the line is truly live, so there is no silent gap where it looks connected but is not.
- Voice: the launcher now uses `gpt-realtime-2.1` (the full model, more expressive and more expensive than the mini), and the session instructions describe how to speak like a person on a call instead of an assistant. `live.html?voice=cedar` tries another voice. The voices in the ChatGPT app are not all available through the API.
- Not done: studying a live Nuance call. Their browser check does not pass in an automated browser, in either the built-in pane or Chrome under automation.

## Verified

- `node --test tests/conversation-state.test.mjs tests/behaviour-engine.test.mjs` — 16 passing.
- In the browser on this machine (Quadro K1200): avatar loads; the test voice drives the mouth through several distinct visemes; the state follows the audio (speaking during phrases, idle in the gaps, off at the end).

## Not verified

- A live OpenAI conversation, including barge-in. No API key was available.
- Camera vision. The frame format (JPEG data URL) follows OpenAI's image-input docs, which only show PNG; untested without a key.
- How the behaviour looks. In the simulated listening run the engine fired nods from the live audio level, but the test browser drew only one or two frames a second, so smoothness, timing and amplitude have not been judged by eye. Expect to tune `TUNING`.
- Frame rate. The test browser was throttled, so there is no trustworthy number yet; read the fps counter on the page.

## Known limits

- The head is a stylised stand-in, not Nia and not photoreal. It is scaffolding: the product face must be a real-looking person, which is the next phase.
- The sample avatar is licensed CC BY-NC 4.0: prototype only, not for a paid product.
- three.js, TalkingHead, HeadAudio and the avatar load from the jsDelivr CDN, so the page needs internet even for the keyless tests.
- HeadAudio is tuned for English and is approximate; its own author describes the accuracy as far from optimal.
- Behaviour reacts to loudness and timing only. It does not understand what is said, makes no spoken backchannels ("mm-hm"), and the camera feeds the speech model only, not the nodding.
- Brow and smile values from the engine replace the avatar library's own values for those shapes while they are active.

## Hosted video face (trial) — `live.html?character=hosted`

Her face is generated as video on Simli's servers from her voice and streamed back, instead of being drawn on this computer. Nothing runs on the local graphics card.

- Put your Simli API key in `Desktop\SIMLI KEY.txt` (read by `tools/start-live.mjs`, never sent to the page; the page only gets a short-lived session token from `http://127.0.0.1:8767/simli/token`).
- Start with `START_LIVE.cmd`, then open `http://127.0.0.1:8766/live.html?character=hosted`.
- The trial uses a Simli stock face ("Anna"). Another stock face: add `&faceId=<id>`. A face made from Nia's own photo needs a paid Simli plan.
- Sessions are capped at 10 minutes and close after 2 minutes idle, to protect the free minutes.
- Status: page, SDK load, token service and the missing-key message are verified. A real session (picture, lip-sync, interruption, end call) has NOT been tested yet — it needs the key.
- In this mode the behaviour engine's head/face pose is not used; movement comes from the video model.

## Video face made on this computer — `live.html?character=video`

Real video frames of an avatar with the mouth repainted to match her voice, produced by a local service with no graphics card and no hosted service. Set-up, measured results and limits are in [tools/face-service/README.md](tools/face-service/README.md). In short: the picture quality is photo-real, but on the 2015 i7 this was built on it is not fast enough to run live; it is expected to run live on a PC with a graphics card (untested), and Nia does not yet exist in this format.
