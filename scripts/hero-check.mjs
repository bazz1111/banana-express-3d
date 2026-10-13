// Native render fixtures and real keyboard inputs are reported separately; no earned-run claims.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {roadQuaternion} from '../src/route.ts';
const protectedFiles=['src/game.ts','src/main.js','src/audio.js','src/style.css','src/reference.css','src/physics.ts','src/route.ts','index.html'];
const hashes=()=>Object.fromEntries(protectedFiles.map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const before=hashes(),course=JSON.parse(fs.readFileSync('public/assets/course.json'));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],url=process.env.GAME_URL||'http://127.0.0.1:5173/';
const artifactTag=process.env.HERO_ARTIFACT_TAG||'current';
const sizes=[['desktop',1440,900],['medium',960,900],['portrait',390,844]];
async function open(width,height){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.locator('#start:not([disabled])').waitFor({timeout:45000});await page.clock.install();await page.clock.pauseAt(new Date());
  await page.click('#start');await page.clock.runFor(3200);return page;
}
async function observe(page){
  const distance=await page.evaluate(()=>window.__bananaGame.game.s);
  return page.evaluate(expected=>{
    const {game:g,view:v}=window.__bananaGame;v.scene.updateMatrixWorld(true);
    const Vector=v.player.position.constructor,Matrix=v.player.matrix.constructor,w=v.canvas.clientWidth,h=v.canvas.clientHeight;
    const project=point=>{const p=point.clone().project(v.camera);return {x:(p.x+1)*w/2,y:(1-p.y)*h/2,z:p.z};};
    const empty=()=>({left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity,vertices:0});
    const add=(box,p)=>{box.left=Math.min(box.left,p.x);box.right=Math.max(box.right,p.x);box.top=Math.min(box.top,p.y);box.bottom=Math.max(box.bottom,p.y);box.vertices++;};
    const boundsFor=root=>{
      const bounds=empty();root.traverse(mesh=>{
        if(!mesh.isMesh)return;let parent=mesh;while(parent){if(!parent.visible)return;parent=parent.parent;}
        const p=mesh.geometry.attributes.position;
        for(let i=0;i<p.count;i++)add(bounds,project(new Vector().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld)));
      });return bounds;
    };
    const bike=boundsFor(v.bike),rider=boundsFor(v.rider),cargo=empty(),matrix=new Matrix(),world=new Matrix();
    for(let i=0;i<v.cargo.count;i++){
      v.cargo.getMatrixAt(i,matrix);world.multiplyMatrices(v.cargo.matrixWorld,matrix);
      const p=v.cargo.geometry.attributes.position;for(let k=0;k<p.count;k++)add(cargo,project(new Vector().fromBufferAttribute(p,k).applyMatrix4(world)));
    }
    const wheels=v.wheels.map(wheel=>({center:project(new Vector().setFromMatrixPosition(wheel.matrixWorld)),bounds:boundsFor(wheel)}));
    const rack=v.assets.bananaRack?.getObjectByName('BananaCargo');
    const sources=rack?.children.filter(mesh=>mesh.isMesh).sort((a,b)=>a.name.localeCompare(b.name))??[];
    let nativeMatrixError=0;
    for(let i=0;i<Math.min(sources.length,v.cargo.instanceMatrix.count);i++){
      v.cargo.getMatrixAt(i,matrix);nativeMatrixError=Math.max(nativeMatrixError,...matrix.elements.map((n,k)=>Math.abs(n-sources[i].matrixWorld.elements[k])));
    }
    const sampleMatrices=[];for(let i=0;i<Math.min(2,v.cargo.instanceMatrix.count);i++){v.cargo.getMatrixAt(i,matrix);sampleMatrices.push([...matrix.elements]);}
    const flat=[];v.rider.traverse(mesh=>{if(mesh.isMesh)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])flat.push(material.flatShading);});
    const forward=new Vector(0,0,1).applyQuaternion(v.player.quaternion),expectedForward=new Vector(0,0,1).applyQuaternion(new v.player.quaternion.constructor().copy(expected));
    const foot=v.feet[g.kickSide>0?0:1].getWorldPosition(new Vector()),burst=v.burst.getWorldPosition(new Vector());
    return {phase:g.phase,s:g.s,viewTime:v.time,lane:g.lane,stance:g.stance,stanceBlend:v.stanceBlend,bananas:g.bananas,jump:g.jumpHeight,kickPose:g.kickPose,kickSide:g.kickSide,cooldown:g.cooldowns.kick,
      width:w,height:h,camera:v.camera.position.toArray(),target:v.lookTarget.toArray(),fov:v.camera.fov,cameraSide:v.player.position.x-v.camera.position.x,cameraBack:-v.camera.position.z,
      bike,rider,cargo,burstBounds:v.burst.visible?boundsFor(v.burst):null,wheels,wheelGapX:Math.abs(wheels[0].center.x-wheels[1].center.x),forwardError:forward.distanceTo(expectedForward),
      capacity:v.cargo.instanceMatrix.count,count:v.cargo.count,ropesVisible:v.bike.getObjectByName('CargoRopes').visible,sourceBundles:sources.length,bundleNames:sources.map(mesh=>mesh.name),
      nativeGeometry:sources.length>0&&v.cargo.geometry===sources[0].geometry,nativeMaterial:sources.length>0&&v.cargo.material===sources[0].material,
      sourceGeometries:new Set(sources.map(mesh=>mesh.geometry)).size,burstVisible:v.burst.visible,burstDistance:burst.distanceTo(foot),burstFacingError:1-Math.abs(v.burst.quaternion.dot(v.camera.quaternion)),footPosition:foot.toArray(),burstPosition:burst.toArray(),
      nativeMatrixError:sources.length?nativeMatrixError:null,sampleMatrices,riderFlatShading:flat.some(Boolean),worldFlatShading:v.roadTiles[0].children.find(mesh=>mesh.userData.surfaceRole==='road').material.flatShading};
  },roadQuaternion(course,distance,distance));
}
function checkFrame(frame,label){
  assert.equal(frame.phase,'racing',label+' must be racing');
  assert.ok(frame.forwardError<1e-6,label+' must preserve real forward direction');
  for(const [name,box] of [['bike',frame.bike],['rider',frame.rider],...frame.wheels.map((wheel,i)=>['wheel'+i,wheel.bounds]),...(frame.count?[['cargo',frame.cargo]]:[]),...(frame.burstBounds?[['burst',frame.burstBounds]]:[])]){
    assert.ok(box.vertices>0&&box.left>=2&&box.right<=frame.width-2&&box.top>=2&&box.bottom<=frame.height-2,label+' crops '+name+' '+JSON.stringify(box));
  }
  assert.ok(frame.wheelGapX>frame.width*.035,label+' must expose both wheel silhouettes');
  if(frame.kickPose>.24&&frame.kickPose<.56){assert.equal(frame.burstVisible,true);assert.ok(frame.burstDistance<.3,label+' burst must follow the kicking foot, distance='+frame.burstDistance);assert.ok(frame.burstFacingError<1e-6,label+' burst must face the current camera');}
}
function compact(frame){const {sampleMatrices,...rest}=frame;return rest;}
const edges=box=>box?[box.left,box.right,box.top,box.bottom]:null;
const margin=(box,frame)=>Math.min(box.left,frame.width-box.right,box.top,frame.height-box.bottom);
const worstBurst={margin:Infinity};
async function kickWindow(page,viewport,stance,side,jump){
  // Only the course/car/pose are fixtures. Q and optional Space use the real input and rules.
  await page.evaluate(({stance,side})=>{
    const {game:g,view:v}=window.__bananaGame;g.course.procedural=false;
    Object.assign(g,{phase:'racing',s:260,lane:0,lateralSpeed:0,bananas:100,stance,jumpHeight:0,jumpVelocity:0,charge:0,kickPose:0,kickSide:1,accumulator:0,pickups:[],events:[],obstacles:[{id:'probe',type:'car',s:266,lane:side*2.5,originalLane:side*2.5,speed:13,kicked:false,hit:false,passed:false,flight:0}]});
    g.cooldowns.kick=0;g.held.jump=false;Object.assign(g.buffs,{boost:0,shield:0,double:0});v.reset(g);
  },{stance,side});
  await page.clock.runFor(450);await page.keyboard.down('KeyQ');await page.clock.runFor(100);
  if(jump)await page.keyboard.down('Space');await page.keyboard.up('KeyQ');
  const frames=[],failures=[];let visibleFrames=0,maxViewGap=0,lastViewTime=null;
  // Playwright's fixed clock dispatches rAF every 16ms; inspect every rendered frame through 900ms.
  for(let ms=0;ms<=900;ms+=16){
    const frame=await observe(page);
    if(lastViewTime!==null)maxViewGap=Math.max(maxViewGap,frame.viewTime-lastViewTime);lastViewTime=frame.viewTime;
    try{checkFrame(frame,viewport+' '+stance+' Q '+side+(jump?' +Space':'')+' @'+ms+'ms');}catch(error){failures.push({ms,message:error.message});}
    if(frame.burstVisible){
      visibleFrames++;const burstMargin=margin(frame.burstBounds,frame);
      if(burstMargin<worstBurst.margin){
        Object.assign(worstBurst,{margin:burstMargin,viewport,stance,side,jump,ms,s:frame.s,kickPose:frame.kickPose,minNDCX:frame.burstBounds.left/frame.width*2-1,maxNDCX:frame.burstBounds.right/frame.width*2-1,burstBounds:edges(frame.burstBounds),camera:frame.camera,burstToFoot:frame.burstDistance,screenshot:`artifacts/hero-view-q-window-${artifactTag}-worst.png`});
        await page.screenshot({path:worstBurst.screenshot});
      }
    }
    frames.push({ms,s:frame.s,viewTime:frame.viewTime,kickPose:frame.kickPose,jump:frame.jump,forwardError:frame.forwardError,wheelGapX:frame.wheelGapX,burstToFoot:frame.burstDistance,burstFacingError:frame.burstFacingError,boxes:{bike:edges(frame.bike),rider:edges(frame.rider),cargo:edges(frame.cargo),burst:edges(frame.burstBounds)}});
    if(ms<896)await page.clock.runFor(16);
  }
  await page.clock.runFor(4);if(jump)await page.keyboard.up('Space');
  const end=await observe(page);assert.equal(end.kickSide,side);assert.equal(end.kickPose,0);assert.equal(end.burstVisible,false);
  assert.equal(await page.evaluate(()=>window.__bananaGame.game.obstacles.find(o=>o.id==='probe').kicked),true);
  assert.ok(visibleFrames>=18,'Inspect the entire visible Q window');assert.ok(maxViewGap<=.017,'Do not skip rendered frames');
  if(jump)assert.ok(Math.max(...frames.map(frame=>frame.jump))>.8,'Space must produce an actual jump');
  return {viewport,stance,side,jump,visibleFrames,maxViewGap,failures,frames};
}
try{
  const page=await open(1440,900),initial=await observe(page);
  await page.screenshot({path:'artifacts/hero-view-baseline.png'});
  console.log('HERO_VIEW_BASELINE',JSON.stringify(initial));
  assert.equal(initial.capacity,20,'Runtime cargo must use twenty authored bundle transforms, not the old six programmed positions');
  assert.equal(initial.sourceBundles,20);assert.ok(initial.nativeGeometry&&initial.nativeMaterial,'Use unbaked native bundle geometry/material');
  assert.equal(initial.sourceGeometries,1,'Native cargo bundles share one geometry');
  assert.deepEqual(initial.bundleNames,Array.from({length:20},(_,i)=>'CargoBundle'+String(i).padStart(2,'0')));
  assert.ok(initial.nativeMatrixError<1e-4,'Native cargo matrices must not be replaced or double transformed');
  assert.equal(initial.bananas,0);assert.equal(initial.count,0,'Start with an empty native rack');assert.equal(initial.ropesVisible,false);
  assert.equal(initial.riderFlatShading,false,'Respect the new rider native normals');assert.equal(initial.worldFlatShading,true);
  const countFixtures=[];
  for(const bananas of [0,5,100,150]){
    await page.evaluate(bananas=>{const {game:g,view:v}=window.__bananaGame;g.bananas=bananas;v.update(g,0);},bananas);
    const frame=await observe(page);assert.equal(frame.count,Math.min(20,Math.floor(bananas/5)));assert.equal(frame.bananas,bananas);assert.equal(frame.ropesVisible,bananas>=20);assert.ok(frame.nativeMatrixError<1e-4);
    countFixtures.push({bananas,count:frame.count,capacity:frame.capacity,ropesVisible:frame.ropesVisible,nativeMatrixError:frame.nativeMatrixError});
  }
  const fixtures=[];
  for(const [name,width,height] of sizes){
    await page.setViewportSize({width,height});
    const cases=[
      ['seated',{stance:'seated',lane:0}],['standing',{stance:'standing',lane:0}],
      ['left-jump',{stance:'standing',lane:-4.6,jumpHeight:1.3}],['right-jump',{stance:'seated',lane:4.6,jumpHeight:1.3}],
      ['kick-right',{stance:'standing',lane:0,kickSide:1,kickPose:.35}],['kick-left',{stance:'seated',lane:0,kickSide:-1,kickPose:.35}],
      ['jump-kick-right',{stance:'standing',lane:-4.6,jumpHeight:1.3,kickSide:1,kickPose:.35}],['jump-kick-left',{stance:'seated',lane:4.6,jumpHeight:1.3,kickSide:-1,kickPose:.35}],
    ];
    for(const [action,pose] of cases){
      await page.evaluate(pose=>{
        const {game:g,view:v}=window.__bananaGame;Object.assign(g,{phase:'racing',s:0,bananas:100,speed:12,lane:0,lateralSpeed:0,jumpHeight:0,jumpVelocity:0,kickPose:0,kickSide:1,charge:0,obstacles:[],pickups:[],...pose});
        v.resize();v.reset(g);for(let i=0;i<4;i++)v.update(g,.1);
      },pose);
      await page.clock.runFor(17);
      const frame=await observe(page);checkFrame(frame,name+' fixture '+action);
      await page.screenshot({path:`artifacts/hero-view-${name}-fixture-${action}.png`});fixtures.push({viewport:name,action,...compact(frame)});
    }
  }
  await page.close();
  const inputs=[];
  for(const [name,width,height] of sizes){
    const input=await open(width,height);
    await input.keyboard.press('KeyC');await input.clock.runFor(800);let frame=await observe(input);assert.equal(frame.stance,'standing');assert.ok(frame.stanceBlend>.99);checkFrame(frame,name+' C');
    await input.screenshot({path:`artifacts/hero-view-${name}-input-standing.png`});inputs.push({viewport:name,action:'real C',...compact(frame)});
    await input.keyboard.down('KeyA');await input.clock.runFor(1900);await input.keyboard.down('Space');await input.clock.runFor(450);await input.keyboard.up('Space');
    frame=await observe(input);assert.ok(frame.lane< -4.5&&frame.jump>.8);checkFrame(frame,name+' real left boundary jump');
    await input.screenshot({path:`artifacts/hero-view-${name}-input-left-jump.png`});inputs.push({viewport:name,action:'real A+Space',...compact(frame)});await input.keyboard.up('KeyA');
    await input.keyboard.down('KeyD');await input.clock.runFor(3300);await input.keyboard.down('Space');await input.clock.runFor(450);await input.keyboard.up('Space');
    frame=await observe(input);assert.ok(frame.lane>4.5&&frame.jump>.8);checkFrame(frame,name+' real right boundary jump');
    await input.screenshot({path:`artifacts/hero-view-${name}-input-right-jump.png`});inputs.push({viewport:name,action:'real D+Space',...compact(frame)});await input.keyboard.up('KeyD');
    await input.keyboard.press('KeyC');await input.clock.runFor(800);frame=await observe(input);assert.equal(frame.stance,'seated');checkFrame(frame,name+' seated');
    inputs.push({viewport:name,action:'real C to seated',...compact(frame)});await input.close();
    for(const stance of ['seated','standing'])for(const side of [-1,1]){
      const kick=await open(width,height);
      if(stance==='standing'){await kick.keyboard.press('KeyC');await kick.clock.runFor(800);}
      // Only the target is an isolated fixture; charge, release, kick side and flight use real Q input/rules.
      await kick.evaluate(side=>{const g=window.__bananaGame.game;g.obstacles.push({id:'hero-kick-target',type:'truck',s:g.s+18,lane:g.lane+side,originalLane:g.lane+side,kicked:false,hit:false,passed:false,flight:0});},side);
      await kick.keyboard.down('KeyQ');await kick.clock.runFor(850);await kick.keyboard.up('KeyQ');await kick.clock.runFor(350);
      frame=await observe(kick);assert.equal(frame.stance,stance);assert.equal(frame.kickSide,side);assert.ok(frame.kickPose>.24&&frame.kickPose<.56&&frame.cooldown>17);checkFrame(frame,name+' real Q '+stance+' '+side);
      assert.equal(await kick.evaluate(()=>window.__bananaGame.game.obstacles.find(o=>o.id==='hero-kick-target').kicked),true);
      await kick.screenshot({path:`artifacts/hero-view-${name}-input-${stance}-kick-${side}.png`});inputs.push({viewport:name,action:'real Q '+stance+' with isolated truck target',...compact(frame)});await kick.close();
    }
  }
  const sequences=[];
  for(const [name,width,height] of sizes){
    const page=await open(width,height);
    for(const stance of ['seated','standing'])for(const side of [-1,1])for(const jump of [false,true])sequences.push(await kickWindow(page,name,stance,side,jump));
    await page.close();
  }
  assert.equal(errors.length,0,errors.join('\n'));assert.deepEqual(hashes(),before,'Protected core files must remain unchanged');
  console.log('HERO_Q_SEQUENCE_REPORT',JSON.stringify({url,artifactTag,sequences,worstBurst,errors,protectedHashes:before}));
  assert.equal(sequences.flatMap(sequence=>sequence.failures).length,0,'Q full animation must stay within the frame');
  console.log('HERO_VIEW_PASS',JSON.stringify({countFixtures,fixtures,inputs,sequenceWindows:sequences.length,sequenceFrames:sequences.reduce((n,sequence)=>n+sequence.frames.length,0),worstBurst,errors,protectedHashes:before}));
}finally{await browser.close();}
