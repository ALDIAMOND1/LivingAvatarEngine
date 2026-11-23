// Local-only server: static files + protected OpenAI Realtime SDP proxy.
// No .env editing, no browser API key, no dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const host='127.0.0.1', port=Number(process.env.NIA_PORT||8766);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.md':'text/plain; charset=utf-8'};
const send=(res,status,body,ct='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':ct,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(typeof body==='string'?body:JSON.stringify(body))};
const session={type:'realtime',model:process.env.NIA_REALTIME_MODEL||'gpt-realtime-mini',instructions:'You are Nia, an original warm, intelligent, concise AI conversational presenter. Speak naturally in short replies. Listen attentively, allow interruptions, avoid scripted commands, and never claim you can physically see the user. You are an AI, not a human.',audio:{output:{voice:'marin'},input:{turn_detection:{type:'server_vad',threshold:0.5,prefix_padding_ms:300,silence_duration_ms:500,create_response:true,interrupt_response:true}}}};
const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(origin && origin!==`http://${host}:${port}`){send(res,403,{error:'Local origin only'});return;}
  if(req.url==='/api/status'){send(res,200,{ready:!!process.env.OPENAI_API_KEY,model:session.model,mode:'webrtc',requiresKey:!process.env.OPENAI_API_KEY});return;}
  if(req.url==='/api/realtime/session'){
    if(req.method!=='POST'){send(res,405,{error:'POST required'});return;}
    if(!process.env.OPENAI_API_KEY){send(res,503,{error:'OPENAI_API_KEY is not configured on the local server. Set it in your terminal environment before launching Nia.'});return;}
    let body='',size=0;
    try{for await(const chunk of req){size+=chunk.length;if(size>65536){send(res,413,{error:'SDP too large'});return;}body+=chunk.toString('utf8');}}catch{send(res,400,{error:'Invalid request'});return;}
    if(!body.startsWith('v=0')){send(res,400,{error:'Expected SDP offer'});return;}
    const form=new FormData();form.set('sdp',body);form.set('session',JSON.stringify(session));
    try{
      const response=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form,signal:AbortSignal.timeout(20000)});
      const answer=await response.text();
      if(!response.ok){send(res,response.status,{error:'Realtime provider rejected session',detail:answer.slice(0,600)});return;}
      send(res,200,answer,'application/sdp');
    }catch(e){send(res,502,{error:'Realtime provider unavailable',detail:e.message});}
    return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){send(res,405,{error:'Method not allowed'});return;}
  const pathname=decodeURIComponent((req.url||'/').split('?')[0]);
  const resolved=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!resolved.startsWith(root+path.sep)){send(res,403,{error:'Forbidden'});return;}
  if(/(^|[\\/])(\.env|node_modules|tests|server\.mjs|OPEN_.*\.cmd)([\\/]|$)/i.test(resolved)){send(res,403,{error:'Forbidden'});return;}
  fs.stat(resolved,(err,stat)=>{
    if(err||!stat.isFile()){send(res,404,{error:'Not found'});return;}
    res.writeHead(200,{'Content-Type':types[path.extname(resolved)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD'){res.end();return;}
    fs.createReadStream(resolved).pipe(res);
  });
});
server.listen(port,host,()=>console.log(`Nia Realtime: http://${host}:${port} (API key configured: ${!!process.env.OPENAI_API_KEY})`));
