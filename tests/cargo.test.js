import test from 'node:test';
import assert from 'node:assert/strict';
import {cargoVisibleCounts} from '../src/cargo.js';

const groups=Array.from({length:4},(_,v)=>Array.from({length:5},(_,n)=>n*4+v));
test('four cargo variants reveal hands in pickup order and do not cap the player total',()=>{
  assert.deepEqual(cargoVisibleCounts(groups,0),[0,0,0,0]);
  assert.deepEqual(cargoVisibleCounts(groups,5),[1,0,0,0]);
  assert.deepEqual(cargoVisibleCounts(groups,85),[5,4,4,4]);
  assert.deepEqual(cargoVisibleCounts(groups,128),[5,5,5,5]);
  assert.deepEqual(cargoVisibleCounts(groups,0),[0,0,0,0],'restart clears every group');
  for(let n=0;n<=250;n++)assert.equal(cargoVisibleCounts(groups,n).reduce((a,b)=>a+b,0),Math.min(20,Math.floor(n/5)));
});
