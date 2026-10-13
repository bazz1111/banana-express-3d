import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.glb':'model/gltf-binary','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.ogg':'audio/ogg','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.aac':'audio/aac','.flac':'audio/flac','.woff':'font/woff','.woff2':'font/woff2'};
function quality(header) {
  const values=new Map();for(const part of (header??'').split(',')){
    const [name,...parameters]=part.trim().toLowerCase().split(';');if(!name)continue;
    const q=parameters.find(p=>p.trim().startsWith('q='));const value=q===undefined?1:Number(q.trim().slice(2));values.set(name,Number.isFinite(value)&&value>=0&&value<=1?value:0);
  }
  return encoding=>values.get(encoding)??(encoding==='identity'?(values.get('*')===0?0:1):values.get('*')??0);
}
export async function startServer({root=path.resolve(import.meta.dirname,'../dist'),host='127.0.0.1',port=4173}={}) {
  root=await realpath(root);if(!(await stat(root)).isDirectory())throw new Error('Static root must be a directory');
  const inside=file=>file===root||file.startsWith(root+path.sep);
  async function allowedFile(file){const resolved=await realpath(file);if(!inside(resolved)){const error=new Error('Forbidden');error.code='EACCES';throw error;}const info=await stat(resolved);if(!info.isFile()){const error=new Error('Not found');error.code='ENOENT';throw error;}return {file:resolved,info};}
  const server=createServer((req,res)=>{
    const fail=(status)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(req.method==='HEAD'?undefined:`${status}\n`);};
    (async()=>{
      if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');fail(405);return;}
      let pathname;try{pathname=decodeURIComponent((req.url??'/').split('?')[0]);}catch{fail(400);return;}
      if(pathname.includes('\0')){fail(400);return;}
      if(!pathname.startsWith('/')||pathname.includes('\\')||pathname.split('/').includes('..')){fail(403);return;}
      const original=await allowedFile(path.join(root,pathname==='/'?'index.html':pathname));
      const accept=quality(req.headers['accept-encoding']),choices=[];
      // Byte ranges are served from identity files, including audio seeks.
      if(accept('identity')>0)choices.push({...original,encoding:null,q:accept('identity')});
      if(!req.headers.range||accept('identity')===0)for(const [encoding,suffix] of [['br','.br'],['gzip','.gz']]){
        if(accept(encoding)<=0)continue;
        try{const candidate=await allowedFile(original.file+suffix);if(candidate.info.mtimeMs>=original.info.mtimeMs)choices.push({...candidate,encoding,q:accept(encoding)});}catch(error){if(!['ENOENT','EACCES'].includes(error.code))throw error;}
      }
      // Equal quality prefers Brotli then gzip; an absent header selects identity.
      choices.sort((a,b)=>b.q-a.q||({br:2,gzip:1}[b.encoding]??0)-({br:2,gzip:1}[a.encoding]??0));
      const selected=choices[0];if(!selected){fail(406);return;}
      const etag=`W/"${selected.info.size.toString(16)}-${selected.info.mtimeMs.toString(16)}-${selected.encoding??'identity'}"`;
      const headers={'Content-Type':mime[path.extname(original.file).toLowerCase()]??'application/octet-stream','Vary':'Accept-Encoding','ETag':etag,'Cache-Control':/\-[a-zA-Z0-9_-]{8,}\.[a-z0-9]+$/.test(pathname)?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff'};
      if(selected.encoding)headers['Content-Encoding']=selected.encoding;else headers['Accept-Ranges']='bytes';
      const tags=(req.headers['if-none-match']??'').split(',').map(v=>v.trim().replace(/^W\//,''));
      if(tags.includes('*')||tags.includes(etag.replace(/^W\//,''))){res.writeHead(304,headers);res.end();return;}
      let start=0,end=selected.info.size-1,status=200;
      // Weak stat ETags cannot satisfy If-Range's strong validator; send the full file.
      if(req.headers.range&&!selected.encoding&&!req.headers['if-range']){
        const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if(match&&(match[1]||match[2])){
          start=match[1]?Number(match[1]):Math.max(0,selected.info.size-Number(match[2]));
          end=match[1]&&match[2]?Math.min(Number(match[2]),end):end;
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=selected.info.size||(!match[1]&&Number(match[2])===0)){res.writeHead(416,{...headers,'Content-Range':`bytes */${selected.info.size}`});res.end();return;}
          status=206;headers['Content-Range']=`bytes ${start}-${end}/${selected.info.size}`;
        }else{res.writeHead(416,{...headers,'Content-Range':`bytes */${selected.info.size}`});res.end();return;}
      }
      headers['Content-Length']=Math.max(0,end-start+1);res.writeHead(status,headers);
      if(req.method==='HEAD'||selected.info.size===0){res.end();return;}
      const stream=createReadStream(selected.file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
    })().catch(error=>{if(!res.headersSent)fail(error.code==='ENOENT'?404:error.code==='EACCES'?403:500);else res.destroy();});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{host:{type:'string',default:'127.0.0.1'},port:{type:'string',default:'4173'},strictPort:{type:'boolean'}}});
  const port=Number(values.port);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');
  // Fixed port is always strict: CI must never silently test a different server.
  const server=await startServer({host:values.host,port});console.log(`Banana Express: http://${values.host}:${server.address().port}/`);
}
