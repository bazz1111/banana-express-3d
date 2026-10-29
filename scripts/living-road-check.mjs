// Continuous animation/camera + real input checks. Explicit staged obstacles are
// fixtures; virtual-clock results are functional evidence, never FPS evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(process.env.CHECK_DIR||'artifacts/living-road-20261030');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const report={method:'Real keyboard/touch input; virtual clock functional checks with explicitly staged traffic; not performance or human fun evidence',cases:[]};
try{
 for(const [width,height] of [[1280,720],[390,844],[740,390]]){
  const page=await browser.newPage({viewport:{width,height},hasTouch:width<height,deviceScaleFactor:1}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5193/?seed=2817');await page.locator('#start:not([disabled])').waitFor({timeout:120000});
  await page.clock.install();
  await page.evaluate(()=>{
   const raf=requestAnimationFrame.bind(window);window.__shots=[];window.__shotTag='start';
   window.requestAnimationFrame=cb=>raf(t=>{cb(t);const {game:g,view:v}=window.__bananaGame;
    window.__shots.push({t,tag:window.__shotTag,phase:g.phase,s:g.s,lane:g.lane,p:v.cameraFollow.position.toArray(),q:v.camera.quaternion.toArray(),fov:v.camera.fov,side:v.cameraRoadSide,charge:g.charge,kick:g.kickPose,
      actors:[...v.obstacleModels].filter(([id])=>id.startsWith('living:')).map(([id,m])=>({id,p:m.position.toArray(),q:m.quaternion.toArray(),legs:m.userData.animator.legs.map(l=>l.node.quaternion.toArray())}))});
   });
  });
  await page.click('#start');await page.clock.runFor(6000);
  assert.equal(await page.evaluate(()=>window.__bananaGame.game.phase),'racing');
  const layout=await page.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};
    return{goal:rect('.run-objective'),score:rect('.hud-secondary'),buffs:rect('#buffs')};
  });
  const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  assert.ok(!overlaps(layout.goal,layout.score)&&!overlaps(layout.goal,layout.buffs),'Goal must not overlap score or buffs');
  await page.evaluate(()=>{const g=window.__bananaGame.game;g.course.procedural=false;g.obstacles=[];g.pickups=[];});
  for(const key of ['KeyD','KeyA','KeyD']){await page.keyboard.down(key);await page.clock.runFor(3000);await page.keyboard.up(key);}
  await page.evaluate(()=>{window.__shotTag='animals';const g=window.__bananaGame.game;
   g.lane=0;g.lateralSpeed=0;const make=(id,type,lane,s,extra={})=>({id:'living:'+id,type,s:g.s+s,lane,originalLane:lane,kicked:false,hit:false,passed:false,jumpCleared:false,flight:0,motionTime:0,travel:0,velocityS:0,velocityLane:0,heading:0,nearMissGap:Infinity,nearMissBlocked:false,...extra});
   g.obstacles=[make('goat','goat',-2.4,28,{crossing:true,crossDistance:-1.2,crossDuration:4,wakeDistance:60,heading:Math.PI/2}),make('ped','pedestrian',2.4,34,{speed:.55,wakeDistance:60}),make('idle','goat',3.5,22)];
  });
  for(let i=0;i<8;i++){await page.clock.runFor(160);if(i===1||i===4||i===7)await page.screenshot({path:path.join(out,`${width}-walk-${i}.png`)});}
  await page.keyboard.press('Escape');await page.clock.runFor(100);const paused=await page.evaluate(()=>({obstacles:window.__bananaGame.game.obstacles,cam:window.__bananaGame.view.camera.position.toArray()}));await page.clock.runFor(1200);
  assert.deepEqual(await page.evaluate(()=>({obstacles:window.__bananaGame.game.obstacles,cam:window.__bananaGame.view.camera.position.toArray()})),paused);await page.click('#resume');
  await page.evaluate(()=>{const g=window.__bananaGame.game;g.obstacles=[];g.pickups=[];g.lane=0;g.lateralSpeed=0;window.__shotTag='recenter';});await page.clock.runFor(900);
  await page.evaluate(()=>{const g=window.__bananaGame.game;window.__shotTag='kick';g.cooldowns.kick=0;
   g.obstacles=[{id:'living:truck',type:'truck',s:g.s+g.speed*.85+7,lane:2.4,originalLane:2.4,speed:1.6,wakeDistance:60,kicked:false,hit:false,passed:false,jumpCleared:false,flight:0,motionTime:0,travel:0,velocityS:0,velocityLane:0,heading:0}];});
  if(width<height){const session=await page.context().newCDPSession(page),box=await page.locator('#touch-kick').boundingBox();await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});await page.clock.runFor(900);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await page.keyboard.down('KeyQ');await page.clock.runFor(900);await page.keyboard.up('KeyQ');}
  await page.clock.runFor(160);assert.equal(await page.evaluate(()=>window.__bananaGame.game.kickedCount),1);
  await page.screenshot({path:path.join(out,`${width}-kick.png`)});await page.clock.runFor(1600);
  const cooldown=await page.evaluate(()=>window.__bananaGame.game.cooldowns.kick);assert.ok(cooldown>6&&cooldown<7);
  await page.keyboard.down('KeyQ');await page.clock.runFor(100);await page.keyboard.up('KeyQ');assert.equal(await page.evaluate(()=>window.__bananaGame.game.kickedCount),1);
  await page.clock.runFor(6600);assert.equal(await page.evaluate(()=>window.__bananaGame.game.cooldowns.kick),0);
  await page.evaluate(()=>{window.__shotTag='car-tap';const g=window.__bananaGame.game;g.obstacles=[{id:'living:car',type:'car',s:g.s+6,lane:2.4,originalLane:2.4,speed:0,kicked:false,hit:false,passed:false,flight:0}];});
  await page.keyboard.down('KeyQ');await page.clock.runFor(32);await page.keyboard.up('KeyQ');await page.clock.runFor(300);assert.equal(await page.evaluate(()=>window.__bananaGame.game.kickedCount),2);
  await page.clock.runFor(1600);
  await page.evaluate(()=>{const g=window.__bananaGame.game;g.obstacles=[];g.objective={index:0,progress:0,completed:0};g.pickups=Array.from({length:12},(_,i)=>({id:'goal:'+i,type:'banana',s:g.s+2+i*.15,lane:g.lane,height:1.25,collected:false}));});await page.clock.runFor(600);
  assert.equal(await page.evaluate(()=>window.__bananaGame.game.objective.completed),1);assert.ok((await page.locator('#objective-label').textContent()).includes('安全'));
  await page.screenshot({path:path.join(out,`${width}-goal.png`)});
  await page.click('#end-run');assert.equal(await page.evaluate(()=>window.__bananaGame.game.phase),'finished');assert.ok((await page.locator('#result-objectives').textContent()).includes('1 个目标'));
  await page.click('#restart');await page.clock.runFor(200);assert.equal(await page.evaluate(()=>window.__bananaGame.game.objective.completed),0);
  const frames=await page.evaluate(()=>window.__shots),max={position:0,rotation:0,fov:0},perTag={};
  for(let i=1;i<frames.length;i++){
   const a=frames[i-1],b=frames[i];if(a.phase==='finished'||b.phase==='finished'||b.s<a.s||a.tag!==b.tag)continue;
   const dt=(b.t-a.t)/1000;if(dt<=0)continue;
   const position=Math.hypot(...b.p.map((v,j)=>v-a.p[j])),rotation=2*Math.acos(Math.min(1,Math.abs(a.q.reduce((s,v,j)=>s+v*b.q[j],0)))),fov=Math.abs(b.fov-a.fov);
   for(const [key,value]of Object.entries({position,rotation,fov})){max[key]=Math.max(max[key],value);(perTag[b.tag]??={position:0,rotation:0,fov:0})[key]=Math.max(perTag[b.tag][key],value);}
   assert.ok(position<=12*Math.min(.1,dt)+.001,`camera position jump ${position} at ${b.tag}`);
   assert.ok(rotation<=1.8*Math.min(.1,dt)+.00001,`camera angle jump ${rotation} at ${b.tag}`);
   assert.ok(fov<=60*Math.min(.1,dt)+.001,`FOV jump ${fov} at ${b.tag}`);
  }
  const walkers=frames.filter(f=>f.tag==='animals'),goat=walkers.map(f=>f.actors.find(a=>a.id==='living:goat')).filter(Boolean),idle=walkers.map(f=>f.actors.find(a=>a.id==='living:idle')).filter(Boolean);
  assert.ok(goat.length>20&&goat.some(a=>JSON.stringify(a.legs)!==JSON.stringify(goat[0].legs)));
  assert.ok(idle.length>20&&idle.every(a=>JSON.stringify(a.legs)===JSON.stringify(idle[0].legs)),'Idle goat must never march in place');
  assert.deepEqual(errors,[]);report.cases.push({width,height,status:'pass',frames:frames.length,max,perTag,errors,layout,touchKick:width<height,objectives:true,pauseFrozen:true,restart:true,cooldownSeconds:8});
  fs.writeFileSync(path.join(out,`${width}-frames.json`),JSON.stringify(frames));await page.close();
 }
 fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
