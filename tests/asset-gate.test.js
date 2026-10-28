import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const script=path.resolve(import.meta.dirname,'../scripts/asset-change-scope.mjs');
async function implementation() {
  try { return await import(script); }
  catch (error) { if (error.code==='ERR_MODULE_NOT_FOUND') return {}; throw error; }
}

test('native rebuild scope includes source, export and verification inputs without matching ordinary code', async () => {
  const {needsAssetRebuild}=await implementation();
  assert.equal(typeof needsAssetRebuild,'function','Missing asset change classifier');
  for(const file of ['scripts/build-assets.py','scripts/build-hero.py','scripts/build-environment.py',
    'scripts/test-blender.py','scripts/test-skinned-hero.py','scripts/reference-specs.py','scripts/export-saved-assets.py',
    'scripts/check-assets.mjs','scripts/compress-assets.mjs','scripts/check-compressed.mjs',
    'scripts/asset-fingerprint.mjs','scripts/asset-change-scope.mjs','assets/blender/hand edited.blend',
    'scripts/banana-tripo/prepare-static.py','scripts/banana-tripo/static-recipe.json',
    'tests/test-saved-assets.py','tests/test-tripo-static.py','tests/test-tripo-bicycle.py',
    'assets/sources/banana-tripo-v1/manifest.json','assets/sources/banana-tripo-v1/hero-rigged.glb',
    'assets/export/riderSkinned.glb','public/assets/banana.glb','tests/fixtures/blender/hero-native-baseline.json',
    'package.json','pnpm-lock.yaml','.nvmrc','.github/workflows/assets.yml']) {
    assert.equal(needsAssetRebuild([file]),true,file);
  }
  assert.equal(needsAssetRebuild(['src/main.js','src/view.js','tests/game.test.js','README.md',
    'docs/endless-design.md','scripts/browser-check.mjs','other/assets/blender/thing.blend',
    'public/assets-old/banana.glb','scripts/nested/build-assets.py']),false);
  assert.equal(needsAssetRebuild([]),false);
});

test('asset gate accepts an intentional skip but blocks failed, cancelled or missing rebuilds', async () => {
  const {assertAssetGate}=await implementation();
  assert.equal(typeof assertAssetGate,'function','Missing total asset gate');
  assert.equal(assertAssetGate('success','false','skipped'),true);
  assert.equal(assertAssetGate('success','true','success'),true);
  for(const [scope,required,rebuild] of [
    ['success','true','failure'],['success','true','cancelled'],['success','true','skipped'],
    ['success','true',''],['failure','false','skipped'],['cancelled','false','skipped'],
    ['skipped','false','skipped'],['success','','skipped'],['success','false','failure'],
    ['success','false','cancelled'],['success','false','success'],
  ]) assert.throws(()=>assertAssetGate(scope,required,rebuild),undefined,`${scope}/${required}/${rebuild}`);
});

test('git change detection keeps deleted paths, renames and paths beyond the API page limit', async () => {
  const {changedPaths,needsAssetRebuild}=await implementation();
  assert.equal(typeof changedPaths,'function','Missing git path detection');
  const dir=await mkdtemp(path.join(tmpdir(),'banana-asset-scope-'));
  const git=(args,input)=>execFileSync('git',args,{cwd:dir,input,encoding:'utf8'}).trim();
  try {
    git(['init','--quiet']);
    const blob=git(['hash-object','-w','--stdin'],'fixture\n');
    const tree=(files)=>{
      git(['read-tree','--empty']);
      git(['update-index','--add','-z','--index-info'],files.map(file=>`100644 ${blob}\t${file}\0`).join(''));
      return git(['write-tree']);
    };
    const base=tree(['assets/blender/hand edited\nsource.blend','src/main.js']);
    const head=tree(['src/renamed.blend','src/main.js',...Array.from({length:320},(_,i)=>`docs/${i}.md`)]);
    const files=changedPaths(base,head,{cwd:dir});
    assert.equal(files.length,322);
    assert.ok(files.includes('assets/blender/hand edited\nsource.blend'));
    assert.ok(files.includes('src/renamed.blend'));
    assert.ok(files.includes('docs/319.md'));
    assert.equal(needsAssetRebuild(files),true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('scope command reports ordinary PRs, forces scheduled runs and fails closed on unavailable history', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'banana-asset-scope-cli-'));
  try {
    const output=path.join(dir,'output');
    const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const run=(event,base,revision)=>spawnSync(process.execPath,[script,'detect'],{encoding:'utf8',
      env:{...process.env,GITHUB_OUTPUT:output,SCOPE_EVENT:event,SCOPE_BASE:base,SCOPE_HEAD:revision}});
    let result=run('pull_request',head,head);
    assert.equal(result.status,0,result.stderr);
    assert.equal(await readFile(output,'utf8'),'rebuild=false\n');
    await writeFile(output,'');
    result=run('schedule','','');assert.equal(result.status,0,result.stderr);
    assert.equal(await readFile(output,'utf8'),'rebuild=true\n');
    await writeFile(output,'');
    result=run('workflow_dispatch','','');assert.equal(result.status,0,result.stderr);
    assert.equal(await readFile(output,'utf8'),'rebuild=true\n');
    await writeFile(output,'');
    result=run('push','0'.repeat(40),head);assert.equal(result.status,0,result.stderr);
    assert.equal(await readFile(output,'utf8'),'rebuild=true\n');
    await writeFile(output,'');
    result=run('pull_request','f'.repeat(40),head);assert.notEqual(result.status,0);
    assert.equal(await readFile(output,'utf8'),'');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('gate command exposes failure and cancellation as nonzero checks', () => {
  for(const [scope,required,rebuild,exit] of [
    ['success','false','skipped',0],['success','true','success',0],
    ['success','true','failure',1],['success','true','cancelled',1],
    ['failure','','skipped',1],['success','true','skipped',1],
  ]) {
    const result=spawnSync(process.execPath,[script,'gate'],{encoding:'utf8',env:{...process.env,
      SCOPE_RESULT:scope,REBUILD_REQUIRED:required,REBUILD_RESULT:rebuild}});
    assert.equal(result.status,exit,result.stderr);
  }
});
