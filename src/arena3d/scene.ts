import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { GameState,Side } from '../physics';
import { BALL_RADIUS,TABLE_TOP,ballPosition,cameraPose,HALF_LENGTH,HALF_WIDTH,SCALE,lane,type CameraView } from './cameras';
import { createRobot } from './robot';
const TEAM={left:0xd9ff92,right:0xff794c};

export async function createArena3D(canvas:HTMLCanvasElement){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x111719);scene.fog=new THREE.Fog(0x111719,14,34);
  const camera=new THREE.PerspectiveCamera(43,1,.035,70),pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
  const env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.75;room.dispose();pmrem.dispose();
  const materials:THREE.Material[]=[],geometries:THREE.BufferGeometry[]=[];
  const mat=(color:number,roughness=.4,metalness=.1)=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness});materials.push(m);return m;};
  const floorMat=mat(0x202829,.92,.03),dark=mat(0x171e21,.35,.65),tableMat=mat(0x194441,.78,.02),edgeMat=mat(0xb1b8ac,.3,.65),white=mat(0xdce1d5,.8,.02);
  const glow=(color:number,intensity=3)=>{const m=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:intensity});materials.push(m);return m;};
  const warm=glow(0xffe7c6),cool=glow(0xd6eaff),green=glow(TEAM.left),orange=glow(TEAM.right);
  function box(size:[number,number,number],position:[number,number,number],material:THREE.Material,cast=true){
    const g=new THREE.BoxGeometry(...size);geometries.push(g);const mesh=new THREE.Mesh(g,material);mesh.position.set(...position);mesh.castShadow=cast;mesh.receiveShadow=true;scene.add(mesh);return mesh;
  }

  // Architecture: concrete testing hall, suspended softboxes, fine expansion joints.
  box([38,.20,32],[0,-.085,0],floorMat,false);
  for(let x=-18;x<=18;x+=3)box([.012,.004,26],[x,.016,0],dark,false);
  for(let z=-12;z<=12;z+=3)box([36,.004,.012],[0,.016,z],dark,false);
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
  // Open regulation-size court: no side panels, rails or invisible wall geometry.
  for(const z of [-1.65,1.65])box([5.2,.002,.018],[0,.018,z],edgeMat,false);
  for(const x of [-2.6,2.6])box([.018,.002,3.3],[x,.018,0],edgeMat,false);
  for(const side of ['left','right'] as const){const x=side==='left'?-2.5:2.5;box([.022,.003,2.7],[x,.02,0],side==='left'?green:orange,false);}
  box([HALF_LENGTH*2,.055,HALF_WIDTH*2],[0,TABLE_TOP-.0275,0],tableMat);
  for(const z of [-HALF_WIDTH,HALF_WIDTH])box([2.77,.065,.028],[0,TABLE_TOP-.065,z],dark);
  for(const x of [-.87,.87])for(const z of [-.51,.51]){box([.045,.70,.045],[x,.39,z],dark);box([.12,.024,.12],[x,.028,z],dark);}
  box([1.77,.045,.04],[0,.30,-.51],dark);box([1.77,.045,.04],[0,.30,.51],dark);
  for(const z of [-HALF_WIDTH+.015,HALF_WIDTH-.015])box([2.72,.001,.012],[0,TABLE_TOP+.001,z],white,false);
  for(const x of [-1.35,1.35])box([.012,.001,1.51],[x,TABLE_TOP+.001,0],white,false);
  box([2.70,.001,.003],[0,TABLE_TOP+.001,0],white,false);
  // Dark fine mesh, white tape and clamps; no bright wire grid or z-fighting.
  const netCanvas=document.createElement('canvas');netCanvas.width=64;netCanvas.height=64;
  const ctx=netCanvas.getContext('2d')!;ctx.strokeStyle='#182624';ctx.lineWidth=4;ctx.strokeRect(0,0,64,64);
  const netMap=new THREE.CanvasTexture(netCanvas);netMap.wrapS=netMap.wrapT=THREE.RepeatWrapping;netMap.repeat.set(64,7);
  const netMat=new THREE.MeshStandardMaterial({map:netMap,transparent:true,opacity:.72,alphaTest:.02,side:THREE.DoubleSide,roughness:1,depthWrite:false});materials.push(netMat);
  const netGeo=new THREE.PlaneGeometry(1.66,.1525);geometries.push(netGeo);const net=new THREE.Mesh(netGeo,netMat);net.rotation.y=Math.PI/2;net.position.y=TABLE_TOP+.07625;scene.add(net);
  box([.009,.012,1.68],[0,TABLE_TOP+.1525,0],white,false);
  for(const z of [-.84,.84]){box([.018,.19,.018],[0,TABLE_TOP+.067,z],dark);box([.07,.025,.06],[0,.78,z],dark);}
  // Studio lighting, specular definition and contact shadows.
  scene.add(new THREE.HemisphereLight(0xdbe9ed,0x414438,0.65));
  const key=new THREE.DirectionalLight(0xffedcf,2.2);key.position.set(-3,7,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-3.5,right:3.5,top:3,bottom:-3,near:.1,far:22});key.shadow.bias=-.00035;key.shadow.normalBias=.005;scene.add(key);
  const fill=new THREE.DirectionalLight(0xb6d2ff,1.2);fill.position.set(4,4,-5);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffffff,1.1);rim.position.set(-7,3,-2);scene.add(rim);
  // Load the locally authored Blender asset once and duplicate its articulated hierarchy.
  const asset=await new GLTFLoader().loadAsync('/models/arena-robot.glb');
  const robots={} as Record<Side,ReturnType<typeof createRobot>>;
  for(const side of ['left','right'] as const){
    const root=asset.scene.clone(true);root.name=`${side}-robot`;
    root.traverse(object=>{if(object instanceof THREE.Mesh){object.castShadow=true;object.receiveShadow=true;const source=Array.isArray(object.material)?object.material:[object.material];const copies=source.map(m=>{const copy=m.clone();materials.push(copy);if(copy instanceof THREE.MeshStandardMaterial&&m.name==='Team accent'){copy.color.setHex(TEAM[side]);copy.emissive.setHex(TEAM[side]);}return copy;});object.material=Array.isArray(object.material)?copies:copies[0];}});
    root.rotation.y=side==='left'?Math.PI/2:-Math.PI/2;scene.add(root);
    robots[side]=createRobot(root,side);
  }
  const ballGeo=new THREE.SphereGeometry(BALL_RADIUS,24,16);geometries.push(ballGeo);
  const ball=new THREE.Mesh(ballGeo,mat(0xfff4da,.72,0));ball.castShadow=true;scene.add(ball);
  const shadowGeo=new THREE.CircleGeometry(BALL_RADIUS*1.4,24);geometries.push(shadowGeo);const shadowMat=new THREE.MeshBasicMaterial({color:0x050b0a,transparent:true,opacity:.35,depthWrite:false});materials.push(shadowMat);
  const ballShadow=new THREE.Mesh(shadowGeo,shadowMat);ballShadow.rotation.x=-Math.PI/2;ballShadow.position.y=TABLE_TOP+.002;scene.add(ballShadow);
  const landingGeo=new THREE.RingGeometry(.062,.075,40);geometries.push(landingGeo);
  const landingMat=new THREE.MeshBasicMaterial({color:TEAM.left});materials.push(landingMat);
  const landingMarker=new THREE.Mesh(landingGeo,landingMat);
  landingMarker.rotation.x=-Math.PI/2;landingMarker.visible=false;scene.add(landingMarker);
  // A visible comet tail that fades behind the ball and clears at contacts/seeks.
  const trailSamples=24,trailLifetime=.16;
  const trailGeo=new THREE.BufferGeometry(),trailArray=new Float32Array(trailSamples*3),trailColors=new Float32Array(trailSamples*3);
  trailGeo.setAttribute('position',new THREE.BufferAttribute(trailArray,3));trailGeo.setAttribute('color',new THREE.BufferAttribute(trailColors,3));geometries.push(trailGeo);
  const trailMat=new THREE.LineBasicMaterial({color:0xffe8bb,transparent:true,opacity:.6,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending});materials.push(trailMat);const trail=new THREE.Line(trailGeo,trailMat);trail.frustumCulled=false;scene.add(trail);
  let width=0,height=0,lastRally=0,lastPoint=-1,lastTick=-1,disposed=false;
  const trailFrames:{position:THREE.Vector3;time:number}[]=[];
  const camTarget=new THREE.Vector3();
  return {
    markLanding(landing:{x:number;y:number}|null,side:Side){
      landingMarker.visible=landing!==null;
      if(landing){
        landingMarker.position.set(landing.x*SCALE-HALF_LENGTH,TABLE_TOP+.004,lane(landing.y));
        landingMat.color.setHex(TEAM[side]);
      }
    },
    render(game:GameState,view:CameraView,now:number){
      if(disposed)return;
      const w=canvas.clientWidth,h=canvas.clientHeight;if(w!==width||h!==height){width=w;height=h;renderer.setSize(w,h,false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();}
      const t=game.tick/120,[bx,by,bz]=ballPosition(game),active=game.phase!=='lobby'&&(!game.tt||game.tt.height>TABLE_TOP*.1||game.countdown>1.1);
      ball.position.set(bx,by,bz);
      let maxContactError=0,eye:THREE.Vector3|undefined;
      for(const side of ['left','right'] as const){
        const pose=robots[side].update(game,ball.position,view,t);
        maxContactError=Math.max(maxContactError,pose.contactError);
        if(side===view)eye=pose.eye;
      }
      ball.visible=active;ballShadow.visible=active&&Math.abs(bx)<=HALF_LENGTH&&Math.abs(bz)<=HALF_WIDTH&&by>=TABLE_TOP;
      ballShadow.position.x=bx;ballShadow.position.z=bz;
      const ballHeight=by-TABLE_TOP;
      ballShadow.scale.setScalar(1+ballHeight*.45);shadowMat.opacity=.32/(1+ballHeight*2);
      if(lastPoint!==game.pointId||game.phase!=='play'||lastRally!==game.rally||game.tick<lastTick||game.tick-lastTick>30)trailFrames.length=0;
      if(game.phase==='play'&&game.tick!==lastTick)trailFrames.unshift({position:ball.position.clone(),time:t});
      while(trailFrames.length&&(trailFrames.length>trailSamples||t-trailFrames.at(-1)!.time>trailLifetime))trailFrames.pop();
      trailFrames.forEach((f,i)=>{f.position.toArray(trailArray,i*3);const fade=(1-(t-f.time)/trailLifetime)**1.5;trailColors.fill(fade,i*3,i*3+3);});
      trailGeo.attributes.position.needsUpdate=true;trailGeo.attributes.color.needsUpdate=true;
      trailGeo.setDrawRange(0,trailFrames.length);trail.visible=active;
      lastPoint=game.pointId;lastRally=game.rally;lastTick=game.tick;
      canvas.dataset.contactError=maxContactError.toFixed(5);
      canvas.dataset.ballHeight=by.toFixed(5);
      canvas.dataset.ballClearance=(by-TABLE_TOP-BALL_RADIUS).toFixed(5);
      canvas.dataset.overTable=String(Math.abs(bx)<=HALF_LENGTH&&Math.abs(bz)<=HALF_WIDTH);
      canvas.dataset.rules=game.tt?'table-tennis':'pong';
      canvas.dataset.panels='0';
      const pose=cameraPose(view,game,camera.aspect);camera.position.set(...pose.position);if(eye)camera.position.copy(eye);camera.fov=pose.fov;camera.updateProjectionMatrix();camTarget.set(...pose.target);camera.lookAt(camTarget);
      renderer.render(scene,camera);
      canvas.dataset.rendered='true';canvas.dataset.camera=view;canvas.dataset.robots='2';canvas.dataset.tick=String(game.tick);canvas.dataset.triangles=String(renderer.info.render.triangles);
    },
    dispose(){disposed=true;netMap.dispose();env.dispose();materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());const modelGeometries=new Set<THREE.BufferGeometry>();asset.scene.traverse(o=>{if(o instanceof THREE.Mesh)modelGeometries.add(o.geometry);});modelGeometries.forEach(g=>g.dispose());renderer.dispose();},
  };
}
