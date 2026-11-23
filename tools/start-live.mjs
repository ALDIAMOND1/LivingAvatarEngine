// Starts server.mjs with the OpenAI key taken from a private text file, so the
// key is never typed into a terminal, pasted into chat, or stored in this
// project. The key is not printed.
//
//   node tools/start-live.mjs "C:\path\to\file-containing-the-key.txt"
//
// The file can contain anything; the first token that looks like an OpenAI key
// (starts with "sk-") is used. Without a file, OPENAI_API_KEY from the
// environment is used as before.
import fs from 'node:fs';

const file = process.argv[2] || process.env.LIVE_KEY_FILE;
function loadKey(quiet = false) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { if (!quiet) console.error(`Could not read the key file: ${err.code || err.message}`); return false; }
  const key = text.match(/sk-[A-Za-z0-9_-]{20,}/)?.[0];
  if (key) { process.env.OPENAI_API_KEY = key; console.log('OpenAI key loaded from the key file.'); return true; }
  if (!quiet) console.error(text.trim() ? 'No OpenAI key (sk-...) found in the key file yet.' : 'The key file is empty. Paste the key into it and save; it will be picked up automatically.');
  return false;
}
// server.mjs reads the key from the environment on every request, so the file
// can be filled in after the server has started.
if (file && !process.env.OPENAI_API_KEY && !loadKey()) {
  const timer = setInterval(() => { if (loadKey(true)) clearInterval(timer); }, 3000);
}
// The full model, not the "mini": its voice is noticeably more natural and
// expressive, at a higher price per minute. Set NIA_REALTIME_MODEL to
// gpt-realtime-2.1-mini to go back to the cheaper one.
process.env.NIA_REALTIME_MODEL ||= 'gpt-realtime-2.1';
await import('../server.mjs');

// Simli (hosted video face) session tokens. The Simli key is read from a second
// private text file and never reaches the browser; the page only gets a
// short-lived session token. Local only, and only the live page may call it.
const simliFile = process.argv[3] || process.env.LIVE_SIMLI_KEY_FILE;
const simliKey = () => { try { return fs.readFileSync(simliFile, 'utf8').match(/[A-Za-z0-9_-]{16,}/)?.[0] ?? null; } catch { return null; } };
const { default: http } = await import('node:http');
http.createServer(async (req, res) => {
  const origin = `http://127.0.0.1:${process.env.NIA_PORT || 8766}`;
  res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Headers', 'content-type');
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') return send(204, {});
  if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Local page only' });
  if (req.url === '/simli/status') return send(200, { ready: !!simliKey() });
  if (req.url !== '/simli/token' || req.method !== 'POST') return send(404, { error: 'Not found' });
  const key = simliKey();
  if (!key) return send(503, { error: 'No Simli key found. Put your Simli API key in the key file and try again.' });
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return send(413, { error: 'Too large' }); }
  let faceId; try { faceId = JSON.parse(raw || '{}').faceId; } catch { return send(400, { error: 'Bad request' }); }
  if (!/^[0-9a-f-]{36}$/i.test(faceId || '')) return send(400, { error: 'A faceId is required' });
  try {
    const r = await fetch('https://api.simli.ai/compose/token', { method: 'POST', headers: { 'x-simli-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ faceId, handleSilence: true, maxSessionLength: 600, maxIdleTime: 120 }), signal: AbortSignal.timeout(20000) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.session_token) return send(r.status === 200 ? 502 : r.status, { error: `Simli: ${JSON.stringify(body.detail ?? body).slice(0, 200)}` });
    send(200, { session_token: body.session_token });
  } catch (err) { send(502, { error: `Simli unreachable: ${err.message}` }); }
}).listen(8767, '127.0.0.1', () => console.log(`Simli token service: http://127.0.0.1:8767 (key found: ${!!simliKey()})`));
