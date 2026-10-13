import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.resolve(process.argv[2] ?? path.join(root, 'assets/export'));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
const required = ['bicycle','rider','banana','looseBanana','bananaRack','truck','car','pedestrian','goat','palm','tree','forestTree','bananaPlant','stall','cliff','hut','villageHouse','villageLonghouse','foundation','rock','crate','dust','spark','cloud','sign','mountain','forestHill','bush','tower','burst','barrier','wall','train','boost','shield','double','roadTile','lake','valley','roadCourse','sky','forestTreeLOD1','forestTreeLOD2','rockA','rockB','rockC','rockD','rockE','rockF','mountainB','midMountain','midMountainB','forestHillB','cloudB','cloudC','bananaB','bananaC','bananaD','burstGlow','riderSkinned'];
const originalAOTargets = ['rider','bicycle','banana','looseBanana','truck','car','hut','villageHouse','villageLonghouse','stall','tower','foundation','palm','tree','forestTree','bananaPlant','bush','rock','cliff'];
const aoTargets = manifest.vertexAO?.assets ?? [];
for (const name of [...originalAOTargets,'rockA','rockB','rockC','rockD','rockE','rockF','bananaB','bananaC','bananaD']) assert.ok(aoTargets.includes(name), `Missing AO target ${name}`);
for (const name of required) assert.ok(manifest.models[name], `Missing asset ${name}`);
assert.ok(manifest.vertexAO?.method.includes('BVH'), 'Missing Blender BVH vertex AO provenance');
assert.equal(manifest.vertexAO.samples,24);assert.ok(manifest.vertexAO.strength>=.25&&manifest.vertexAO.strength<=.32);
assert.equal(new Set(aoTargets).size,aoTargets.length,'Duplicate AO targets');
assert.ok(Object.keys(manifest.models).length >= required.length,'Manifest misses native runtime assets');
function accessorValues(buffer,data,index){
  const a=data.accessors[index],view=data.bufferViews[a.bufferView],count={VEC3:3,VEC4:4}[a.type];
  const size={5121:1,5123:2,5126:4}[a.componentType],stride=view.byteStride??count*size;
  assert.ok(count&&size,'Unsupported exported color/position component');
  const offset=28+buffer.readUInt32LE(12)+(view.byteOffset??0)+(a.byteOffset??0),values=[];
  for(let i=0;i<a.count;i++)for(let c=0;c<count;c++){
    const at=offset+i*stride+c*size;
    let value=a.componentType===5126?buffer.readFloatLE(at):a.componentType===5123?buffer.readUInt16LE(at):buffer.readUInt8(at);
    if(a.normalized)value/=a.componentType===5123?65535:255;
    values.push(value);
  }
  return values;
}
let bytes = 0, meshes = 0, triangles = 0;
for (const name of Object.keys(manifest.models)) {
  const item = manifest.models[name];
  assert.ok(item, `Missing asset ${name}`);
  assert.ok(fs.existsSync(path.join(root, item.source)), `Missing Blender source for ${name}`);
  const buffer = fs.readFileSync(path.join(dir, item.file));
  assert.equal(buffer.readUInt32LE(0), 0x46546c67, `${name} is not GLB`);
  assert.equal(buffer.readUInt32LE(4), 2);
  assert.equal(buffer.readUInt32LE(8), buffer.length);
  const jsonSize = buffer.readUInt32LE(12);
  const data = JSON.parse(buffer.subarray(20, 20 + jsonSize).toString());
  assert.ok(data.meshes?.length, `${name} has no mesh`);
  if(aoTargets.includes(name)){
    assert.ok(item.vertexAO?.method===manifest.vertexAO.method,`${name} lacks manifest AO metadata`);
    assert.ok(data.nodes.some(n=>n.extras?.vertexAO?.method===manifest.vertexAO.method),`${name} lacks glTF AO extras`);
    assert.ok(item.vertexAO.minFactor>=.68&&item.vertexAO.minFactor<=1,`${name} AO is too dark`);
  }
  if(['sky','dust','spark','burst','burstGlow','cloud','cloudB','cloudC','forestTreeLOD1','forestTreeLOD2','roadTile','lake'].includes(name))assert.ok(!item.vertexAO,`${name} must not bake AO`);
  if(name==='sky'){
    assert.ok(data.nodes.some(n=>n.name==='SkyDome'),'Sky must have the native SkyDome root');
    assert.equal(data.meshes.length,1);assert.equal(item.triangles,960);
    for(const p of data.meshes[0].primitives){
      const positions=accessorValues(buffer,data,p.attributes.POSITION);
      for(let i=0;i<positions.length;i+=3)assert.ok(Math.abs(Math.hypot(...positions.slice(i,i+3))-1)<1e-6,'Sky sphere radius changed');
    }
  }
  if(name==='rider')for(const node of ['BalanceBody','Leg_L','Leg_R','Knee_L','Knee_R','Foot_L','Foot_R','Arm_L','Arm_R','Elbow_L','Elbow_R','Hand_L','Hand_R'])assert.ok(data.nodes.some(n=>n.name===node),'Riding rig missing '+node);
  if(name==='bananaRack'){
    const rack=data.nodes.find(n=>n.name==='BananaCargo');assert.ok(rack,'The collected heap must come from Blender');
    const bundles=rack.children.map(i=>data.nodes[i]);assert.equal(bundles.length,20);
    assert.deepEqual(bundles.map(n=>n.name).sort(),Array.from({length:20},(_,i)=>`CargoBundle${String(i).padStart(2,'0')}`));
    assert.equal(new Set(bundles.map(n=>n.mesh)).size,4,'The heap must share four banana geometry variants');
    for(const [i,bundle] of bundles.entries()){assert.equal(bundle.extras?.globalBundleIndex,i);assert.equal(bundle.extras?.variant,i%4);}
    for(let variant=0;variant<4;variant++)assert.ok(bundles.filter(n=>n.extras.variant===variant).length>=4);
  }
  if(name==='roadTile'){
    assert.ok(data.images?.some(i=>i.name==='Asphalt_Painted_Grain'&&Number.isInteger(i.bufferView)), 'Asphalt must pack its Blender-painted image');
    const grid=data.nodes.find(n=>n.name==='EndlessRoadTile')?.extras?.terrainGrid;
    assert.ok(grid&&grid.x.length*grid.rows===grid.heights.length,'Terrain heights must come from the Blender source');
    for(const m of data.meshes)for(const p of m.primitives)if(data.materials[p.material].pbrMetallicRoughness?.baseColorTexture)
      assert.ok(p.attributes.TEXCOORD_0!==undefined,'Painted road must export real UVs');
  }
  if(name==='valley'){
    for(const node of ['ValleyTerrain','ValleyWater','ValleyVillageHouse','ValleyVillageLonghouse','ValleyTower','ValleyFoundations','ValleyForest','ValleyPalms','ValleyMountains','ValleyFoothills','ValleyClouds',
      'ValleyPanoramaForest','ValleyPanoramaHouse','ValleyPanoramaLonghouse','ValleyPanoramaTower','ValleyPanoramaFoundations'])
      assert.ok(data.nodes.some(n=>n.name===node),'Blender valley layout missing '+node);
    const groupNodes=(names)=>names.flatMap(name=>{const group=data.nodes.find(n=>n.name===name);assert.ok(group,`Missing valley group ${name}`);return group.children.map(i=>data.nodes[i]);});
    for(const [groups,count] of [[['ValleyMountains','ValleyMountainsB'],24],[['ValleyMidMountains','ValleyMidMountainsB'],16],[['ValleyFoothills','ValleyFoothillsB'],18],[['ValleyClouds','ValleyCloudsB','ValleyCloudsC'],24]]){
      const nodes=groupNodes(groups);assert.equal(nodes.length,count);
      assert.ok(new Set(nodes.map(n=>n.mesh)).size>=2,'Depth bands must use authored geometry variants');
    }
    const farForest=groupNodes(['ValleyPanoramaForest']),nearForest=groupNodes(['ValleyForest']),forestFar=groupNodes(['ValleyForestFar']);
    assert.equal(farForest.length,3600);assert.equal(new Set(farForest.map(n=>n.mesh)).size,1);
    assert.equal(nearForest.length+forestFar.length,2400);
    assert.equal(new Set(forestFar.map(n=>n.mesh)).size,1);
    const meshTriangles=(index)=>data.meshes[index].primitives.reduce((sum,p)=>sum+data.accessors[p.indices??p.attributes.POSITION].count/3,0);
    assert.equal(meshTriangles(farForest[0].mesh),12,'Panorama forest must use native LOD2');
    assert.ok(meshTriangles(forestFar[0].mesh)<=44,'Far valley forest must use native LOD1');
    assert.ok(meshTriangles(nearForest[0].mesh)>meshTriangles(forestFar[0].mesh),'Near forest must retain its fuller geometry');
    assert.ok(data.images?.some(i=>i.name==='Valley_Water_Ripples'&&Number.isInteger(i.bufferView)),'Water texture must be embedded by Blender');
    assert.ok(data.nodes.find(n=>n.name==='EndlessValley')?.extras?.buildings>80,'Village must be an authored populated layout');
    const forest=[...nearForest,...forestFar].map(n=>n.translation);
    const palms=data.nodes.find(n=>n.name==='ValleyPalms').children.map(i=>data.nodes[i].translation);
    for(const palm of palms)assert.ok(forest.every(tree=>Math.hypot(...palm.map((n,c)=>n-tree[c]))>.899),'Palm and forest roots must not overlap');
  }
  if(name==='roadCourse'){
    const chunks=data.nodes.filter(n=>n.extras?.segment!==undefined&&n.name.startsWith('CourseChunk_'));
    assert.equal(chunks.length,20,'Curved modules must be authored in local Blender');
    for(const chunk of chunks){
      const roles=chunk.children.map(i=>data.nodes[i].extras?.surfaceRole).filter(Boolean).sort();
      assert.deepEqual(roles,['guard','road','terrain'],'Every segment must export the actual collision meshes');
    }
    assert.ok(data.nodes.some(n=>n.extras?.kind==='hut'),'Roadside layout must be authored with the curved road');
    assert.ok(data.images?.some(i=>i.name==='Asphalt_Painted_Grain'),'Curved asphalt must preserve packed paint');
  }
  let paletteColors=0;
  for (const m of data.meshes) for (const p of m.primitives) {
    assert.ok(p.attributes.POSITION !== undefined && p.attributes.COLOR_0 !== undefined, `${name} has no colored geometry`);
    const a = data.accessors[p.attributes.POSITION];
    assert.ok(a.count > 0 && [...a.min, ...a.max].every(Number.isFinite));
    const colors=accessorValues(buffer,data,p.attributes.COLOR_0);
    const channels=data.accessors[p.attributes.COLOR_0].type==='VEC4'?4:3;
    paletteColors+=colors.filter((v,i)=>i%channels<3&&v<.999).length;
    assert.ok(colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1.001),`${name} has invalid exported colors`);
    assert.ok(colors.some((v,i)=>i%4!==3&&v>.01),`${name} colored mesh is entirely black`);
    assert.deepEqual(Object.keys(p.attributes).filter(k=>k.startsWith('COLOR_')),['COLOR_0'],`${name} exported the wrong color layer`);
  }
  assert.ok(paletteColors>0,`${name} COLOR_0 became entirely white instead of the native palette`);
  meshes += data.meshes.length; bytes += buffer.length; triangles += item.triangles;
}
for (const file of manifest.sourceFiles) {
  const b = fs.readFileSync(path.join(root, file));
  assert.ok(b.subarray(0, 7).toString() === 'BLENDER' || b[0] === 0x28 || b[0] === 0x1f, `Invalid Blender file ${file}`);
}
const course = JSON.parse(fs.readFileSync(path.join(dir, 'course.json')));
assert.equal(course.mode,'endless');
assert.equal(course.chunkLength,80);assert.equal(course.lookAhead,480);
assert.ok(!('length' in course),'Endless course must not have a finish distance');
assert.equal(course.road?.period,1600);assert.equal(course.step,2);assert.equal(course.points?.length,801);
assert.ok(course.points.some(p=>p.x>50),'The course must actually turn');
assert.equal(course.points.at(-1).y,-64);
assert.ok(bytes<30e6,'Canonical GLB budget must stay under 30 MB');
console.log(JSON.stringify({ assets: Object.keys(manifest.models).length, meshes, triangles, megabytes: +(bytes / 1e6).toFixed(2), source: manifest.blenderVersion }, null, 2));
