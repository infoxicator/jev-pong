import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { GameState,Side } from '../physics';
import { ballPosition,cameraPose,HALF_LENGTH,HALF_WIDTH,lane,robotX,type CameraView } from './cameras';
const TEAM={left:0xd9ff92,right:0xff794c};
interface Robot {root:THREE.Group;head:THREE.Object3D;arm:THREE.Object3D;thighs:THREE.Object3D[];racket:THREE.Object3D;lastZ:number;hit:number}
export async function createArena3D(canvas:HTMLCanvasElement){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x111719);scene.fog=new THREE.Fog(0x111719,14,34);
  const camera=new THREE.PerspectiveCamera(43,1,.035,70),pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
  const env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.75;room.dispose();pmrem.dispose();
  const materials:THREE.Material[]=[],geometries:THREE.BufferGeometry[]=[];
  const mat=(color:number,roughness=.4,metalness=.1)=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness});materials.push(m);return m;};
  const floorMat=mat(0x22292a,.68,.2),dark=mat(0x171e21,.35,.65),tableMat=mat(0x223b38,.46,.18),edgeMat=mat(0xb1b8ac,.3,.65),white=mat(0xcbd3c7,.4,.35);
  const glow=(color:number,intensity=3)=>{const m=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:intensity});materials.push(m);return m;};
  const warm=glow(0xffe7c6),cool=glow(0xd6eaff),green=glow(TEAM.left),orange=glow(TEAM.right);
  function box(size:[number,number,number],position:[number,number,number],material:THREE.Material,cast=true){
    const g=new THREE.BoxGeometry(...size);geometries.push(g);const mesh=new THREE.Mesh(g,material);mesh.position.set(...position);mesh.castShadow=cast;mesh.receiveShadow=true;scene.add(mesh);return mesh;
  }
  function line(points:THREE.Vector3[],color:number,opacity=1){const g=new THREE.BufferGeometry().setFromPoints(points);geometries.push(g);const m=new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity});materials.push(m);const l=new THREE.Line(g,m);scene.add(l);return l;}
  // Architecture: concrete testing hall, suspended softboxes, fine expansion joints.
  box([38,.20,32],[0,-.15,0],floorMat,false);
  for(let x=-18;x<=18;x+=3)box([.012,.004,26],[x,-.045,0],dark,false);
  for(let z=-12;z<=12;z+=3)box([36,.004,.012],[0,-.044,z],dark,false);
  box([32,9,.25],[0,4.4,-8.5],mat(0x1e272a,.8),false);
  for(let x=-15;x<=15;x+=3){box([.035,8,.08],[x,4,-8.32],dark,false);box([.075,4,.035],[x,2,-8.23],white,false);}
  box([18,.08,.08],[0,1.1,-8.28],warm,false);
  for(const side of [-1,1]){
    box([.3,6,.4],[side*10,2.95,-3],dark);
    box([.30,6,.4],[side*10,2.95,5],dark);
    box([.12,.15,9],[side*5,5.0,-1],dark);
    box([.06,.025,7],[side*5,4.90,-1],cool,false);
  }
  for(const x of [-3,0,3]){
    box([2.3,.12,.65],[x,5.1,0],dark);box([2.1,.025,.52],[x,5.025,0],warm,false);
    box([1.8,.12,.5],[x,4.6,-5.3],dark);box([1.7,.025,.44],[x,4.525,-5.3],cool,false);
  }
  // Ground markings frame the match without adding collision geometry.
  for(const z of [-2.65,2.65])box([10,.006,.025],[0,-.038,z],edgeMat,false);
  for(const x of [-5,5])box([.025,.006,5.3],[x,-.038,0],edgeMat,false);
  for(const side of ['left','right'] as const){const x=side==='left'?-4.7:4.7;box([.06,.009,4.2],[x,-.035,0],side==='left'?green:orange,false);}
  // Competition table. The original Pong coordinates map directly to this surface.
  box([6.5,.10,3.64],[0,.76,0],tableMat);
  box([6.56,.10,.055],[0,.70,-1.85],dark);box([6.56,.10,.055],[0,.70,1.85],dark);
  for(const x of [-2.1,2.1])for(const z of [-1.3,1.3]){box([.09,.72,.09],[x,.35,z],dark);box([.25,.045,.25],[x,.01,z],dark);}
  box([4.3,.09,.08],[0,.30,-1.3],steel());box([4.3,.09,.08],[0,.30,1.3],steel());
  for(const z of [-1.78,1.78])box([6.42,.003,.022],[0,.812,z],white,false);
  for(const x of [-3.18,3.18])box([.022,.003,3.56],[x,.812,0],white,false);
  box([6.38,.003,.014],[0,.813,0],white,false);
  // Individually drawn net threads remain transparent at eye level.
  for(let z=-1.9;z<=1.9;z+=.065)line([new THREE.Vector3(0,.815,z),new THREE.Vector3(0,1.005,z)],0x677a75,.6);
  for(let y=.83;y<1.01;y+=.035)line([new THREE.Vector3(0,y,-1.9),new THREE.Vector3(0,y,1.9)],0x7a8982,.55);
  box([.018,.02,3.9],[0,1.01,0],white,false);
  for(const z of [-1.94,1.94])box([.04,.27,.04],[0,.89,z],steel());
  // Studio lighting, specular definition and contact shadows.
  scene.add(new THREE.HemisphereLight(0xdbe9ed,0x414438,1.0));
  const key=new THREE.DirectionalLight(0xffedcf,2.8);key.position.set(-3,7,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-7,right:7,top:5,bottom:-5,near:.1,far:22});key.shadow.bias=-.00035;key.shadow.normalBias=.015;scene.add(key);
  const fill=new THREE.DirectionalLight(0xb6d2ff,1.8);fill.position.set(4,4,-5);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffffff,1.8);rim.position.set(-7,3,-2);scene.add(rim);
  function steel(){return edgeMat;}
  // Load the locally authored Blender asset once and duplicate its articulated hierarchy.
  const asset=await new GLTFLoader().loadAsync('/models/arena-robot.glb');
  const robots={} as Record<Side,Robot>;
  for(const side of ['left','right'] as const){
    const root=asset.scene.clone(true);root.name=`${side}-robot`;
    root.traverse(object=>{if(object instanceof THREE.Mesh){object.castShadow=true;object.receiveShadow=true;const source=Array.isArray(object.material)?object.material:[object.material];const copies=source.map(m=>{const copy=m.clone();materials.push(copy);if(copy instanceof THREE.MeshStandardMaterial&&m.name==='Team accent'){copy.color.setHex(TEAM[side]);copy.emissive.setHex(TEAM[side]);}return copy;});object.material=Array.isArray(object.material)?copies:copies[0];}});
    root.rotation.y=side==='left'?Math.PI/2:-Math.PI/2;scene.add(root);
    robots[side]={root,head:root.getObjectByName('Head')!,arm:root.getObjectByName('UpperArm_R')!,racket:root.getObjectByName('Racket')!,thighs:['Thigh_L','Thigh_R'].map(n=>root.getObjectByName(n)!),lastZ:0,hit:-10};
  }
  const ballGeo=new THREE.SphereGeometry(.047,24,16);geometries.push(ballGeo);
  const ball=new THREE.Mesh(ballGeo,mat(0xffe5b4,.24,.04));ball.castShadow=true;scene.add(ball);
  const shadowGeo=new THREE.CircleGeometry(.075,24);geometries.push(shadowGeo);const shadowMat=new THREE.MeshBasicMaterial({color:0x050b0a,transparent:true,opacity:.35,depthWrite:false});materials.push(shadowMat);
  const ballShadow=new THREE.Mesh(shadowGeo,shadowMat);ballShadow.rotation.x=-Math.PI/2;ballShadow.position.y=.816;scene.add(ballShadow);
  const trailGeo=new THREE.BufferGeometry(),trailArray=new Float32Array(36*3);trailGeo.setAttribute('position',new THREE.BufferAttribute(trailArray,3));geometries.push(trailGeo);
  const trailMat=new THREE.LineBasicMaterial({color:0xffd6a0,transparent:true,opacity:.22});materials.push(trailMat);const trail=new THREE.Line(trailGeo,trailMat);trail.frustumCulled=false;scene.add(trail);
  let width=0,height=0,lastRally=0,lastPoint=-1,lastBallX=0,trailCount=0,disposed=false;
  const camTarget=new THREE.Vector3();
  return {
    render(game:GameState,view:CameraView,now:number){
      if(disposed)return;
      const w=canvas.clientWidth,h=canvas.clientHeight;if(w!==width||h!==height){width=w;height=h;renderer.setSize(w,h,false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();}
      const t=now/1000,[bx,by,bz]=ballPosition(game),active=game.phase!=='lobby';
      if(game.rally!==lastRally&&game.rally>0){const side=lastBallX<0?'left':'right';robots[side].hit=t;}lastRally=game.rally;lastBallX=bx;
      for(const side of ['left','right'] as const){
        const robot=robots[side],sign=side==='left'?1:-1,z=lane(game.paddles[side])+sign*.4,delta=z-robot.lastZ;
        robot.root.position.set(robotX(side),0,z);robot.lastZ=z;
        const swing=Math.exp(-Math.pow((t-robot.hit-.05)/.12,2));
        robot.arm.rotation.x=-swing*.18;robot.racket.rotation.x=-swing*.08;
        robot.thighs.forEach((leg,i)=>{leg.rotation.z=Math.sin(t*10+i*Math.PI)*Math.min(.07,Math.abs(delta)*6);});
        robot.head.visible=view!==side;
        // Keep the own-body silhouette below the eye camera; the racket stays in view.
      }
      ball.visible=active;ballShadow.visible=active;ball.position.set(bx,by,bz);ballShadow.position.x=bx;ballShadow.position.z=bz;ballShadow.scale.setScalar(1+(by-.85)*.4);
      if(lastPoint!==game.pointId||game.phase!=='play'){trailCount=0;trailArray.fill(0);}lastPoint=game.pointId;
      if(game.phase==='play'){trailArray.copyWithin(3,0,trailArray.length-3);trailArray[0]=bx;trailArray[1]=by;trailArray[2]=bz;trailCount=Math.min(36,trailCount+1);trailGeo.attributes.position.needsUpdate=true;}
      trailGeo.setDrawRange(0,trailCount);trail.visible=game.phase==='play';
      const pose=cameraPose(view,game,camera.aspect);camera.position.set(...pose.position);camera.fov=pose.fov;camera.updateProjectionMatrix();camTarget.set(...pose.target);camera.lookAt(camTarget);
      renderer.render(scene,camera);
      canvas.dataset.rendered='true';canvas.dataset.camera=view;canvas.dataset.robots='2';canvas.dataset.tick=String(game.tick);canvas.dataset.triangles=String(renderer.info.render.triangles);
    },
    dispose(){disposed=true;env.dispose();materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());const modelGeometries=new Set<THREE.BufferGeometry>();asset.scene.traverse(o=>{if(o instanceof THREE.Mesh)modelGeometries.add(o.geometry);});modelGeometries.forEach(g=>g.dispose());renderer.dispose();},
  };
}
