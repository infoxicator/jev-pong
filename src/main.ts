import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/space-mono/latin-400.css';
import './style.css';
import { createGame, WIN_SCORE, type GameState, type Side } from './physics';
import { createRenderer } from './canvas';
import { connect, createInterpolator } from './network';
import { PERSONAS } from './agents';
const params=new URLSearchParams(location.search),requested=params.get('side');
const side:Side|null=!params.has('spectate')&&(requested==='left'||requested==='right')?requested:null;
const glyph=(s:Side)=>s==='left'?'<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 46 32 12 52 46H12Zm10-9h20M32 12v34"/></svg>':'<svg viewBox="0 0 64 64" aria-hidden="true"><path d="m32 8 6 16 17-5-10 14 10 14-17-5-6 15-6-15-17 5 10-14L9 19l17 5Z"/></svg>';
document.querySelector('#app')!.innerHTML=`
<main>
  <header><a class="brand" href="/?spectate"><span class="brand-icon">↗</span> AGENT ARENA <span class="edition">/ EXPERIMENT 001</span></a><div class="header-status"><span id="mode" class="mode">CONNECTING</span><span id="connection" class="live">● CONNECTING</span></div></header>
  <section class="hero"><div><div class="eyebrow">A SYSTEM ONE SHOWDOWN</div><h1>Jev <em>vs</em> Jev<span class="pong-tag">PONG</span><span class="title-dot">.</span></h1><p class="subtitle">Two minds. One ball. <b>Zero human input.</b></p></div><div class="hero-note"><span class="tiny-line"></span><span>Same model. Different energy.<br/>Let the best agent win.</span></div></section>
  <section class="stage">
    <div class="arena">
      <div class="scoreboard"><div class="player-heading left">${glyph('left')}<div><span class="micro">PLAYER 01</span><strong>VECTOR</strong><span class="online" id="left-online">OFFLINE</span></div></div><div class="score-wrap"><div class="score"><span id="score-left">0</span><span class="score-divider">:</span><span id="score-right">0</span></div><span id="match-label">FIRST TO ${WIN_SCORE}</span></div><div class="player-heading right"><div><span class="micro">PLAYER 02</span><strong>CHAOS</strong><span class="online" id="right-online">OFFLINE</span></div>${glyph('right')}</div></div>
      <div class="court"><div class="court-top"><span id="court-label">● LIVE MATCH</span><span id="view">SPECTATOR</span></div><canvas aria-label="Live Pong arena: Vector versus Chaos"></canvas><div class="overlay" id="overlay"><span id="overlay-kicker">THE ARENA IS READY</span><strong id="overlay-title">Waiting for players</strong><span id="overlay-detail">Open a left and right player window to begin.</span><div id="lobby-links"><a href="/?side=left" target="_blank" rel="noopener">↗ Connect Vector</a><a href="/?side=right" target="_blank" rel="noopener">↗ Connect Chaos</a></div></div><div class="rally-pill" id="rally-pill"><span>RALLY</span><strong id="rally">00</strong></div></div>
      <div class="arena-bottom"><span class="telemetry"><i></i> <span id="latency">— ms</span><span class="slash">/</span><span>120 Hz</span><span class="slash">/</span><span id="tick">TICK 00000</span></span><span class="best">BEST RALLY <b id="best">00</b></span></div>
    </div>
    <aside class="decision-feed"><div class="feed-heading"><span>THE DECISION FEED</span><span class="feed-indicator">↙</span></div>${(['left','right'] as const).map(s=>`<article class="thought ${s}"><div class="thought-top"><span class="agent-avatar">${glyph(s)}</span><div><h2>Jev <span>// ${PERSONAS[s].name}</span></h2><p>${PERSONAS[s].subtitle}</p></div><span class="brain-dot" id="${s}-dot"></span></div><div class="taunt-wrap"><span class="quote-mark">“</span><p class="taunt" id="${s}-taunt">${PERSONAS[s].motto}</p></div><div class="decision-caption"><span>LATEST DECISION</span><span id="${s}-time">— ms</span></div><div class="decision-code"><span class="code-bracket">{</span><div><span class="code-key">move:</span> <strong id="${s}-move">"stay"</strong>,</div><div><span class="code-key">target_y:</span> <span id="${s}-target">280</span></div><span class="code-bracket">}</span></div><div class="confidence"><span id="${s}-brain">STANDBY</span><span id="${s}-confidence">—</span></div><div class="confidence-track"><span id="${s}-bar"></span></div><p class="fallback-note" id="${s}-warning" hidden>Provider unavailable · heuristic fallback</p></article>`).join('')}<div class="feed-footnote">Independent decisions every ~200 ms.<br/>One shared, authoritative arena.</div></aside>
  </section>
  <div class="controls"><nav aria-label="Choose a view"><span class="control-caption">YOUR SEAT</span><a href="/?side=left" data-seat="left">01 / Vector</a><a href="/?spectate" data-seat="spectator">◎ Spectator</a><a href="/?side=right" data-seat="right">02 / Chaos</a></nav><div class="actions"><button id="replay" disabled>↺ <span>Replay last point</span></button><button id="title-card">↗ <span>Title card</span></button><button id="reset" title="Reset score and serve a new match">⟳ <span>New match</span></button></div></div>
  <footer><span>A LITTLE EXPERIMENT BY <a href="https://x.com/Infoxicador" target="_blank" rel="noopener">RUBEN CASAS <b>@Infoxicador</b> ↗</a></span><span>POWERED BY <strong>TypeSafe AI</strong><span class="footer-cross">×</span>JEV / SYSTEM ONE</span></footer>
</main>
<dialog id="intro"><div class="intro-grid"></div><span class="eyebrow">RUBEN CASAS PRESENTS / AGENT ARENA 001</span><div class="intro-title">Jev <em>vs</em> Jev<span>PONG<span class="lime">.</span></span></div><p>Two agents. One very personal rivalry.</p><div class="intro-versus"><span class="lime">VECTOR<br/><small>THE CALCULATED ONE</small></span><em>VS</em><span class="purple">CHAOS<br/><small>THE UNPREDICTABLE ONE</small></span></div><button id="enter">Start fresh match ↗</button><span class="intro-credit">@Infoxicador · TYPESAFE AI / SYSTEM ONE</span></dialog>`;
const connection=connect(side),interpolate=createInterpolator(),draw=createRenderer(document.querySelector('canvas')!);
const el=(id:string)=>document.getElementById(id)!;
const intro=el('intro') as HTMLDialogElement;
el('title-card').onclick=()=>intro.showModal();
el('enter').onclick=()=>{connection.send({type:'reset'});intro.close();};
el('reset').onclick=()=>{replayFrames=[];connection.send({type:'reset'});};
el('replay').onclick=()=>{if(replayFrames.length){replayFrames=[];return;}connection.send({type:'replay'});};
if(params.has('intro'))intro.showModal();
let replayFrames:GameState[]=[],replayStart=0,lastUI=0,pointSeen=0;
const tauntTime={left:0,right:0};
connection.onReplay=frames=>{if(frames.length){replayFrames=frames;replayStart=performance.now();}};
function frame(now:number){
  const state=connection.state,liveGame=state?interpolate(state,connection.received,now):createGame();
  let game=liveGame;
  if(replayFrames.length){const index=Math.floor((now-replayStart)/1000*30*0.65);if(index>=replayFrames.length)replayFrames=[];else game=replayFrames[index];}
  const replaying=replayFrames.length>0;draw(game,replaying);
  if(now-lastUI>80){
    lastUI=now;el('connection').textContent=`● ${connection.status}`;el('connection').classList.toggle('disconnected',connection.status!=='CONNECTED');
    const mode=state?.mode??'connecting';el('mode').textContent=mode==='mock'?'MOCK BRAINS':`${mode.toUpperCase()} / LIVE JEV`;
    el('score-left').textContent=String(game.score.left);el('score-right').textContent=String(game.score.right);
    el('rally').textContent=String(game.rally).padStart(2,'0');el('best').textContent=String(liveGame.bestRally).padStart(2,'0');
    el('rally-pill').classList.toggle('hot',game.rally>=8);
    el('view').textContent=connection.side?`CONTROLLING ${PERSONAS[connection.side].name}`:'SPECTATOR VIEW';
    el('latency').textContent=`${connection.latency} ms`;el('tick').textContent=`TICK ${String(liveGame.tick).padStart(5,'0')}`;
    el('court-label').textContent=replaying?'↺ INSTANT REPLAY / 0.65×':'● LIVE MATCH';
    el('match-label').textContent=liveGame.phase==='won'?'MATCH COMPLETE':Math.max(liveGame.score.left,liveGame.score.right)===WIN_SCORE-1?'MATCH POINT':`FIRST TO ${WIN_SCORE}`;
    el('match-label').classList.toggle('drama',Math.max(liveGame.score.left,liveGame.score.right)===WIN_SCORE-1);
    const phase=game.phase,scorer=game.lastScorer?PERSONAS[game.lastScorer].name:'';
    el('overlay').hidden=phase==='play'||replaying;
    el('overlay-kicker').textContent=phase==='lobby'?'THE ARENA IS READY':phase==='serve'?'NEXT UP / SERVE':phase==='won'?'THERE CAN ONLY BE ONE JEV':'POINT ON THE BOARD';
    el('overlay-title').textContent=phase==='lobby'?'Waiting for players':phase==='serve'?String(Math.max(1,Math.ceil(game.countdown))):phase==='won'?`${scorer} wins.`:`${scorer} scores.`;
    el('overlay-detail').textContent=phase==='lobby'?'Open a left and right player window to begin.':phase==='serve'?'Agents locked in. Eyes on the ball.':phase==='won'?'Rematch starts automatically. Same rivalry.':`${game.rally} returns. ${game.score.left} — ${game.score.right}. Next serve incoming.`;
    el('lobby-links').hidden=phase!=='lobby';
    const replayButton=el('replay') as HTMLButtonElement;replayButton.disabled=liveGame.pointId===0;replayButton.querySelector('span')!.textContent=replaying?'Back to live':'Replay last point';
    for(const s of ['left','right'] as const){
      const online=state?.connected[s]??false;el(`${s}-online`).textContent=online?'ONLINE':'OFFLINE';el(`${s}-online`).classList.toggle('is-online',online);
      el(`${s}-dot`).classList.toggle('on',online);
      const d=state?.decisions[s];if(d){
        el(`${s}-brain`).textContent=d.source==='jev'?'JEV / SYSTEM ONE':d.source==='mock'?'MOCK / HEURISTIC':'FALLBACK / HEURISTIC';
        el(`${s}-time`).textContent=`${d.responseMs} ms`;el(`${s}-move`).textContent=`"${d.action.move}"`;
        el(`${s}-target`).textContent=String(Math.round(d.action.target_y));
        const confidence=Math.round(d.action.confidence*100);el(`${s}-confidence`).textContent=`${confidence}% CONF.`;el(`${s}-bar`).style.width=`${confidence}%`;
        el(`${s}-warning`).hidden=d.source!=='fallback';
        if(now-tauntTime[s]>3200||liveGame.pointId!==pointSeen){el(`${s}-taunt`).textContent=d.action.taunt;tauntTime[s]=now;}
      }else{el(`${s}-brain`).textContent='STANDBY';el(`${s}-time`).textContent='— ms';el(`${s}-move`).textContent='"stay"';el(`${s}-target`).textContent='280';el(`${s}-confidence`).textContent='—';el(`${s}-bar`).style.width='0%';el(`${s}-warning`).hidden=true;}
    }
    pointSeen=liveGame.pointId;
    for(const a of document.querySelectorAll<HTMLAnchorElement>('[data-seat]'))a.setAttribute('aria-current',a.dataset.seat===(connection.side??'spectator')?'page':'false');
    document.body.dataset.phase=liveGame.phase;document.body.dataset.mode=mode;document.body.dataset.role=connection.side??'spectator';document.body.dataset.connection=connection.status;document.body.dataset.replay=String(replaying);
  }requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
