import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cyclePosition,framePosition,frameQuaternion,rebasePosition} from '../src/route.ts';
const course=JSON.parse(fs.readFileSync('public/assets/course.json'));
const manifest=JSON.parse(fs.readFileSync('public/assets/manifest.json'));
assert.ok(manifest.models.valley.root&&manifest.models.valley.sourceIds.includes('mountain'),'Use the actual source/root environment manifest');
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');await page.locator('#start:not([disabled])').waitFor({timeout:30000});await page.clock.install();
  // Injected distances isolate imported layout and rebasing; they are not player-earned distance.
  const inspectValley=({distance,assetManifest})=>{
    const {game:g,view:v}=window.__bananaGame;v.setQuality('high');g.s=distance;g.phase='paused';v.reset(g);v.update(g,0);v.scene.updateMatrixWorld(true);
    const Vector=v.player.position.constructor,Matrix=v.player.matrix.constructor;
    let matrixError=0,instances=0;const authoredCounts={};
    const authoredRoot=v.assets.valley.getObjectByName(assetManifest.models.valley.root);if(!authoredRoot)throw new Error('Manifest source root missing');
    for(const [group,batch] of Object.entries(v.valleyBatches)){
      let source=v.assets.valley.getObjectByName(group).children.filter(o=>o.isMesh);
      if(batch.userData.fullCount)source=[...source.filter((_,i)=>i%2===0),...source.filter((_,i)=>i%2===1)];
      authoredCounts[group]=source.length;if(!source.length||source.length!==batch.count)throw new Error('Missing authored instances');
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
      for(let i=0;i<(index?.count??p.count);i+=3){
        const tri=[0,1,2].map(n=>new Vector().fromBufferAttribute(p,index?index.getX(i+n):i+n).applyMatrix4(mesh.matrixWorld));
        const material=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
        if(material?.side!==2&&tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0])).y<=1e-9)continue;
        triangles.push(tri);
      }
      return triangles;
    };
    const land=v.valleyMeshes.ValleyTerrain,water=v.valleyMeshes.ValleyWater;
    const triangles=trianglesFor(land),waterTriangles=trianglesFor(water);
    const surfaceIndices=new WeakMap(),cellSize=32;
    const groundAt=(surface,x,z)=>{
      if(!surfaceIndices.has(surface)){
        const bins=new Map();
        for(const tri of surface){
          const xs=tri.map(p=>p.x),zs=tri.map(p=>p.z);
          for(let row=Math.floor(Math.min(...zs)/cellSize);row<=Math.floor(Math.max(...zs)/cellSize);row++)
            for(let col=Math.floor(Math.min(...xs)/cellSize);col<=Math.floor(Math.max(...xs)/cellSize);col++){
              const key=col+':'+row;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(tri);
            }
        }surfaceIndices.set(surface,bins);
      }
      let top=-Infinity;
      const candidates=surfaceIndices.get(surface).get(Math.floor(x/cellSize)+':'+Math.floor(z/cellSize))??[];
      for(const [a,b,c] of candidates){
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
      const probes=[];
      for(let row=0;row<=8;row++)for(let col=0;col<=8;col++)probes.push(tops[0].clone().addScaledVector(tops[1].clone().sub(tops[0]),col/8).addScaledVector(tops[3].clone().sub(tops[0]),row/8));
      for(const p of probes){
        const ground=groundAt(triangles,p.x,p.z),waterHeight=groundAt(waterTriangles,p.x,p.z);
        if(bottom>ground+.001)throw new Error('Floating stone foundation');
        minGroundClearance=Math.min(minGroundClearance,top-ground);minWaterClearance=Math.min(minWaterClearance,ground-waterHeight);footprintSamples++;
      }
      const authored=v.assets.valley.getObjectByName('ValleyFoundations').children[i],building=v.assets.valley.getObjectByName(authored.userData.building);
      if(!building)throw new Error('Foundation lost its authored building');
      const buildingWorld=new Matrix().multiplyMatrices(base.parent.matrixWorld,building.matrixWorld);
      building.geometry.computeBoundingBox();const buildingBottom=new Vector(0,building.geometry.boundingBox.min.y,0).applyMatrix4(buildingWorld).y;
      const error=Math.abs(buildingBottom-top);maxBuildingError=Math.max(maxBuildingError,error);
      if(error>.001)throw new Error('Building misses its stone base');
    }
    const forest=v.valleyBatches.ValleyForest;
    for(let i=0;i<forest.count;i+=20){
      const local=new Matrix(),world=new Matrix();forest.getMatrixAt(i,local);world.multiplyMatrices(forest.parent.matrixWorld,local);
      forest.geometry.computeBoundingBox();const p=new Vector(0,forest.geometry.boundingBox.min.y,0).applyMatrix4(world);maxTreeError=Math.max(maxTreeError,Math.abs(p.y-groundAt(triangles,p.x,p.z)+.025));treeSamples++;
    }
    const farGroups=['ValleyPanoramaForest','ValleyPanoramaHouse','ValleyPanoramaLonghouse','ValleyPanoramaTower','ValleyPanoramaFoundations'];
    if(!farGroups.every(n=>v.valleyBatches[n].parent===v.farPanorama&&!v.valleyTiles.some(t=>t.getObjectByName(v.valleyBatches[n].name))))throw new Error('Distant props must appear once in the fixed panorama frame');
    const farTriangles=[];
    const supportGroups=authoredRoot.children.filter(group=>group.children.some(o=>o.isMesh&&o.userData.sourceId==='mountain')).map(group=>group.name);
    if(!supportGroups.length)throw new Error('Missing real source terrain support groups');
    for(const name of supportGroups){
      const hills=v.valleyBatches[name];if(!hills||hills.parent!==v.farPanorama)throw new Error('Mountain support lost its panorama frame');
      for(let i=0;i<hills.count;i++){
        const local=new Matrix(),world=new Matrix();hills.getMatrixAt(i,local);world.multiplyMatrices(hills.matrixWorld,local);
        farTriangles.push(...trianglesFor({geometry:hills.geometry,material:hills.material,matrixWorld:world}));
      }
    }
    const farForest=v.valleyBatches.ValleyPanoramaForest,farBases=v.valleyBatches.ValleyPanoramaFoundations;
    const farSource=v.assets.valley.getObjectByName('ValleyPanoramaForest').children[0];
    const farLOD=(farForest.geometry.index?.count??farForest.geometry.attributes.position.count)/3;
    if(farForest.geometry!==farSource.geometry||farForest.material!==farSource.material||!(farLOD>0&&farLOD<=24)||farSource.userData.sourceId!=='tree')throw new Error('Far canopy must use the actual source-derived LOD within 24 triangles');
    let farTreeSamples=0,maxFarTreeError=0,farFootprintSamples=0,minFarTopClearance=Infinity,minFarBottomEmbed=Infinity;
    for(let i=0;i<farForest.count;i+=Math.max(1,Math.floor(farForest.count/40))){
      const local=new Matrix(),world=new Matrix();farForest.getMatrixAt(i,local);world.multiplyMatrices(farForest.matrixWorld,local);
      farForest.geometry.computeBoundingBox();const p=new Vector(0,farForest.geometry.boundingBox.min.y,0).applyMatrix4(world);maxFarTreeError=Math.max(maxFarTreeError,Math.abs(p.y-groundAt(farTriangles,p.x,p.z)+.025));farTreeSamples++;
    }
    farBases.geometry.computeBoundingBox();const farBox=farBases.geometry.boundingBox;
    for(let i=0;i<farBases.count;i++){
      const local=new Matrix(),world=new Matrix();farBases.getMatrixAt(i,local);world.multiplyMatrices(farBases.matrixWorld,local);
      const top=new Vector(0,farBox.max.y,0).applyMatrix4(world).y,bottom=new Vector(0,farBox.min.y,0).applyMatrix4(world).y;
      for(let row=0;row<=8;row++)for(let col=0;col<=8;col++){
        const x=farBox.min.x+(farBox.max.x-farBox.min.x)*col/8,z=farBox.min.z+(farBox.max.z-farBox.min.z)*row/8;
        const p=new Vector(x,farBox.max.y,z).applyMatrix4(world),ground=groundAt(farTriangles,p.x,p.z);
        minFarTopClearance=Math.min(minFarTopClearance,top-ground);minFarBottomEmbed=Math.min(minFarBottomEmbed,ground-bottom);farFootprintSamples++;
      }
    }
    const sourceTree=new Vector().setFromMatrixPosition(v.assets.valley.getObjectByName('ValleyForest').children[0].matrixWorld);
    return {distance,cycle:base.parent.userData.cycle,road:v.course.road,step:v.course.step,period:v.valleyPeriod,sourceTree,
      instances,matrixError,authoredCounts,supportGroups,farLOD,sharedGeometryMeshes,independentInstanceMatrices,buildings:base.count,footprintSamples,
      minGroundClearance,minWaterClearance,maxBuildingError,trees:forest.count,treeSamples,maxTreeError,
      panoramaTrees:farForest.count,panoramaBuildings:farBases.count,farTreeSamples,maxFarTreeError,farFootprintSamples,minFarTopClearance,minFarBottomEmbed,
      waterTexture:water.material.map?.image.width,uv:!!water.geometry.attributes.uv,terrainTriangles:triangles.length,waterTriangles:waterTriangles.length};
  };
  const placementChecks=[];
  for(const distance of [0,120]){
    const report=await page.evaluate(inspectValley,{distance,assetManifest:manifest});
    assert.deepEqual(report.road,course.road);assert.equal(report.step,course.step);assert.equal(report.period,course.road.period);
    assert.ok(report.instances>2600&&report.matrixError<1e-4,'Keep authored matrices local to each rebased tile');
    assert.ok(report.sharedGeometryMeshes>=8&&report.independentInstanceMatrices>=6,'Share native geometry without sharing mutable instance buffers');
    assert.ok(report.buildings>80&&report.footprintSamples===report.buildings*81);
    assert.ok(report.minGroundClearance>=-.001&&report.minWaterClearance>1&&report.maxTreeError<.001&&report.maxBuildingError<.001,'Foundation/tree contact must use the actual world terrain and sloping water');
    assert.equal(report.panoramaTrees,report.authoredCounts.ValleyPanoramaForest);assert.equal(report.panoramaBuildings,report.authoredCounts.ValleyPanoramaFoundations);
    assert.ok(report.panoramaBuildings>0&&report.farTreeSamples>=Math.min(30,report.panoramaTrees)&&report.farLOD<=24&&report.maxFarTreeError<.001&&report.minFarTopClearance>=-.001&&report.minFarBottomEmbed>=-.001,'Distant props must keep their real source set and contact the complete visible mountain union');
    assert.equal(report.farFootprintSamples,report.panoramaBuildings*81);
    assert.equal(report.waterTexture,256);assert.ok(report.uv&&report.waterTriangles>0);placementChecks.push(report);
  }
  const qualityCheck=await page.evaluate(()=>{
    const {game:g,view:v}=window.__bananaGame,triangles=mesh=>(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
    const name=v.valleyBatches.ValleyForest.name;
    v.setQuality('high');v.update(g,0);const high=v.valleyTiles[0].getObjectByName(name);
    // The Far runtime batch also switches geometry in low mode. Compare Near
    // against the immutable saved Far source, not that mutable runtime batch.
    const savedFar=v.assets.valley.getObjectByName('ValleyForestFar').children.find(o=>o.isMesh).geometry;
    const savedPanorama=v.assets.valley.getObjectByName('ValleyPanoramaForest').children.find(o=>o.isMesh).geometry;
    const result={highTriangles:triangles(high),highCount:high.count};
    v.setQuality('low');v.update(g,0);const low=v.valleyTiles[0].getObjectByName(name);
    Object.assign(result,{lowTriangles:triangles(low),lowCount:low.count,usesDeclaredLowGeometry:low.geometry===savedFar,
      farLowMatchesSavedPanorama:v.valleyBatches.ValleyForestFar.geometry===savedPanorama});
    v.setQuality('high');v.update(g,0);return result;
  });
  fs.writeFileSync('artifacts/valley-report.json',JSON.stringify({placementChecks,qualityCheck,errors},null,2));
  assert.ok(qualityCheck.highTriangles>qualityCheck.lowTriangles&&qualityCheck.lowTriangles<=24&&qualityCheck.lowCount<qualityCheck.highCount&&qualityCheck.usesDeclaredLowGeometry&&qualityCheck.farLowMatchesSavedPanorama,'Low quality must change actual source geometry and density: '+JSON.stringify(qualityCheck));
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
  assert.equal(errors.length,0,errors.join('\n'));fs.writeFileSync('artifacts/valley-report.json',JSON.stringify({report,placementChecks,qualityCheck,parallax,errors},null,2));console.log('IMPORTED_VALLEY_PASS',JSON.stringify({placementChecks,qualityCheck,parallax}));
}finally{await browser.close();}
