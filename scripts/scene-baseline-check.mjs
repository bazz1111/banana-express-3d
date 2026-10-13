// Native exports can rename Blender datablocks; compare decoded rendering data, not file labels.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const before=process.env.SCENE_BASELINE||'artifacts/rock-before-assets',after='public/assets';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function rendering(file){
  const b=fs.readFileSync(file),d=JSON.parse(b.subarray(20,20+b.readUInt32LE(12))),bin=28+b.readUInt32LE(12);
  const accessor=(i,triangles=false)=>{
    const a=d.accessors[i],v=d.bufferViews[a.bufferView],size={5121:1,5123:2,5125:4,5126:4}[a.componentType];
    const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type]*size,stride=v.byteStride??width;
    const packed=Buffer.alloc(a.count*width),start=bin+(v.byteOffset??0)+(a.byteOffset??0);
    for(let j=0;j<a.count;j++)b.copy(packed,j*width,start+j*stride,start+j*stride+width);
    let content=packed;
    if(triangles){
      const values=Array.from({length:a.count},(_,j)=>size===2?packed.readUInt16LE(j*size):size===4?packed.readUInt32LE(j*size):packed[j]);
      const faces=[];for(let j=0;j<values.length;j+=3){const t=values.slice(j,j+3),first=t.indexOf(Math.min(...t));faces.push([...t.slice(first),...t.slice(0,first)]);}
      faces.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);content=Buffer.alloc(a.count*4);
      faces.flat().forEach((v,j)=>content.writeUInt32LE(v,j*4));
    }
    return {type:a.type,component:a.componentType,normalized:!!a.normalized,count:a.count,hash:hash(content)};
  };
  const primitive=p=>({attributes:Object.fromEntries(Object.entries(p.attributes).map(([k,v])=>[k,accessor(v)])),
    indices:accessor(p.indices,true),material:p.material,mode:p.mode??4});
  const materials=(d.materials??[]).map(({name,...rest})=>rest);
  const nodes=d.nodes.map(({name,mesh,children,translation,rotation,scale,matrix})=>({name,
    primitives:mesh===undefined?undefined:d.meshes[mesh].primitives.map(primitive),children,translation,rotation,scale,matrix}));
  const images=(d.images??[]).map(i=>{const v=d.bufferViews[i.bufferView];return {type:i.mimeType,hash:hash(b.subarray(bin+v.byteOffset,bin+v.byteOffset+v.byteLength))};});
  return {nodes,materials,images,textures:d.textures,samplers:d.samplers};
}
const previous=JSON.parse(fs.readFileSync(before+'/manifest.json')),changed=new Set((process.env.SCENE_CHANGED||'roadTile,roadCourse,mountain,forestHill,valley').split(','));
const checked=[];
for(const [name,item] of Object.entries(previous.models)){
  if(changed.has(name))continue;
  assert.deepEqual(rendering(after+'/'+item.file),rendering(before+'/'+item.file),`Unrelated native asset changed: ${name}`);checked.push(name);
}
assert.deepEqual(fs.readFileSync(after+'/course.json'),fs.readFileSync(before+'/course.json'),'Road/game configuration changed during scene art work');
const report={checkedModels:checked.length,checked,permittedChanges:[...changed],courseUnchanged:true};
fs.writeFileSync(process.env.SCENE_REPORT||'artifacts/rock-unchanged-assets.json',JSON.stringify(report,null,2));console.log('SCENE_UNCHANGED_ASSETS_PASS',JSON.stringify(report));
