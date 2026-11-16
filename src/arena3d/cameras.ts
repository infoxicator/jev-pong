import { H,W,INSET,PADDLE_W,type GameState,type Side } from '../physics';
export type CameraView=Side|'spectator';
export const SCALE=.0065,HALF_LENGTH=W*SCALE/2,HALF_WIDTH=H*SCALE/2,EYE_HEIGHT=1.805;
export const lane=(y:number)=>(y-H/2)*SCALE;
export const strikeX=(side:Side)=>(side==='left'?INSET+PADDLE_W:W-INSET-PADDLE_W)*SCALE-HALF_LENGTH;
export const robotX=(side:Side)=>strikeX(side)+(side==='left'?-.71:.71);
export function ballPosition(game:GameState):[number,number,number]{
  const x=game.ball.x*SCALE-HALF_LENGTH,u=Math.min(1,Math.abs(x)/HALF_LENGTH);
  // A visual table bounce; authoritative collisions and scores stay entirely server-side.
  const height=u<.48?1.23-(u/.48)*.37:.86+((u-.48)/.52)*.26;
  return [x,height,lane(game.ball.y)];
}
export function cameraPose(view:CameraView,game:GameState,aspect=1.6){
  if(view==='spectator'){const distance=Math.max(5.5,Math.min(18,10.7/(2*Math.tan(19*Math.PI/180)*aspect)));return {position:[.5,.9+distance*.37,distance*.93] as [number,number,number],target:[0,.9,0] as [number,number,number],fov:38};}
  const direction=view==='left'?1:-1,z=lane(game.paddles[view])+direction*.40;
  return {position:[robotX(view)+direction*.025,EYE_HEIGHT,z] as [number,number,number],target:[-direction*1.2,1.08,z*.25] as [number,number,number],fov:72};
}
