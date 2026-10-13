import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

async function implementation(file) {try{return await import(`../scripts/${file}.mjs`);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;}}
function get(port,url,headers={},method='GET') {return new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path:url,headers,method},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});}
async function fixture(callback){
 const dir=await mkdtemp(path.join(tmpdir(),'banana-delivery-')),root=path.join(dir,'dist');await mkdir(path.join(root,'assets'),{recursive:true});
 const binary=Buffer.concat([Buffer.from('glTF'),Buffer.alloc(24000,7)]);await writeFile(path.join(root,'assets/rider.glb'),binary);await writeFile(path.join(root,'index.html'),'<h1>banana</h1>');await writeFile(path.join(root,'assets/app-abcdefgh.js'),'console.log("banana");'.repeat(300));await writeFile(path.join(root,'assets/tiny.json'),'{}');
 try{await callback({dir,root,binary});}finally{await rm(dir,{recursive:true,force:true});}
}

test('production GLBs negotiate lossless Brotli/gzip, MIME, HEAD and cache validation', async()=>{
 const {precompressDist}=await implementation('precompress-dist');assert.equal(typeof precompressDist,'function','Missing production precompression');
 const {startServer}=await implementation('serve');assert.equal(typeof startServer,'function','Missing production server');
 await fixture(async({root,binary})=>{
  await precompressDist(root);const server=await startServer({root,host:'127.0.0.1',port:0});
  try{
   const port=server.address().port;
   const br=await get(port,'/assets/rider.glb',{'Accept-Encoding':'gzip, br'});assert.equal(br.status,200);assert.equal(br.headers['content-type'],'model/gltf-binary');assert.equal(br.headers['content-encoding'],'br');assert.match(br.headers.vary,/Accept-Encoding/i);assert.deepEqual(brotliDecompressSync(br.body),binary);
   const gzip=await get(port,'/assets/rider.glb',{'Accept-Encoding':'br;q=0, gzip'});assert.equal(gzip.headers['content-encoding'],'gzip');assert.deepEqual(gunzipSync(gzip.body),binary);
   const plain=await get(port,'/assets/rider.glb');assert.equal(plain.headers['content-encoding'],undefined);assert.deepEqual(plain.body,binary);
   const cached=await get(port,'/assets/rider.glb',{'Accept-Encoding':'br','If-None-Match':br.headers.etag});assert.equal(cached.status,304);assert.equal(cached.body.length,0);
   const head=await get(port,'/assets/rider.glb',{'Accept-Encoding':'br'},'HEAD');assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),br.body.length);
   assert.match((await get(port,'/assets/app-abcdefgh.js')).headers['cache-control'],/immutable/);assert.doesNotMatch(plain.headers['cache-control'],/immutable/);
   assert.equal((await get(port,'/assets/rider.glb',{'Accept-Encoding':'br;q=0,gzip;q=0,identity;q=0'})).status,406);
   await assert.rejects(readFile(path.join(root,'assets/tiny.json.br')),error=>error.code==='ENOENT');
  }finally{await new Promise(resolve=>server.close(resolve));}
 });
});

test('production server rejects traversal and source symlinks, missing assets never become HTML', async()=>{
 const {startServer}=await implementation('serve');assert.equal(typeof startServer,'function','Missing production server');
 await fixture(async({dir,root})=>{
  await writeFile(path.join(dir,'private.txt'),'source secret');await symlink(path.join(dir,'private.txt'),path.join(root,'leak.txt'));
  const server=await startServer({root,host:'127.0.0.1',port:0});try{
   const port=server.address().port;
   for(const url of ['/%2e%2e/private.txt','/../private.txt','/assets/%2e%2e/%2e%2e/private.txt','/leak.txt'])assert.equal((await get(port,url)).status,403,url);
   assert.equal((await get(port,'/%xx')).status,400);assert.equal((await get(port,'/assets/missing.glb')).status,404);assert.equal((await get(port,'/missing-route')).status,404);assert.equal((await get(port,'/')).status,200);
   assert.equal((await get(port,'/',{},'POST')).status,405);
  }finally{await new Promise(resolve=>server.close(resolve));}
 });
});

test('audio and geometry byte ranges return exact identity bytes with correct bounds',async()=>{
 const {startServer}=await implementation('serve');assert.equal(typeof startServer,'function','Missing production server');
 await fixture(async({root,binary})=>{const server=await startServer({root,host:'127.0.0.1',port:0});try{
  const port=server.address().port,range=await get(port,'/assets/rider.glb',{Range:'bytes=0-3','Accept-Encoding':'br,gzip'});assert.equal(range.status,206);assert.equal(range.headers['content-range'],`bytes 0-3/${binary.length}`);assert.equal(range.headers['content-encoding'],undefined);assert.deepEqual(range.body,Buffer.from('glTF'));
  const suffix=await get(port,'/assets/rider.glb',{Range:'bytes=-2'});assert.deepEqual(suffix.body,binary.subarray(-2));
  const changed=await get(port,'/assets/rider.glb',{Range:'bytes=0-3','If-Range':'"old-version"'});assert.equal(changed.status,200);assert.deepEqual(changed.body,binary);
  const bad=await get(port,'/assets/rider.glb',{Range:'bytes=999999-'});assert.equal(bad.status,416);assert.equal(bad.headers['content-range'],`bytes */${binary.length}`);
 }finally{await new Promise(resolve=>server.close(resolve));}});
});
