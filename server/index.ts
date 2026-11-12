import { createServer } from 'node:http';
import { config as loadEnv } from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { createBrain, providerConfig } from './jev';
import type { Snapshot } from '../src/agents';
loadEnv({path:'.env.local',quiet:true});
const config=providerConfig(),brain=createBrain(config);
const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});
const server=createServer(async(req,res)=>{
  if(req.url==='/api/decision'&&req.method==='POST') {
    try { let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw new Error('Too big');}const s=JSON.parse(body) as Snapshot;const d=await brain(s,s.tick);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(d)); }catch{res.writeHead(400);res.end('Invalid snapshot');}return;
  }
  vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});
});
server.listen(5173,'127.0.0.1',()=>console.log(`Jev Pong · ${config.provider} · http://127.0.0.1:5173`));
