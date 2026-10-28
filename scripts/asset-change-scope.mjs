import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function needsAssetRebuild(files) {
  return files.some(file=>/^(?:assets\/(?:blender|export|sources)\/|scripts\/banana-tripo\/|public\/assets\/|tests\/fixtures\/blender\/)/.test(file)
    || /^tests\/test-[^/]+\.py$/.test(file)
    || /^scripts\/(?:[^/]+\.py|(?:[^/]*assets|check-compressed|asset-fingerprint|asset-change-scope)\.mjs)$/.test(file)
    || ['package.json','pnpm-lock.yaml','.nvmrc','.github/workflows/assets.yml'].includes(file));
}

export function changedPaths(base,head,{cwd=process.cwd(),pullRequest=false}={}) {
  for(const revision of [base,head])assert.match(revision??'',/^[a-f0-9]{40,64}$/, 'Expected a full Git revision');
  // NUL delimiters retain spaces/newlines. Disabling renames includes both paths,
  // so moving a source out of the asset directories still requires verification.
  const revisions=pullRequest?[`${base}...${head}`]:[base,head];
  return execFileSync('git',['diff','--name-only','--no-renames','-z',...revisions,'--'],{cwd,encoding:'utf8'})
    .split('\0').filter(Boolean);
}

export function assertAssetGate(scopeResult,required,rebuildResult) {
  assert.equal(scopeResult,'success',`Asset change detection ${scopeResult||'did not report a result'}`);
  assert.ok(required==='true'||required==='false','Asset change detection did not report whether a rebuild is required');
  assert.equal(rebuildResult,required==='true'?'success':'skipped',
    `Asset rebuild ${rebuildResult||'did not report a result'} (required=${required})`);
  return true;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  try {
    if(process.argv[2]==='detect') {
      const {SCOPE_EVENT:event,SCOPE_BASE:base,SCOPE_HEAD:head}=process.env;
      let rebuild;
      if(['workflow_dispatch','schedule'].includes(event)||event==='push'&&/^0{40,64}$/.test(base??''))rebuild=true;
      else {
        assert.ok(['pull_request','push'].includes(event),`Unsupported asset change event: ${event}`);
        rebuild=needsAssetRebuild(changedPaths(base,head,{pullRequest:event==='pull_request'}));
      }
      if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`rebuild=${rebuild}\n`);
      console.log(rebuild?'Native asset rebuild required':'No native asset inputs changed; asset rebuild may skip');
    } else if(process.argv[2]==='gate') {
      const {SCOPE_RESULT:scope,REBUILD_REQUIRED:required,REBUILD_RESULT:rebuild}=process.env;
      assertAssetGate(scope,required,rebuild);
      console.log(required==='true'?'Asset gate passed: native rebuild and verification succeeded':
        'Asset gate passed: no native asset inputs changed');
    } else throw new Error('Usage: asset-change-scope.mjs [detect|gate]');
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
