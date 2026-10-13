import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const api=await import('../src/kickCamera.js').catch(()=>({}));
const hero=new THREE.Box3(new THREE.Vector3(-.7,0,-1.4),new THREE.Vector3(.7,3.3,1.4));
const params=aspect=>({camera:new THREE.PerspectiveCamera(59,aspect,.1,1500),desired:new THREE.Vector3(-1,2.7,-8.2),target:new THREE.Vector3(.6,1,8),fov:59,heroBox:hero,delta:1/60,flight:0});
test('portrait shot projects at least half the truck extent and keeps the rider in frame through .6s on both sides',()=>{
 assert.equal(typeof api.KickCamera,'function','portrait camera helper must exist');
 for(const [w,h]of [[390,844],[360,780]])for(const side of [-1,1]){
  const shot=new api.KickCamera();for(let frame=0;frame<=36;frame++){
   const flight=frame/60,p=params(w/h),x=-side*(2.6+5.5*flight),y=1.3+7.5*flight-4.905*flight*flight;
   const mesh=new THREE.Mesh(new THREE.BoxGeometry(2.6,2.6,4.9));mesh.position.set(x,y,3.8+6*flight);mesh.rotation.z=side*5.5*flight;mesh.updateMatrixWorld(true);
   p.vehicleBox=new THREE.Box3().setFromObject(mesh);p.flight=flight;
   const fov=shot.adjust(p);p.camera.fov=fov;p.camera.position.copy(p.desired);p.camera.lookAt(p.target);p.camera.updateProjectionMatrix();p.camera.updateMatrixWorld(true);
   const projected=api.projectBox(p.vehicleBox,p.camera),rider=api.projectBox(hero,p.camera);
   assert.ok(projected.visibleArea>=.5,`${w} side ${side} time ${flight}: ${projected.visibleArea}`);
   assert.ok(rider.min.x>=-1&&rider.max.x<=1&&rider.min.y>=-1&&rider.max.y<=1,'full rider bounds must stay inside');
   assert.ok(fov<=62);mesh.geometry.dispose();mesh.material.dispose();
  }
 }
});
test('landscape and reduced motion preserve the base shot and pause preserves helper state',()=>{
 assert.equal(typeof api.KickCamera,'function');const shot=new api.KickCamera(),p=params(16/9);
 p.vehicleBox=new THREE.Box3(new THREE.Vector3(-7,3,6),new THREE.Vector3(-4,6,11));
 const desired=p.desired.clone(),target=p.target.clone();assert.equal(shot.adjust(p),p.fov);assert.ok(p.desired.equals(desired));assert.ok(p.target.equals(target));
 p.camera.aspect=390/844;p.reducedMotion=true;shot.adjust(p);assert.ok(p.desired.equals(desired));
 p.reducedMotion=false;shot.adjust(p);const weight=shot.weight;
 p.paused=true;p.flight=.5;p.delta=1;shot.adjust(p);assert.equal(shot.weight,weight);
 shot.reset();assert.equal(shot.weight,0);
});
test('the impact hold can fit a newly hit truck at delta zero while explicit pause remains frozen',()=>{
 const shot=new api.KickCamera(),p=params(390/844);p.delta=0;p.vehicleBox=new THREE.Box3(new THREE.Vector3(2.6,0,3),new THREE.Vector3(5.2,3,8));
 shot.adjust(p);p.camera.position.copy(p.desired);p.camera.lookAt(p.target);p.camera.updateMatrixWorld(true);
 const box=api.projectBox(p.vehicleBox,p.camera);assert.ok(box.min.x>=-1&&box.max.x<=1,'new impact must fit during game hit-stop');
});
test('portrait retreat preserves the native bicycle wheel separation threshold',async()=>{
 const {readFile}=await import('node:fs/promises');const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
 const bytes=await readFile(new URL('../assets/export/bicycle.glb',import.meta.url));
 const {scene:bike}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 for(const [retreat,center]of [[4.5,[-1.13,1.694,9.225]],[18,[-5,4,10]]]){
 const camera=new THREE.PerspectiveCamera(52,390/844,.1,1500),shot=new api.KickCamera();shot.weight=.66;shot.retreat=retreat;
 const desired=new THREE.Vector3(-1,2.7,-8.2),target=new THREE.Vector3(.6,1,8);
 const vehicleBox=new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...center),new THREE.Vector3(4,4,6));
 camera.fov=shot.adjust({desired,target,fov:52,camera,vehicleBox,heroBox:hero,flight:.25,delta:0});camera.position.copy(desired);camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);bike.updateMatrixWorld(true);
 const centers=['WheelFront','WheelRear'].map(name=>bike.getObjectByName(name).getWorldPosition(new THREE.Vector3()).project(camera));
 const gap=Math.abs(centers[0].x-centers[1].x)*390/2;assert.ok(gap>390*.035,`native wheel gap ${gap}px must exceed13.65px`);
 }
});
test('explicit pause preserves the rendered camera position including the last impact shake',()=>{
 const shot=new api.KickCamera(),p=params(390/844);p.vehicleBox=new THREE.Box3(new THREE.Vector3(-6,1,4),new THREE.Vector3(-3,4,9));
 p.camera.fov=shot.adjust(p);p.camera.position.copy(p.desired);p.camera.position.y+=.0075;p.camera.lookAt(p.target);
 const rendered=p.camera.position.clone();p.paused=true;p.delta=.1;p.desired.set(-1,2.7,-8.2);p.target.set(.6,1,8);
 assert.equal(shot.adjust(p),p.camera.fov);assert.ok(p.desired.equals(rendered),'pause must retain the exact rendered shaken position');
});
