from playwright.sync_api import sync_playwright
from pathlib import Path
import base64
p=Path(r'C:\Users\aldia\Downloads\LivingAvatarEngine\ava-mouth-test.png')
with sync_playwright() as w:
 b=w.chromium.launch(channel='msedge',headless=True)
 page=b.new_page()
 page.goto('http://127.0.0.1:8765/')
 page.wait_for_function('window.__AVA_DEBUG?.renderer?.ready')
 dat=page.evaluate("""()=>{const r=window.__AVA_DEBUG.renderer;r.motion.speechMouth=1;r.motion.blink=0;r.motion.gaze=0;r.motion.headRoll=0;r.motion.headY=0;r.paint();return r.canvas.toDataURL('image/png').split(',')[1]}""")
 p.write_bytes(base64.b64decode(dat))
 print(p,p.stat().st_size)
 b.close()
