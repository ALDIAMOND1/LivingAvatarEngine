// Real-time pose scheduler, without neural inference.
// Motion channels are independent; prepared eye appearance assets render each frame.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,t)=>a+(b-a)*Math.min(1,Math.max(0,t));
export class NiaMotion {
  constructor(rand=Math.random) {
    this.rand=rand;
    this.time=0; this.blinkAt=2.7; this.blinkStart=-1; this.blink=0;
    this.gazeTarget=0; this.gaze=0; this.gazeHoldUntil=0; this.gazeNext=4.1;
    this.nodStarted=-1; this.nod=0;
    this.smileUntil=0; this.smile=0; this.speaking=false; this.listening=false; this.still=false;
    this.lastWordAt=-10; this.speechMouth=0;
  }
  range(a,b){return a+(b-a)*this.rand()}
  reset(){this.gazeTarget=0;this.gazeHoldUntil=0;this.still=false}
  startBlink(){this.blinkStart=this.time;this.blinkAt=this.time+this.range(3,6.5)}
  startNod(){this.nodStarted=this.time}
  markSpokenWord(){this.lastWordAt=this.time;}
  command(action){
    switch(action?.type) {
      case 'gaze':
        this.still=false;this.gazeTarget=Math.max(-1,Math.min(1,(action.targetX||0)/.65));
        this.gazeHoldUntil=this.time+3.4;this.gazeNext=this.gazeHoldUntil+2;break;
      case 'head':
        if(action.gesture==='nod')this.startNod();
        if(action.gesture==='tilt')this.startNod();break;
      case 'expression':
        this.smileUntil=this.time+2.3;break;
      case 'motion':
        this.still=action.mode==='hold';if(this.still){this.gazeTarget=0;this.nodStarted=-1};break;
    }
  }
  tick(dt){
    dt=clamp(dt,0,.08);this.time+=dt;
    if(!this.still&&this.time>=this.blinkAt)this.startBlink();
    const p=(this.time-this.blinkStart)/.22;
    this.blink=(!this.still&&p>=0&&p<=1)?Math.sin(p*Math.PI):0;
    if(!this.still&&!this.speaking&&!this.listening&&this.time>=this.gazeNext&&this.time>=this.gazeHoldUntil){
      this.gazeTarget=this.range(-1,1)<0?-0.40:0.40;
      this.gazeHoldUntil=this.time+this.range(.6,1.7);
      this.gazeNext=this.gazeHoldUntil+this.range(2.4,5.8);
    }
    if(this.time>=this.gazeHoldUntil&&Math.abs(this.gazeTarget)>0)this.gazeTarget=0;
    this.gaze=smooth(this.gaze,this.gazeTarget,dt*5.8);
    const n=(this.time-this.nodStarted)/.9;
    this.nod=!this.still&&n>=0&&n<=1?Math.sin(n*Math.PI)**2:0;
    this.smile=smooth(this.smile,this.time<this.smileUntil?1:0,dt*2.2);
    const wordPulse=clamp(1-(this.time-this.lastWordAt)/.32,0,1);
    this.speechMouth=smooth(this.speechMouth,this.speaking?wordPulse:0,dt*18);
    const breathe=Math.sin(this.time*1.23);
    this.headY=this.still?0:Math.sin(this.time*0.81)*.26 + breathe*.26 +this.nod*2.2;
    this.headRoll=this.still?0:Math.sin(this.time*.39)*.0015 + this.nod*.006;
    this.breathe=breathe;return this;
  }
}
export {clamp};