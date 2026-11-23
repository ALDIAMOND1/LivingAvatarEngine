import {AvaMotion,clamp} from './ava-motion.js';
// Original Ava portrait + separate, feather-masked photographic eye states.
// Real 3D face reconstruction and mouth geometry are future milestones.
const SOURCE_W=512,SOURCE_H=341;
const PATCH_ATLAS_SIZE=288,PATCH_H=75;
const EYE_PATCH_DST={x:105,y:90,w:313,h:81};
export class AvaRenderer {
  constructor(canvas,motion=new AvaMotion()){
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
    this.motion=motion;
    this.photo=new Image();this.atlas=new Image();this.ready=false;this.loadError=null;
    this.headLayer=null;this.running=false;this.frames=0;this.fps=0;this.prev=0;this.fpsAt=0;this.rollingFrames=0;
    this.photo.onload=()=>this.checkReady();
    this.atlas.onload=()=>this.checkReady();
    this.photo.onerror=()=>{this.loadError='Ava portrait could not load';};
    this.atlas.onerror=()=>{this.loadError='Ava prepared eye asset could not load';};
    this.photo.src='./characters/ava/assets/portrait/ava-master.webp';
    this.atlas.src='./characters/ava/assets/face/ava-eye-atlas.webp';
  }
  checkReady(){
    if(!this.photo.complete||!this.atlas.complete||!this.photo.naturalWidth||!this.atlas.naturalWidth)return;
    this.ready=true;this.makeHeadLayer();
  }
  makeHeadLayer(){
    const c=document.createElement('canvas');c.width=SOURCE_W;c.height=SOURCE_H;
    const x=c.getContext('2d');x.drawImage(this.photo,0,0,SOURCE_W,SOURCE_H);
    const pixels=x.getImageData(0,0,SOURCE_W,SOURCE_H);
    // Photo-only, micro-motion head cutout with feathered outer edge.
    // This is NOT a 3D mesh and only supports tiny motion amplitudes.
    for(let y=0;y<SOURCE_H;y++)for(let px=0;px<SOURCE_W;px++){
      const nx=(px-256)/155,ny=(y-161)/177,r=Math.hypot(nx,ny);
      const a=clamp((1.025-r)/.12,0,1);
      pixels.data[(y*SOURCE_W+px)*4+3]=Math.round(255*a);
    }
    x.putImageData(pixels,0,0);this.headLayer=c;
  }
  paint(){
    const {ctx,canvas,photo,atlas,motion}=this,W=canvas.width,H=canvas.height;
    ctx.fillStyle='#777277';ctx.fillRect(0,0,W,H);
    if(!this.ready){
      ctx.font='22px Segoe UI';ctx.fillStyle='#e7e6ec';ctx.textAlign='center';
      ctx.fillText(this.loadError||'Preparing Ava…',W/2,H/2);return;
    }
    const s=Math.max(W/SOURCE_W,H/SOURCE_H),dw=SOURCE_W*s,dh=SOURCE_H*s,dx=(W-dw)/2,dy=(H-dh)/2;
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(photo,dx,dy,dw,dh);
    // Animate just the feathered face region, not the background.
    ctx.save();
    ctx.translate(dx+s*256,dy+s*(263+motion.headY));
    ctx.rotate(motion.headRoll);
    ctx.scale(s,s);
    ctx.translate(-256,-263);
    if(this.headLayer)ctx.drawImage(this.headLayer,0,0,SOURCE_W,SOURCE_H);
    const drawPose=(index,alpha,mirror=false)=>{
      if(alpha<.006)return;
      const p=EYE_PATCH_DST;
      ctx.save();ctx.globalAlpha=clamp(alpha,0,1);
      if(mirror){ctx.translate(SOURCE_W,0);ctx.scale(-1,1)}
      // Lossy WebP can leak a faint alpha row across the atlas strip.
      // Constrain overlays to the actual eye regions to avoid forehead seams.
      ctx.beginPath();
      ctx.ellipse(227,121,43,28,0,0,Math.PI*2);
      ctx.ellipse(296,123,43,28,0,0,Math.PI*2);
      ctx.clip();
      ctx.drawImage(atlas,0,PATCH_ATLAS_SIZE+index*PATCH_H,PATCH_ATLAS_SIZE,PATCH_H,p.x,p.y,p.w,p.h);
      ctx.restore();
    };
    if(motion.gaze>0)drawPose(2,motion.gaze*.95);
    else if(motion.gaze<0)drawPose(1,-motion.gaze*.95,true);
    drawPose(0,motion.blink);
    // PCM/viseme-driven mouth appearance is intentionally NOT faked with
    // a painted oval; realistic mouth/interior assets are required.
    ctx.restore();
  }
  start(onFrame){
    if(this.running)return;
    this.running=true;this.prev=performance.now();this.fpsAt=this.prev;
    const tick=now=>{
      if(!this.running)return;
      const dt=Math.min((now-this.prev)/1000,.07);this.prev=now;
      this.motion.tick(dt);this.paint();this.frames++;this.rollingFrames++;
      if(now-this.fpsAt>1000){this.fps=Math.round(this.rollingFrames*1000/(now-this.fpsAt));this.fpsAt=now;this.rollingFrames=0;if(onFrame)onFrame(this.fps,this.motion)}
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  stop(){this.running=false}
}