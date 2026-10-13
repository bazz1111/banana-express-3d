import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {createGame,roadAt} from '../src/game.ts';
import {ScenePhysics} from '../src/physics.ts';

const course={mode:'endless',seed:2817,procedural:false,
  obstacles:[{id:'truck',type:'truck',s:6,lane:1.3,speed:0}]};
const ground={vertices:new Float32Array([-40,0,-40,40,0,-40,40,0,80,-40,0,80]),
  indices:new Uint32Array([0,2,1,0,3,2])};
const racing=()=>{const g=createGame(course);g.phase='racing';g.bananas=100;return g;};
const frames=(physics,g,n)=>{for(let i=0;i<n;i++)physics.sync(g,1/60);};
const near=(actual,expected,tolerance=2e-5)=>assert.ok(Math.abs(actual-expected)<tolerance,
  `${actual} must be near ${expected}`);
const nearObject=(actual,expected,tolerance)=>{
  for(const [key,value]of Object.entries(expected))near(actual[key],value,tolerance);
};
const curve={...course,step:2,road:{period:8,advance:{x:4,y:-1.6,z:4}},
  obstacles:[{id:'car',type:'car',s:4,lane:0}],points:[
    {s:0,x:0,y:0,z:0,yaw:0},{s:2,x:0,y:-.4,z:2,yaw:Math.PI/4},
    {s:4,x:2,y:-.8,z:2,yaw:Math.PI/2},{s:6,x:4,y:-1.2,z:2,yaw:Math.PI/4},
    {s:8,x:4,y:-1.6,z:4,yaw:0},
  ]};

const authoredCourse=()=>{
  const angle=s=>.9*Math.sin(2*Math.PI*s/800)+.15*Math.sin(2*Math.PI*s/400);
  const points=[{s:0,x:0,y:0,z:0,yaw:0}];
  for(let s=2;s<=1600;s+=2){
    const previous=points.at(-1),yaw=angle(s-1);
    points.push({s,x:previous.x+2*Math.sin(yaw),y:-.04*s,z:previous.z+2*Math.cos(yaw),yaw:angle(s)});
  }
  const end=points.at(-1);
  return {...course,step:2,points,obstacles:[],road:{period:1600,advance:{x:end.x,y:end.y,z:end.z}}};
};
const roadSurfaces=c=>Array.from({length:20},(_,segment)=>
  [[-5,5],[-16,-5],[5,16]].map(([left,right])=>{
    const vertices=[],indices=[];
    for(let i=0;i<=40;i++){
      const p=c.points[segment*40+i];
      for(const lane of [left,right])vertices.push(p.x-lane*Math.cos(p.yaw),p.y,p.z+lane*Math.sin(p.yaw));
      if(i<40){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
    }
    return {segment,vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
  })).flat();

test('bicycle and traffic start as kinematic bodies',async()=>{
  const p=await ScenePhysics.create(course,[ground]);
  try{p.reset(racing());assert.ok(p.player.isKinematic());assert.ok(p.vehicles.get('truck').isKinematic());}
  finally{p.dispose();}
});

test('a kicked heavy truck gains upward velocity and rotation from an impulse',async()=>{
  const p=await ScenePhysics.create(course,[ground]);const g=racing();
  try{
    p.reset(g);g.obstacles[0].kicked=true;g.obstacles[0].kickSide=1;
    p.sync(g,1/60);const body=p.vehicles.get('truck');
    assert.ok(body.isDynamic(),'Kick must switch the existing traffic body into dynamics');
    assert.ok(body.linvel().y>7,'A heavy truck must actually receive an upward impulse');
    assert.ok(Math.hypot(...Object.values(body.angvel()))>1,'Torque must start tumbling');
    const start=body.translation().y;frames(p,g,20);
    assert.ok(body.translation().y>start+1,'Rapier must advance the flying body');
  }finally{p.dispose();}
});

test('moving origin preserves outward kick direction on either side',async()=>{
  for(const side of [-1,1]){
    const data={...course,obstacles:[{id:'car',type:'car',s:10006,lane:side*2,speed:-3}]};
    const p=await ScenePhysics.create(data,[ground]);const g=createGame(data);g.phase='racing';g.s=10000;
    try{
      p.reset(g);assert.equal(p.vehicles.get('car').translation().z,6);
      g.obstacles[0].kicked=true;g.obstacles[0].kickSide=side;p.sync(g,1/60);
      assert.ok(-p.vehicles.get('car').linvel().x*side>5);
      const before=p.vehicles.get('car').translation().z;g.s+=100;
      p.sync(g,0);assert.ok(Math.abs(p.vehicles.get('car').translation().z-(before-100))<.001);
    }finally{p.dispose();}
  }
});

test('pause freezes flying traffic and resume continues it',async()=>{
  const p=await ScenePhysics.create(course,[ground]);const g=racing();
  try{
    p.reset(g);g.obstacles[0].kicked=true;g.obstacles[0].kickSide=1;frames(p,g,12);
    const before={...p.vehicles.get('truck').translation()};g.phase='paused';frames(p,g,120);
    assert.deepEqual({...p.vehicles.get('truck').translation()},before);
    g.phase='racing';frames(p,g,10);assert.notEqual(p.vehicles.get('truck').translation().y,before.y);
  }finally{p.dispose();}
});

test('flying-vehicle physics advances equally at 30, 60 and 120 render frames per second',async()=>{
  const results=[];
  for(const fps of [30,60,120]){
    const p=await ScenePhysics.create(course,[ground]);const g=racing();
    try{
      p.reset(g);g.obstacles[0].kicked=true;g.obstacles[0].kickSide=1;
      for(let i=0;i<fps;i++)p.sync(g,1/fps);
      const body=p.vehicles.get('truck');results.push([...Object.values(body.translation()),...Object.values(body.rotation())]);
    }finally{p.dispose();}
  }
  for(const result of results.slice(1))for(const key of Object.keys(result))
    assert.ok(Math.abs(result[key]-results[0][key])<1e-5,`${key} must be independent of render frame rate`);
});

test('restart restores kinematic traffic without stale flight or impulses',async()=>{
  const p=await ScenePhysics.create(course,[ground]);const g=racing();
  try{
    p.reset(g);g.obstacles[0].kicked=true;g.obstacles[0].kickSide=-1;frames(p,g,15);
    const fresh=racing();p.reset(fresh);p.sync(fresh,1/60);const body=p.vehicles.get('truck');
    assert.ok(body.isKinematic());assert.equal(body.translation().y,0);
    assert.ok(Math.hypot(...Object.values(body.linvel()))<.001);
  }finally{p.dispose();}
});

test('dynamic contacts use the authored ground surface',async()=>{
  const p=await ScenePhysics.create(course,[ground]);const g=racing();
  try{
    p.reset(g);const body=p.vehicles.get('truck');
    p.release('truck',1);body.setTranslation({x:0,y:3,z:6},true);body.setLinvel({x:0,y:-4,z:0},true);body.setAngvel({x:0,y:0,z:0},true);
    frames(p,g,120);
    assert.ok(body.translation().y>-.1,'Ground collider must stop the truck instead of letting it fall through');
  }finally{p.dispose();}
});

test('despawned chunks release Rapier bodies instead of growing forever',async()=>{
  const p=await ScenePhysics.create(course,[ground]);const g=racing();
  try{
    p.reset(g);
    for(let i=0;i<100;i++){
      g.obstacles=[{id:'truck-'+i,type:'truck',s:i*80+6,lane:2,kicked:false,hit:false,passed:false,flight:0,originalLane:2}];
      g.s=i*80;p.sync(g,1/60);
      assert.equal(p.vehicles.size,1);
    }
  }finally{p.dispose();}
});

test('reset aligns rider and traffic with the same curved downhill road poses',async()=>{
  const p=await ScenePhysics.create(curve,[]),g=createGame(curve);g.phase='racing';g.s=2;g.lane=1;g.jumpHeight=.4;
  try{
    p.reset(g);nearObject(p.player.translation(),{x:-1,y:.4,z:0});
    const pitch=Math.atan(.2)/2;
    nearObject(p.player.rotation(),{x:Math.sin(pitch),y:0,z:0,w:Math.cos(pitch)});
    nearObject(p.vehicles.get('car').translation(),{x:Math.SQRT2,y:-.4,z:Math.SQRT2});
    nearObject(p.vehicles.get('car').rotation(),{x:Math.cos(Math.PI/8)*Math.sin(pitch),
      y:Math.sin(Math.PI/8)*Math.cos(pitch),z:-Math.sin(Math.PI/8)*Math.sin(pitch),w:Math.cos(Math.PI/8)*Math.cos(pitch)});
  }finally{p.dispose();}
});

test('curved-frame rebasing preserves flying pose and rotates velocities without adding energy',async()=>{
  const p=await ScenePhysics.create(curve,[]),g=createGame(curve);g.phase='racing';g.s=2;
  try{
    p.reset(g);g.obstacles[0].kicked=true;p.sync(g,0);const body=p.vehicles.get('car'),c=Math.SQRT1_2;
    body.setTranslation({x:2,y:3,z:5},true);body.setRotation({x:0,y:c,z:0,w:c},true);
    body.setLinvel({x:2,y:3,z:5},true);body.setAngvel({x:-2,y:.5,z:1},true);
    const energy=Math.hypot(...Object.values(body.linvel()));
    g.s=4;p.sync(g,0);
    nearObject(body.translation(),{x:-3*c,y:3.4,z:7*c-2});
    nearObject(body.rotation(),{x:0,y:Math.sin(Math.PI/8),z:0,w:Math.cos(Math.PI/8)});
    nearObject(body.linvel(),{x:-3*c,y:3,z:7*c});nearObject(body.angvel(),{x:-3*c,y:.5,z:-c});
    near(Math.hypot(...Object.values(body.linvel())),energy);
    for(let i=0;i<20;i++){g.s=2;p.sync(g,0);g.s=4;p.sync(g,0);}
    g.s=2;p.sync(g,0);
    nearObject(body.translation(),{x:2,y:3,z:5},1e-4);nearObject(body.linvel(),{x:2,y:3,z:5},1e-4);
    nearObject(body.angvel(),{x:-2,y:.5,z:1},1e-4);
  }finally{p.dispose();}
});

test('kick impulses follow the nearby vehicle road direction on either side',async()=>{
  for(const side of [-1,1]){
    const p=await ScenePhysics.create(curve,[]),g=createGame(curve);g.phase='racing';g.s=2;
    try{
      p.reset(g);g.obstacles[0].kicked=true;g.obstacles[0].kickSide=side;p.sync(g,0);
      nearObject(p.vehicles.get('car').linvel(),{x:(-side*9+6)*Math.SQRT1_2,y:12,z:(side*9+6)*Math.SQRT1_2});
    }finally{p.dispose();}
  }
});

test('oncoming vehicles keep their reverse pose when released while the kick still points outward',async()=>{
  const data={...curve,obstacles:[{...curve.obstacles[0],speed:-3}]};
  for(const side of [-1,1]){
    const p=await ScenePhysics.create(data,[]),g=createGame(data);g.phase='racing';g.s=2;
    try{
      p.reset(g);const body=p.vehicles.get('car'),pitch=Math.atan(.2)/2;
      nearObject(body.rotation(),{x:Math.sin(Math.PI/8)*Math.sin(pitch),y:Math.cos(Math.PI/8)*Math.cos(pitch),
        z:Math.cos(Math.PI/8)*Math.sin(pitch),w:-Math.sin(Math.PI/8)*Math.cos(pitch)});
      const before=body.rotation();g.obstacles[0].kicked=true;g.obstacles[0].kickSide=side;p.sync(g,0);
      nearObject(body.rotation(),before);
      nearObject(body.linvel(),{x:(-side*9+6)*Math.SQRT1_2,y:12,z:(side*9+6)*Math.SQRT1_2});
    }finally{p.dispose();}
  }
});

test('authored curved surfaces use two bounded fixed cycle roots and support the rider everywhere',async()=>{
  const c=authoredCourse(),p=await ScenePhysics.create(c,roadSurfaces(c)),g=createGame(c);g.phase='racing';
  try{
    p.reset(g);
    const fixed=p.world.bodies.getAll().filter(b=>b.isFixed());
    assert.equal(fixed.length,2);assert.ok(fixed.every(b=>b.numColliders()===60));
    assert.equal(p.world.colliders.len(),121);
    for(const s of [-50,0,818,1599,1610,2400,1000000]){
      g.s=s;p.sync(g,1/60);
      const hit=p.world.castRayAndGetNormal(new RAPIER.Ray({x:0,y:2,z:0},{x:0,y:-1,z:0}),5,true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      assert.ok(hit,`road must support the local rider at ${s}m`);near(hit.timeOfImpact,2,2e-3);
      assert.equal(p.world.bodies.len(),3);assert.equal(p.world.colliders.len(),121);
      assert.ok(fixed.every(b=>Math.hypot(...Object.values(b.linvel()))===0));
    }
    const before=p.world.bodies.getAll().map(b=>[b.translation(),b.rotation()]);
    g.phase='paused';g.s+=400;frames(p,g,30);
    assert.deepEqual(p.world.bodies.getAll().map(b=>[b.translation(),b.rotation()]),before);
  }finally{p.dispose();}
});

test('unsegmented legacy ground stays fixed even when a curved rider origin changes',async()=>{
  const p=await ScenePhysics.create(curve,[ground]),g=createGame(curve);g.phase='racing';g.s=20;
  try{
    p.reset(g);p.sync(g,1/60);
    assert.equal(p.world.bodies.getAll().filter(b=>b.isFixed()).length,0);
    const collider=p.world.colliders.getAll().find(c=>c.shape.type===RAPIER.ShapeType.TriMesh);
    nearObject(collider.translation(),{x:0,y:0,z:0});nearObject(collider.rotation(),{x:0,y:0,z:0,w:1});
  }finally{p.dispose();}
});
