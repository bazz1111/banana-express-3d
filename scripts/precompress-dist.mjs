import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';
import { pathToFileURL } from 'node:url';
const compressBrotli=promisify(brotliCompress),compressGzip=promisify(gzip);
const eligible=new Set(['.glb','.json','.js','.css','.wav','.ogg','.mp3','.m4a','.aac','.flac']);
export async function precompressDist(root=path.resolve(import.meta.dirname,'../dist')) {
  const report={files:0,sourceBytes:0,brotliBytes:0,gzipBytes:0};
  async function visit(dir){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()){await visit(file);continue;}
      if(!entry.isFile()||!eligible.has(path.extname(file).toLowerCase()))continue;
      const source=await readFile(file);report.files++;report.sourceBytes+=source.length;
      for(const [suffix,compress,key] of [['.br',compressBrotli,'brotliBytes'],['.gz',compressGzip,'gzipBytes']]){
        const encoded=await compress(source,suffix==='.br'?{params:{[constants.BROTLI_PARAM_QUALITY]:9}}:{level:9});
        // Small or already-compressed audio stays identity: avoid sidecar overhead without a useful saving.
        if(source.length-encoded.length>=128 && encoded.length<=source.length*.95){await writeFile(file+suffix,encoded);report[key]+=encoded.length;}
        else{await rm(file+suffix,{force:true});report[key]+=source.length;}
      }
    }
  }
  await visit(root);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log('PRECOMPRESSED_DIST',JSON.stringify(await precompressDist(process.argv[2])));
