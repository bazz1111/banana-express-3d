import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as audio from '../src/audio.js';
const {GameAudio,SAMPLE_MANIFEST}=audio;
// WebAudio is browser-only: fake the platform boundary, keep game voice/loading logic real.
const param=()=>({value:0,setValueAtTime(){},setTargetAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
const node=()=>({connect(){return this;},disconnect(){},gain:param(),frequency:param(),Q:param(),playbackRate:param(),start(){this.started=true;},stop(){this.stopped=true;this.onended?.();}});
const context=()=>({state:'running',currentTime:0,destination:node(),createBufferSource:node,createOscillator:node,createGain:node,createBiquadFilter:node,decodeAudioData:async()=>({duration:.2}),resume:async()=>{},suspend:async()=>{}});
test('missing samples quietly use synthesis and repeated loads cache successful decoding',async()=>{
 const a=new GameAudio();a.context=context();a.master=node();assert.equal(typeof a.loadSamples,'function');
 let fetches=0;const original=globalThis.fetch;globalThis.fetch=async url=>{fetches++;if(url.includes('missing'))return {ok:false};return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};
 try{await a.loadSamples({pickup:['/good.m4a'],kickHeavy:['/missing.m4a']});await a.loadSamples({pickup:['/good.m4a']});assert.equal(fetches,2);
  assert.equal(a.samples.get('/good.m4a').duration,.2);let calls=0;a.sweep=()=>calls++;a.burst=()=>{};a.tone=()=>{};a.event({type:'kick',charged:true});assert.ok(calls>0);
 }finally{globalThis.fetch=original;}
});
test('same-type sample cap evicts oldest and pause/reset stop every voice, with ±5% pitch',()=>{
 const a=new GameAudio();assert.equal(typeof a.setPaused,'function');a.context=context();a.master=node();a.manifest={pickup:['/good.m4a']};a.samples.set('/good.m4a',{duration:.2});
 const first=[];for(let i=0;i<9;i++){a.event({type:'pickup',kind:'banana'});first.push([...a.voices.get('pickup')].at(-1));}
 assert.equal(a.voices.get('pickup').length,4);assert.ok(first[0].source.stopped);
 for(const v of a.voices.get('pickup'))assert.ok(v.source.playbackRate.value>=.95&&v.source.playbackRate.value<=1.05);
 a.setPaused(true);assert.equal(a.voices.size,0);a.event({type:'pickup',kind:'banana'});assert.equal(a.voices.size,0);
 a.setPaused(false);a.event({type:'pickup',kind:'banana'});assert.equal(a.voices.size,1);a.reset();assert.equal(a.voices.size,0);
});
test('sample manifest uses shipped licensed files with a total below 600KB',()=>{
 assert.ok(SAMPLE_MANIFEST);const files=[...new Set(Object.values(SAMPLE_MANIFEST).flat())],licenses=fs.readFileSync('public/audio/LICENSES.md','utf8');let bytes=0;
 for(const url of files){bytes+=fs.statSync(`public${url}`).size;assert.ok(licenses.includes(url.split('/').at(-1)));}
 assert.ok(bytes<=600_000);for(const key of ['wind','chain','kickHeavy','kickLight','metal','land','debris','dash','miss','pickup','powerup','shield','collision','stunt','jump','launch','go','finish'])assert.ok(SAMPLE_MANIFEST[key]);
});

test('sampled wind and chain loops follow speed and stop on pause',()=>{
 const a=new GameAudio();a.context=context();a.master=node();a.wind=node();
 a.manifest={wind:['/wind.m4a'],chain:['/chain.m4a']};a.samples.set('/wind.m4a',{});a.samples.set('/chain.m4a',{});
 a.update(12);assert.equal(a.loops?.size,2,'speed should start the two sampled loops');
 assert.ok([...a.loops.values()].every(v=>v.source.loop));a.setPaused(true);assert.equal(a.loops.size,0);
 a.setPaused(false);a.update(12);assert.equal(a.loops.size,2);a.update(0);assert.equal(a.loops.size,0);
});
test('successful sampled kicks include the whoosh and body/debris foley',()=>{
 const a=new GameAudio();a.context=context();a.master=node();a.manifest={kickHeavy:['/kick'],miss:['/whoosh'],metal:['/metal'],debris:['/debris']};
 for(const url of Object.values(a.manifest).flat())a.samples.set(url,{});
 a.event({type:'kick',charged:true});assert.deepEqual([...a.voices.keys()].sort(),['debris','kickHeavy','metal','miss']);
});
