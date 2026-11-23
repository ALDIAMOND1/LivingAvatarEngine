// Worker that runs the audio-to-face model (wav2arkit_cpu, Apache-2.0, built
// on LAM's audio-to-expression model for exactly this kind of avatar). It runs
// here, off the main thread, so the avatar keeps drawing while it works.
//   in:  { type: 'load' } | { type: 'run', id, audio: Float32Array @16 kHz }
//   out: { type: 'progress', value } | { type: 'ready', loadMs } | { type: 'error', message }
//        { type: 'frames', id, count, data: Float32Array(count * 52), ms }
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';
const MODEL = 'https://huggingface.co/myned-ai/wav2arkit_cpu/resolve/main/wav2arkit_cpu.onnx';
let ort = null, session = null, inputName = '', outputName = '';
const localSizes = { 'wav2arkit_cpu.onnx': 1862753, 'wav2arkit_cpu.onnx.data': 402063360 };   // a stored file of any other size is ignored

// The weights are about 400 MB. They are kept in the browser's Cache Storage
// after the first download so later visits start at once.
async function fetchCached(url, onProgress) {
  // Stored in the browser's private file system: the ordinary cache refused a file this large.
  const name = url.split('/').pop();
  const dir = await navigator.storage?.getDirectory?.().catch(() => null);
  if (dir) {
    try {
      const file = await (await dir.getFileHandle(name)).getFile();
      const size = Number(localSizes[name] ?? 0);
      if (file.size > 0 && (!size || file.size === size)) return new Uint8Array(await file.arrayBuffer());
    } catch { /* not stored yet */ }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0, reader = res.body.getReader(), parts = [];
  for (let got = 0; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length; onProgress(total ? got / total : 0);
  }
  const blob = new Blob(parts);
  if (dir) {
    // Best effort; a full disk must not stop the call. Written under a temporary
    // name first so an interrupted save is never mistaken for the real file.
    (async () => {
      const tmp = await dir.getFileHandle(`${name}.part`, { create: true });
      const w = await tmp.createWritable(); await w.write(blob); await w.close();
      if (tmp.move) await tmp.move(name);
      else { const out = await (await dir.getFileHandle(name, { create: true })).createWritable(); await out.write(blob); await out.close(); await dir.removeEntry(`${name}.part`).catch(() => {}); }
      postMessage({ type: 'stored', name, bytes: blob.size });
    })().catch(err => postMessage({ type: 'stored', name, error: String(err?.message ?? err) }));
  }
  return new Uint8Array(await blob.arrayBuffer());
}

async function load() {
  const t0 = performance.now();
  const graph = await fetchCached(MODEL, () => {});
  const weights = await fetchCached(`${MODEL}.data`, value => postMessage({ type: 'progress', value }));
  // The viewer's graphics card first (several times faster where it works),
  // then the processor. Each attempt gets its own copy of the weights.
  let device = 'cpu';
  const attempts = (await self.navigator?.gpu?.requestAdapter?.().catch(() => null)) ? ['webgpu', 'wasm'] : ['wasm'];
  for (const provider of attempts) {
    try {
      const mod = await import(`${ORT}${provider === 'webgpu' ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs'}`);
      ort = mod.default ?? mod;
      ort.env.wasm.wasmPaths = ORT; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
      session = await ort.InferenceSession.create(graph.slice(), { executionProviders: [provider], externalData: [{ path: 'wav2arkit_cpu.onnx.data', data: weights.slice() }] });
      inputName = session.inputNames[0]; outputName = session.outputNames[0];
      await run(new Float32Array(3200));                        // warm-up, so the first real chunk is not slow
      device = provider === 'webgpu' ? 'graphics card' : 'processor';
      break;
    } catch (err) { session = null; if (provider === attempts[attempts.length - 1]) throw err; }
  }
  postMessage({ type: 'ready', loadMs: Math.round(performance.now() - t0), device });
}

async function run(audio) {
  const out = (await session.run({ [inputName]: new ort.Tensor('float32', audio, [1, audio.length]) }))[outputName];
  const width = out.dims[out.dims.length - 1], length = out.dims[out.dims.length - 2];
  const count = Math.min(length, Math.round(audio.length / 16000 * 30) || length);
  return { count, data: Float32Array.from(out.data.subarray(0, count * width)) };
}

let queue = Promise.resolve();                                 // the session is not re-entrant
onmessage = e => {
  const m = e.data;
  if (m.type === 'load') queue = queue.then(load).catch(err => postMessage({ type: 'error', message: String(err?.message ?? err) }));
  if (m.type === 'run') queue = queue.then(async () => {
    if (!session) return;
    const t0 = performance.now(), { count, data } = await run(m.audio);
    postMessage({ type: 'frames', id: m.id, count, data, ms: performance.now() - t0 }, [data.buffer]);
  }).catch(err => postMessage({ type: 'error', message: String(err?.message ?? err) }));
};
