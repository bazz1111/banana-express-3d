import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/game.ts';
const course=(obstacles=[],pickups=[])=>({mode:'endless',seed:2817,chunkLength:80,lookAhead:480,procedural:false,obstacles,pickups});
const racer=(obstacles=[],pickups=[])=>{const g=core.createGame(course(obstacles,pickups));g.phase='racing';return g;};
const run=(g,seconds,input={},fps=60)=>{const events=[];for(let i=0;i<seconds*fps;i++){core.advance(g,input,1/fps);events.push(...g.events);}return events;};

test('generated traffic has local motion while fixed obstacles keep their anchors',()=>{
 const g=core.createGame({...course(),procedural:true});
 const vehicles=g.obstacles.filter(o=>['car','truck','train'].includes(o.type));
 assert.ok(vehicles.length);assert.ok(vehicles.every(o=>o.speed!==0&&Number.isFinite(o.speed)&&o.wakeDistance===60));
 assert.ok(g.obstacles.filter(o=>['wall','crate','barrier'].includes(o.type)).every(o=>!o.speed&&!o.crossing));
});
test('crossings start from their authored lane at any global time, move once and stop',()=>{
 const g=racer([{id:'goat',type:'goat',s:40,lane:2.4,crossing:true,crossDistance:-2.1,crossDuration:4,wakeDistance:60}]);g.lane=-4;g.elapsed=700;
 const o=g.obstacles[0];core.advance(g,{},1/60);
 assert.ok(Math.abs(o.lane-2.4)<.001,'No global clock teleport');
 run(g,2);assert.ok(o.lane<2&&o.lane>.3);assert.ok(o.travel>0&&o.velocityLane<0);
 run(g,3);assert.ok(Math.abs(o.lane-.3)<1e-8);assert.equal(o.velocityLane,0);
 const stopped=o.travel;run(g,1);assert.equal(o.travel,stopped,'No oscillating U-turn');
});
test('distant traffic waits until the approach, pause and replay retain exact motion',()=>{
 const def={id:'car',type:'car',s:120,lane:2.4,speed:-2.5,wakeDistance:60};
 const g=racer([def]);run(g,1);assert.equal(g.obstacles[0].s,120);
 g.s=70;run(g,1);assert.ok(Math.abs(g.obstacles[0].s-117.5)<1e-7);
 core.togglePause(g);const before=structuredClone(g.obstacles);run(g,3);assert.deepEqual(g.obstacles,before);
 const a=racer([{...def,s:40}]),b=racer([{...def,s:40}]);run(a,2,{},30);run(b,2,{},120);assert.deepEqual(a.obstacles,b.obstacles);
});
test('Q recovers after eight seconds, cannot charge during cooldown and never grants invulnerability',()=>{
 assert.equal(core.KICK.cooldown,8);assert.equal(core.KICK.charge,.8);
 const g=racer([{id:'truck',type:'truck',s:15,lane:2}]);run(g,.8,{kick:true});core.advance(g,{},1/60);
 assert.equal(g.cooldowns.kick,8);assert.equal(g.kickedCount,1);assert.equal(g.invulnerable,0);
 run(g,7.9,{kick:true});assert.equal(g.charge,0);assert.ok(g.cooldowns.kick>0);
 run(g,.1);assert.equal(g.cooldowns.kick,0);core.advance(g,{kick:true},1/60);assert.ok(g.charge>0);
});
test('missions reward exactly once, ignore score multipliers, freeze and reset with the run',()=>{
 const g=racer([],Array.from({length:12},(_,i)=>({id:'b'+i,type:'banana',s:.2,lane:0,height:1.25})));g.buffs.double=10;
 core.advance(g,{},1/60);const rewards=g.events.filter(e=>e.type==='objective');
 assert.equal(rewards.length,1);assert.equal(rewards[0].points,150);assert.equal(g.objective.completed,1);assert.equal(g.objective.progress,0);
 assert.equal(g.objective.index,1);const score=g.score;core.advance(g,{},1/60);assert.ok(g.score-score<1);
 core.togglePause(g);const state=structuredClone(g.objective);run(g,2);assert.deepEqual(g.objective,state);
 assert.deepEqual(core.createGame(g.course).objective,{index:0,progress:0,completed:0});
});
test('safe passes advance the current goal and close ground passes award once after the rear edge',()=>{
 const g=racer([{id:'crate',type:'crate',s:6,lane:0}]);g.lane=1.35;g.objective={index:1,progress:0,completed:1};
 let events=run(g,.4);assert.equal(events.filter(e=>e.type==='nearMiss').length,0);
 events=run(g,1);assert.equal(events.filter(e=>e.type==='nearMiss').length,1);assert.equal(g.nearMisses,1);assert.equal(g.objective.progress,1);
 assert.equal(run(g,1).filter(e=>e.type==='nearMiss').length,0);
});
test('jumping nearby or immunity cannot farm near-miss points and collisions cancel safe-pass progress',()=>{
 for(const mode of ['jump','shield','immunity','far']){
  const g=racer([{id:'crate',type:'crate',s:5,lane:0}]);g.lane=mode==='shield'?0:mode==='far'?3:1.35;g.objective={index:1,progress:0,completed:1};
  if(mode==='shield')g.buffs.shield=8;if(mode==='immunity')g.invulnerable=2;
  const events=run(g,1,mode==='jump'?{jump:true}:{});
  assert.equal(events.filter(e=>e.type==='nearMiss').length,0,mode);
  if(mode==='shield')assert.equal(g.objective.progress,0);
 }
});
test('all goal stages cycle without multiplying rewards or double-counting one event into the next stage',()=>{
 const g=racer([{id:'car',type:'car',s:6,lane:2}]);g.objective={index:1,progress:5,completed:1};g.buffs.double=8;
 core.advance(g,{kick:true},1/60);core.advance(g,{},1/60);
 assert.deepEqual(g.objective,{index:2,progress:0,completed:2});assert.equal(g.events.find(e=>e.type==='objective').points,200);
 // The kicked car is already resolved and cannot also count as a later safe pass.
 run(g,1);assert.equal(g.objective.progress,0);
 g.objective.progress=2;g.cooldowns.kick=0;
 g.obstacles.push({...core.createGame(course([{id:'car2',type:'car',s:g.s+6,lane:2}])).obstacles[0]});
 core.advance(g,{kick:true},1/60);core.advance(g,{},1/60);
 assert.deepEqual(g.objective,{index:0,progress:0,completed:3});assert.equal(g.events.find(e=>e.type==='objective').points,250);
});
test('moving traffic and walkers retain conservative swept contacts at boosted speed',()=>{
 for(const fps of [30,60,120]){
  const g=racer([{id:'car',type:'car',s:3505,lane:0,speed:-2.5,wakeDistance:60}]);g.s=3500;g.buffs.boost=3;
  run(g,.2,{},fps);assert.equal(g.phase,'finished',`oncoming ${fps}`);
  const w=racer([{id:'walker',type:'pedestrian',s:3503,lane:.9,crossing:true,crossDistance:-1.5,crossDuration:1,wakeDistance:60}]);w.s=3500;w.buffs.boost=3;
  run(w,.5,{},fps);assert.equal(w.phase,'racing',`outside ${fps}`);
 }
});
test('a sideways goat uses its turned body footprint instead of the forward-facing narrow width',()=>{
 const g=racer([{id:'goat',type:'goat',s:.8,lane:1,crossing:true,crossDistance:2.1,crossDuration:4,wakeDistance:60}]);
 g.lane=.05;core.advance(g,{},1/60);
 assert.equal(g.phase,'finished','The sideways 1.2m body overlaps the rider even though the 0.8m forward width would miss');
});
test('holding either outer edge is not an indefinite survival strategy after teaching',()=>{
 for(const seed of [0,1,137,2817,65535])for(const steer of [-1,1]){
  const g=core.createGame({mode:'endless',seed,chunkLength:80,lookAhead:480});g.phase='racing';
  for(let tick=0;tick<12000&&g.phase==='racing'&&g.s<1000;tick++)core.advance(g,{steer},1/60);
  assert.equal(g.phase,'finished',`seed ${seed} edge ${steer} survived without a single decision`);
  assert.ok(g.s>160,'Preserve the initial teaching space');
 }
});
