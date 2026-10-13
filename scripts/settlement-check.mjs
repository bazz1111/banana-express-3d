// Actual visible native settlement pixels; frozen/injected fixtures are not played scores.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const tag=process.env.SETTLEMENT_TAG||'current',url=process.env.GAME_URL||'http://127.0.0.1:5173/';
try{
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#start:not([disabled])').waitFor({timeout:45000});
  await page.clock.install();await page.clock.pauseAt(new Date());
  await page.evaluate(()=>{const g=window.__bananaGame.game;g.course.procedural=false;g.obstacles=[];g.pickups=[];});
  await page.click('#start');await page.clock.runFor(6200);
  const samples=[];
  for(const [viewport,width,height]of [['desktop',1440,900],['medium',960,900],['portrait',390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>window.__bananaGame.view.resize());
    for(const distance of [0,200,600,900,1200,1599.99,1600.01,2500,1000010]){
      await page.evaluate(s=>{const {game:g,view:v}=window.__bananaGame;g.course.procedural=false;Object.assign(g,{s,phase:'racing',lane:0,lateralSpeed:0,stance:'seated',jumpHeight:0,jumpVelocity:0,bananas:100,obstacles:[],pickups:[],kickPose:0,score:0,elapsed:0,combo:1,chain:0,buffs:{boost:0,shield:0,double:0}});v.reset(g);v.update(g,0);},distance);
      await page.clock.runFor(17);
      const r=await page.evaluate(s=>{
        const {game:g,view:v}=window.__bananaGame;g.s=s;v.reset(g);v.update(g,0);
        const gl=v.renderer.getContext(),w=v.canvas.width,h=v.canvas.height;
        const pixels=()=>{v.update(g,0);const p=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
        const on=pixels();
        const batches=groups=>v.valleyTiles.flatMap(t=>groups.map(name=>t.getObjectByName(v.valleyBatches[name].name)));
        const town=[...batches(['ValleyVillageHouse','ValleyVillageLonghouse','ValleyTower','ValleyFoundations']),...['ValleyPanoramaHouse','ValleyPanoramaLonghouse','ValleyPanoramaTower','ValleyPanoramaFoundations'].map(n=>v.valleyBatches[n])];town.forEach(m=>m.visible=false);const noTown=pixels();town.forEach(m=>m.visible=true);
        const woods=[...batches(['ValleyForest','ValleyPalms']),v.valleyBatches.ValleyPanoramaForest];woods.forEach(m=>m.visible=false);const noForest=pixels();woods.forEach(m=>m.visible=true);pixels();
        const changed=off=>{let n=0;for(let i=0;i<on.length;i+=4)if(Math.abs(on[i]-off[i])+Math.abs(on[i+1]-off[i+1])+Math.abs(on[i+2]-off[i+2])>5)n++;return n;};
        return {distance:s,renderDistance:g.s,width:w,height:h,townPixels:changed(noTown),forestPixels:changed(noForest),buildings:v.valleyBatches.ValleyFoundations.count,trees:v.valleyBatches.ValleyForest.count,panoramaBuildings:v.valleyBatches.ValleyPanoramaFoundations.count,panoramaTrees:v.valleyBatches.ValleyPanoramaForest.count};
      },distance);
      await page.screenshot({path:`artifacts/settlement-${tag}-${viewport}-${String(distance).replace('.','-')}.png`});samples.push({viewport,...r,townFraction:r.townPixels/(r.width*r.height),forestFraction:r.forestPixels/(r.width*r.height)});
    }
  }
  const report={tag,url,samples,errors,scope:'Real Start then exact native scene-distance/100-banana fixtures; on/off GL readPixels, not earned scores or whole-image fidelity.'};
  fs.writeFileSync(`artifacts/settlement-${tag}-report.json`,JSON.stringify(report,null,2)+'\n');
  console.log('SETTLEMENT_PIXEL_REPORT',JSON.stringify(report));
  assert.ok(samples.every(s=>s.townFraction>(s.viewport==='portrait'?.0008:.004)),'Town mass should be visibly present through turns and periods');
  assert.ok(samples.every(s=>s.forestFraction>.025),'Forest should form visible canopy masses');
  assert.ok(samples.every(s=>s.renderDistance===s.distance));assert.equal(errors.length,0);console.log('SETTLEMENT_PIXELS_PASS');
}finally{await browser.close();}
