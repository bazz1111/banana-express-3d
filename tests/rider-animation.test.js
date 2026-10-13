import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const api=await import('../src/riderAnimation.js').catch(()=>({}));
const game=(extra={})=>({phase:'riding',stance:'seated',kickPose:0,charge:0,jumpHeight:0,jumpVelocity:0,lateralSpeed:0,events:[],...extra});
test('rider state prioritizes strikes, charge, flight and collision for both sides',()=>{
  assert.equal(typeof api.riderState,'function','missing rider state machine');
  for(const [input,want] of [[{},'seated'],[{stance:'standing'},'standing'],[{phase:'ready'},'idle'],[{jumpHeight:1,jumpVelocity:2},'jumpTakeoff'],[{jumpHeight:1,jumpVelocity:-2},'jumpAir'],[{charge:1,kickSide:-1},'kickChargeL'],[{charge:1,kickSide:1},'kickChargeR'],[{kickPose:.5,kickSide:-1,charge:1},'kickStrikeL'],[{kickPose:.5,kickSide:1},'kickStrikeR'],[{phase:'finished',endReason:'collision'},'crash']])assert.equal(api.riderState(game(input)),want);
});
test('mixer follows crank phase, freezes on pause and resets without stale transition weights',()=>{
  assert.equal(typeof api.RiderAnimator,'function','missing mixer');
  const root=new THREE.Group(),head=new THREE.Bone();head.name='DEF-Head';root.add(head);
  const clip=name=>new THREE.AnimationClip(name,1,[new THREE.NumberKeyframeTrack('DEF-Head.position[x]',[0,1],[0,.1])]);
  const a=new api.RiderAnimator(root,['Rider_Ride_SeatedPedal','Rider_Idle_Ready','Rider_Ride_StandingBalance','Rider_Trans_SitToStand','Rider_Trans_StandToSit','Rider_Jump_Land','Rider_Jump_Air'].map(clip));
  a.update(game(),.1,Math.PI);assert.ok(Math.abs(a.actions.Rider_Ride_SeatedPedal.time-.5)<1e-6);
  const before=head.position.clone(),time=a.mixer.time;a.update(game({phase:'paused'}),.3,5);assert.equal(a.mixer.time,time);assert.ok(head.position.equals(before));
  a.update(game({stance:'standing'}),.01,0);assert.equal(a.state,'sitToStand');a.update(game({stance:'standing'}),.4,0);assert.equal(a.state,'standing');
  a.reset();a.update(game(),0,0);assert.equal(a.state,'seated');assert.equal(a.actions.Rider_Ride_StandingBalance.getEffectiveWeight(),0);
});

test('actual exported skin preserves pedal and grip contacts after mixer and both kick overlays',async()=>{
  const {readFile}=await import('node:fs/promises');const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const {ridingJoints,standingJoints,armJoints,kickJoints}=await import('../src/view.js');
  const bytes=await readFile(new URL('../assets/export/riderSkinned.glb',import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const a=new api.RiderAnimator(gltf.scene,gltf.animations);
  for(const standing of [false,true])for(const angle of [0,.8,2.9]){
    a.update(game({stance:standing?'standing':'seated'}),.1,angle);
    const torso={position:new THREE.Vector3(0,standing?1.86:1.30,standing?-.04:-.22),quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),standing?0:.98)};
    const legs=[-1,1].map(s=>standing?standingJoints(s):ridingJoints(s,angle)),arms=[-1,1].map(s=>armJoints(s,torso.position,torso.quaternion,standing?1:0,0));
    a.applyContactPose({torso,legs,arms});
    for(const [i,s] of [-1,1].entries()){
      const tag=i?'R':'L',foot=a.bones['Foot_'+tag].getWorldPosition(new THREE.Vector3());
      const expected=standing?(i?new THREE.Vector3(.04,1.233,-.21):new THREE.Vector3(-.30,1.311,.58)):new THREE.Vector3(s*.21,.538-s*.18*Math.cos(angle),-.035-s*.18*Math.sin(angle));
      assert.ok(foot.distanceTo(expected)<1e-5,`${tag} foot drift ${foot.distanceTo(expected)}`);
      if(!standing)assert.ok(a.bones['Hand_'+tag].getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(s*.36,1.20,.50))<1e-5);
      const kick=kickJoints(s,1,legs[i]);const kicked=legs.map((l,j)=>j===i?{...l,...kick}:l);a.applyContactPose({torso,legs:kicked,arms});
      const kickedFoot=a.bones['Foot_'+tag].getWorldPosition(new THREE.Vector3());assert.ok(s*(kickedFoot.x-legs[i].hip.x)>.9,'kick must extend from current hip');
      a.applyContactPose({torso,legs,arms});
    }
  }
  let meshes=0;gltf.scene.traverse(o=>{if(o.isSkinnedMesh){meshes++;for(let i=0;i<o.geometry.attributes.position.count;i+=23){const v=o.getVertexPosition(i,new THREE.Vector3());assert.ok(Number.isFinite(v.length()));}}});assert.equal(meshes,1);
});

test('strike animation phase follows game kick timer instead of render frame accumulation',()=>{
  const root=new THREE.Group(),head=new THREE.Bone();head.name='DEF-Head';root.add(head);
  const clip=new THREE.AnimationClip('Rider_Kick_Strike_R',.7,[new THREE.NumberKeyframeTrack('DEF-Head.position[x]',[0,.7],[0,.7])]);
  const a=new api.RiderAnimator(root,[clip]);a.update(game({kickPose:.56,kickSide:1}),.1,0);
  assert.ok(Math.abs(head.position.x-.14)<1e-6);a.update(game({kickPose:.35,kickSide:1}),.01,0);assert.ok(Math.abs(head.position.x-.35)<1e-6);
});

test('a strike interrupts the stance transition without leaving its hold timer behind',()=>{
  const root=new THREE.Group();const names=['Rider_Ride_SeatedPedal','Rider_Ride_StandingBalance','Rider_Trans_SitToStand','Rider_Kick_Strike_R'];
  const a=new api.RiderAnimator(root,names.map(n=>new THREE.AnimationClip(n,1,[])));
  a.update(game(),0);a.update(game({stance:'standing'}),.01);assert.equal(a.state,'sitToStand');
  a.update(game({stance:'standing',kickPose:.01,kickSide:1}),.01);a.update(game({stance:'standing'}),.02);assert.equal(a.state,'standing');
});

test('authored 0.35 second stance transitions keep adjacent bone rotations below 15 degrees',async()=>{
  const {readFile}=await import('node:fs/promises');const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');const bytes=await readFile(new URL('../assets/export/riderSkinned.glb',import.meta.url));const g=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const mixer=new THREE.AnimationMixer(g.scene),bones=[];g.scene.traverse(o=>{if(o.isBone)bones.push(o);});
  for(const clip of g.animations.filter(c=>c.name.includes('Trans'))){mixer.stopAllAction();const action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();let previous;
    for(let frame=0;frame<=21;frame++){mixer.setTime(frame/60);if(previous)bones.forEach((bone,i)=>assert.ok(bone.quaternion.angleTo(previous[i])<Math.PI/12,`${clip.name} ${bone.name} frame${frame}`));previous=bones.map(b=>b.quaternion.clone());}
  }
});

test('shield action receives consumed game events through the view event hook',()=>{
  const a=new api.RiderAnimator(new THREE.Group(),['Rider_Ride_SeatedPedal','Rider_Hit_Shield'].map(n=>new THREE.AnimationClip(n,.4,[])));
  a.update(game(),0);assert.equal(typeof a.events,'function');a.events([{type:'shield',id:'truck'}]);a.update(game(),.01);assert.equal(a.state,'shield');a.update(game(),.4);assert.equal(a.state,'seated');
});
