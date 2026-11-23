import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVoiceIntent } from './intent-parser.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const read=(name)=>JSON.parse(readFileSync(join(root,'config',name+'.json'),'utf8'));
let errors=0,warnings=0;
const ok=(cond,msg)=>{if(cond)console.log('PASS',msg);else{console.error('FAIL',msg);errors++;}};
const warn=(msg)=>{console.warn('WARN',msg);warnings++;};
const profile=read('profile'),states=read('states'),motions=read('motions'),voice=read('voice'),assets=read('assets'),quality=read('quality-gates');
ok(profile.id==='nia-001'&&profile.name==='Nia','Identity and original character defined');
ok(profile.source?.consentRequired===true,'Likeness permission requirement documented');
ok(voice.primaryUI==='microphone'&&voice.requiresButtonsForNormalInteraction===false,'Voice-first interface requirement');
for(const st of ['idle','listening','thinking','speaking','executing_command','error'])ok(!!states.states[st],'State '+st);
for(const transition of states.transitions){ok((transition.from==='*'||!!states.states[transition.from])&&!!states.states[transition.to],'Transition '+transition.event)}
for(const p of ['gazeX','gazeY','headYaw','headPitch','headRoll','blinkLeft','blinkRight'])ok(!!motions.params[p],'Motion parameter '+p);
const names=new Set();for(const cmd of voice.commands){ok(!names.has(cmd.id),'Unique command '+cmd.id);names.add(cmd.id);ok(Array.isArray(cmd.phrases)&&cmd.phrases.length>0&&!!cmd.action,'Command phrases and action '+cmd.id);}
ok(parseVoiceIntent('Could you please look at me?',voice).id==='look_at_me','Spoken gaze recognition');
ok(parseVoiceIntent('Please nod for me',voice).id==='nod','Spoken nod recognition');
ok(parseVoiceIntent("Don't smile",voice).kind==='dialogue','Negated movement does not automatically execute');
ok(assets.characterId===profile.id,'Assets match character identity');
const base=resolve(root,'assets');
for(const asset of assets.assets){const p=resolve(base,asset.path.replace(/^assets\//,''));ok(p.startsWith(base+'\\')||p.startsWith(base+'/'),'Asset path stays inside assets folder: '+asset.id);if(asset.status==='ready')ok(existsSync(p),'Ready asset actually exists: '+asset.id);else if(asset.required)warn('Required asset not yet prepared: '+asset.id+' -> '+asset.path);}
ok(quality.targets.fps===30&&quality.targets.silentDemoSeconds>=60,'Engineering goals recorded');
console.log('\nNia pack: '+errors+' errors, '+warnings+' expected missing-asset warnings.');
process.exitCode=errors?1:0;
