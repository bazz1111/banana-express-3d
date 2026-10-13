// Browser smoke test + screenshots: real start, riding, staged truck kick captured at the impact frame.
// Waits on game state rather than a virtual clock, so it also works on slow software (SwiftShader) GL in CI.
// Usage: GAME_URL=http://127.0.0.1:5173/ SHOT_DIR=artifacts/shots node scripts/smoke-shots.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(process.env.SHOT_DIR||'artifacts/shots');fs.mkdirSync(out,{recursive:true});
const channel=process.env.PLAYWRIGHT_CHANNEL??'chrome';
const sizes=(process.env.SHOT_SIZES||'1280x720:desktop,390x844:mobile').split(',').map(v=>{const [s,label]=v.split(':');const [w,h]=s.split('x').map(Number);return [w,h,label];});
const browser=await chromium.launch({...(channel?{channel}:{}),headless:true,args:['--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const slow={timeout:600000,polling:200};
const report={};
try{
  for(const [width,height,label] of sizes){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1}),errors=[];
    page.setDefaultTimeout(600000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.addInitScript(()=>{
      window.__frames={calls:0,frames:0};
      for(const name of ['drawElements','drawElementsInstanced','drawArrays','drawArraysInstanced']){
        const original=WebGL2RenderingContext.prototype[name];
        WebGL2RenderingContext.prototype[name]=function(...args){window.__frames.calls++;return original.apply(this,args);};
      }
      const raf=requestAnimationFrame.bind(window);
      // window.__freeze pins the timestamp handed to the game loop: dt becomes 0, the scene still renders.
      let last=0;window.requestAnimationFrame=cb=>raf(t=>{window.__frames.frames++;if(window.__freeze)t=last;else last=t;cb(t);});
    });
    const loadStart=Date.now();
    const url=new URL(process.env.GAME_URL||'http://127.0.0.1:5173/');url.searchParams.set('quality','high');
    await page.goto(url.href);
    await page.locator('#start:not([disabled])').waitFor({timeout:600000});
    const loadMs=Date.now()-loadStart;
    await page.screenshot({path:path.join(out,`${label}-ready.png`)});
    await page.evaluate(()=>document.getElementById('start').click());
    await page.waitForFunction(()=>window.__bananaGame.game.phase==='racing',null,slow);
    await page.waitForFunction(()=>window.__bananaGame.game.s>30,null,slow);
    await page.screenshot({path:path.join(out,`${label}-riding.png`)});
    await page.keyboard.down('KeyE');
    await page.waitForFunction(()=>window.__bananaGame.game.cooldowns.dash>0,null,slow);
    await page.keyboard.up('KeyE');
    assert.ok(await page.evaluate(()=>window.__bananaGame.game.buffs.boost>0),'E sprint must start a boost');
    assert.match(await page.locator('#dash-seconds').textContent(),/^\d+s$/);
    assert.equal(await page.locator('#banana-capacity').textContent(),'/ 100');
    const before=await page.evaluate(()=>({...window.__frames,t:performance.now()}));
    await page.waitForFunction(f=>window.__frames.frames>=f+5,before.frames,slow);
    const after=await page.evaluate(()=>({...window.__frames,t:performance.now()}));
    const frame={callsPerFrame:(after.calls-before.calls)/(after.frames-before.frames),msPerFrame:(after.t-before.t)/(after.frames-before.frames)};
    // Staged fixture (not a player result): a parked truck right of the rider and 85 bananas on the rack.
    const clearRoad=()=>page.evaluate(()=>{
      const g=window.__bananaGame.game;g.bananas=85;g.lane=0;g.lateralSpeed=0;g.cooldowns.kick=0;
      for(const o of g.obstacles)if(o.s-g.s>-20&&o.s-g.s<60)o.s+=90;
    });
    await clearRoad();await page.keyboard.down('KeyQ');
    await page.waitForFunction(()=>window.__bananaGame.game.charge>=.82,null,slow);
    await clearRoad();
    await page.evaluate(()=>{const g=window.__bananaGame.game;
      g.obstacles.push({id:'smoke-truck',type:'truck',s:g.s+5,lane:2.6,originalLane:2.6,kicked:false,hit:false,passed:false,flight:0});});
    await page.keyboard.up('KeyQ');
    const capture=async(name,condition)=>{
      await page.waitForFunction(condition,null,slow);await page.evaluate(()=>{window.__freeze=true;});
      await page.waitForFunction(f=>window.__frames.frames>=f+2,await page.evaluate(()=>window.__frames.frames),slow);
      await page.screenshot({path:path.join(out,`${label}-${name}.png`)});await page.evaluate(()=>{window.__freeze=false;});
    };
    await capture('kick',()=>window.__bananaGame.game.kickPose>0&&window.__bananaGame.game.kickPose<=.5);
    const state=await page.evaluate(()=>{const g=window.__bananaGame.game;return {phase:g.phase,kicks:g.kickedCount,bananas:g.bananas,hud:document.getElementById('banana-count').textContent};});
    await capture('kick-after',()=>window.__bananaGame.game.kickPose===0);
    assert.equal(state.phase,'racing');assert.equal(state.kicks,1,'Charged Q must launch the staged truck');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.getElementById('app').dataset.phase==='paused',null,slow);
    await page.evaluate(()=>document.getElementById('end-paused').click());
    await page.waitForFunction(()=>document.getElementById('app').dataset.phase==='finished',null,slow);
    const fatal=errors.filter(e=>!/GL Driver Message|GPU stall/.test(e));
    assert.deepEqual(fatal,[],'No page or resource errors');
    report[label]={...state,...frame,loadMs};
    await page.close();
  }
  fs.writeFileSync(path.join(out,'smoke-report.json'),JSON.stringify(report,null,2));
  console.log('SMOKE_SHOTS_PASS',JSON.stringify(report));
}finally{await browser.close();}
