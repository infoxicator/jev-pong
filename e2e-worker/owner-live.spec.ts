import { test, expect } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import WebSocket from 'ws';
import { once } from 'node:events';
import { createPairingKey, pairingChallenge } from '../src/live-pairing';
import type { ArenaState } from '../src/protocol';

const host = 'http://127.0.0.1:5398';
const identity = {'X-Test-Access-Identity':'owner@example.test'};
const socketURL = (baseURL:string,room:string) => {
  const url=new URL(`/api/rooms/${room}/ws?view=private`,baseURL);
  url.protocol='ws:';
  return url;
};
const join = (ws:WebSocket,token:string) => ws.send(JSON.stringify({type:'join',side:null,token,rules:'table-tennis'}));

test('owner confirmation is the only live entry point and pairing is private and one-time',async({request,baseURL})=>{
  test.skip(!!process.env.LIVE_URL,'Uses a fixture identity and provider');
  const room=crypto.randomUUID(), verifier=createPairingKey(), challenge=await pairingChallenge(verifier);
  const ownerPath=`/owner/live?pair=${room}`, form={matchup:'jev-vs-jev',confirm:'start',challenge};
  const pair=(key:string)=>request.post('/api/live-pair',{data:{room,key}});
  const claim=(key:string)=>request.post('/api/live-pair/claim',{data:{room,key}});
  expect((await request.post('/api/live-pair',{headers:{'X-Test-No-Access':'1'},data:{room,key:challenge}})).status()).toBe(503);
  expect((await pair(challenge)).status()).toBe(201);
  expect((await pair(challenge)).status()).toBe(409);
  expect((await claim(verifier)).status()).toBe(202);
  expect((await claim(challenge)).status()).toBe(403);
  expect((await request.get(ownerPath)).status()).toBe(403);
  expect((await request.get(ownerPath,{headers:{'X-Test-Access-Identity':'other@example.test'}})).status()).toBe(403);
  const get=await request.get(ownerPath,{headers:identity});
  expect(get.status()).toBe(200);expect(get.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(await get.text()).toContain(room.slice(0,8));
  expect((await request.post(ownerPath,{form,headers:{Origin:baseURL!}})).status()).toBe(403);
  expect((await request.post(ownerPath,{form,headers:{Origin:'https://elsewhere.example',...identity}})).status()).toBe(403);
  expect((await request.post(ownerPath,{form:{...form,confirm:''},headers:{Origin:baseURL!,...identity}})).status()).toBe(400);
  expect((await request.post(ownerPath,{form:{...form,challenge:createPairingKey()},headers:{Origin:baseURL!,...identity}})).status()).toBe(409);
  expect((await claim(verifier)).status()).toBe(202);

  const mock=await request.post('/api/rooms',{headers:{Origin:baseURL!,Authorization:'Bearer local-test-only','X-Real-Room':'true',...identity}});
  const mockRoom=await mock.json();
  const ownerToken=new URLSearchParams(new URL(mockRoom.owner).hash.slice(1)).get('token');
  const mockStatus=await request.get(`/api/rooms/${mockRoom.room}/status`,{headers:{Authorization:`Bearer ${ownerToken}`}});
  expect(await mockStatus.json()).toMatchObject({mode:'mock',calls:0,timerActive:false});

  const start=()=>request.post(ownerPath,{form,headers:{Origin:baseURL!,...identity}});
  const starts=await Promise.all([start(),start()]);
  expect(starts.map(response=>response.status()).sort()).toEqual([200,409]);
  const pickups=await Promise.all([claim(verifier),claim(verifier)]);
  expect(pickups.map(response=>response.status()).sort()).toEqual([200,410]);
  const {token}=await pickups.find(response=>response.ok())!.json();
  for(const path of ['info','links','status']){
    expect((await request.get(`/api/rooms/${room}/${path}`,{headers:{Authorization:`Bearer ${token}`}})).status()).toBe(410);
  }
  expect((await request.post(`/api/rooms/${room}/start-live`,{headers:identity})).status()).toBe(404);
  const client=new Client({name:'Private room verification',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',baseURL)));
  try{
    expect((await client.callTool({name:'pong_status',arguments:{room}})).isError).toBe(true);
    expect((await client.callTool({name:'open_pong',arguments:{invite:`pong:${room}:right:${crypto.randomUUID()}`}})).isError).toBe(true);
  }finally{await client.close();}

  const wrong = new WebSocket(socketURL(baseURL!,room),{origin:'https://embedded.example'});
  const unauthorized:string[]=[];
  wrong.on('message',raw=>unauthorized.push(String(raw)));
  await once(wrong,'open');
  join(wrong,verifier);
  expect((await once(wrong,'close'))[0]).toBe(1008);expect(unauthorized).toEqual([]);

  const connect=async()=>{
    const ws=new WebSocket(socketURL(baseURL!,room),{origin:'https://embedded.example'});
    const messages:Record<string,unknown>[]=[];
    ws.on('message',raw=>messages.push(JSON.parse(String(raw))));
    const waiting=once(ws,'message');
    await once(ws,'open');
    join(ws,token);
    expect(JSON.parse(String((await waiting)[0]))).toEqual({type:'joined',side:null,canReset:false});
    return {ws,messages};
  };
  const {ws:viewer}=await connect();
  try{
    const states:ArenaState[]=[],errors:string[]=[];
    viewer.on('message',raw=>{const message=JSON.parse(String(raw));if(message.type==='state')states.push(message);if(message.type==='error')errors.push(message.message);});
    for(const type of ['reset','matchup','table-settings','decide','intent','join'])viewer.send(JSON.stringify({type,side:'left',token}));
    await expect.poll(()=>errors.length).toBe(6);
    expect(new Set(errors)).toEqual(new Set(['This live view is read-only']));
    await expect.poll(()=>states.at(-1)?.game.tick??0).toBeGreaterThan(150);
    expect(states.at(-1)?.game.tt).toBeDefined();
    const calls=async()=>((await (await request.get(`/api/rooms/${room}/live-checkpoint`)).json()).calls as number);
    await expect.poll(calls,{timeout:15_000}).toBeGreaterThan(0);
    expect((await request.get(`/api/rooms/${room}/suspend-live`)).status()).toBe(500);
    const prior=await calls();
    const reopened=await connect();
    try{
      await expect.poll(()=>reopened.messages.find(message=>message.type==='state')).toMatchObject({privateMatchEnded:true});
      expect((await start()).status()).toBe(409);
      expect(await calls()).toBe(prior);
    }finally{reopened.ws.close();}
  }finally{viewer.close();}

  const expired=crypto.randomUUID();
  expect((await request.post('/api/live-pair',{data:{room:expired,key:challenge}})).status()).toBe(201);
  expect((await request.get(`/api/rooms/${expired}/expire-pair`)).status()).toBe(204);
  expect((await request.post(`/owner/live?pair=${expired}`,{form,headers:{Origin:baseURL!,...identity}})).status()).toBe(410);
  expect((await request.post('/api/live-pair/claim',{data:{room:expired,key:verifier}})).status()).toBe(410);
});

test('the initiating embedded arena opens the owner page and picks up a confirmed private match',async({browser,baseURL})=>{
  test.skip(!!process.env.LIVE_URL,'Uses a fixture identity and provider');
  const context=await browser.newContext();
  await context.route(`${baseURL}/owner/live?*`,route=>route.continue({headers:{...route.request().headers(),...identity}}));
  try{
    const page=await context.newPage();
    await page.goto(`${host}/?rules=pong`);
    const app=page.frameLocator('#app-frame').frameLocator('iframe[title="Jev Pong MCP App"]');
    const popup=context.waitForEvent('page');
    await app.getByRole('button',{name:'Start live match ↗'}).click();
    const owner=await popup;
    await expect(owner.getByRole('heading',{name:'Confirm live match'})).toBeVisible();
    const code=(await owner.locator('strong').textContent())!;
    await expect(app.locator('#mcp-pairing')).toContainText(code);
    await expect(app.getByRole('button',{name:'Start AI players'})).toBeVisible();
    await owner.getByRole('button',{name:'Confirm and start live match'}).click();
    await expect(owner.getByRole('heading',{name:'Live match started'})).toBeVisible();
    await page.bringToFront();
    await expect(app.locator('#mcp-status')).toHaveText('Private live match · Spectator');
    await expect(app.locator('canvas')).toHaveAttribute('data-rendered','true');
    await expect(app.locator('#decision-list li').first()).toBeVisible({timeout:15_000});
    await expect(app.locator('#reset')).toBeHidden();
    await expect(app.getByRole('textbox',{name:'Player invitation'})).toBeHidden();
  }finally{await context.close();}
});
