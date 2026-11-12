import './style.css';
import { createGame, type Side } from './physics';
import { createRenderer } from './canvas';
import { connect, createInterpolator } from './network';
import { PERSONAS } from './agents';
const params=new URLSearchParams(location.search),requested=params.get('side');
const side:Side|null=!params.has('spectate')&&(requested==='left'||requested==='right')?requested:null;
document.querySelector('#app')!.innerHTML=`<main><header><span class="brand">↗ AGENT ARENA</span><span class="live" id="connection">CONNECTING</span></header><h1>Jev <em>vs</em> Jev<span>PONG</span></h1><p class="subtitle">Two minds. One ball. Zero human input.</p><nav><a href="/?side=left">Player Left</a><a href="/?spectate">Spectator</a><a href="/?side=right">Player Right</a></nav><section class="arena"><div class="scoreboard"><span class="lime">JEV // VECTOR <small id="left-online">OFFLINE</small></span><strong><span id="score-left">0</span> : <span id="score-right">0</span></strong><span class="purple">JEV // CHAOS <small id="right-online">OFFLINE</small></span></div><div class="court"><canvas aria-label="Live Pong arena"></canvas><div class="overlay" id="overlay">WAITING FOR PLAYERS</div></div><div class="arena-bottom"><span id="telemetry">120 Hz PHYSICS</span><span id="rally">RALLY 00</span><span id="view">SPECTATOR</span></div></section><section class="thoughts">${(['left','right'] as const).map(s=>`<article class="thought ${s}"><h2>${PERSONAS[s].name} <small id="${s}-brain">STANDBY</small></h2><p id="${s}-thought">Waiting for a decision…</p><q id="${s}-taunt">${PERSONAS[s].motto}</q></article>`).join('')}</section><footer>BUILT BY RUBEN CASAS <b>@Infoxicador</b><span>POWERED BY TYPESAFE AI / SYSTEM ONE</span></footer></main>`;
const connection=connect(side),interpolate=createInterpolator(),draw=createRenderer(document.querySelector('canvas')!);
const el=(id:string)=>document.getElementById(id)!;
let lastUI=0;
function frame(now:number){
  const state=connection.state,game=state?interpolate(state,connection.received,now):createGame();draw(game);
  if(now-lastUI>100){lastUI=now;el('connection').textContent=connection.status;el('score-left').textContent=String(game.score.left);el('score-right').textContent=String(game.score.right);
    el('rally').textContent=`RALLY ${String(game.rally).padStart(2,'0')}`;el('view').textContent=connection.side?`PLAYER ${connection.side.toUpperCase()}`:'SPECTATOR';
    el('telemetry').textContent=`${connection.latency} ms RTT / 120 Hz / TICK ${game.tick}`;
    el('overlay').textContent=game.phase==='lobby'?'WAITING FOR PLAYERS':game.phase==='serve'?`SERVE IN ${Math.max(1,Math.ceil(game.countdown))}`:game.phase==='point'?`POINT ${game.lastScorer?.toUpperCase()}`:game.phase==='won'?`${game.lastScorer?.toUpperCase()} WINS`:'';
    el('overlay').hidden=game.phase==='play';
    for(const s of ['left','right'] as const){el(`${s}-online`).textContent=state?.connected[s]?'ONLINE':'OFFLINE';const d=state?.decisions[s];if(d){el(`${s}-brain`).textContent=`${d.source.toUpperCase()} / ${d.responseMs} ms`;el(`${s}-thought`).textContent=`${d.action.move.toUpperCase()} → y ${Math.round(d.action.target_y)} / ${Math.round(d.action.confidence*100)}%`;el(`${s}-taunt`).textContent=d.action.taunt;}}
    document.body.dataset.phase=game.phase;document.body.dataset.mode=state?.mode??'connecting';document.body.dataset.role=connection.side??'spectator';document.body.dataset.connection=connection.status;
  }requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
