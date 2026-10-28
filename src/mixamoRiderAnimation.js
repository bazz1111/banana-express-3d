import * as THREE from 'three';
import { RiderAnimator, RIDER_CLIPS } from './riderAnimation.js';

export { RIDER_CLIPS };
const V = values => new THREE.Vector3(...values);
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const defaults = {
  seat: [0, 1.115, -.21], pelvisStanding: [0, 1.86, -.04],
  grips: [[-.36, 1.20, .50], [.36, 1.20, .50]],
  standing: [[-.30, 1.193, .58], [.04, 1.115, -.21]],
  pedalCenter: [0, .4, .04], pedalWidth: .21, crankRadius: .18,
};

/** The original 65-joint Tripo skin stays intact. Canonical L/R mean negative/
 * positive actor X, matching the game's existing kick and effect interfaces.
 * Bike marker positions are measured in the actor frame, after bike animation.
 */
export class MixamoRiderAnimator extends RiderAnimator {
  constructor(root, clips, bikeOrContactConfig = {}) {
    super(root, clips);
    this.bike = bikeOrContactConfig.isObject3D ? bikeOrContactConfig : null;
    const authored = root.getObjectByName('BananaTripoHero')?.userData.riderContactConfigJSON;
    const supplied = { ...(authored ? JSON.parse(authored) : {}),
      ...(this.bike ? this.bike.userData.riderContacts ?? {} : bikeOrContactConfig) };
    this.contacts = { ...defaults, ...supplied };
    this.explicitStandingPelvis = supplied.pelvisStanding != null;
    this.measuredStanding = supplied.standing != null;
    this.hasBodyClips = clips.some(clip => clip.name === RIDER_CLIPS.seated);
    // Decompose the scale before extracting rest rotations (the input may have a uniform authoring scale).
    for (const bone of this.rest.keys()) this.restWorld[bone.name] = this.frame(bone);
    // GLTFLoader sanitizes ':' out of node names; the native authoring tree retains it.
    this.actual = name => root.getObjectByName('mixamorig:' + name) ?? root.getObjectByName('mixamorig' + name);
    const hips = this.actual('Hips');
    if (!hips) throw new Error('Tripo rider is missing mixamorig:Hips');
    this.bones.BalanceBody = hips;
    this.bones.Spine = this.actual('Spine'); this.bones.Head = this.actual('Head');
    const anatomical = ['Left', 'Right'].sort((a, b) => this.position(this.actual(a + 'UpLeg')).x - this.position(this.actual(b + 'UpLeg')).x);
    this.chains = anatomical.map((side, i) => {
      const tag = i ? 'R' : 'L';
      const names = { Leg: 'UpLeg', Knee: 'Leg', Foot: 'Foot', Arm: 'Arm', Elbow: 'ForeArm', Hand: 'Hand' };
      for (const [alias, suffix] of Object.entries(names)) {
        const bone = this.actual(side + suffix);
        if (!bone) throw new Error('Tripo rider is missing ' + side + suffix);
        this.bones[alias + '_' + tag] = bone;
      }
      const sole = this.marker('Sole_' + tag, this.bones['Foot_' + tag]);
      const palm = this.marker('Palm_' + tag, this.bones['Hand_' + tag]);
      return { side, tag, sign: i ? 1 : -1, sole, palm,
        leg: [this.bones['Leg_' + tag], this.bones['Knee_' + tag], this.bones['Foot_' + tag]],
        arm: [this.bones['Arm_' + tag], this.bones['Elbow_' + tag], this.bones['Hand_' + tag]],
      };
    });
    this.seatMarker = this.marker('SeatContact', hips);
    this.fingers = [];
    for (const chain of this.chains) for (const finger of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
      const handMatrix = this.frame(chain.palm.object), normal = new THREE.Vector3(0, 1, 0).applyQuaternion(handMatrix.q);
      for (let part = 1; part <= 3; part++) {
        const bone = this.actual(chain.side + 'Hand' + finger + part), child = this.actual(chain.side + 'Hand' + finger + (part + 1));
        if (!bone || !child) continue;
        const direction = this.position(child).sub(this.position(bone)).normalize();
        const axis = direction.cross(normal).normalize().applyQuaternion(this.frame(bone).q.invert());
        this.fingers.push({ bone, axis, angle: (finger === 'Thumb' ? [.55, .85, .65] : [.7, 1.05, .75])[part - 1] });
      }
    }
    this.reset();
  }

  reset(stance = 'seated') {
    super.reset();
    this.g = null; this.crankAngle = 0; this.stanceBlend = stance === 'standing' ? 1 : 0; this.visualTime = 0; this.stateTime = 0;
    this.stanceFrom = this.stanceTarget = this.stanceBlend; this.stanceElapsed = .35;
    this.previousKickPose = 0; this.chargeAmount = 0; this.strikeStart = 0;
    this.cleanPose = new Map([...this.rest].map(([bone, rest]) => [bone, { p: rest.p.clone(), q: rest.q.clone(), s: rest.s.clone() }]));
  }

  restoreCleanPose() {
    for (const [bone, pose] of this.cleanPose) {
      bone.position.copy(pose.p); bone.quaternion.copy(pose.q); bone.scale.copy(pose.s);
    }
    this.root.updateWorldMatrix(true, true);
  }

  update(g, delta, crankAngle = 0) {
    this.g = g;
    if (g.phase === 'paused') return;
    if (g.kickPose > 0 && this.previousKickPose <= 0) this.strikeStart = this.chargeAmount;
    this.previousKickPose = g.kickPose || 0;
    this.chargeAmount = Math.min(.15, (g.charge || 0) * .15);
    this.restoreCleanPose();
    // A fresh C input must interrupt the held transition before clip selection.
    if (this.previousStance !== g.stance && (this.state === 'sitToStand' || this.state === 'standToSit')) this.hold = 0;
    const before = this.state;
    super.update(g, delta, crankAngle);
    this.stateTime = before === this.state ? this.stateTime + Math.max(0, delta) : 0;
    for (const [bone, pose] of this.cleanPose) {
      pose.p.copy(bone.position); pose.q.copy(bone.quaternion); pose.s.copy(bone.scale);
    }
    this.crankAngle = crankAngle; this.visualTime += Math.max(0, delta);
    const target = g.stance === 'standing' ? 1 : 0;
    if (g.phase === 'ready') {
      this.stanceFrom = this.stanceTarget = this.stanceBlend = target; this.stanceElapsed = .35;
    } else {
      if (target !== this.stanceTarget) {
        this.stanceFrom = this.stanceBlend; this.stanceTarget = target; this.stanceElapsed = 0;
      }
      this.stanceElapsed += Math.max(0, delta);
      const weight = (1 - Math.cos(clamp(this.stanceElapsed / .35) * Math.PI)) / 2;
      this.stanceBlend = this.stanceFrom + (target - this.stanceFrom) * weight;
    }
  }

  frame(object) {
    this.root.updateWorldMatrix(true, true);
    object.updateWorldMatrix(true, false);
    const matrix = this.root.matrixWorld.clone().invert().multiply(object.matrixWorld);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    matrix.decompose(p, q, s); return { p, q, s };
  }
  position(object) { return this.frame(object).p; }

  marker(name, bone) {
    const object = this.root.getObjectByName(name);
    if (!object) throw new Error('Tripo rider is missing authored contact marker ' + name);
    this.root.updateWorldMatrix(true, true);
    const matrix = bone.matrixWorld.clone().invert().multiply(object.matrixWorld);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    matrix.decompose(p, q, s);
    p.multiply(this.frame(bone).s);
    return { object, p, q };
  }

  target(name, fallback) {
    const marker = this.bike?.getObjectByName(name);
    return marker ? this.position(marker) : V(fallback);
  }

  rotate(bone, rotation) {
    const world = this.root.getWorldQuaternion(new THREE.Quaternion()).multiply(rotation);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    bone.updateWorldMatrix(false, true);
  }

  aim(bone, child, target) {
    const start = this.position(bone), direction = this.position(child).sub(start), desired = target.clone().sub(start);
    if (direction.lengthSq() < 1e-12 || desired.lengthSq() < 1e-12) return;
    const delta = new THREE.Quaternion().setFromUnitVectors(direction.normalize(), desired.normalize());
    this.rotate(bone, delta.multiply(this.frame(bone).q));
  }

  solve(chain, target, pole) {
    const [upper, lower, end] = chain, start = this.position(upper), elbow = this.position(lower), ankle = this.position(end);
    const a = start.distanceTo(elbow), b = elbow.distanceTo(ankle), direction = target.clone().sub(start);
    const requested = direction.length(), distance = clamp(requested, Math.abs(a - b) + 1e-5, a + b - 1e-5);
    if (requested < 1e-10) direction.set(0, -1, 0); else direction.divideScalar(requested);
    pole.addScaledVector(direction, -pole.dot(direction));
    if (pole.lengthSq() < 1e-10) pole.set(1, 0, 0).addScaledVector(direction, -direction.x);
    pole.normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const goal = start.clone().addScaledVector(direction, along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
    this.aim(upper, lower, goal);
    this.aim(lower, end, start.clone().addScaledVector(direction, distance));
    this.contactErrors.push({ bone: end.name, error: this.position(end).distanceTo(target) });
  }

  standingPelvis() {
    const marked = this.bike?.getObjectByName('RiderStand_L') && this.bike?.getObjectByName('RiderStand_R');
    if (this.explicitStandingPelvis || !(marked || this.measuredStanding)) return V(this.contacts.pelvisStanding);
    const ankles = this.chains.map((chain, i) => this.target('RiderStand_' + chain.tag, this.contacts.standing[i])
      .sub(chain.sole.p.clone().applyQuaternion(chain.sole.q.clone().invert())));
    const centerZ = (ankles[0].z + ankles[1].z) / 2;
    const heights = this.chains.map((chain, i) => {
      const [hip, knee, foot] = chain.leg.map(bone => this.restWorld[bone.name].p);
      const offset = hip.clone().sub(this.restWorld[this.bones.BalanceBody.name].p);
      const reach = (hip.distanceTo(knee) + knee.distanceTo(foot)) * .90;
      const horizontal = (ankles[i].x - offset.x) ** 2 + (ankles[i].z - centerZ - offset.z) ** 2;
      return ankles[i].y - offset.y + Math.sqrt(Math.max(0, reach * reach - horizontal));
    });
    // Both legs keep their original length and a bent knee. The lower reachable
    // pelvis height lets an asymmetrical bar/saddle stance retain both contacts.
    return V([0, Math.min(...heights), centerZ]);
  }

  bodyPose() {
    const g = this.g, stance = this.stanceBlend, air = clamp((g.jumpHeight || 0) / .5);
    const shield = this.state === 'shield' ? Math.sin(clamp(this.stateTime / .4) * Math.PI) : 0;
    const crash = this.state === 'crash' ? clamp(this.stateTime) : 0;
    const lean = 1.03 * (1 - stance) - shield * .16, ridingRoll = -(g.lateralSpeed || 0) * .025;
    const roll = ridingRoll - crash * 1.45;
    const pelvis = this.bones.BalanceBody, rest = this.restWorld[pelvis.name];
    const restQ = rest.q.clone(), seatOffset = this.seatMarker.p.clone().applyQuaternion(restQ);
    const seated = this.target('RiderSeat', this.contacts.seat).sub(seatOffset);
    const target = seated.lerp(this.standingPelvis(), stance);
    target.x += Math.sin(this.visualTime * 1.8) * .005 + clamp((g.lateralSpeed || 0) * .006, -.025, .025) - crash * .35;
    target.y -= air * .06 + (g.charge || 0) * .025 + crash * .84;
    const world = this.root.localToWorld(target.clone());
    pelvis.position.copy(pelvis.parent.worldToLocal(world));
    const postureOverlay = (this.state === 'standing' && this.stateTime < .15) ||
      this.state === 'sitToStand' || this.state === 'standToSit' ||
      stance > .001 && (g.phase === 'ready' || g.charge > 0 || g.kickPose > 0 ||
        g.jumpHeight > 0 || this.state === 'jumpLand' || this.state === 'shield');
    // A reversed fade or the seated ready clip can retain the wrong torso pose.
    // Keep the standing handoff and either transition on the contact timing;
    // once the .15s fade completes, the standing Action owns its torso again.
    // Shared overlay Actions are seated; preserve the selected standing pose.
    if (!this.hasBodyClips || postureOverlay) {
      this.rotate(pelvis, new THREE.Quaternion().setFromAxisAngle(V([0, 0, 1]), ridingRoll * .3 - crash * 1.45).multiply(restQ));
      for (const [name, fraction] of [['Spine', 1], ['Spine1', 1.03], ['Spine2', 1.05], ['Neck', .45], ['Head', .25]]) {
        const bone = this.actual(name); if (!bone) continue;
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean * fraction, 0, roll));
        this.rotate(bone, rotation.multiply(this.restWorld[bone.name].q));
      }
      const grip = .18 + .62 * (1 - stance);
      for (const finger of this.fingers) finger.bone.quaternion.copy(this.rest.get(finger.bone).q)
        .multiply(new THREE.Quaternion().setFromAxisAngle(finger.axis, grip * finger.angle));
    }
    this.root.updateWorldMatrix(true, true);
  }

  applyContactPose() {
    if (!this.g || this.g.phase === 'paused') return;
    this.restoreCleanPose(); this.contactErrors = [];
    // A baked crash owns its entire body; planting its feet would erase the fall.
    if (this.state === 'crash' && this.hasBodyClips) return;
    this.bodyPose();
    const g = this.g, stance = this.stanceBlend, air = clamp((g.jumpHeight || 0) / .5);
    const crash = this.state === 'crash' ? clamp(this.stateTime) : 0;
    const release = 1 - (1 - crash) ** 2;
    for (const [i, chain] of this.chains.entries()) {
      const { sign, tag } = chain;
      const center = this.contacts.pedalCenter;
      const fallback = V([sign * this.contacts.pedalWidth,
        center[1] - sign * this.contacts.crankRadius * Math.cos(this.crankAngle), center[2] - sign * this.contacts.crankRadius * Math.sin(this.crankAngle)])
        .add(V(this.contacts.pedalOffsets?.[i] ?? [0, 0, 0]));
      const pedal = this.target('RiderPedal_' + tag, fallback.toArray());
      const sole = pedal.lerp(this.target('RiderStand_' + tag, this.contacts.standing[i]), stance);
      sole.y += Math.sin(Math.PI * stance) * .26 + air * .19; sole.z -= air * .08;
      const footRotation = chain.sole.q.clone().invert();
      let ankle = sole.sub(chain.sole.p.clone().applyQuaternion(footRotation));
      const kicking = g.kickSide > 0 ? i === 0 : i === 1;
      if (kicking && (g.kickPose > 0 || g.charge > 0)) {
        const hip = this.position(chain.leg[0]), knee = this.position(chain.leg[1]), foot = this.position(chain.leg[2]);
        const length = hip.distanceTo(knee) + knee.distanceTo(foot) - .012;
        const phase = clamp(1 - (g.kickPose || 0) / .7);
        const amount = g.kickPose > 0 ? Math.min(1, Math.sin(phase * Math.PI) ** 2 + this.strikeStart * (1 - phase) ** 3) : this.chargeAmount;
        ankle.lerp(hip.clone().addScaledVector(V([sign * .92, .24, .22]).normalize(), length), amount);
      }
      if (crash) {
        const released = this.frame(chain.leg[2]);
        ankle.lerp(released.p, release); footRotation.slerp(released.q, release);
      }
      this.solve(chain.leg, ankle, V([0, .05, 1])); this.rotate(chain.leg[2], footRotation);
      const grip = this.target('RiderGrip_' + tag, this.contacts.grips[i]);
      const balance = V([sign * .64, this.position(this.bones.BalanceBody).y + .27, .13]);
      const gripRotation = new THREE.Quaternion().setFromAxisAngle(V([1, 0, 0]), -Math.PI * .83)
        .multiply(new THREE.Quaternion().setFromAxisAngle(V([0, 1, 0]), Math.PI)).multiply(chain.palm.q.clone().invert());
      const balanceRotation = chain.palm.q.clone().invert();
      // Hands release the bar during a stance change. Interpolate wrist goals,
      // so rotating an off-centre palm marker cannot make the elbow orbit or snap.
      const wrist = grip.sub(chain.palm.p.clone().applyQuaternion(gripRotation))
        .lerp(balance.sub(chain.palm.p.clone().applyQuaternion(balanceRotation)), stance);
      // The cosine stance lift has zero endpoint velocity. Turning the hand at
      // its corresponding linear phase avoids concentrating a half-turn in the
      // same middle frames where the forearm is already moving most quickly.
      const turn = Math.acos(1 - 2 * stance) / Math.PI;
      const handRotation = gripRotation.slerp(balanceRotation, turn);
      if (crash) {
        const released = this.frame(chain.arm[2]);
        wrist.lerp(released.p, release);
        const spine = this.actual('Spine2');
        const bodyDelta = this.frame(spine).q.multiply(this.restWorld[spine.name].q.clone().invert());
        const startingBody = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.03 * (1 - stance) * 1.05, 0, -(g.lateralSpeed || 0) * .025));
        const relative = startingBody.invert().multiply(handRotation);
        // Blend in the body frame; a moving world-space endpoint could cross
        // the quaternion hemisphere boundary halfway through the fall.
        handRotation.copy(bodyDelta.multiply(relative.slerp(this.restWorld[chain.arm[2].name].q, release)));
      }
      if (Math.max(stance, crash) > .001) {
        // Released hands follow a relaxed reach, keeping the elbow away from a
        // straight-arm singularity while the shoulders rise during the transition.
        const shoulder = this.position(chain.arm[0]), elbow = this.position(chain.arm[1]), hand = this.position(chain.arm[2]);
        const reach = (shoulder.distanceTo(elbow) + elbow.distanceTo(hand)) * .88;
        const direction = wrist.clone().sub(shoulder);
        if (direction.length() > reach) wrist.copy(shoulder).add(direction.setLength(reach));
      }
      this.solve(chain.arm, wrist, V([sign, -.15, -.6])); this.rotate(chain.arm[2], handRotation);
    }
    this.root.updateWorldMatrix(true, true);
    this.root.traverse(object => { if (object.isSkinnedMesh) object.skeleton.update(); });
  }
}
