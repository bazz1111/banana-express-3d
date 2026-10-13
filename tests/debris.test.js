import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../src/game.ts';
import {ScenePhysics} from '../src/physics.ts';
const course={mode:'endless',seed:2817,procedural:false,obstacles:[{id:'truck',type:'truck',s:6,lane:1.3,speed:0}]};
const ground={vertices:new Float32Array([-40,0,-40,40,0,-40,40,0,80,-40,0,80]),indices:new Uint32Array([0,2,1,0,3,2])};
const game=()=>{const g=createGame(course);g.phase='racing';return g;};
const parts=n=>Array.from({length:n},(_,i)=>({name:`TruckPart_Crate_${i}`,position:{x:i*.6,y:3,z:6},rotation:{x:0,y:0,z:0,w:1},scale:{x:1,y:1,z:1},halfExtents:[.25,.25,.25],mass:8}));
test('debris uses actual part poses, capped bodies and ground contacts',async()=>{
 const p=await ScenePhysics.create(course,[ground]);try{
  p.reset(game());assert.equal(typeof p.spawnDebris,'function','explicit authored parts need a spawn API');
  const count=p.world.bodies.len(),ids=p.spawnDebris('truck',parts(20));assert.equal(ids.length,12);
  assert.equal(p.debris.size,12);assert.equal(p.world.bodies.len(),count+12);
  assert.deepEqual({...p.debris.get(ids[0]).body.translation()},parts(1)[0].position);
  const g=game();for(let i=0;i<175;i++)p.sync(g,1/60);
  for(const d of p.debris.values())assert.ok(d.body.translation().y>.15,'parts must rest on authored ground');
  for(let i=0;i<6;i++)p.sync(g,1/60);
  assert.equal(p.debris.size,0);assert.equal(p.world.bodies.len(),count);
 }finally{p.dispose();}
});
test('debris freezes on pause and clears on parent despawn and reset',async()=>{
 const p=await ScenePhysics.create(course,[ground]);const g=game();try{
  p.reset(g);assert.equal(typeof p.spawnDebris,'function');p.spawnDebris('truck',parts(2));
  p.sync(g,.1);const d=[...p.debris.values()][0],before={...d.body.translation()},age=d.age;
  g.phase='paused';for(let i=0;i<120;i++)p.sync(g,1/60);
  assert.deepEqual({...d.body.translation()},before);assert.equal(d.age,age);
  g.phase='racing';g.s+=100;p.sync(g,0);assert.ok(Math.abs(d.body.translation().z-before.z+100)<1e-5);
  g.obstacles=[];p.sync(g,0);assert.equal(p.debris.size,0);
  p.reset(game());p.spawnDebris('truck',parts(2));p.reset(game());assert.equal(p.debris.size,0);
 }finally{p.dispose();}
});
test('debris advances equally at 30,60,120fps without changing score or collision state',async()=>{
 const results=[];for(const fps of [30,60,120]){const p=await ScenePhysics.create(course,[ground]);const g=game();try{
  p.reset(g);assert.equal(typeof p.spawnDebris,'function');const before=JSON.stringify(g);
  const [id]=p.spawnDebris('truck',parts(1));for(let i=0;i<fps;i++)p.sync(g,1/fps);
  assert.equal(JSON.stringify(g),before);const d=p.debris.get(id);results.push([...Object.values(d.body.translation()),...Object.values(d.body.rotation()),d.age]);
 }finally{p.dispose();}}
 for(const r of results.slice(1))for(let i=0;i<r.length;i++)assert.ok(Math.abs(r[i]-results[0][i])<1e-5);
});
