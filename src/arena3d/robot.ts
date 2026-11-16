import { createTableTennisRobot } from './table-tennis-robot';
import * as THREE from 'three';
import { PADDLE_H,R,type GameState,type Side } from '../physics';
import { BODY_OFFSET,CONTACT_HEIGHT,SCALE,lane,robotX,strikeX } from './cameras';
import { setWorldRotation,solveLimb } from './kinematics';

interface Foot {upper:THREE.Object3D;lower:THREE.Object3D;end:THREE.Object3D;planted:THREE.Vector3;from:THREE.Vector3;to:THREE.Vector3;started:number;rest:THREE.Quaternion[]}
export function createRobot(root:THREE.Group,side:Side){
  const tableTennis=createTableTennisRobot(root,side);
  const sign=side==='left'?1:-1;
  const node=(name:string)=>{const object=root.getObjectByName(name);if(!object)throw new Error(`Robot asset missing ${name}`);return object;};
  const head=node('Head'),upper=node('UpperArm_R'),lower=node('Forearm_R'),wrist=node('Wrist_R'),contact=node('RacketContact');
  const armRest=[upper,lower,wrist].map(o=>o.quaternion.clone());
  const feet:Foot[]=['L','R'].map(label=>{const upper=node(`Thigh_${label}`),lower=node(`Shin_${label}`),end=node(`Ankle_${label}`);return {upper,lower,end,planted:new THREE.Vector3(),from:new THREE.Vector3(),to:new THREE.Vector3(),started:-100,rest:[upper,lower,end].map(o=>o.quaternion.clone())};});
  let initialized=false,lastTime=-1,lastRally=0,hitTime=-10,hitZ=0,contactError=0;
  const ready=new THREE.Vector3(),offset=new THREE.Vector3(),desired=new THREE.Vector3();
  return {
    root,
    update(game:GameState,ball:THREE.Vector3,view:string,time:number){
      if(game.tt)return tableTennis.update(game,ball,view,time);
      const reset=!initialized||time<lastTime||time-lastTime>.25;
      root.position.set(robotX(side),-.025,lane(game.paddles[side])+sign*BODY_OFFSET);
      [upper,lower,wrist].forEach((o,i)=>o.quaternion.copy(armRest[i]));
      feet.forEach(f=>[f.upper,f.lower,f.end].forEach((o,i)=>o.quaternion.copy(f.rest[i])));
      root.updateWorldMatrix(true,true);
      const wristRotation=wrist.getWorldQuaternion(new THREE.Quaternion());
      offset.copy(contact.getWorldPosition(new THREE.Vector3())).sub(wrist.getWorldPosition(new THREE.Vector3()));
      ready.set(strikeX(side),CONTACT_HEIGHT,lane(game.paddles[side]));
      // A compact backswing before the actual authoritative return, then follow-through.
      const incoming=game.phase==='play'&&game.ball.vx*sign<0;
      const impactSeconds=incoming?Math.abs((ball.x-strikeX(side))/(game.ball.vx*SCALE)):Infinity;
      const reachable=Math.abs(game.ball.y-game.paddles[side])<=PADDLE_H/2+R+4;
      const approach=incoming&&reachable?THREE.MathUtils.smoothstep(.26-impactSeconds,0,.26):0;
      const struck=game.rally>lastRally&&game.rally>0&&game.ball.vx*sign>0;
      if(struck&&!reset){hitTime=time;hitZ=ball.z;}
      const since=time-hitTime,follow=since>=0&&since<.30?Math.sin(since/.30*Math.PI):0;
      const hold=since>=0&&since<.34?1-THREE.MathUtils.smoothstep(since,0,.34):0;
      desired.copy(ready);
      desired.x+=sign*(-.055*Math.sin(approach*Math.PI)+.065*follow);
      desired.z=THREE.MathUtils.lerp(desired.z,incoming?ball.z:hitZ,Math.max(approach,hold));
      desired.y+=.025*follow;
      const wristSwing=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),sign*(.18*follow-.14*Math.sin(approach*Math.PI)));
      wristRotation.premultiply(wristSwing);offset.applyQuaternion(wristSwing);
      // Track the ball across the small face near contact, including edge returns.
      solveLimb(upper,lower,wrist,desired.clone().sub(offset),new THREE.Vector3(robotX(side)-sign*.12,1.13,root.position.z-sign*.53));
      setWorldRotation(wrist,wristRotation);root.updateWorldMatrix(true,true);
      contactError=contact.getWorldPosition(new THREE.Vector3()).distanceTo(desired);
      // Plant one foot while the other takes a short lateral step. No skating or
      // frame-rate-dependent leg oscillation; feet remain level through two-bone IK.
      let moving=feet.some(f=>time-f.started<.18);
      feet.forEach(f=>{
        const neutral=f.end.getWorldPosition(new THREE.Vector3());neutral.y=.145;
        if(reset){f.planted.copy(neutral);f.started=-100;}
        if(!moving&&f.planted.distanceTo(neutral)>.10){f.from.copy(f.planted);f.to.copy(neutral);f.started=time;moving=true;}
        const progress=THREE.MathUtils.clamp((time-f.started)/.18,0,1),ease=progress*progress*(3-2*progress);
        if(progress<1){f.planted.lerpVectors(f.from,f.to,ease);f.planted.y=.145+Math.sin(progress*Math.PI)*.045;}else f.planted.y=.145;
        // At abrupt authoritative/replay jumps reset, rather than overextend a limb.
        if(f.planted.distanceTo(neutral)>.33)f.planted.copy(neutral);
        const footRotation=root.getWorldQuaternion(new THREE.Quaternion());
        solveLimb(f.upper,f.lower,f.end,f.planted,new THREE.Vector3(robotX(side)+sign*.5,.55,neutral.z));
        setWorldRotation(f.end,footRotation);
      });
      head.visible=view!==side;
      head.rotation.y=THREE.MathUtils.clamp((ball.z-root.position.z)*sign*.25,-.28,.28);
      lastRally=game.rally;lastTime=time;initialized=true;
      return {eye:undefined,hand:undefined,contactError,face:contact.getWorldPosition(new THREE.Vector3()),struck,reach:reachable};
    },
  };
}
