import {parseVoiceIntent} from '../characters/nia/intent-parser.mjs';
export class NiaVoice {
  constructor({config,onTranscript,onAnswer,onMode,onIntent,motion}){
    this.config=config;this.onTranscript=onTranscript;this.onAnswer=onAnswer;this.onMode=onMode;this.onIntent=onIntent;this.motion=motion;
    this.Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    this.recognition=null;this.wanted=false;this.speaking=false;this.ending=false;
    this.voices=window.speechSynthesis?.getVoices?.()||[];
    if(window.speechSynthesis)window.speechSynthesis.onvoiceschanged=()=>{this.voices=window.speechSynthesis.getVoices()};
  }
  async toggle(){if(this.wanted)this.stop();else this.start();}
  start(){
    if(!this.Recognition){this.onMode('unsupported','Voice recognition unavailable in this browser. Try Chrome or Edge.');return;}
    this.wanted=true;this.onMode('starting','Requesting microphone access…');
    if(!this.recognition)this.prepareRecognition();
    this.beginRecognition();
  }
  prepareRecognition(){
    const r=new this.Recognition();r.lang='en-US';r.interimResults=true;r.continuous=true;r.maxAlternatives=1;
    r.onstart=()=>{this.onMode('listening','Listening — speak to Nia');this.motion.listening=true;};
    r.onresult=event=>{
      let partial='',complete='';
      for(let i=event.resultIndex;i<event.results.length;i++){
        const text=event.results[i][0]?.transcript||'';
        if(event.results[i].isFinal)complete+=' '+text;else partial+=' '+text;
      }
      if(partial)this.onTranscript(partial.trim(),false);
      if(complete.trim())this.handleTranscript(complete.trim());
    };
    r.onerror=e=>{
      if(e.error==='not-allowed'||e.error==='service-not-allowed'){this.wanted=false;this.onMode('error','Microphone permission denied. Enable access in browser settings.');}
      else if(e.error==='no-speech'){this.onMode('listening','Listening — please speak clearly');}
      else this.onMode('error','Speech recognition error: '+e.error);
    };
    r.onend=()=>{this.motion.listening=false;if(this.wanted&&!this.speaking&&!this.ending){this.onMode('starting','Reconnecting microphone…');setTimeout(()=>this.beginRecognition(),400);}};
    this.recognition=r;
  }
  beginRecognition(){
    if(!this.wanted||this.speaking||this.ending)return;
    try{this.recognition.start();}catch(e){if(e.name!=='InvalidStateError')this.onMode('error',String(e.message||e));}
  }
  stop(){
    this.wanted=false;this.motion.listening=false;this.ending=true;
    try{this.recognition?.stop();}catch(e){}
    window.speechSynthesis?.cancel?.();
    this.speaking=false;this.motion.speaking=false;this.onMode('off','Microphone off');
    setTimeout(()=>{this.ending=false},250);
  }
  handleTranscript(transcript){
    this.onTranscript(transcript,true);
    const result=parseVoiceIntent(transcript,this.config);
    this.motion.listening=false;
    if(result.kind==='command'){
      const action=result.action;
      if(result.id==='introduce')return this.say("Hello, I'm Nia. I'm an original digital presenter. You can speak to me, and I can respond to simple commands. My facial animation is still being developed.");
      if(result.id==='blink'){this.motion.startBlink();this.onAnswer('Blinking.');return}
      this.motion.command(action);this.onIntent(result);this.onAnswer(this.describeCommand(result.id));
      if(result.id==='stop_moving')this.onMode('listening','Staying still — still listening');
      return;
    }
    if(result.kind==='dialogue')this.say(this.localReply(result.transcript));
  }
  describeCommand(id){
    const messages={look_left:'Looking left.',look_right:'Looking right.',look_at_me:'Looking at you.',nod:'Nodding gently.',tilt_head:'Small head tilt — full 3D rig pending.',smile:'A subtle smile.',stop_moving:'I’ll keep still.',resume:'Relaxing again.'};
    return messages[id]||'I heard you.';
  }
  localReply(input){
    if(/\b(hello|hi|hey|good morning)\b/.test(input))return "Hello! I'm Nia. It's lovely to meet you.";
    if(/\b(your name|who are you)\b/.test(input))return "I'm Nia, your developing conversational presenter.";
    if(/\b(how are you)\b/.test(input))return "I'm doing well. Thank you for asking. What would you like me to do?";
    if(/\b(what can you do|what do you do)\b/.test(input))return "For now, I can listen to you, answer a few questions, and control my eye and head gestures. Full conversational AI and accurate lip sync are being developed.";
    return "I heard you. This prototype only supports a small set of local responses. A general AI conversation model isn't connected yet.";
  }
  say(text){
    this.onAnswer(text);
    if(!('speechSynthesis' in window)){this.onMode('error','Speech output unavailable in this browser.');return;}
    this.speaking=true;this.motion.speaking=true;this.motion.listening=false;
    this.onMode('speaking','Nia is speaking');
    // Prevent synthesizer audio echo from being recognized as a new user utterance.
    try{this.recognition?.abort()}catch(e){}
    window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang='en-US';u.rate=.94;u.pitch=1.03;
    const english=this.voices.filter(v=>v.lang?.toLowerCase().startsWith('en-'));
    const us=english.find(v=>v.lang?.toLowerCase()==='en-us')||english[0];if(us)u.voice=us;
    const finish=()=>{this.speaking=false;this.motion.speaking=false;if(this.wanted){this.onMode('starting','Resuming microphone…');setTimeout(()=>this.beginRecognition(),350)}else this.onMode('off','Microphone off');};
    u.onboundary=()=>this.motion.markSpokenWord();
    u.onend=finish;u.onerror=finish;
    window.speechSynthesis.speak(u);
  }
}