import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

async function pipeline() {
  try { return await import('../scripts/compress-assets.mjs'); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; }
}
function fixture() {
  const floats = new Float32Array([0,0,0, 1,0,0, 0,1,0, .2,.3,.4,1, .4,.5,.6,1, .6,.7,.8,1]);
  const binary = Buffer.concat([Buffer.from(floats.buffer), Buffer.from(new Uint16Array([0,1,2]).buffer)]);
  return { json: { asset:{version:'2.0',generator:'fixture'}, buffers:[{byteLength:binary.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:48},{buffer:0,byteOffset:84,byteLength:6}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}, {bufferView:1,componentType:5126,count:3,type:'VEC4'}, {bufferView:2,componentType:5123,count:3,type:'SCALAR'}],
    meshes:[{primitives:[{attributes:{POSITION:0,COLOR_0:1},indices:2}]}],
    nodes:[{name:'root',mesh:0,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,1,2,3,1],extras:{terrainGrid:{heights:[1,2,3]},vertexAO:{strength:.3}}}],scenes:[{nodes:[0]}],scene:0 }, binary };
}
function pack({json,binary}) {
  const text=Buffer.from(JSON.stringify(json)),j=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),b=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+j.length+b.length,8);header.writeUInt32LE(j.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(b.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,j,bh,b]);
}

test('lossless compression retains ordered colors, indices, matrices and extras', async () => {
  const {compressGlb}=await pipeline();assert.equal(typeof compressGlb,'function','Missing lossless compression pipeline');
  const {compareGlbs,readGlb}=await import('../scripts/check-compressed.mjs');
  const source=pack(fixture()), output=await compressGlb(source);
  const glb=readGlb(output);assert.ok(glb.json.extensionsRequired.includes('EXT_meshopt_compression'));
  assert.equal(await compareGlbs(source,output),true);
  for(const mutate of [f=>{f.binary.writeFloatLE(.9,36);},f=>{f.json.nodes[0].matrix[12]=8;},f=>{f.json.nodes[0].extras.terrainGrid.heights[0]=9;}]){
    const changed=fixture();mutate(changed);
    await assert.rejects(compareGlbs(pack(changed),output),/differs|mismatch/);
  }
  const damaged=Buffer.from(output);const ext=glb.json.bufferViews[0].extensions.EXT_meshopt_compression;damaged[glb.binaryOffset+ext.byteOffset]=0;
  await assert.rejects(compareGlbs(source,damaged));
  await assert.rejects(compareGlbs(source,source),/Meshopt/);
});

test('source fingerprints ignore layout and generator but catch colors and transforms', async () => {
  const {compressGlb}=await pipeline();assert.equal(typeof compressGlb,'function','Missing lossless compression pipeline');
  const {fingerprintGlb}=await import('../scripts/asset-fingerprint.mjs');
  const source=fixture(),expected=await fingerprintGlb(pack(source));
  source.json.asset.generator='another exporter';assert.deepEqual(await fingerprintGlb(pack(source)),expected);
  assert.deepEqual(await fingerprintGlb(await compressGlb(pack(source))),expected);
  source.binary.writeFloatLE(.8,36);assert.notDeepEqual(await fingerprintGlb(pack(source)),expected);
  source.json.nodes[0].matrix[12]=4;assert.notDeepEqual(await fingerprintGlb(pack(source)),expected);
});

test('delivery copies manifest and course and rejects stale or missing output', async () => {
  const {compressAssets}=await pipeline();assert.equal(typeof compressAssets,'function','Missing delivery pipeline');
  const {checkCompressed}=await import('../scripts/check-compressed.mjs');
  const dir=await mkdtemp(path.join(tmpdir(),'banana-compression-'));
  try{
    const source=path.join(dir,'source'),runtime=path.join(dir,'runtime');await mkdir(source);
    await writeFile(path.join(source,'tiny.glb'),pack(fixture()));
    await writeFile(path.join(source,'manifest.json'),JSON.stringify({models:{tiny:{file:'tiny.glb'}}}));
    await writeFile(path.join(source,'course.json'),JSON.stringify({mode:'endless'}));
    await compressAssets(source,runtime);assert.equal((await checkCompressed(source,runtime)).assets,1);
    assert.deepEqual(await readFile(path.join(runtime,'course.json')),await readFile(path.join(source,'course.json')));
    await writeFile(path.join(runtime,'extra.glb'),pack(fixture()));await assert.rejects(checkCompressed(source,runtime),/file set/);
    await rm(path.join(runtime,'extra.glb'));await writeFile(path.join(runtime,'course.json'),'{}');await assert.rejects(checkCompressed(source,runtime),/course/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('lossless delivery preserves embedded images, animation samples, skins and morph targets', async () => {
  const {compressGlb}=await pipeline(),{compareGlbs}=await import('../scripts/check-compressed.mjs');
  const f=fixture();
  const view=(bytes)=>{const padding=(4-f.binary.length%4)%4;f.binary=Buffer.concat([f.binary,Buffer.alloc(padding)]);const index=f.json.bufferViews.length;f.json.bufferViews.push({buffer:0,byteOffset:f.binary.length,byteLength:bytes.length});f.binary=Buffer.concat([f.binary,bytes]);f.json.buffers[0].byteLength=f.binary.length;return index;};
  const accessor=(values,type,count)=>{const index=f.json.accessors.length;f.json.accessors.push({bufferView:view(Buffer.from(values.buffer)),componentType:values instanceof Uint8Array?5121:5126,count,type});return index;};
  const joints=accessor(new Uint8Array(12),'VEC4',3),weights=accessor(new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0]),'VEC4',3);
  f.json.meshes[0].primitives[0].attributes.JOINTS_0=joints;f.json.meshes[0].primitives[0].attributes.WEIGHTS_0=weights;
  f.json.nodes.push({name:'joint'});f.json.nodes[0].children=[1];f.json.nodes[0].skin=0;
  const inverse=accessor(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),'MAT4',1);
  f.json.skins=[{name:'rig',joints:[1],inverseBindMatrices:inverse,extras:{author:'Blender'}}];
  const input=accessor(new Float32Array([0,1]),'SCALAR',2),output=accessor(new Float32Array([0,0,0,1,2,3]),'VEC3',2);
  f.json.animations=[{name:'ride',samplers:[{input,output,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:1,path:'translation'}}],extras:{loop:true}}];
  const morph=accessor(new Float32Array([0,0,0,.1,0,0,0,.2,0]),'VEC3',3);
  f.json.meshes[0].primitives[0].targets=[{POSITION:morph}];f.json.meshes[0].weights=[0];
  f.json.images=[{name:'packed paint',mimeType:'image/png',bufferView:view(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'))}];
  const original=pack(f),compressed=await compressGlb(original);assert.equal(await compareGlbs(original,compressed),true);
  for(const accessorIndex of [weights,inverse,input,output,morph]){
    const changed=structuredClone(f);changed.binary=Buffer.from(f.binary);const offset=changed.json.bufferViews[changed.json.accessors[accessorIndex].bufferView].byteOffset;
    changed.binary.writeFloatLE(9,offset);await assert.rejects(compareGlbs(pack(changed),compressed),/differs/);
  }
  const changed=structuredClone(f);changed.binary=Buffer.from(f.binary);changed.binary[changed.json.bufferViews[changed.json.images[0].bufferView].byteOffset+10]^=1;
  await assert.rejects(compareGlbs(pack(changed),compressed),/differs/);
  const skinChanged=structuredClone(f);skinChanged.json.skins[0].extras.author='damaged';await assert.rejects(compareGlbs(pack(skinChanged),compressed),/differs/);
});

test('rebuild fingerprint command fails with a color drift report, ignoring exporter generator', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'banana-fingerprint-'));
  try {
    const source=path.join(dir,'source'),target=path.join(dir,'expected.json');await mkdir(source);
    const f=fixture();await writeFile(path.join(source,'tiny.glb'),pack(f));
    await writeFile(path.join(source,'manifest.json'),JSON.stringify({models:{tiny:{file:'tiny.glb'}}}));
    await writeFile(path.join(source,'course.json'),'{}');
    const script=path.resolve(import.meta.dirname,'../scripts/asset-fingerprint.mjs');
    execFileSync(process.execPath,[script,'write',source,target],{cwd:dir});
    f.json.asset.generator='different Blender build';await writeFile(path.join(source,'tiny.glb'),pack(f));
    execFileSync(process.execPath,[script,'check',source,target],{cwd:dir});
    f.binary.writeFloatLE(.81,36);await writeFile(path.join(source,'tiny.glb'),pack(f));
    assert.throws(()=>execFileSync(process.execPath,[script,'check',source,target],{cwd:dir,stdio:'pipe'}),error=>error.status===1);
    const report=JSON.parse(await readFile(path.join(dir,'artifacts/asset-fingerprint-diff.json'),'utf8'));
    assert.equal(report.matches,false);assert.deepEqual(report.differences.map(d=>d.file),['tiny.glb']);
  } finally {await rm(dir,{recursive:true,force:true});}
});
