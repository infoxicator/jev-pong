import './style.css';
import { createGame, startServe, step, DT, H, setIntent } from './physics';
import { createRenderer } from './canvas';
document.querySelector('#app')!.innerHTML = `<main><header><span class="brand">↗ AGENT ARENA</span><span class="live">● LOCAL SIMULATION</span></header><h1>Jev <em>vs</em> Jev<span>PONG</span></h1><p class="subtitle">Two minds. One ball. Zero human input.</p><section class="arena"><div class="scoreboard"><span class="lime">JEV // VECTOR</span><strong id="score">0 : 0</strong><span class="purple">JEV // CHAOS</span></div><canvas aria-label="Live Pong arena"></canvas><div class="arena-bottom"><span>FIXED PHYSICS / 120 Hz</span><span id="rally">RALLY 00</span></div></section><footer>BUILT BY RUBEN CASAS <b>@Infoxicador</b><span>POWERED BY TYPESAFE AI</span></footer></main>`;
const s=createGame();startServe(s);const draw=createRenderer(document.querySelector('canvas')!);
let previous=performance.now(), accumulator=0;
function frame(now:number) {
  accumulator+=Math.min((now-previous)/1000,0.1);previous=now;
  while(accumulator>=DT) { setIntent(s,'left',s.ball.y+Math.sin(s.tick/150)*60);setIntent(s,'right',s.ball.y+Math.cos(s.tick/170)*70);step(s);accumulator-=DT; }
  draw(s);document.querySelector('#score')!.textContent=`${s.score.left} : ${s.score.right}`;document.querySelector('#rally')!.textContent=`RALLY ${String(s.rally).padStart(2,'0')}`;requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
void H;
