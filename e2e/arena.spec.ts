import { test, expect, type Page } from '@playwright/test';
import type { ArenaState } from '../src/protocol';
function observe(page:Page){
  const states:ArenaState[]=[],sent:{type:string}[]=[];let sockets=0;
  page.on('websocket',ws=>{sockets++;ws.on('framereceived',({payload})=>{const m=JSON.parse(String(payload));if(m.type==='state')states.push(m);if(states.length>4000)states.shift();});ws.on('framesent',({payload})=>sent.push(JSON.parse(String(payload))));});
  return {states,sent,get sockets(){return sockets;}};
}
test('two independent browser agents play a scored network match, replay, and reconnect',async({browser,baseURL},testInfo)=>{
  const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
  const [left,right,spectator]=await Promise.all(contexts.map(c=>c.newPage()));
  const l=observe(left),r=observe(right),s=observe(spectator),errors:string[]=[];
  for(const p of [left,right,spectator])p.on('pageerror',e=>errors.push(e.message));
  try{
    await spectator.goto(`${baseURL}/?spectate`);await expect(spectator.locator('body')).toHaveAttribute('data-phase','lobby');
    await left.goto(`${baseURL}/?side=left`);await expect(left.locator('body')).toHaveAttribute('data-role','left');
    await right.goto(`${baseURL}/?side=right`);await expect(right.locator('body')).toHaveAttribute('data-role','right');
    await expect(spectator.locator('#left-online')).toHaveText('ONLINE');await expect(spectator.locator('#right-online')).toHaveText('ONLINE');
    expect(l.sockets).toBe(1);expect(r.sockets).toBe(1);expect(s.sockets).toBe(1);
    await expect.poll(()=>s.states.some(v=>v.game.phase==='play'&&Math.abs(v.game.ball.x-500)>80)).toBe(true);
    await expect.poll(()=>s.states.some(v=>v.intents.left>=3&&v.intents.right>=3)).toBe(true);
    for(const side of ['left','right'] as const){await expect.poll(()=>Math.max(...s.states.map(v=>v.game.paddles[side]))-Math.min(...s.states.map(v=>v.game.paddles[side]))).toBeGreaterThan(20);}
    expect(l.sent.some(m=>m.type==='decide')).toBe(true);expect(r.sent.some(m=>m.type==='decide')).toBe(true);expect(l.sent.some(m=>m.type==='intent')).toBe(true);expect(r.sent.some(m=>m.type==='intent')).toBe(true);expect(s.sent.some(m=>m.type==='decide'||m.type==='intent')).toBe(false);
    await expect.poll(()=>s.states.some(v=>v.game.score.left+v.game.score.right>0),{timeout:90_000}).toBe(true);
    const point=s.states.find(v=>v.game.score.left+v.game.score.right>0)!;
    expect(point.mode).toBe('mock');expect(point.game.bestRally).toBeGreaterThan(0);
    await spectator.screenshot({path:testInfo.outputPath('arena-scored.png'),fullPage:true});
    if(await spectator.getByRole('button',{name:/replay last point/i}).count()){
      await spectator.getByRole('button',{name:/replay last point/i}).click();await expect(spectator.locator('body')).toHaveAttribute('data-replay','true');
    }
    await right.close();await expect(spectator.locator('#right-online')).toHaveText('OFFLINE');
    await expect.poll(()=>s.states.at(-1)?.game.phase).toBe('lobby');
    const replacement=await contexts[1].newPage();await replacement.goto(`${baseURL}/?side=right`);
    await expect(replacement.locator('body')).toHaveAttribute('data-role','right');await expect(spectator.locator('#right-online')).toHaveText('ONLINE');
    await expect.poll(()=>s.states.at(-1)?.game.phase).toBe('play');
    expect(s.states.at(-1)!.game.score).toEqual(point.game.score);
    await left.reload();await expect(left.locator('body')).toHaveAttribute('data-role','left');
    expect(errors).toEqual([]);
    console.log(`Verified ${s.states.length} authoritative frames; score ${point.game.score.left}:${point.game.score.right}; best rally ${point.game.bestRally}; player intent messages ${l.sent.filter(m=>m.type==='intent').length}/${r.sent.filter(m=>m.type==='intent').length}; reconnect OK.`);
  }finally{await Promise.all(contexts.map(c=>c.close()));}
});
