import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { worldAt, kickJoints, standingJoints, standingRest, ridingJoints, armJoints, armRest, terrainHeight, foliageWind } from '../src/view.js';
import { Quaternion, Euler } from 'three';

test('wind deformation and time are identical in visible foliage and its depth silhouette',()=>{
  const clock={value:3.25},materials=[{},{}],shaders=materials.map(material=>{
    foliageWind(material,clock);const shader={uniforms:{},vertexShader:'void main(){\n#include <begin_vertex>\n}'};
    material.onBeforeCompile(shader);return shader;
  });
  assert.equal(shaders[0].vertexShader,shaders[1].vertexShader);
  assert.ok(shaders[0].vertexShader.includes('transformed.x += sin('));
  for(const s of shaders)assert.equal(s.uniforms.uWindTime,clock);
  clock.value=8;assert.equal(shaders[1].uniforms.uWindTime.value,8);
});

test('steering right projects to the right of the chase-camera screen', () => {
  const camera = new PerspectiveCamera(56, 16/9, .1, 100);
  camera.position.set(0, 3, -7); camera.lookAt(new Vector3(0, 1, 8)); camera.updateMatrixWorld();
  const right = worldAt({}, 0, 1);
  assert.ok(right.project(camera).x > 0, 'D must move right, not left on screen');
});

test('full side kick straightens the knee and extends toward the truck',()=>{
  for(const side of [-1,1]){
    const q=kickJoints(side,1);
    const rest=standingRest(side);
    const thigh=rest.upper.clone().applyQuaternion(q.upper);
    const shin=rest.lower.clone().applyQuaternion(q.lower).applyQuaternion(q.upper);
    assert.ok(thigh.clone().normalize().dot(shin.clone().normalize())>.999,'Knee must fully straighten');
    assert.ok((thigh.x+shin.x)*side>.65,'Foot must extend sideways toward impact');
  }
});

test('kick overlay starts from the current seated, standing or transition pose',()=>{
  for(const side of [-1,1]){
    const seated=ridingJoints(side,.6),standing=standingJoints(side,.04,.02);
    const transition={upper:seated.upper.clone().slerp(standing.upper,.5),lower:seated.lower.clone().slerp(standing.lower,.5)};
    for(const base of [seated,standing,transition]){
      const unchanged=kickJoints(side,0,base),first=kickJoints(side,.0025,base),full=kickJoints(side,1,base);
      assert.ok(unchanged.upper.angleTo(base.upper)<1e-7&&unchanged.lower.angleTo(base.lower)<1e-7,'No sudden standing-rest reset at charge onset');
      assert.ok(first.upper.angleTo(base.upper)<.008&&first.lower.angleTo(base.lower)<.008,'First charge frame must be continuous');
      const rest=standingRest(side),thigh=rest.upper.clone().applyQuaternion(full.upper),shin=rest.lower.clone().applyQuaternion(full.lower).applyQuaternion(full.upper);
      assert.ok(thigh.normalize().dot(shin.normalize())>.999,'Full kick must still extend the leg');
    }
  }
});

test('standing feet stay on handlebar and saddle while crouching and balancing',()=>{
  for(const side of [-1,1])for(const crouch of [0,.04,.12])for(const sway of [-.04,0,.04]){
    const pose=standingJoints(side,crouch,sway),rest=standingRest(side);
    const ankle=pose.hip.clone().add(rest.upper.clone().applyQuaternion(pose.upper))
      .add(rest.lower.clone().applyQuaternion(pose.lower).applyQuaternion(pose.upper));
    const target=side<0?new Vector3(-.30,1.311,.58):new Vector3(.04,1.233,-.21);
    assert.ok(ankle.distanceTo(target)<1e-6,'Ankle must follow its physical support');
    const sole=pose.upper.clone().multiply(pose.lower).multiply(pose.foot);
    assert.ok(Math.abs(sole.w)>1-1e-6,'Sole must stay level');
  }
});

test('ground placement follows the authored diagonal triangles and wraps seamless tiles',()=>{
  const grid={x:[-4,0,4],step:40,rows:3,heights:[0,0,0,0,8,0,0,0,0]};
  assert.equal(terrainHeight(grid,-2,10),2,'Use the actual diagonal, not bilinear height averaging');
  assert.equal(terrainHeight(grid,-3,30),2);
  assert.equal(terrainHeight(grid,0,40),8);
  assert.equal(terrainHeight(grid,0,120),8);
  assert.equal(terrainHeight(grid,-2,-70),2);
});

test('seated legs follow their pedals and keep each shoe sole level',()=>{
  for(const side of [-1,1])for(const angle of [0,.6,Math.PI/2,Math.PI,4.2]){
    const rest=standingRest(side),pose=ridingJoints(side,angle);
    const foot=pose.hip.clone().add(rest.upper.clone().applyQuaternion(pose.upper))
      .add(rest.lower.clone().applyQuaternion(pose.lower).applyQuaternion(pose.upper));
    const target=new Vector3(side*.21,.4-side*.18*Math.cos(angle)+.138,.04-side*.18*Math.sin(angle)-.075);
    assert.ok(foot.distanceTo(target)<1e-6);
    assert.ok(Math.abs(pose.upper.clone().multiply(pose.lower).multiply(pose.foot).w)>1-1e-6);
  }
});

test('seated arm joints place both hands on the handlebars',()=>{
  for(const side of [-1,1]){
    const torso=new Vector3(0,1.3,-.22),rotation=new Quaternion().setFromEuler(new Euler(.98,0,0));
    const rest=armRest(side),pose=armJoints(side,torso,rotation,0,0);
    const hand=rest.shoulder.clone().add(rest.upper.clone().applyQuaternion(pose.upper))
      .add(rest.lower.clone().applyQuaternion(pose.lower).applyQuaternion(pose.upper));
    hand.applyQuaternion(rotation).add(torso);
    assert.ok(hand.distanceTo(new Vector3(side*.36,1.20,.50))<1e-6);
  }
});
