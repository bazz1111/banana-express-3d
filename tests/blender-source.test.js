import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('Blender validation is read-only and explicit rebuild exports saved sources without invoking generators', () => {
  const script=path.resolve(import.meta.dirname,'../scripts/test-blender.py');
  const result=spawnSync('python3',['-c',`
import runpy, sys, tempfile
from pathlib import Path
module=runpy.run_path(sys.argv[1],run_name='source_validation_test')
assert callable(module.get('rebuild_sources')), 'Missing explicit source rebuild boundary'
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory)
    (root/'scripts').mkdir()
    source=root/'hand-edited.blend'
    source.write_bytes(b'artist saved geometry and actions')
    for generator in ['build-assets.py','build-hero.py']:
        (root/'scripts'/generator).write_text("raise AssertionError('Saved sources must never be regenerated')\\n")
    (root/'scripts/export-saved-assets.py').write_text('''
from pathlib import Path
def export_saved_assets(manifest, out_dir=None, root=None):
    assert manifest == root/'assets/export/manifest.json'
    assert out_dir is None
    source=root/'hand-edited.blend'
    assert source.read_bytes()==b'artist saved geometry and actions'
    exported=root/'export.glb'
    exported.write_bytes(b'exported saved geometry and actions')
    return {'models': ['artist-root']}
''')
    for arguments in [[], ['--verify-only']]:
        assert module['rebuild_sources'](root,arguments) is None
        assert source.read_bytes()==b'artist saved geometry and actions'
    assert module['rebuild_sources'](root,['--rebuild'])=={'models': ['artist-root']}
    assert (root/'export.glb').read_bytes()==b'exported saved geometry and actions'
    assert source.read_bytes()==b'artist saved geometry and actions'
    try:
        module['rebuild_sources'](root,['--rebuild','--verify-only'])
    except SystemExit as error:
        assert error.code==2
    else:
        raise AssertionError('Contradictory source operation flags must fail')
`,script],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
