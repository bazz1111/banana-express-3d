import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MixamoRiderAnimator } from '../src/mixamoRiderAnimation.js';
import { createGame, advance } from '../src/game.ts';
const api=await import('../src/riderAnimation.js').catch(()=>({}));
const game=(extra={})=>({phase:'riding',stance:'seated',kickPose:0,charge:0,jumpHeight:0,jumpVelocity:0,lateralSpeed:0,events:[],...extra});

async function exportedModel(file) {
  const { readFile } = await import('node:fs/promises');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const bytes = await readFile(file), size = bytes.readUInt32LE(12), document = JSON.parse(bytes.subarray(20, 20 + size));
  // Node has no browser image decoder. Preserve all real geometry, joints and
  // Actions; native tests independently compare the original packed JPEG bytes.
  document.materials = [{ pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: .85 } }];
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) primitive.material = 0;
  delete document.images; delete document.textures; delete document.samplers;
  const text = Buffer.from(JSON.stringify(document)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(padded);
  const binary = bytes.subarray(20 + size), packed = Buffer.alloc(20 + padded.length + binary.length);
  packed.writeUInt32LE(0x46546c67, 0); packed.writeUInt32LE(2, 4); packed.writeUInt32LE(packed.length, 8);
  packed.writeUInt32LE(padded.length, 12); packed.writeUInt32LE(0x4e4f534a, 16); padded.copy(packed, 20); binary.copy(packed, 20 + padded.length);
  return new GLTFLoader().parseAsync(packed.buffer, '');
}
const riderFile = () => process.env.BANANA_RIDER_GLB ?? new URL('../assets/export/riderSkinned.glb', import.meta.url);
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
  const rider = await exportedModel(riderFile());
  const bicycle = await exportedModel(process.env.BANANA_BICYCLE_GLB ?? new URL('../assets/export/bicycle.glb', import.meta.url));
  const world = new THREE.Group(); world.position.set(4, 2, -3); world.rotation.y = .3; world.add(rider.scene, bicycle.scene);
  world.updateMatrixWorld(true);
  const a = new MixamoRiderAnimator(rider.scene, rider.animations, bicycle.scene), bones = [], skins = [];
  rider.scene.traverse(o => { if (o.isBone) bones.push(o); if (o.isSkinnedMesh) skins.push(o); });
  assert.equal(bones.length, 65); assert.equal(skins.length, 1); assert.equal(rider.animations.length, 16);
  const offsets = new Map(bones.map(bone => [bone, bone.position.clone()]));
  const position = object => rider.scene.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
  const crank = bicycle.scene.getObjectByName('Crank'), pedals = ['L', 'R'].map(tag => bicycle.scene.getObjectByName('Pedal_' + tag));
  const spin = angle => { crank.rotation.x = angle; for (const pedal of pedals) pedal.rotation.x = -angle; world.updateMatrixWorld(true); };
  const contact = (part, tag, target) => assert.ok(position(rider.scene.getObjectByName(part + '_' + tag))
    .distanceTo(position(bicycle.scene.getObjectByName(target + '_' + tag))) < .005, `${part}_${tag} missed real ${target}_${tag}`);
  for (const stance of ['seated', 'standing']) for (const angle of [0, .8, 2.9, 4.8]) {
    a.reset(); spin(angle); a.update(game({ phase: 'ready', stance }), 0, angle); a.applyContactPose({});
    for (const tag of ['L', 'R']) {
      contact('Sole', tag, stance === 'standing' ? 'RiderStand' : 'RiderPedal');
      if (stance === 'seated') contact('Palm', tag, 'RiderGrip');
    }
    for (const kickSide of [-1, 1]) {
      a.update(game({ phase: 'racing', stance, kickPose: .35, kickSide }), 0, angle); a.applyContactPose({});
      const kicking = kickSide > 0 ? 'L' : 'R', support = kicking === 'L' ? 'R' : 'L', sign = kicking === 'L' ? -1 : 1;
      const hip = position(a.bones['Leg_' + kicking]), foot = position(a.bones['Foot_' + kicking]);
      assert.ok(sign * (foot.x - hip.x) > .6, 'Tripo strike did not extend from its real hip');
      contact('Sole', support, stance === 'standing' ? 'RiderStand' : 'RiderPedal');
      for (const bone of bones) if (bone !== a.bones.BalanceBody) assert.ok(bone.position.distanceTo(offsets.get(bone)) < 1e-4, bone.name + ' stretched');
    }
    const before = bones.flatMap(bone => bone.matrixWorld.elements);
    a.update(game({ phase: 'paused', stance }), 3, 8); a.applyContactPose({});
    assert.ok(bones.flatMap(bone => bone.matrixWorld.elements).every((value, index) => Math.abs(value - before[index]) < 1e-7), 'Pause moved the actual skin');
  }
  for (const mesh of skins) for (let i = 0; i < mesh.geometry.attributes.position.count; i += 23) assert.ok(Number.isFinite(mesh.getVertexPosition(i, new THREE.Vector3()).length()));
});

test('all real clips keep contacts and continuous joints through quick stance reversals and pause', async t => {
  const rider = await exportedModel(riderFile());
  const bike = await exportedModel(process.env.BANANA_BICYCLE_GLB ?? new URL('../assets/export/bicycle.glb', import.meta.url));
  const world = new THREE.Group(); world.add(rider.scene, bike.scene); world.updateMatrixWorld(true);
  const a = new MixamoRiderAnimator(rider.scene, rider.animations, bike.scene), bones = [...a.rest.keys()];
  assert.equal(rider.animations.length, 16); assert.equal(bones.length, 65);
  const reports = [];
  for (const initial of ['seated', 'standing']) for (const mode of ['hold', 'single', 'reverse', 'repeated']) {
    const opposite = initial === 'seated' ? 'standing' : 'seated';
    const segments = mode === 'hold' ? [[initial, 30]] : mode === 'single' ? [[opposite, 30]] :
      mode === 'repeated' ? [[opposite, 2], [initial, 3], [opposite, 4], [initial, 30]] : [[opposite, 2], [initial, 30]];
    a.reset(); a.update(game({ phase: 'ready', stance: initial }), 0, 0); a.applyContactPose();
    let previous = bones.map(bone => bone.quaternion.clone()), maxAngle = 0, maxContact = 0, worst = '';
    for (const [stance, frames] of segments) for (let frame = 0; frame < frames; frame++) {
      const input = game({ phase: 'racing', stance }); a.update(input, 1 / 60, 0); a.applyContactPose();
      for (const [index, bone] of bones.entries()) {
        const angle = bone.quaternion.angleTo(previous[index]) * 180 / Math.PI;
        if (angle > maxAngle) { maxAngle = angle; worst = `${bone.name}, ${stance}, frame ${frame}, ${a.state}`; }
      }
      maxContact = Math.max(maxContact, ...a.contactErrors.map(contact => contact.error));
      previous = bones.map(bone => bone.quaternion.clone());
      if (frame === 1) {
        const matrices = bones.flatMap(bone => bone.matrixWorld.elements);
        const timers = [a.mixer.time, a.hold, a.stanceElapsed, a.stanceBlend, a.stateTime];
        a.update({ ...input, phase: 'paused' }, 5, 2); a.applyContactPose();
        assert.deepEqual(bones.flatMap(bone => bone.matrixWorld.elements), matrices, 'Paused reversal moved the actual skin');
        assert.deepEqual([a.mixer.time, a.hold, a.stanceElapsed, a.stanceBlend, a.stateTime], timers, 'Paused reversal advanced animation clocks');
      }
    }
    reports.push({ initial, mode, maxAngle, maxContact, worst });
    const finalStance = mode === 'single' ? opposite : initial;
    assert.equal(a.state, finalStance); assert.equal(a.stanceBlend, finalStance === 'standing' ? 1 : 0);
  }
  t.diagnostic(JSON.stringify(reports));
  for (const report of reports) {
    assert.ok(report.maxAngle < 15, `Quick reversal snapped: ${JSON.stringify(report)}`);
    assert.ok(report.maxContact < .005, `Quick reversal lost contact: ${JSON.stringify(report)}`);
  }
});

test('real charged kick keeps its preselected leg when a distant vehicle enters release range', async t => {
  const rider = await exportedModel(riderFile());
  const bike = await exportedModel(process.env.BANANA_BICYCLE_GLB ?? new URL('../assets/export/bicycle.glb', import.meta.url));
  const world = new THREE.Group(); world.add(rider.scene, bike.scene); world.updateMatrixWorld(true);
  const a = new MixamoRiderAnimator(rider.scene, rider.animations, bike.scene), bones = [...a.rest.keys()], reports = [];
  assert.equal(rider.animations.length, 16);
  for (const stance of ['seated', 'standing']) for (const side of [-1, 1]) {
    const g = createGame({ mode: 'endless', seed: 137, chunkLength: 80, lookAhead: 480, procedural: false,
      obstacles: [{ id: 'distant-truck', type: 'truck', s: 18.5, lane: side * 2 }] });
    Object.assign(g, { phase: 'racing', stance, speed: 12, kickSide: -side });
    a.reset(); a.update(game({ phase: 'ready', stance }), 0, 0); a.applyContactPose();
    const chargeSides = [];
    for (let frame = 0; frame < 48; frame++) {
      advance(g, { kick: true }, 1 / 60); a.update(g, 1 / 60, 0); a.applyContactPose(); chargeSides.push(g.kickSide);
    }
    const chargedState = a.state, previous = bones.map(bone => bone.quaternion.clone());
    const feet = a.chains.map(chain => chain.sole.object.getWorldPosition(new THREE.Vector3()));
    advance(g, {}, 1 / 60); a.update(g, 1 / 60, 0); a.applyContactPose();
    const maxAngle = Math.max(...bones.map((bone, index) => bone.quaternion.angleTo(previous[index]) * 180 / Math.PI));
    const maxFootMove = Math.max(...a.chains.map((chain, index) => chain.sole.object.getWorldPosition(new THREE.Vector3()).distanceTo(feet[index])));
    const report = { stance, side, chargedState, strikeState: a.state, maxAngle, maxFootMove }; reports.push(report);
    assert.equal(g.obstacles[0].kicked, true); assert.equal(g.cooldowns.kick, 8);
    assert.ok(maxAngle < 15, `Release switched the charged leg: ${JSON.stringify(report)}`);
    assert.ok(maxFootMove < .025, `Release snapped a foot: ${JSON.stringify(report)}`);
    assert.ok(chargeSides.every(value => value === side), 'Wind-up selected the wrong side before the target reached 9m');
    assert.equal(chargedState, side > 0 ? 'kickChargeR' : 'kickChargeL');
    assert.equal(a.state, side > 0 ? 'kickStrikeR' : 'kickStrikeL');
  }
  t.diagnostic(JSON.stringify(reports));
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
  const g=await exportedModel(riderFile());
  const mixer=new THREE.AnimationMixer(g.scene),bones=[];g.scene.traverse(o=>{if(o.isBone)bones.push(o);});
  for(const clip of g.animations.filter(c=>c.name.includes('Trans'))){mixer.stopAllAction();const action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();let previous;
    for(let frame=0;frame<=21;frame++){mixer.setTime(frame/60);if(previous)bones.forEach((bone,i)=>assert.ok(bone.quaternion.angleTo(previous[i])<Math.PI/12,`${clip.name} ${bone.name} frame${frame}`));previous=bones.map(b=>b.quaternion.clone());}
  }
});

test('shield action receives consumed game events through the view event hook',()=>{
  const a=new api.RiderAnimator(new THREE.Group(),['Rider_Ride_SeatedPedal','Rider_Hit_Shield'].map(n=>new THREE.AnimationClip(n,.4,[])));
  a.update(game(),0);assert.equal(typeof a.events,'function');a.events([{type:'shield',id:'truck'}]);a.update(game(),.01);assert.equal(a.state,'shield');a.update(game(),.4);assert.equal(a.state,'seated');
});
