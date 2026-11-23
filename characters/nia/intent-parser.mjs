/**
 * Ava spoken-command intent parser (no microphone; no LLM).
 * Takes a transcript and a voice config. Does not produce physical movements
 * without a real avatar controller connected to its action outputs.
 */
export function normalizeSpeech(value) {
  return String(value ?? '').toLocaleLowerCase('en-US').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function parseVoiceIntent(transcript, config) {
  const raw = normalizeSpeech(transcript);
  if (!raw) return { kind: 'empty', transcript: '' };
  if (/\b(do not|don t|never|please don t|do not want you to)\b/.test(raw)) {
    return { kind: 'dialogue', transcript: raw, reason: 'negation_or_ambiguous' };
  }
  const candidates = [];
  for (const command of config?.commands ?? []) {
    for (const phrase of command.phrases ?? []) {
      const p = normalizeSpeech(phrase);
      if (!p) continue;
      if ((' ' + raw + ' ').includes(' ' + p + ' ')) candidates.push({ command, phrase: p });
    }
  }
  if (!candidates.length) return { kind: 'dialogue', transcript: raw };
  candidates.sort((a,b)=>b.phrase.length-a.phrase.length);
  const winner = candidates[0];
  return {kind:'command',id:winner.command.id,action:winner.command.action,spokenAck:winner.command.spokenAck,matchedPhrase:winner.phrase,transcript:raw};
}
