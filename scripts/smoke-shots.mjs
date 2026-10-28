// Browser smoke test + screenshots: real start, riding, staged truck kick captured at the impact frame.
// Waits on game state rather than a virtual clock, so it also works on slow software (SwiftShader) GL in CI.
// Usage: GAME_URL=http://127.0.0.1:5173/ SHOT_DIR=artifacts/shots node scripts/smoke-shots.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const launchers=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browserName=process.env.PLAYWRIGHT_BROWSER||'chromium';
assert.ok(['chromium','firefox','webkit'].includes(browserName),'Unknown Playwright browser');
const quality=process.env.SMOKE_QUALITY||'high';
assert.ok(['high','low'].includes(quality),'Unknown smoke quality');
const out=path.resolve(process.env.SHOT_DIR||'artifacts/shots');fs.mkdirSync(out,{recursive:true});
const channel=process.env.PLAYWRIGHT_CHANNEL??'chrome';
const sizes=(process.env.SHOT_SIZES||'1280x720:desktop,390x844:mobile').split(',').map(v=>{const [s,label]=v.split(':');const [w,h]=s.split('x').map(Number);return [w,h,label];});
const browser=await launchers[browserName].launch({headless:true,...(browserName==='chromium'?{...(channel?{channel}:{}),args:['--ignore-gpu-blocklist','--enable-unsafe-swiftshader',...(process.env.SMOKE_SOFTWARE_GL==='1'?['--use-angle=swiftshader']:[])]}: {})});
const browserVersion=await browser.version();
const slow={timeout:600000,polling:200};
const report={};let activePage,activeLabel;
try{
  for(const [width,height,label] of sizes){
    const touch=height>width;
    const stage=(name,data={})=>console.log(`SMOKE ${browserName}/${label} ${name}`,JSON.stringify(data));
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,hasTouch:touch,...(touch&&browserName!=='firefox'?{isMobile:true}:{})}),errors=[];
    activePage=page;activeLabel=label;
    page.setDefaultTimeout(600000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.addInitScript(()=>{
      window.__frames={calls:0,frames:0,shaderQueries:0};window.__shaderQueryDetails=[];
      for(const name of ['getShaderInfoLog','getProgramInfoLog','getUniformLocation','getAttribLocation']){
        if(!window.WebGL2RenderingContext)break;
        const original=WebGL2RenderingContext.prototype[name];
        WebGL2RenderingContext.prototype[name]=function(...args){
          window.__frames.shaderQueries++;
          if(window.__traceShaders){const p=window.__bananaGame?.view.renderer.info.programs.find(p=>p.program===args[0]||p.vertexShader===args[0]||p.fragmentShader===args[0]);
            window.__shaderQueryDetails.push({name,key:p?.cacheKey,uniform:name==='getUniformLocation'?args[1]:undefined});}
          return original.apply(this,args);
        };
      }
      for(const name of ['drawElements','drawElementsInstanced','drawArrays','drawArraysInstanced']){
        if(!window.WebGL2RenderingContext)break;
        const original=WebGL2RenderingContext.prototype[name];
        WebGL2RenderingContext.prototype[name]=function(...args){window.__frames.calls++;return original.apply(this,args);};
      }
      const raf=requestAnimationFrame.bind(window);
      // window.__freeze pins the timestamp handed to the game loop: dt becomes 0, the scene still renders.
      let last=0;window.requestAnimationFrame=cb=>raf(t=>{window.__frames.frames++;if(window.__freeze)t=last;else last=t;cb(t);});
    });
    const loadStart=Date.now();
    const url=new URL(process.env.GAME_URL||'http://127.0.0.1:5173/');url.searchParams.set('quality',quality);
    await page.goto(url.href);
    const webgl2=await page.evaluate(()=>!!document.createElement('canvas').getContext('webgl2'));
    if(!webgl2){
      if(browserName==='chromium')throw new Error('Chromium smoke requires WebGL2');
      report[label]={status:'skipped',reason:'WebGL2 unavailable in this Playwright runtime',browser:browserName,browserVersion,quality};
      console.log(`::notice::${browserName}/${label} SKIPPED: WebGL2 unavailable; no compatibility pass claimed`);
      await page.close();continue;
    }
    await page.locator('#start:not([disabled])').waitFor({timeout:600000});
    const renderer=await page.evaluate(()=>{const gl=window.__bananaGame.view.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
    const buffer=await page.locator('#game-canvas').evaluate(canvas=>[canvas.width,canvas.height]);
    assert.deepEqual(buffer,[width,height].map(v=>Math.floor(v*(quality==='low'?.8:1))),'Loading warmup must restore the full quality-tier canvas size');
    const loadMs=Date.now()-loadStart;
    stage('ready',{loadMs});
    await page.screenshot({path:path.join(out,`${label}-ready.png`)});
    const tap=async id=>{if(touch){const box=await page.locator('#'+id).boundingBox();assert.ok(box,id+' must be visible');await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);}else await page.locator('#'+id).click();};
    // Chromium uses real touch protocol events for sustained controls. Other engines
    // exercise their shared pointer handlers; the report records that distinction.
    const touchSession=touch&&browserName==='chromium'?await page.context().newCDPSession(page):null;
    const control=async(id,key,down)=>{
      if(!touch){await page.keyboard[down?'down':'up'](key);return;}
      const box=await page.locator('#'+id).boundingBox();assert.ok(box,id+' must be visible');
      const x=box.x+box.width/2,y=box.y+box.height/2;
      if(touchSession)await touchSession.send('Input.dispatchTouchEvent',{type:down?'touchStart':'touchEnd',touchPoints:down?[{x,y,id:1}]:[]});
      else if(down){await page.mouse.move(x,y);await page.mouse.down();}else await page.mouse.up();
    };
    await tap('start');
    await page.waitForFunction(()=>window.__bananaGame.game.phase==='racing',null,slow);
    await page.waitForFunction(()=>window.__bananaGame.game.s>30,null,slow);
    stage('riding');
    // Natural opening is checked above. Subsequent input assertions use an explicit
    // empty-road fixture: slow browser/CI round trips must not reach an unrelated
    // wall and hide the touch buttons while controls are being exercised.
    await page.evaluate(()=>{const g=window.__bananaGame.game;if(g.phase!=='racing')throw new Error('Opening ended before input fixture');
      g.course.procedural=false;g.obstacles=[];g.pickups=[];});
    await page.screenshot({path:path.join(out,`${label}-riding.png`)});
    if(!touch){
      await page.evaluate(()=>{window.__freeze=true;});
      await tap('quality');assert.equal(await page.evaluate(()=>document.activeElement.id),'game-canvas');
      await tap('quality');
      await tap('sound');await page.waitForFunction(()=>document.activeElement.id==='game-canvas',null,slow);await tap('sound');
      await page.waitForFunction(()=>document.activeElement.id==='game-canvas',null,slow);
      await page.keyboard.press('Space');await page.evaluate(()=>{window.__freeze=false;});
      await page.waitForFunction(()=>window.__bananaGame.game.jumpHeight>0,null,slow);
    }
    if(touch){
      const lane=await page.evaluate(()=>window.__bananaGame.game.lane);
      await control('touch-left','KeyA',true);await page.waitForFunction(l=>window.__bananaGame.game.lane<l-.25,lane,slow);await control('touch-left','KeyA',false);
      await control('touch-right','KeyD',true);await page.waitForFunction(l=>window.__bananaGame.game.lane>l-.05,lane,slow);await control('touch-right','KeyD',false);
      await control('touch-jump','Space',true);await page.waitForFunction(()=>window.__bananaGame.game.jumpHeight>0,null,slow);await control('touch-jump','Space',false);
      await tap('stance');assert.equal(await page.evaluate(()=>window.__bananaGame.game.stance),'standing');
      await tap('stance');assert.equal(await page.evaluate(()=>window.__bananaGame.game.stance),'seated');
    }
    // A complete press/release between simulation frames must still register.
    await page.evaluate(()=>{window.__freeze=true;});
    if(touch)await tap('touch-dash');else await page.keyboard.press('KeyE');
    await page.evaluate(()=>{window.__freeze=false;});
    await page.waitForFunction(()=>window.__bananaGame.game.cooldowns.dash>0,null,slow);
    assert.ok(await page.evaluate(()=>window.__bananaGame.game.buffs.boost>0),'E sprint must start a boost');
    assert.match(await page.locator('#dash-seconds').textContent(),/^\d+s$/);
    assert.equal(await page.locator('#banana-capacity').textContent(),'/ 100');
    const before=await page.evaluate(()=>({...window.__frames,t:performance.now()}));
    await page.waitForFunction(f=>window.__frames.frames>=f+5,before.frames,slow);
    const after=await page.evaluate(()=>({...window.__frames,t:performance.now()}));
    const frame={callsPerFrame:(after.calls-before.calls)/(after.frames-before.frames),msPerFrame:(after.t-before.t)/(after.frames-before.frames)};
    stage('controls');
    let cancellationChecks=null;
    if(touchSession){
      await control('touch-kick','KeyQ',true);
      await page.waitForFunction(()=>window.__bananaGame.game.charge>.1,null,slow);
      const beforeCancel=await page.evaluate(()=>{window.__freeze=true;return window.__bananaGame.game.elapsed;});
      await touchSession.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      await page.evaluate(()=>{window.__freeze=false;});
      await page.waitForFunction(t=>window.__bananaGame.game.elapsed>t+.05,beforeCancel,slow);
      assert.equal(await page.evaluate(()=>window.__bananaGame.game.charge),0);
      assert.equal(await page.evaluate(()=>window.__bananaGame.game.cooldowns.kick),0,'Touch cancellation must not spend a kick');
      await page.keyboard.down('KeyQ');await control('touch-kick','KeyQ',true);
      await page.waitForFunction(()=>window.__bananaGame.game.charge>.1,null,slow);
      await page.evaluate(()=>{window.__freeze=true;});
      await touchSession.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      await page.keyboard.up('KeyQ');await page.evaluate(()=>{window.__freeze=false;});
      await page.waitForFunction(()=>window.__bananaGame.game.cooldowns.kick>0,null,slow);
      cancellationChecks={touchCancelPreservedCooldown:true,keyboardReleaseAfterTouchCancel:true};
    }
    // Staged fixture (not a player result): a parked truck right of the rider and 85 bananas on the rack.
    const clearRoad=()=>page.evaluate(()=>{
      const g=window.__bananaGame.game;g.bananas=85;g.lane=0;g.lateralSpeed=0;g.cooldowns.kick=0;
      for(const o of g.obstacles)if(o.s-g.s>-20&&o.s-g.s<60)o.s+=90;
    });
    await clearRoad();await control('touch-kick','KeyQ',true);
    await page.waitForFunction(()=>window.__bananaGame.game.charge>=.82,null,slow);
    // Freeze only this staged fixture while real keyup/touchEnd is delivered.
    // On SwiftShader, asynchronous bounds/input calls can otherwise advance past
    // the stationary truck before release. Resume with the released real input;
    // the normal simulation must still choose and kick the in-range target.
    const releaseFixture=await page.evaluate(()=>{
      window.__freeze=true;const g=window.__bananaGame.game;
      g.bananas=85;g.lane=0;g.lateralSpeed=0;
      for(const o of g.obstacles)if(o.s-g.s>-20&&o.s-g.s<60)o.s+=90;
      g.obstacles.push({id:'smoke-truck',type:'truck',s:g.s+5,lane:2.6,originalLane:2.6,speed:0,kicked:false,hit:false,passed:false,flight:0});
      return {s:g.s,charge:g.charge,lane:g.lane};
    });
    stage('kick-fixture',releaseFixture);
    await page.waitForFunction(f=>window.__frames.frames>=f+2,await page.evaluate(()=>window.__frames.frames),slow);
    // Let the staged truck render while time is frozen. Depth-only programs can
    // be created by its first shadow; impact color variants must already exist.
    const impactPrograms=await page.evaluate(()=>window.__bananaGame.view.renderer.info.programs
      .filter(p=>!/^(depth|distance|distanceRGBA),/.test(p.cacheKey)).map(p=>p.cacheKey));
    const queriesBeforeKick=await page.evaluate(()=>{window.__traceShaders=true;return window.__frames.shaderQueries;});
    await control('touch-kick','KeyQ',false);
    await page.evaluate(()=>{window.__freeze=false;});
    const capture=async(name,condition)=>{
      await page.waitForFunction(condition,null,slow);await page.evaluate(()=>{window.__freeze=true;});
      await page.waitForFunction(f=>window.__frames.frames>=f+2,await page.evaluate(()=>window.__frames.frames),slow);
      await page.screenshot({path:path.join(out,`${label}-${name}.png`)});await page.evaluate(()=>{window.__freeze=false;});
    };
    await capture('kick',()=>window.__bananaGame.game.kickPose>0&&window.__bananaGame.game.kickPose<=.5);
    const state=await page.evaluate(()=>{const {game:g,view:v}=window.__bananaGame,o=g.obstacles.find(o=>o.id==='smoke-truck'),model=v.obstacleModels.get(o?.id);
      const bounds=points=>{const min=[Infinity,Infinity],max=[-Infinity,-Infinity];for(const p of points){p.project(v.camera);for(let i=0;i<2;i++){const n=i?p.y:p.x;min[i]=Math.min(min[i],n);max[i]=Math.max(max[i],n);}}return {min,max};};
      const points=[];model?.traverseVisible(m=>{if(m.isMesh)for(let i=0;i<m.geometry.attributes.position.count;i++)points.push(m.getVertexPosition(i,v.player.position.clone()).applyMatrix4(m.matrixWorld));});
      return {phase:g.phase,kicks:g.kickedCount,bananas:g.bananas,hud:document.getElementById('banana-count').textContent,quality:v.quality,flight:o?.flight,vehicleBounds:points.length?bounds(points):null,
        supportBounds:model?bounds(v.cameraSupports.truck.map(p=>p.clone().applyMatrix4(model.matrixWorld))):null,camera:v.camera.position.toArray(),fov:v.camera.fov};});
    stage('kick-captured',state);
    if(state.flight<=.6)assert.ok(state.vehicleBounds&&state.vehicleBounds.min.every(n=>n>=-1)&&state.vehicleBounds.max.every(n=>n<=1),'The actual truck silhouette must fit the impact frame');
    await capture('kick-after',()=>window.__bananaGame.game.kickPose===0);
    const newImpactPrograms=await page.evaluate(before=>window.__bananaGame.view.renderer.info.programs
      .filter(p=>!/^(depth|distance|distanceRGBA),/.test(p.cacheKey)&&!before.includes(p.cacheKey)).map(p=>p.cacheKey),impactPrograms);
    const firstUseQueries=await page.evaluate(()=>window.__frames.shaderQueries)-queriesBeforeKick;
    const shaderQueryDetails=await page.evaluate(()=>{window.__traceShaders=false;return window.__shaderQueryDetails;});
    const querySources=firstUseQueries?await page.evaluate(keys=>{const v=window.__bananaGame.view,found=[];v.scene.traverse(o=>{if(!o.isMesh)return;for(const m of [].concat(o.material)){
      const programs=v.renderer.properties.get(m).programs;if(keys.some(key=>programs?.has(key)))found.push({mesh:o.name,parent:o.parent?.name,side:m.side,transparent:m.transparent,forceSinglePass:m.forceSinglePass});}});return found;},shaderQueryDetails.map(d=>d.key)):[];
    assert.deepEqual(newImpactPrograms,[],'The first kick must not compile new color shader variants during play');
    assert.equal(firstUseQueries,0,'First-use shader/uniform queries must finish during loading: '+JSON.stringify({details:shaderQueryDetails,sources:querySources}));
    assert.equal(state.phase,'racing');assert.equal(state.kicks,1,'Charged Q must launch the staged truck');
    assert.equal(state.quality,quality,'Smoke must use the reported quality tier');
    if(touch)await tap('pause');else await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.getElementById('app').dataset.phase==='paused',null,slow);
    await page.waitForFunction(f=>window.__frames.frames>=f+2,await page.evaluate(()=>window.__frames.frames),slow);
    const paused=await page.evaluate(()=>({...window.__frames,elapsed:window.__bananaGame.game.elapsed}));
    await page.waitForFunction(f=>window.__frames.frames>=f+5,paused.frames,slow);
    const pauseDrawCalls=await page.evaluate(()=>window.__frames.calls)-paused.calls;
    assert.equal(pauseDrawCalls,0,'An unchanged paused scene must stop GPU submissions');
    assert.equal(await page.evaluate(()=>window.__bananaGame.game.elapsed),paused.elapsed);
    await page.setViewportSize({width:width+1,height});
    await page.waitForFunction(c=>window.__frames.calls>c,paused.calls,slow);
    assert.equal(await page.evaluate(()=>window.__bananaGame.game.phase),'paused','Resizing redraws without advancing play');
    await page.setViewportSize({width,height});
    await tap('end-paused');
    await page.waitForFunction(()=>document.getElementById('app').dataset.phase==='finished',null,slow);
    const fatal=errors.filter(e=>!/GL Driver Message|GPU stall/.test(e));
    assert.deepEqual(fatal,[],'No page or resource errors');
    report[label]={status:'passed',browser:browserName,browserVersion,renderer,quality,input:touch?(touchSession?'real touch':'touch taps + pointer holds'):'keyboard',fixture:{trafficDisabledForControls:true,temporaryReleaseFreeze:true,...releaseFixture},cancellationChecks,shaders:{newImpactPrograms:newImpactPrograms.length,firstUseQueries},paused:{unchangedDrawCalls:pauseDrawCalls,resizeRedrawn:true,simulationFrozen:true},...state,...frame,loadMs};
    await page.close();
  }
  fs.writeFileSync(path.join(out,'smoke-report.json'),JSON.stringify(report,null,2));
  console.log('SMOKE_SHOTS_PASS',JSON.stringify(report));
}catch(error){
  const state=activePage&&!activePage.isClosed()?await activePage.evaluate(()=>{const g=window.__bananaGame?.game;return g?{phase:g.phase,distance:g.s,charge:g.charge,endReason:g.endReason}:null;}).catch(()=>null):null;
  report.failure={label:activeLabel,message:error.message,state};
  fs.writeFileSync(path.join(out,'smoke-report.json'),JSON.stringify(report,null,2));
  if(activePage&&!activePage.isClosed())await activePage.screenshot({path:path.join(out,`${activeLabel}-failure.png`)}).catch(()=>{});
  throw error;
}finally{await browser.close();}
