// Live avatar configuration. Everything character-specific is data here, so a
// new character is a new entry rather than a copy of the engine source.
const CDN_TALKINGHEAD = 'https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.8';
const CDN_HEADAUDIO = 'https://cdn.jsdelivr.net/gh/met4citizen/HeadAudio@1.1.0/dist';

export const lipsync = {
  module: `${CDN_HEADAUDIO}/headaudio.min.mjs`,
  worklet: `${CDN_HEADAUDIO}/headworklet.min.mjs`,
  model: `${CDN_HEADAUDIO}/model-en-mixed.bin`,
  // HeadAudio needs 50-100 ms to classify a sound; playback is delayed by the
  // same amount so the mouth and the voice line up.
  playbackDelaySec: 0.1,
};

export const characters = {
  // Photoreal head (Gaussian splat), drawn on the viewer's device. This is a
  // sample face shipped with the open-source gsplat-talkinghead project; its
  // origin and likeness rights are not documented, so it is for evaluation only.
  photoreal: {
    name: 'Nia',
    note: 'Sample photoreal head, not Nia’s own face yet.',
    renderer: 'splat',
    avatar: {
      url: 'https://cdn.jsdelivr.net/gh/NavodPeiris/gsplat-talkinghead@main/gsplat-talkinghead/assets/Jane.zip',
      mouthGain: 1,        // how wide the mouth opens for a given sound
    },
  },
  // Video face made on this computer's processor by the local face service
  // (live.html?character=video). Uses LiteAvatar's sample avatar until Nia has
  // her own avatar in that format.
  video: {
    name: 'Sample avatar',
    note: 'Video face drawn on this computer, no graphics card (LiteAvatar sample, not Nia yet).',
    renderer: 'video',
    avatar: { delaySec: 0.95 },
  },
  // Hosted video face (live.html?character=hosted). Uses one of Simli's stock
  // faces for the trial; a custom face from Nia's photo needs a paid Simli plan.
  hosted: {
    name: 'Nia',
    note: 'Hosted video face (Simli stock face for the trial).',
    renderer: 'simli',
    avatar: { faceId: '14c60d62-6ebf-424d-b626-1f4f91c33b04' },   // "Anna", Simli's default preset
  },
  // Stylised rig, kept only as a fallback for comparison (?character=standin).
  standin: {
    name: 'Nia',
    note: 'Stand-in 3D head. Not Nia’s likeness yet.',
    renderer: 'rig',
    avatar: {
      // Ready Player Me sample avatar shipped with TalkingHead.
      // CC BY-NC 4.0: fine for this prototype, NOT usable in a paid product.
      url: `${CDN_TALKINGHEAD}/avatars/brunette.glb`,
      body: 'F',
      avatarMood: 'neutral',
    },
    // Head and shoulders only: no hands in frame.
    view: { cameraView: 'head', cameraDistance: 0.6 },
  },
};

// Nia's own photoreal head, once it has been converted from her portrait into
// the LAM avatar format. Drop the converted file here and it is used
// automatically; until then the sample head stands in.
export const NIA_AVATAR_URL = './characters/nia/assets/avatar/nia.zip';

export async function pickCharacter(search = globalThis.location?.search ?? '') {
  const params = new URLSearchParams(search);
  const base = characters[params.get('character')] ?? characters.photoreal;
  const url = params.get('avatar');
  if (params.get('faceId') && base.renderer === 'simli') base.avatar = { ...base.avatar, faceId: params.get('faceId') };
  if (params.get('lipsync') === 'model') base.avatar = { ...base.avatar, lipsync: 'model' };
  if (url) return { ...base, avatar: { ...base.avatar, url } };
  if (base === characters.photoreal) {
    const own = await fetch(NIA_AVATAR_URL, { method: 'HEAD' }).then(r => r.ok).catch(() => false);
    // Nia's source portrait is cropped through the top of her hair, so the frame
    // is set like a close video call: it ends just inside that edge.
    if (own) return { ...base, note: '', avatar: { ...base.avatar, url: NIA_AVATAR_URL, frame: { centerY: 0.5, height: 0.385 } } };
  }
  return base;
}
