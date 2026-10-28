import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import * as view from '../src/view.js';
import {loadNativeGlb} from './fixtures/load-native-glb.js';

test('compound source mappings include every actual roadside source category',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../assets/export/manifest.json',import.meta.url)));
  const ledger=JSON.parse(await readFile(new URL('../assets/sources/banana-tripo-v1/manifest.json',import.meta.url)));
  const bytes=await readFile(new URL('../assets/export/roadCourse.glb',import.meta.url));
  const document=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  const ids=new Set(document.nodes.map(n=>n.extras?.sourceId).filter(Boolean));
  assert.ok(ids.size>8,'The authored course contains multiple real source categories');
  for(const id of ids){
    assert.ok(manifest.models.roadCourse.sourceIds.includes(id),'Missing embedded source '+id);
    assert.ok(ledger.assets.find(a=>a.id===id).runtimeFiles.includes('public/assets/roadCourse.glb'),id+' ledger omits the actual loaded course');
  }
});

test('roadside instances reuse the actual geometry already delivered in the authored course',async()=>{
  assert.equal(typeof view.authoredPrototypes,'function');
  const {scene}=await loadNativeGlb(new URL('../assets/export/roadCourse.glb',import.meta.url));
  const course=scene.getObjectByName('EndlessRoadCourse'),catalog=view.authoredPrototypes(course);
  assert.ok(catalog.size>=12);assert.ok(view.RUNTIME_ASSETS.includes('roadCourse'));
  for(const name of catalog.keys())assert.ok(!view.RUNTIME_ASSETS.includes(name),name+' should not download a duplicate standalone prototype');
  for(const name of ['palm','tree','rock','hut']){
    const {scene:standalone}=await loadNativeGlb(new URL('../assets/export/'+name+'.glb',import.meta.url));
    standalone.updateMatrixWorld(true);let mesh;standalone.traverse(o=>{if(o.isMesh&&!mesh)mesh=o;});
    const expected=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),actual=catalog.get(name).geometry;
    expected.computeBoundingBox();actual.computeBoundingBox();
    assert.equal(actual.index.count,expected.index.count,name+' geometry changed');
    assert.ok(actual.boundingBox.min.distanceTo(expected.boundingBox.min)<1e-5&&actual.boundingBox.max.distanceTo(expected.boundingBox.max)<1e-5,name+' applied a placement transform twice');
    const samples=g=>{const p=g.attributes.position;return new Set(Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(',')));};
    assert.deepEqual(samples(actual),samples(expected),name+' does not retain its source shape');
    expected.dispose();
  }
  const geometry=catalog.get('tree').geometry,first=geometry.attributes.position.getX(0);
  course.position.set(700,40,-25);course.rotation.y=.8;course.updateMatrixWorld(true);
  assert.equal(view.authoredPrototypes(course).get('tree').geometry,geometry);
  assert.equal(geometry.attributes.position.getX(0),first,'Catalog extraction must not bake any authored placement');
});
