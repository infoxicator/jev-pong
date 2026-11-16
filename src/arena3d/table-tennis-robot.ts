import * as THREE from 'three';
import type { GameState,Side } from '../physics';
import { TT_REACH,projectTableTennis } from '../table-tennis';
import { SCALE,lane,robotX,strikeX } from './cameras';
import { setWorldRotation,solveLimb } from './kinematics';

export function createTableTennisRobot(root:THREE.Group,side:Side){
  const sign=side==='left'?1:-1,baseYaw=sign*Math.PI/2;
  const node=(name:string)=>{const found=root.getObjectByName(name);if(!found)throw new Error(`Robot asset missing ${name}`);return found;};
  const head=node('Head'),eye=node('Face_sensor_bar'),contact=node('RacketContact');
  const arm=(suffix:string)=>[node(`UpperArm_${suffix}`),node(`Forearm_${suffix}`),node(`Wrist_${suffix}`)] as const;
  const right=arm('R'),left=arm('L'),limbs=[...right,...left,...['L','R'].flatMap(l=>[node(`Thigh_${l}`),node(`Shin_${l}`),node(`Ankle_${l}`)])];
  const rest=limbs.map(o=>o.quaternion.clone());
  const feet=['L','R'].map(label=>({upper:node(`Thigh_${label}`),lower:node(`Shin_${label}`),end:node(`Ankle_${label}`),position:new THREE.Vector3(),from:new THREE.Vector3(),to:new THREE.Vector3(),start:-10}));
  let lastTime=-1,initialized=false,lastStroke=-1,lastHand='forehand';
  return {
    update(game:GameState,ball:THREE.Vector3,view:string,time:number){
      const tt=game.tt!,stroke=tt.strokes[side],since=stroke?(game.tick-stroke.tick)/120:10;
      const reset=!initialized||time<lastTime||time-lastTime>.3;
      const incoming=game.phase==='play'&&game.ball.vx*sign<0;
      const predicted=projectTableTennis(game.ball,tt,side),reachable=incoming&&Math.abs(predicted.y-game.paddles[side])<=TT_REACH+8;
      const approach=reachable?THREE.MathUtils.smoothstep(.42-predicted.time,0,.42):0;
      const windup=Math.sin(approach*Math.PI),follow=since>=0&&since<.42?Math.sin(since/.42*Math.PI):0;
      const recovery=since>=0&&since<.48?1-THREE.MathUtils.smoothstep(since,.22,.48):0;
      const serving=game.phase==='serve'&&tt.server===side;
      const hand=stroke&&since<.48?stroke.hand:(predicted.y-game.paddles[side])*sign>0?'backhand':'forehand';
      const forehand=hand!=='backhand',swingSign=forehand?1:-1;
      const expectedHeight=reachable?THREE.MathUtils.clamp(predicted.height,.88,1.5):stroke?THREE.MathUtils.lerp(1.04,THREE.MathUtils.clamp(stroke.height,.88,1.5),recovery):1.04;
      const crouch=-.16+THREE.MathUtils.clamp((expectedHeight-1.05)*.20,-.04,.06);
      root.position.set(robotX(side,true)+sign*(.025*Math.max(approach,recovery)+.045*follow),crouch,lane(game.paddles[side])+sign*.08);
      root.rotation.set(0,baseYaw+swingSign*(.20*windup-.24*follow)+(serving?.18:0),-sign*.065);
      limbs.forEach((o,i)=>o.quaternion.copy(rest[i]));root.updateWorldMatrix(true,true);
      const target=new THREE.Vector3(strikeX(side,true)-sign*.08,1.03,lane(game.paddles[side]));
      if(reachable){target.y=THREE.MathUtils.lerp(target.y,expectedHeight,approach);target.z=THREE.MathUtils.lerp(target.z,lane(predicted.y),approach);target.x+=sign*.08*approach;}
      target.x-=sign*.11*windup;target.z-=sign*swingSign*.16*windup;target.y-=.07*windup;
      if(stroke&&recovery>0){
        // The follow-through travels with the recovering torso after contact.
        const recoverLane=THREE.MathUtils.smoothstep(since,0,.24);
        const hit=new THREE.Vector3(strikeX(side,true),stroke.height,THREE.MathUtils.lerp(lane(stroke.y),lane(game.paddles[side]),recoverLane));
        hit.x+=sign*.06*follow;hit.z+=sign*swingSign*.14*follow;hit.y+=(stroke.kind==='smash'?-.12:.16)*follow;
        target.lerp(hit,recovery);
      }
      if(serving){const prep=THREE.MathUtils.smoothstep(.8-game.countdown,0,.8);target.set(strikeX(side,true)-sign*.13*Math.sin(prep*Math.PI),1.07,lane(game.paddles[side])-sign*.14*Math.sin(prep*Math.PI));}
      const wristRotation=right[2].getWorldQuaternion(new THREE.Quaternion());
      const pitch=(forehand?1:-1)*(.30*windup-.35*follow)+(tt.shot==='topspin'?.12:tt.shot==='push'?-.12:0);
      const twist=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,swingSign*(.40*windup-.58*follow),sign*pitch));
      const offset=contact.getWorldPosition(new THREE.Vector3()).sub(right[2].getWorldPosition(new THREE.Vector3())).applyQuaternion(twist);
      wristRotation.premultiply(twist);
      solveLimb(...right,target.clone().sub(offset),new THREE.Vector3(root.position.x-sign*.05,1.12,root.position.z-sign*(forehand?.48:.30)));
      setWorldRotation(right[2],wristRotation);
      // The free arm balances the stroke and presents the ball during service.
      const free=new THREE.Vector3(root.position.x+sign*.29,1.18,root.position.z+sign*(.26-.10*follow));
      if(serving){free.set(root.position.x+sign*.44,1.065,lane(game.paddles[side])+.04*sign);}
      const freeRotation=left[2].getWorldQuaternion(new THREE.Quaternion());
      solveLimb(...left,free,new THREE.Vector3(root.position.x,1.1,root.position.z+sign*.50));setWorldRotation(left[2],freeRotation);
      // Athletic staggered stance, alternating lateral shuffle steps, level soles.
      const destinations=feet.map((_,i)=>new THREE.Vector3(root.position.x+sign*(i===0?-.045:.095),.145,root.position.z+sign*(i===0?.205:-.205)));
      if(reset)feet.forEach((f,i)=>{f.position.copy(destinations[i]);f.start=-10;});
      const moving=feet.findIndex(f=>time-f.start<.115);
      if(moving<0){
        const distances=feet.map((f,i)=>f.position.distanceTo(destinations[i])),index=distances[0]>distances[1]?0:1;
        if(distances[index]>.065){const f=feet[index];f.from.copy(f.position);f.to.copy(destinations[index]);f.to.z+=THREE.MathUtils.clamp(tt.velocity[side]*SCALE*.055,-.12,.12);f.start=time;}
      }
      feet.forEach((f,i)=>{
        const progress=THREE.MathUtils.clamp((time-f.start)/.115,0,1),ease=progress*progress*(3-2*progress);
        if(f.start>-10){f.position.lerpVectors(f.from,f.to,ease);f.position.y=.145+Math.sin(progress*Math.PI)*.035;}
        solveLimb(f.upper,f.lower,f.end,f.position,new THREE.Vector3(root.position.x+sign*.5,.5,destinations[i].z));
        setWorldRotation(f.end,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),baseYaw+(i===0?-.10:.10)));
      });
      head.visible=view!==side;head.rotation.y=THREE.MathUtils.clamp((ball.z-root.position.z)*sign*.3,-.35,.35);
      root.updateWorldMatrix(true,true);
      const face=contact.getWorldPosition(new THREE.Vector3()),contactError=face.distanceTo(target);
      const struck=!!stroke&&stroke.tick!==lastStroke&&since<.15;
      if(stroke){lastStroke=stroke.tick;lastHand=stroke.hand;}
      initialized=true;lastTime=time;
      return {face,contactError,struck,reach:reachable,eye:eye.getWorldPosition(new THREE.Vector3()),hand:lastHand};
    },
  };
}
