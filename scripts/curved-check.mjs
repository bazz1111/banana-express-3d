// Actual imported road, collision and authored placement QA. Injected distances are isolated fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {roadPosition,roadQuaternion} from '../src/route.ts';
const course=JSON.parse(fs.readFileSync('public/assets/course.json'));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor({timeout:45000});await page.clock.install();
  const reports=[];
  for(const distance of [0,79.99,80.01,145,395,799.99,1599.99,1600.01,1000010]){
    const expected={truck:roadPosition(course,distance+18,1.7,0,distance),rotation:roadQuaternion(course,distance+18,distance),banana:roadPosition(course,distance+10,-1.2,1.1,distance)};
    const r=await page.evaluate(({distance:s,expected})=>{
      const {game:g,view:v}=window.__bananaGame;g.s=s;g.phase='paused';g.lane=0;g.jumpHeight=0;
      g.obstacles=[{id:'curved:truck',type:'truck',s:s+18,lane:1.7,originalLane:1.7,kicked:false,hit:false,passed:false,flight:0}];
      g.pickups=[{id:'curved:banana',type:'banana',s:s+10,lane:-1.2,height:1.1,collected:false}];
      v.reset(g);v.update(g,0);v.scene.updateMatrixWorld(true);
      const Vector=v.player.position.constructor,Matrix=v.player.matrix.constructor;
      const triangles=role=>v.roadTiles.flatMap(tile=>{
        const mesh=tile.children.find(m=>m.userData.surfaceRole===role),p=mesh.geometry.attributes.position,index=mesh.geometry.index,tri=[];
        for(let i=0;i<index.count;i+=3)tri.push([0,1,2].map(n=>new Vector().fromBufferAttribute(p,index.getX(i+n)).applyMatrix4(mesh.matrixWorld)));
        return tri;
      });
      const terrain=triangles('terrain'),road=triangles('road');
      const groundAt=(tri,x,z)=>{
        let top=-Infinity;
        for(const [a,b,c] of tri){const den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(den)<1e-9)continue;
          const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den,w=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;
          if(u>=-1e-5&&w>=-1e-5&&u+w<=1.00001)top=Math.max(top,u*a.y+w*b.y+(1-u-w)*c.y);
        }if(!Number.isFinite(top))throw new Error('No imported surface below '+[x,z]);return top;
      };
      let roots=0,maxRootError=0,footprints=0,minFoundationClearance=Infinity,maxAuthoredError=0,maxRoadCoordinate=0;
      for(const name of ['palm','tree','bananaPlant','sign']){
        const mesh=v.scenery[name];for(let i=0;i<mesh.count;i++){const m=new Matrix();mesh.getMatrixAt(i,m);const p=new Vector().setFromMatrixPosition(m);
          maxRootError=Math.max(maxRootError,Math.abs(p.y-groundAt(terrain,p.x,p.z)));roots++;}
      }
      const base=v.scenery.foundation;
      for(let i=0;i<base.count;i++){const m=new Matrix();base.getMatrixAt(i,m);const top=new Vector(0,1,0).applyMatrix4(m).y,bottom=new Vector(0,0,0).applyMatrix4(m).y;
        for(const u of [-.5,0,.5])for(const w of [-.5,0,.5]){const p=new Vector(u,0,w).applyMatrix4(m),h=groundAt(terrain,p.x,p.z);
          if(h<bottom-.001)throw new Error('Floating stone base');minFoundationClearance=Math.min(minFoundationClearance,top-h);footprints++;}
      }
      const counts={};
      for(const tile of v.roadTiles){
        const source=v.roadChunks[tile.userData.segment];
        for(const placement of source.scenery){const mesh=v.scenery[placement.kind],i=counts[placement.kind]??0,m=new Matrix();mesh.getMatrixAt(i,m);counts[placement.kind]=i+1;
          const authored=new Matrix().multiplyMatrices(tile.matrixWorld,placement.matrix);maxAuthoredError=Math.max(maxAuthoredError,...m.elements.map((n,c)=>Math.abs(n-authored.elements[c])));
        }
        const mesh=tile.children.find(m=>m.userData.surfaceRole==='road');mesh.geometry.computeBoundingBox();
        for(const x of [mesh.geometry.boundingBox.min.x,mesh.geometry.boundingBox.max.x])for(const y of [mesh.geometry.boundingBox.min.y,mesh.geometry.boundingBox.max.y])for(const z of [mesh.geometry.boundingBox.min.z,mesh.geometry.boundingBox.max.z]){
          const p=new Vector(x,y,z).applyMatrix4(mesh.matrixWorld);maxRoadCoordinate=Math.max(maxRoadCoordinate,Math.abs(p.x),Math.abs(p.y),Math.abs(p.z));
        }
      }
      const wheelGaps=v.wheels.map(w=>{
        const center=new Vector().setFromMatrixPosition(w.matrixWorld);const surface=groundAt(road,center.x,center.z);
        return (center.y-surface)/Math.sqrt(1+.04**2)-.36;
      });
      const model=v.obstacleModels.get('curved:truck'),body=v.physics.vehicles.get('curved:truck'),pickupMatrix=new Matrix();v.pickupMeshes.banana.getMatrixAt(0,pickupMatrix);
      const banana=new Vector().setFromMatrixPosition(pickupMatrix),target=new Vector().copy(expected.truck);
      const modelError=model.position.distanceTo(target),bodyError=new Vector().copy(body.translation()).distanceTo(target);
      const rotationError=model.quaternion.angleTo(new model.quaternion.constructor().copy(expected.rotation));
      const pickupError=banana.distanceTo(new Vector().copy(expected.banana).add(new Vector(0,Math.sin(g.pickups[0].s)*.055,0)));
      const roadTop=groundAt(road,0,0);
      const painted=v.roadTiles[1].children.find(m=>m.userData.surfaceRole==='road');
      // A ray through the actual Rapier road must agree with the imported road triangles.
      const ray={origin:{x:0,y:3,z:0},dir:{x:0,y:-1,z:0},pointAt:t=>({x:0,y:3-t,z:0})};
      v.physics.world.propagateModifiedBodyPositionsToColliders();
      // Reset/paused fixtures have never stepped; a real Rapier step populates the query broad phase.
      v.physics.world.step();
      const hit=v.physics.world.castRay(ray,10,true,undefined,undefined,undefined,v.physics.player);
      return {distance:s,roots,maxRootError,footprints,minFoundationClearance,maxAuthoredError,maxRoadCoordinate,wheelGaps,roadTop,
        colliderTop:hit?3-hit.timeOfImpact:null,modelError,bodyError,rotationError,pickupError,texture:painted.material.map?.image.width,uv:!!painted.geometry.attributes.uv,
        toon:painted.material.isMeshToonMaterial,geometry:v.renderer.info.memory.geometries,textures:v.renderer.info.memory.textures};
    },{distance,expected});
    assert.ok(r.roots>200&&r.maxRootError<.001&&r.maxAuthoredError<.0001,'Use the native Blender placement transforms');
    assert.ok(r.footprints>20&&r.minFoundationClearance>=-.001,'Authored foundations must cover the imported bank');
    assert.ok(r.maxRoadCoordinate<650&&r.wheelGaps.every(n=>Math.abs(n)<.006),'Wheel contact and local coordinates must follow the actual curved asphalt');
    assert.ok(r.colliderTop!==null&&Math.abs(r.colliderTop-r.roadTop)<.003,'Rapier ray must hit the same rendered road');
    assert.ok(r.modelError<.0001&&r.bodyError<.0001&&r.rotationError<.0001&&r.pickupError<.0001,'Truck/pickup transforms must use the shared route');
    assert.ok(r.texture===256&&r.uv&&r.toon,'Blender paint/UV must survive the actual Three.js toon material');
    reports.push(r);
  }
  await page.reload();await page.locator('#start:not([disabled])').waitFor({timeout:45000});
  await page.click('#start');await page.clock.runFor(7000);await page.screenshot({path:'artifacts/curved-racing.png'});
  assert.equal(errors.length,0,errors.join('\n'));fs.writeFileSync('artifacts/curved-road-report.json',JSON.stringify({reports,errors},null,2));console.log('IMPORTED_CURVED_ROAD_PASS',JSON.stringify(reports));
}finally{await browser.close();}
