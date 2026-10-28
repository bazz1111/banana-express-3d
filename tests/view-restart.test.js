import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGame} from '../src/game.ts';
import {GameView} from '../src/view.js';
import {loadNativeGlb} from './fixtures/load-native-glb.js';

test('early restart with a new seed returns all old obstacle models to their typed pools',async()=>{
  const course=seed=>({mode:'endless',seed,chunkLength:80,lookAhead:480});
  const oldGame=createGame(course(137)),nextGame=createGame(course(138));
  const previous=oldGame.obstacles.find(o=>o.id==='o:2:1'),next=nextGame.obstacles.find(o=>o.id===previous.id);
  assert.equal(previous.type,'barrier');assert.equal(next.type,'pedestrian');
  const model=(await loadNativeGlb(new URL('../assets/export/barrier.glb',import.meta.url))).scene;
  model.userData.kind=previous.type;const scene=new THREE.Scene();scene.add(model);
  const view=Object.assign(Object.create(GameView.prototype),{
    scene,obstacleModels:new Map([[previous.id,model]]),pool:new Map(),
    pendingDebris:new Set([previous.id]),landingPlayed:new Set([previous.id]),
    debrisView:{reset(){}},kickCamera:{reset(){}},physics:{reset(){}},
    wheels:[],crank:new THREE.Object3D(),pedals:[],particleMeshes:{},
  });
  view.reset(nextGame);
  assert.equal(view.obstacleModels.size,0,'A reused id must not retain a model from another seed');
  assert.equal(model.parent,null,'The old barrier must leave the visible scene');
  assert.deepEqual(view.pool.get('barrier'),[model],'Return the original model to its own type pool');
  assert.equal(view.pendingDebris.size,0);assert.equal(view.landingPlayed.size,0);
  view.reset(createGame(course(139)));
  assert.equal(view.pool.get('barrier').length,1,'Repeated restart must not duplicate pooled objects');
});
