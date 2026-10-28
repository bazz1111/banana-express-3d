import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadNativeGlb} from './fixtures/load-native-glb.js';
import {MixamoRiderAnimator} from '../src/mixamoRiderAnimation.js';

test('reset respects a standing game before the first authored strike frame',async()=>{
  const {scene:hero,animations}=await loadNativeGlb(new URL('../assets/export/riderSkinned.glb',import.meta.url));
  const {scene:bike}=await loadNativeGlb(new URL('../assets/export/bicycle.glb',import.meta.url));
  const scene=new THREE.Scene();scene.add(hero,bike);scene.updateMatrixWorld(true);
  const animator=new MixamoRiderAnimator(hero,animations,bike);
  for(const kickSide of [-1,1]){
    animator.reset('standing');
    animator.update({phase:'racing',stance:'standing',charge:0,kickPose:.7,kickSide,
      jumpHeight:0,jumpVelocity:0,lateralSpeed:0,events:[]},0,0);
    animator.applyContactPose();
    assert.equal(animator.stanceBlend,1,'A reset may not invent a seated-to-standing transition');
    assert.ok(animator.contactErrors.every(c=>c.error<1e-4),JSON.stringify(animator.contactErrors));
    for(const tag of ['L','R'])assert.ok(hero.getObjectByName('Sole_'+tag).getWorldPosition(new THREE.Vector3())
      .distanceTo(bike.getObjectByName('RiderStand_'+tag).getWorldPosition(new THREE.Vector3()))<1e-4);
  }
  animator.reset();assert.equal(animator.stanceBlend,0,'Ordinary restart still defaults to seated');
});
