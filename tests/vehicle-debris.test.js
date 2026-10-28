import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {loadNativeGlb} from './fixtures/load-native-glb.js';
import {ScenePhysics} from '../src/physics.ts';
import {createGame} from '../src/game.ts';
import {VehicleDebris} from '../src/vehicleDebris.js';

test('recycled native truck restores parts without old debris revealing the next truck',async()=>{
  const model=(await loadNativeGlb(process.env.BANANA_TRUCK_GLB??new URL('../assets/export/truck.glb',import.meta.url))).scene;
  const scene=new THREE.Scene();scene.add(model);
  const course={mode:'endless',procedural:false,obstacles:[{id:'old',type:'truck',s:6,lane:2},{id:'next',type:'truck',s:22,lane:2}]};
  const g=createGame(course);g.phase='racing';
  const physics=await ScenePhysics.create(course,[{vertices:new Float32Array([-40,0,-40,40,0,-40,40,0,80,-40,0,80]),indices:new Uint32Array([0,2,1,0,3,2])}]);
  const view=new VehicleDebris(physics,scene);
  const parts=['TruckPart_Door_R','TruckPart_Tailgate','TruckPart_Crate_01'].map(n=>model.getObjectByName(n));
  const step=n=>{for(let i=0;i<n;i++){physics.sync(g,1/60);view.update();}};
  try{
    physics.reset(g);view.release('old',model);assert.equal(view.models.size,3);assert.ok(parts.every(p=>!p.visible));
    step(95);assert.equal(physics.debris.size,3,'The old particles are still alive at the visual pool boundary');
    view.restoreVehicle('old');assert.ok(parts.every(p=>p.visible),'Returning a mesh to the pool must restore all authored parts');
    assert.equal(physics.debris.size,3,'Restoring the mesh does not shorten independent particle lifetime');
    view.release('next',model);assert.equal(view.models.size,6);assert.ok(parts.every(p=>!p.visible));
    step(90);assert.equal(physics.debris.size,3);assert.ok(parts.every(p=>!p.visible),'Expiry of the old fragments must not reveal newly detached parts');
    view.reset();physics.reset(g);assert.equal(view.models.size,0);assert.ok(parts.every(p=>p.visible));
    assert.equal(scene.children.length,1,'No copied geometry remains in the render scene');
  }finally{view.reset();physics.dispose();}
});
test('exported breakaway colliders match the actual centred mesh in glTF Y-up metres',async()=>{
  const {readFile}=await import('node:fs/promises');
  const bytes=await readFile(process.env.BANANA_TRUCK_GLB??new URL('../assets/export/truck.glb',import.meta.url));
  const data=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  const parts=data.nodes.filter(node=>node.extras?.breakaway&&node.mesh!==undefined);
  assert.ok(parts.length>=3,'Truck must have real breakaway geometry');
  for(const node of parts){
    const positions=data.meshes[node.mesh].primitives.map(p=>data.accessors[p.attributes.POSITION]);
    const lo=[0,1,2].map(i=>Math.min(...positions.map(p=>p.min[i]))),hi=[0,1,2].map(i=>Math.max(...positions.map(p=>p.max[i])));
    for(let axis=0;axis<3;axis++){
      assert.ok(Math.abs((hi[axis]+lo[axis])/2)<1e-5,`${node.name}: debris pivot is not the mesh centre`);
      assert.ok(Math.abs(node.extras.halfExtents[axis]-(hi[axis]-lo[axis])/2)<1e-5,`${node.name}: collider axis ${axis} disagrees with the rendered mesh`);
    }
  }
});
