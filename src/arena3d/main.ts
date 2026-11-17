import { TT_WIN } from '../table-tennis';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-mono/latin-400.css';
import './style.css';
import { connect } from '../network';
import { createArenaInterpolator,interpolateGame } from './interpolation';
import { prepareRoom,type HostedRoom } from '../hosting';
import { createGame,WIN_SCORE,type GameState,type Side } from '../physics';
import { PERSONAS } from '../agents';
import { createArena3D } from './scene';
import type { CameraView } from './cameras';
const root=document.getElementById('arena3d')!,params=new URLSearchParams(location.search);
const benchmarkMode=params.has('benchmark');
const requested:Side|null=!params.has('spectate')&&(params.get('side')==='left'||params.get('side')==='right')?params.get('side') as Side:null;
let view:CameraView=requested??'spectator',hosted:HostedRoom|null=null;
root.innerHTML=`
<header class="topbar"><a class="wordmark" href="/arena3d.html?spectate"><span class="mark">J<span>↗</span></span><span>JEV<span class="wordmark-slash">/</span>ARENA<small>EMBODIED INTELLIGENCE</small></span></a><div class="top-label">EXPERIMENT 002 <span>·</span> SYNTHETIC ATHLETICS</div><a id="classic" class="text-link" href="/?spectate">Original 2D view ↗</a></header>
<main>
<section class="match-header"><div class="match-heading"><div class="eyebrow"><i></i> AUTONOMOUS TABLE TENNIS</div><h1>Built to think.<br><span>Now built to play.</span></h1></div><div class="scoreboard" aria-label="Live match score"><div class="score-agent left"><span class="agent-no">01</span><div><strong>VECTOR</strong><small id="left-engine">JEV / SYSTEM ONE</small></div></div><div class="score-numbers"><span id="score-left">0</span><span class="score-separator">:</span><span id="score-right">0</span><small id="match-label">FIRST TO ${TT_WIN} · WIN BY 2</small></div><div class="score-agent right"><div><strong>CHAOS</strong><small id="right-engine">JEV / SYSTEM ONE</small></div><span class="agent-no">02</span></div></div></section>
<section class="stage" aria-label="3D robot arena"><canvas aria-label="3D Pong arena with two humanoid robots"></canvas><div class="stage-vignette"></div><div class="stage-top"><div class="camera-label"><span class="record-dot"></span><span id="camera-label">SIDELINE / BROADCAST CAMERA</span></div><div class="live-info"><span id="brain-mode">CONNECTING</span><span id="network">● CONNECTING</span></div></div><div class="world-title" aria-hidden="true">THE EMBODIED SERIES <span>001—002</span></div><div class="rally-stat"><span>RALLY</span><strong id="rally">00</strong><span id="best">BEST 00</span></div><div class="phase-overlay" id="phase-overlay"><span id="phase-kicker">INITIALIZING THE ARENA</span><h2 id="phase-title">Preparing the robots.</h2><p id="phase-detail">Loading the 3D scene…</p><div class="lobby-actions" id="lobby-actions"><a id="join-left" target="_blank" rel="noopener">Connect Vector ↗</a><a id="join-right" target="_blank" rel="noopener">Connect Chaos ↗</a></div></div><div class="stage-bottom"><span class="lens-info" id="lens-info">43 MM / SIDE COURT</span><div class="camera-switch" role="group" aria-label="Camera angle"><button data-camera="left">01 <span>Vector POV</span></button><button data-camera="spectator">◎ <span>Sideline</span></button><button data-camera="right">02 <span>Chaos POV</span></button></div><button id="fullscreen" title="Fullscreen arena" aria-label="Fullscreen arena">⛶</button></div></section>
<section class="under-stage"><div class="telemetry"><span id="latency">— ms</span><span>120 HZ SIM</span><span id="pace">1× SHARED PACE</span><span id="tick">TICK 00000</span><span id="seat">SPECTATOR</span></div><div class="match-actions"><button id="replay" disabled>↺ Replay point</button><button id="reset">New match ↗</button><a class="text-link" href="/arena3d.html?benchmark" ${benchmarkMode?'hidden':''}>Benchmark replays ↗</a></div></section>
<section id="benchmark-controls" hidden aria-label="Benchmark replay controls">
  <label>Replay file <input id="benchmark-file" type="file" accept=".json,application/json"></label>
  <label>Rally <select id="benchmark-clip" disabled></select></label>
  <button id="benchmark-play" disabled>Replay shot</button>
  <p id="benchmark-status" role="status"></p>
</section>
<section class="agent-panels" aria-label="Live agent decisions">${(['left','right'] as const).map(side=>`<article class="agent-panel ${side}"><div class="agent-identity"><span class="status-led" id="${side}-online"></span><div><span class="small-label">${side==='left'?'01 / VECTOR':'02 / CHAOS'}</span><h3>${side==='left'?'The calculated one.':'The unpredictable one.'}</h3></div></div><div class="decision"><span class="small-label">LATEST INTENT</span><span><b id="${side}-move">STANDBY</b><span class="decision-divider">/</span>Y <b id="${side}-target">280</b><em id="${side}-time">— ms</em></span></div><p class="taunt" id="${side}-taunt">“${PERSONAS[side].motto}”</p><small class="source" id="${side}-source">WAITING FOR AGENT</small></article>`).join('')}</section>
<footer><span>AN EXPERIMENT BY <a href="https://x.com/Infoxicador" target="_blank" rel="noopener">RUBEN CASAS ↗</a></span><span>TYPESAFE AI <b>×</b> JEV <span class="footer-note"> / SAME MINDS. NEW BODIES.</span></span></footer>
</main>`;
const el=(id:string)=>document.getElementById(id)!;
function route(side:Side|'spectator',classic=false){
  let source:string;
  if(hosted){
    source=side==='spectator'?`${location.origin}/?room=${hosted.room}&spectate`:hosted.links?.[side]??(side===requested?location.href:'');
    if(!source)return '';
  }else source=`${location.origin}/?${side==='spectator'?'spectate':`side=${side}`}`;
  const url=new URL(source);url.pathname=classic?'/':'/arena3d.html';return url.href;
}
let arena:Awaited<ReturnType<typeof createArena3D>>|undefined,animation=0,connection:ReturnType<typeof connect>|undefined;
let stopBenchmarkReplay:(()=>void)|undefined;
let replay:GameState[]=[],replayStart=0,lastUI=0;
function setView(next:CameraView){view=next;document.body.dataset.camera=next;for(const button of document.querySelectorAll<HTMLButtonElement>('button[data-camera]'))button.setAttribute('aria-pressed',String(button.dataset.camera===next));el('camera-label').textContent=next==='spectator'?'SIDELINE / BROADCAST CAMERA':`${next==='left'?'VECTOR':'CHAOS'} / ROBOT EYE CAMERA`;el('lens-info').textContent=next==='spectator'?'SIDE COURT / BROADCAST':'EYE LEVEL / FIRST PERSON';}
setView(view);
for(const button of document.querySelectorAll<HTMLButtonElement>('button[data-camera]'))button.onclick=()=>setView(button.dataset.camera as CameraView);
el('fullscreen').onclick=()=>{const stage=document.querySelector('.stage')!;if(document.fullscreenElement)void document.exitFullscreen();else void stage.requestFullscreen().catch(()=>{});};
function dispose(){cancelAnimationFrame(animation);stopBenchmarkReplay?.();connection?.close();arena?.dispose();}
addEventListener('pagehide',dispose,{once:true});
async function startLiveArena(){
  hosted=await prepareRoom();
  if(hosted){const current=new URL(location.href);current.pathname='/arena3d.html';history.replaceState(null,'',current);}
  (el('classic') as HTMLAnchorElement).href=route('spectator',true);
  (document.querySelector('.wordmark') as HTMLAnchorElement).href=route('spectator');
  for(const side of ['left','right'] as const){const link=el(`join-${side}`) as HTMLAnchorElement;const href=route(side);link.hidden=!href;if(href)link.href=href;}
  // Existing socket/agent loop, selecting the server table-tennis ruleset.
  connection=connect(requested,hosted,'table-tennis');connection.onReplay=frames=>{if(frames.length){replay=frames;replayStart=performance.now();}};
  el('replay').onclick=()=>{if(replay.length)replay=[];else connection!.send({type:'replay'});};el('reset').onclick=()=>{replay=[];connection!.send({type:'reset'});};
  arena=await createArena3D(document.querySelector('canvas')!);document.body.dataset.assets='ready';
  const interpolate=createArenaInterpolator();
  function frame(now:number){
    if(!connection||!arena)return;
    const state=connection.state,game=state?interpolate(state,connection.received,now):createGame();let rendered=game;
    if(replay.length){const position=Math.max(0,(now-replayStart)/1000*30*(state?.gameSpeed??1)*.65),index=Math.floor(position);if(index>=replay.length)replay=[];else rendered=interpolateGame(replay[index],replay[Math.min(index+1,replay.length-1)],position-index);}
    arena.render(rendered,view,now);
    if(now-lastUI>90){
      lastUI=now;el('score-left').textContent=String(rendered.score.left);el('score-right').textContent=String(rendered.score.right);el('rally').textContent=String(rendered.rally).padStart(2,'0');el('best').textContent=`BEST ${String(game.bestRally).padStart(2,'0')}`;
      el('match-label').textContent=game.phase==='won'?'MATCH COMPLETE':game.tt?(Math.max(game.score.left,game.score.right)>=10?(game.score.left===game.score.right?'DEUCE · WIN BY 2':'MATCH POINT'):`FIRST TO ${TT_WIN} · WIN BY 2`):`FIRST TO ${WIN_SCORE}`;
      el('network').textContent=`● ${connection.status}`;el('brain-mode').textContent=state?.mode==='mock'?'MOCK BRAINS':state&&Object.values(state.decisions).some(d=>d?.source==='fallback')?'API FALLBACK':state?'LIVE BRAINS':'CONNECTING';
      el('pace').textContent=`${state?.gameSpeed??1}× SHARED PACE`;el('latency').textContent=`${connection.latency} MS`;el('tick').textContent=`TICK ${String(Math.round(game.tick)).padStart(5,'0')}`;el('seat').textContent=(connection.side?`CONTROLLING ${connection.side.toUpperCase()}`:'SPECTATOR')+(game.tt?` / ${game.tt.shot.toUpperCase()}`:'');
      const phase=rendered.phase;el('phase-overlay').hidden=phase==='play'||replay.length>0;el('phase-kicker').textContent=phase==='lobby'?'TWO MINDS. ONE ARENA.':phase==='serve'?'AGENTS READY / NEXT SERVE':phase==='won'?'MATCH COMPLETE':'POINT ON THE BOARD';
      el('phase-title').textContent=phase==='lobby'?'The stage is set.':phase==='serve'?String(Math.max(1,Math.ceil(rendered.countdown))):phase==='won'?`${game.lastScorer==='left'?'Vector':'Chaos'} wins.`:`${game.lastScorer==='left'?'Vector':'Chaos'} scores.`;
      el('phase-detail').textContent=phase==='lobby'?'Connect both player windows. Watch the match from here.':phase==='serve'?'Independent decisions. Shared reality.':phase==='won'?'Rematch starts automatically.':`${game.tt?.reason??'POINT'} · ${rendered.rally} returns.`;el('lobby-actions').hidden=phase!=='lobby';
      for(const side of ['left','right'] as const){
        const d=state?.decisions[side],player=state?.players[side];el(`${side}-online`).classList.toggle('on',!!state?.connected[side]);el(`${side}-engine`).textContent=player?`${player.name.toUpperCase()} / ${player.mock?'MOCK':player.model.toUpperCase()}`:'JEV / SYSTEM ONE';
        if(d){el(`${side}-move`).textContent=d.action.move.toUpperCase();el(`${side}-target`).textContent=String(Math.round(d.action.target_y));el(`${side}-time`).textContent=`${d.responseMs} ms`;el(`${side}-source`).textContent=d.source==='mock'?'MOCK / HEURISTIC':d.source==='fallback'?d.warning??'API FALLBACK':`${d.source.toUpperCase()} / LIVE DECISION`;el(`${side}-taunt`).textContent=`“${d.action.taunt}”`;}
      }
      const replayButton=el('replay') as HTMLButtonElement;replayButton.disabled=game.pointId===0;replayButton.textContent=replay.length?'↺ Back to live':'↺ Replay point';(el('reset') as HTMLButtonElement).disabled=!connection.canReset;
      document.body.dataset.phase=game.phase;document.body.dataset.role=connection.side??'spectator';document.body.dataset.mode=state?.mode??'connecting';document.body.dataset.replay=String(replay.length>0);
    }
    animation=requestAnimationFrame(frame);
  }
  animation=requestAnimationFrame(frame);
}
try{
  if(benchmarkMode){
    const {startBenchmarkReplay}=await import('./benchmark-replay');
    arena=await createArena3D(document.querySelector('canvas')!);
    document.body.dataset.assets='ready';
    stopBenchmarkReplay=startBenchmarkReplay(arena,()=>view);
  }else await startLiveArena();
}catch(error){el('phase-kicker').textContent='ARENA UNAVAILABLE';el('phase-title').textContent='Unable to open the arena.';el('phase-detail').textContent=error instanceof Error?error.message:'Please use a browser with WebGL 2 support.';el('lobby-actions').hidden=true;connection?.close();document.body.dataset.error='true';}
