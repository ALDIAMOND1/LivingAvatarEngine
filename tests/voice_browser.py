from playwright.sync_api import sync_playwright
from pathlib import Path
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge',headless=True)
    pg=b.new_page(viewport={'width':1200,'height':900})
    errors=[]
    pg.on('pageerror',lambda e:errors.append(str(e)))
    assert pg.goto('http://127.0.0.1:8765/').status==200
    pg.wait_for_function('window.__AVA_DEBUG && window.__AVA_DEBUG.renderer.ready')
    for phrase,want in [('look left',-1),('look right',1),('look at me',0)]:
        pg.evaluate('(s)=>window.__AVA_DEBUG.getVoice().handleTranscript(s)',phrase)
        value=pg.evaluate('window.__AVA_DEBUG.motion.gazeTarget')
        assert value==want,(phrase,value)
        assert pg.locator('#heard').inner_text().lower()==phrase
        print('VOICE_INTENT',phrase,'=>',value)
    pg.evaluate('window.__AVA_DEBUG.getVoice().handleTranscript("blink")')
    assert pg.evaluate('window.__AVA_DEBUG.motion.blinkStart')>=0
    pg.evaluate('window.__AVA_DEBUG.getVoice().handleTranscript("nod")')
    assert pg.evaluate('window.__AVA_DEBUG.motion.nodStarted')>=0
    pg.evaluate('window.__AVA_DEBUG.getVoice().handleTranscript("smile")')
    assert pg.evaluate('window.__AVA_DEBUG.motion.smileUntil')>0
    assert not errors,errors
    print('COMMANDS_PASS=6')
    print('VOICE_API_AVAILABLE=',pg.evaluate('Boolean(window.SpeechRecognition||window.webkitSpeechRecognition)'))
    print('PHOTO_READY=',pg.evaluate('window.__AVA_DEBUG.renderer.photo.naturalWidth'))
    print('JS_ERRORS=',errors)
    b.close()
