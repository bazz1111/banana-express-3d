// Actual rAF timing on the available GPU. Shield refresh is a survival fixture,
// not natural-play evidence. No virtual clock, rolling window or slow-frame filtering.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export function summarizeFrames(frames) {
  const intervals=frames.map(f=>f.intervalMs).filter(v=>v!==null&&Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
  const mean=values=>values.reduce((sum,n)=>sum+n,0)/Math.max(1,values.length),percentile=q=>intervals[Math.min(intervals.length-1,Math.floor(intervals.length*q))]??0;
  const calls=frames.map(f=>f.calls),triangles=frames.map(f=>f.triangles),phases={};for(const frame of frames)phases[frame.phase]=(phases[frame.phase]??0)+1;
  return {frames:frames.length,intervals:intervals.length,fps:intervals.length?1000/mean(intervals):0,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),maxFrameMs:intervals.at(-1)??0,calls:mean(calls),maxCalls:calls.reduce((max,n)=>Math.max(max,n),0),triangles:mean(triangles),maxTriangles:triangles.reduce((max,n)=>Math.max(max,n),0),phases};
}
// Executed in the page before any application code creates its WebGL renderer.
export function instrumentPerformance() {
  const sample=window.__bananaPerf={mode:'idle',frames:[],lastTime:null,calls:0,triangles:0};
  for(const prototype of [window.WebGLRenderingContext?.prototype,window.WebGL2RenderingContext?.prototype].filter(Boolean)){
    for(const name of ['drawElements','drawElementsInstanced','drawArrays','drawArraysInstanced']){
      const original=prototype[name];if(!original)continue;
      prototype[name]=function(...args){
        sample.calls++;
        const count=name.startsWith('drawArrays')?args[2]:args[1],instances=name.endsWith('Instanced')?args[name.startsWith('drawArrays')?3:4]:1;
        sample.triangles+=(args[0]===4?count/3:[5,6].includes(args[0])?Math.max(0,count-2):0)*instances;
        return original.apply(this,args);
      };
    }
  }
  const raf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>raf(time=>{
    const calls=sample.calls,triangles=sample.triangles;
    callback(time);
    if(sample.mode==='sample'){
      const game=window.__bananaGame?.game;
      sample.frames.push({timestampMs:time,intervalMs:sample.lastTime===null?null:time-sample.lastTime,calls:sample.calls-calls,triangles:sample.triangles-triangles,phase:game?.phase??'startup',impact:!!game&&(game.kickPose>0||game.obstacles?.some(o=>o.kicked&&o.flight<1.2))});
      sample.lastTime=time;
    }
  });
}
export async function runPerf() {
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
  const seconds=Number(process.env.PERF_SECONDS||60),warmupSeconds=Number(process.env.PERF_WARMUP_SECONDS||5),repeats=Number(process.env.PERF_REPEATS||1),[width,height]=(process.env.PERF_SIZE||'1920x1080').split('x').map(Number);
  const stagedKicks=Number(process.env.PERF_KICKS||0);
  const qualities=process.env.PERF_QUALITY?[process.env.PERF_QUALITY]:['high','low'];
  if(qualities.some(q=>!['high','low'].includes(q)))throw new Error('PERF_QUALITY must be high or low');
  if(!(seconds>0&&warmupSeconds>=0&&Number.isInteger(repeats)&&repeats>0&&width>0&&height>0))throw new Error('Invalid performance sample configuration');
  if(!Number.isInteger(stagedKicks)||stagedKicks<0||stagedKicks*3>seconds)throw new Error('PERF_KICKS must fit the sample at three seconds per kick');
  const out=path.resolve(process.env.PERF_REPORT||'artifacts/perf-report.json');fs.mkdirSync(path.dirname(out),{recursive:true});
  const channel=process.env.PLAYWRIGHT_CHANNEL??'chrome';
  const browser=await chromium.launch({...(channel?{channel}:{}),headless:process.env.HEADED!=='1',args:['--ignore-gpu-blocklist']});
  const report={testedAt:new Date().toISOString(),seconds,warmupSeconds,repeats,viewport:`${width}x${height}`,platform:{os:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model},browser:await browser.version(),fixture:{shieldRefreshed:true,naturalGameplay:false,virtualClock:false,stagedKicks,...(stagedKicks?{initialDistance:3750,lane:4.6,bananas:100,maximumSpeed:true,resetKickCooldown:true,trafficDisabled:true}:{})},method:'All rAF intervals in the complete sample; all WebGL render passes including shadows; no slow-frame filtering',tiers:{}};
  try{
    for(const quality of qualities)for(let repeat=0;repeat<repeats;repeat++){
      const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
      await page.addInitScript(instrumentPerformance);
      const url=new URL(process.env.GAME_URL||'http://127.0.0.1:4173/');url.searchParams.set('quality',quality);
      const start=Date.now();await page.goto(url.href);await page.locator('#start:not([disabled])').waitFor({timeout:600000});
      const loadMs=Date.now()-start;
      const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>({name:new URL(e.name).pathname,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,decodedBodySize:e.decodedBodySize})));
      const gpu=await page.evaluate(()=>{const gl=window.__bananaGame.view.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),version:gl.getParameter(gl.VERSION),userAgent:navigator.userAgent,dpr:devicePixelRatio};});
      report.renderer??=gpu.renderer;report.gpu??=gpu;
      await page.evaluate(()=>{window.__bananaPerfFixture=setInterval(()=>{const game=window.__bananaGame.game;if(game.phase==='racing')game.buffs.shield=8;},100);});
      await page.locator('#start').click();
      await page.waitForFunction(()=>window.__bananaGame.game.phase==='racing',null,{timeout:600000});
      await page.waitForTimeout(warmupSeconds*1000);
      if(stagedKicks)await page.evaluate(()=>{
        const {game:g,view:v}=window.__bananaGame;g.course.procedural=false;
        Object.assign(g,{s:3750,speed:26,baseSpeed:26,lane:4.6,lateralSpeed:0,bananas:100,obstacles:[],pickups:[],events:[]});v.reset(g);
      });
      await page.evaluate(()=>{const m=window.__bananaPerf;m.frames=[];m.lastTime=null;m.startedAt=performance.now();m.mode='sample';});
      const sampleEnd=Date.now()+seconds*1000;
      for(let index=0;index<stagedKicks;index++){
        await page.evaluate(index=>{const g=window.__bananaGame.game;g.cooldowns.kick=0;
          g.obstacles.push({id:'perf-kick:'+index,type:'truck',s:g.s+Math.max(12,g.speed)*.86+7.8,lane:2.4,originalLane:2.4,speed:0,kicked:false,hit:false,passed:false,flight:0});
        },index);
        await page.keyboard.down('KeyQ');await page.waitForTimeout(850);await page.keyboard.up('KeyQ');await page.waitForTimeout(100);
        if(!await page.evaluate(index=>window.__bananaGame.game.obstacles.find(o=>o.id==='perf-kick:'+index)?.kicked,index))throw new Error('The real Q performance fixture missed its staged target');
        await page.waitForTimeout(2000);
      }
      await page.waitForTimeout(Math.max(0,sampleEnd-Date.now()));
      const sample=await page.evaluate(()=>{const m=window.__bananaPerf;m.mode='idle';m.endedAt=performance.now();clearInterval(window.__bananaPerfFixture);const {game,view}=window.__bananaGame;return {frames:m.frames,actualSeconds:(m.endedAt-m.startedAt)/1000,distance:game.s,speed:game.speed,baseSpeed:game.baseSpeed,kicks:game.kickedCount,phase:game.phase,quality:view.quality,memoryMB:performance.memory?performance.memory.usedJSHeapSize/1048576:null,geometries:view.renderer.info.memory.geometries,textures:view.renderer.info.memory.textures};});
      const {frames,...state}=sample,stats=summarizeFrames(frames),transferBytes=resources.reduce((sum,e)=>sum+e.transferSize,0),encodedBodyBytes=resources.reduce((sum,e)=>sum+e.encodedBodySize,0),decodedBodyBytes=resources.reduce((sum,e)=>sum+e.decodedBodySize,0);
      const result={loadMs,transferMB:transferBytes/1048576,encodedBodyMB:encodedBodyBytes/1048576,decodedBodyMB:decodedBodyBytes/1048576,...state,...stats,impact:summarizeFrames(frames.filter(frame=>frame.impact)),gpu,resources,frameSamples:frames,errors};
      report.tiers[quality]=result;if(repeats>1)(report.runs??=[]).push({quality,repeat,...result});
      fs.writeFileSync(out,JSON.stringify(report,null,2));await page.close();
      if(errors.length||!stats.frames||state.phase!=='racing'||Object.keys(stats.phases).some(phase=>phase!=='racing'))throw new Error(`Invalid ${quality} performance sample: ${errors.join('; ')||JSON.stringify(stats.phases)}`);
    }
    console.log('PERF_REPORT',JSON.stringify({...report,runs:report.runs?.map(({frameSamples,resources,...summary})=>summary),tiers:Object.fromEntries(Object.entries(report.tiers).map(([quality,result])=>[quality,{...result,frameSamples:undefined,resources:undefined}]))},null,2));
    return report;
  }finally{await browser.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await runPerf();
