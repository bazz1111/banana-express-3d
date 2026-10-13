import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export const canonicalDir = path.resolve(import.meta.dirname, '../assets/export');
export const runtimeDir = path.resolve(import.meta.dirname, '../public/assets');
const extension = 'EXT_meshopt_compression';
export const isMain = (url) => process.argv[1] && url === pathToFileURL(path.resolve(process.argv[1])).href;
export const hash = (data) => createHash('sha256').update(data).digest('hex');

export function readGlb(input) {
  const buffer=Buffer.from(input);
  assert.ok(buffer.length>=28 && buffer.readUInt32LE(0)===0x46546c67 && buffer.readUInt32LE(4)===2,'Invalid GLB header');
  assert.equal(buffer.readUInt32LE(8),buffer.length,'GLB length mismatch');
  const length=buffer.readUInt32LE(12),binaryOffset=28+length;
  assert.equal(buffer.readUInt32LE(16),0x4e4f534a,'Missing GLB JSON');
  assert.ok(binaryOffset<=buffer.length,'Truncated GLB');
  assert.equal(buffer.readUInt32LE(24+length),0x004e4942,'Missing GLB binary');
  assert.equal(buffer.readUInt32LE(20+length),buffer.length-binaryOffset,'GLB binary length mismatch');
  return {json:JSON.parse(buffer.subarray(20,20+length).toString()),binary:buffer.subarray(binaryOffset),binaryOffset};
}
export function writeGlb(json,binary) {
  const text=Buffer.from(JSON.stringify(json)),j=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),b=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+j.length+b.length,8);header.writeUInt32LE(j.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(b.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,j,bh,b]);
}
export function stableJson(value) {
  if(Array.isArray(value))return value.map(stableJson);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableJson(value[k])]));
  return value;
}
export async function decodedSnapshot(input) {
  await MeshoptDecoder.ready;
  const {json,binary}=readGlb(input),metadata=structuredClone(json),views=[];
  for(const [i,view] of (json.bufferViews??[]).entries()) {
    const ext=view.extensions?.[extension];let data;
    if(ext) {
      assert.equal(ext.buffer,0,'Compressed view must use embedded GLB data');
      assert.equal(ext.count*ext.byteStride,view.byteLength,'Meshopt decoded size mismatch');
      assert.ok((ext.byteOffset??0)+ext.byteLength<=binary.length,'Truncated Meshopt buffer');
      data=new Uint8Array(view.byteLength);
      MeshoptDecoder.decodeGltfBuffer(data,ext.count,ext.byteStride,binary.subarray(ext.byteOffset??0,(ext.byteOffset??0)+ext.byteLength),ext.mode,ext.filter??'NONE');
    }else{
      assert.equal(view.buffer,0,'Only embedded GLB buffers are supported');
      assert.ok((view.byteOffset??0)+view.byteLength<=binary.length,'Truncated bufferView');
      data=binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
    }
    views.push(hash(data));
    delete metadata.bufferViews[i].buffer;delete metadata.bufferViews[i].byteOffset;
    if(metadata.bufferViews[i].extensions){delete metadata.bufferViews[i].extensions[extension];if(!Object.keys(metadata.bufferViews[i].extensions).length)delete metadata.bufferViews[i].extensions;}
  }
  metadata.buffers=(metadata.buffers??[]).filter(b=>!b.extensions?.[extension]?.fallback).map(b=>{delete b.byteLength;delete b.uri;return b;});
  for(const field of ['extensionsUsed','extensionsRequired'])if(metadata[field]){metadata[field]=metadata[field].filter(e=>e!==extension);if(!metadata[field].length)delete metadata[field];}
  if(metadata.asset)delete metadata.asset.generator; // Exporter version is not asset content.
  return {metadata:stableJson(metadata),bufferViews:views};
}
export async function compareGlbs(source,runtime) {
  const {json}=readGlb(runtime);
  assert.ok(json.extensionsRequired?.includes(extension) && json.bufferViews?.some(v=>v.extensions?.[extension]),'Runtime GLB must require Meshopt compression');
  assert.deepEqual(await decodedSnapshot(runtime),await decodedSnapshot(source),'Decoded asset content differs (geometry, colors, images or metadata)');
  // Independently exercise the official glTF reader and decoder used by tooling.
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
  await io.readBinary(new Uint8Array(runtime));
  return true;
}
export async function checkCompressed(sourceDir=canonicalDir,outputDir=runtimeDir) {
  const files=(await readdir(sourceDir)).filter(f=>f.endsWith('.glb')).sort();assert.ok(files.length,'No canonical GLBs');
  assert.deepEqual((await readdir(outputDir)).filter(f=>f.endsWith('.glb')).sort(),files,'Runtime GLB file set differs');
  let sourceBytes=0,runtimeBytes=0;
  for(const file of files){const [a,b]=await Promise.all([readFile(path.join(sourceDir,file)),readFile(path.join(outputDir,file))]);try{await compareGlbs(a,b);}catch(error){throw new Error(`${file}: ${error.message}`,{cause:error});}sourceBytes+=a.length;runtimeBytes+=b.length;}
  for(const file of ['manifest.json','course.json'])assert.deepEqual(await readFile(path.join(outputDir,file)),await readFile(path.join(sourceDir,file)),`${file} differs from canonical export`);
  return {assets:files.length,sourceBytes,runtimeBytes,savedPercent:+(100*(1-runtimeBytes/sourceBytes)).toFixed(2),lossless:true,orderedVertices:true};
}
if(isMain(import.meta.url))console.log(JSON.stringify(await checkCompressed(process.argv[2]??canonicalDir,process.argv[3]??runtimeDir),null,2));
