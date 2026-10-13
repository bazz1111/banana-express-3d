// Streaming/geometry QA in an isolated browser; distance injection is a test fixture, not a scored run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor({timeout:30000});
  await page.clock.install();await page.click('#start');await page.clock.runFor(3150);
  // Warm every visible obstacle geometry once: GPU uploads are lazy, so a later new type is not a leak.
  await page.evaluate(()=>{const {game:g,view:v}=window.__bananaGame;g.phase='paused';g.obstacles=['barrier','crate','wall','train','truck','car','pedestrian','goat'].map((type,i)=>({id:'warm:'+i,type,s:g.s+25+i*15,lane:0,originalLane:0,kicked:false,hit:false,passed:false,flight:0}));v.reset(g);v.update(g,0);g.obstacles=[];g.phase='racing';});
  // Every authored curved segment has distinct geometry; warm one real rendering of each.
  await page.evaluate(()=>{const {game:g,view:v}=window.__bananaGame;g.phase='paused';
    for(let i=0;i<20;i++){g.s=i*80+20;v.reset(g);v.update(g,0);}g.phase='racing';});
  const reports=[];
  for(const distance of [100,10340,100070,1000010]){
    await page.evaluate(s=>{const {game:g,view:v}=window.__bananaGame;g.s=s;g.invulnerable=1e6;v.reset(g);},distance);
    await page.clock.runFor(100);
    const report=await page.evaluate(()=>{
      const {game:g,view:v}=window.__bananaGame;v.scene.updateMatrixWorld(true);
      const positions=[...v.obstacleModels.values()].map(m=>m.position.toArray());
      const Vector=v.player.position.constructor;
      const tileBounds=v.roadTiles.map(tile=>{const mesh=tile.children.find(m=>m.userData.surfaceRole==='road');mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
        let bound=0;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
          const p=new Vector(x,y,z).applyMatrix4(mesh.matrixWorld);bound=Math.max(bound,Math.abs(p.x),Math.abs(p.y),Math.abs(p.z));}return bound;});
      return {distance:g.s,obstacles:g.obstacles.length,pickups:g.pickups.length,models:v.obstacleModels.size,bodies:v.physics.vehicles.size,
        pooled:[...v.pool.values()].reduce((n,a)=>n+a.length,0),children:v.scene.children.length,
        geometry:v.renderer.info.memory.geometries,textures:v.renderer.info.memory.textures,
        tiles:v.roadTiles.map(t=>t.userData.logical),tileBounds,positions};
    });
    assert.ok(report.obstacles<=16&&report.pickups<=110,'Logic window must remain bounded');
    assert.ok(report.models<=12&&report.bodies<=12&&report.pooled<=45,'Scene/body pools must remain bounded');
    assert.ok(report.tileBounds.every(n=>Number.isFinite(n)&&n<650),'Actual rendered road vertices must stay near the origin');
    assert.ok(report.positions.every(p=>p.every(Number.isFinite)&&Math.abs(p[2])<300),'Rendered coordinates must remain small at a million metres');
    reports.push(report);
  }
  fs.writeFileSync('artifacts/endless-streaming-report.json',JSON.stringify(reports,null,2));
  const baseline=reports[1];assert.ok(reports.slice(2).every(r=>r.children<=baseline.children+12&&r.geometry===baseline.geometry&&r.textures===baseline.textures),'Long running must not keep allocating GPU resources');
  assert.equal(errors.length,0,errors.join('\n'));fs.writeFileSync('artifacts/endless-streaming-report.json',JSON.stringify(reports,null,2));console.log('ENDLESS_STREAMING_PASS',JSON.stringify(reports.map(({positions,...rest})=>rest)));
}finally{await browser.close();}
