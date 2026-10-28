// Actual deformed mesh clearance, sampled every two 60 Hz animation frames.
// Pose fixtures exercise the runtime mixer/IK, not an earned playthrough.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true}),report=[],errors=[];
const tag=process.env.CARGO_ARTIFACT_TAG||'current',base=process.env.GAME_URL||'http://127.0.0.1:4175/';
const rigs=(process.env.CARGO_RIGS||'skinned').split(',');
fs.mkdirSync('artifacts',{recursive:true});
function tree(faces){
  const box=new THREE.Box3();for(const f of faces)box.union(f.box);
  if(faces.length<=10)return {box,faces};
  const size=box.getSize(new THREE.Vector3()),axis=size.x>size.y?(size.x>size.z?'x':'z'):(size.y>size.z?'y':'z');
  faces.sort((a,b)=>a.box.min[axis]+a.box.max[axis]-b.box.min[axis]-b.box.max[axis]);const mid=faces.length>>1;
  return {box,left:tree(faces.slice(0,mid)),right:tree(faces.slice(mid))};
}
function triangles(data){
  const vertices=data.vertices.map(p=>new THREE.Vector3(...p)),faces=[];
  for(let i=0;i<data.indices.length;i+=3){const points=data.indices.slice(i,i+3).map(k=>vertices[k]);faces.push({points,box:new THREE.Box3().setFromPoints(points),part:data.parts?.[i/3]??data.name});}
  return {name:data.name,vertices,faces,tree:tree([...faces])};
}
const ray=new THREE.Ray(),point=new THREE.Vector3();
function cuts(a,b){
  for(let i=0;i<3;i++){const direction=a[(i+1)%3].clone().sub(a[i]),length=direction.length();if(length<1e-9)continue;
    ray.set(a[i],direction.multiplyScalar(1/length));if(ray.intersectTriangle(...b,false,point)){const d=point.distanceTo(a[i]);if(d>1e-7&&d<length-1e-7)return point.clone();}}
  return null;
}
function intersections(a,b,hits){
  if(!a.box.intersectsBox(b.box))return;
  if(a.faces&&b.faces){for(const x of a.faces)for(const y of b.faces)if(x.box.intersectsBox(y.box)){const p=cuts(x.points,y.points)||cuts(y.points,x.points);if(p)hits.push({body:x,point:p});}return;}
  if(a.faces){intersections(a,b.left,hits);intersections(a,b.right,hits);}
  else {intersections(a.left,b,hits);intersections(a.right,b,hits);}
}
// Independently known crossing and separated triangles guard the geometry detector.
const detectorFace=points=>({points:points.map(p=>new THREE.Vector3(...p)),box:new THREE.Box3().setFromPoints(points.map(p=>new THREE.Vector3(...p)))});
const detectorBase=tree([detectorFace([[0,0,0],[1,0,0],[0,1,0]])]),detectorHits=[];
intersections(detectorBase,tree([detectorFace([[.2,.2,-1],[.2,.2,1],[.8,.2,0]])]),detectorHits);
assert.ok(detectorHits.length>0,'Triangle detector must reject a known surface crossing');
const detectorSeparated=[];intersections(detectorBase,tree([detectorFace([[2,2,-1],[2,2,1],[3,2,0]])]),detectorSeparated);
assert.equal(detectorSeparated.length,0,'Separated triangles must stay clear');
// Depth is a measured interior body vertex's nearest distance to the closed
// banana surfaces. This is a lower bound on penetration, not a maximum-volume claim.
function penetration(points,cargo){
  let depth=0;const direction=new THREE.Vector3(.813,.337,.477).normalize(),closest=new THREE.Vector3();
  for(const p of points){if(!cargo.tree.box.containsPoint(p))continue;const crossings=[];let nearest=Infinity;ray.set(p,direction);
    for(const f of cargo.faces){const tri=new THREE.Triangle(...f.points);nearest=Math.min(nearest,p.distanceTo(tri.closestPointToPoint(p,closest)));
      if(ray.intersectTriangle(...f.points,false,point)){const d=p.distanceTo(point);if(d>1e-7&&!crossings.some(x=>Math.abs(x-d)<1e-6))crossings.push(d);}}
    if(crossings.length%2)depth=Math.max(depth,nearest);
  }return depth;
}
const scenarios=[{name:'seated-pedal',stance:'seated',frames:120},{name:'standing-balance',stance:'standing',frames:120},
  {name:'sit-to-stand',stance:'seated',to:'standing',frames:42},{name:'stand-to-sit',stance:'standing',to:'seated',frames:42}];
for(const stance of ['seated','standing']){
  for(const side of [-1,1])scenarios.push({name:`${stance}-lean-${side}`,stance,lean:side,frames:30},{name:`${stance}-charge-${side}`,stance,charge:side,frames:24},{name:`${stance}-kick-${side}`,stance,kick:side,frames:42});
  scenarios.push({name:`${stance}-jump`,stance,jump:true,frames:66});
}
try{
 for(const rig of rigs){
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  const url=new URL(base);if(rig==='legacy')url.searchParams.set('rig','legacy');else url.searchParams.delete('rig');
  await page.goto(url.href);await page.locator('#start:not([disabled])').waitFor({timeout:90000});await page.clock.install();await page.clock.pauseAt(new Date());
  for(const scenario of scenarios.filter(s=>!process.env.CARGO_SCENARIOS||new RegExp(process.env.CARGO_SCENARIOS).test(s.name))){
    await page.evaluate(s=>{const {game:g,view:v}=window.__bananaGame;g.course.procedural=false;
      Object.assign(g,{phase:'racing',s:260,speed:12,bananas:100,stance:s.stance,jumpHeight:0,jumpVelocity:0,kickPose:0,kickSide:1,lane:0,lateralSpeed:0,charge:0,obstacles:[],pickups:[],events:[]});
      v.reset(g);v.update(g,0);if(s.to)g.stance=s.to;
    },scenario);
    let cargo=null;const samples=[];let screenshot=null,depthMeasured=new Set();
    for(let frame=0;frame<=scenario.frames;frame+=2){
      const data=await page.evaluate(({s,frame,wantCargo})=>{
        const {game:g,view:v}=window.__bananaGame;
        for(let f=frame?frame-1:0;f<=frame;f++){
          const t=f/60;
          if(s.lean)g.lateralSpeed=s.lean*3.5*Math.sin(Math.min(1,t/.5)*Math.PI/2);
          if(s.charge){g.charge=t/.4;g.kickSide=s.charge;}
          if(s.kick){g.kickPose=Math.max(0,.7-t);g.kickSide=s.kick;}
          if(s.jump){g.jumpHeight=Math.max(0,6.4*t-6*t*t);g.jumpVelocity=g.jumpHeight>0?6.4-12*t:0;}
          v.update(g,f===0?0:1/60);
        }
        v.scene.updateMatrixWorld(true);v.rider.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
        const Vector=v.player.position.constructor,Matrix=v.player.matrix.constructor,inv=v.player.matrixWorld.clone().invert();
        const mesh=(o,matrix,name)=>{
          const geometry=o.geometry,indices=geometry.index?Array.from(geometry.index.array):Array.from({length:geometry.attributes.position.count},(_,i)=>i);
          const vertices=Array.from({length:geometry.attributes.position.count},(_,i)=>o.getVertexPosition(i,new Vector()).applyMatrix4(matrix).toArray());
          let parts;
          if(o.isSkinnedMesh){const skin=geometry.attributes.skinIndex,weight=geometry.attributes.skinWeight;parts=[];
            for(let i=0;i<indices.length;i+=3){const totals={};for(const v of indices.slice(i,i+3))for(let n=0;n<4;n++){const b=skin.getComponent(v,n),w=weight.getComponent(v,n);totals[b]=(totals[b]??0)+w;}const bone=Object.keys(totals).sort((a,b)=>totals[b]-totals[a])[0];parts.push(o.skeleton.bones[bone].name);}}
          return {name,vertices,indices,parts};
        };
        const body=[],cargo=[],finishing=[];v.rider.traverse(o=>{if(o.isMesh)body.push(mesh(o,inv.clone().multiply(o.matrixWorld),o.name));});
        if(wantCargo)for(const group of v.cargoGroups)for(let i=0;i<group.count;i++){const m=new Matrix();group.getMatrixAt(i,m);m.premultiply(group.matrixWorld).premultiply(inv);cargo.push(mesh(group,m,`CargoBundle${String(group.userData.globalIndices[i]).padStart(2,'0')}`));}
        if(wantCargo)v.cargoRopes.traverseVisible(o=>{if(o.isMesh)finishing.push(mesh(o,inv.clone().multiply(o.matrixWorld),o.name));});
        const a=v.riderAnimator,contacts=a.contactErrors.map(e=>({joint:e.bone,error:e.error}));
        const stance=a.stanceBlend;
        if(g.jumpHeight===0&&(stance<.00001||stance>.99999))for(let i=0;i<2;i++){
          const tag=i?'R':'L',kicking=(g.kickPose>0||g.charge>0)&&(g.kickSide>0?i===0:i===1);
          const position=o=>o.getWorldPosition(new Vector()).applyMatrix4(inv);
          if(!kicking){const sole=v.rider.getObjectByName('Sole_'+tag),support=v.bike.getObjectByName((stance>.5?'RiderStand_':'RiderPedal_')+tag);contacts.push({joint:'Sole_'+tag,error:position(sole).distanceTo(position(support))});}
          if(stance<.00001){const palm=v.rider.getObjectByName('Palm_'+tag),grip=v.bike.getObjectByName('RiderGrip_'+tag);contacts.push({joint:'Palm_'+tag,error:position(palm).distanceTo(position(grip))});}
        }
        return {body,cargo,finishing,contacts,stanceBlend:stance,crank:v.crank.rotation.x,jump:g.jumpHeight,kickPose:g.kickPose,mode:v.rigMode};
      },{s:scenario,frame,wantCargo:!cargo});
      assert.equal(data.mode,rig);if(!cargo){cargo=data.cargo.map(triangles);assert.equal(cargo.length,20);assert.equal(new Set(cargo.map(x=>x.name)).size,20);cargo.push(...data.finishing.map(triangles));}
      const hits=[];for(const b of data.body.map(triangles))for(const c of cargo){const pairs=[];intersections(b.tree,c.tree,pairs);if(!pairs.length)continue;
        const parts={};for(const p of pairs)parts[p.body.part]=(parts[p.body.part]??0)+1;
        const bounds=new THREE.Box3().setFromPoints(pairs.map(p=>p.point)),key=c.name+'/'+Object.keys(parts).join(',');let depth=null;
        if(!depthMeasured.has(key)){depthMeasured.add(key);const unique=new Map();for(const hit of pairs)for(const p of hit.body.points)unique.set(p.toArray().join(','),p);depth=penetration([...unique.values()],c);}
        hits.push({body:b.name,parts,cargo:c.name,intersectingTrianglePairs:pairs.length,intersectionBounds:bounds.min.toArray().concat(bounds.max.toArray()),sampledPenetrationLowerBoundM:depth});}
      const sample={frame,seconds:frame/60,stanceBlend:data.stanceBlend,crank:data.crank,jump:data.jump,kickPose:data.kickPose,contacts:data.contacts,hits};samples.push(sample);
      if((hits.length||data.contacts.some(c=>c.error>=.01))&&!screenshot){screenshot=`artifacts/cargo-clearance-${tag}-${rig}-${scenario.name}.png`;await page.screenshot({path:screenshot});console.log('CARGO_DEFECT',JSON.stringify({rig,scenario:scenario.name,screenshot,...sample}));}
    }
    report.push({rig,scenario:scenario.name,samples,screenshot});
  }
  await page.close();
 }
 assert.deepEqual(errors,[]);const bad=report.flatMap(r=>r.samples.filter(s=>s.hits.length||s.contacts.some(c=>c.error>=.01)).map(s=>({rig:r.rig,scenario:r.scenario,frame:s.frame,hits:s.hits,contacts:s.contacts.filter(c=>c.error>=.01)})));
 assert.equal(bad.length,0,'Cargo/contact failures: '+JSON.stringify(bad.slice(0,12)));
 console.log('CARGO_RIDER_CLEARANCE_PASS',JSON.stringify({scenarios:report.length,samples:report.reduce((n,r)=>n+r.samples.length,0),rigs,errors}));
}finally{await browser.close();fs.writeFileSync(`artifacts/cargo-clearance-${tag}.json`,JSON.stringify({url:base,scope:'60Hz controlled runtime pose sequences, every two frames; actual SkinnedMesh.getVertexPosition and authored cargo globalIndices. Penetration metric is a sampled lower bound.',report,errors,browserClosed:!browser.isConnected()},null,2));}
