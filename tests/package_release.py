"""Build reproducible Ava source archives; omit test captures and private files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
char=root/'characters'/'ava'
skip={'__pycache__','.env','node_modules'}
def add_tree(z,tree):
    for path in sorted(tree.rglob('*')):
        if path.is_file() and not any(x in skip for x in path.parts):
            z.write(path,path.relative_to(root).as_posix())
def verify(p):
    with ZipFile(p,'r') as z:
        bad=z.testzip()
        assert bad is None,bad
        return len(z.namelist())
with ZipFile(root/'Ava_Character_Pack.zip','w',compression=ZIP_DEFLATED,compresslevel=8) as z:
    add_tree(z,char)
files=['index.html','README.md','PROGRESS.md','PROJECT_MASTER_SPEC.md','VOICE_FIRST_REALISM_REQUIREMENTS.md','OPEN_AVA.cmd','src/ava-app.js','src/ava-motion.js','src/ava-renderer.js','src/ava-voice.js','src/ava.css','tests/ava-motion.test.mjs','tests/browser_smoke.py','tests/voice_browser.py','tests/capture_states.py']
with ZipFile(root/'Ava_Voice_First_Prototype.zip','w',compression=ZIP_DEFLATED,compresslevel=8) as z:
    add_tree(z,char)
    for rel in files:
        p=root/rel
        if not p.is_file():raise FileNotFoundError(p)
        z.write(p,rel)
for p in [root/'Ava_Character_Pack.zip',root/'Ava_Voice_First_Prototype.zip']:
    print(p.name,p.stat().st_size,'bytes',verify(p),'valid entries')
