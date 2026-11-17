import { test,expect,type Page } from '@playwright/test';
import type { ArenaState } from '../src/protocol';
test.use({launchOptions:{args:['--enable-unsafe-swiftshader']}});
for(const matchup of ['jev-vs-jev','jev-vs-luna'] as const)test(`3D ${matchup}: eyes and sideline render the same scored WebSocket match while original 2D stays available`,async({browser,baseURL},info)=>{
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
    await watch.evaluate(matchup=>new Promise<void>(resolve=>{const ws=new WebSocket(`ws://${location.host}/ws`);ws.onopen=()=>ws.send(JSON.stringify({type:'matchup',matchup}));ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='state'&&m.matchup===matchup){ws.close();resolve();}};}),matchup);
    await left.goto('/arena3d.html?side=left');await expect(left.locator('body')).toHaveAttribute('data-role','left',{timeout:30_000});
    await right.goto('/arena3d.html?side=right');await expect(right.locator('body')).toHaveAttribute('data-role','right',{timeout:30_000});
    for(const [page,view] of [[left,'left'],[right,'right'],[watch,'spectator']] as const){
      await expect(page.locator('canvas')).toHaveAttribute('data-camera',view);await expect(page.locator('canvas')).toHaveAttribute('data-robots','2');
      await expect(page.locator('canvas')).toHaveAttribute('data-panels','0');
      await expect(page.locator('canvas')).toHaveAttribute('data-rules','table-tennis');
      await expect.poll(async()=>Number(await page.locator('canvas').getAttribute('data-triangles'))).toBeGreaterThan(10_000);
      expect(await page.evaluate(()=>document.querySelector('canvas')!.getContext('webgl2')!==null)).toBe(true);
    }
    // Sample the real loaded rig during the network match, not just a still image.
    await watch.evaluate(()=>{
      (window as unknown as {motionErrors:string[]}).motionErrors=[];
      let frames=0;
      const sample=()=>{
        const data=document.querySelector('canvas')!.dataset;
        const errors=(window as unknown as {motionErrors:string[]}).motionErrors;
        if(Number(data.contactError)>.006)errors.push(`Unreachable bat: ${data.contactError}`);
        if(data.overTable==='true'&&Number(data.ballClearance)<-.0001)errors.push(`Ball below table: ${data.ballClearance}`);
        if(++frames<2400)requestAnimationFrame(sample);
      };requestAnimationFrame(sample);
    });
    await watch.locator('#reset').click();
    await expect.poll(()=>states.at(-1)?.game.pointId===0&&states.at(-1)?.game.score.left===0&&states.at(-1)?.game.score.right===0).toBe(true);
    states.length=0;
    await expect.poll(()=>states.some(s=>s.game.phase==='play'&&Math.abs(s.game.ball.x-500)>80),{timeout:20_000}).toBe(true);
    await expect.poll(()=>intents.left>4&&intents.right>4).toBe(true);
    await expect.poll(()=>states.some(s=>s.game.pointId>0),{timeout:90_000}).toBe(true);
    const scored=states.find(s=>s.game.pointId>0)!;expect(scored.mode).toBe('mock');expect(scored.matchup).toBe(matchup);expect(scored.gameSpeed).toBe(matchup==='jev-vs-luna'?.5:1);
    await expect(watch.locator('#pace')).toHaveText(`${scored.gameSpeed}× SHARED PACE`);
    for(const side of ['left','right'] as const)await expect.poll(()=>states.some(s=>{const stroke=s.game.tt?.strokes[side];return stroke&&stroke.kind!=='serve';}),{timeout:60_000}).toBe(true);
    expect(scored.players.left.engine).toBe('jev');expect(scored.players.right.engine).toBe(matchup==='jev-vs-luna'?'luna':'jev');
    await expect.poll(()=>states.some(s=>s.decisions.left?.source==='mock'&&s.decisions.right?.source==='mock')).toBe(true);
    expect(scored.game.tt).toBeDefined();expect(scored.game.tt!.bounceId).toBeGreaterThan(1);
    expect(Math.max(...states.map(s=>s.game.tt!.height))-Math.min(...states.map(s=>s.game.tt!.height))).toBeGreaterThan(.2);
    for(const side of ['left','right'] as const)await expect.poll(()=>Math.max(...states.map(s=>s.game.paddles[side]))-Math.min(...states.map(s=>s.game.paddles[side])),{timeout:30_000}).toBeGreaterThan(20);
    await expect.poll(async()=>{const score=states.at(-1)!.game.score;const displayed=await Promise.all([left,right,watch].map(async p=>[await p.locator('#score-left').textContent(),await p.locator('#score-right').textContent()]));return displayed.every(([l,r])=>l===String(score.left)&&r===String(score.right));}).toBe(true);
    await watch.screenshot({path:info.outputPath('3d-sideline.png'),fullPage:true});await left.screenshot({path:info.outputPath('3d-left-eyes.png'),fullPage:true});await right.screenshot({path:info.outputPath('3d-right-eyes.png'),fullPage:true});
    await watch.bringToFront();await watch.getByRole('button',{name:/Replay point/}).click();await expect(watch.locator('body')).toHaveAttribute('data-replay','true');await watch.getByRole('button',{name:/Back to live/}).click();
    await watch.getByRole('button',{name:/Vector POV/}).click();await expect(watch.locator('canvas')).toHaveAttribute('data-camera','left');await watch.getByRole('button',{name:/Sideline/}).click();
    const classic=await contexts[2].newPage();await classic.goto('/?spectate');await expect(classic.locator('h1')).toContainText('Jev');await expect.poll(async()=>Number(await classic.locator('#score-left').textContent())===states.at(-1)!.game.score.left).toBe(true);
    expect(await classic.locator('canvas').evaluate(c=>(c as HTMLCanvasElement).getContext('2d')!==null)).toBe(true);await classic.close();
    await watch.setViewportSize({width:480,height:1000});expect(await watch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await watch.screenshot({path:info.outputPath('3d-mobile.png'),fullPage:true});
    await right.close();await expect(watch.locator('#right-online')).not.toHaveClass(/on/);
    expect(await watch.evaluate(()=>(window as unknown as {motionErrors:string[]}).motionErrors)).toEqual([]);
    expect(errors).toEqual([]);console.log(`3D ${matchup} PASS: Blender GLB + two robots; eye cameras left/right, sideline; score ${scored.game.score.left}:${scored.game.score.right}; ${intents.left}/${intents.right} intents; original 2D shares score; replay/camera/mobile/leave verified.`);
  }finally{await Promise.all(contexts.map(c=>c.close()));}
});
