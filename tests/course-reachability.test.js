import test from 'node:test';
import assert from 'node:assert/strict';
import {findSteeringRoute,replaySteeringRoute} from '../scripts/check-course.mjs';

test('a sampled steering route replays through the production collision rules without defensive skills',()=>{
  const course={mode:'endless',seed:2817,chunkLength:80,lookAhead:480};
  const route=findSteeringRoute(course,{start:4000,seconds:6,beam:96});
  assert.ok(route.inputs.length>0);
  const g=replaySteeringRoute(course,route);
  assert.equal(g.phase,'racing');assert.equal(g.kickedCount,0);assert.equal(g.buffs.shield,0);
  assert.ok(g.s>=4194.9);assert.equal(g.speed,32.5);
});

test('the sampler rejects a completely blocked road instead of granting invulnerability',()=>{
  const course={mode:'endless',seed:1,chunkLength:80,lookAhead:480,procedural:false,
    obstacles:[-4.6,-1.5,1.5,4.6].map((lane,i)=>({id:'wall'+i,type:'wall',s:10,lane}))};
  assert.throws(()=>findSteeringRoute(course,{seconds:2,beam:64}),/No sampled steering route/);
});

test('late-region samples retain and replay their entering lane instead of assuming a safe center teleport',()=>{
  const course={mode:'endless',seed:65535,chunkLength:80,lookAhead:480};
  assert.throws(()=>findSteeringRoute(course,{start:4000,seconds:2,beam:128}),/No sampled steering route/);
  const route=findSteeringRoute(course,{start:4000,seconds:2,entryLanes:[-2.4,0,2.4]});
  assert.notEqual(route.lane,0);assert.equal(replaySteeringRoute(course,route).phase,'racing');
});

test('a shield at a blocked starting point cannot contaminate an unassisted route',()=>{
  const course={mode:'endless',seed:1,chunkLength:80,lookAhead:480,procedural:false,
    pickups:[{id:'shield',type:'shield',s:0,lane:0,height:1.25}],
    obstacles:[{id:'wall',type:'wall',s:0,lane:0}]};
  assert.throws(()=>findSteeringRoute(course,{seconds:2,beam:64}),/No sampled steering route/);
});

test('one unsafe entering lane does not discard another safe lane',()=>{
  const course={mode:'endless',seed:1,chunkLength:80,lookAhead:480,procedural:false,
    obstacles:[{id:'left-wall',type:'wall',s:0,lane:-2.4}]};
  for(const entryLanes of [[-2.4,2.4],[2.4,-2.4]]){
    const route=findSteeringRoute(course,{seconds:2,entryLanes});
    assert.equal(route.lane,2.4);assert.equal(replaySteeringRoute(course,route).phase,'racing');
  }
});
