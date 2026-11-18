import type { GameState,Side } from './physics';
import { hardServe, type HardMatch } from './hard-match';
export const TT_SCALE=.00274,TT_TOP=.76,TT_RADIUS=.01918,TT_NET=.1525,TT_GRAVITY=9.81;
export const TT_REACH=38,TT_WIN=11,TT_STEP=1/120;
export const TT_PADDLE_SPEED=780,TT_PADDLE_ACCELERATION=3200;
export type TacticalShot='safe'|'deep'|'drop'|'line';
export type StrokeKind='serve'|'drive'|'topspin'|'push'|'smash'|'lob'|'drop';
export interface Stroke {tick:number;x:number;y:number;height:number;kind:StrokeKind;hand:'forehand'|'backhand'|'serve';tactic?:TacticalShot}
export interface TableTennis {
  height:number;vz:number;spin:number;curve:number;server:Side;lastHitter:Side;
  serving:boolean;ownBounce:boolean;bounces:number;netTouched:boolean;bounceId:number;
  shot:StrokeKind;reason:string;velocity:Record<Side,number>;strokes:Record<Side,Stroke|null>;
  hard?: HardMatch;
  tactical?: {
    live?: true;
    plans: Partial<Record<Side,TacticalShot>>;
    landing: {x:number;y:number;strokeTick:number;side?:Side}|null;
  };
}
const other=(side:Side):Side=>side==='left'?'right':'left';
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export const ttPlane=(side:Side)=>side==='left'?-35:1035;
export function newTableTennis(hard?:HardMatch):TableTennis{return {height:1.12,vz:0,spin:0,curve:0,server:'left',lastHitter:'left',serving:true,ownBounce:false,bounces:0,netTouched:false,bounceId:0,shot:'serve',reason:'',velocity:{left:0,right:0},strokes:{left:null,right:null},...(hard?{hard}:{})};}
export function ttServer(score:GameState['score']):Side{const total=score.left+score.right;return (total>=20?total%2:Math.floor(total/2)%2)===0?'left':'right';}
export function tableTennisWon(s:GameState){return Math.max(s.score.left,s.score.right)>=TT_WIN&&Math.abs(s.score.left-s.score.right)>=2;}
export function startTableTennis(s:GameState){
  const t=s.tt!,server=ttServer(s.score);
  const swapService=t.hard?.opponent==='models'?t.hard.seed%2===1:t.hard?.modelSide==='right';
  t.server=swapService?other(server):server;t.lastHitter=t.server;t.serving=true;t.ownBounce=false;t.bounces=0;t.netTouched=false;t.height=1.12;t.vz=0;t.spin=0;t.curve=0;t.shot='serve';
  if(t.tactical){t.tactical.plans={};t.tactical.landing=null;}
  if(t.hard){
    const setup=hardServe(t.hard,s.score,s.pointId);
    s.targets[t.server]=setup.serverY;s.targets[other(t.server)]=setup.receiverY;
  }
  s.phase='serve';s.countdown=1.5;s.rally=0;s.ball={x:ttPlane(t.server),y:s.paddles[t.server],vx:0,vy:0};
}
function point(s:GameState,winner:Side,reason:string){
  s.score[winner]++;s.pointId++;s.lastScorer=winner;s.bestRally=Math.max(s.bestRally,s.rally);s.tt!.reason=reason;
  s.phase=tableTennisWon(s)?'won':'point';s.countdown=s.phase==='won'?7:1.6;
}
function rememberStroke(s:GameState,side:Side,kind:StrokeKind,tactic?:TacticalShot){
  s.tt!.strokes[side]={tick:s.tick,x:s.ball.x,y:s.ball.y,height:s.tt!.height,kind,hand:kind==='serve'?'serve':(s.ball.y-s.paddles[side])*(side==='left'?1:-1)>0?'backhand':'forehand',...(tactic?{tactic}:{})};
}
function serve(s:GameState){
  const t=s.tt!,side=t.server,sign=side==='left'?1:-1;
  const setup=t.hard?hardServe(t.hard,s.score,s.pointId):undefined,speed=setup?.speed??3.3;
  t.height=1.12;const landing=side==='left'?200:800,time=Math.abs(landing-s.ball.x)*TT_SCALE/speed;
  t.vz=(TT_TOP+TT_RADIUS-t.height+.5*TT_GRAVITY*time*time)/time;
  s.ball.vx=sign*speed/TT_SCALE;
  const aim=setup?.aim??280+Math.sin((s.pointId+1)*2.4)*135;
  s.ball.vy=(aim-s.ball.y)/(.72);t.curve=0;t.spin=0;
  rememberStroke(s,side,'serve');s.phase='play';
}
/** Deterministic racket controller: placement comes from the opponent's position;
 * reach/timing comes from agent positioning. It cannot rescue an unreachable ball. */
export function returnShot(s:GameState,side:Side){
  const t=s.tt!,sign=side==='left'?1:-1,offset=(s.ball.y-s.paddles[side])/TT_REACH;
  const plan=t.tactical?.plans[side];
  if(plan&&t.tactical){
    delete t.tactical.plans[side];
    playTacticalShot(s,side,plan);
    return;
  }
  const seed=Math.sin((s.pointId+1)*17.3+(s.rally+1)*7.1+(side==='left'?0:2));
  const kind:StrokeKind=t.height>1.16&&s.rally>1?'smash':Math.abs(offset)>.65?'lob':s.rally%3===2?'push':s.rally%3===1?'topspin':'drive';
  const speed=kind==='smash'?6.8:kind==='lob'?3.0:kind==='push'?3.7:Math.min(6.4,4.25+s.rally*.18+(kind==='topspin'?.35:0));
  const depth=kind==='lob'?680:kind==='push'?730:795;
  const landing=side==='left'?depth+seed*50:1000-depth-seed*50;
  const duration=Math.abs(landing-s.ball.x)*TT_SCALE/speed;
  const corner=s.paddles[other(side)]<280?425:135;
  // Down-the-line changes and deep cross-court returns force recovery between shots.
  const aim=(s.rally%4===2?560-s.ball.y:corner)+seed*22+offset*38;
  t.spin=kind==='topspin'?1.6:kind==='push'?-.5:kind==='smash'?1:.4;
  t.curve=kind==='topspin'?sign*.45:kind==='push'?-sign*.20:0;
  t.vz=(TT_TOP+TT_RADIUS-t.height+.5*(TT_GRAVITY+t.spin)*duration*duration)/duration;
  // Late contact has a real cost: less net clearance and more placement error.
  t.vz-=Math.max(0,Math.abs(offset)-.68)*.7;
  s.ball.vx=sign*speed/TT_SCALE;s.ball.vy=(aim-s.ball.y)/duration-.5*t.curve/TT_SCALE*duration;
  t.lastHitter=side;t.bounces=0;t.serving=false;t.ownBounce=false;t.netTouched=false;t.shot=kind;
  rememberStroke(s,side,kind);s.rally++;s.bestRally=Math.max(s.bestRally,s.rally);
}
function tacticalPlacement(s:GameState,side:Side,shot:TacticalShot){
  const lowerLane=s.ball.y<280;
  const tempo=s.tt!.tactical?.live?Math.min(9,s.rally):0;
  const safeWidth=s.tt!.tactical?.live?Math.min(216,Math.max(0,s.rally-4)*20):0;
  const depth={safe:775,deep:905,drop:635,line:825}[shot];
  const direction=lowerLane?1:-1;
  const width={
    safe:280+direction*safeWidth,
    deep:280+direction*(118+tempo*12),
    drop:lowerLane?85:475,
    line:280-direction*(104+tempo*9),
  }[shot];
  return {x:side==='left'?depth:1000-depth,y:width};
}
function playTacticalShot(s:GameState,side:Side,shot:TacticalShot){
  const t=s.tt!,b=s.ball,sign=side==='left'?1:-1;
  const tempo=t.tactical?.live?Math.min(9,s.rally):0;
  const speed={safe:4.05+tempo*.15,deep:5.05+tempo*.16,drop:2.95,line:4.65+tempo*.13}[shot];
  const landing=tacticalPlacement(s,side,shot);
  const duration=Math.abs(landing.x-b.x)*TT_SCALE/speed;
  t.spin={safe:.35,deep:1.2,drop:-.65,line:.8}[shot];t.curve=0;
  t.vz=(TT_TOP+TT_RADIUS-t.height+.5*(TT_GRAVITY+t.spin)*duration**2)/duration;
  b.vx=sign*speed/TT_SCALE;b.vy=(landing.y-b.y)/duration;
  t.lastHitter=side;t.bounces=0;t.serving=false;t.ownBounce=false;t.netTouched=false;
  const kinds:Record<TacticalShot,StrokeKind>={safe:'drive',deep:'topspin',drop:'drop',line:'drive'};
  t.shot=kinds[shot];
  rememberStroke(s,side,t.shot,shot);s.rally++;s.bestRally=Math.max(s.bestRally,s.rally);
}
function advance(ball:GameState['ball'],t:TableTennis,dt:number){
  ball.x+=ball.vx*dt;ball.y+=ball.vy*dt+.5*t.curve/TT_SCALE*dt*dt;ball.vy+=t.curve/TT_SCALE*dt;
  const gravity=TT_GRAVITY+t.spin;t.height+=t.vz*dt-.5*gravity*dt*dt;t.vz-=gravity*dt;
}
function bounce(ball:GameState['ball'],t:TableTennis){
  t.height=2*(TT_TOP+TT_RADIUS)-t.height;t.vz=Math.abs(t.vz)*.88;
  ball.vx*=1+t.spin*.012;ball.vy*=.99;t.bounceId++;
}
/** Prediction uses the same open court and bounce law as the authoritative ball. */
export function projectTableTennis(ball:GameState['ball'],tt:TableTennis,side:Side){
  const b={...ball},t={...tt},plane=ttPlane(side),toward=side==='left'?b.vx<0:b.vx>0;
  if(!toward)return {y:280+(b.y-280)*.12,height:1.0,time:Infinity};
  let time=0;
  while(time<1.6){
    const dt=Math.min(TT_STEP,Math.max(0,(plane-b.x)/b.vx));
    if(dt<1e-6)break;
    const old=t.height;advance(b,t,dt);time+=dt;
    if(old>=TT_TOP+TT_RADIUS&&t.height<TT_TOP+TT_RADIUS&&b.x>=0&&b.x<=1000&&b.y>=0&&b.y<=560)bounce(b,t);
    if((side==='left'?b.x<=plane:b.x>=plane))break;
  }
  return {y:b.y,height:t.height,time};
}
export function stepTableTennis(s:GameState){
  const t=s.tt!;s.tick++;if(s.phase==='lobby')return;
  for(const side of ['left','right'] as const){
    const diff=s.targets[side]-s.paddles[side],desired=clamp(diff*14,-TT_PADDLE_SPEED,TT_PADDLE_SPEED);
    t.velocity[side]+=clamp(desired-t.velocity[side],-TT_PADDLE_ACCELERATION*TT_STEP,TT_PADDLE_ACCELERATION*TT_STEP);
    const movement=t.velocity[side]*TT_STEP;
    if(Math.abs(movement)>Math.abs(diff)&&Math.sign(movement)===Math.sign(diff)){s.paddles[side]=s.targets[side];t.velocity[side]=0;}else s.paddles[side]=clamp(s.paddles[side]+movement,-60,620);
  }
  if(s.phase!=='play'){
    s.countdown-=TT_STEP;
    if(s.phase==='serve'){
      s.ball.x=ttPlane(t.server);s.ball.y=s.paddles[t.server];
      const toss=clamp(.45-s.countdown,0,.45);t.height=1.12+2.2*toss-.5*TT_GRAVITY*toss*toss;
    }else if(s.phase==='point'||s.phase==='won'){
      // Let a missed ball fall out of court instead of freezing in midair.
      if(t.height>TT_RADIUS+.016){const old=t.height;advance(s.ball,t,TT_STEP);if(old>=TT_TOP+TT_RADIUS&&t.height<TT_TOP+TT_RADIUS&&s.ball.x>=0&&s.ball.x<=1000&&s.ball.y>=0&&s.ball.y<=560)bounce(s.ball,t);t.height=Math.max(TT_RADIUS+.016,t.height);}else{s.ball.vx*=.94;s.ball.vy*=.94;}
    }
    if(s.countdown<=0){if(s.phase==='serve')serve(s);else{if(s.phase==='won')s.score={left:0,right:0};startTableTennis(s);}}
    return;
  }
  // Substeps prevent a fast smash tunnelling through the table or net.
  for(let sub=0;sub<2&&s.phase==='play';sub++){
    const old={x:s.ball.x,y:s.ball.y,height:t.height};advance(s.ball,t,TT_STEP/2);
    const b=s.ball,receiver=other(t.lastHitter);
    if(((old.x<500&&b.x>=500)||(old.x>500&&b.x<=500))&&Math.abs(b.y-280)*TT_SCALE<.84){
      const u=(500-old.x)/(b.x-old.x),z=old.height+(t.height-old.height)*u;
      if(z-TT_RADIUS<=TT_TOP+TT_NET){
        if(t.serving&&t.ownBounce&&z>TT_TOP+TT_NET-.015){t.netTouched=true;b.vx*=.92;t.vz*=.8;}
        else{b.x=500-Math.sign(b.vx)*8;b.vx*=-.12;t.vz=-.35;point(s,receiver,'NET');break;}
      }
    }
    if(old.height>=TT_TOP+TT_RADIUS&&t.height<TT_TOP+TT_RADIUS&&t.vz<0){
      const u=(old.height-TT_TOP-TT_RADIUS)/(old.height-t.height),x=old.x+(b.x-old.x)*u,y=old.y+(b.y-old.y)*u;
      if(x>=0&&x<=1000&&y>=0&&y<=560){
        const side:Side=x<500?'left':'right';
        if(t.serving&&!t.ownBounce){if(side!==t.server){bounce(b,t);point(s,receiver,'SERVICE FAULT');break;}t.ownBounce=true;}
        else if(side===t.lastHitter){bounce(b,t);point(s,receiver,'WRONG SIDE');break;}
        else{
          t.bounces++;
          if(t.bounces>1){bounce(b,t);point(s,t.lastHitter,'DOUBLE BOUNCE');break;}
          if(t.serving&&t.netTouched){t.reason='LET · SERVE AGAIN';startTableTennis(s);break;}
          const stroke=t.strokes[t.lastHitter];
          if(t.tactical&&stroke)t.tactical.landing={x,y,strokeTick:stroke.tick,side:t.lastHitter};
        }
        bounce(b,t);
      }else if(t.bounces===0){point(s,receiver,'OUT');break;}
    }
    const plane=ttPlane(receiver),crossed=receiver==='left'?old.x>plane&&b.x<=plane:old.x<plane&&b.x>=plane;
    if(crossed){
      const u=(plane-old.x)/(b.x-old.x),hitY=old.y+(b.y-old.y)*u,hitZ=old.height+(t.height-old.height)*u;
      if(t.bounces===1&&(!t.serving||t.ownBounce)&&Math.abs(hitY-s.paddles[receiver])<=TT_REACH&&hitZ>.78&&hitZ<1.6){
        b.x=plane;b.y=hitY;t.height=hitZ;returnShot(s,receiver);
      }else{point(s,t.bounces===1?t.lastHitter:receiver,t.bounces===1?'MISSED RETURN':'LONG');break;}
    }
    if(t.height<TT_RADIUS||Math.abs(b.y-280)>800){point(s,t.bounces===1?t.lastHitter:receiver,t.bounces===1?'MISSED RETURN':'OUT');break;}
  }
}
