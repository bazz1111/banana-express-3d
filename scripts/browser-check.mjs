import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {obstacleSpecs} from '../src/game.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.env.CHECK_DIR||path.join(root,'artifacts'));fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.addInitScript(()=>{
    window.__renderCheck={calls:0,triangles:0,phases:{},intervals:[],last:{}};
    for(const name of ['drawElements','drawElementsInstanced']){
      const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(mode,count,...rest){
        window.__renderCheck.calls++;if(mode===4)window.__renderCheck.triangles+=count/3*(name==='drawElementsInstanced'?rest[2]:1);
        return original.call(this,mode,count,...rest);
      };
    }
    window.__instrumentFrames=()=>{const raf=requestAnimationFrame.bind(window);let last;
      window.requestAnimationFrame=cb=>raf(time=>{const m=window.__renderCheck,c=m.calls,t=m.triangles;if(last!==undefined)m.intervals.push(time-last);last=time;
        cb(time);m.last={calls:m.calls-c,triangles:m.triangles-t};const phase=document.querySelector('#app')?.dataset.phase||'startup';
        const p=m.phases[phase]??={frames:0,maxCalls:0,maxTriangles:0};p.frames++;p.maxCalls=Math.max(p.maxCalls,m.last.calls);p.maxTriangles=Math.max(p.maxTriangles,m.last.triangles);
      });};window.__instrumentFrames();
  });
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor({timeout:30000});
  await page.waitForTimeout(1400);await page.screenshot({path:path.join(out,'endless-ready.png')});
  const metrics=await page.evaluate(()=>{const m=window.__renderCheck,frames=m.intervals.slice(-60).filter(n=>n>0&&n<500).sort((a,b)=>a-b);return {...m.last,medianFrameMs:frames[Math.floor(frames.length*.5)],p95FrameMs:frames[Math.floor(frames.length*.95)]};});
  await page.clock.install();await page.evaluate(()=>window.__instrumentFrames());
  const state=()=>page.evaluate(()=>{const {game:g,view:v}=window.__bananaGame;return {phase:g.phase,s:g.s,lane:g.lane,lateralSpeed:g.lateralSpeed,speed:g.speed,baseSpeed:g.baseSpeed,bananas:g.bananas,score:g.score,elapsed:g.elapsed,
    objective:g.objective,nearMisses:g.nearMisses,stance:g.stance,charge:g.charge,jumpHeight:g.jumpHeight,kicks:g.kickedCount,cd:g.cooldowns.kick,buffs:g.buffs,obstacles:g.obstacles,pickups:g.pickups,
    models:v.obstacleModels.size,bodies:v.physics.vehicles.size,children:v.scene.children.length};});
  await page.click('#start');await page.clock.runFor(3150);assert.equal((await state()).phase,'racing');
  const held=new Set();
  async function controls(input){const desired=new Set(Object.entries({KeyA:input.steer<0,KeyD:input.steer>0,Space:input.jump,KeyQ:input.kick}).filter(([,v])=>v).map(([k])=>k));
    for(const key of [...held])if(!desired.has(key)){await page.keyboard.up(key);held.delete(key);}
    for(const key of desired)if(!held.has(key)){await page.keyboard.down(key);held.add(key);}}
  let kicked=false,paused=false,shieldSeen=false,boostSeen=false,doubleSeen=false,jumped=false,stood=false,satAgain=false,dashed=false,peakSpeed=0,peakModels=0,peakBodies=0;
  const decisions=[];
  for(let frame=0;frame<2200;frame++){
    const g=await state();if(g.phase!=='racing'){fs.writeFileSync(path.join(out,'endless-autoplay-failure.json'),JSON.stringify({...g,decisions},null,2));await page.screenshot({path:path.join(out,'endless-autoplay-failure.png')});}assert.equal(g.phase,'racing',`Unexpected collision at ${g.s}m`);if(g.s>3600)break;
    peakSpeed=Math.max(peakSpeed,g.speed);
    peakModels=Math.max(peakModels,g.models);peakBodies=Math.max(peakBodies,g.bodies);
    shieldSeen ||= g.buffs.shield>0;boostSeen ||= g.buffs.boost>0;doubleSeen ||= g.buffs.double>0;jumped ||= g.jumpHeight>0;
    const obstacles=g.obstacles.filter(o=>!o.kicked&&!o.hit&&o.s-g.s> -obstacleSpecs[o.type].length/2-1&&o.s-g.s<44);
    const vehicle=obstacles.find(o=>o.type==='truck'&&o.s>g.s&&g.cd===0);
    const jumpable=obstacles.find(o=>!jumped&&!o.crossing&&o.type==='barrier'&&Math.abs(o.lane-g.lane)<obstacleSpecs[o.type].width/2+.4&&o.s-g.s>0);
    const canJump=jumpable&&jumpable.s-g.s<g.speed*.34+obstacleSpecs[jumpable.type].length/2;
    const pickup=g.pickups.find(p=>!p.collected&&p.s-g.s>0&&p.s-g.s<14);
    const candidates=[-4.55,-2.8,-1.4,0,1.4,2.8,4.55,g.lane];
    const score=x=>{
      let cost=Math.abs(x-(pickup?.lane??g.lane))*.35+Math.abs(x-g.lane)*.08;
      if(vehicle)cost+=Math.max(0,Math.abs(x-vehicle.lane)-2.5)*5;
      for(const o of obstacles){const spec=obstacleSpecs[o.type];if(o===vehicle||o===jumpable)continue;
        const arrival=Math.max(0,o.s-g.s-spec.length/2-.8)/Math.max(1,g.speed-(o.speed??0));
        const t=Math.min(1,((o.motionTime??0)+arrival)/(o.crossDuration??4));
        const predicted=o.crossing?Math.max(-4.1,Math.min(4.1,o.originalLane+(o.crossDistance??-2.1)*t*t*(3-2*t))):o.lane;
        // Keep clearance beyond the player's .36m half-width without declaring
        // the usable outer gap beside a train blocked (2.15m vs 1.66m contact).
        const extent=spec.width/2+(o.type==='wall'?.50:.65),gap=o.s-g.s-spec.length/2-.8;
        if(gap/g.speed<Math.abs(x-g.lane)/3.5+.35&&(x-predicted)*(g.lane-predicted)<0)cost+=1000;
        if(Math.abs(x-predicted)<extent)cost+=100/(Math.max(.1,gap/g.speed)+.2);
      }return cost;};
    const desired=candidates.sort((a,b)=>score(a)-score(b))[0];
    let kick=!!vehicle&&vehicle.s-g.s< Math.max(27,g.speed*1.25);
    if(vehicle&&g.charge>=.8&&vehicle.s-g.s<8.5)kick=false;
    const steeringError=desired-g.lane-g.lateralSpeed/9;
    const input={steer:Math.abs(desired)>=4.5?Math.sign(desired):(Math.abs(steeringError)>.07?Math.sign(steeringError):0),jump:!!canJump&&g.jumpHeight===0,kick};
    decisions.push({s:g.s,lane:g.lane,lateralSpeed:g.lateralSpeed,speed:g.speed,desired,input,obstacles:obstacles.map(o=>({type:o.type,s:o.s,lane:o.lane})),candidates:candidates.map(x=>({x,cost:score(x)}))});if(decisions.length>50)decisions.shift();
    await controls(input);await page.clock.runFor(100);
    const after=await state();
    if(!kicked&&after.kicks>0){kicked=true;await page.screenshot({path:path.join(out,'endless-kick.png')});
      const body=await page.evaluate(()=>{const {game,view}=window.__bananaGame,o=game.obstacles.find(o=>o.type==='truck'&&o.kicked),b=view.physics.vehicles.get(o.id),m=view.obstacleModels.get(o.id);return {dynamic:b.isDynamic(),mass:b.mass(),position:b.translation(),model:m.position.toArray()};});
      assert.ok(body.dynamic&&body.mass>3000);assert.deepEqual(body.model,Object.values(body.position));console.log('KICK_BODY',JSON.stringify(body));
    }
    if(!paused&&after.s>250){paused=true;await controls({});await page.keyboard.press('Escape');await page.clock.runFor(100);const before=await state();await page.clock.runFor(2000);
      const frozen=await state();assert.equal(frozen.s,before.s);assert.equal(frozen.elapsed,before.elapsed);assert.deepEqual(frozen.buffs,before.buffs);assert.equal(frozen.phase,'paused');await page.click('#resume');}
    if(!stood&&after.s>450){await page.keyboard.press('KeyC');assert.equal((await state()).stance,'standing');stood=true;}
    if(!satAgain&&after.s>900){await page.click('#stance');assert.equal((await state()).stance,'seated');satAgain=true;}
    if(!dashed&&after.s>3500){await page.keyboard.down('KeyE');await page.clock.runFor(40);await page.keyboard.up('KeyE');dashed=true;}
    if(frame%250===0)console.log('ENDLESS_DISTANCE',Math.round(after.s),'bananas',after.bananas,'speed',after.speed);
  }
  await controls({});const final=await state();assert.ok(final.s>3600,'Must reach the maximum automatic speed beyond the old endpoint');assert.equal(final.baseSpeed,26);assert.ok(dashed&&peakSpeed>=32.5,'Real E input must reach the boosted speed cap');assert.ok(final.bananas>20);assert.ok(final.objective.completed>0,'Natural collected bananas must complete a goal');assert.ok(kicked&&paused&&jumped&&stood&&satAgain);assert.ok(shieldSeen&&boostSeen&&doubleSeen,'All pickup powers should be reachable in actual play');
  await page.screenshot({path:path.join(out,'endless-running.png')});await page.click('#end-run');await page.clock.runFor(120);assert.equal((await state()).phase,'finished');
  assert.ok((await page.locator('#result-reason').textContent()).includes('主动'));await page.screenshot({path:path.join(out,'endless-result.png')});
  await page.click('#restart');await page.clock.runFor(100);const fresh=await state();assert.equal(fresh.bananas,0);assert.equal(fresh.s,0);assert.ok(['ready','countdown'].includes(fresh.phase));
  assert.ok(await page.evaluate(()=>[...window.__bananaGame.view.physics.vehicles.values()].every(b=>b.isKinematic())));
  await page.clock.runFor(16000);
  assert.equal((await state()).phase,'finished','A fresh idle run must end on an unprotected collision');
  assert.ok((await page.locator('#result-reason').textContent()).includes('撞'));
  await page.click('#restart');await page.clock.runFor(100);assert.equal((await state()).s,0);
  const phases=await page.evaluate(()=>window.__renderCheck.phases);assert.ok(phases.racing.maxCalls<=300,JSON.stringify(phases));assert.equal(errors.length,0,errors.join('\n'));
  const report={metrics,phases,final,peakModels,peakBodies,peakSpeed,kicked,paused,jumped,stood,satAgain,dashed,shieldSeen,boostSeen,doubleSeen,collisionEnd:true,errors};delete report.final.obstacles;delete report.final.pickups;
  fs.writeFileSync(path.join(out,'endless-browser-report.json'),JSON.stringify(report,null,2));console.log('ENDLESS_BROWSER_PASS',JSON.stringify({...report,phases}));
}finally{await browser.close();}
