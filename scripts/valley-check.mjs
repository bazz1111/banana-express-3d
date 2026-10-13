import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cyclePosition,framePosition,frameQuaternion,rebasePosition} from '../src/route.ts';
const course=JSON.parse(fs.readFileSync('public/assets/course.json'));
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor({timeout:30000});await page.clock.install();
  // Injected distances isolate imported layout and rebasing; they are not player-earned distance.
  const inspectValley=distance=>{
    const {game:g,view:v}=window.__bananaGame;g.s=distance;g.phase='paused';v.reset(g);v.update(g,0);v.scene.updateMatrixWorld(true);
    const Vector=v.player.position.constructor,Matrix=v.player.matrix.constructor;
    let matrixError=0,instances=0;
    for(const [group,batch] of Object.entries(v.valleyBatches)){
      let source=v.assets.valley.getObjectByName(group).children.filter(o=>o.isMesh);
      if(batch.userData.fullCount)source=[...source.filter((_,i)=>i%2===0),...source.filter((_,i)=>i%2===1)];
      if(source.length!==batch.count)throw new Error('Missing authored instances');
      for(let i=0;i<source.length;i++){
        if(source[i].geometry!==batch.geometry||source[i].material!==batch.material)throw new Error('Batch discarded a material/geometry variant');
        // Authored source transforms remain the instance-local matrices, before tile rebasing.
        const m=new Matrix();batch.getMatrixAt(i,m);matrixError=Math.max(matrixError,...m.elements.map((n,c)=>Math.abs(n-source[i].matrixWorld.elements[c])));instances++;
      }
    }
    const [first,next]=v.valleyTiles;
    if(first.matrix===next.matrix||first.matrixWorld===next.matrixWorld)throw new Error('Valley tiles share a mutable transform');
    let sharedGeometryMeshes=0,independentInstanceMatrices=0;
    for(const mesh of first.children){
      const other=next.getObjectByName(mesh.name);
      if(!other||mesh.geometry!==other.geometry||mesh.material!==other.material)throw new Error('Valley tiles must share authored geometry/materials');
      if(mesh.matrix===other.matrix||mesh.matrixWorld===other.matrixWorld)throw new Error('Cloned valley meshes share a mutable transform');
      sharedGeometryMeshes++;
      if(mesh.isInstancedMesh){
        if(mesh.instanceMatrix===other.instanceMatrix||mesh.instanceMatrix.array===other.instanceMatrix.array)throw new Error('Valley tiles share an instance matrix buffer');
        if(mesh.count!==other.count)throw new Error('Cloned valley batch lost instances');
        for(let i=0;i<mesh.count;i++){
          const a=new Matrix(),b=new Matrix();mesh.getMatrixAt(i,a);other.getMatrixAt(i,b);
          matrixError=Math.max(matrixError,...a.elements.map((n,c)=>Math.abs(n-b.elements[c])));
        }
        independentInstanceMatrices++;
      }
    }
    const trianglesFor=mesh=>{
      const p=mesh.geometry.attributes.position,index=mesh.geometry.index,triangles=[];
      for(let i=0;i<(index?.count??p.count);i+=3)triangles.push([0,1,2].map(n=>new Vector().fromBufferAttribute(p,index?index.getX(i+n):i+n).applyMatrix4(mesh.matrixWorld)));
      return triangles;
    };
    const land=v.valleyMeshes.ValleyTerrain,water=v.valleyMeshes.ValleyWater;
    const triangles=trianglesFor(land),waterTriangles=trianglesFor(water);
    const groundAt=(surface,x,z)=>{
      let top=-Infinity;
      for(const [a,b,c] of surface){
        const den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(den)<1e-9)continue;
        const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den,w=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;
        if(u>=-1e-6&&w>=-1e-6&&u+w<=1.000001)top=Math.max(top,u*a.y+w*b.y+(1-u-w)*c.y);
      }
      if(!Number.isFinite(top))throw new Error('No exported valley surface below '+[x,z]);return top;
    };
    const base=v.valleyBatches.ValleyFoundations;base.geometry.computeBoundingBox();const box=base.geometry.boundingBox;
    let footprintSamples=0,minGroundClearance=Infinity,minWaterClearance=Infinity,treeSamples=0,maxTreeError=0,maxBuildingError=0;
    for(let i=0;i<base.count;i++){
      const local=new Matrix(),world=new Matrix(),corners=[];base.getMatrixAt(i,local);world.multiplyMatrices(base.parent.matrixWorld,local);
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new Vector(x,y,z).applyMatrix4(world));
      const top=Math.max(...corners.map(p=>p.y)),bottom=Math.min(...corners.map(p=>p.y));
      const tops=[[box.min.x,box.min.z],[box.max.x,box.min.z],[box.max.x,box.max.z],[box.min.x,box.max.z]].map(([x,z])=>new Vector(x,box.max.y,z).applyMatrix4(world));
      const center=tops.reduce((p,c)=>p.add(c),new Vector()).multiplyScalar(1/4);
      const probes=[...tops,center,...tops.map((p,i)=>p.clone().add(tops[(i+1)%4]).multiplyScalar(.5))];
      for(const p of probes){
        const ground=groundAt(triangles,p.x,p.z),waterHeight=groundAt(waterTriangles,p.x,p.z);
        if(bottom>ground+.001)throw new Error('Floating stone foundation');
        minGroundClearance=Math.min(minGroundClearance,top-ground);minWaterClearance=Math.min(minWaterClearance,ground-waterHeight);footprintSamples++;
      }
      const authored=v.assets.valley.getObjectByName('ValleyFoundations').children[i],building=v.assets.valley.getObjectByName(authored.userData.building);
      if(!building)throw new Error('Foundation lost its authored building');
      const buildingWorld=new Matrix().multiplyMatrices(base.parent.matrixWorld,building.matrixWorld);
      const error=Math.abs(buildingWorld.elements[13]-top);maxBuildingError=Math.max(maxBuildingError,error);
      if(error>.001)throw new Error('Building misses its stone base');
    }
    const forest=v.valleyBatches.ValleyForest;
    for(let i=0;i<forest.count;i+=20){
      const local=new Matrix(),world=new Matrix();forest.getMatrixAt(i,local);world.multiplyMatrices(forest.parent.matrixWorld,local);
      const p=new Vector().setFromMatrixPosition(world);maxTreeError=Math.max(maxTreeError,Math.abs(p.y-groundAt(triangles,p.x,p.z)));treeSamples++;
    }
    const farGroups=['ValleyPanoramaForest','ValleyPanoramaHouse','ValleyPanoramaLonghouse','ValleyPanoramaTower','ValleyPanoramaFoundations'];
    if(!farGroups.every(n=>v.valleyBatches[n].parent===v.farPanorama&&!v.valleyTiles.some(t=>t.getObjectByName(v.valleyBatches[n].name))))throw new Error('Distant props must appear once in the fixed panorama frame');
    const farTriangles=[];
    for(const hills of [v.valleyBatches.ValleyFoothills,v.valleyBatches.ValleyFoothillsB])for(let i=0;i<hills.count;i++){
      const local=new Matrix(),world=new Matrix();hills.getMatrixAt(i,local);world.multiplyMatrices(hills.matrixWorld,local);
      farTriangles.push(...trianglesFor({geometry:hills.geometry,matrixWorld:world}));
    }
    const farForest=v.valleyBatches.ValleyPanoramaForest,farBases=v.valleyBatches.ValleyPanoramaFoundations;
    const farSource=v.assets.valley.getObjectByName('ValleyPanoramaForest').children[0];
    if(farForest.geometry!==farSource.geometry||farForest.material!==farSource.material||(farForest.geometry.index?.count??farForest.geometry.attributes.position.count)/3!==12)throw new Error('Far canopy must use the native twelve-triangle LOD2');
    let farTreeSamples=0,maxFarTreeError=0,farFootprintSamples=0,minFarTopClearance=Infinity,minFarBottomEmbed=Infinity;
    for(let i=0;i<farForest.count;i+=113){
      const local=new Matrix(),world=new Matrix();farForest.getMatrixAt(i,local);world.multiplyMatrices(farForest.matrixWorld,local);
      const p=new Vector().setFromMatrixPosition(world);maxFarTreeError=Math.max(maxFarTreeError,Math.abs(p.y-groundAt(farTriangles,p.x,p.z)));farTreeSamples++;
    }
    farBases.geometry.computeBoundingBox();const farBox=farBases.geometry.boundingBox;
    for(let i=0;i<farBases.count;i+=Math.max(1,Math.floor(farBases.count/24))){
      const local=new Matrix(),world=new Matrix();farBases.getMatrixAt(i,local);world.multiplyMatrices(farBases.matrixWorld,local);
      const top=new Vector(0,farBox.max.y,0).applyMatrix4(world).y,bottom=new Vector(0,farBox.min.y,0).applyMatrix4(world).y;
      for(const x of [farBox.min.x,0,farBox.max.x])for(const z of [farBox.min.z,0,farBox.max.z]){
        const p=new Vector(x,farBox.max.y,z).applyMatrix4(world),ground=groundAt(farTriangles,p.x,p.z);
        minFarTopClearance=Math.min(minFarTopClearance,top-ground);minFarBottomEmbed=Math.min(minFarBottomEmbed,ground-bottom);farFootprintSamples++;
      }
    }
    const sourceTree=new Vector().setFromMatrixPosition(v.assets.valley.getObjectByName('ValleyForest').children[0].matrixWorld);
    return {distance,cycle:base.parent.userData.cycle,road:v.course.road,step:v.course.step,period:v.valleyPeriod,sourceTree,
      instances,matrixError,sharedGeometryMeshes,independentInstanceMatrices,buildings:base.count,footprintSamples,
      minGroundClearance,minWaterClearance,maxBuildingError,trees:forest.count,treeSamples,maxTreeError,
      panoramaTrees:farForest.count,panoramaBuildings:farBases.count,farTreeSamples,maxFarTreeError,farFootprintSamples,minFarTopClearance,minFarBottomEmbed,
      waterTexture:water.material.map?.image.width,uv:!!water.geometry.attributes.uv,terrainTriangles:triangles.length,waterTriangles:waterTriangles.length};
  };
  const placementChecks=[];
  for(const distance of [0,120]){
    const report=await page.evaluate(inspectValley,distance);
    assert.deepEqual(report.road,course.road);assert.equal(report.step,course.step);assert.equal(report.period,course.road.period);
    assert.ok(report.instances>2600&&report.matrixError<1e-4,'Keep authored matrices local to each rebased tile');
    assert.ok(report.sharedGeometryMeshes>=8&&report.independentInstanceMatrices>=6,'Share native geometry without sharing mutable instance buffers');
    assert.ok(report.buildings>80&&report.footprintSamples===report.buildings*9);
    assert.ok(report.minGroundClearance>=-.001&&report.minWaterClearance>1&&report.maxTreeError<.001&&report.maxBuildingError<.001,'Foundation/tree contact must use the actual world terrain and sloping water');
    assert.equal(report.panoramaTrees,3600);assert.ok(report.panoramaBuildings>=300&&report.farTreeSamples>=30&&report.maxFarTreeError<.001&&report.minFarTopClearance>=-.001&&report.minFarBottomEmbed>=-.001,'Distant forest and villages must use actual imported hillside surfaces');
    assert.equal(report.waterTexture,256);assert.ok(report.uv&&report.waterTriangles>0);placementChecks.push(report);
  }
  const report=placementChecks[0],period=course.road.period,zScale=course.road.advance.z/period;
  const parallax=[];
  for(const distance of [0,120,1599.99,1600.01,1679.99,1680.01,1000010]){
    const firstCycle=Math.floor((distance-80)/period),rotation=frameQuaternion(course,distance);
    // Compute expected route frames in Node, never import production source from the page.
    const expected=[0,1].map(i=>{
      const cycle=firstCycle+i,advance=course.road.advance;
      const root={x:report.sourceTree.x+cycle*advance.x,y:report.sourceTree.y+cycle*advance.y,z:report.sourceTree.z*zScale+cycle*advance.z};
      return {cycle,origin:cyclePosition(course,cycle,distance),root:framePosition(course,root,distance),rotation};
    });
    const state=await page.evaluate(({distance:s,expected,zScale,advance,period})=>{
      const {game:g,view:v}=window.__bananaGame;g.s=s;g.phase='paused';v.reset(g);v.update(g,0);v.scene.updateMatrixWorld(true);
      const Vector=v.player.position.constructor,Matrix=v.player.matrix.constructor;
      let maxLocalCoordinate=0;
      const tiles=v.valleyTiles.map((tile,i)=>{
        const forest=tile.getObjectByName(v.valleyBatches.ValleyForest.name),local=new Matrix(),world=new Matrix();forest.getMatrixAt(0,local);world.multiplyMatrices(forest.parent.matrixWorld,local);
        for(const name of ['ValleyTerrain','ValleyWater']){
          const mesh=tile.getObjectByName(name);mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;
          for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
            const p=new Vector(x,y,z).applyMatrix4(mesh.matrixWorld);maxLocalCoordinate=Math.max(maxLocalCoordinate,Math.abs(p.x),Math.abs(p.y),Math.abs(p.z));
          }
        }
        const origin=new Vector().setFromMatrixPosition(tile.matrixWorld),root=new Vector().setFromMatrixPosition(world);
        return {cycle:tile.userData.cycle,origin,root,originError:origin.distanceTo(new Vector().copy(expected[i].origin)),
          rootError:root.distanceTo(new Vector().copy(expected[i].root)),rotationError:tile.quaternion.angleTo(new tile.quaternion.constructor().copy(expected[i].rotation)),scaleError:Math.abs(tile.scale.z-zScale)};
      });
      const seam=v.valleyTiles[0].localToWorld(new Vector(advance.x,advance.y,period));
      return {distance:s,period:v.valleyPeriod,tiles,seamError:seam.distanceTo(tiles[1].origin),maxLocalCoordinate,geometry:v.renderer.info.memory.geometries,textures:v.renderer.info.memory.textures};
    },{distance,expected,zScale,advance:course.road.advance,period});
    assert.ok(state.tiles.every((tile,i)=>tile.cycle===expected[i].cycle&&tile.originError<1e-6&&tile.rootError<1e-4&&tile.rotationError<1e-6&&tile.scaleError<1e-9),'Tile origins and true tree roots must follow the shared curved route');
    assert.ok(state.seamError<1e-6,'The lowered/scaled period end must meet the next cycle origin');
    assert.ok(state.maxLocalCoordinate<period*3,'Keep valley geometry local even at one million metres');parallax.push(state);
  }
  for(const [before,after] of [[parallax[2],parallax[3]],[parallax[4],parallax[5]]]){
    for(const old of before.tiles){
      const next=after.tiles.find(tile=>tile.cycle===old.cycle);if(!next)continue;
      assert.ok(gap(rebasePosition(course,old.origin,before.distance,after.distance),next.origin)<1e-6,'Cycle seam must preserve its origin through the moving rider frame');
      assert.ok(gap(rebasePosition(course,old.root,before.distance,after.distance),next.root)<1e-4,'Tile replacement must preserve the same authored tree in the moving frame');
    }
  }
  await page.evaluate(()=>{const {game:g,view:v}=window.__bananaGame;g.s=0;g.phase='ready';v.reset(g);v.update(g,0);});
  await page.click('#start');await page.clock.runFor(4000);await page.screenshot({path:'artifacts/valley-racing.png'});
  assert.equal(errors.length,0,errors.join('\n'));fs.writeFileSync('artifacts/valley-report.json',JSON.stringify({report,placementChecks,parallax,errors},null,2));console.log('IMPORTED_VALLEY_PASS',JSON.stringify({placementChecks,parallax}));
}finally{await browser.close();}
