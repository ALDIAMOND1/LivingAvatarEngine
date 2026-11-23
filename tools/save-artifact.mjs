// Tiny local receiver used by the behaviour lab to save its contact sheet and
// results into tests/artifacts. Local only (127.0.0.1), accepts two fixed
// filenames, and exits after 10 minutes.
//   node tools/save-artifact.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'artifacts');
const allowed = new Set(['nia-behaviour-sheet.jpg', 'nia-behaviour-results.json', 'nia-control-sweep.jpg', 'nia-smiles.jpg', 'nia-speaking.jpg']);
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:8766');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const name = new URL(req.url, 'http://x').searchParams.get('name');
  if (req.method !== 'POST' || !allowed.has(name)) { res.statusCode = 400; res.end('bad request'); return; }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks)); res.end('saved'); console.log('saved', name); });
}).listen(8770, '127.0.0.1', () => console.log('artifact receiver on 8770'));
setTimeout(() => process.exit(0), 600000);
