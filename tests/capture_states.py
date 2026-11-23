from playwright.sync_api import sync_playwright
from pathlib import Path
import base64
root=Path(r'C:\Users\aldia\Downloads\LivingAvatarEngine')
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1200,'height':950})
    page.goto('http://127.0.0.1:8765/',wait_until='domcontentloaded')
    page.wait_for_function('window.__AVA_DEBUG && window.__AVA_DEBUG.renderer.ready')
    for name,blink,gaze in [('neutral',0,0),('eyes_closed',1,0),('looking_right',0,1),('looking_left',0,-1)]:
        data=page.evaluate("""p=>{const r=window.__AVA_DEBUG.renderer,m=r.motion;m.blink=p.blink;m.gaze=p.gaze;m.headRoll=0;m.headY=0;r.paint();return r.canvas.toDataURL('image/png').split(',')[1]}""",{'blink':blink,'gaze':gaze})
        output=root/('ava-canvas-'+name+'.png')
        output.write_bytes(base64.b64decode(data))
        print(name,output.stat().st_size)
    browser.close()
