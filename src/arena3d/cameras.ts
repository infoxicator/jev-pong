import { TT_TOP,TT_SCALE,ttPlane } from '../table-tennis';
import { H,W,INSET,PADDLE_W,R,type GameState,type Side } from '../physics';
export type CameraView=Side|'spectator';
// A 2.74 m table, with the exact same authoritative Pong coordinates.
export const SCALE=TT_SCALE,HALF_LENGTH=W*SCALE/2,HALF_WIDTH=H*SCALE/2,EYE_HEIGHT=1.78;
export const TABLE_TOP=TT_TOP,BALL_RADIUS=R*SCALE,CONTACT_HEIGHT=1.19,BODY_OFFSET=.30;
export const lane=(y:number)=>(y-H/2)*SCALE;
export const strikeX=(side:Side,tableTennis=false)=>tableTennis?(ttPlane(side)+(side==='left'?-R:R))*SCALE-HALF_LENGTH:(side==='left'?INSET+PADDLE_W:W-INSET-PADDLE_W)*SCALE-HALF_LENGTH;
export const robotX=(side:Side,tableTennis=false)=>strikeX(side,tableTennis)+(side==='left'?-.568:.568);
export const ballContactX=(side:Side)=>strikeX(side)+(side==='left'?BALL_RADIUS:-BALL_RADIUS);
export function ballPosition(game:GameState):[number,number,number]{
  const x=game.ball.x*SCALE-HALF_LENGTH,extent=ballContactX('right');
  if(game.tt)return [x,game.tt.height,lane(game.ball.y)];
  const progress=Math.max(0,Math.min(1,(game.ball.vx>=0?x+extent:extent-x)/(extent*2)));
  // One receiver-side bounce per crossing. Parabolic flight, continuous at both
  // racket planes, with a deliberate velocity change only at the table bounce.
  const bounce=.65,floor=TABLE_TOP+BALL_RADIUS,arc=.29;
  const reboundArc=arc*((1-bounce)/bounce)**2; // Same vertical acceleration on both flight segments.
  const u=progress<bounce?progress/bounce:(progress-bounce)/(1-bounce);
  const height=progress<bounce
    ? CONTACT_HEIGHT*(1-u)+floor*u+4*arc*u*(1-u)
    : floor*(1-u)+CONTACT_HEIGHT*u+4*reboundArc*u*(1-u);
  return [x,height,lane(game.ball.y)];
}
export function cameraPose(view:CameraView,game:GameState,aspect=1.6){
  if(view==='spectator'){
    const distance=Math.max(4.4,Math.min(14,6.3/(2*Math.tan(19*Math.PI/180)*aspect)));
    return {position:[distance*.43,1.25+distance*.25,distance*.90] as [number,number,number],target:[0,1.0,0] as [number,number,number],fov:38};
  }
  const direction=view==='left'?1:-1,z=lane(game.paddles[view])+direction*BODY_OFFSET;
  return {position:[robotX(view,!!game.tt)+direction*.10,EYE_HEIGHT,z] as [number,number,number],target:[-direction*.5,1.05,z*.20] as [number,number,number],fov:78};
}
