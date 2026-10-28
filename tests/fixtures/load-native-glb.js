import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {readGlb,writeGlb} from '../../scripts/check-compressed.mjs';

// Node has no browser image decoder. This geometry/physics test adapter retains
// every binary byte, skin, Action, transform and material slot. Browser rendering
// and native checks separately validate the actual packed paint and UVs.
export async function loadNativeGlb(file){
  const {json,binary}=readGlb(await readFile(file));
  json.materials=json.materials.map(m=>({name:m.name,doubleSided:m.doubleSided,
    pbrMetallicRoughness:{baseColorFactor:m.pbrMetallicRoughness?.baseColorFactor,metallicFactor:0,roughnessFactor:.85}}));
  delete json.images;delete json.textures;delete json.samplers;
  const bytes=writeGlb(json,binary);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
