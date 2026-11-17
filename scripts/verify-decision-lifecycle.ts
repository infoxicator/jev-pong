/** Exercise stale async replies over real Node WebSockets; only loopback fixture API traffic. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import type { ArenaState,ServerMessage } from '../src/protocol';
const replies:(()=>void)[]=[];
const fixture=createServer(async(req,res)=>{
  assert.equal(req.url,'/v1/decisions');assert.equal(req.headers.authorization,'Bearer lifecycle-fixture-only');
  for await(const _ of req){ /* drain request */ }
  replies.push(()=>{
    const answer=(name:string,choice:string)=>({name,type:'choice',choice,confidence:.9});
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({model:'gpt-6-luna',answers:[answer('target','lane_8'),answer('move','stay'),answer('taunt','line_1')],usage:{input_tokens:100}}));
  });
});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const f=fixture.address();assert(f&&typeof f!=='string');
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const address=reservation.address();assert(address&&typeof address!=='string');await new Promise<void>(r=>reservation.close(()=>r()));
const origin=`http://127.0.0.1:${address.port}`;
const preload=`const original=globalThis.fetch;globalThis.fetch=(input,init)=>{if(String(input)!=='https://api.openai.com/v1/decisions')throw Error('External network forbidden');return original('http://127.0.0.1:${f.port}/v1/decisions',init);};`;
const child=spawn(process.execPath,['--import','tsx','--import',`data:text/javascript,${encodeURIComponent(preload)}`,'server/index.ts','--production'],{env:{...process.env,PORT:String(address.port),PONG_RULES:'table-tennis',PONG_MATCHUP:'jev-vs-luna',JEV_PROVIDER:'mock',JEV_MOCK:'',LUNA_MOCK:'0',OPENAI_API_KEY:'lifecycle-fixture-only',LUNA_INTERVAL_MS:'600',LUNA_TPM_BUDGET:'60000'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
const until=async(check:()=>boolean|Promise<boolean>,label:string,timeout=15000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw Error(`Timed out: ${label}`);};
const peers:WebSocket[]=[];let heartbeat:ReturnType<typeof setInterval>|undefined;
try{
  await until(()=>fetch(`${origin}/health`).then(r=>r.ok).catch(()=>{if(child.exitCode!==null)throw Error(output);return false;}),'ready');
  const messages:ServerMessage[]=[];let latest:ArenaState|undefined;
  for(const side of ['left','right']){
    const ws=new WebSocket(`${origin.replace('http:','ws:')}/ws?side=${side}&rules=table-tennis`,{origin});peers.push(ws);
    ws.on('message',raw=>{const m=JSON.parse(String(raw));if(side==='right'){messages.push(m);if(m.type==='state')latest=m;}});await once(ws,'open');
  }
  heartbeat=setInterval(()=>peers.forEach(ws=>ws.send(JSON.stringify({type:'ping',sent:Date.now()}))),2000);
  const right=peers[1],send=(type:string)=>right.send(JSON.stringify({type}));
  await until(()=>latest?.connected.left===true&&latest.connected.right,'both seats');
  assert.equal(latest!.gameSpeed,.5);
  const before=latest!.game.tick;messages.length=0;await new Promise(r=>setTimeout(r,1000));
  const elapsedTicks=latest!.game.tick-before,frames=messages.filter(m=>m.type==='state').length;
  assert(elapsedTicks>=45&&elapsedTicks<=75,`half-speed ticks/sec: ${elapsedTicks}`);
  assert(frames>=20&&frames<=40,`wall-time snapshots/sec: ${frames}`);
  for(const cause of ['reset','point'] as const){
    if(cause==='point')await until(()=>{const g=latest!.game;return g.phase==='play'&&Math.abs(g.ball.y-280)>60&&(g.ball.vx>0?g.ball.x>850:g.ball.x<150);},'ball approaches an unpositioned paddle');
    const requestTick=latest!.game.tick;
    messages.length=0;send('decide');await until(()=>replies.length===1,'request reached fixture');
    if(cause==='reset'){send('reset');await until(()=>latest!==undefined&&latest.game.tick<requestTick,'reset applied');}
    else{const point=latest!.game.pointId;await until(()=>latest!.game.pointId!==point,'point changes while decision pending');}
    const released=Date.now();replies.shift()!();
    await until(()=>messages.some(m=>m.type==='decision-cancelled'),'stale reply explicitly cancelled',1000);
    assert(Date.now()-released<1000,'must not wait for the 2 second client timeout');
    assert(!messages.some(m=>m.type==='decision'),'stale decision never applied');
    await new Promise(r=>setTimeout(r,160)); // Respect the proxy's independent 150ms request guard.
    send('decide');await until(()=>messages.some(m=>m.type==='cooldown'),'cooldown retained after cancellation');
    const cooldown=messages.find(m=>m.type==='cooldown');assert(cooldown?.type==='cooldown'&&cooldown.retryAfterMs>0);
    await new Promise(r=>setTimeout(r,650));
  }
  messages.length=0;send('decide');await until(()=>replies.length===1,'next decision not stuck');replies.shift()!();
  await until(()=>messages.some(m=>m.type==='decision'),'fresh decision arrives');
  const d=messages.find(m=>m.type==='decision');assert(d?.type==='decision');assert.equal(d.decision.source,'luna');
  right.send(JSON.stringify({type:'intent',sequence:d.decision.sequence,target_y:d.decision.action.target_y}));
  await until(()=>latest!.intents.right===1,'fresh intent accepted');
  console.log('PASS: reset and point-change cancellation <1s, stale actions rejected, Luna cooldown preserved, next decision and paddle intent accepted. Guarded loopback only.');
}finally{
  clearInterval(heartbeat);peers.forEach(ws=>ws.terminate());
  if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}
  fixture.closeAllConnections();await new Promise<void>(r=>fixture.close(()=>r()));
}
