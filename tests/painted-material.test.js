import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as view from '../src/view.js';

test('toon conversion keeps the authored paint and alpha cutout without making leaves opaque',()=>{
  assert.equal(typeof view.paintedMaterial,'function');
  const map=new THREE.Texture(),gradient=new THREE.Texture();
  const source=new THREE.MeshStandardMaterial({map,color:0xffdc70,alphaTest:.45,transparent:true,
    opacity:.8,depthWrite:false,side:THREE.DoubleSide,emissive:0x241000,emissiveIntensity:.2,vertexColors:true});
  const result=view.paintedMaterial(source,{gradient,name:'palm',anisotropy:4});
  assert.equal(result.type,'MeshToonMaterial');assert.equal(result.map,map);
  assert.equal(result.gradientMap,gradient);assert.equal(result.alphaTest,.45);
  assert.equal(result.transparent,true);assert.equal(result.opacity,.8);
  assert.equal(result.depthWrite,false);assert.equal(result.side,THREE.DoubleSide);
  assert.ok(result.color.equals(source.color)&&result.emissive.equals(source.emissive));
  assert.equal(map.anisotropy,4);assert.equal(result.vertexColors,true);
});

test('a textured Tripo skin without COLOR_0 keeps vertex colors disabled',()=>{
  const source=new THREE.MeshStandardMaterial({map:new THREE.Texture(),color:0xffffff});
  const result=view.paintedMaterial(source,{gradient:new THREE.Texture(),name:'riderSkinned',anisotropy:4});
  assert.equal(result.vertexColors,false,'A missing color attribute otherwise turns the entire rider black');
  assert.equal(result.map,source.map);assert.equal(result.flatShading,false);
});

test('impact and glow preserve the generated star texture and use the intended depth/blend modes',()=>{
  assert.equal(typeof view.impactMaterial,'function');
  const map=new THREE.Texture(),source=new THREE.MeshStandardMaterial({map,color:0xffdf44,alphaTest:.3});
  for(const glow of [false,true]){
    const result=view.impactMaterial(source,glow);
    assert.equal(result.map,map);assert.ok(result.color.equals(source.color));
    assert.equal(result.alphaTest,.3);assert.equal(result.toneMapped,false);
    assert.equal(result.blending,glow?THREE.AdditiveBlending:THREE.NormalBlending);
    assert.equal(result.depthWrite,!glow);assert.equal(result.side,THREE.DoubleSide);
  }
});
