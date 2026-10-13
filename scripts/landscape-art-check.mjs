// Scene/reference proof: isolated distances, actual GL pixels, native matrices. No scored-run claims.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const tag=process.env.LANDSCAPE_ART_TAG||'current',url=process.env.GAME_URL||'http://127.0.0.1:5173/';
try{
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('#start:not([disabled])').waitFor({timeout:45000});await page.clock.install();await page.clock.pauseAt(new Date());await page.click('#start');await page.clock.runFor(3200);
  const samples=[];
  for(const [viewport,width,height] of [['desktop',1440,900],['medium',960,900],['portrait',390,844]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>window.__bananaGame.view.resize());
  for(const distance of [0,200,600,900,1200,1599.99,1600.01,2500,1000010]){
    await page.evaluate(s=>{const {game:g,view:v}=window.__bananaGame;g.course.procedural=false;Object.assign(g,{s,phase:'racing',lane:0,lateralSpeed:0,stance:'seated',jumpHeight:0,jumpVelocity:0,bananas:100,obstacles:[],pickups:[],kickPose:0});v.reset(g);v.update(g,0);},distance);
    await page.clock.runFor(17);
    // The RAF above refreshes the racing HUD but advances simulation by one tick.
    // Restore the exact fixture distance so both sides of the 1600m seam are rendered.
    await page.evaluate(s=>{const {game:g,view:v}=window.__bananaGame;g.s=s;v.reset(g);v.update(g,0);},distance);
    const report=await page.evaluate(s=>{
      const {game:g,view:v}=window.__bananaGame;
      const gl=v.renderer.getContext(),w=v.canvas.width,h=v.canvas.height;
      const pixels=()=>{v.update(g,0);const p=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
      const mountains=['ValleyMountains','ValleyMountainsB','ValleyMidMountains','ValleyMidMountainsB'].map(n=>v.valleyBatches[n]);
      const on=pixels();mountains.forEach(m=>m.visible=false);const off=pixels();mountains.forEach(m=>m.visible=true);
      let changed=0;for(let y=Math.floor(h*.35);y<h*.95;y++)for(let x=Math.floor(w*.08);x<w*.88;x++){
        const i=(y*w+x)*4;if(Math.abs(on[i]-off[i])+Math.abs(on[i+1]-off[i+1])+Math.abs(on[i+2]-off[i+2])>5)changed++;
      }
      const water=v.valleyTiles.map(tile=>tile.getObjectByName('ValleyWater'));
      water.forEach(m=>m.visible=false);const noWater=pixels();water.forEach(m=>m.visible=true);
      let bayPixels=0,bayUpperLeftPixels=0;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;
        if(Math.abs(on[i]-noWater[i])+Math.abs(on[i+1]-noWater[i+1])+Math.abs(on[i+2]-noWater[i+2])>5){bayPixels++;if(x<w/2&&y>h/2)bayUpperLeftPixels++;}}
      pixels();
      const Matrix=v.player.matrix.constructor;let maxMatrixError=0,shared=true;
      const groups=['ValleyMountains','ValleyMountainsB','ValleyMidMountains','ValleyMidMountainsB','ValleyFoothills','ValleyFoothillsB','ValleyClouds','ValleyCloudsB','ValleyCloudsC'],counts={};
      for(const group of groups){const batch=v.valleyBatches[group],sources=v.assets.valley.getObjectByName(group)?.children.filter(o=>o.isMesh);
        counts[group]=batch?.count??0;if(!batch||!sources)continue;
        if(batch.parent!==v.farPanorama)throw new Error('Panorama group was rebased as a valley tile');
        for(let i=0;i<sources.length;i++){const matrix=new Matrix();batch.getMatrixAt(i,matrix);maxMatrixError=Math.max(maxMatrixError,...matrix.elements.map((n,k)=>Math.abs(n-sources[i].matrixWorld.elements[k])));
          shared&&=batch.geometry===sources[i].geometry&&batch.material===sources[i].material;}
      }
      return {distance:s,renderDistance:g.s,hudDistance:document.getElementById('distance').textContent,width:w,height:h,mountainPixels:changed,mountainFraction:changed/(w*h),bayPixels,bayFraction:bayPixels/(w*h),bayUpperLeftFraction:bayUpperLeftPixels/(w*h/4),counts,maxMatrixError,shared,geometry:v.renderer.info.memory.geometries,textures:v.renderer.info.memory.textures};
    },distance);
    await page.screenshot({path:`artifacts/landscape-art-${tag}-${viewport}-${String(distance).replace('.','-')}.png`});samples.push({viewport,...report});
  }
  }
  const report={tag,url,samples,errors,scope:'Exact frozen scene-distance fixtures after real Start. HUD distance is from the preceding RAF; 100 bananas are injected. Not earned player distance or full-image fidelity.'};
  fs.writeFileSync(`artifacts/landscape-art-${tag}.json`,JSON.stringify(report,null,2)+'\n');console.log('LANDSCAPE_ART_REPORT',JSON.stringify(report));
  assert.ok(samples.every(s=>s.mountainFraction>.0115),'The native mid + far blue mountain bands must remain visible after turns and periods');
  assert.ok(samples.every(s=>s.counts.ValleyMountains+s.counts.ValleyMountainsB===24&&s.counts.ValleyMidMountains+s.counts.ValleyMidMountainsB===16&&s.counts.ValleyFoothills+s.counts.ValleyFoothillsB===18&&s.counts.ValleyClouds+s.counts.ValleyCloudsB+s.counts.ValleyCloudsC===24),'Panorama requires all native depth-band/shape variants');
  assert.ok(samples.every(s=>s.maxMatrixError<1e-4&&s.shared),'Preserve native source matrices and shared geometry');assert.equal(errors.length,0);console.log('LANDSCAPE_ART_PASS');
  assert.ok(samples.every(s=>s.renderDistance===s.distance),'Render both exact sides of the course period');
}finally{await browser.close();}
