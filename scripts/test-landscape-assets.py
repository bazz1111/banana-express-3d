"""Read saved local Blender scenery; baseline the protected lane before changing any art."""
import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'tests/fixtures/blender/landscape-native-baseline.json'
REPORT = ROOT / 'artifacts/landscape-native-report.json'
REPORT.parent.mkdir(parents=True, exist_ok=True)

def open_source(name):
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/blender' / name))
    bpy.context.view_layer.update()
    assert bpy.context.scene.unit_settings.system == 'METRIC'

def protected_surfaces():
    result = {}
    for chunk in bpy.data.objects['EndlessRoadCourse'].children:
        for obj in chunk.children:
            if obj.get('surfaceRole') not in ('road', 'guard'):
                continue
            data = {'vertices': [list(obj.matrix_world @ v.co) for v in obj.data.vertices],
                    'faces': [list(p.vertices) for p in obj.data.polygons],
                    'color': [list(c.color) for c in obj.data.color_attributes['Color'].data],
                    'uv': [list(c.uv) for c in obj.data.uv_layers.active.data] if obj.data.uv_layers.active else []}
            key = str(chunk['segment']) + ':' + obj['surfaceRole']
            result[key] = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    return result

open_source('endless-course.blend')
if '--baseline' in sys.argv:
    assert not BASE.exists(), 'Keep the original lane baseline'
    BASE.write_text(json.dumps({'surfaces': protected_surfaces(),
        'courseHash': hashlib.sha256((ROOT / 'public/assets/course.json').read_bytes()).hexdigest()}, indent=2))
    print('LANDSCAPE_NATIVE_BASELINE_SAVED', len(protected_surfaces()))
else:
    before = json.loads(BASE.read_text())
    assert before['surfaces'] == protected_surfaces(), 'Art edit changed the playable lane, UV or guards'
    assert before['courseHash'] == hashlib.sha256((ROOT / 'public/assets/course.json').read_bytes()).hexdigest()
    vertices, faces = [], []
    for chunk in bpy.data.objects['EndlessRoadCourse'].children:
        for obj in chunk.children:
            if obj.get('surfaceRole') == 'terrain':
                offset = len(vertices)
                vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
                faces.extend(tuple(offset + i for i in p.vertices) for p in obj.data.polygons)
    bvh = BVHTree.FromPolygons(vertices, faces, all_triangles=True)
    course = json.loads((ROOT / 'public/assets/course.json').read_text())
    bank = []
    for s in (40, 200, 400, 800, 1000, 1400, 1560):
        sample = course['points'][s // 2]
        center = Vector((sample['x'], -sample['z'], sample['y']))
        p = center + Vector((-10 * math.cos(sample['yaw']), -10 * math.sin(sample['yaw']), 0))
        hit = bvh.ray_cast(Vector((p.x, p.y, 300)), Vector((0, 0, -1)))[0]
        assert hit is not None, ('Missing real red-rock bank', s)
        bank.append({'s': s, 'heightAboveLane': hit.z - center.z})
    failures = []
    if not all(p['heightAboveLane'] >= 5 for p in bank):
        failures.append('The right bank is still a shallow grass slope instead of the reference red-rock wall')
    cliffs = [o for c in bpy.data.objects['EndlessRoadCourse'].children for o in c.children if o.get('kind') == 'cliff']
    heights = [max(v.co.z for v in o.data.vertices) - min(v.co.z for v in o.data.vertices) for o in cliffs]
    if not heights or max(heights) > 8:
        failures.append('The separate red rocks still form tall isolated pillars')
    open_source('valley-layout.blend')
    rings = {}
    for name, minimum in (('ValleyMountains', 20), ('ValleyFoothills', 16), ('ValleyClouds', 20)):
        group = bpy.data.objects.get(name)
        if not group:
            failures.append('Missing native panorama group ' + name)
            continue
        meshes = [o for o in group.children if o.type == 'MESH']
        angles = sorted(math.atan2(o.location.x, -o.location.y) % math.tau for o in meshes)
        gaps = [angles[(i + 1) % len(angles)] + (math.tau if i == len(angles) - 1 else 0) - angles[i] for i in range(len(angles))]
        max_gap = max(gaps) if gaps else math.tau
        geometry_count = len({o.data.as_pointer() for o in meshes})
        rings[name] = {'instances': len(meshes), 'maxAngularGap': max_gap, 'sharedGeometries': geometry_count,
                       'positiveScale': all(min(o.scale) > 0 for o in meshes)}
        if len(meshes) < minimum or max_gap > .41 or geometry_count != 1 or not rings[name]['positiveScale']:
            failures.append('The native ' + name + ' leaves a panorama gap or discards sharing')
    report = {'status': 'pass' if not failures else 'fail', 'protectedSurfaces': len(before['surfaces']),
              'bank': bank, 'cliffHeights': heights, 'rings': rings, 'failures': failures,
              'scope': 'Actual saved native bank/ring geometry and unchanged lane; not full-image fidelity.'}
    REPORT.write_text(json.dumps(report, indent=2))
    print('LANDSCAPE_NATIVE_REPORT', json.dumps(report))
    assert not failures, '; '.join(failures)
    print('LANDSCAPE_NATIVE_ASSETS_PASS')
