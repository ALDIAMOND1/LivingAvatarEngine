// Generates the lab's real speech clip with OpenAI text-to-speech, using the
// key from a private text file (never printed). Run once:
//   node tools/make-lab-speech.mjs "C:\path\to\key-file.txt"
// The sentence is chosen to cover every mouth-shape class the lip-sync knows.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT = 'Hi, I\u2019m Nia. Maybe we both think the view from here is very good. Oh, you should see how five big ships move through the fog.';
const key = fs.readFileSync(process.argv[2], 'utf8').match(/sk-[A-Za-z0-9_-]{20,}/)?.[0];
if (!key) { console.error('No OpenAI key found in that file.'); process.exit(1); }
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'characters', 'nia', 'assets', 'audio');
fs.mkdirSync(dir, { recursive: true });
for (const model of ['gpt-4o-mini-tts', 'tts-1']) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, voice: 'marin', input: TEXT, response_format: 'mp3' }), signal: AbortSignal.timeout(60000) });
  if (!res.ok) { console.error(model, 'failed:', res.status, (await res.text()).replace(/sk-[\w*.-]+/g, 'sk-[masked]').slice(0, 200)); continue; }
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(dir, 'lab-speech.mp3'), bytes);
  fs.writeFileSync(path.join(dir, 'lab-speech.json'), JSON.stringify({ text: TEXT, model, voice: 'marin', bytes: bytes.length }, null, 1));
  console.log('saved lab-speech.mp3', bytes.length, 'bytes, model', model);
  process.exit(0);
}
process.exit(1);
