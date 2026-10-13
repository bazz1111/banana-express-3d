// Rendering QA against actual local Blender geometry. Pose/distance fixtures do not award a run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor({timeout:45000});await page.clock.install();
  const palette=await page.evaluate(()=>{
    const v=window.__bananaGame.view,counts={red:0,blue:0,yellow:0,green:0};
    for(const name of ['rider','bicycle','banana','palm'])v.assets[name].traverse(o=>{
      if(!o.isMesh)return;const c=o.geometry.attributes.color;if(!c)throw new Error('Missing standard color attribute');
      for(let i=0;i<c.count;i++){const r=c.getX(i),g=c.getY(i),b=c.getZ(i);
        if(name==='rider'&&r>.25&&r>g*2&&r>b*2)counts.red++;
        if(name==='rider'&&b>.05&&b>r*1.6&&b>g*1.3)counts.blue++;
        if(name==='banana'&&r>.5&&g>.25&&b<.05)counts.yellow++;
        if(name==='palm'&&g>r*1.3&&g>b*1.5)counts.green++;
      }
    });return counts;
  });
  assert.ok(Object.values(palette).every(n=>n>100),'Actual GLTFLoader COLOR_0 must preserve red shirt/blue trousers/yellow banana/green leaves');
  const framing=[];
  for(const [width,height] of [[1440,900],[390,844]]){
  await page.setViewportSize({width,height});
  await page.evaluate(()=>window.__bananaGame.view.resize());
  for(const stance of ['seated','standing'])for(const lane of [-4.6,0,4.6])for(const jump of [0,1.36]){
    const r=await page.evaluate(({stance,lane,jump})=>{
      const {game:g,view:v}=window.__bananaGame;g.phase='paused';g.s=40;g.speed=12;g.lane=lane;g.stance=stance;g.jumpHeight=jump;g.kickPose=0;g.bananas=30;
      v.reset(g);v.update(g,0);v.scene.updateMatrixWorld(true);v.camera.updateMatrixWorld(true);
      const Vector=v.player.position.constructor;let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,bikeMinY=Infinity;
      v.rider.traverseVisible(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;
        for(let i=0;i<p.count;i++){const n=new Vector().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).project(v.camera);
          minX=Math.min(minX,n.x);maxX=Math.max(maxX,n.x);minY=Math.min(minY,n.y);maxY=Math.max(maxY,n.y);}
      });
      v.bike.traverseVisible(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;
        for(let i=0;i<p.count;i++)bikeMinY=Math.min(bikeMinY,new Vector().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).project(v.camera).y);});
      const wheels=v.wheels.map(w=>new Vector().setFromMatrixPosition(w.matrixWorld).project(v.camera).toArray());
      const right=new Vector(-lane-1,jump,0).project(v.camera).x,left=new Vector(-lane+1,jump,0).project(v.camera).x;
      return {stance,lane,jump,minX,maxX,minY,maxY,bikeMinY,wheels,right,left,aspect:v.camera.aspect};
    },{stance,lane,jump});
    assert.ok(r.minX>-.97&&r.maxX<.97&&r.minY>-.99&&r.maxY<.99,'Both poses must fit the actual camera');
    assert.ok(Math.abs(r.aspect-width/height)<1e-6,'The projection check must use the current viewport aspect');
    assert.ok(r.bikeMinY>-.995&&r.wheels.every(w=>w[1]>-.95&&w[1]<.95)&&r.right>r.left,'Keep the actual bicycle vertices in frame and D toward screen right');framing.push({...r,width,height});
  }
  }
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>window.__bananaGame.view.resize());
  const lighting=await page.evaluate(()=>{
    const {game:g,view:v}=window.__bananaGame;g.phase='paused';g.s=40;g.stance='seated';g.lane=0;g.jumpHeight=0;g.bananas=30;
    v.reset(g);v.update(g,0);v.scene.updateMatrixWorld(true);
    const depths={},clock=v.windTime.value;
    for(const name of ['palm','tree','bananaPlant']){
      const source=v.scenery[name],shadow=v.sceneryShadows[name],a={uniforms:{},vertexShader:'#include <begin_vertex>'},b={uniforms:{},vertexShader:'#include <begin_vertex>'};
      source.material.onBeforeCompile(a);shadow.customDepthMaterial.onBeforeCompile(b);
      if(a.vertexShader!==b.vertexShader||a.uniforms.uWindTime!==b.uniforms.uWindTime)throw new Error('Color/depth wind diverged');
      shadow.onBeforeShadow=(_r,_o,_c,_s,_g,material)=>{if(material!==shadow.customDepthMaterial)throw new Error('Shadow discarded the native wind depth material');depths[name]=(depths[name]??0)+1;};
    }
    const casters=[...Object.values(v.sceneryShadows),...v.roadTiles.flatMap(t=>t.children.filter(m=>m.userData.surfaceRole==='guard'))];
    const flags=casters.map(m=>m.castShadow),gl=v.renderer.getContext(),w=v.canvas.width,h=v.canvas.height;
    const capture=()=>{
      const fog=v.scene.fog,background=v.scene.background;v.scene.fog=v.panoramaFog;v.sun.castShadow=false;
      v.renderer.render(v.scene,v.panoramaCamera);v.scene.fog=fog;v.sun.castShadow=true;v.renderer.clearDepth();v.scene.background=null;
      v.renderer.render(v.scene,v.camera);v.scene.background=background;
      const pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;
    };
    const on=capture();casters.forEach(m=>m.castShadow=false);const off=capture();casters.forEach((m,i)=>m.castShadow=flags[i]);capture();
    let changed=0,darkening=0;
    for(let y=Math.floor(h*.04);y<h*.50;y++)for(let x=Math.floor(w*.12);x<w*.90;x++){
      const i=(y*w+x)*4,d=(off[i]+off[i+1]+off[i+2])-(on[i]+on[i+1]+on[i+2]);if(d>9){changed++;darkening+=d/3;}
    }
    const darkPixels=changed,meanDarkening=changed?darkening/changed:0;
    const sky=v.sky,oldSkyVisible=sky.visible;sky.visible=false;const noSky=capture();sky.visible=oldSkyVisible;const skyPixels=capture();
    let skyChange=0;for(let y=Math.floor(h*.70);y<h*.98;y++)for(let x=Math.floor(w*.25);x<w*.75;x++){
      const i=(y*w+x)*4;if(Math.abs(skyPixels[i]-noSky[i])+Math.abs(skyPixels[i+1]-noSky[i+1])+Math.abs(skyPixels[i+2]-noSky[i+2])>5)skyChange++;
    }
    return {depths,clock,darkPixels,meanDarkening,skyChange,skySource:!!v.assets.sky.getObjectByName('SkyDome'),
      sourceCount:Object.values(v.scenery).reduce((n,m)=>n+m.count,0),nearCount:Object.values(v.sceneryShadows).reduce((n,m)=>n+m.count,0),
      shadowCounts:Object.fromEntries(Object.entries(v.sceneryShadows).map(([n,m])=>[n,m.count]))};
  });
  assert.ok(lighting.darkPixels>1500&&lighting.meanDarkening>3,'Near native scenery must cast visible shadows on the road');
  assert.ok(Object.values(lighting.depths).every(n=>n>0)&&Object.keys(lighting.depths).length===3,'All three wind silhouettes must really reach the shadow draw');
  assert.ok(lighting.skySource&&lighting.skyChange>10000,'A real Blender dome must shade the sky');
  assert.ok(lighting.nearCount<lighting.sourceCount/2&&Object.values(lighting.shadowCounts).every(n=>n<=64),'Keep shadow instances near the rider');
  await page.evaluate(()=>{window.__cameraProbe=()=>{
    const {game:g,view:v}=window.__bananaGame;v.scene.updateMatrixWorld(true);v.camera.updateMatrixWorld(true);const Vector=v.player.position.constructor;
    let top=-Infinity,bottom=Infinity,left=Infinity,right=-Infinity;v.rider.traverseVisible(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let j=0;j<p.count;j++){
      const n=new Vector().fromBufferAttribute(p,j).applyMatrix4(o.matrixWorld).project(v.camera);top=Math.max(top,n.y);left=Math.min(left,n.x);right=Math.max(right,n.x);
    }});
    v.bike.traverseVisible(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let j=0;j<p.count;j++)bottom=Math.min(bottom,new Vector().fromBufferAttribute(p,j).applyMatrix4(o.matrixWorld).project(v.camera).y);});
    return {height:g.jumpHeight,top,bottom,left,right,phase:g.phase,stance:g.stance,kickPose:g.kickPose,kickSide:g.kickSide,kicks:g.kickedCount,aspect:v.camera.aspect};
  };});
  // Isolated camera fixtures remove traffic; jump/stance/kick still use the real input and simulation.
  const motion=[];
  for(const [width,height] of [[1440,900],[390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>window.__bananaGame.view.resize());
    for(const stance of ['seated','standing'])for(const action of ['jump-left','jump-center','jump-right','kick-left','kick-right']){
      const lane=action==='jump-left'?-4.6:action==='jump-right'?4.6:0;
      await page.evaluate(lane=>{
        const {game:g,view:v}=window.__bananaGame;g.course.procedural=false;g.obstacles=[];g.pickups=[];g.phase='racing';g.s=40;g.speed=12;g.lane=lane;g.lateralSpeed=0;
        g.stance='seated';g.jumpHeight=0;g.jumpVelocity=0;g.held.jump=false;g.kickPose=0;g.charge=0;g.cooldowns.kick=0;g.kickedCount=0;g.buffs={boost:0,shield:0,double:0};
        v.reset(g);v.update(g,0);document.querySelector('#game-canvas').focus();
      },lane);
      if(stance==='standing')await page.keyboard.press('KeyC');
      const steer=action==='jump-left'?'KeyA':action==='jump-right'?'KeyD':null;
      if(steer)await page.keyboard.down(steer);await page.clock.runFor(600);
      const kicking=action.startsWith('kick'),side=action==='kick-right'?1:-1;
      if(kicking){
        await page.keyboard.down('KeyQ');await page.clock.runFor(900);
        await page.evaluate(side=>{const g=window.__bananaGame.game;g.obstacles.push({id:'camera-truck',type:'truck',s:g.s+7,lane:side*2.6,originalLane:side*2.6,kicked:false,hit:false,passed:false,flight:0});},side);
        await page.keyboard.up('KeyQ');
      }else await page.keyboard.down('Space');
      const frames=[];
      for(let i=0;i<28;i++){await page.clock.runFor(34);frames.push(await page.evaluate(()=>window.__cameraProbe()));}
      await page.keyboard.up('Space');if(steer)await page.keyboard.up(steer);
      assert.ok(frames.every(f=>f.phase==='racing'&&f.stance===stance&&f.top<.98&&f.bottom> -1&&f.left> -1&&f.right<1&&Math.abs(f.aspect-width/height)<1e-6),JSON.stringify({width,height,stance,action,frames}));
      if(kicking)assert.ok(frames.some(f=>f.kickPose>0&&f.kicks===1&&f.kickSide===side),'Both Q directions must actually kick the native truck');
      else assert.ok(frames.some(f=>f.height>1),'Space must execute a full real jump');
      motion.push({width,height,stance,action,frames});
    }
  }
  await page.setViewportSize({width:1440,height:900});
  await page.reload();await page.locator('#start:not([disabled])').waitFor({timeout:45000});await page.click('#start');await page.clock.runFor(4000);
  await page.keyboard.press('Escape');await page.clock.runFor(100);const before=await page.evaluate(()=>window.__bananaGame.view.windTime.value);await page.clock.runFor(1000);
  assert.equal(await page.evaluate(()=>window.__bananaGame.view.windTime.value),before,'Pause freezes both visible wind and its shadows');
  await page.click('#resume');await page.clock.runFor(100);await page.click('#quality');await page.clock.runFor(100);
  assert.equal(await page.evaluate(()=>window.__bananaGame.view.renderer.shadowMap.enabled),false);
  assert.ok(await page.evaluate(()=>Object.values(window.__bananaGame.view.sceneryShadows).every(m=>!m.visible)),'Low quality omits shadow-only geometry');
  await page.click('#quality');await page.clock.runFor(100);assert.equal(await page.evaluate(()=>window.__bananaGame.view.renderer.shadowMap.enabled),true);
  assert.equal(errors.length,0,errors.join('\n'));fs.writeFileSync('artifacts/lighting-report.json',JSON.stringify({palette,framing,lighting,motion,errors},null,2));
  console.log('LIGHTING_ART_PASS',JSON.stringify({palette,lighting,staticCases:framing.length,motionCases:motion.length,maxTop:Math.max(...motion.flatMap(c=>c.frames.map(f=>f.top))),minBike:Math.min(...motion.flatMap(c=>c.frames.map(f=>f.bottom))),errors}));
}finally{await browser.close();}
