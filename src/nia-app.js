import {NiaMotion} from './nia-motion.js';
import {NiaRenderer} from './nia-renderer.js';
import {NiaRealtime} from './nia-realtime.js';

const $=id=>document.getElementById(id);
const motion=new NiaMotion(),renderer=new NiaRenderer($('nia'),motion);
let responseText='';
const mode=(type,label)=>{
 $('signal').classList.toggle('is-live',type==='listening');
 $('signal').classList.toggle('is-speaking',type==='speaking');
 $('signalText').textContent=label;
 $('expression').textContent=type.toUpperCase();
 $('stageMessage').textContent=label;
 $('mic').classList.toggle('is-live',realtime.active||realtime.connecting);
 $('micLabel').textContent=realtime.active||realtime.connecting?'End conversation':'Talk to Nia';
};
const realtime=new NiaRealtime({
 motion,onState:mode,
 onUserText:text=>{$('heard').textContent=text},
 onNiaText:(text,done)=>{if(done){responseText=text;$('answered').textContent=text||'…'}else{responseText+=text;$('answered').textContent=responseText}},
 onAudioLevel:(level,speaking)=>{motion.audioEnergy=level;motion.speaking=speaking||motion.speaking},
 onEvent:event=>{if(event.type==='response.created'){responseText='';$('answered').textContent='…';}}
});
$('mic').addEventListener('click',()=>realtime.toggle());
renderer.start(fps=>{$('fps').textContent=fps+' FPS';if(renderer.loadError)mode('error',renderer.loadError)});
mode('off','Ready to connect — microphone permission required');
window.addEventListener('beforeunload',()=>{realtime.stop();renderer.stop()});
window.__NIA_DEBUG={motion,renderer,realtime};
