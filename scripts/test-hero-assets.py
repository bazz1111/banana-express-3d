"""Read saved native hero assets and their actual GLB exports; never rebuild or save sources."""
import bpy
import hashlib
import json
import struct
import sys
import numpy as np
from collections import defaultdict
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / 'tests/fixtures/blender/hero-native-baseline.json'
REPORT = ROOT / 'artifacts/hero-native-report.json'
REPORT.parent.mkdir(parents=True, exist_ok=True)
SOURCES = ['asset-library.blend', 'standing-motion.blend']
HERO_MODELS = ['rider', 'bicycle', 'banana', 'looseBanana', 'bananaRack']
RIG_NAMES = ['BikeFrame', 'CargoRopes', 'WheelRear', 'WheelFront', 'Crank', 'Pedal_L', 'Pedal_R',
             'BalanceBody', 'Arm_L', 'Arm_R', 'Elbow_L', 'Elbow_R', 'Hand_L', 'Hand_R',
             'Leg_L', 'Leg_R', 'Knee_L', 'Knee_R', 'Foot_L', 'Foot_R']
POSE_FRAMES = [1, 9, 17, 25, 33, 48, 96, 120, 160]
Y_UP = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def open_source(name):
    path = ROOT / 'assets/blender' / name
    assert path.is_file(), ('Missing editable native source', str(path))
    bpy.ops.wm.open_mainfile(filepath=str(path))
    bpy.context.view_layer.update()
    assert bpy.context.scene.unit_settings.system == 'METRIC'
    assert bpy.context.scene.unit_settings.scale_length == 1


def rig_snapshot(motion=False):
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    rig = {}
    for name in RIG_NAMES:
        obj = bpy.data.objects[name]
        assert obj.library is None and (obj.type != 'MESH' or obj.data.library is None), (name, 'not locally editable')
        rig[name] = {'parent': obj.parent.name if obj.parent else '', 'basis': np.asarray(obj.matrix_basis).tolist()}
        for key in ['restUpper', 'support']:
            if key in obj:
                rig[name][key] = list(obj[key])
    poses = {}
    if motion:
        for frame in POSE_FRAMES:
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            poses[str(frame)] = {name: np.asarray(bpy.data.objects[name].matrix_world).tolist() for name in RIG_NAMES}
    return {'rig': rig, 'poses': poses}


def compare_rig(before, after, source):
    for name, expected in before['rig'].items():
        actual = after['rig'][name]
        assert expected['parent'] == actual['parent'], (source, name, 'rig hierarchy changed')
        assert np.allclose(expected['basis'], actual['basis'], atol=1e-5, rtol=0), (source, name, 'joint rest transform changed')
        for key in ['restUpper', 'support']:
            assert expected.get(key) == actual.get(key), (source, name, key, 'contact target changed')
    for frame, poses in before['poses'].items():
        for name, expected in poses.items():
            assert np.allclose(expected, after['poses'][frame][name], atol=1e-5, rtol=0), (source, frame, name, 'native action changed')


def read_glb(path):
    blob = path.read_bytes()
    assert blob[:4] == b'glTF' and struct.unpack_from('<I', blob, 4)[0] == 2, (path.name, 'invalid GLB')
    assert struct.unpack_from('<I', blob, 8)[0] == len(blob)
    document, binary, offset = None, None, 12
    while offset < len(blob):
        size, kind = struct.unpack_from('<I4s', blob, offset)
        chunk = blob[offset + 8:offset + 8 + size]
        if kind == b'JSON':
            document = json.loads(chunk)
        elif kind == b'BIN\x00':
            binary = chunk
        offset += 8 + size
    assert document is not None and binary is not None, (path.name, 'missing GLB chunks')
    return document, binary


def accessor(document, binary, index):
    item = document['accessors'][index]
    view = document['bufferViews'][item['bufferView']]
    dtype = np.dtype({5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[item['componentType']])
    columns = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[item['type']]
    values = np.ndarray((item['count'], columns), dtype=dtype, buffer=binary,
                        offset=view.get('byteOffset', 0) + item.get('byteOffset', 0),
                        strides=(view.get('byteStride', columns * dtype.itemsize), dtype.itemsize)).astype(np.float64)
    if item.get('normalized'):
        values /= np.iinfo(dtype).max
    assert np.isfinite(values).all()
    return values


def node_matrix(node):
    if 'matrix' in node:
        return Matrix([[node['matrix'][col * 4 + row] for col in range(4)] for row in range(4)])
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    return Matrix.LocRotScale(Vector(node.get('translation', [0, 0, 0])), Quaternion((w, x, y, z)),
                             Vector(node.get('scale', [1, 1, 1])))


def source_color_triangles(mesh):
    mesh.calc_loop_triangles()
    attr = mesh.color_attributes.get('Color')
    assert attr and attr.domain == 'CORNER', (mesh.name, 'missing editable corner Color')
    expected = defaultdict(list)
    for triangle in mesh.loop_triangles:
        corners = []
        for loop in triangle.loops:
            p = mesh.vertices[mesh.loops[loop].vertex_index].co
            corners.append(((round(p.x, 5), round(p.z, 5), round(-p.y, 5)), tuple(attr.data[loop].color)))
        corners.sort(key=lambda v: v[0])
        expected[tuple(p for p, color in corners)].append(np.asarray([color for p, color in corners]))
    return expected


def verify_export_colors(models):
    cached, triangles, vertices = {}, 0, 0
    for name in HERO_MODELS:
        item = models[name]
        gltf, binary = read_glb(ROOT / 'public/assets' / item['file'])
        seen = set()
        minimum, maximum = 1., 0.
        for node in gltf['nodes']:
            if 'mesh' not in node or node['mesh'] in seen:
                continue
            seen.add(node['mesh'])
            obj = bpy.data.objects[node['name']]
            assert obj.type == 'MESH' and obj.data.library is None and len(obj.data.vertices) > 0
            key = obj.data.as_pointer()
            if key not in cached:
                cached[key] = source_color_triangles(obj.data)
            expected = cached[key]
            for primitive in gltf['meshes'][node['mesh']]['primitives']:
                assert primitive.get('mode', 4) == 4
                assert 'COLOR_0' in primitive['attributes'], (name, node['name'], 'missing standard COLOR_0')
                positions = accessor(gltf, binary, primitive['attributes']['POSITION'])
                rgba = accessor(gltf, binary, primitive['attributes']['COLOR_0'])
                if rgba.shape[1] == 3:
                    rgba = np.concatenate((rgba, np.ones((len(rgba), 1))), axis=1)
                minimum = min(minimum, float(rgba[:, :3].min()))
                maximum = max(maximum, float(rgba[:, :3].max()))
                indices = accessor(gltf, binary, primitive['indices']).astype(np.int64).reshape(-1, 3)
                for triangle in indices:
                    corners = sorted([(tuple(np.round(positions[i], 5)), rgba[i]) for i in triangle], key=lambda v: v[0])
                    colors = np.asarray([color for p, color in corners])
                    candidates = expected.get(tuple(p for p, color in corners))
                    assert candidates, (name, node['name'], 'exported geometry differs from current native mesh')
                    assert any(np.allclose(colors, candidate, atol=3e-5, rtol=0) for candidate in candidates), (
                        name, node['name'], 'GLB COLOR_0 differs from current source Color')
                    triangles += 1
                vertices += len(positions)
        # Black pedals and rubber are legitimate individual meshes; inspect the whole asset palette.
        assert maximum > .05 and minimum < .95, (name, 'invalid all-white/black export')
    return {'models': HERO_MODELS, 'uniqueExportVertices': vertices, 'triangles': triangles}


def frame_bvh(rack_only=False):
    frame = bpy.data.objects['BikeFrame']
    relative = bpy.data.objects['Bicycle'].matrix_world.inverted() @ frame.matrix_world
    vertices = [relative @ v.co for v in frame.data.vertices]
    polygons = [list(p.vertices) for p in frame.data.polygons if not rack_only or all(
        -.39 <= vertices[i].x <= .39 and .36 <= vertices[i].y <= 1.30 and 1.00 <= vertices[i].z <= 1.09 for i in p.vertices)]
    assert polygons, 'Native rear rack support geometry missing'
    return BVHTree.FromPolygons(vertices, polygons), len(polygons)


def mesh_vertices(obj, reference):
    relative = reference.matrix_world.inverted() @ obj.matrix_world
    return [relative @ v.co for v in obj.data.vertices]


def verify_cargo(item):
    cargo = bpy.data.objects.get('BananaCargo')
    assert cargo and cargo.type == 'EMPTY' and cargo.library is None, 'Missing editable BananaCargo native root'
    bundles = sorted(cargo.children, key=lambda o: o.name)
    names = [f'CargoBundle{i:02}' for i in range(20)]
    assert [o.name for o in bundles] == names and all(o.type == 'MESH' for o in bundles), 'Expected 20 direct native bundle meshes'
    shared = next(o.data for o in bpy.data.objects['Banana'].children_recursive if o.type == 'MESH')
    assert all(o.data == shared for o in bundles), 'Cargo must reuse native five-banana geometry'
    assert all(o.get('bananas') == 5 for o in bundles)
    gltf, binary = read_glb(ROOT / 'public/assets' / item['file'])
    roots = [gltf['nodes'][i] for i in gltf['scenes'][gltf.get('scene', 0)]['nodes']]
    assert len(roots) == 1 and roots[0]['name'] == 'BananaCargo'
    exported = sorted([gltf['nodes'][i] for i in roots[0]['children']], key=lambda n: n['name'])
    assert [n['name'] for n in exported] == names and all('mesh' in n for n in exported)
    assert len({n['mesh'] for n in exported}) == 1 and len(gltf['meshes']) == 1, '20 GLB bundles must share one geometry'
    assert np.allclose(node_matrix(roots[0]), Matrix.Identity(4), atol=1e-6, rtol=0), 'Runtime cargo root must start at origin'
    matrix_error = 0
    for obj, node in zip(bundles, exported):
        expected = Y_UP @ (cargo.matrix_world.inverted() @ obj.matrix_world) @ Y_UP.inverted()
        error = float(np.max(np.abs(np.asarray(expected) - np.asarray(node_matrix(node)))))
        assert error < 1e-5, (obj.name, 'native author matrix was not preserved in Y-up export', error)
        matrix_error = max(matrix_error, error)
    rack, polygon_count = frame_bvh(True)
    distances = [min(rack.find_nearest(p)[3] for p in mesh_vertices(obj, cargo)) for obj in bundles]
    assert distances[0] <= .004, ('First visible native banana bundle floats above rear rack', distances[0])
    assert min(distances) <= .004, ('Entire native banana heap floats above rear rack', min(distances))
    points = [p for obj in bundles for p in mesh_vertices(obj, cargo)]
    return {'bundles': 20, 'nativeSharedMesh': shared.name, 'glbSharedMeshes': 1, 'maxMatrixError': matrix_error,
            'rackPolygons': polygon_count, 'firstBundleRackDistance': distances[0], 'nearestRackDistance': min(distances),
            'minimumZ': min(p.z for p in points), 'maximumZ': max(p.z for p in points),
            'coverage': 'Actual native rack contact and first visible bundle; no dynamic cargo simulation.'}


def standing_contact(tags=('L', 'R')):
    actor = bpy.data.objects['StandingRider']
    support, _ = frame_bvh()
    records = []
    for tag in tags:
        expected = Vector((-.30, -.58, 1.311) if tag == 'L' else (.04, .21, 1.233))
        actual = actor.matrix_world.inverted() @ bpy.data.objects['Foot_' + tag].matrix_world.translation
        assert (actual - expected).length < 1e-5, (tag, 'standing support target moved', list(actual))
        # The library lays templates out separately; compare each root's metre-space geometry.
        shoes = mesh_vertices(bpy.data.objects['Shoe_' + tag], actor)
        bottom = min(p.z for p in shoes)
        top = 1.193 if tag == 'L' else 1.115
        assert -.001 <= bottom - top <= .010, (tag, 'sole no longer reaches handlebar/saddle', bottom, top)
        distance = min(support.find_nearest(p)[3] for p in shoes if p.z < bottom + .001)
        assert distance < .035, (tag, 'standing sole is separated from actual bike support mesh', distance)
        records.append({'side': tag, 'soleHeight': bottom, 'nativeSupportDistance': distance})
    return records


def verify_motion():
    assert bpy.context.scene.frame_start == 1 and bpy.context.scene.frame_end == 160
    for name in ['Crank', 'Pedal_L', 'Pedal_R']:
        assert bpy.data.objects[name].rotation_mode == 'XYZ'
    for name in ['Crank', 'BalanceBody', 'Leg_L', 'Leg_R', 'Arm_L', 'Arm_R']:
        assert bpy.data.objects[name].animation_data and bpy.data.objects[name].animation_data.action, (name, 'missing editable motion Action')
    seated = []
    for frame in [1, 9, 17, 25, 33, 160]:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        support, _ = frame_bvh()
        bicycle = bpy.data.objects['Bicycle']
        for side, tag in [(-1, 'L'), (1, 'R')]:
            foot = bpy.data.objects['Foot_' + tag].matrix_world.translation
            pedal = bpy.data.objects['Pedal_' + tag]
            assert (foot - pedal.matrix_world.translation - Vector((0, .075, .138))).length < 1e-5, (frame, tag, 'seated foot left pedal target')
            shoes = mesh_vertices(bpy.data.objects['Shoe_' + tag], bicycle)
            platform = mesh_vertices(pedal, bicycle)
            gap = min(p.z for p in shoes) - max(p.z for p in platform)
            assert 0 <= gap <= .006, (frame, tag, 'actual sole/pedal gap', gap)
            hand = bpy.data.objects['Hand_' + tag].matrix_world.translation
            assert (hand - Vector((side * .36, -.50, 1.20))).length < 1e-5, (frame, tag, 'seated hand left handlebar target')
            palm = mesh_vertices(bpy.data.objects['RiderHand_' + tag], bicycle)
            distance = min(support.find_nearest(p)[3] for p in palm)
            assert distance < .025, (frame, tag, 'hand separated from actual grip mesh', distance)
            seated.append({'frame': frame, 'side': tag, 'solePedalGap': gap, 'handGripDistance': distance})
    standing = []
    for frame in [48, 80, 96, 128]:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        standing.append({'frame': frame, 'feet': standing_contact()})
    bpy.context.scene.frame_set(120)
    bpy.context.view_layer.update()
    standing.append({'frame': 120, 'feet': standing_contact(('R',))})
    return {'seatedContacts': seated, 'standingAndKickSupports': standing, 'nativeActionPoseFramesCompared': POSE_FRAMES}


if '--baseline' in sys.argv:
    assert not BASELINE.exists(), 'Preserve the existing hero joint baseline instead of replacing it'
    baseline = {}
    for source in SOURCES:
        open_source(source)
        baseline[source] = rig_snapshot(source == 'standing-motion.blend')
    BASELINE.write_text(json.dumps(baseline, indent=2))
    print('HERO_NATIVE_JOINT_BASELINE_SAVED', str(BASELINE))
else:
    manifest = json.loads((ROOT / 'public/assets/manifest.json').read_text())
    assert 'bananaRack' in manifest['models'], 'Missing bananaRack runtime export'
    assert (ROOT / 'public/assets' / manifest['models']['bananaRack']['file']).is_file(), 'Missing bananaRack runtime export'
    baseline = json.loads(BASELINE.read_text())
    open_source('asset-library.blend')
    compare_rig(baseline['asset-library.blend'], rig_snapshot(), 'asset-library.blend')
    cargo = verify_cargo(manifest['models']['bananaRack'])
    colors = verify_export_colors(manifest['models'])
    library_contacts = standing_contact()
    open_source('standing-motion.blend')
    compare_rig(baseline['standing-motion.blend'], rig_snapshot(True), 'standing-motion.blend')
    motion = verify_motion()
    hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in
              [ROOT / 'assets/blender' / source for source in SOURCES] +
              [ROOT / 'public/assets' / manifest['models'][name]['file'] for name in HERO_MODELS]}
    report = {'status': 'pass', 'blenderVersion': bpy.app.version_string, 'cargo': cargo, 'exportColors': colors,
              'libraryStandingContacts': library_contacts, 'motion': motion, 'sha256': hashes,
              'scope': 'Saved native hero source, actual standard GLB exports, shared geometry, author matrices, rack support and object-rig keyframe contacts. Overall image fidelity and real engine visuals are not claimed.'}
    REPORT.write_text(json.dumps(report, indent=2))
    print('HERO_NATIVE_ASSETS_PASS', json.dumps({'bundles': 20, 'sharedGeometry': 1, 'maxMatrixError': cargo['maxMatrixError'],
          'firstBundleRackDistance': cargo['firstBundleRackDistance'], 'colorTriangles': colors['triangles'],
          'sources': len(SOURCES), 'heroExports': len(HERO_MODELS), 'report': str(REPORT)}))
