from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root=Path(r'C:\Users\aldia\Downloads\LivingAvatarEngine')
nia=root/'characters'/'nia'
idx=root/'index.html'
html=idx.read_text(encoding='utf-8')
html=html.replace('Living Niatar Engine','Living Avatar Engine')
html=html.replace('href="./src/ava.css"','href="./src/nia.css"')
html=html.replace('<span class="mark">A</span>','<span class="mark">N</span>')
idx.write_text(html,encoding='utf-8')
for doc in nia.rglob('*.md'):
    content=doc.read_text(encoding='utf-8')
    repaired=content.replace('Niatar','Avatar')
    if content!=repaired:doc.write_text(repaired,encoding='utf-8')
files=[
  'index.html','README.md','PROGRESS.md','PROJECT_MASTER_SPEC.md',
  'VOICE_FIRST_REALISM_REQUIREMENTS.md','OPEN_NIA.cmd',
  'src/nia-app.js','src/nia-renderer.js','src/nia-motion.js',
  'src/nia-voice.js','src/nia.css',
  'tests/nia_smoke.py','tests/activate_nia.py'
]
def add_character(z):
    for f in nia.rglob('*'):
        if not f.is_file():continue
        if f.suffix in ('.zip','.b64'):continue
        z.write(f,f.relative_to(root).as_posix())
with ZipFile(root/'Nia_Character_Pack.zip','w',compression=ZIP_DEFLATED,compresslevel=8) as z:
    add_character(z)
with ZipFile(root/'Nia_Voice_First_Prototype.zip','w',compression=ZIP_DEFLATED,compresslevel=8) as z:
    add_character(z)
    for rel in files:
        f=root/rel
        assert f.is_file(),f
        z.write(f,rel)
for f in [root/'Nia_Character_Pack.zip',root/'Nia_Voice_First_Prototype.zip']:
    with ZipFile(f,'r') as z:
        assert z.testzip() is None
        print(f.name, f.stat().st_size, 'bytes;',len(z.namelist()),'entries validated')
assert 'Niatar' not in idx.read_text(encoding='utf-8')
assert 'src/nia.css' in idx.read_text(encoding='utf-8')
print('Nia release checked; default application uses Nia')
