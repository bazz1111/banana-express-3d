"""Validate manifest-listed saved Blender sources; -- --rebuild exports their GLBs."""
import argparse
import json
from pathlib import Path
import runpy
import sys


def rebuild_sources(root, arguments):
    """Explicit rebuilding exports saved native files; it never regenerates them."""
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--rebuild', action='store_true', help='Export GLBs from saved .blend files without saving sources')
    mode.add_argument('--verify-only', action='store_true', help='Read-only saved source validation (the default)')
    options = parser.parse_args(arguments)
    if options.rebuild:
        exporter = runpy.run_path(str(root / 'scripts/export-saved-assets.py'))
        return exporter['export_saved_assets'](root / 'assets/export/manifest.json', root=root)
    return None


def main():
    root = Path(__file__).resolve().parents[1]
    arguments = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    report = rebuild_sources(root, arguments)
    if report is None:
        exporter = runpy.run_path(str(root / 'scripts/export-saved-assets.py'))
        report = exporter['validate_saved_assets'](root / 'assets/export/manifest.json', root=root)
        operation = 'SOURCE'
    else:
        operation = 'EXPORT'
    print('BLENDER_NATIVE_' + operation + '_PASS ' + json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
