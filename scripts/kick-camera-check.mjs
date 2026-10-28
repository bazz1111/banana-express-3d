// Real Q input, native vertices and Rapier flight; staged target, not an earned run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(process.env.SHOT_DIR||'artifacts/next-steps-kick');fs.mkdirSync(out,{recursive:true});
const channel=process.env.PLAYWRIGHT_CHANNEL??'chrome';
const browser=await chromium.launch({...(channel?{channel}:{}),headless:true,args:['--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const sizes=(process.env.KICK_CAMERA_SIZES||'1280x720,390x844,360x780').split(',').map(size=>size.split('x').map(Number));
const modes=(process.env.KICK_CAMERA_MOTION||'normal,reduced').split(',');
const layouts=(process.env.KICK_CAMERA_LAYOUTS||'left:0:-2.6:-1,right:0:2.6:1').split(',').map(value=>{const [name,heroLane,truckLane,side]=value.split(':');return{name,heroLane:Number(heroLane),truckLane:Number(truckLane),side:Number(side)};});
const report=[];
try{
 for(const [width,height]of sizes)for(const mode of modes)for(const {name,heroLane,truckLane,side}of layouts){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1}),errors=[];page.setDefaultTimeout(600000);
  const label=`${width}-${mode}-${name}`;
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.emulateMedia({reducedMotion:mode==='reduced'?'reduce':'no-preference'});
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor();
  await page.clock.install();await page.clock.pauseAt(new Date());
  await page.click('#start');await page.clock.runFor(3200);
  await page.evaluate(({heroLane,truckLane,side})=>{
   const {game:g,view:v}=window.__bananaGame;
   const adjust=v.kickCamera.adjust.bind(v.kickCamera);
   v.kickCamera.adjust=parameters=>{
    const box=b=>b?{min:b.min.toArray(),max:b.max.toArray()}:null;
    window.__cameraInput={hero:box(parameters.heroBox),truck:box(parameters.vehicleBox),desired:parameters.desired.toArray(),target:parameters.target.toArray(),flight:parameters.flight};
    return adjust(parameters);
   };
   g.phase='racing';g.course.procedural=false;g.bananas=100;g.lane=heroLane;g.lateralSpeed=0;g.speed=12;g.s=30;g.obstacles=[];g.pickups=[];g.cooldowns.kick=0;v.reset(g);
   g.obstacles.push({id:'kick-check',type:'truck',s:g.s+15.2,lane:truckLane,originalLane:truckLane,speed:0,kicked:false,hit:false,passed:false,flight:0});v.update(g,0);
   window.__cameraProbe=()=>{
    const bounds=model=>{
     const min={x:Infinity,y:Infinity},max={x:-Infinity,y:-Infinity};let vertices=0,inside=0;
     model.updateMatrixWorld(true);const point=model.position.clone();
     model.traverseVisible(mesh=>{if(!mesh.isMesh||!mesh.geometry.attributes.position)return;
      const n=mesh.geometry.attributes.position.count,instances=mesh.isInstancedMesh?mesh.count:1,instance=mesh.matrixWorld.clone();
      for(let j=0;j<instances;j++){
       if(mesh.isInstancedMesh)mesh.getMatrixAt(j,instance);
       for(let i=0;i<n;i++){
        mesh.getVertexPosition(i,point);if(mesh.isInstancedMesh)point.applyMatrix4(instance);
        point.applyMatrix4(mesh.matrixWorld).project(v.camera);vertices++;
        if(Math.abs(point.x)<=1&&Math.abs(point.y)<=1&&point.z>=-1&&point.z<=1)inside++;
        min.x=Math.min(min.x,point.x);min.y=Math.min(min.y,point.y);max.x=Math.max(max.x,point.x);max.y=Math.max(max.y,point.y);
       }
      }
     });return {min,max,vertices,inside,allInside:vertices>0&&vertices===inside};
    };
    const actualFoot=v.feet[g.kickSide>0?0:1].getWorldPosition(v.burst.position.clone()),foot=actualFoot.clone();
    foot.add(v.burst.position.clone().set(g.kickSide>0?-.1:.1,0,.04).applyQuaternion(v.player.quaternion));
    const star={visible:v.burst.visible,footOffsetError:v.burst.visible?v.burst.position.distanceTo(foot):0,glowDistance:v.burst.visible?v.burstGlow.position.distanceTo(v.burst.position):0};
    const centers=v.wheels.map(w=>w.getWorldPosition(w.position.clone()));
    const wheelbase=centers[0].distanceTo(centers[1]);centers.forEach(p=>p.project(v.camera));
    const wheelGapX=Math.abs(centers[0].x-centers[1].x)*v.canvas.clientWidth/2;
    return {wheelGapX,wheelbase,star,flight:g.obstacles[0]?.flight??null,truck:v.obstacleModels.has('kick-check')?bounds(v.obstacleModels.get('kick-check')):null,
     hero:bounds(v.player),debris:v.physics.debris.size,camera:v.camera.position.toArray(),target:v.lookTarget.toArray(),fov:v.camera.fov,motion:v.motion,bananas:g.bananas,cargoCount:v.cargo.count,retreat:v.kickCamera.retreat,input:window.__cameraInput??null};
   };
  },{heroLane,truckLane,side});
  const riding=await page.evaluate(()=>window.__cameraProbe());
  assert.equal(riding.motion,mode==='normal');assert.equal(riding.bananas,100);assert.equal(riding.cargoCount,20);assert.ok(Math.abs(riding.wheelbase-1.22)<.01);
  assert.ok(riding.hero.allInside&&riding.wheelGapX>width*.035,'Default native riding shot fits with separated wheels');
  assert.ok((riding.hero.max.y-riding.hero.min.y)/2>=.18,'Default rider remains readable');
  await page.screenshot({path:path.join(out,label+'-riding.png')});
  assert.ok(Math.abs(riding.camera[0])<=4.2,'Default edge camera stays on the road interior');
  await page.keyboard.down('KeyQ');await page.clock.runFor(850);
  const charge=await page.evaluate(()=>window.__bananaGame.game.charge);assert.ok(charge>=.8,'Charge with real held Q input');
  await page.keyboard.up('KeyQ');await page.clock.runFor(16);
  assert.equal(await page.evaluate(()=>window.__bananaGame.game.obstacles[0].kicked),true,'Q release launches the actual target');
  assert.equal(await page.evaluate(()=>window.__bananaGame.game.kickSide),side,'Real Q selects the intended side');
  const samples=[],midPauses=[];let previousLens=riding.fov;
  for(let step=0;step<65;step++){
   if(step)await page.clock.runFor(16);
   const sample=await page.evaluate(()=>window.__cameraProbe());
   samples.push(sample);
   if([0,18].includes(step)||sample.flight>=.6)await page.screenshot({path:path.join(out,`${label}-${step}.png`)});
   // Root visually accepted the extreme edge shot at 17%; ordinary and same-lane remain 18%.
   const readable=(sample.hero.max.y-sample.hero.min.y)/2>=(Math.abs(heroLane)>=4.5?.17:.18);
   if(!sample.truck.allInside||!sample.hero.allInside||sample.wheelGapX<=width*.035||!readable){
    await page.screenshot({path:path.join(out,label+'-failure.png')});
    fs.writeFileSync(path.join(out,'kick-camera-failure.json'),JSON.stringify({gameUrl:page.url(),width,height,mode,side,step,riding,samples},null,2));
   }
   assert.ok(sample.truck.allInside,`${label} flight=${sample.flight}: native truck clipped ${JSON.stringify(sample.truck)}`);
   assert.ok(sample.hero.allInside,label+': native rider/bike/cargo clipped');assert.ok(sample.wheelGapX>width*.035,`${label} flight=${sample.flight}: wheel gap ${sample.wheelGapX}px`);
   assert.ok(readable,`${label} flight=${sample.flight}: rider is too small to read`);assert.ok(Math.abs(sample.camera[0])<=4.2,'Kick camera stays over the road');
   assert.ok(sample.debris>=2&&sample.debris<=12);
   if(mode==='reduced'){
    assert.ok(sample.fov>=previousLens-1e-6,'Safety FOV is held without decorative pulses');
    if(!heroLane)assert.ok(Math.abs(sample.fov-riding.fov)<.001,'Ordinary reduced-motion shots keep the normal lens');
    previousLens=sample.fov;
   }
   if(sample.star.visible){assert.ok(sample.star.footOffsetError<1e-5,'impact star follows kicking foot');assert.ok(sample.star.glowDistance<1e-5,'glow follows star');}
   if(step===18){
    const before=await page.evaluate(()=>{
     const {game:g,view:v}=window.__bananaGame;
     return {camera:v.camera.matrixWorld.toArray(),fov:v.camera.fov,debris:[...v.physics.debris.values()].map(d=>({...d.body.translation()}))};
    });
    await page.keyboard.press('Escape');await page.clock.runFor(160);
    const after=await page.evaluate(()=>{
     const {game:g,view:v}=window.__bananaGame;return {phase:g.phase,state:{camera:v.camera.matrixWorld.toArray(),fov:v.camera.fov,debris:[...v.physics.debris.values()].map(d=>({...d.body.translation()}))}};
    });assert.equal(after.phase,'paused');assert.deepEqual(before,after.state,'Real mid-kick pause retains camera, lens, shake and body poses');
    midPauses.push({step,before,after:after.state});await page.keyboard.press('Escape');
   }
   if(sample.flight>=.6)break;
  }
  assert.ok(samples.at(-1).flight>=.6,'Inspect the complete actual flight window');
  await page.clock.runFor(3000);const returned=await page.evaluate(()=>window.__cameraProbe());
  assert.ok(returned.retreat<.001,'Framing state clears before another kick');assert.ok(returned.hero.allInside,'Return to default riding does not crop the rider');
  assert.ok(Math.abs(returned.camera[2]-riding.camera[2])<.01,'Return to the normal chase distance');
  assert.deepEqual(errors.filter(e=>!/GL Driver Message|GPU stall/.test(e)),[]);
  report.push({gameUrl:page.url(),browser:await browser.version(),ranAt:new Date().toISOString(),width,height,mode,name,heroLane,truckLane,side,minimumHeight:Math.abs(heroLane)>=4.5?.17:.18,strict18Percent:samples.every(sample=>(sample.hero.max.y-sample.hero.min.y)/2>=.18),input:'Real Start; Q held 850ms and released; real Escape pause/resume',charge,riding,samples,midPauses,returned,errors});await page.close();
  fs.writeFileSync(path.join(out,'kick-camera-report.json'),JSON.stringify(report,null,2));console.log('KICK_CAMERA_CASE_PASS',label);
 }
 console.log('KICK_CAMERA_PASS');
}finally{await browser.close();}
