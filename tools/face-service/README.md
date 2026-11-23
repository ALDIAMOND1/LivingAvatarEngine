# Face service — a real-video mouth made on your own computer

`live.html?character=video` shows a face made of real video frames with the mouth area repainted to match the voice. It is produced by this local service using [LiteAvatar](https://github.com/HumanAIGC/lite-avatar) (MIT). No hosted service and no per-minute cost.

## Status (measured 2026-11-23 on an Intel i7-6700 from 2015, no graphics card used)

| What | Result |
|---|---|
| Offline: sample avatar speaking an 8 s clip to a video file | Works. Photo-real face, natural lips and teeth. |
| Drawing one face frame | 49 ms alone (about 20 a second); 60–70 ms inside the running service |
| Turning one second of voice into mouth movement | about 300 ms per step when fed live in short pieces |
| **Live, in the page** | **Works but not in real time on this PC**: about 5 frames a second and a 4 s lag on an idle processor, worse when the PC is busy |
| Live on a PC with a graphics card (for example a GTX 1660 Ti) | Expected to be real time; **not tested** |
| Live call with OpenAI voice, interruption, ending a call in this mode | Wired, **not tested** |
| Nia in this format | **Not available.** LiteAvatar publishes ready-made avatars only, no tool to make one. |

The service measures the computer at start-up and picks the frame rate and step length it can sustain, and it uses an NVIDIA card automatically if `onnxruntime-gpu` and a CUDA build of PyTorch are installed. It never requires one.

## Set-up on another PC

The model code and files (about 1.3 GB) are not in this repository. Put them in a folder named `lite-avatar-test` **next to** this project (or point `LIVE_FACE_DIR` at it):

```
lite-avatar-test/
  lite-avatar/      git clone https://github.com/HumanAIGC/lite-avatar
  venv/             Python 3.10 environment
  sample/preload/   contents of lite-avatar/data/sample_data.zip
```

1. Python 3.10 environment, then install (CPU build shown):
   `torch==2.1.1 torchvision==0.16.1 torchaudio==2.1.1` (from `https://download.pytorch.org/whl/cpu`, or the `cu118` index for a graphics card), `numpy==1.23.0 onnxruntime==1.20.1 onnx<1.17 opencv-python==4.11.0.86 librosa==0.9.2 soundfile pydub loguru scipy==1.11.4 tqdm typeguard==2.13.3 PyYAML jieba kaldiio sentencepiece torch-complex humanfriendly jamo editdistance h5py hydra-core omegaconf resampy imageio-ffmpeg jaconv numba==0.60.0 "setuptools<81" six oss2 modelscope websockets`.
   For a graphics card also install `onnxruntime-gpu` in place of `onnxruntime`.
2. Model files, from ModelScope `HumanAIGC-Engineering/LiteAvatarGallery`, folder `lite_avatar_weights/` (this is what `lite-avatar/download_model.bat` fetches):
   - `model_1.onnx` (176 MB) → `lite-avatar/weights/`
   - `model.pb` (about 850 MB) → `lite-avatar/weights/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch/`
   - `lm.pb` (226 MB) → the same folder's `lm/`
3. Unzip `lite-avatar/data/sample_data.zip` into `lite-avatar-test/sample/` so that `sample/preload/bg_video.mp4` exists.
4. Run `START_LIVE.cmd`. Wait for `face service: listening`, then open `http://127.0.0.1:8766/live.html?character=video`.

## Checking speed without a browser

```
venv\Scripts\python tools\face-service\measure.py <16 kHz mono 16-bit wav>
```

It plays the file to the running service in real time and prints the frames per second delivered and the voice delay needed for the picture to keep up.

## Known limits

- The speech-feature model inside LiteAvatar was trained on Chinese speech. English lip accuracy needs judging by eye.
- The voice is played late by the time the service needs (shown on the page as "voice delayed"). On a fast machine the design target is under one second.
- Head movement, blinks and breathing come from the avatar's own video clip, not from this project's behaviour engine.
