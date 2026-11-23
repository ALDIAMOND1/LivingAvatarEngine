# Resource and Deployment Targets (Unverified Until Measured)

## Known connected system observation
Connected Windows PC was previously observed as NVIDIA Quadro K1200, 4GB VRAM, Windows 11, Node.js 26, Python 3.13. Verify again for performance and driver capability. Do not confuse with another machine previously mentioned as GTX 1660 Ti.

## Initial targets
Output: 720p at 30 FPS. Avatar-specific memory: aim for <= 200 MB, excluding browser/process overhead and speech models. Compressed hot cache: 8-16 MB target. FPS and memory are hypotheses until tested with Ava's final actual assets.

## Why the asset format matters
A 720 x 1280 RGBA uncompressed frame is ~3.52MiB. Storing 60 seconds x 30FPS as individual RGBA frames would take ~6.18GiB even before additional buffers, completely unacceptable. Prefer compact geometry + texture and motion parameters with optional small appearance-correction patches. If video clips are used, keep them compressed on disk/CDN, decode only nearby frames, and aggressively release GPU resources.

## Netflix-like loading
Neutral essential assets first; lazy-load only needed geometry/view-correction data; prefetch probable transitions; track cache hits and in-memory decoded textures; evict old assets. Network chunk streaming is a future distribution technique, not a substitute for correct animation representation.

## Measurements required
Cold start ms, warm start ms, displayed/decoded FPS, frame p95 and p99, available GPU memory, browser working set, texture allocation, average/peak CPU and GPU use, 30-minute cache growth, gestures-to-render latency, speech audio-to-mouth offset.

## Cost structure
Offline one-time preparation may consume GPU. Ongoing rendering on customer device can have low cloud GPU cost but requires an active browser/device. 24/7 unattended livestream servers need rendering and broadcast resources. Speech/LLM provider costs are separate.
