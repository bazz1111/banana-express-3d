// Authored GLB vertices must remain entirely in the frame through the first .6s.
// This is stronger than half-car visibility, and avoids an origin-only assertion.
// Controlled physics fixture; it does not replace natural input/real-device tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(process.env.SHOT_DIR||'artifacts/next-steps-kick');fs.mkdirSync(out,{recursive:true});
const channel=process.env.PLAYWRIGHT_CHANNEL??'chrome';
const browser=await chromium.launch({...(channel?{channel}:{}),headless:true,args:['--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const report=[];
try{
 for(const [width,height]of [[390,844],[360,780]])for(const side of [-1,1]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1}),errors=[];page.setDefaultTimeout(600000);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>{const raf=requestAnimationFrame.bind(window);let last=0;window.requestAnimationFrame=cb=>raf(t=>{if(window.__freeze)t=last;else last=t;cb(t);});});
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor();
  await page.evaluate(side=>{
   window.__freeze=true;const {game:g,view:v}=window.__bananaGame;
   g.phase='racing';g.bananas=85;g.lane=0;g.speed=12;g.s=30;g.obstacles=[];g.pickups=[];v.reset(g);
   g.obstacles.push({id:'kick-check',type:'truck',s:g.s+5,lane:side*2.6,originalLane:side*2.6,speed:0,kicked:false,hit:false,passed:false,flight:0});
   v.update(g,0);g.kickPose=.7;g.kickSide=side;g.obstacles[0].kicked=true;g.obstacles[0].kickSide=side;
   v.events([{type:'kick',id:'kick-check',charged:true}],g);v.update(g,1/60);
  },side);
  const samples=[],midPauses=[];
  for(let step=0;step<=36;step++){
   const sample=await page.evaluate(step=>{
    const {game:g,view:v}=window.__bananaGame,o=g.obstacles[0];
    if(step){g.s+=g.speed/60;o.flight+=1/60;g.kickPose=Math.max(0,.7-o.flight);v.update(g,1/60);}
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
    const star={visible:v.burst.visible,actualFootDistance:v.burst.visible?v.burst.position.distanceTo(actualFoot):0,footOffsetError:v.burst.visible?v.burst.position.distanceTo(foot):0,glowDistance:v.burst.visible?v.burstGlow.position.distanceTo(v.burst.position):0};
    const centers=v.wheels.map(w=>w.getWorldPosition(w.position.clone()).project(v.camera));
    const wheelGapX=Math.abs(centers[0].x-centers[1].x)*v.canvas.clientWidth/2;
    return {wheelGapX,star,flight:o.flight,truck:bounds(v.obstacleModels.get('kick-check')),hero:bounds(v.player),debris:v.physics.debris.size};
   },step);
   samples.push(sample);assert.ok(sample.truck.allInside,`${width} side=${side} flight=${sample.flight}: authored truck vertices clipped ${JSON.stringify(sample.truck)}`);
   assert.ok(sample.hero.allInside,`${width} side=${side}: rider clipped`);assert.ok(sample.wheelGapX>width*.035,`${width} side=${side} flight=${sample.flight}: wheel gap ${sample.wheelGapX}px must exceed ${width*.035}px`);assert.ok(sample.debris>=2&&sample.debris<=12);
   if(sample.star.visible){assert.ok(sample.star.footOffsetError<1e-5,'impact star follows kicking foot');assert.ok(sample.star.glowDistance<1e-5,'glow follows star');}
   if([0,18,36].includes(step))await page.screenshot({path:path.join(out,`${width}-side${side}-${step}.png`)});
   if(step===18){
    const state=await page.evaluate(()=>{
     const {game:g,view:v}=window.__bananaGame;
     const capture=()=>({camera:v.camera.matrixWorld.toArray(),debris:[...v.physics.debris.values()].map(d=>({...d.body.translation()}))});
     const before=capture();g.phase='paused';for(let i=0;i<10;i++)v.update(g,.1);const after=capture();g.phase='racing';return {before,after};
    });assert.deepEqual(state.before,state.after,'mid-impact pause retains the rendered shake and body poses');midPauses.push({step,...state});
   }

  }
  const paused=await page.evaluate(()=>{
   const {game:g,view:v}=window.__bananaGame;g.phase='paused';const before={camera:v.camera.matrixWorld.toArray(),debris:[...v.physics.debris.values()].map(d=>({...d.body.translation()}))};
   for(let i=0;i<10;i++)v.update(g,.1);
   return {before,after:{camera:v.camera.matrixWorld.toArray(),debris:[...v.physics.debris.values()].map(d=>({...d.body.translation()}))}};
  });assert.deepEqual(paused.before,paused.after,'pause freezes camera and debris');
  assert.deepEqual(errors.filter(e=>!/GL Driver Message|GPU stall/.test(e)),[]);
  report.push({gameUrl:page.url(),bundle:await page.evaluate(()=>[...document.scripts].map(s=>s.src).filter(Boolean)),browser:await browser.version(),ranAt:new Date().toISOString(),width,height,side,samples,midPauses,errors});await page.close();
 }
 fs.writeFileSync(path.join(out,'kick-camera-report.json'),JSON.stringify(report,null,2));console.log('KICK_CAMERA_PASS');
}finally{await browser.close();}
