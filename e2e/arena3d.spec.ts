import { test,expect,type Page } from '@playwright/test';
import type { ArenaState } from '../src/protocol';
test.use({launchOptions:{args:['--enable-unsafe-swiftshader']}});
test('3D eyes and sideline render the same scored WebSocket match while original 2D stays available',async({browser,baseURL},info)=>{
  test.setTimeout(180_000);
  const contexts=await Promise.all([browser.newContext({viewport:{width:1440,height:1000}}),browser.newContext({viewport:{width:1440,height:1000}}),browser.newContext({viewport:{width:1440,height:1000}})]);
  const [left,right,watch]=await Promise.all(contexts.map(c=>c.newPage())),errors:string[]=[],states:ArenaState[]=[],intents={left:0,right:0};
  function observe(page:Page,side:'left'|'right'|'spectator'){
    page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>{
      ws.on('framereceived',({payload})=>{const state=JSON.parse(String(payload));if(side==='spectator'&&state.type==='state')states.push(state);});
      ws.on('framesent',({payload})=>{const m=JSON.parse(String(payload));if(m.type==='intent'&&side!=='spectator')intents[side]++;});
    });
  }
  observe(left,'left');observe(right,'right');observe(watch,'spectator');
  try{
    await watch.goto('/arena3d.html?spectate');await expect(watch.locator('body')).toHaveAttribute('data-assets','ready',{timeout:30_000});
    await left.goto('/arena3d.html?side=left');await expect(left.locator('body')).toHaveAttribute('data-role','left',{timeout:30_000});
    await right.goto('/arena3d.html?side=right');await expect(right.locator('body')).toHaveAttribute('data-role','right',{timeout:30_000});
    for(const [page,view] of [[left,'left'],[right,'right'],[watch,'spectator']] as const){
      await expect(page.locator('canvas')).toHaveAttribute('data-camera',view);await expect(page.locator('canvas')).toHaveAttribute('data-robots','2');
      await expect.poll(async()=>Number(await page.locator('canvas').getAttribute('data-triangles'))).toBeGreaterThan(10_000);
      expect(await page.evaluate(()=>document.querySelector('canvas')!.getContext('webgl2')!==null)).toBe(true);
    }
    await watch.locator('#reset').click();
    await expect.poll(()=>states.at(-1)?.game.pointId===0&&states.at(-1)?.game.score.left===0&&states.at(-1)?.game.score.right===0).toBe(true);
    states.length=0;
    await expect.poll(()=>states.some(s=>s.game.phase==='play'&&Math.abs(s.game.ball.x-500)>80),{timeout:20_000}).toBe(true);
    await expect.poll(()=>intents.left>4&&intents.right>4).toBe(true);
    await expect.poll(()=>states.some(s=>s.game.pointId>0),{timeout:90_000}).toBe(true);
    const scored=states.find(s=>s.game.pointId>0)!;expect(scored.mode).toBe('mock');
    for(const side of ['left','right'] as const)expect(Math.max(...states.map(s=>s.game.paddles[side]))-Math.min(...states.map(s=>s.game.paddles[side]))).toBeGreaterThan(20);
    await expect.poll(async()=>{const score=states.at(-1)!.game.score;const displayed=await Promise.all([left,right,watch].map(async p=>[await p.locator('#score-left').textContent(),await p.locator('#score-right').textContent()]));return displayed.every(([l,r])=>l===String(score.left)&&r===String(score.right));}).toBe(true);
    await watch.screenshot({path:info.outputPath('3d-sideline.png'),fullPage:true});await left.screenshot({path:info.outputPath('3d-left-eyes.png'),fullPage:true});await right.screenshot({path:info.outputPath('3d-right-eyes.png'),fullPage:true});
    await watch.bringToFront();await watch.getByRole('button',{name:/Replay point/}).click();await expect(watch.locator('body')).toHaveAttribute('data-replay','true');await watch.getByRole('button',{name:/Back to live/}).click();
    await watch.getByRole('button',{name:/Vector POV/}).click();await expect(watch.locator('canvas')).toHaveAttribute('data-camera','left');await watch.getByRole('button',{name:/Sideline/}).click();
    const classic=await contexts[2].newPage();await classic.goto('/?spectate');await expect(classic.locator('h1')).toContainText('Jev');await expect.poll(async()=>Number(await classic.locator('#score-left').textContent())===states.at(-1)!.game.score.left).toBe(true);
    expect(await classic.locator('canvas').evaluate(c=>(c as HTMLCanvasElement).getContext('2d')!==null)).toBe(true);await classic.close();
    await watch.setViewportSize({width:480,height:1000});expect(await watch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await watch.screenshot({path:info.outputPath('3d-mobile.png'),fullPage:true});
    await right.close();await expect(watch.locator('#right-online')).not.toHaveClass(/on/);
    expect(errors).toEqual([]);console.log(`3D PASS: Blender GLB + two robots; eye cameras left/right, sideline; score ${scored.game.score.left}:${scored.game.score.right}; ${intents.left}/${intents.right} intents; original 2D shares score; replay/camera/mobile/leave verified.`);
  }finally{await Promise.all(contexts.map(c=>c.close()));}
});
