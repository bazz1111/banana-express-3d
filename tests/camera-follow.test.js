import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const api=await import('../src/cameraFollow.js').catch(()=>({}));
const setup=()=>{const camera=new THREE.PerspectiveCamera(52,16/9,.1,1500),follow=new api.CameraFollow();follow.update(camera,new THREE.Vector3(-1.6,2.25,-3.9),new THREE.Vector3(1.5,.8,6),52,0);return {camera,follow};};
test('side changes and sudden kick framing are bounded across position, rotation and lens',()=>{
 assert.equal(typeof api.CameraFollow,'function');const {camera,follow}=setup();
 for(const dt of [1/120,1/60,1/30,.1]){
  const before=camera.position.clone(),q=camera.quaternion.clone(),fov=camera.fov;
  follow.update(camera,new THREE.Vector3(4.2,3,-9),new THREE.Vector3(-3,3,3),85,dt);
  assert.ok(camera.position.distanceTo(before)<=12*dt+1e-8);
  assert.ok(camera.quaternion.angleTo(q)<=1.8*dt+1e-6);
  assert.ok(Math.abs(camera.fov-fov)<=60*dt+1e-8);
 }
});
test('paused framing cannot drift, repeated transitions converge and reset may establish a new shot',()=>{
 assert.equal(typeof api.CameraFollow,'function');const {camera,follow}=setup(),p=camera.position.clone(),q=camera.quaternion.clone();
 follow.update(camera,new THREE.Vector3(4,5,-10),new THREE.Vector3(-2,2,5),80,0);
 assert.ok(camera.position.equals(p));assert.ok(camera.quaternion.equals(q));assert.equal(camera.fov,52);
 const target=new THREE.Vector3(1.6,2.7,-7.2),look=new THREE.Vector3(-1.2,1,6);
 for(let i=0;i<240;i++)follow.update(camera,target,look,58,1/60);
 assert.ok(camera.position.distanceTo(target)<.001);assert.ok(Math.abs(camera.fov-58)<.001);
 follow.reset();follow.update(camera,p,look,52,0);assert.ok(camera.position.equals(p));assert.equal(camera.fov,52);
});
test('anticipated truck envelope includes current and future silhouettes without mutating the live pose',async()=>{
 const {anticipatedSupport}=await import('../src/kickCamera.js');
 const points=[new THREE.Vector3(-1,0,-2),new THREE.Vector3(1,3,2)],matrix=new THREE.Matrix4().makeTranslation(2,0,5),original=matrix.clone();
 const support=anticipatedSupport(points,matrix,new THREE.Vector3(0,1.3,0),new THREE.Vector3(5,7,6),new THREE.Vector3(1.2,0,5.5));
 assert.equal(support.length,4);assert.ok(matrix.equals(original));
 assert.ok(support[0].equals(points[0].clone().applyMatrix4(matrix)));assert.ok(support[2].equals(points[1].clone().applyMatrix4(matrix)));
 assert.ok(support[1].distanceTo(support[0])>.5);assert.ok(support[3].distanceTo(support[2])>.5);
 assert.ok(support.every(p=>p.toArray().every(Number.isFinite)));
});
