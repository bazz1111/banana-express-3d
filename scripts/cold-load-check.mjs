// Cold contexts on the available machine, with a real network throttle.
// This is a Chromium loading measurement, not target-device FPS acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
const budget={maxEncodedBytes:30e6,maxReadyMs:{high:6000,low:8000}};
const report={testedAt:new Date().toISOString(),browser:await browser.version(),headless:true,passed:false,budget,network:{downloadMbps:50,latencyMs:50,cacheDisabled:true},runs:[]};
try{
  for(const quality of ['high','low'])for(let repeat=0;repeat<3;repeat++){
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],encodings={};
    page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);encodings[new URL(r.url()).pathname]=r.headers()['content-encoding']||'identity';});
    const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:50,downloadThroughput:50e6/8,uploadThroughput:10e6/8,connectionType:'wifi'});
    const url=new URL(process.env.GAME_URL||'http://127.0.0.1:4173/');url.searchParams.set('quality',quality);
    const start=performance.now();await page.goto(url.href);await page.locator('#start:not([disabled])').waitFor({timeout:30000});
    const loadedMs=performance.now()-start;
    const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,encoded:r.encodedBodySize,decoded:r.decodedBodySize,transfer:r.transferSize})));
    const encodedBytes=resources.reduce((n,r)=>n+r.encoded,0),transferBytes=resources.reduce((n,r)=>n+r.transfer,0);
    report.runs.push({quality,repeat,loadedMs,encodedBytes,transferBytes,errors,encodings});await page.close();
    // The agreed game budget is 30MB at first play, including JavaScript and
    // physics. The earlier 12MB gate described the retired pre-Tripo assets.
    assert.deepEqual(errors,[]);assert.ok(encodedBytes<budget.maxEncodedBytes,'First-play resource transfer exceeded the agreed 30MB budget');
    assert.ok(loadedMs<budget.maxReadyMs[quality],'Cold load exceeded the stated local loading gate');
  }
  report.passed=true;
  console.log('COLD_LOAD_PASS',JSON.stringify({...report,runs:report.runs.map(({encodings,...r})=>r)}));
}finally{fs.writeFileSync(process.env.LOAD_REPORT||'artifacts/next-cold-load.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
