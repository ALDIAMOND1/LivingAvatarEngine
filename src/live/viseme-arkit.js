// Converts the 15 mouth shapes ("visemes") that HeadAudio hears in a voice into
// ARKit face blend-shape weights, which is what photoreal head renderers take.
// A few kilobytes of arithmetic instead of a 400 MB audio-to-face model: less
// precise, but instant and free. Pure data and maths, unit-tested under Node.
//
// Tuned for a real face: in ordinary speech the jaw opens only a little and the
// lips do most of the work. Large jaw values or pulling the lower lip straight
// down give a square, shovel-shaped mouth, so both are kept small here and
// vowels are shaped by rounding (funnel, pucker) or a slight widening instead.
const S = (v, ...names) => Object.fromEntries(names.map(n => [n, v]));
const LOWER = ['mouthLowerDownLeft', 'mouthLowerDownRight'];
const UPPER = ['mouthUpperUpLeft', 'mouthUpperUpRight'];
const WIDE = ['mouthStretchLeft', 'mouthStretchRight'];
const SMILE = ['mouthSmileLeft', 'mouthSmileRight'];
const PRESS = ['mouthPressLeft', 'mouthPressRight'];
export const VISEME_SHAPES = {
  viseme_sil: {},
  viseme_PP: { mouthClose: 0.06, ...S(0.35, ...PRESS), ...S(0.12, 'mouthRollLower', 'mouthRollUpper') },
  viseme_FF: { jawOpen: 0.03, mouthRollLower: 0.35, ...S(0.12, ...UPPER) },
  viseme_TH: { jawOpen: 0.08, tongueOut: 0.12, ...S(0.06, ...LOWER) },
  viseme_DD: { jawOpen: 0.08, ...S(0.07, ...LOWER), ...S(0.06, ...UPPER) },
  viseme_kk: { jawOpen: 0.10, ...S(0.05, ...WIDE) },
  viseme_CH: { jawOpen: 0.07, mouthFunnel: 0.32, mouthPucker: 0.14 },
  viseme_SS: { jawOpen: 0.04, ...S(0.12, ...WIDE), ...S(0.10, ...SMILE) },
  viseme_nn: { jawOpen: 0.07, ...S(0.05, ...LOWER) },
  viseme_RR: { jawOpen: 0.08, mouthFunnel: 0.22, mouthPucker: 0.12 },
  viseme_aa: { jawOpen: 0.30, ...S(0.08, ...LOWER), ...S(0.06, ...UPPER) },
  viseme_E: { jawOpen: 0.17, ...S(0.10, ...WIDE), ...S(0.08, ...SMILE), ...S(0.05, ...UPPER) },
  viseme_I: { jawOpen: 0.10, ...S(0.14, ...WIDE), ...S(0.12, ...SMILE) },
  viseme_O: { jawOpen: 0.22, mouthFunnel: 0.42, mouthPucker: 0.20 },
  viseme_U: { jawOpen: 0.10, mouthFunnel: 0.30, mouthPucker: 0.45 },
};

const FULL = 0.65; // HeadAudio's default peak value for a viseme

// visemes: { viseme_aa: 0..~0.7, ... }  ->  adds ARKit weights into `out`.
export function visemesToArkit(visemes, out = {}, gain = 1) {
  for (const [name, value] of Object.entries(visemes)) {
    const shape = VISEME_SHAPES[name];
    if (!shape || value <= 0.001) continue;
    const k = Math.min(1.2, value / FULL) * gain;
    for (const [key, weight] of Object.entries(shape)) out[key] = Math.min(1, (out[key] ?? 0) + weight * k);
  }
  return out;
}

// Eases a face frame toward a target so the mouth glides between shapes
// instead of snapping. `state` is kept between calls by the caller.
export function smoothFace(state, target, dtMs, tauMs = 55) {
  const k = 1 - Math.exp(-dtMs / tauMs);
  for (const key of new Set([...Object.keys(state), ...Object.keys(target)])) {
    const next = (state[key] ?? 0) + ((target[key] ?? 0) - (state[key] ?? 0)) * k;
    if (next < 0.002 && !(key in target)) delete state[key]; else state[key] = next;
  }
  return state;
}
