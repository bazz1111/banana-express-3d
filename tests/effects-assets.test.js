import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readGlb} from '../scripts/check-compressed.mjs';

test('the generated impact card faces its billboard camera and sparks stay below prop scale',async()=>{
  const bounds=async name=>{
    const {json}=readGlb(await readFile(new URL('../assets/export/'+name+'.glb',import.meta.url)));
    const p=json.meshes.flatMap(m=>m.primitives.map(p=>json.accessors[p.attributes.POSITION]));
    const lo=[0,1,2].map(i=>Math.min(...p.map(a=>a.min[i]))),hi=[0,1,2].map(i=>Math.max(...p.map(a=>a.max[i])));
    return {lo,hi,size:hi.map((v,i)=>v-lo[i])};
  };
  const star=await bounds('burst'),spark=await bounds('spark');
  assert.ok(star.size[0]>.5&&star.size[1]>.5,'Impact front must occupy the billboard XY plane');
  assert.ok(star.size[2]<Math.min(star.size[0],star.size[1])*.2,'A sideways impact mesh is unreadable');
  assert.ok(star.lo.every((v,i)=>Math.abs(v+star.hi[i])<1e-5),'Impact must be centred on the kicking foot');
  assert.ok(Math.max(...spark.size)<.3,'A unit-size spark becomes a metre-wide ball at the current particle scale');
});
