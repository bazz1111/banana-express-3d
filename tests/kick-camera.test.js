import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadNativeGlb} from './fixtures/load-native-glb.js';
import {MixamoRiderAnimator} from '../src/mixamoRiderAnimation.js';
import {createGame} from '../src/game.ts';
import {ScenePhysics} from '../src/physics.ts';
const api=await import('../src/kickCamera.js').catch(()=>({}));
const hero=new THREE.Box3(new THREE.Vector3(-.7,0,-1.4),new THREE.Vector3(.7,3.3,1.4));
const params=aspect=>({camera:new THREE.PerspectiveCamera(52,aspect,.1,1500),desired:new THREE.Vector3(-1.6,2.7,-7.2),target:new THREE.Vector3(1.2,.8,6),fov:52,heroBox:hero,delta:1/60,flight:0});
test('native camera hull retains every projected truck silhouette without empty AABB corners',async()=>{
 assert.equal(typeof api.cameraHull,'function');assert.equal(typeof api.projectPoints,'function');
 const {scene:truck}=await loadNativeGlb(new URL('../assets/export/truck.glb',import.meta.url)),points=api.cameraHull(truck);
 assert.ok(points.length>=8&&points.length<1000,'Cache the actual convex support, not every source vertex');
 for(const angle of [0,.7,1.8,3.1]){
  truck.position.set(3,2,6);truck.rotation.set(.2,angle,angle*.7);truck.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera(62,390/844,.1,100);camera.position.set(-3,3,-6);camera.lookAt(0,2,4);camera.updateMatrixWorld(true);
  const all=[];truck.traverse(mesh=>{if(mesh.isMesh)for(let i=0;i<mesh.geometry.attributes.position.count;i++)all.push(mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));});
  const actual=api.projectPoints(all,camera),hull=api.projectPoints(points,camera,truck.matrixWorld);
  for(const edge of ['min','max'])for(const axis of ['x','y'])assert.ok(Math.abs(actual[edge][axis]-hull[edge][axis])<1e-5,'The hull is the exact native projected envelope');
 }
});
test('camera rider bounds retain an actual skin vertex as the height support',async()=>{
 assert.equal(typeof api.cameraRiderBounds,'function');
 const {scene:rider}=await loadNativeGlb(new URL('../assets/export/riderSkinned.glb',import.meta.url));rider.position.set(2,.3,-1);rider.updateMatrixWorld(true);
 const actual=new THREE.Box3().setFromObject(rider,true),measured=api.cameraRiderBounds(rider);
 assert.ok(actual.min.distanceTo(measured.box.min)<1e-6&&actual.max.distanceTo(measured.box.max)<1e-6);
 assert.ok(Math.abs(measured.top.y-actual.max.y)<1e-6,'Use the painted skin top, not a bone approximation');
});
test('canonical same-lane and road-edge kicks retain a feasible rear-quarter view',async()=>{
 const [bike,rider,cargo,truck]=await Promise.all(['bicycle','riderSkinned','bananaRack','truck'].map(name=>loadNativeGlb(new URL(`../assets/export/${name}.glb`,import.meta.url))));
 const vehiclePoints=api.cameraHull(truck.scene);
 const world=new THREE.Group();world.add(bike.scene,rider.scene,cargo.scene);world.updateMatrixWorld(true);
 const animator=new MixamoRiderAnimator(rider.scene,rider.animations,bike.scene),wheels=['WheelFront','WheelRear'].map(name=>bike.scene.getObjectByName(name));
 for(const [width,height]of [[1280,720],[390,844],[360,780]])for(const [heroLane,truckLane]of [[0,0],[4.6,2.4],[-4.6,-2.4]])for(const stance of ['seated','standing']){
  const g=createGame({mode:'endless',seed:2817,procedural:false,obstacles:[]});Object.assign(g,{phase:'ready',stance,kickPose:.7,kickSide:Math.sign(truckLane-heroLane)||1});
  world.position.x=-heroLane;truck.scene.position.set(-truckLane,0,5);animator.reset(stance);animator.update(g,0,0);animator.applyContactPose();world.updateMatrixWorld(true);truck.scene.updateMatrixWorld(true);
  const p=params(width/height);p.delta=0;p.kickSide=g.kickSide;p.wheelCenters=wheels.map(w=>w.getWorldPosition(new THREE.Vector3()));p.subjectPoints=[api.cameraRiderBounds(rider.scene).top,...p.wheelCenters.map(p=>p.clone().add(new THREE.Vector3(0,-.36,0)))];p.heroBox=new THREE.Box3().setFromObject(world,true);p.vehicleBox=new THREE.Box3().setFromObject(truck.scene,true);p.vehiclePoints=vehiclePoints;p.vehicleMatrix=truck.scene.matrixWorld;
  p.desired.x-=heroLane;p.target.x-=heroLane;
  if(width>height){p.desired.y=2.25;p.desired.z=-3.9;}
  const shot=new api.KickCamera();p.camera.fov=shot.adjust(p);p.camera.position.copy(p.desired);p.camera.lookAt(p.target);p.camera.updateProjectionMatrix();p.camera.updateMatrixWorld(true);
  const label=`${width} ${stance} hero=${heroLane} truck=${truckLane}`;
  const projected=wheels.map(wheel=>wheel.getWorldPosition(new THREE.Vector3()).project(p.camera));
  const gap=Math.abs(projected[0].x-projected[1].x)*width/2;
  assert.ok(gap>width*.035,`${label}: native wheel gap ${gap}px`);
  for(const b of [api.projectBox(p.heroBox,p.camera),api.projectPoints(p.vehiclePoints,p.camera,p.vehicleMatrix)])assert.equal(b.visibleArea,1,label+' must fit');
  const b=api.projectBox(p.heroBox,p.camera);assert.ok((b.max.y-b.min.y)/2>=.18,label+' rider remains readable');
  assert.ok(Math.abs(p.camera.position.x)<=4.2,label+' camera stays on road');
  if(heroLane)assert.equal(Math.sign(p.camera.position.x+heroLane),Math.sign(heroLane),label+' uses the road interior');
 }
});
test('current native rider, short bicycle, full cargo and tumbling truck fit both sides through .6s on desktop and phones',async()=>{
 const [bicycle,rider,cargo,truck]=await Promise.all(['bicycle','riderSkinned','bananaRack','truck'].map(name=>loadNativeGlb(new URL(`../assets/export/${name}.glb`,import.meta.url))));
 const vehiclePoints=api.cameraHull(truck.scene);
 const world=new THREE.Group();world.add(bicycle.scene,rider.scene,cargo.scene);world.updateMatrixWorld(true);
 const wheels=['WheelFront','WheelRear'].map(name=>bicycle.scene.getObjectByName(name));
 assert.ok(Math.abs(wheels[0].position.distanceTo(wheels[1].position)-1.22)<.01,'Use the current natural wheelbase');
 assert.equal(cargo.scene.getObjectByName('BananaCargo').children.filter(o=>o.isMesh).length,20,'Frame a full 100-banana rack');
 const animator=new MixamoRiderAnimator(rider.scene,rider.animations,bicycle.scene);
 for(const [w,h]of [[1280,720],[390,844],[360,780]])for(const [heroLane,truckLane,side]of [[0,-2.6,-1],[0,2.6,1],[0,0,-1],[0,0,1],[4.6,2.4,-1],[-4.6,-2.4,1]])for(const stance of ['seated','standing'])for(const reducedMotion of [false,true]){
  const course={mode:'endless',seed:2817,procedural:false,obstacles:[{id:'truck',type:'truck',s:5,lane:truckLane,speed:0}]};
  const physics=await ScenePhysics.create(course,[]),g=createGame(course),shot=new api.KickCamera();g.phase='racing';g.bananas=100;g.stance=stance;g.speed=12;g.kickSide=side;g.lane=heroLane;world.position.x=-heroLane;world.updateMatrixWorld(true);
  physics.reset(g);g.obstacles[0].kicked=true;g.obstacles[0].kickSide=side;animator.reset();let previousLens=52;
  try{for(let frame=0;frame<=36;frame++){
   const flight=frame/60,p=params(w/h);p.camera.aspect=w/h;p.reducedMotion=reducedMotion;g.kickPose=.7-flight;
   p.desired.x-=heroLane;p.target.x-=heroLane;const label=`${w} ${stance} lane ${heroLane}/${truckLane} side ${side} @${flight}`;
   if(frame){g.s+=g.speed/60;g.elapsed+=1/60;g.obstacles[0].flight=flight;}
   physics.sync(g,frame?1/60:0);const body=physics.vehicles.get('truck');
   truck.scene.position.copy(body.translation());truck.scene.quaternion.copy(body.rotation());truck.scene.updateMatrixWorld(true);
   animator.update({...g,phase:frame?'racing':'ready'},frame?1/60:0,flight*5);animator.applyContactPose();world.updateMatrixWorld(true);
   p.heroBox=new THREE.Box3().setFromObject(world,true);p.vehicleBox=new THREE.Box3().setFromObject(truck.scene,true);p.vehiclePoints=vehiclePoints;p.vehicleMatrix=truck.scene.matrixWorld;p.flight=flight;p.kickSide=side;p.wheelCenters=wheels.map(w=>w.getWorldPosition(new THREE.Vector3()));p.subjectPoints=[api.cameraRiderBounds(rider.scene).top,...p.wheelCenters.map(p=>p.clone().add(new THREE.Vector3(0,-.36,0)))];
   if(w>h){p.desired.set(-heroLane-1.6,2.25,-3.9);p.target.set(-heroLane+1.5,.8,6);}
   p.camera.fov=shot.adjust(p);p.camera.position.copy(p.desired);p.camera.lookAt(p.target);p.camera.updateProjectionMatrix();p.camera.updateMatrixWorld(true);
   for(const [name,projected]of [['rider/bike/cargo',api.projectBox(p.heroBox,p.camera)],['truck',api.projectPoints(p.vehiclePoints,p.camera,p.vehicleMatrix)]]){
    assert.ok(!projected.behind&&projected.min.x>=-1&&projected.max.x<=1&&projected.min.y>=-1&&projected.max.y<=1,`${label}: ${name} clipped ${JSON.stringify(projected)}`);
   }
   const projected=wheels.map(wheel=>wheel.getWorldPosition(new THREE.Vector3()).project(p.camera));
   assert.ok(Math.abs(projected[0].x-projected[1].x)/2>.035,`${label}: short native wheel silhouettes merged`);
   const subject=api.projectBox(p.heroBox,p.camera);
   assert.ok((subject.max.y-subject.min.y)/2>=.18,`${label}: rider became unreadably small`);
   assert.ok(Math.abs(p.camera.position.x)<=4.2,`${label}: camera entered roadside terrain`);
   const right=new THREE.Vector3(-.5,.7,0).project(p.camera),left=new THREE.Vector3(.5,.7,0).project(p.camera);
   assert.ok(right.x>left.x,'Right lane input must still project to the right of the screen');
   assert.ok(p.camera.fov<=(w<h?95:62));
   if(reducedMotion){assert.ok(p.camera.fov>=previousLens-1e-8,'Safety adaptation never adds a decorative FOV pulse');if(!heroLane)assert.equal(p.camera.fov,p.fov,'Ordinary reduced-motion shots keep the normal lens');previousLens=p.camera.fov;}
  }}finally{physics.dispose();}
 }
});
test('reduced motion still fits the action without extra FOV motion and pause preserves helper state',()=>{
 assert.equal(typeof api.KickCamera,'function');const shot=new api.KickCamera(),p=params(16/9);
 p.vehicleBox=new THREE.Box3(new THREE.Vector3(5,4,2),new THREE.Vector3(10,9,8));p.reducedMotion=true;
 const fov=shot.adjust(p);assert.equal(fov,p.fov);p.camera.position.copy(p.desired);p.camera.lookAt(p.target);p.camera.updateProjectionMatrix();p.camera.updateMatrixWorld(true);
 assert.equal(api.projectBox(p.vehicleBox,p.camera).visibleArea,1,'Reduced motion keeps essential framing');
 p.reducedMotion=false;shot.adjust(p);const weight=shot.weight;
 p.paused=true;p.flight=.5;p.delta=1;shot.adjust(p);assert.equal(shot.weight,weight);
 shot.reset();assert.equal(shot.weight,0);
});
test('the impact hold can fit a newly hit truck at delta zero while explicit pause remains frozen',()=>{
 const shot=new api.KickCamera(),p=params(390/844);p.delta=0;p.vehicleBox=new THREE.Box3(new THREE.Vector3(2.6,0,3),new THREE.Vector3(5.2,3,8));
 shot.adjust(p);p.camera.position.copy(p.desired);p.camera.lookAt(p.target);p.camera.updateMatrixWorld(true);
 const box=api.projectBox(p.vehicleBox,p.camera);assert.ok(box.min.x>=-1&&box.max.x<=1,'new impact must fit during game hit-stop');
});
test('asymmetric native truck bounds stay readable without a long retreat',()=>{
 // Actual 390px browser sample at .533s: the old safe-frame search retreated
 // seven metres for less than one pixel of conservative box margin.
 const shot=new api.KickCamera(),p=params(390/844);shot.weight=.6547932012;p.delta=0;p.flight=.5333333333;
 p.heroBox=new THREE.Box3(new THREE.Vector3(-.647911,-.026007,-1.026547),new THREE.Vector3(.601161,1.696066,1.013875));
 p.vehicleBox=new THREE.Box3(new THREE.Vector3(-8.184124,2.502215,5.191353),new THREE.Vector3(-3.004580,6.198649,10.311899));
 p.camera.fov=shot.adjust(p);p.camera.position.copy(p.desired);p.camera.lookAt(p.target);p.camera.updateProjectionMatrix();p.camera.updateMatrixWorld(true);
 assert.ok(Math.hypot(p.camera.position.x,p.camera.position.z)<9,'Center the projected union before moving away from the rider');
 for(const box of [p.heroBox,p.vehicleBox]){
  const b=api.projectBox(box,p.camera);assert.ok(b.min.x>=-.92&&b.max.x<=.92&&b.min.y>=-.92&&b.max.y<=.92);
 }
});
test('portrait framing stays over the road and preserves the native bicycle wheel separation threshold',async()=>{
 const {scene:bike}=await loadNativeGlb(process.env.BANANA_BICYCLE_GLB??new URL('../assets/export/bicycle.glb',import.meta.url));
 for(const center of [[-1.13,1.694,9.225],[-5,4,10]]){
 const camera=new THREE.PerspectiveCamera(52,390/844,.1,1500),shot=new api.KickCamera();
 const desired=new THREE.Vector3(-1.6,2.7,-7.2),target=new THREE.Vector3(1.2,.8,6);
 const vehicleBox=new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...center),new THREE.Vector3(4,4,6));
 camera.fov=shot.adjust({desired,target,fov:52,camera,vehicleBox,heroBox:hero,flight:.25,delta:0});camera.position.copy(desired);camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);bike.updateMatrixWorld(true);
 const centers=['WheelFront','WheelRear'].map(name=>bike.getObjectByName(name).getWorldPosition(new THREE.Vector3()).project(camera));
 const gap=Math.abs(centers[0].x-centers[1].x)*390/2;assert.ok(gap>390*.035,`native wheel gap ${gap}px must exceed13.65px`);
 assert.ok(Math.abs(camera.position.x)<=4.2,'Frame the truck without moving into the cliff');
 }
});
test('explicit pause preserves the rendered camera position including the last impact shake',()=>{
 const shot=new api.KickCamera(),p=params(390/844);p.vehicleBox=new THREE.Box3(new THREE.Vector3(-6,1,4),new THREE.Vector3(-3,4,9));
 p.camera.fov=shot.adjust(p);p.camera.position.copy(p.desired);p.camera.position.y+=.0075;p.camera.lookAt(p.target);
 const rendered=p.camera.position.clone();p.paused=true;p.delta=.1;p.desired.set(-1,2.7,-8.2);p.target.set(.6,1,8);
 assert.equal(shot.adjust(p),p.camera.fov);assert.ok(p.desired.equals(rendered),'pause must retain the exact rendered shaken position');
});
