# Measures the face service without a browser: plays a sound file to it in real
# time and reports how long after each sound its frame arrived.
#   python measure.py <16 kHz mono 16-bit wav> [ws://127.0.0.1:8768]
import asyncio, json, struct, sys, time, wave
import numpy as np, websockets

async def main():
    wav = wave.open(sys.argv[1], 'rb'); assert wav.getframerate() == 16000 and wav.getnchannels() == 1
    pcm = wav.readframes(wav.getnframes()) + b'\0' * 32000 * 3            # three seconds of silence after it
    url = sys.argv[2] if len(sys.argv) > 2 else 'ws://127.0.0.1:8768'
    async with websockets.connect(url, origin='http://127.0.0.1:8766', max_size=2 ** 22) as ws:
        hello = json.loads(await ws.recv()); lat, speech = [], 0
        t0 = time.perf_counter()
        async def feed():
            for i in range(0, len(pcm), 3200):
                await ws.send(pcm[i:i + 3200])
                await asyncio.sleep(max(0, t0 + (i + 3200) / 32000 - time.perf_counter()))
        async def read():
            nonlocal speech
            async for msg in ws:
                if isinstance(msg, str): continue
                k, t, flags = struct.unpack('<IdI', msg[:16])
                if t < 0: continue
                if flags & 1: speech += 1; lat.append(time.perf_counter() - t0 - t)
        reader = asyncio.create_task(read()); await feed(); await asyncio.sleep(2.5); reader.cancel()
    a = np.array(lat)
    print(json.dumps({'service_fps': hello['fps'], 'frame_ms_at_start': hello['frameMs'], 'speech_seconds': round(wav.getnframes() / 16000, 2),
        'speech_frames': speech, 'frames_per_second_delivered': round(speech / (wav.getnframes() / 16000), 1),
        'delay_needed_s': {'median': round(float(np.median(a)), 2), 'p95': round(float(np.percentile(a, 95)), 2), 'max': round(float(a.max()), 2)}}, indent=1))
asyncio.run(main())
