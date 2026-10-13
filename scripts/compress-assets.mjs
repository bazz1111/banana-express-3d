import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { MeshoptEncoder } from 'meshoptimizer';
import { canonicalDir, runtimeDir, readGlb, writeGlb, compareGlbs, isMain, checkCompressed } from './check-compressed.mjs';

// Compress the original bufferViews directly: no reorder, quantization, filters,
// or JSON roundtrip through a scene graph. Matrices and every extra survive intact.
export async function compressGlb(input) {
  await MeshoptEncoder.ready;
  const {json,binary}=readGlb(input),extension='EXT_meshopt_compression';
  assert.equal(json.buffers.length,1,'Canonical assets must have one embedded buffer');
  assert.ok(!json.buffers[0].uri && !json.extensionsUsed?.includes(extension),'Expected uncompressed canonical GLB');
  const originalBuffer={...json.buffers[0]},parts=[];let offset=0,fallbackSize=0,compressedViews=0;
  const append=(data)=>{const at=offset;parts.push(Buffer.from(data));offset+=data.length;const padding=(4-offset%4)%4;if(padding){parts.push(Buffer.alloc(padding));offset+=padding;}return at;};
  const images=new Set((json.images??[]).map(i=>i.bufferView));
  const indices=new Set((json.meshes??[]).flatMap(m=>m.primitives.map(p=>json.accessors[p.indices]?.bufferView)).filter(i=>i!==undefined));
  for(const [i,view] of json.bufferViews.entries()) {
    assert.equal(view.buffer,0,'Expected embedded canonical bufferView');
    const bytes=binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
    assert.equal(bytes.length,view.byteLength,'Truncated canonical bufferView');
    const accessor=json.accessors?.find(a=>a.bufferView===i),indexStride=accessor?.componentType===5123?2:accessor?.componentType===5125?4:0;
    let stride=view.byteStride??(accessor ? ({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16}[accessor.type]*({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[accessor.componentType])):4);
    const mode=indices.has(i)&&indexStride?'INDICES':'ATTRIBUTES';if(mode==='INDICES')stride=indexStride;
    if(images.has(i)||!stride||bytes.length%stride||mode==='ATTRIBUTES'&&(stride%4||stride>256)) {view.byteOffset=append(bytes);continue;}
    const encoded=MeshoptEncoder.encodeGltfBuffer(new Uint8Array(bytes),bytes.length/stride,stride,mode);
    view.buffer=1;view.byteOffset=fallbackSize;fallbackSize+=view.byteLength;fallbackSize=(fallbackSize+3)&~3;
    view.extensions={...view.extensions,[extension]:{buffer:0,byteOffset:append(encoded),byteLength:encoded.length,byteStride:stride,count:bytes.length/stride,mode,filter:'NONE'}};compressedViews++;
  }
  assert.ok(compressedViews,'No compressible canonical bufferViews');
  json.buffers=[{...originalBuffer,byteLength:offset},{byteLength:fallbackSize,extensions:{[extension]:{fallback:true}}}];
  json.extensionsUsed=[...new Set([...(json.extensionsUsed??[]),extension])];json.extensionsRequired=[...new Set([...(json.extensionsRequired??[]),extension])];
  const output=writeGlb(json,Buffer.concat(parts));await compareGlbs(input,output);return output;
}
export async function compressAssets(sourceDir=canonicalDir,outputDir=runtimeDir) {
  await mkdir(outputDir,{recursive:true});
  for(const file of (await readdir(sourceDir)).filter(f=>f.endsWith('.glb')).sort())await writeFile(path.join(outputDir,file),await compressGlb(await readFile(path.join(sourceDir,file))));
  for(const file of ['manifest.json','course.json'])await copyFile(path.join(sourceDir,file),path.join(outputDir,file));
  return checkCompressed(sourceDir,outputDir);
}
if(isMain(import.meta.url))console.log(JSON.stringify(await compressAssets(process.argv[2]??canonicalDir,process.argv[3]??runtimeDir),null,2));
