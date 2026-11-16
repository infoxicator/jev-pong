import { H,INSET,PADDLE_W,R,W,type GameState } from '../physics';
import type { ArenaState } from '../protocol';
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
/** Interpolate through a collision plane rather than cutting across its corner. */
function reflected(a:number,b:number,plane:number,t:number){
  const before=Math.abs(plane-a),after=Math.abs(b-plane),fraction=before/Math.max(1e-9,before+after);
  return {value:t<fraction?mix(a,plane,t/Math.max(fraction,1e-9)):mix(plane,b,(t-fraction)/Math.max(1-fraction,1e-9)),after:t>=fraction};
}
export function interpolateGame(a:GameState,b:GameState,t:number):GameState{
  if(a.phase!==b.phase||a.pointId!==b.pointId)return t<1?a:b;
  const hit=b.rally>a.rally&&a.ball.vx*b.ball.vx<0;
  const x=hit?reflected(a.ball.x,b.ball.x,a.ball.vx<0?INSET+PADDLE_W+R:W-INSET-PADDLE_W-R,t):{value:mix(a.ball.x,b.ball.x,t),after:t>=1};
  const wall=!hit&&a.ball.vy*b.ball.vy<0;
  const y=wall?reflected(a.ball.y,b.ball.y,a.ball.vy<0?R:H-R,t):{value:mix(a.ball.y,b.ball.y,t),after:t>=1};
  const discrete=hit?x.after?b:a:wall?y.after?b:a:a;
  return {...discrete,tick:mix(a.tick,b.tick,t),countdown:mix(a.countdown,b.countdown,t),
    ball:{...discrete.ball,x:x.value,y:y.value},paddles:{left:mix(a.paddles.left,b.paddles.left,t),right:mix(a.paddles.right,b.paddles.right,t)}};
}
export function createArenaInterpolator(){
  const frames:{time:number;game:GameState}[]=[];let last:GameState|null=null;
  return (state:ArenaState,received:number,now:number)=>{
    if(state.game!==last){if(last&&state.game.tick<last.tick)frames.length=0;frames.push({time:received,game:state.game});last=state.game;if(frames.length>12)frames.shift();}
    const target=now-80;
    while(frames.length>2&&frames[1].time<target)frames.shift();
    const [a,b]=frames;if(!b)return a.game;
    return interpolateGame(a.game,b.game,Math.max(0,Math.min(1,(target-a.time)/Math.max(1,b.time-a.time))));
  };
}
