// Real-clock performance sample (no virtual clock). Run it on the target mid-range machine with a GPU:
//   pnpm build && pnpm preview  # then
//   GAME_URL=http://127.0.0.1:4173/ PERF_SECONDS=60 node scripts/perf-check.mjs
// A shield buff is refreshed as a fixture so the run is not cut short by collisions; it is not a player result.
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const seconds=Number(process.env.PERF_SECONDS||30),[width,height]=(process.env.PERF_SIZE||'1920x1080').split('x').map(Number);
const out=path.resolve(process.env.PERF_REPORT||'artifacts/perf-report.json');fs.mkdirSync(path.dirname(out),{recursive:true});
const channel=process.env.PLAYWRIGHT_CHANNEL??'chrome';
const browser=await chromium.launch({...(channel?{channel}:{}),headless:process.env.HEADED!=='1',args:['--ignore-gpu-blocklist']});
const report={seconds,viewport:`${width}x${height}`,tiers:{}};
try{
  for(const quality of ['high','low']){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    const url=new URL(process.env.GAME_URL||'http://127.0.0.1:5173/');url.searchParams.set('quality',quality);
    const start=Date.now();await page.goto(url.href);
    await page.locator('#start:not([disabled])').waitFor({timeout:600000});
    const loadMs=Date.now()-start;
    const transfer=await page.evaluate(()=>performance.getEntriesByType('resource').reduce((n,e)=>n+(e.transferSize||e.encodedBodySize||0),0));
    report.renderer??=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown';});
    await page.evaluate(()=>document.getElementById('start').click());
    await page.waitForFunction(()=>window.__bananaGame.game.phase==='racing',null,{timeout:600000});
    const keep=setInterval(()=>page.evaluate(()=>{const g=window.__bananaGame.game;g.buffs.shield=8;}).catch(()=>{}),500);
    await page.waitForTimeout(seconds*1000);clearInterval(keep);
    const stats=await page.evaluate(()=>({...window.__bananaGame.perf(),distance:window.__bananaGame.game.s,phase:window.__bananaGame.game.phase,
      memoryMB:performance.memory?performance.memory.usedJSHeapSize/1048576:null,geometries:window.__bananaGame.view.renderer.info.memory.geometries,textures:window.__bananaGame.view.renderer.info.memory.textures}));
    report.tiers[quality]={loadMs,transferMB:transfer/1048576,...stats};
    await page.close();
  }
  fs.writeFileSync(out,JSON.stringify(report,null,2));
  console.log('PERF_REPORT',JSON.stringify(report,null,2));
}finally{await browser.close();}
