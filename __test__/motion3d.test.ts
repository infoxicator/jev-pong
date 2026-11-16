import { beforeAll,expect,it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGame,step,INSET,PADDLE_W,R,W,H } from '../src/physics';
import { BALL_RADIUS,CONTACT_HEIGHT,HALF_LENGTH,SCALE,TABLE_TOP,ballContactX,ballPosition } from '../src/arena3d/cameras';
import { interpolateGame } from '../src/arena3d/interpolation';
import { createRobot } from '../src/arena3d/robot';
let model:THREE.Group;
beforeAll(async()=>{model=(await new GLTFLoader().loadAsync('/models/arena-robot.glb')).scene;});
it('uses realistic thin rubber blades, with both wrists holding their bats',()=>{
  model.updateMatrixWorld(true);
  const rubber=model.getObjectByName('Racket_face')!;
  const size=new THREE.Box3().setFromObject(rubber).getSize(new THREE.Vector3());
  expect(size.x).toBeCloseTo(.169,3);expect(size.y).toBeCloseTo(.189,3);expect(size.z).toBeLessThan(.006);
  const handle=model.getObjectByName('Racket_handle')!.getWorldPosition(new THREE.Vector3());
  const wrist=model.getObjectByName('Wrist_R')!.getWorldPosition(new THREE.Vector3());
  expect(handle.distanceTo(wrist)).toBeLessThan(.06);
});
it('has one receiver-side table bounce, clears the net and joins continuously at each return',()=>{
  const s=createGame();s.phase='play';
  for(const sign of [-1,1]){
    s.ball.vx=sign*430;
    const heights:number[]=[];
    for(let i=0;i<=1000;i++){
      const u=i/1000,x=sign*(2*u-1)*ballContactX('right');s.ball.x=(x+HALF_LENGTH)/SCALE;
      const y=ballPosition(s)[1];heights.push(y);expect(y).toBeGreaterThanOrEqual(TABLE_TOP+BALL_RADIUS-1e-6);
      if(Math.abs(x)<.01)expect(y-BALL_RADIUS).toBeGreaterThan(TABLE_TOP+.1525);
    }
    expect(heights[0]).toBeCloseTo(CONTACT_HEIGHT);expect(heights[1000]).toBeCloseTo(CONTACT_HEIGHT);
    expect(heights[650]).toBeCloseTo(TABLE_TOP+BALL_RADIUS);
    const minima=heights.filter((v,i)=>i>0&&i<1000&&v<heights[i-1]&&v<heights[i+1]);expect(minima).toHaveLength(1);
    const incoming=ballPosition(s);s.ball.vx*=-1;expect(ballPosition(s)[1]).toBeCloseTo(incoming[1]);
  }
});
it('passes through racket and rail collision planes without early velocity flips',()=>{
  const a=createGame();a.phase='play';a.ball={x:W-INSET-PADDLE_W-R-10,y:280,vx:500,vy:0};
  const b=structuredClone(a);b.ball.x+=5;b.ball.vx=-540;b.rally=1;b.tick=4;
  expect(interpolateGame(a,b,.5).ball.vx).toBe(500);
  const contact=interpolateGame(a,b,2/3);expect(contact.ball.x).toBeCloseTo(W-INSET-PADDLE_W-R);expect(contact.rally).toBe(1);
  a.ball={x:500,y:H-R-10,vx:430,vy:100};b.ball={x:520,y:H-R-5,vx:430,vy:-100};b.rally=0;
  expect(interpolateGame(a,b,2/3).ball.y).toBeCloseTo(H-R);
  expect(interpolateGame(a,b,.5).ball.vy).toBe(100);
});
it('keeps actual GLB arms on their targets and feet above the floor through rallies and replay seeks',()=>{
  const left=model.clone(true),right=model.clone(true);left.rotation.y=Math.PI/2;right.rotation.y=-Math.PI/2;
  const rigs=[createRobot(left,'left'),createRobot(right,'right')];
  const s=createGame();s.phase='play';let returns=0,maxError=0,minFoot=Infinity;
  for(let frame=0;frame<2400;frame++){
    s.targets.left=s.ball.y;s.targets.right=s.ball.y;step(s);
    const ball=new THREE.Vector3(...ballPosition(s));
    rigs.forEach((rig,index)=>{
      const pose=rig.update(s,ball,'spectator',s.tick/120);maxError=Math.max(maxError,pose.contactError);
      if(pose.struck){returns++;expect(Math.abs(pose.face.y-ball.y)).toBeLessThan(.04);expect(Math.abs(pose.face.z-ball.z)).toBeLessThan(.01);}
      rig.root.updateMatrixWorld(true);
      for(const label of ['L','R'])minFoot=Math.min(minFoot,new THREE.Box3().setFromObject(rig.root.getObjectByName(`Sole_${label}`)!).min.y);
    });
  }
  expect(returns).toBeGreaterThan(5);expect(maxError).toBeLessThan(.006);expect(minFoot).toBeGreaterThan(.012);
  const fresh=createGame();rigs.forEach(rig=>expect(rig.update(fresh,new THREE.Vector3(...ballPosition(fresh)),'spectator',0).contactError).toBeLessThan(.006));
});

it('meets both edges of the authoritative paddle without stretched arms',()=>{
  for(const side of ['left','right'] as const)for(const edge of [-1,1]){
    const root=model.clone(true);root.rotation.y=side==='left'?Math.PI/2:-Math.PI/2;
    const rig=createRobot(root,side),s=createGame();s.phase='play';s.tick=100;
    s.ball.x=side==='left'?INSET+PADDLE_W+R:W-INSET-PADDLE_W-R;
    s.ball.y=s.paddles[side]+edge*49;s.ball.vx=side==='left'?-500:500;
    const ball=new THREE.Vector3(...ballPosition(s));
    rig.update(s,ball,'spectator',100/120);
    s.tick++;s.rally++;s.ball.vx*=-1;
    const pose=rig.update(s,ball,'spectator',101/120);
    expect(pose.contactError).toBeLessThan(.006);
    expect(Math.abs(pose.face.z-ball.z)).toBeLessThan(.006);
    expect(Math.abs(pose.face.x-ball.x)).toBeCloseTo(BALL_RADIUS,3);
  }
});

it('executes table-tennis strokes with articulated wrists, grounded feet and honest contact reach',async()=>{
  const {startServe,setIntent}=await import('../src/physics');const {mockBrain,snapshot}=await import('../src/agents');
  const roots=[model.clone(true),model.clone(true)];roots[0].rotation.y=Math.PI/2;roots[1].rotation.y=-Math.PI/2;
  const rigs=[createRobot(roots[0],'left'),createRobot(roots[1],'right')],s=createGame('table-tennis');startServe(s);
  let maxStrikeError=0,maxError=0,minFoot=Infinity,contacts=0,maxWristAngle=0;const hands=new Set<string>();
  const initial=roots.map(r=>r.getObjectByName('Wrist_R')!.quaternion.clone());
  for(let i=0;i<36000;i++){
    if(i%24===0)for(const side of ['left','right'] as const)setIntent(s,side,mockBrain(snapshot(s,side)).target_y);
    step(s);const ball=new THREE.Vector3(...ballPosition(s));
    rigs.forEach((rig,index)=>{
      const pose=rig.update(s,ball,'spectator',s.tick/120);maxError=Math.max(maxError,pose.contactError);
      if(pose.struck&&s.phase==='play'){contacts++;hands.add(pose.hand!);maxStrikeError=Math.max(maxStrikeError,pose.contactError);}
      maxWristAngle=Math.max(maxWristAngle,roots[index].getObjectByName('Wrist_R')!.quaternion.angleTo(initial[index]));
      roots[index].updateMatrixWorld(true);
      for(const label of ['L','R'])minFoot=Math.min(minFoot,new THREE.Box3().setFromObject(roots[index].getObjectByName(`Sole_${label}`)!).min.y);
    });
  }
  expect(maxError).toBeLessThan(.006);expect(maxStrikeError).toBeLessThan(.001);expect(minFoot).toBeGreaterThan(.008);expect(contacts).toBeGreaterThan(10);
  expect(maxWristAngle).toBeGreaterThan(.4);expect(hands.has('forehand')&&hands.has('backhand')).toBe(true);
});
