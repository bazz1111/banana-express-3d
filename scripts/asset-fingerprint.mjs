import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { canonicalDir, decodedSnapshot, hash, readGlb, stableJson, isMain } from './check-compressed.mjs';
const fixture=path.resolve(import.meta.dirname,'../tests/fixtures/blender/asset-fingerprint.json');
export async function fingerprintGlb(input) {
  const snapshot=await decodedSnapshot(input),{json}=readGlb(input);
  const triangles=(json.meshes??[]).flatMap(m=>m.primitives).reduce((sum,p)=>sum+((p.mode??4)===4?(json.accessors[p.indices??p.attributes.POSITION].count/3):0),0);
  return {contentHash:hash(JSON.stringify(snapshot)),triangles,nodeNames:(json.nodes??[]).map(n=>n.name??'')};
}
export async function fingerprintAssets(dir=canonicalDir) {
  const assets={};for(const file of (await readdir(dir)).filter(f=>f.endsWith('.glb')).sort())assets[file]=await fingerprintGlb(await readFile(path.join(dir,file)));
  // Runtime terrain/physics parameters and material/variant provenance matter too.
  for(const file of ['manifest.json','course.json']){const data=JSON.parse(await readFile(path.join(dir,file),'utf8'));if(file==='manifest.json')delete data.blenderVersion;assets[file]={contentHash:hash(JSON.stringify(stableJson(data)))};}
  return {version:1,algorithm:'sha256 decoded bufferViews + all glTF metadata (except generator/layout)',assets};
}
if(isMain(import.meta.url)){
  const mode=process.argv[2]??'check',dir=process.argv[3]??canonicalDir,target=process.argv[4]??fixture,actual=await fingerprintAssets(dir);
  if(mode==='write'){await mkdir(path.dirname(target),{recursive:true});await writeFile(target,JSON.stringify(actual,null,2)+'\n');console.log(`Wrote ${target}`);}
  else if(mode==='check'){
    const expected=JSON.parse(await readFile(target,'utf8')),diff=[];
    for(const file of new Set([...Object.keys(expected.assets),...Object.keys(actual.assets)]))if(JSON.stringify(expected.assets[file])!==JSON.stringify(actual.assets[file]))diff.push({file,expected:expected.assets[file],actual:actual.assets[file]});
    await mkdir('artifacts',{recursive:true});await writeFile('artifacts/asset-fingerprint-diff.json',JSON.stringify({matches:!diff.length,differences:diff},null,2)+'\n');
    assert.ok(!diff.length,`Asset source/rebuild drift: ${diff.map(d=>d.file).join(', ')}; see artifacts/asset-fingerprint-diff.json`);console.log(`Fingerprints match: ${Object.keys(actual.assets).length} files`);
  }else throw new Error('Usage: asset-fingerprint.mjs [check|write] [canonical-dir] [fixture-path]');
}
