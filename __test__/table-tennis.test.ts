import { describe,expect,it } from 'vitest';
import { createGame,startServe,step,setIntent } from '../src/physics';
import { mockBrain,snapshot,intercept } from '../src/agents';
import { TT_TOP,TT_RADIUS,ttPlane,ttServer,tableTennisWon,returnShot } from '../src/table-tennis';
const playing=()=>{const s=createGame('table-tennis');s.phase='play';s.tt!.serving=false;s.tt!.lastHitter='left';return s;};
describe('authoritative table tennis',()=>{
  it('serves behind the end line and bounces on both halves before the receiver can strike',()=>{
    const s=createGame('table-tennis');startServe(s);let own=false,receiver=false,hit=false,previousBounce=0;
    expect(s.ball.x).toBeLessThan(0);
    for(let i=0;i<500&&s.pointId===0;i++){
      for(const side of ['left','right'] as const)setIntent(s,side,intercept(snapshot(s,side)));
      step(s);
      if(s.tt!.bounceId>previousBounce){if(!own){expect(s.ball.x).toBeLessThan(500);own=true;}else receiver=true;previousBounce=s.tt!.bounceId;}
      if(s.rally>0){hit=true;expect(own&&receiver).toBe(true);break;}
    }
    expect(hit).toBe(true);
  });
  it('has open sidelines and awards an out shot to the receiver',()=>{
    const s=playing();s.ball={x:650,y:558,vx:500,vy:400};s.tt!.height=.80;s.tt!.vz=-1;
    for(let i=0;i<30&&s.pointId===0;i++)step(s);
    expect(s.ball.y).toBeGreaterThan(560);expect(s.ball.vy).toBeGreaterThan(0);expect(s.score.right).toBe(1);expect(s.tt!.reason).toBe('OUT');
  });
  it('scores net faults once and does not tunnel through the net on a smash',()=>{
    const s=playing();s.ball={x:495,y:280,vx:3000,vy:0};s.tt!.height=TT_TOP+.10;s.tt!.vz=0;
    step(s);expect(s.tt!.reason).toBe('NET');expect(s.score.right).toBe(1);expect(s.ball.x).toBeLessThan(500);
    for(let i=0;i<50;i++)step(s);expect(s.score.right).toBe(1);
  });
  it('requires a receiver bounce and distinguishes a long shot from a missed legal return',()=>{
    for(const bounces of [0,1]){const s=playing();s.tt!.bounces=bounces;s.tt!.height=1.05;s.ball={x:ttPlane('right')-2,y:60,vx:1600,vy:0};step(s);expect(s.lastScorer).toBe(bounces?'left':'right');expect(s.tt!.reason).toBe(bounces?'MISSED RETURN':'LONG');}
  });
  it('awards a second bounce and keeps the dead ball above the table surface',()=>{
    const s=playing();s.tt!.bounces=1;s.tt!.height=TT_TOP+TT_RADIUS+.001;s.tt!.vz=-2;s.ball={x:800,y:280,vx:100,vy:0};step(s);
    expect(s.tt!.reason).toBe('DOUBLE BOUNCE');expect(s.lastScorer).toBe('left');
    for(let i=0;i<60;i++){step(s);expect(s.tt!.height).toBeGreaterThanOrEqual(TT_TOP+TT_RADIUS);}
  });
  it('replays a legal net-touch serve without awarding a point and rejects wrong-side returns',()=>{
    const letServe=playing();letServe.tt!.serving=true;letServe.tt!.ownBounce=true;letServe.tt!.netTouched=true;
    letServe.tt!.height=TT_TOP+TT_RADIUS+.001;letServe.tt!.vz=-1;letServe.ball={x:750,y:280,vx:800,vy:0};step(letServe);
    expect(letServe.phase).toBe('serve');expect(letServe.pointId).toBe(0);expect(letServe.tt!.reason).toContain('LET');
    const wrong=playing();wrong.tt!.height=TT_TOP+TT_RADIUS+.001;wrong.tt!.vz=-1;wrong.ball={x:250,y:280,vx:800,vy:0};step(wrong);
    expect(wrong.tt!.reason).toBe('WRONG SIDE');expect(wrong.lastScorer).toBe('right');
  });
  it('alternates two serves, then one at deuce, and requires an eleven-point two-point lead',()=>{
    expect([0,1,2,3,4].map(n=>ttServer({left:n,right:0}))).toEqual(['left','left','right','right','left']);
    expect(ttServer({left:10,right:10})).toBe('left');expect(ttServer({left:11,right:10})).toBe('right');
    const s=playing();s.score={left:11,right:10};expect(tableTennisWon(s)).toBe(false);s.score.left=12;expect(tableTennisWon(s)).toBe(true);
  });
  it('records forehand/backhand contacts and punishes unpositioned paddles',()=>{
    for(const offset of [-20,20]){const s=playing();s.tt!.height=1.05;s.tt!.bounces=1;s.ball={x:ttPlane('right')-3,y:280+offset,vx:1400,vy:0};step(s);expect(s.rally).toBe(1);expect(s.tt!.strokes.right!.hand).toBe(offset<0?'backhand':'forehand');}
    const s=playing();s.tt!.height=1.05;s.tt!.bounces=1;s.ball={x:ttPlane('right')-3,y:400,vx:1400,vy:0};step(s);expect(s.rally).toBe(0);expect(s.lastScorer).toBe('left');
  });
  it('produces repeatable challenging rallies with varied strokes under 200ms mock decisions',()=>{
    const a=createGame('table-tennis'),b=createGame('table-tennis'),shots=new Set<string>();startServe(a);startServe(b);let last=0;
    for(let i=0;i<24000;i++){
      if(i%24===0)for(const side of ['left','right'] as const){const action=mockBrain(snapshot(a,side));setIntent(a,side,action.target_y);setIntent(b,side,action.target_y);}
      step(a);step(b);if(a.rally>last)shots.add(a.tt!.shot);last=a.rally;
      expect(Number.isFinite(a.tt!.height)).toBe(true);
    }
    expect(a).toEqual(b);expect(a.bestRally).toBeGreaterThanOrEqual(3);expect(a.pointId).toBeGreaterThan(10);expect(shots.size).toBeGreaterThanOrEqual(4);
  });
  it('uses true height and applies topspin acceleration rather than a painted-on arc',()=>{
    const s=playing();s.ball={x:40,y:280,vx:1000,vy:0};s.tt!.height=1.1;s.rally=1;returnShot(s,'left');expect(s.tt!.shot).toBe('topspin');
    const before=s.tt!.vz;step(s);expect(s.tt!.vz).toBeLessThan(before-9.81/120);
  });
});
