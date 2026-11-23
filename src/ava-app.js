import {AvaMotion} from './ava-motion.js';
import {AvaRenderer} from './ava-renderer.js';
import {AvaVoice} from './ava-voice.js';

const $=id=>document.getElementById(id);
const stage=$('ava'), motion=new AvaMotion(),renderer=new AvaRenderer(stage,motion);
let voice=null;
function setMode(type,label){
  $('signal').classList.toggle('is-live',type==='listening');
  $('signal').classList.toggle('is-speaking',type==='speaking');
  $('signalText').textContent=label;
  $('expression').textContent=type==='listening'?'LISTENING':type==='speaking'?'SPEAKING':type==='error'?'ERROR':'IDLE';
  $('stageMessage').textContent=label;
  const active=voice?.wanted??false;
  $('mic').classList.toggle('is-live',active);
  $('micLabel').textContent=active?'Stop conversation':'Start talking';
}
const onTranscript=(t,isFinal)=>{$('heard').textContent=t+(isFinal?'':' …')};
const onAnswer=t=>{$('answered').textContent=t};
const onIntent=intent=>{document.dispatchEvent(new CustomEvent('ava-motion-command',{detail:intent}))};
try{
  const res=await fetch('./characters/ava/config/voice.json',{cache:'no-cache'});
  if(!res.ok)throw new Error('HTTP '+res.status);
  const config=await res.json();
  voice=new AvaVoice({config,onTranscript,onAnswer,onMode:setMode,onIntent,motion});
  $('mic').addEventListener('click',()=>voice.toggle());
  if(!voice.Recognition)setMode('error','Speech recognition not supported; try Chrome or Edge.');
  else setMode('off','Microphone not active');
}catch(e){setMode('error','Could not load Ava voice configuration: '+e.message);$('mic').disabled=true;}
renderer.start((fps,m)=>{
  $('fps').textContent=fps+' FPS';
  if(renderer.loadError)setMode('error',renderer.loadError);
});
window.addEventListener('beforeunload',()=>{voice?.stop();renderer.stop();});
// Debug API is not shown as user-facing motion controls.
window.__AVA_DEBUG={motion,renderer,getVoice:()=>voice};
