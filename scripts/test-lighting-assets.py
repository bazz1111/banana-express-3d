"""Validate current native AO/GLB colors. -- --historical compares the pre-lighting model stage."""
import bpy
import hashlib
import json
import sys
import numpy as np
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / 'tests/fixtures/blender/light-assets-baseline.json'
(ROOT / 'artifacts').mkdir(parents=True, exist_ok=True)
FILES = ['asset-library.blend', 'endless-course.blend', 'standing-motion.blend', 'valley-layout.blend']
TARGETS = ['rider', 'bicycle', 'banana', 'looseBanana', 'truck', 'car', 'hut', 'villageHouse',
           'villageLonghouse', 'stall', 'tower', 'foundation', 'palm', 'tree', 'forestTree',
           'bananaPlant', 'bush', 'rock', 'cliff']

def colors(mesh, name):
    attr = mesh.color_attributes.get(name)
    assert attr, (mesh.name, name)
    result = np.empty(len(attr.data) * 4, dtype=np.float32)
    attr.data.foreach_get('color', result)
    return result.reshape(-1, 4)

def digest(data):
    return hashlib.sha256(data.tobytes()).hexdigest()

def geometry(mesh):
    verts = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', verts)
    loops = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get('vertex_index', loops)
    polygons = np.asarray([(p.loop_start, p.loop_total, p.use_smooth) for p in mesh.polygons], dtype=np.int32)
    return hashlib.sha256(verts.tobytes() + loops.tobytes() + polygons.tobytes()).hexdigest()

def glb_accessor(blob, gltf, index):
    accessor = gltf['accessors'][index]
    view = gltf['bufferViews'][accessor['bufferView']]
    dtype = {5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[accessor['componentType']]
    columns = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
    size = np.dtype(dtype).itemsize
    offset = 28 + int.from_bytes(blob[12:16], 'little') + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    result = np.ndarray((accessor['count'], columns), dtype=dtype, buffer=blob, offset=offset,
                        strides=(view.get('byteStride', size * columns), size)).astype(np.float64)
    if accessor.get('normalized'):
        result /= 65535 if accessor['componentType'] == 5123 else 255
    return result

def exported_color_check(manifest):
    triangle_cache, vertices_checked, triangles_checked = {}, 0, 0
    for name, item in manifest['models'].items():
        blob = (ROOT / 'public/assets' / item['file']).read_bytes()
        gltf = json.loads(blob[20:20 + int.from_bytes(blob[12:16], 'little')])
        seen = set()
        for node in gltf['nodes']:
            if 'mesh' not in node or node['mesh'] in seen:
                continue
            seen.add(node['mesh'])
            source = bpy.data.objects[node['name']].data
            key = source.as_pointer()
            if key not in triangle_cache:
                source.calc_loop_triangles()
                rgba = colors(source, 'Color')
                expected = defaultdict(list)
                for triangle in source.loop_triangles:
                    corners = []
                    for loop in triangle.loops:
                        p = source.vertices[source.loops[loop].vertex_index].co
                        corners.append(((round(p.x, 5), round(p.z, 5), round(-p.y, 5)), rgba[loop]))
                    corners.sort(key=lambda v: v[0])
                    expected[tuple(v[0] for v in corners)].append(np.asarray([v[1] for v in corners]))
                triangle_cache[key] = expected
            expected = triangle_cache[key]
            for primitive in gltf['meshes'][node['mesh']]['primitives']:
                positions = glb_accessor(blob, gltf, primitive['attributes']['POSITION'])
                actual = glb_accessor(blob, gltf, primitive['attributes']['COLOR_0'])
                if actual.shape[1] == 3:
                    actual = np.concatenate((actual, np.ones((len(actual), 1))), axis=1)
                indices = glb_accessor(blob, gltf, primitive['indices']).astype(np.int64).reshape(-1, 3)
                for triangle in indices:
                    corners = sorted([(tuple(np.round(positions[i], 5)), actual[i]) for i in triangle], key=lambda v: v[0])
                    position_key = tuple(v[0] for v in corners)
                    candidates = expected.get(position_key)
                    assert candidates, (name, node['name'], 'exported triangle differs from native source')
                    rgb = np.asarray([v[1] for v in corners])
                    assert any(np.allclose(rgb, color, atol=3e-5, rtol=0) for color in candidates), (
                        name, node['name'], 'GLB COLOR_0 differs from source Color', rgb.tolist(), candidates[0].tolist())
                    triangles_checked += 1
                vertices_checked += len(actual)
    print('GLB_SOURCE_COLOR_PASS', json.dumps({'vertices': vertices_checked, 'triangles': triangles_checked}))

def snapshot():
    bpy.context.view_layer.update()
    objects, mesh_cache = {}, {}
    for obj in bpy.data.objects:
        item = {'parent': obj.parent.name if obj.parent else '',
                'transform': digest(np.asarray(obj.matrix_basis, dtype=np.float32))}
        if obj.type == 'MESH':
            key = obj.data.as_pointer()
            if key not in mesh_cache:
                mesh_cache[key] = {'geometry': geometry(obj.data), 'color': digest(colors(obj.data, 'Color'))}
            item.update(mesh_cache[key])
        objects[obj.name] = item
    poses = {}
    if bpy.context.scene.frame_end == 160:
        for frame in [1, 9, 17, 25, 33, 48, 96, 120, 160]:
            bpy.context.scene.frame_set(frame)
            poses[str(frame)] = {name: np.asarray(bpy.data.objects[name].matrix_world).round(6).tolist()
                for name in ['WheelRear', 'WheelFront', 'Crank', 'Pedal_L', 'Pedal_R', 'Foot_L', 'Foot_R',
                             'Hand_L', 'Hand_R', 'BalanceBody']}
    return {'objects': objects, 'poses': poses}

if '--baseline' in sys.argv:
    baseline = {}
    for file in FILES:
        bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/blender' / file))
        baseline[file] = snapshot()
    BASELINE.write_text(json.dumps(baseline, separators=(',', ':')))
    print('LIGHT_ASSETS_BASELINE_SAVED', str(BASELINE))
else:
    manifest = json.loads((ROOT / 'public/assets/manifest.json').read_text())
    assert manifest.get('vertexAO'), 'Missing local BVH vertex AO metadata'
    assert 'sky' in manifest['models'], 'Missing native SkyDome GLB'
    assert set(manifest['vertexAO']['assets']) == set(TARGETS)
    assert len(manifest['models']) == 41
    baseline = json.loads(BASELINE.read_text())
    changed, checked, geometry_checks = 0, 0, 0
    for file in FILES:
        bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/blender' / file))
        if file == 'asset-library.blend':
            exported_color_check(manifest)
        current = snapshot()
        if '--historical' in sys.argv:
            for name, before in baseline[file]['objects'].items():
                after = current['objects'][name]
                assert before['parent'] == after['parent'] and before['transform'] == after['transform'], (file, name, 'pose changed')
                if 'geometry' in before:
                    assert before['geometry'] == after['geometry'], (file, name, 'geometry changed')
                    data = bpy.data.objects[name].data
                    original = 'AOBaseColor' if data.get('vertexAO') else 'Color'
                    assert digest(colors(data, original)) == before['color'], (file, name, 'palette baseline changed')
        assert current['poses'] == baseline[file]['poses'], (file, 'wheel/foot/hand motion changed')
        seen = set()
        for obj in bpy.data.objects:
            if obj.type != 'MESH' or obj.data.as_pointer() in seen or not obj.data.get('vertexAO'):
                continue
            data = obj.data
            seen.add(data.as_pointer())
            meta = data['vertexAO']
            assert meta['bakeCount'] == 1 and meta['samples'] == 24 and .25 <= meta['strength'] <= .32
            assert meta['geometryBefore'] == meta['geometryAfter'] == geometry(data)
            geometry_checks += 1
            base, actual = colors(data, 'AOBaseColor'), colors(data, 'Color')
            factor = np.empty(len(data.loops), dtype=np.float32)
            data.attributes['AOFactor'].data.foreach_get('value', factor)
            assert factor.min() >= .68 - 1e-6 and factor.max() <= 1 + 1e-6
            assert np.array_equal(base[:, 3], actual[:, 3]), 'AO changed alpha'
            assert np.allclose(actual[:, :3], base[:, :3] * factor[:, None], atol=1e-6), 'AO changed the palette hue'
            dark = base[:, :3].max(axis=1) < .06
            assert np.array_equal(actual[dark], base[dark]), 'Rubber must not acquire AO noise'
            assert actual[:, :3].max() > .01 and np.isfinite(actual).all(), 'AO produced black or invalid colors'
            changed += int(np.count_nonzero(factor < .99999))
            checked += 1
        for name in ['ValleyTerrain', 'ValleyWater', 'SkySphere']:
            obj = bpy.data.objects.get(name)
            if obj:
                assert not obj.data.get('vertexAO'), (name, 'must not bake AO')
        if file == 'asset-library.blend':
            sky = bpy.data.objects['SkyDome']
            meshes = [o for o in sky.children_recursive if o.type == 'MESH']
            assert len(meshes) == 1
            sphere = meshes[0]
            assert all(abs(v.co.length - 1) < 1e-6 for v in sphere.data.vertices)
            assert sum(len(p.vertices) - 2 for p in sphere.data.polygons) == 960
            assert colors(sphere.data, 'Color')[:, 3].min() == 1
    assert changed > 100, 'Short-distance BVH rays did not darken any real crevices'
    print('LIGHT_ASSETS_PASS', json.dumps({'checkedMeshes': checked, 'changedLoops': changed,
        'aoGeometryChecks': geometry_checks, 'sources': 4, 'assets': 41,
        'historicalModelComparison': '--historical' in sys.argv}))
