import { test,expect } from '@playwright/test';
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import WebSocket from 'ws';
import type { ArenaState } from '../src/protocol';
import type { HostedRoom } from '../src/host-types';
test('public MCP on Workers: discovery, private capabilities, sandbox UI, shared web score and teardown',async({browser,baseURL,request},info)=>{
  const client=new Client({name:'Cloudflare MCP verification',version:'1.0.0'});
  const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',baseURL)));
    const {tools}=await client.listTools();expect(tools.map(t=>t.name).sort()).toEqual(['open_pong','pong_status']);
    expect((tools.find(t=>t.name==='open_pong')!._meta!.ui as {resourceUri:string}).resourceUri).toBe('ui://jev-pong/arena.html');
    const resource=(await client.readResource({uri:'ui://jev-pong/arena.html'})).contents[0];
    expect(resource.mimeType).toBe('text/html;profile=mcp-app');expect('text' in resource).toBe(true);
    if('text' in resource){expect(resource.text).not.toMatch(/<script[^>]+src=/);for(const key of ['OPENAI_API_KEY','TYPESAFE_API_KEY','api.openai.com'])expect(resource.text).not.toContain(key);}
    const opened=await client.callTool({name:'open_pong',arguments:{}});
    expect(opened.isError).toBeUndefined();expect(JSON.stringify(opened.structuredContent)).not.toContain('token');expect(JSON.stringify(opened.content)).not.toContain('#token=');
    const conn=opened._meta!.connection as {token:string;hosted:HostedRoom};
    const getStatus=async(room:string)=>{const s=await client.callTool({name:'pong_status',arguments:{room}});expect(s.isError).toBeUndefined();return s.structuredContent as unknown as ArenaState&{timerActive:boolean;calls:number};};
    expect((await getStatus(conn.hosted.room)).mode).toBe('mock');
    // Cross-origin sandbox sockets require the per-room MCP capability, not just any query value.
    await new Promise<void>((resolve,reject)=>{const url=new URL(`/api/rooms/${conn.hosted.room}/ws?mcp_token=invalid`,baseURL);url.protocol=url.protocol==='https:'?'wss:':'ws:';const ws=new WebSocket(url,{origin:'https://untrusted.invalid'});ws.on('open',()=>{ws.terminate();reject(new Error('Invalid capability accepted'));});ws.on('unexpected-response',(_,r)=>{expect(r.statusCode).toBe(403);r.resume();resolve();});ws.on('error',()=>resolve());});
    const page=await contexts[0].newPage(),web=await contexts[1].newPage(),external=await contexts[2].newPage(),frames:ArenaState[]=[],errors:string[]=[],rooms=new Set<string>();
    page.on('pageerror',e=>errors.push(e.message));web.on('pageerror',e=>errors.push(e.message));
    page.on('websocket',ws=>{const room=new URL(ws.url()).pathname.split('/')[3];rooms.add(room);ws.on('framereceived',({payload})=>{if(String(payload)==='pong')return;const m=JSON.parse(String(payload));if(m.type==='state')frames.push(m);});});
    await page.goto('http://127.0.0.1:5398');
    await expect(page.locator('body')).toHaveAttribute('data-mcp-connected','true');
    const app=page.frameLocator('#app-frame').frameLocator('iframe[title="Jev Pong MCP App"]');
    await expect(app.locator('html')).toHaveAttribute('data-mcp-ready','true');await expect(app.locator('canvas')).toBeVisible();
    await expect.poll(()=>rooms.size).toBe(1);const room=[...rooms][0];expect(room).not.toBe(conn.hosted.room);
    await web.goto(`${baseURL}/?room=${room}&spectate`);await expect(web.locator('#reset')).toBeDisabled();
    await app.getByRole('button',{name:'Start AI players'}).click();
    await expect(app.locator('#left-online')).toHaveText('ONLINE');await expect(app.locator('#right-online')).toHaveText('ONLINE');
    await expect.poll(()=>frames.some(s=>s.game.phase==='play'&&Math.abs(s.game.ball.x-500)>80)).toBe(true);
    await expect.poll(()=>frames.some(s=>s.intents.left>4&&s.intents.right>4)).toBe(true);
    for(const side of ['left','right'] as const)await expect.poll(()=>Math.max(...frames.map(s=>s.game.paddles[side]))-Math.min(...frames.map(s=>s.game.paddles[side]))).toBeGreaterThan(20);
    await expect.poll(()=>frames.some(s=>s.game.pointId>0),{timeout:90_000}).toBe(true);
    const state=await getStatus(room);expect(state.mode).toBe('mock');expect(state.calls).toBe(0);
    await expect(app.locator('#score-left')).toHaveText(String(state.game.score.left));await expect(web.locator('#score-right')).toHaveText(String(state.game.score.right));
    await page.screenshot({path:info.outputPath('cloudflare-mcp-app.png'),fullPage:true});
    await app.getByRole('button',{name:/Replay last point/}).click();await expect(app.locator('body')).toHaveAttribute('data-replay','true');await app.getByRole('button',{name:/Back to live/}).click();
    await app.getByRole('button',{name:'Expand',exact:true}).click();await expect(page.locator('body')).toHaveClass('fullscreen');await app.getByRole('button',{name:'Collapse',exact:true}).click();
    await app.getByRole('button',{name:'Jev vs Luna',exact:true}).click();await expect(web.locator('#right-engine')).toHaveText('Luna');expect((await getStatus(room)).players.right.mock).toBe(true);
    await app.getByRole('button',{name:'Stop AI players'}).click();await expect.poll(async()=>(await getStatus(room)).timerActive).toBe(false);
    await app.getByRole('button',{name:'Start AI players'}).click();await expect(app.locator('#right-online')).toHaveText('ONLINE');
    await page.getByRole('button',{name:'Close app'}).click();await expect.poll(async()=>(await getStatus(room)).timerActive).toBe(false);
    expect((await getStatus(room)).connected).toEqual({left:false,right:false});
    // Ordinary three-window web app remains usable in a separate MCP-created room.
    await external.goto(conn.hosted.links!.left);await expect(external.locator('body')).toHaveAttribute('data-role','left');
    expect(errors).toEqual([]);
    console.log(`Workers MCP PASS: ${frames.length} frames, score ${state.game.score.left}:${state.game.score.right}, ${state.intents.left}/${state.intents.right} intents; isolated rooms, sandbox auth, mock-only/no paid calls, web sync, replay/fullscreen/matchup/teardown.`);
  }finally{await Promise.all(contexts.map(c=>c.close()));await client.close();}
});
