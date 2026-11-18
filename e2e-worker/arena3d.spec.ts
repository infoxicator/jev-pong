import { test,expect } from '@playwright/test';
import WebSocket from 'ws';
import type { RoomLinks } from '../src/hosting';
import type { ArenaState, ClientMessage, ServerMessage } from '../src/protocol';
test.use({launchOptions:{args:['--enable-unsafe-swiftshader']}});
test('the room owner can start and save Hard with one model seat',async({request,baseURL})=>{
  const response=await request.post('/api/rooms',{headers:{Origin:baseURL!},data:{matchup:'jev-vs-luna'}});
  expect(response.status()).toBe(201);
  const links:RoomLinks=await response.json(),sockets:WebSocket[]=[];
  const endpoint=new URL(`/api/rooms/${links.room}/ws`,baseURL);
  endpoint.protocol=endpoint.protocol==='https:'?'wss:':'ws:';
  const token=(link:string)=>new URLSearchParams(new URL(link).hash.slice(1)).get('token')!;
  async function open(link:string,side:'right'|null){
    const socket=new WebSocket(endpoint,{origin:baseURL}),messages:ServerMessage[]=[];
    sockets.push(socket);
    socket.on('message',data=>messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    const send=(message:ClientMessage)=>socket.send(JSON.stringify(message));
    send({type:'join',side,token:token(link)??'',rules:'table-tennis'});
    return {send,messages,state:()=>messages.findLast((m):m is ArenaState=>m.type==='state')};
  }
  const hard={seed:1129,opponent:'placement',modelSide:'right'} as const;
  try{
    const owner=await open(links.owner,null),spectator=await open(links.spectator,null);
    spectator.send({type:'table-settings',hard});
    await expect.poll(()=>spectator.messages.some(m=>m.type==='error'&&m.message.includes('room owner'))).toBe(true);
    owner.send({type:'table-settings',hard});
    await expect.poll(()=>owner.state()?.game.tt?.hard).toEqual(hard);
    const model=await open(links.right,'right');
    const ping=setInterval(()=>model.send({type:'ping',sent:performance.now()}),1000);
    try{
      await expect.poll(()=>owner.messages.some(m=>m.type==='tactical-log'&&m.entries.some(e=>e.side==='left'&&e.source==='scripted')),{timeout:25_000}).toBe(true);
      await expect.poll(()=>owner.state()?.game.pointId??0,{timeout:50_000}).toBeGreaterThan(0);
      expect(owner.state()?.connected).toEqual({left:false,right:true});
      const saved=await request.get(`/api/rooms/${links.room}/status`,{headers:{Authorization:`Bearer ${token(links.owner)}`}});
      expect(saved.ok()).toBe(true);
      expect((await saved.json()).checkpoint.tt.hard).toEqual(hard);
    }finally{clearInterval(ping);}
  }finally{for(const socket of sockets)socket.close();}
});
test('3D room selects durable table-tennis rules, scores, pauses and preserves rules on reset',async({browser,request,baseURL})=>{
  const response=await request.post('/api/rooms',{headers:{Origin:baseURL!},data:{matchup:'jev-vs-luna'}});expect(response.status()).toBe(201);
  const links:RoomLinks=await response.json();
  const arena=(link:string)=>{const url=new URL(link);url.pathname='/arena3d.html';return url.href;};
  const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
  const [left,right,watch]=await Promise.all(contexts.map(c=>c.newPage())),states:ArenaState[]=[],errors:string[]=[];
  for(const p of [left,right,watch])p.on('pageerror',e=>errors.push(e.message));
  watch.on('websocket',ws=>ws.on('framereceived',({payload})=>{if(String(payload)==='pong')return;const m=JSON.parse(String(payload));if(m.type==='state')states.push(m);}));
  try{
    await watch.goto(arena(links.owner));await left.goto(arena(links.left));await expect(left.locator('body')).toHaveAttribute('data-role','left',{timeout:30_000});
    await right.goto(arena(links.right));await expect(right.locator('body')).toHaveAttribute('data-role','right',{timeout:30_000});
    await expect(watch.locator('canvas')).toHaveAttribute('data-rules','table-tennis');
    await expect(watch.locator('canvas')).toHaveAttribute('data-panels','0');
    await expect.poll(()=>states.some(s=>s.game.tt&&s.game.pointId>0&&s.game.bestRally>0),{timeout:60_000}).toBe(true);
    const point=states.find(s=>s.game.pointId>0&&s.game.bestRally>0)!;expect(point.mode).toBe('mock');expect(point.gameSpeed).toBe(.5);await expect(watch.locator('#pace')).toHaveText('0.5× SHARED PACE');
    const log=watch.getByRole('list',{name:'Recent decisions, newest first'});
    await expect(log.getByRole('listitem').filter({hasText:'Jev'}).first()).toBeVisible();
    await expect(log.getByRole('listitem').filter({hasText:'Luna'}).first()).toBeVisible();
    for(const side of ['left','right'] as const){
      expect(states.some(s=>s.tactics?.[side]?.source==='mock'&&s.tactics[side]?.status==='selected')).toBe(true);
      expect(states.some(s=>s.game.tt?.strokes[side]?.tactic)).toBe(true);
    }
    await right.close();await expect.poll(()=>states.at(-1)?.game.phase).toBe('lobby');
    const token=new URLSearchParams(new URL(links.owner).hash.slice(1)).get('token')!,headers={Authorization:`Bearer ${token}`};
    if(!process.env.LIVE_URL){
      const reconstructed=await request.get(`/api/rooms/${links.room}/reconstruct`,{headers});expect(reconstructed.ok()).toBe(true);
      const restored=await reconstructed.json();expect(restored.game.tt).toBeDefined();expect(restored.game.score).toEqual(states.at(-1)!.game.score);
    }
    const replacement=await contexts[1].newPage();await replacement.goto(arena(links.right));await expect(replacement.locator('body')).toHaveAttribute('data-role','right',{timeout:30_000});
    await watch.locator('#reset').click();
    await expect.poll(()=>states.at(-1)?.game.pointId).toBe(0);expect(states.at(-1)!.game.tt).toBeDefined();
    expect(errors).toEqual([]);
    console.log(`Workers 3D PASS: actual WebGL clients, table-tennis score ${point.game.score.left}:${point.game.score.right}, durable rules and reset/reconnect.`);
  }finally{await Promise.all(contexts.map(c=>c.close()));}
});
