from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops
import base64

root=Path(r'C:\Users\aldia\Downloads\LivingAvatarEngine')
shots=root/'tests'/'artifacts'
shots.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge',headless=True)
    page=b.new_page(viewport={'width':1280,'height':900}, device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    response=page.goto('http://127.0.0.1:8765/',wait_until='domcontentloaded')
    assert response.status==200, response.status
    page.wait_for_function('window.__NIA_DEBUG && window.__NIA_DEBUG.renderer.ready',timeout=15000)
    assert 'Nia' in page.title(),page.title()
    assert 'Nia' in page.locator('h1').inner_text()
    size=page.evaluate('[window.__NIA_DEBUG.renderer.photo.naturalWidth,window.__NIA_DEBUG.renderer.atlas.naturalWidth,window.__NIA_DEBUG.renderer.atlas.naturalHeight]')
    assert size==[512,512,306],size
    page.wait_for_timeout(500)
    page.screenshot(path=str(shots/'nia-app.png'),full_page=True)
    results={}
    for label,blink,gaze in [('neutral',0,0),('blink',1,0),('left',0,-1),('right',0,1)]:
        src=page.evaluate("""p=>{const r=window.__NIA_DEBUG.renderer,m=r.motion; m.blink=p.blink; m.gaze=p.gaze; m.headY=0;m.headRoll=0;r.paint();return r.canvas.toDataURL('image/png').split(',')[1]}""",{'blink':blink,'gaze':gaze})
        fn=shots/('nia-'+label+'.png')
        fn.write_bytes(base64.b64decode(src))
        results[label]=Image.open(fn).convert('RGB')
    for label in ['blink','left','right']:
        box=ImageChops.difference(results['neutral'],results[label]).getbbox()
        assert box, label+' not visibly distinct from neutral'
        print('PHOTO_POSE',label,'changed_region',box)
    voice=page.evaluate('!!window.__NIA_DEBUG.getVoice()')
    assert voice
    for phrase,expected in [('look left',-1),('look right',1),('look at me',0)]:
        page.evaluate('s=>window.__NIA_DEBUG.getVoice().handleTranscript(s)',phrase)
        target=page.evaluate('window.__NIA_DEBUG.motion.gazeTarget')
        assert target==expected,(phrase,target)
        print('SPOKEN_INTENT',phrase,'target',target)
    assert not errors,errors
    print('PAGE_HTTP',response.status,'ASSET_SIZE',size,'BROWSER_STT_SUPPORTED',page.evaluate('!!(window.SpeechRecognition||window.webkitSpeechRecognition)'),'JS_ERRORS',len(errors))
    print('NOTE: Physical microphone and audio output not exercised by automated test.')
    b.close()
