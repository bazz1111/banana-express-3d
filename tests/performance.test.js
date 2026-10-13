import test from 'node:test';
import assert from 'node:assert/strict';
test('performance summaries use every sampled frame including long stalls and every render pass',async()=>{
 let module;try{module=await import('../scripts/perf-check.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;module={};}
 assert.equal(typeof module.summarizeFrames,'function','Missing complete-window performance summary');
 const frames=[{intervalMs:null,calls:10,triangles:100,phase:'racing'},{intervalMs:5,calls:14,triangles:160,phase:'racing'},{intervalMs:6,calls:20,triangles:400,phase:'racing'},{intervalMs:1200,calls:30,triangles:700,phase:'racing'}];
 const report=module.summarizeFrames(frames);assert.equal(report.frames,4);assert.equal(report.intervals,3);assert.equal(report.p95,1200);assert.equal(report.calls,18.5);assert.equal(report.maxCalls,30);assert.equal(report.triangles,340);assert.equal(report.maxTriangles,700);assert.deepEqual(report.phases,{racing:4});
 assert.equal(module.summarizeFrames(frames.concat(Array.from({length:700},()=>({intervalMs:10,calls:1,triangles:1,phase:'racing'})))).frames,704);
});
