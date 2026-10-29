import test from 'node:test';
import assert from 'node:assert/strict';
import {loadNativeGlb} from './fixtures/load-native-glb.js';
const api=await import('../src/obstacleAnimation.js').catch(()=>({}));
const state=(more={})=>({type:'goat',travel:0,velocityS:0,velocityLane:0,heading:0,...more});
test('native stationary animals keep the authored stance and moving gait follows distance',async()=>{
 assert.equal(typeof api.ObstacleAnimator,'function');
 for(const type of ['goat','pedestrian']){
  const a=(await loadNativeGlb(new URL(`../assets/export/${type}.glb`,import.meta.url))).scene;
  const anim=new api.ObstacleAnimator(a,type);const legs=anim.legs;assert.equal(legs.length,type==='goat'?4:2);
  for(let i=0;i<120;i++)anim.update(state({type}),1/60);
  assert.ok(legs.every(l=>l.node.quaternion.angleTo(l.rest)<1e-9));
  anim.update(state({type,travel:.17,velocityS:.6}),1/60);
  assert.ok(legs.some(l=>l.node.quaternion.angleTo(l.rest)>.02));
  const angles=legs.map(l=>l.node.quaternion.clone());
  // The same distance at a different presentation time must not change phase.
  anim.update(state({type,travel:.17,velocityS:.6}),.1);
  assert.ok(legs.every((l,i)=>l.node.quaternion.equals(angles[i])));
  const stopped=state({type,travel:.17});for(let i=0;i<60;i++)anim.update(stopped,1/60);
  assert.ok(legs.every(l=>l.node.quaternion.angleTo(l.rest)<.0001));
  anim.reset();assert.ok(legs.every(l=>l.node.quaternion.angleTo(l.rest)<1e-8));
 }
});
test('goat uses four distinct foot phases and heading follows the actual road-coordinate velocity',async()=>{
 assert.equal(typeof api.ObstacleAnimator,'function');
 const {scene}=await loadNativeGlb(new URL('../assets/export/goat.glb',import.meta.url));const a=new api.ObstacleAnimator(scene,'goat');
 const pose=a.update(state({travel:.12,velocityLane:.7,heading:-Math.PI/2}),1/60);
 assert.equal(pose.heading,-Math.PI/2,'Positive lane travels towards world -X');
 assert.equal(new Set(a.legs.map(l=>l.phase)).size,4);
 const before=pose.heading;const turned=a.update(state({travel:.14,velocityS:.7,heading:0}),1/60);
 assert.ok(turned.heading>before&&turned.heading<0,'Changing direction blends along the shortest arc');
 const frozen=a.update(state({travel:.14,velocityS:.7,heading:Math.PI}),0);assert.equal(frozen.heading,turned.heading);
 for(let i=0;i<60;i++){
  const p=a.update(state({travel:i*.01,velocityS:.6}),1/60);
  assert.ok(p.lift>=0&&p.lift<.12,'Foot correction must remain small');
 }
});
test('truck tandem rear axle meshes retain their authored pose instead of rotating the entire pair',async()=>{
 const {scene}=await loadNativeGlb(new URL('../assets/export/truck.glb',import.meta.url)),a=new api.ObstacleAnimator(scene,'truck');
 const rear=['TruckPart_Wheel_RL','TruckPart_Wheel_RR'].map(n=>scene.getObjectByName(n));const before=rear.map(o=>o.quaternion.clone());
 a.update({travel:2.37,velocityS:1.6,heading:0},1/60);
 assert.ok(rear.every((o,i)=>o.quaternion.equals(before[i])),'Rear meshes contain two tires and cannot rotate around their midpoint');
 assert.equal(scene.getObjectByName('TruckPart_Wheel_FL').rotation.x,0,'Tripo front tires also include irregular geometry; preserve them until axle cleanup');
});
