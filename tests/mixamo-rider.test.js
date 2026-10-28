import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

import { MixamoRiderAnimator } from '../src/mixamoRiderAnimation.js';
// Node has no image decoder. Keep the real Tripo geometry, skin and transforms;
// remove only texture declarations at the platform boundary.
const original = await readFile(new URL('../assets/sources/banana-tripo-v1/hero-rigged.glb', import.meta.url));
const jsonSize = original.readUInt32LE(12), document = JSON.parse(original.subarray(20, 20 + jsonSize));
document.materials = [{ pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: .85 } }];
for (const mesh of document.meshes) for (const primitive of mesh.primitives) primitive.material = 0;
delete document.images; delete document.textures; delete document.samplers;
const text = Buffer.from(JSON.stringify(document)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
text.copy(padded);
const binary = original.subarray(20 + jsonSize), packed = Buffer.alloc(20 + padded.length + binary.length);
packed.writeUInt32LE(0x46546c67, 0); packed.writeUInt32LE(2, 4); packed.writeUInt32LE(packed.length, 8);
packed.writeUInt32LE(padded.length, 12); packed.writeUInt32LE(0x4e4f534a, 16);
padded.copy(packed, 20); binary.copy(packed, 20 + padded.length);
const source = await new GLTFLoader().parseAsync(packed.buffer, '');
const factor = 1.85 / .9769089818000793;
const bone = (root, name) => root.getObjectByName('mixamorig' + name);
const game = extra => ({ phase: 'racing', stance: 'seated', kickPose: 0, kickSide: 1, charge: 0,
  jumpHeight: 0, jumpVelocity: 0, lateralSpeed: 0, events: [], ...extra });
const point = (root, object) => root.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
const snapshot = root => {
  root.updateWorldMatrix(true, true);
  const values = [];
  root.traverse(o => { if (o.isBone) values.push(...o.matrixWorld.elements); });
  return values;
};
function fixture(contacts = {}, clips = []) {
  const root = new THREE.Group(), model = cloneSkeleton(source.scene);
  model.scale.setScalar(factor); root.add(model); root.updateWorldMatrix(true, true);
  const marker = (name, bone, position, quaternion = new THREE.Quaternion()) => {
    const object = new THREE.Object3D(); object.name = name;
    const matrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
    matrix.premultiply(root.matrixWorld).premultiply(bone.matrixWorld.clone().invert());
    matrix.decompose(object.position, object.quaternion, object.scale); bone.add(object);
  };
  for (const [tag, anatomical, sole] of [
    ['L', 'Right', [-.1575567573, .0017586248, -.0067129475]],
    ['R', 'Left', [.1535351723, .0016327676, -.0101736886]],
  ]) {
    const foot = bone(root, anatomical + 'Foot');
    const toe = bone(root, anatomical + 'Toe_End');
    const direction = point(root, toe).sub(point(root, foot)); direction.y = 0; direction.normalize();
    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    marker(`Sole_${tag}`, foot, new THREE.Vector3(...sole).multiplyScalar(factor), orientation);
    const hand = bone(root, anatomical + 'Hand');
    const knuckles = ['Index', 'Middle', 'Ring', 'Pinky'].map(finger => point(root, bone(root, anatomical + 'Hand' + finger + '1')));
    const center = knuckles.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(.25);
    const along = center.clone().sub(point(root, hand)).normalize(), across = knuckles[0].clone().sub(knuckles[3]).normalize();
    const normal = along.clone().cross(across).normalize();
    if (normal.z < 0) normal.negate();
    across.copy(normal).cross(along).normalize();
    const palmFrame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal, along));
    marker(`Palm_${tag}`, hand, point(root, hand).lerp(center, .5), palmFrame);
  }
  const hips = bone(root, 'Hips');
  // Actual rest-mesh buttock vertex 2186, measured independently in headless Blender.
  marker('SeatContact', hips, new THREE.Vector3(.00286766584, .48176324368, -.03919110447).multiplyScalar(factor));
  root.updateWorldMatrix(true, true);
  return { root, animator: new MixamoRiderAnimator(root, clips, contacts) };
}

test('actual Tripo skin reaches both pedals throughout the crank cycle and both standing supports', () => {
  const { root, animator: a } = fixture();
  for (const stance of ['seated', 'standing']) for (const angle of [0, .8, 2.9, 4.8]) {
    a.update(game({ phase: 'ready', stance }), 0, angle);
    a.applyContactPose({ legs: [{ upper: new THREE.Quaternion() }], arms: [] });
    for (const [i, side] of [-1, 1].entries()) {
      const expected = stance === 'standing' ? (i ? [.04, 1.115, -.21] : [-.30, 1.193, .58]) :
        [side * .21, .4 - side * .18 * Math.cos(angle), .04 - side * .18 * Math.sin(angle)];
      const actual = point(root, root.getObjectByName(`Sole_${i ? 'R' : 'L'}`));
      assert.ok(actual.distanceTo(new THREE.Vector3(...expected)) < 1e-4,
        `${stance}, ${angle}, ${side}: sole ${actual.toArray()} missed ${expected}; ${JSON.stringify(a.contactErrors)}`);
      if (stance === 'seated') {
        const palm = point(root, root.getObjectByName(`Palm_${i ? 'R' : 'L'}`));
        assert.ok(palm.distanceTo(new THREE.Vector3(side * .36, 1.2, .5)) < 1e-4,
          `palm ${palm.toArray()} must reach the grip; ${JSON.stringify(a.contactErrors)}`);
      }
    }
  }
});

test('IK preserves actual child offsets, bone lengths, scales and the Tripo visible mesh', () => {
  const { root, animator: a } = fixture(), rest = new Map(), skins = [];
  root.traverse(o => { if (o.isBone) rest.set(o, { p: o.position.clone(), s: o.scale.clone(),
    length: o.parent.isBone ? point(root, o).distanceTo(point(root, o.parent)) : null }); if (o.isSkinnedMesh) skins.push(o); });
  assert.equal(rest.size, 65); assert.equal(skins.length, 1);
  const geometry = skins[0].geometry;
  for (const stance of ['seated', 'standing']) for (const kickSide of [-1, 1]) {
    a.update(game({ phase: 'ready', stance, kickSide, kickPose: .35 }), 0, 2.1); a.applyContactPose({});
    for (const [bone, before] of rest) {
      if (bone !== a.bones.BalanceBody) assert.ok(bone.position.distanceTo(before.p) < 1e-7, bone.name + ' was stretched');
      assert.ok(bone.scale.distanceTo(before.s) < 1e-7, bone.name + ' changed scale');
      if (before.length !== null) assert.ok(Math.abs(point(root, bone).distanceTo(point(root, bone.parent)) - before.length) < 1e-5,
        bone.name + ' changed its world-space bone length');
    }
    assert.equal(skins[0].geometry, geometry);
    for (let i = 0; i < geometry.attributes.position.count; i += 97) {
      assert.ok(Number.isFinite(skins[0].getVertexPosition(i, new THREE.Vector3()).length()));
    }
  }
});

test('pause and same-time repeated contact solving are idempotent', () => {
  const { root, animator: a } = fixture(), g = game({ charge: .8, lateralSpeed: 2 });
  a.update(g, .1, 1.4); a.applyContactPose({});
  const before = snapshot(root);
  for (let i = 0; i < 50; i++) { a.update(g, 0, 1.4); a.applyContactPose({}); }
  assert.ok(snapshot(root).every((n, i) => Math.abs(n - before[i]) < 1e-7), 'same-time pose accumulated IK');
  a.update({ ...g, phase: 'paused' }, 10, 5); a.applyContactPose({});
  assert.ok(snapshot(root).every((n, i) => Math.abs(n - before[i]) < 1e-7), 'pause moved the skin');
  a.reset(); a.update(game({ phase: 'ready' }), 0, 0); a.applyContactPose({});
  assert.equal(a.state, 'idle'); assert.equal(a.previousStance, 'seated');
});

test('opposite rule kick directions select the expected physical leg without stretching it', () => {
  const { root, animator: a } = fixture();
  for (const kickSide of [-1, 1]) {
    a.update(game({ phase: 'ready', kickSide, kickPose: .35 }), 0, 0); a.applyContactPose({});
    const tag = kickSide > 0 ? 'L' : 'R', side = kickSide > 0 ? -1 : 1;
    const hip = point(root, a.bones[`Leg_${tag}`]), foot = point(root, a.bones[`Foot_${tag}`]);
    assert.ok(side * (foot.x - hip.x) > .7, 'strike must extend towards the rule-selected side');
  }
});

test('actual finger joints grip in seated poses and open for standing balance', () => {
  const { animator: a } = fixture();
  const finger = bone(a.root, 'RightHandIndex2');
  a.update(game({ phase: 'ready' }), 0, 0); a.applyContactPose({}); const curled = finger.quaternion.clone();
  a.update(game({ phase: 'ready', stance: 'standing' }), 0, 0); a.applyContactPose({});
  assert.ok(curled.angleTo(finger.quaternion) > .2, 'fingers stayed frozen across grip and balance');
});

test('new bike contact markers override fallback coordinates and follow this frame of pedal motion', () => {
  const bike = new THREE.Group(), pedal = new THREE.Object3D();
  pedal.name = 'RiderPedal_L'; pedal.position.set(-.21, .58, .04); bike.add(pedal);
  const { root, animator: a } = fixture(bike), world = new THREE.Group(); world.add(root, bike);
  world.updateMatrixWorld(true);
  a.update(game({ phase: 'ready' }), 0, 0); a.applyContactPose({});
  pedal.position.y += .035;
  a.update(game({ phase: 'ready' }), 0, 0); a.applyContactPose({});
  assert.ok(point(root, root.getObjectByName('Sole_L')).distanceTo(new THREE.Vector3(-.21, .615, .04)) < 1e-4,
    'contact solver used the previous render frame of the bike');
});

test('short-bike standing targets use the actual leg reach and preserve an explicit pelvis override', () => {
  const contacts = { standing: [[-.30, 1.03, .282], [.04, .94, -.264]],
    seat: [0, .944, -.264], grips: [[-.30, 1.03, .282], [.30, 1.07, .282]] };
  const { root, animator: a } = fixture(contacts);
  a.update(game({ phase: 'ready', stance: 'standing' }), 0, 0); a.applyContactPose({});
  const reaches = a.chains.map(chain => {
    const [upper, lower, foot] = chain.leg;
    return point(root, upper).distanceTo(point(root, foot)) /
      (point(root, upper).distanceTo(point(root, lower)) + point(root, lower).distanceTo(point(root, foot)));
  });
  assert.ok(Math.abs(Math.max(...reaches) - .90) < 1e-5, `standing legs did not use a natural 90% reach: ${reaches}`);
  for (const [index, chain] of a.chains.entries()) {
    assert.ok(point(root, chain.sole.object).distanceTo(new THREE.Vector3(...contacts.standing[index])) < 1e-4);
  }
  const custom = fixture({ ...contacts, pelvisStanding: [0, 1.65, 0] });
  custom.animator.update(game({ phase: 'ready', stance: 'standing' }), 0, 0); custom.animator.applyContactPose({});
  assert.ok(Math.abs(point(custom.root, custom.animator.bones.BalanceBody).y - 1.65) < 1e-6);
});

test('measured pedal top offsets are retained while the platforms counter-rotate', () => {
  const contacts = { seat: [0, .944, -.264], grips: [[-.3, 1.03, .282], [.3, 1.07, .282]],
    pedalCenter: [0, .3144, -.0417], pedalOffsets: [[0, .013, 0], [0, .020, 0]] };
  const { root, animator: a } = fixture(contacts);
  for (const angle of [0, .8, 2.9, 4.8]) {
    a.update(game({ phase: 'ready' }), 0, angle); a.applyContactPose({});
    for (const [index, sign] of [-1, 1].entries()) {
      const expected = new THREE.Vector3(sign * .21, .3144 - sign * .18 * Math.cos(angle) + contacts.pedalOffsets[index][1],
        -.0417 - sign * .18 * Math.sin(angle));
      assert.ok(point(root, root.getObjectByName(`Sole_${index ? 'R' : 'L'}`)).distanceTo(expected) < 1e-4,
        'actual pedal thickness was discarded');
    }
  }
});

test('releasing a charged kick starts from the charged foot pose without a backwards snap', () => {
  const { root, animator: a } = fixture();
  for (const kickSide of [-1, 1]) {
    a.reset();
    a.update(game({ charge: .8, kickSide }), .1, 0); a.applyContactPose({});
    const foot = a.bones[kickSide > 0 ? 'Foot_L' : 'Foot_R'], before = point(root, foot);
    a.update(game({ kickPose: .7, kickSide }), 0, 0); a.applyContactPose({});
    assert.ok(point(root, foot).distanceTo(before) < .025, 'release snapped the leg back to its planted pose');
  }
});

test('seated palms approach the handlebar from above while standing hands can balance open', () => {
  const { root, animator: a } = fixture();
  a.update(game({ phase: 'ready' }), 0, 0); a.applyContactPose({});
  for (const tag of ['L', 'R']) {
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(a.frame(root.getObjectByName('Palm_' + tag)).q);
    assert.ok(normal.y < -.5, 'gripping palm faced upwards instead of towards the handlebar');
  }
});

test('the full 0.35 second stance transition keeps each adjacent joint rotation below 15 degrees', () => {
  for (const contacts of [{}, { seat: [0, .9518, -.2640], grips: [[-.3022, 1.0429, .2819], [.3022, 1.0754, .2819]],
    standing: [[-.3022, 1.0429, .2819], [.04, .9481, -.2640]] }]) {
  const { animator: a } = fixture(contacts);
  for (const reverse of [false, true]) {
    a.reset(); let before;
    for (let frame = 0; frame <= 21; frame++) {
      a.update(game({ stance: reverse ? 'seated' : 'standing' }), frame ? 1 / 60 : 0, 0);
      const weight = (1 - Math.cos(frame / 21 * Math.PI)) / 2;
      a.stanceBlend = reverse ? 1 - weight : weight; a.applyContactPose({});
      const pose = new Map([...a.rest.keys()].map(bone => [bone, bone.quaternion.clone()]));
      if (before) for (const [bone, quaternion] of pose) {
        assert.ok(quaternion.angleTo(before.get(bone)) < Math.PI / 12,
          `${bone.name} jumped ${quaternion.angleTo(before.get(bone)) * 180 / Math.PI} degrees at frame ${frame}`);
      }
      before = pose;
    }
  }
  }
});

test('live contact blending follows the authored 0.35 second stance timing without a first-frame snap', () => {
  const { animator: a } = fixture({ seat: [0, .9518, -.2640], grips: [[-.3022, 1.0429, .2819], [.3022, 1.0754, .2819]],
    standing: [[-.3022, 1.0429, .2819], [.04, .9481, -.2640]] });
  a.update(game({ phase: 'ready' }), 0, 0); a.applyContactPose({});
  let previous = new Map([...a.rest.keys()].map(bone => [bone, bone.quaternion.clone()]));
  for (let frame = 1; frame <= 21; frame++) {
    a.update(game({ stance: 'standing' }), 1 / 60, 0); a.applyContactPose({});
    assert.ok(Math.abs(a.stanceBlend - (1 - Math.cos(frame / 21 * Math.PI)) / 2) < 1e-6, 'Live stance is out of phase with the native transition');
    for (const [bone, before] of previous) assert.ok(bone.quaternion.angleTo(before) < Math.PI / 12, bone.name + ' snapped in live contact blending');
    previous = new Map([...a.rest.keys()].map(bone => [bone, bone.quaternion.clone()]));
  }
});

test('a crash releases the bar and pedals smoothly instead of pinning the falling body', () => {
  const { root, animator: a } = fixture(); let before;
  for (let frame = 0; frame <= 60; frame++) {
    a.update(game({ phase: 'finished', endReason: 'collision' }), frame ? 1 / 60 : 0, 0);
    a.stateTime = frame / 60; a.applyContactPose({});
    const pose = new Map([...a.rest.keys()].map(bone => [bone, bone.quaternion.clone()]));
    if (before) for (const [bone, quaternion] of pose) assert.ok(quaternion.angleTo(before.get(bone)) < Math.PI / 12,
      `${bone.name} snapped ${quaternion.angleTo(before.get(bone)) * 180 / Math.PI} degrees while falling at frame ${frame}`);
    before = pose;
  }
  assert.ok(point(root, root.getObjectByName('Palm_L')).distanceTo(new THREE.Vector3(-.36, 1.2, .5)) > .3,
    'falling hand remained planted on the bar');
  const hip = point(root, a.bones.BalanceBody), head = point(root, a.bones.Head);
  assert.ok(hip.y < .5, 'crash ended in a standing stumble instead of a fall');
  assert.ok(Math.abs(head.y - hip.y) < Math.abs(head.x - hip.x), 'fallen body remained upright');
});

test('a seated authored charge clip cannot force the selected standing stance to sit', () => {
  const spine = bone(source.scene, 'Spine');
  const seated = spine.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .8));
  const clip = name => new THREE.AnimationClip(name, 1, [new THREE.QuaternionKeyframeTrack(spine.name + '.quaternion', [0, 1], [...seated.toArray(), ...seated.toArray()])]);
  const { root, animator: a } = fixture({}, [clip('Rider_Ride_SeatedPedal'), clip('Rider_Kick_Charge_R')]);
  a.update(game({ phase: 'ready', stance: 'standing' }), 0, 0); a.applyContactPose({});
  a.update(game({ stance: 'standing', charge: .8 }), .1, 0); a.applyContactPose({});
  const upperSpine = a.actual('Spine2');
  assert.ok(a.frame(upperSpine).q.angleTo(a.restWorld[upperSpine.name].q) < .02,
    'seated overlay bent the standing rider forward');
  assert.ok(point(root, root.getObjectByName('Sole_R')).distanceTo(new THREE.Vector3(.04, 1.115, -.21)) < 1e-4);
});
