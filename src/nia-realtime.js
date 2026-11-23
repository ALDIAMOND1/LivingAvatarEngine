// Browser WebRTC conversation. No Web Speech, no regex replies, no hardcoded API key.
export class NiaRealtime {
 constructor({onState,onUserText,onNiaText,onAudioLevel,onEvent,motion}){
  Object.assign(this,{onState,onUserText,onNiaText,onAudioLevel,onEvent,motion});
  this.active=false;this.connecting=false;this.pc=null;this.channel=null;this.stream=null;this.audio=null;this.ctx=null;this.analyser=null;this.frame=0;this.speaking=false;
 }
 async toggle(){return this.active||this.connecting?this.stop():this.start()}
 async start(){
  if(this.active||this.connecting)return;
  this.connecting=true;this.onState('connecting','Connecting to Nia…');
  try{
   const status=await fetch('/api/status').then(r=>r.json());
   if(!status.ready)throw Error('Realtime API key is not configured on the local server. See README_REALTIME.md.');
   this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   this.pc=new RTCPeerConnection();
   this.audio=document.createElement('audio');this.audio.autoplay=true;this.audio.playsInline=true;
   this.pc.ontrack=e=>{this.audio.srcObject=e.streams[0];this.audio.play().catch(()=>{});this.attachAnalyser(e.streams[0]);};
   this.pc.onconnectionstatechange=()=>{if(['failed','disconnected'].includes(this.pc?.connectionState))this.stop('Connection lost');};
   for(const track of this.stream.getTracks())this.pc.addTrack(track,this.stream);
   this.channel=this.pc.createDataChannel('oai-events');
   this.channel.onmessage=e=>{try{this.event(JSON.parse(e.data))}catch{}};
   this.channel.onopen=()=>{this.active=true;this.connecting=false;this.onState('listening','Listening — speak naturally');this.motion.listening=true;};
   const offer=await this.pc.createOffer();await this.pc.setLocalDescription(offer);
   const response=await fetch('/api/realtime/session',{method:'POST',headers:{'Content-Type':'application/sdp'},body:offer.sdp});
   if(!response.ok){const err=await response.json().catch(()=>({error:'Session failed'}));throw Error(err.detail||err.error||'Session failed')}
   await this.pc.setRemoteDescription({type:'answer',sdp:await response.text()});
  }catch(e){this.stop();this.onState('error',e.message||'Connection failed');}
 }
 event(e){
  this.onEvent?.(e);
  switch(e.type){
   case 'input_audio_buffer.speech_started':
    this.motion.listening=true;this.motion.speaking=false;this.speaking=false;this.onState('listening','Listening to you…');break;
   case 'input_audio_buffer.speech_stopped':
    this.motion.listening=false;this.onState('thinking','Nia is thinking…');break;
   case 'response.created':
    this.motion.listening=false;this.motion.speaking=true;this.speaking=true;this.onState('speaking','Nia is responding…');break;
   case 'output_audio_buffer.started':
    this.motion.speaking=true;this.speaking=true;this.onState('speaking','Nia is speaking');break;
   case 'response.audio_transcript.delta':
   case 'response.output_audio_transcript.delta':
    this.onNiaText(e.delta||'',false);break;
   case 'response.audio_transcript.done':
   case 'response.output_audio_transcript.done':
    this.onNiaText(e.transcript||'',true);break;
   case 'conversation.item.input_audio_transcription.completed':
    this.onUserText(e.transcript||'');break;
   case 'response.done':
    this.motion.speaking=false;this.speaking=false;this.motion.listening=true;this.onState('listening','Listening — you can interrupt anytime');break;
   case 'response.cancelled':
   case 'response.interrupted':
    this.motion.speaking=false;this.speaking=false;this.onState('listening','Listening to you…');break;
   case 'error':
    this.onState('error',e.error?.message||'Realtime conversation error');break;
  }
 }
 attachAnalyser(stream){
  try{
   this.ctx=new AudioContext();const src=this.ctx.createMediaStreamSource(stream);
   this.analyser=this.ctx.createAnalyser();this.analyser.fftSize=512;src.connect(this.analyser);
   const buffer=new Uint8Array(this.analyser.frequencyBinCount);
   const tick=()=>{if(!this.ctx||this.ctx.state==='closed')return;
    this.analyser.getByteTimeDomainData(buffer);
    let sum=0;for(const x of buffer){const n=(x-128)/128;sum+=n*n;}
    const level=Math.min(1,Math.sqrt(sum/buffer.length)*4);
    this.onAudioLevel(level,this.speaking);this.frame=requestAnimationFrame(tick);
   };tick();
  }catch(e){console.warn('Audio analyser unavailable',e)}
 }
 stop(reason='Microphone off'){
  this.active=false;this.connecting=false;this.speaking=false;
  this.motion.listening=false;this.motion.speaking=false;
  if(this.frame)cancelAnimationFrame(this.frame);
  if(this.channel){try{this.channel.close()}catch{}this.channel=null}
  if(this.pc){try{this.pc.close()}catch{}this.pc=null}
  if(this.stream){for(const t of this.stream.getTracks())t.stop();this.stream=null}
  if(this.audio){this.audio.pause();this.audio.srcObject=null;this.audio=null}
  if(this.ctx){this.ctx.close().catch(()=>{});this.ctx=null}
  this.onAudioLevel(0,false);this.onState('off',reason);
 }
}