import { TT_WIN } from '../table-tennis';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-mono/latin-400.css';
import { connect } from '../network';
import { createArenaInterpolator,interpolateGame } from './interpolation';
import { prepareRoom,type HostedRoom } from '../hosting';
import { createGame,WIN_SCORE,type GameState,type Side } from '../physics';
import type { PlayerInfo } from '../match';
import { createDecisionLog } from './decision-log';
import { isHardMatch, scriptFor, SCRIPTED_OPPONENTS } from '../hard-match';
import { createArena3D } from './scene';
import type { CameraView } from './cameras';
export function mountArena3D(root:HTMLElement,embedded?:{hosted:HostedRoom;origin:string}){
const params=new URLSearchParams(location.search);
const benchmarkMode=!embedded&&params.has('benchmark');
const requested:Side|null=!embedded&&!params.has('spectate')&&(params.get('side')==='left'||params.get('side')==='right')?params.get('side') as Side:null;
let view:CameraView=requested??'spectator',hosted:HostedRoom|null=null;
root.innerHTML=`
<header class="topbar"><h1 class="arena-title"><a class="wordmark" href="/arena3d.html?spectate">${benchmarkMode?'Decision benchmark':'System1 vs System2 Arena'}</a></h1><a id="classic" class="text-link" href="/?spectate">Original 2D view ↗</a></header>
<main>
<section class="match-header" aria-label="Live match score" ${benchmarkMode?'hidden':''}>
  <div class="scoreboard"><div class="score-agent left"><strong><span class="status-led" id="left-online"></span> <span id="left-name">Left</span></strong><small id="left-engine"></small></div>
  <div class="score-numbers"><span id="score-left">0</span><span class="score-separator">:</span><span id="score-right">0</span><small id="match-label">FIRST TO ${TT_WIN} · WIN BY 2</small></div>
  <div class="score-agent right"><strong><span class="status-led" id="right-online"></span> <span id="right-name">Right</span></strong><small id="right-engine"></small></div></div>
</section>
<section class="stage" aria-label="3D robot arena"><canvas aria-label="3D Pong arena with two humanoid robots"></canvas><div class="stage-vignette"></div><div class="stage-top"><div class="camera-label"><span class="record-dot"></span><span id="camera-label">SIDELINE / BROADCAST CAMERA</span></div><div class="live-info"><span id="brain-mode">CONNECTING</span><span id="network">● CONNECTING</span></div></div><div class="rally-stat"><span>RALLY</span><strong id="rally">00</strong><span id="best">BEST 00</span></div><div class="phase-overlay" id="phase-overlay"><span id="phase-kicker">INITIALIZING THE ARENA</span><h2 id="phase-title">Preparing the robots.</h2><p id="phase-detail">Loading the 3D scene…</p><div class="lobby-actions" id="lobby-actions"><a id="join-left" target="_blank" rel="noopener">Connect left player ↗</a><a id="join-right" target="_blank" rel="noopener">Connect right player ↗</a></div></div><div class="stage-bottom"><span class="lens-info" id="lens-info">43 MM / SIDE COURT</span><div class="camera-switch" role="group" aria-label="Camera angle"><button data-camera="left">01 <span id="left-pov">Left POV</span></button><button data-camera="spectator">◎ <span>Sideline</span></button><button data-camera="right">02 <span id="right-pov">Right POV</span></button></div><button id="fullscreen" title="Fullscreen arena" aria-label="Fullscreen arena">⛶</button></div></section>
<section class="under-stage"><div class="telemetry"><span id="latency">— ms</span><span>120 HZ SIM</span><span id="pace">1× SHARED PACE</span><span id="tick">TICK 00000</span><span id="seat">SPECTATOR</span></div><div class="match-actions"><button id="replay" disabled>↺ Replay point</button><button id="reset" disabled>New match ↗</button><a class="text-link" href="/arena3d.html?benchmark" ${benchmarkMode?'hidden':''}>Benchmark replays ↗</a></div></section>
<details id="match-settings" hidden>
  <summary><span id="difficulty-status">Difficulty · Standard</span></summary>
  <form id="difficulty-form" class="difficulty-form">
    <label>Difficulty <select id="difficulty"><option value="standard">Standard</option><option value="hard">Hard</option></select></label>
    <div id="hard-settings" class="hard-settings" hidden>
      <label>Opponent <select id="opponent"><option value="models">Model vs model</option>${Object.entries(SCRIPTED_OPPONENTS).map(([id, {name}])=>`<option value="${id}">${name} (scripted)</option>`).join('')}</select></label>
      <label id="model-seat-label" hidden>Model seat <select id="model-seat"><option value="left">Left</option><option value="right">Right</option></select></label>
      <label>Seed <input id="hard-seed" type="number" min="0" max="4294967295" required></label>
      <button type="button" id="random-seed">New seed</button>
    </div>
    <button type="submit">Start match</button>
  </form>
</details>
<p id="active-difficulty" class="active-difficulty" hidden></p>
<section id="benchmark-controls" hidden aria-label="Benchmark replay controls">
  <label>Replay file <input id="benchmark-file" type="file" accept=".json,application/json"></label>
  <label>Rally <select id="benchmark-clip" disabled></select></label>
  <button id="benchmark-play" disabled>Replay shot</button>
  <p id="benchmark-status" role="status"></p>
</section>
<section class="decision-feed" aria-labelledby="decision-heading" ${benchmarkMode?'hidden':''}>
  <h2 id="decision-heading">Decision log</h2>
  <p id="decision-empty">Waiting for the first shot.</p>
  <ol id="decision-list" role="list" aria-label="Recent decisions, newest first" tabindex="0" hidden></ol>
</section>
</main>`;
const el=(id:string)=>root.querySelector<HTMLElement>(`#${id}`)!;
const canvas=root.querySelector<HTMLCanvasElement>('canvas')!;
const openScene=()=>createArena3D(canvas,embedded?new URL('/models/arena-robot.glb',embedded.origin).href:undefined);
function route(side:Side|'spectator',classic=false){
  if(embedded)return '';
  let source:string;
  if(hosted){
    source=side==='spectator'?`${location.origin}/?room=${hosted.room}&spectate`:hosted.links?.[side]??(side===requested?location.href:'');
    if(!source)return '';
  }else source=`${location.origin}/?${side==='spectator'?'spectate':`side=${side}`}`;
  const url=new URL(source);url.pathname=classic?'/':'/arena3d.html';return url.href;
}
let arena:Awaited<ReturnType<typeof createArena3D>>|undefined,animation=0,connection:ReturnType<typeof connect>|undefined;
let disposed=false;
let stopBenchmarkReplay:(()=>void)|undefined;
let replay:GameState[]=[],replayStart=0,lastUI=0;
function playerName(side:Side,players:Record<Side,PlayerInfo>|undefined=connection?.state?.players){
  if(!players)return side==='left'?'Left':'Right';
  return scriptFor(connection?.state?.game.tt?.hard,side)?.name??players[side].name;
}
function setView(next:CameraView){view=next;document.body.dataset.camera=next;for(const button of root.querySelectorAll<HTMLButtonElement>('button[data-camera]'))button.setAttribute('aria-pressed',String(button.dataset.camera===next));el('camera-label').textContent=next==='spectator'?'SIDELINE / BROADCAST CAMERA':`${playerName(next).toUpperCase()} / ROBOT EYE CAMERA`;el('lens-info').textContent=next==='spectator'?'SIDE COURT / BROADCAST':'EYE LEVEL / FIRST PERSON';}
setView(view);
for(const button of root.querySelectorAll<HTMLButtonElement>('button[data-camera]'))button.onclick=()=>setView(button.dataset.camera as CameraView);
el('fullscreen').onclick=()=>{const stage=root.querySelector('.stage')!;if(document.fullscreenElement)void document.exitFullscreen();else void stage.requestFullscreen().catch(()=>{});};
function dispose(){
  if(disposed)return;
  disposed=true;removeEventListener('pagehide',dispose);
  cancelAnimationFrame(animation);stopBenchmarkReplay?.();connection?.close();arena?.dispose();
}
addEventListener('pagehide',dispose,{once:true});
async function startLiveArena(){
  hosted=embedded?.hosted??await prepareRoom();
  if(disposed)return;
  if(hosted&&!embedded){const current=new URL(location.href);current.pathname='/arena3d.html';history.replaceState(null,'',current);}
  if(embedded){
    root.querySelector<HTMLElement>('.topbar')!.hidden=true;
    root.querySelector<HTMLElement>('.match-actions a')!.hidden=true;
    el('fullscreen').hidden=true;
    el('reset').hidden=!!hosted?.privateView;
  }else{
    (el('classic') as HTMLAnchorElement).href=route('spectator',true);
    root.querySelector<HTMLAnchorElement>('.wordmark')!.href=route('spectator');
  }
  for(const side of ['left','right'] as const){const link=el(`join-${side}`) as HTMLAnchorElement;const href=route(side);link.hidden=!href;if(href)link.href=href;}
  // The table-tennis server runs the decisions when a shot is struck.
  const live=connection=connect(requested,hosted,'table-tennis');
  const settings=el('match-settings') as HTMLDetailsElement;
  const difficulty=el('difficulty') as HTMLSelectElement;
  const opponent=el('opponent') as HTMLSelectElement;
  const modelSeat=el('model-seat') as HTMLSelectElement;
  const seed=el('hard-seed') as HTMLInputElement;
  const randomizeSeed=()=>{seed.value=String(crypto.getRandomValues(new Uint32Array(1))[0]);};
  const updateSettingsFields=()=>{
    const hard=difficulty.value==='hard', scripted=opponent.value!=='models';
    el('hard-settings').hidden=!hard;
    el('model-seat-label').hidden=!scripted;
    seed.disabled=!hard;
  };
  difficulty.onchange=opponent.onchange=updateSettingsFields;
  el('random-seed').onclick=randomizeSeed;
  (el('difficulty-form') as HTMLFormElement).onsubmit=event=>{
    event.preventDefault();
    const hard=difficulty.value==='hard'?{seed:seed.valueAsNumber,opponent:opponent.value,modelSide:modelSeat.value}:null;
    if(!hard||isHardMatch(hard)){
      replay=[];
      live.send({type:'table-settings',hard});
      settings.open=false;
    }
  };
  let lastSettingsKey: string | undefined;
  live.onReplay=frames=>{if(frames.length){replay=frames;replayStart=performance.now();}};
  const renderDecisionLog=createDecisionLog(el('decision-list') as HTMLOListElement,el('decision-empty'));
  live.onTacticalLog=entries=>{
    const players=live.state?.players;
    if(players)renderDecisionLog(entries,{left:playerName('left',players),right:playerName('right',players)});
  };
  el('replay').onclick=()=>{if(replay.length)replay=[];else connection!.send({type:'replay'});};el('reset').onclick=()=>{replay=[];connection!.send({type:'reset'});};
  arena=await openScene();
  if(disposed){arena.dispose();return;}
  document.body.dataset.assets='ready';
  const interpolate=createArenaInterpolator(),initialGame=createGame('table-tennis');
  function frame(now:number){
    if(!connection||!arena)return;
    const state=connection.state,game=state?interpolate(state,connection.received,now):initialGame;let rendered=game;
    if(replay.length){const position=Math.max(0,(now-replayStart)/1000*30*(state?.gameSpeed??1)*.65),index=Math.floor(position);if(index>=replay.length)replay=[];else rendered=interpolateGame(replay[index],replay[Math.min(index+1,replay.length-1)],position-index);}
    const landing=rendered.tt?.tactical?.landing;
    arena.markLanding(replay.length&&landing?.side&&rendered.tick>=landing.strokeTick?landing:null,landing?.side??'left');
    if(!embedded||document.documentElement.dataset.mcpHidden!=='true')arena.render(rendered,view,now);
    if(now-lastUI>90){
      lastUI=now;el('score-left').textContent=String(rendered.score.left);el('score-right').textContent=String(rendered.score.right);el('rally').textContent=String(rendered.rally).padStart(2,'0');el('best').textContent=`BEST ${String(game.bestRally).padStart(2,'0')}`;
      const hard=state?.game.tt?.hard;
      const script=hard&&hard.opponent!=='models'?SCRIPTED_OPPONENTS[hard.opponent]:undefined;
      const settingsKey=hard?JSON.stringify(hard):'standard';
      const canConfigure=!!state&&connection.canReset&&(!!state.game.tt||(!state.connected.left&&!state.connected.right));
      settings.hidden=!canConfigure;
      el('active-difficulty').hidden=canConfigure||!hard;
      if(lastSettingsKey!==settingsKey){
        lastSettingsKey=settingsKey;
        const label=hard?`Difficulty · Hard · Seed ${hard.seed}${script?` · ${script.name}`:''}`:'Difficulty · Standard';
        el('difficulty-status').textContent=el('active-difficulty').textContent=label;
        difficulty.value=hard?'hard':'standard';opponent.value=hard?.opponent??'models';modelSeat.value=hard?.modelSide??'left';
        if(hard)seed.value=String(hard.seed);else randomizeSeed();
        updateSettingsFields();
      }
      el('match-label').textContent=game.phase==='won'?'MATCH COMPLETE':game.tt?(Math.max(game.score.left,game.score.right)>=10?(game.score.left===game.score.right?'DEUCE · WIN BY 2':'MATCH POINT'):`FIRST TO ${TT_WIN} · WIN BY 2`):`FIRST TO ${WIN_SCORE}`;
      el('network').textContent=`● ${connection.status}`;el('brain-mode').textContent=script&&hard&&state?`${state.players[hard.modelSide].mock?'MOCK':'LIVE'} + SCRIPTED`:state?.mode==='mock'?'MOCK TACTICS':state?.mode==='mixed'?'LIVE + MOCK TACTICS':state?'LIVE TACTICS':'CONNECTING';
      el('pace').textContent=`${state?.gameSpeed??1}× SHARED PACE`;el('latency').textContent=`${connection.latency} MS`;el('tick').textContent=`TICK ${String(Math.round(game.tick)).padStart(5,'0')}`;el('seat').textContent=(connection.side?`CONTROLLING ${connection.side.toUpperCase()}`:'SPECTATOR')+(game.tt?` / ${game.tt.shot.toUpperCase()}`:'');
      const phase=rendered.phase;el('phase-overlay').hidden=!state?.privateMatchEnded&&(phase==='play'||replay.length>0);el('phase-kicker').textContent=phase==='lobby'?'TWO MINDS. ONE ARENA.':phase==='serve'?'AGENTS READY / NEXT SERVE':phase==='won'?'MATCH COMPLETE':'POINT ON THE BOARD';
      const scorer=rendered.lastScorer;
      el('phase-title').textContent=phase==='lobby'?'The stage is set.':phase==='serve'?String(Math.max(1,Math.ceil(rendered.countdown))):scorer?`${playerName(scorer)} ${phase==='won'?'wins':'scores'}.`:'';
      el('phase-detail').textContent=phase==='lobby'?(script&&hard?`Connect ${playerName(hard.modelSide)} to play the ${script.name}.`:'Connect both player windows. Watch the match from here.'):phase==='serve'?'Players choose their shots as the ball approaches.':phase==='won'?'Rematch starts automatically.':`${game.tt?.reason??'POINT'} · ${rendered.rally} returns.`;el('lobby-actions').hidden=!!embedded||phase!=='lobby';
      if(embedded&&!hosted?.privateView&&phase==='lobby')el('phase-detail').textContent='Use the player controls above to connect.';
      if(state?.privateMatchEnded&&!replay.length){
        el('phase-overlay').hidden=false;
        el('phase-kicker').textContent='LIVE MATCH ENDED';
        if(phase!=='won')el('phase-title').textContent='The live match stopped.';
        el('phase-detail').textContent='Use Start live match to confirm another game.';
      }else if(replay.length)el('phase-overlay').hidden=true;
      for(const side of ['left','right'] as const){
        const player=state?.players[side];
        const scripted=scriptFor(hard,side);
        const name=playerName(side);
        const join=el(`join-${side}`) as HTMLAnchorElement;
        join.hidden=!!scripted||!join.hasAttribute('href');
        const seatLabel=player?`${player.name} (${side})`:side;
        const seatOption=modelSeat.options[side==='left'?0:1];
        if(seatOption.textContent!==seatLabel)seatOption.textContent=seatLabel;
        const nameLabel=el(`${side}-name`);
        if(nameLabel.textContent!==name){
          nameLabel.textContent=name;
          el(`${side}-pov`).textContent=`${name} POV`;
          el(`${side}-pov`).closest('button')!.setAttribute('aria-label',`${name} POV (${side})`);
          const link=el(`join-${side}`);
          link.textContent=`Connect ${name} ↗`;
          link.setAttribute('aria-label',`Connect ${name} (${side})`);
          if(view===side)el('camera-label').textContent=`${name.toUpperCase()} / ROBOT EYE CAMERA`;
        }
        el(`${side}-online`).classList.toggle('on',!!scripted||!!state?.connected[side]);
        el(`${side}-engine`).textContent=scripted?'SCRIPTED':player?(player.mock?'MOCK':player.model.toUpperCase()):'';
      }
      const replayButton=el('replay') as HTMLButtonElement;replayButton.disabled=game.pointId===0;replayButton.textContent=replay.length?'↺ Back to live':'↺ Replay point';(el('reset') as HTMLButtonElement).disabled=!connection.canReset;
      document.body.dataset.phase=game.phase;document.body.dataset.role=connection.side??'spectator';document.body.dataset.mode=state?.mode??'connecting';document.body.dataset.replay=String(replay.length>0);
    }
    animation=requestAnimationFrame(frame);
  }
  animation=requestAnimationFrame(frame);
}
async function start(){
  try{
    if(benchmarkMode){
      const {startBenchmarkReplay}=await import('./benchmark-replay');
      if(disposed)return;
      arena=await openScene();
      if(disposed){arena.dispose();return;}
      document.body.dataset.assets='ready';
      stopBenchmarkReplay=startBenchmarkReplay(arena,()=>view);
    }else await startLiveArena();
  }catch(error){
    if(disposed)return;
    el('phase-kicker').textContent='ARENA UNAVAILABLE';
    el('phase-title').textContent='Unable to open the arena.';
    el('phase-detail').textContent=error instanceof Error?error.message:'Please use a browser with WebGL 2 support.';
    el('lobby-actions').hidden=true;connection?.close();document.body.dataset.error='true';
  }
}
void start();
return dispose;
}
