# Face service — Nia's real-video mouth, made on your own computer

`live.html?character=video` shows Nia as real video frames with the mouth area repainted to match her voice. It is produced by a small local service on the processor only: no graphics card, no hosted service, no per-minute cost.

## Status (measured 2026-11-23 on an Intel i7-6700 from 2015, no graphics card used)

| What | Result |
|---|---|
| Drawing one frame of Nia (480x526) | about 20 ms, so 50 a second possible; 25 are needed |
| Voice model, per 120 ms step | 7 ms |
| Live in the page, test speech clip | 25 frames a second shown; frames arrive ahead of their moment (3 of 173 late in one run) |
| Voice-to-lip timing | lips start within about 0.1 s of the voice being heard |
| Voice delay needed for that sync | about 1.0 s on this PC (0.75 s is built into the models, the rest is safety margin) |
| A full live call with OpenAI voice, interrupting her, ending a call | wired, **not yet tested** |
| English lip accuracy by ear | **not judged** (the voice model was trained on Chinese speech) |

## How it works

- `nia_service.py` — the live service. Her voice comes in over a local WebSocket as it is spoken; video frames go back, each stamped with the moment of sound it belongs to.
- `nia_runtime.py` — loads the avatar and runs the two models with ONNX Runtime. Also an offline check: `python nia_runtime.py <avatar folder> <16 kHz wav> out.mp4`.
- `measure.py` — plays a wav to the running service in real time and prints frames per second delivered and the delay the picture needs.
- `src/live/video-stage.js` — the page side. It first times the real path ("getting her ready"), then holds her voice back by exactly that long and shows each frame when its sound is heard, so voice and lips stay together. The Start buttons stay disabled until this is done.

The avatar lives in `characters/nia/assets/video/`: all 5,603 frames of her training video at display size (`footage_NN.pack` + `footage.json`, built by `build_pack.py`), her own mouth model `feathertalk_144.onnx` (21 MB) and the shared voice model `feather_hubert.onnx` (13 MB).

While she is quiet the picture wanders through her 10 s of resting footage; while she speaks it plays footage of her speaking, so her head and brows move as they do when she talks. Each change picks a frame where her head is in nearly the same place and cross-fades over a quarter of a second, and a slow sway is added so no stretch plays back identically. Her mouth is blended in through a soft-edged oval from under the nose to the chin; every pixel outside it is her real footage.

## Running it on another PC

Any Python 3.10+ with four packages:

```
pip install onnxruntime opencv-python numpy websockets
```

Then `START_LIVE.cmd`. If that Python is not the one on the PATH, set `LIVE_FACE_PYTHON` to its `python.exe`. Wait for `face service: listening`.

## How Nia's avatar was made (the "avatar factory")

1. **Speech**: about 3 min 44 s of varied English in her live voice (OpenAI text-to-speech), starting with 10 s of silence that becomes her resting frames.
2. **Video**: [Ditto](https://github.com/antgroup/ditto-talkinghead) (Apache-2.0) turned her one portrait plus that speech into a 25 fps talking video. This needs an NVIDIA card but not in real time; it took about 7 minutes on a rented L40S.
3. **Training**: [FeatherTalk](https://github.com/anliyuan/FeatherTalk) (Apache-2.0) preprocessing (8 min) and training. Training was stopped at epoch 55 of 200 because close-ups at epoch 49 looked the same as at epoch 19.
4. **Export** to ONNX with FeatherTalk's `FeatherTalk-CPP/tools/export_models.py`.

Whole rental: 54 minutes, 63.99 Higgsfield credits. Another avatar is the same four steps with a different portrait. The full training video, checkpoint and all face points are kept outside the repository (`avatar-factory/nia/bundle`, and a copy in Higgsfield storage at `/workspace/nia-feathertalk/bundle.zip`).

## Known limits

- Her mouth is drawn at 144x144 pixels and scaled up, so it is slightly soft in close-up. At the size shown on the page it holds up.
- Her video comes from a generated talking video, so the mouth can only be as good as that video was.
- Head and brow movement while speaking comes from footage of her saying other things, so it is natural but not tied to the meaning of what she is saying now, and it is milder than Nuance's. Her resting footage is only 10 s long. Emotions and gestures from the conversation are not shown in this mode yet.
- Her replies are heard about one second after they arrive, which is the price of exact lip sync with models that look ahead in the sound.

`face_service.py` is the earlier LiteAvatar experiment (sample avatar only, too slow live on this PC); it is kept for reference and is no longer started by the launcher.
