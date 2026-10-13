// Catch cargo cutting through the actual imported rider, including both shoes.
// This uses isolated poses; it does not claim every intermediate animation frame.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true}),report=[],errors=[];
const tag=process.env.CARGO_ARTIFACT_TAG||'current';
function triangles(data){
  const vertices=data.vertices.map(p=>new THREE.Vector3(...p)),faces=[];
  for(let i=0;i<data.indices.length;i+=3){
    const points=data.indices.slice(i,i+3).map(k=>vertices[k]);
    faces.push({points,box:new THREE.Box3().setFromPoints(points)});
  }
  return {name:data.name,faces,box:new THREE.Box3().setFromPoints(vertices)};
}
const ray=new THREE.Ray(),point=new THREE.Vector3();
function cuts(a,b){
  for(let i=0;i<3;i++){
    const direction=a[(i+1)%3].clone().sub(a[i]),length=direction.length();
    if(length<1e-9)continue;
    ray.set(a[i],direction.multiplyScalar(1/length));
    if(ray.intersectTriangle(...b,false,point)){
      const distance=point.distanceTo(a[i]);if(distance>1e-7&&distance<length-1e-7)return true;
    }
  }
  return false;
}
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor({timeout:45000});
  await page.clock.install();await page.clock.pauseAt(new Date());await page.click('#start');await page.clock.runFor(3200);
  const poses=[['seated',0,0],['standing',0,0],['seated',1.3,0],['standing',1.3,0],['seated',0,.35],['standing',0,.35]];
  for(const [stance,jumpHeight,kickPose] of poses){
    await page.evaluate(({stance,jumpHeight,kickPose})=>{
      const {game:g,view:v}=window.__bananaGame;g.course.procedural=false;
      Object.assign(g,{phase:'racing',s:260,bananas:100,stance,jumpHeight,jumpVelocity:0,kickPose,kickSide:1,lane:0,lateralSpeed:0,charge:0,obstacles:[],pickups:[],events:[]});
      v.reset(g);for(let i=0;i<6;i++)v.update(g,.1);
    },{stance,jumpHeight,kickPose});
    const data=await page.evaluate(()=>{
      const v=window.__bananaGame.view;v.scene.updateMatrixWorld(true);
      const Vector=v.player.position.constructor,Matrix=v.player.matrix.constructor;
      const mesh=(geometry,matrix,name)=>({name,vertices:Array.from({length:geometry.attributes.position.count},(_,i)=>
        new Vector().fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(matrix).toArray()),indices:Array.from(geometry.index.array)});
      const body=[],cargo=[];v.rider.traverse(o=>{if(o.isMesh)body.push(mesh(o.geometry,o.matrixWorld,o.name));});
      for(let i=0;i<v.cargo.count;i++){
        const matrix=new Matrix();v.cargo.getMatrixAt(i,matrix);matrix.premultiply(v.cargo.matrixWorld);
        cargo.push(mesh(v.cargo.geometry,matrix,`CargoBundle${String(i).padStart(2,'0')}`));
      }
      return {body,cargo};
    });
    const body=data.body.map(triangles),cargo=data.cargo.map(triangles),hits=[];
    assert.equal(cargo.length,20);assert.equal(body.filter(m=>m.name.startsWith('Shoe_')).length,2);
    for(const b of body)for(const c of cargo){
      if(!b.box.intersectsBox(c.box))continue;
      let pairs=0;for(const bt of b.faces)for(const ct of c.faces){
        if(bt.box.intersectsBox(ct.box)&&(cuts(bt.points,ct.points)||cuts(ct.points,bt.points)))pairs++;
      }
      if(pairs)hits.push({body:b.name,cargo:c.name,intersectingTrianglePairs:pairs});
    }
    report.push({stance,jumpHeight,kickPose,hits});
  }
  assert.deepEqual(errors,[]);
  assert.ok(report.every(pose=>pose.hits.length===0),'Banana cargo intersects the rider: '+JSON.stringify(report.filter(pose=>pose.hits.length)));
  console.log('CARGO_RIDER_CLEARANCE_PASS',JSON.stringify({poses:report.length,errors}));
}finally{
  await browser.close();fs.writeFileSync(`artifacts/cargo-clearance-${tag}.json`,JSON.stringify({report,errors,browserClosed:!browser.isConnected()},null,2));
}
