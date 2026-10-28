import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {RUNTIME_ASSETS} from '../src/view.js';
import {readGlb} from './check-compressed.mjs';

const root=path.resolve(import.meta.dirname,'..');
const dir=path.resolve(process.argv[2]??path.join(root,'assets/export'));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const ledger=JSON.parse(fs.readFileSync(path.join(root,'assets/sources/banana-tripo-v1/manifest.json')));
const required=['bicycle','rider','riderSkinned','banana','looseBanana','bananaRack','truck','car','pedestrian','goat','palm','tree','forestTree','bananaPlant','stall','cliff','hut','villageHouse','villageLonghouse','foundation','rock','crate','dust','spark','cloud','sign','mountain','forestHill','bush','tower','burst','barrier','wall','train','boost','shield','double','roadTile','lake','valley','roadCourse','sky','forestTreeLOD1','forestTreeLOD2','rockA','rockB','rockC','rockD','rockE','rockF','mountainB','midMountain','midMountainB','forestHillB','cloudB','cloudC','bananaB','bananaC','bananaD','burstGlow'];
const procedural=new Set(['sky','lake','dust','spark']);
assert.equal(manifest.pipeline,'Tripo H3.1 → saved Blender → Three.js');
assert.equal(manifest.mode,'endless');
assert.equal(ledger.assets.length,29,'The generation ledger must retain all source categories');
const sources=new Map(ledger.assets.map(item=>[item.id,new Set(item.sourceFiles.map(file=>file.sha256))]));
for(const [id,hashes] of sources){assert.ok(hashes.size,`Missing downloaded source for ${id}`);for(const hash of hashes)assert.match(hash,/^[a-f0-9]{64}$/);}
for(const name of required)assert.ok(manifest.models[name],`Missing asset ${name}`);
assert.ok(Array.isArray(manifest.sourceFiles)&&new Set(manifest.sourceFiles).size===manifest.sourceFiles.length);
for(const file of manifest.sourceFiles){
  const source=path.resolve(root,file);assert.ok(source.startsWith(root+path.sep)&&source.endsWith('.blend'),'Expected a local saved Blender source');
  const b=fs.readFileSync(source);assert.ok(b.subarray(0,7).toString()==='BLENDER'||b[0]===0x28||b[0]===0x1f,`Invalid Blender file ${file}`);
}
function values(data,binary,index){
  const a=data.accessors[index],view=data.bufferViews[a.bufferView],width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
  const size={5121:1,5123:2,5125:4,5126:4}[a.componentType],stride=view.byteStride??width*size;
  assert.ok(width&&size,'Unsupported exported accessor');
  const offset=(view.byteOffset??0)+(a.byteOffset??0),result=[];
  for(let i=0;i<a.count;i++)for(let c=0;c<width;c++){
    const at=offset+i*stride+c*size;
    let v=a.componentType===5126?binary.readFloatLE(at):a.componentType===5125?binary.readUInt32LE(at):a.componentType===5123?binary.readUInt16LE(at):binary.readUInt8(at);
    if(a.normalized)v/=a.componentType===5123?65535:255;
    result.push(v);
  }return result;
}
const trianglesOf=(data,index)=>data.meshes[index].primitives.reduce((sum,p)=>sum+data.accessors[p.indices??p.attributes.POSITION].count/3,0);
let bytes=0,meshes=0,triangles=0,texturedPrimitives=0;
for(const [name,item] of Object.entries(manifest.models)){
  assert.ok(manifest.sourceFiles.includes(item.source),`${name}: source missing from saved source set`);
  assert.ok(typeof item.root==='string'&&item.root,`${name}: missing saved root`);
  assert.ok(Array.isArray(item.sourceIds),`${name}: missing production provenance`);
  if(!procedural.has(name))assert.ok(item.sourceIds.length,`${name}: visible model has no Tripo origin`);
  for(const id of item.sourceIds)assert.ok(sources.has(id),`${name}: unknown Tripo source ${id}`);
  const buffer=fs.readFileSync(path.join(dir,item.file)),{json:data,binary}=readGlb(buffer);
  assert.ok(data.nodes.some(n=>n.name===item.root),`${name}: saved root absent from GLB`);
  assert.ok(data.meshes?.length,`${name}: empty model`);
  const count=data.meshes.reduce((sum,_,i)=>sum+trianglesOf(data,i),0);
  assert.equal(count,item.triangles,`${name}: native/export triangle count drift`);
  const hashes=data.nodes.flatMap(n=>n.extras?.sourceSha256?[n.extras.sourceSha256]:[]);
  const embedded=data.nodes.flatMap(n=>n.extras?.sourceId?[n.extras]:[]);
  for(const entry of embedded)assert.ok(item.sourceIds.includes(entry.sourceId),`${name}: unlisted embedded source ${entry.sourceId}`);
  if(item.sourceIds.length>1)for(const id of item.sourceIds)assert.ok(embedded.some(entry=>entry.sourceId===id&&sources.get(id).has(entry.sourceSha256)),`${name}: missing actual source/hash pair for ${id}`);
  if(item.sourceIds.length===1)assert.ok(hashes.some(hash=>sources.get(item.sourceIds[0]).has(hash)),`${name}: missing actual source hash in GLB`);
  for(const mesh of data.meshes)for(const p of mesh.primitives){
    assert.equal(p.mode??4,4,`${name}: expected triangles`);
    assert.ok(p.attributes.POSITION!==undefined,`${name}: missing native geometry`);
    const positions=values(data,binary,p.attributes.POSITION);assert.ok(positions.length&&positions.every(Number.isFinite),`${name}: invalid vertices`);
    const colors=p.attributes.COLOR_0===undefined?[]:values(data,binary,p.attributes.COLOR_0);
    assert.ok(colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1.001),`${name}: invalid colors`);
    assert.deepEqual(Object.keys(p.attributes).filter(key=>key.startsWith('COLOR_')),colors.length?['COLOR_0']:[],`${name}: wrong active color layer`);
    const material=data.materials[p.material],texture=material.pbrMetallicRoughness?.baseColorTexture;
    if(texture){
      assert.ok(p.attributes.TEXCOORD_0!==undefined,`${name}: texture missing UVs`);
      const image=data.images[data.textures[texture.index].source];assert.ok(Number.isInteger(image.bufferView)&&!image.uri,`${name}: texture must be packed`);
      assert.ok(['image/jpeg','image/png'].includes(image.mimeType),`${name}: unsupported canonical texture`);
      assert.ok(values(data,binary,p.attributes.TEXCOORD_0).every(Number.isFinite),`${name}: invalid UVs`);texturedPrimitives++;
    }else{
      assert.ok(colors.length,`${name}: primitive has neither packed paint nor native vertex colors`);
      const width=data.accessors[p.attributes.COLOR_0].type==='VEC4'?4:3;
      assert.ok(colors.some((v,i)=>i%width<3&&v<.999),`${name}: unpainted white mesh`);
    }
  }
  if(['rider','riderSkinned'].includes(name)){
    assert.equal(data.skins?.length,1);assert.equal(data.skins[0].joints.length,65);
    assert.equal(data.animations?.length,16);assert.equal(new Set(data.animations.map(a=>a.name)).size,16);
    assert.ok(item.animations);assert.ok(count<=22000,`${name}: hero exceeds primary geometry budget`);
  }
  if(name==='bicycle'){
    assert.ok(count<=24000,'Bicycle exceeds the primary geometry budget');
    for(const node of ['WheelFront','WheelRear','Crank','Pedal_L','Pedal_R','CargoMount','RiderSeat','RiderGrip_L','RiderGrip_R','RiderPedal_L','RiderPedal_R','RiderStand_L','RiderStand_R'])assert.ok(data.nodes.some(n=>n.name===node),`Bike missing ${node}`);
  }
  if(name==='truck'){
    for(const part of ['Cab','Bed','Tarp','Door_L','Door_R','Tailgate','Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR',...Array.from({length:6},(_,i)=>`Crate_${String(i+1).padStart(2,'0')}`)])assert.ok(data.nodes.some(n=>n.name==='TruckPart_'+part),'Missing truck debris '+part);
    assert.ok(count<=30000);
  }
  if(['looseBanana','boost','shield','double'].includes(name)){
    const positions=data.meshes.flatMap(mesh=>mesh.primitives.map(p=>data.accessors[p.attributes.POSITION]));
    for(let axis=0;axis<3;axis++)assert.ok(Math.abs(Math.min(...positions.map(p=>p.min[axis]))+Math.max(...positions.map(p=>p.max[axis])))<1e-5,`${name}: visible pickup centre disagrees with collision height`);
  }
  if(name==='bananaRack'){
    const cargo=data.nodes.find(n=>n.name==='BananaCargo'),bundles=cargo.children.map(i=>data.nodes[i]);assert.equal(bundles.length,20);
    assert.equal(new Set(bundles.map(n=>n.mesh)).size,4);
    for(const [i,bundle] of bundles.entries()){assert.equal(bundle.name,`CargoBundle${String(i).padStart(2,'0')}`);assert.equal(bundle.extras.globalBundleIndex,i);assert.equal(bundle.extras.variant,i%4);}
  }
  if(name==='roadTile'){const grid=data.nodes.find(n=>n.name==='EndlessRoadTile')?.extras?.terrainGrid;assert.ok(grid&&grid.x.length*grid.rows===grid.heights.length);}
  if(name==='roadCourse'){
    const chunks=data.nodes.filter(n=>n.name.startsWith('CourseChunk_')&&n.extras?.segment!==undefined);assert.equal(chunks.length,20);
    for(const chunk of chunks)assert.deepEqual(chunk.children.map(i=>data.nodes[i].extras?.surfaceRole).filter(Boolean).sort(),['guard','road','terrain']);
  }
  if(name==='valley'){
    for(const group of ['ValleyTerrain','ValleyWater','ValleyVillageHouse','ValleyVillageLonghouse','ValleyTower','ValleyFoundations','ValleyForest','ValleyPalms','ValleyMountains','ValleyFoothills','ValleyClouds','ValleyForestFar','ValleyPanoramaForest','ValleyPanoramaHouse','ValleyPanoramaLonghouse','ValleyPanoramaTower','ValleyPanoramaFoundations']){
      const node=data.nodes.find(n=>n.name===group);assert.ok(node,`Missing valley group ${group}`);
      if(group!=='ValleyTerrain'&&group!=='ValleyWater'){
        assert.ok(node.children?.length,`Empty valley group ${group}`);
        assert.equal(new Set(node.children.map(i=>data.nodes[i].mesh)).size,1,`${group}: instance batches require shared native geometry`);
      }
    }
    const forest=data.nodes.find(n=>n.name==='ValleyForest'),mid=data.nodes.find(n=>n.name==='ValleyForestFar'),far=data.nodes.find(n=>n.name==='ValleyPanoramaForest');
    const counts=[forest,mid,far].map(n=>trianglesOf(data,data.nodes[n.children[0]].mesh));
    assert.ok(counts[0]<=900&&counts[1]<=100&&counts[2]<=24&&counts[0]>=counts[1]&&counts[1]>=counts[2]&&counts[0]>counts[2],'Forest must use actual near/mid/far LODs');
  }
  meshes+=data.meshes.length;bytes+=buffer.length;triangles+=count;
}
const course=JSON.parse(fs.readFileSync(path.join(dir,'course.json')));
assert.ok(manifest.models.tree.triangles<=900&&manifest.models.forestTree.triangles<=100&&manifest.models.forestTreeLOD2.triangles<=24);
assert.ok(manifest.models.tree.triangles>manifest.models.forestTree.triangles&&manifest.models.forestTree.triangles>manifest.models.forestTreeLOD2.triangles);
assert.equal(course.mode,'endless');assert.ok(!('length' in course));
assert.equal(course.chunkLength,80);assert.equal(course.lookAhead,480);assert.equal(course.road.period,1600);
assert.equal(course.step,2);assert.equal(course.points.length,801);assert.ok(course.points.some(p=>p.x>50));assert.equal(course.points.at(-1).y,-64);
assert.ok(bytes<70e6,'Full editable canonical asset set exceeds 70 MB');
const runtimeBytes=RUNTIME_ASSETS.reduce((sum,name)=>sum+fs.statSync(path.join(root,'public/assets',manifest.models[name].file)).size,0);
assert.ok(runtimeBytes<30e6,'First screen runtime GLBs exceed 30 MB');
console.log(JSON.stringify({assets:Object.keys(manifest.models).length,meshes,triangles,canonicalMB:+(bytes/1e6).toFixed(2),firstScreenGLBMB:+(runtimeBytes/1e6).toFixed(2),texturedPrimitives,source:manifest.blenderVersion},null,2));
