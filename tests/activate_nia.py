from pathlib import Path
import json, shutil, hashlib

root=Path(r'C:\Users\aldia\Downloads\LivingAvatarEngine')
nia=root/'characters'/'nia'
ava=root/'characters'/'ava'
assert nia.is_dir() and ava.is_dir(), 'Expected character folders'
photo=nia/'assets'/'portrait'/'nia-master.webp'
eyes=nia/'assets'/'face'/'nia-eye-atlas.webp'
assert photo.stat().st_size>10000 and eyes.stat().st_size>5000, 'Nia assets not ready'
print('Nia source verified',photo.stat().st_size,eyes.stat().st_size)

# The original Ava remains an untouched archived character.
for stale in [nia/'assets'/'portrait'/'ava-master.webp',nia/'assets'/'face'/'ava-eye-atlas.webp']:
    if stale.exists():stale.unlink()

cfg=nia/'config'
profile=json.loads((cfg/'profile.json').read_text(encoding='utf-8'))
profile.update(id='nia-001',name='Nia',status='photographic_eye_prototype')
profile['vision']='Nia is an original photorealistic, voice-first friendly companion with natural curls, freckles, and a warm smile.'
profile['appearance']={
  'agePresentation':'Adult',
  'skin':'Warm medium-brown complexion; visible freckles across nose and cheeks; detailed natural skin texture',
  'hair':'Voluminous natural dark curls gathered into a loose high puff with face-framing tendrils; no braids',
  'eyes':'Dark-brown naturally proportioned eyes with realistic catchlights and subtle lashes',
  'face':'Distinct soft oval/rounded facial structure, broad natural smile with teeth, freckles, warm cheeks',
  'clothes':'Cream or ivory cable-knit sweater',
  'accessories':'Small gold stud earrings',
  'framing':'Head and shoulders against a muted gray studio background',
  'background':'Medium neutral-gray studio',
  'lighting':'Soft even front studio lighting with mild natural shadow contrast',
  'restExpression':'Warm, relaxed, genuine smile'
}
profile['role']=['Friendly AI companion','Learning guide','Live question-and-answer presenter','Customer support host']
profile['personality']={'tone':'Warm, encouraging, practical, friendly, concise','tempo':'Natural and unhurried',
 'listening':'Direct attentive gaze, subtle acknowledgments, avoid excessive nods',
 'speaking':'Clear natural speech with restrained expression and gestures','defaultLanguage':'en-US'}
profile['source']={'type':'original_synthetic_portrait','consentRequired':False,'sourceImageAvailable':True,
 'nuanceScreenshotRole':'style benchmark only, not identity source',
 'notes':'Original Nia design selected from a three-character concept board. Neutral and eye-state portraits were generated for this character.'}
(cfg/'profile.json').write_text(json.dumps(profile,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

assets=json.loads((cfg/'assets.json').read_text(encoding='utf-8'))
assets['characterId']='nia-001'
assets['assets']=[
 {'id':'originalPortrait','path':'assets/portrait/nia-master.webp','required':True,'status':'ready','source':'ORIGINAL_SYNTHETIC_NIA','description':'Nia 512x512 neutral studio portrait'},
 {'id':'eyePoseAtlas','path':'assets/face/nia-eye-atlas.webp','required':True,'status':'ready','source':'ORIGINAL_SYNTHETIC_NIA','description':'Feathered photographic Nia blink, gaze-right and gaze-left strips'},
 {'id':'neutralTexture','path':'assets/face/neutral.ktx2','required':True,'status':'missing','source':'OFFLINE_PREP','description':'Future expressive facial texture for real 3D/2.5D rig'},
 {'id':'faceGeometry','path':'assets/face/face.glb','required':True,'status':'missing','source':'OFFLINE_PREP','description':'Future head mesh with depth, eyelid rig and natural occlusions'},
 {'id':'speechMouth','path':'assets/face/mouth-atlas.ktx2','required':False,'status':'missing','source':'OFFLINE_PREP','description':'Future genuine audio-viseme mouth, teeth and jaw states'}
]
assets['cache']['startup']=['originalPortrait','eyePoseAtlas']
(cfg/'assets.json').write_text(json.dumps(assets,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

for name in ['README.md','docs/CHARACTER_BIBLE.md','docs/ASSET_PIPELINE.md','docs/VOICE_FIRST_WORKFLOW.md','docs/BUILD_CHECKLIST.md','docs/RESOURCE_BUDGET.md','assets/README.md']:
    p=nia/name
    if p.exists():
        s=p.read_text(encoding='utf-8').replace('Ava','Nia').replace('AVA','NIA').replace('ava-001','nia-001').replace('ava-master.webp','nia-master.webp').replace('ava-eye-atlas.webp','nia-eye-atlas.webp')
        p.write_text(s,encoding='utf-8')
(nia/'docs'/'NIA_IDENTITY.md').write_text(
 '# Nia — Original identity\n\nSelected from the center panel of the original character collection. '
 'Nia has a distinct soft oval/rounded face, natural curly puff and loose tendrils, '
 'freckles across her cheeks and nose, a broad smile, gold studs, and an ivory cable-knit sweater. '
 'The photograph and eye-state asset package are now built from a matching new synthetic pose sheet; '
 'not from Nuance Labs imagery. This is a light photographic compositor, not a fully rigged 3D digital human.\n',encoding='utf-8')

# New distinct Nia modules, preserving Ava modules for archive.
ava_motion=(root/'src'/'ava-motion.js').read_text(encoding='utf-8')
(root/'src'/'nia-motion.js').write_text(ava_motion.replace('AvaMotion','NiaMotion'),encoding='utf-8')

renderer=root/'src'/'nia-renderer.js'
renderer.write_text(renderer.read_text(encoding='utf-8').replace("import {AvaMotion, clamp} from './ava-motion.js';","import {NiaMotion, clamp} from './nia-motion.js';").replace("motion = new AvaMotion()","motion = new NiaMotion()"),encoding='utf-8')

ava_voice=(root/'src'/'ava-voice.js').read_text(encoding='utf-8')
nia_voice=ava_voice.replace('AvaVoice','NiaVoice').replace('Ava','Nia').replace('AVA','NIA')
nia_voice=nia_voice.replace("characters/ava/","characters/nia/")
(root/'src'/'nia-voice.js').write_text(nia_voice,encoding='utf-8')

ava_app=(root/'src'/'ava-app.js').read_text(encoding='utf-8')
nia_app=ava_app.replace("import {AvaMotion} from './ava-motion.js';","import {NiaMotion} from './nia-motion.js';")
nia_app=nia_app.replace("import {AvaRenderer} from './ava-renderer.js';","import {NiaRenderer} from './nia-renderer.js';")
nia_app=nia_app.replace("import {AvaVoice} from './ava-voice.js';","import {NiaVoice} from './nia-voice.js';")
nia_app=nia_app.replace("new AvaMotion()","new NiaMotion()").replace("new AvaRenderer(","new NiaRenderer(").replace("new AvaVoice(","new NiaVoice(")
nia_app=nia_app.replace("$('ava')","$('nia')").replace("./characters/ava/config/voice.json","./characters/nia/config/voice.json")
nia_app=nia_app.replace('__AVA_DEBUG','__NIA_DEBUG').replace('ava-motion-command','nia-motion-command')
nia_app=nia_app.replace('Ava','Nia').replace('AVA','NIA')
(root/'src'/'nia-app.js').write_text(nia_app,encoding='utf-8')

shutil.copyfile(root/'src'/'ava.css',root/'src'/'nia.css')
original=(root/'index.html').read_text(encoding='utf-8')
web=original.replace('AVA','NIA').replace('Ava','Nia')
web=web.replace('id="ava"','id="nia"').replace('src="./src/ava.css"','src="./src/nia.css"').replace('src="./src/ava-app.js"','src="./src/nia-app.js"')
web=web.replace('AI presenter · original character','Friendly AI companion · original character')
web=web.replace('a photorealistic digital presenter','a photorealistic friendly presenter')
(root/'index.html').write_text(web,encoding='utf-8')

# Character validator is parameterized to Nia using its copied checks.
v=(nia/'validate.mjs')
if v.exists():
    s=v.read_text(encoding='utf-8').replace("ava-001","nia-001").replace("'Ava'","'Nia'").replace("Ava pack","Nia pack")
    v.write_text(s,encoding='utf-8')
(root/'OPEN_NIA.cmd').write_text((root/'OPEN_AVA.cmd').read_text(encoding='utf-8'),encoding='utf-8')
(root/'README.md').write_text(
 '# Living Avatar Engine — Nia\n\n**Default character: Nia (original fictional identity).**\n\n'
 'Run `OPEN_NIA.cmd` or open http://127.0.0.1:8765/ when the local server is running. '
 'Click Start talking once for browser microphone permission; afterwards speak to Nia.\n\n'
 'Nia has a new warm portrait, curly hair, freckles, cream sweater, and independent prepared '
 'photographic blink/gaze states. This is still a research prototype, not true 3D head or realistic mouth lip sync. '
 'Browser speech recognition may use external cloud services. No general AI model is connected.\n\n'
 'Nia files: `characters/nia/`, `src/nia-*.js` and `src/nia.css`. '
 'Original Ava files remain under `characters/ava/` for archival purposes.\n',encoding='utf-8')
(root/'PROGRESS.md').write_text(
 '# Nia — Implementation progress\n\n'
 '- Nia chosen as primary character; distinct from Ava and Nuance presenter.\n'
 '- New compressed original Nia neutral portrait and prepared blink/gaze overlays present.\n'
 '- Voice-first interface and command parser migrated; speech through browser Web Speech API where supported.\n'
 '- Native 3D head, facial blendshapes and audio-synchronized visemes remain missing.\n'
 '- Benchmark and voice-command smoke testing required after migration.\n',encoding='utf-8')
print('Nia migration complete',photo.stat().st_size,eyes.stat().st_size)
