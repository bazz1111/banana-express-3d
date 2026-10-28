"""Read-only Tripo hero/bicycle/cargo contracts in native metre space and real GLBs.

Use --source/--glb/--metadata and --bike-source/--bike-glb for candidates.
--skip-cargo explicitly limits a candidate run before the separate cargo assembly
is available. Default CI also checks its 20 bundles and four shared geometries.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[1]
SKIN = runpy.run_path(str(ROOT / 'scripts/test-skinned-hero.py'))
read_glb, accessor, unchanged = (SKIN[name] for name in ['read_glb', 'accessor', 'unchanged'])


def node_matrix(node):
    from mathutils import Matrix, Quaternion, Vector
    if 'matrix' in node: return Matrix([[node['matrix'][column * 4 + row] for column in range(4)] for row in range(4)])
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    return Matrix.LocRotScale(Vector(node.get('translation', [0, 0, 0])), Quaternion((w, x, y, z)), Vector(node.get('scale', [1, 1, 1])))


def append_root(bpy, path, name):
    with bpy.data.libraries.load(str(path.resolve()), link=False) as (available, loaded):
        assert name in available.objects, ('Missing saved native root', name, str(path))
        loaded.objects = available.objects
    root = next(obj for obj in loaded.objects if obj and obj.name == name)
    assembly = root
    while assembly.parent: assembly = assembly.parent
    for obj in [assembly, *assembly.children_recursive]:
        if obj.name not in bpy.context.scene.objects: bpy.context.scene.collection.objects.link(obj)
    assembly.location = (0, 0, 0); bpy.context.view_layer.update()
    return root


def verify_export(root, path):
    """Compare current artist geometry, UVs, palette, hierarchy and packed maps."""
    import bpy
    import numpy as np
    from mathutils import Matrix
    document, binary = read_glb(path); triangles = 0; cache = {}
    parents = {child: parent for parent, node in enumerate(document['nodes']) for child in node.get('children', [])}
    conversion = Matrix.Rotation(-np.pi / 2, 4, 'X')
    world = {}
    def exported_world(index):
        if index not in world:
            world[index] = (exported_world(parents[index]) if index in parents else Matrix.Identity(4)) @ node_matrix(document['nodes'][index])
        return world[index]
    # This maps Blender Z-up positions to glTF Y-up positions.
    roots = [document['nodes'][index] for index in document['scenes'][document.get('scene', 0)]['nodes']]
    assert len(roots) == 1 and roots[0]['name'] == root.name
    assert np.allclose(node_matrix(roots[0]), Matrix.Identity(4), atol=1e-5, rtol=0), 'Runtime assembly root must start at origin'
    allowed = {obj.name: obj for obj in [root, *root.children_recursive]}
    for index, node in enumerate(document['nodes']):
        obj = allowed.get(node['name'])
        if obj is None: continue  # Bone nodes are checked against the actual Mixamo65 source.
        if obj != root:
            expected_parent = obj.parent_bone if obj.parent_type == 'BONE' else obj.parent.name
            assert document['nodes'][parents[index]]['name'] == expected_parent, (obj.name, 'Saved parent hierarchy changed')
        expected = conversion @ (root.matrix_world.inverted() @ obj.matrix_world) @ conversion.inverted()
        assert np.allclose(expected, exported_world(index), atol=1e-5, rtol=0), (obj.name, 'Native author transform changed on export')
        for key in ['provider', 'sourceSha256', 'preparedSourceSha256', 'rigProfile', 'riderContactConfigJSON', 'contactRole']:
            if key in obj: assert node.get('extras', {}).get(key) == obj[key], (obj.name, key, 'Required source metadata was lost')
        if 'mesh' not in node: continue
        assert obj.type == 'MESH' and obj.library is None and obj.data.library is None
        mesh = obj.data; key = mesh.as_pointer()
        if key not in cache:
            mesh.calc_loop_triangles(); uv = mesh.uv_layers.active; color = mesh.color_attributes.get('Color')
            expected = defaultdict(list)
            for triangle in mesh.loop_triangles:
                corners = []
                for loop in triangle.loops:
                    point = mesh.vertices[mesh.loops[loop].vertex_index].co
                    position = (round(point.x, 5), round(point.z, 5), round(-point.y, 5))
                    texcoord = tuple((uv.data[loop].uv.x, 1 - uv.data[loop].uv.y)) if uv else None
                    rgba = tuple(color.data[loop].color) if color else None
                    corners.append((position, texcoord, rgba))
                corners.sort(key=lambda item: item[0]); expected[tuple(item[0] for item in corners)].append(corners)
            cache[key] = expected
        for primitive in document['meshes'][node['mesh']]['primitives']:
            attributes = primitive['attributes']; positions = accessor(document, binary, attributes['POSITION'])
            texcoords = accessor(document, binary, attributes['TEXCOORD_0']) if 'TEXCOORD_0' in attributes else None
            colors = accessor(document, binary, attributes['COLOR_0']) if 'COLOR_0' in attributes else None
            if colors is not None and colors.shape[1] == 3: colors = np.concatenate((colors, np.ones((len(colors), 1))), axis=1)
            assert [key for key in attributes if key.startswith('COLOR_')] in [[], ['COLOR_0']], 'Backup palettes leaked into runtime colors'
            indices = accessor(document, binary, primitive['indices']).astype(np.int64).reshape(-1, 3)
            for triangle in indices:
                corners = sorted([(tuple(np.round(positions[i], 5)), None if texcoords is None else texcoords[i],
                                   None if colors is None else colors[i]) for i in triangle], key=lambda item: item[0])
                candidates = cache[key].get(tuple(item[0] for item in corners))
                assert candidates, (root.name, node['name'], 'Exported geometry differs from saved mesh')
                assert any(all((actual[1] is None or expected[1] is not None and np.allclose(actual[1], expected[1], atol=3e-5, rtol=0))
                               and (actual[2] is None or expected[2] is not None and np.allclose(actual[2], expected[2], atol=3e-5, rtol=0))
                               for actual, expected in zip(corners, candidate)) for candidate in candidates), (obj.name, 'Saved UV or Color layout changed')
                triangles += 1
            material = document.get('materials', [])[primitive['material']] if 'material' in primitive else None
            if material and 'baseColorTexture' in material.get('pbrMetallicRoughness', {}):
                assert texcoords is not None, (obj.name, 'Textured export is missing UVs')
                native = next(slot for slot in mesh.materials if slot.name == material['name'])
                shader = next(node for node in native.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
                image = shader.inputs['Base Color'].links[0].from_node.image
                texture = document['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]
                view = document['bufferViews'][document['images'][texture['source']]['bufferView']]
                encoded = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
                assert image.packed_file and image.packed_file.data == encoded, (obj.name, 'Painted texture changed on export')
    return {'trianglesCompared': triangles, 'nativeMeshesCompared': len(cache), 'hierarchyAndPaint': 'preserved'}


def surface(bpy, root):
    from mathutils.bvhtree import BVHTree
    vertices, faces = [], []
    for obj in root.children_recursive:
        if obj.type != 'MESH': continue
        matrix = root.matrix_world.inverted() @ obj.matrix_world; offset = len(vertices)
        vertices.extend(matrix @ vertex.co for vertex in obj.data.vertices)
        faces.extend([index + offset for index in face.vertices] for face in obj.data.polygons)
    return BVHTree.FromPolygons(vertices, faces)


def verify_contacts(bpy, actor, bike, metadata):
    import math
    from mathutils import Vector
    config = metadata.get('contactConfig')
    assert config, 'Hero has no measured bike contact config; rebake the candidate for this bicycle'
    assert json.loads(actor['riderContactConfigJSON']) == config, 'Native/runtime contact config diverged'
    rig = next(obj for obj in actor.children_recursive if obj.type == 'ARMATURE')
    for track in rig.animation_data.nla_tracks: track.mute = True
    rig.animation_data.action = None
    crank = bpy.data.objects['Crank']; pedals = [bpy.data.objects['Pedal_' + tag] for tag in ['L', 'R']]
    markers = {name: bpy.data.objects[name] for name in ['RiderSeat', 'RiderStand_L', 'RiderStand_R', 'RiderGrip_L', 'RiderGrip_R', 'RiderPedal_L', 'RiderPedal_R']}
    for tag, pedal in zip(['L', 'R'], pedals):
        assert pedal.parent == crank and markers['RiderPedal_' + tag].parent == pedal
    support = surface(bpy, bike); marker_distances = {}
    for name, marker in markers.items():
        point = bike.matrix_world.inverted() @ marker.matrix_world.translation
        distance = support.find_nearest(point)[3]; assert distance < .006, (name, 'Bike marker is separated from its actual support surface', distance)
        marker_distances[name] = distance
    def point(name): return actor.matrix_world.inverted() @ bpy.data.objects[name].matrix_world.translation
    def target(name): return actor.matrix_world.inverted() @ markers[name].matrix_world.translation
    def spin(angle):
        crank.rotation_euler.x = angle
        for pedal in pedals: pedal.rotation_euler.x = -angle
        bpy.context.view_layer.update()
    maximum = 0.; records = []
    for stance, name, frames in [('seated', 'Rider_Ride_SeatedPedal', [0, 9, 17, 25, 33, 48, 60]),
                                  ('standing', 'Rider_Ride_StandingBalance', [0, 30, 60, 90, 120])]:
        rig.animation_data.action = bpy.data.actions[name]
        for frame in frames:
            bpy.context.scene.frame_set(frame); spin(frame / 60 * math.tau if stance == 'seated' else 0)
            for tag in ['L', 'R']:
                expected = target(('RiderPedal_' if stance == 'seated' else 'RiderStand_') + tag)
                error = (point('Sole_' + tag) - expected).length; assert error < .005, (stance, frame, tag, 'Sole missed actual bike support', error)
                maximum = max(maximum, error)
                if stance == 'seated':
                    error = (point('Palm_' + tag) - target('RiderGrip_' + tag)).length
                    assert error < .005, (stance, frame, tag, 'Palm missed actual grip', error); maximum = max(maximum, error)
            if stance == 'seated': assert (point('SeatContact') - target('RiderSeat')).length < .006
            records.append({'stance': stance, 'frame': frame})
    for side in ['L', 'R']:
        rig.animation_data.action = bpy.data.actions['Rider_Kick_Strike_' + side]
        for frame in [0, 8, 21, 42]:
            bpy.context.scene.frame_set(frame); spin(0)
            error = (point('Sole_' + side) - target('RiderPedal_' + side)).length
            assert error < .005, ('Kick lost its supporting foot', side, frame, error); maximum = max(maximum, error)
    rig.animation_data.action = bpy.data.actions['Rider_Jump_Air']; bpy.context.scene.frame_set(15); spin(0)
    assert all(point('Sole_' + tag).z > target('RiderPedal_' + tag).z + .10 for tag in ['L', 'R']), 'Jump feet did not release the pedals'
    rig.animation_data.action = bpy.data.actions['Rider_Crash']; bpy.context.scene.frame_set(60); spin(0)
    assert all((point('Palm_' + tag) - target('RiderGrip_' + tag)).length > .15 for tag in ['L', 'R']), 'Crash hands remain pinned to the bar'
    assert (rig.matrix_world @ rig.pose.bones['mixamorig:Hips'].head).z < .5, 'Crash never falls below the seat'
    return {'maxContactError': maximum, 'sampledContacts': records, 'bikeMarkerSurfaceDistances': marker_distances,
            'coverage': 'Saved native seated/standing/kick support, pedal counter-rotation, jump release and crash release.'}


def verify_cargo(bpy, cargo, bike, path):
    import numpy as np
    from mathutils import Matrix
    bundles = sorted(cargo.children, key=lambda obj: obj.name)
    assert len(bundles) == 20 and all(obj.type == 'MESH' for obj in bundles), 'Expected 20 editable bundle instances'
    geometries = {obj.data.as_pointer() for obj in bundles}; assert len(geometries) == 4, 'Expected four shared banana variants'
    for index, obj in enumerate(bundles):
        assert obj.get('globalBundleIndex') == index and obj.get('variant') == index % 4
        if 'bananas' in obj: assert obj['bananas'] == 5
        assert sum(other.data == obj.data for other in bundles) == 5
    document, _ = read_glb(path)
    native_heap = next(node for node in document['nodes'] if node['name'] == cargo.name)
    exported = sorted([document['nodes'][index] for index in native_heap['children']], key=lambda node: node['name'])
    assert [node['name'] for node in exported] == [obj.name for obj in bundles]
    assert len({node['mesh'] for node in exported}) == 4, 'Bundle instances must retain four shared geometries independently of the local tie-down meshes'
    conversion = Matrix.Rotation(-np.pi / 2, 4, 'X'); maximum = 0.
    for index, (obj, node) in enumerate(zip(bundles, exported)):
        assert node['extras']['globalBundleIndex'] == index and node['extras']['variant'] == index % 4
        expected = conversion @ (cargo.matrix_world.inverted() @ obj.matrix_world) @ conversion.inverted()
        error = float(np.max(np.abs(np.asarray(expected) - np.asarray(node_matrix(node)))))
        assert error < 1e-5, (obj.name, 'Native cargo author matrix changed'); maximum = max(maximum, error)
        assert node['mesh'] == exported[index % 4]['mesh']
    support = surface(bpy, bike); distances = [min(support.find_nearest(bike.matrix_world.inverted() @ obj.matrix_world @ vertex.co)[3]
                                                     for vertex in obj.data.vertices) for obj in bundles]
    assert distances[0] < .008 and min(distances) < .008, ('Banana cargo floats above its actual native rear support', distances[0])
    return {'bundles': 20, 'sharedGeometries': 4, 'maxMatrixError': maximum, 'firstBundleSupportDistance': distances[0]}


def verify_clearance(bpy, actor, cargo):
    from mathutils.bvhtree import BVHTree
    rig = next(obj for obj in actor.children_recursive if obj.type == 'ARMATURE')
    skin = next(obj for obj in actor.children_recursive if obj.type == 'MESH')
    # Both assemblies are at origin in the same metre-space frame.
    heap = surface(bpy, cargo); records = []
    for name, frames in [('Rider_Ride_SeatedPedal', [0, 15, 30, 45]), ('Rider_Ride_StandingBalance', [0, 60]),
                         ('Rider_Trans_SitToStand', [10]), ('Rider_Kick_Strike_L', [21]), ('Rider_Kick_Strike_R', [21])]:
        rig.animation_data.action = bpy.data.actions[name]
        for frame in frames:
            bpy.context.scene.frame_set(frame); bpy.context.view_layer.update()
            evaluated = skin.evaluated_get(bpy.context.evaluated_depsgraph_get())
            vertices = [cargo.matrix_world.inverted() @ evaluated.matrix_world @ vertex.co for vertex in evaluated.data.vertices]
            body = BVHTree.FromPolygons(vertices, [list(face.vertices) for face in evaluated.data.polygons])
            overlap = len(body.overlap(heap)); nearest = min(heap.find_nearest(point)[3] for point in vertices)
            records.append({'name': name, 'frame': frame, 'intersectingTriangles': overlap, 'minimumVertexClearance': nearest})
            assert overlap == 0 and nearest > .01, ('Rider intersects or nearly touches the actual cargo; move the cargo, retain the bicycle contour', records[-1])
    return {'minimumVertexClearance': min(record['minimumVertexClearance'] for record in records), 'poses': records}


def main():
    import bpy
    parser = SKIN['arguments'](argparse.ArgumentParser(description=__doc__))
    parser.add_argument('--bike-source', type=Path, default=ROOT / 'assets/blender/tripo/bicycle.blend')
    parser.add_argument('--bike-glb', type=Path, default=ROOT / 'assets/export/bicycle.glb')
    parser.add_argument('--bike-root', default='Bicycle')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'assets/export/manifest.json')
    parser.add_argument('--cargo-source', type=Path)
    parser.add_argument('--cargo-glb', type=Path)
    parser.add_argument('--cargo-root', default='BananaCargo')
    parser.add_argument('--skip-cargo', action='store_true')
    parser.add_argument('--report', type=Path, default=ROOT / 'artifacts/hero-native-report.json')
    options = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    manifest = json.loads(options.manifest.read_text()); cargo = manifest['models'].get('bananaRack')
    protected = [options.source, options.glb, options.metadata, options.original_source, options.bike_source, options.bike_glb, options.manifest]
    if not options.skip_cargo:
        if options.cargo_source or options.cargo_glb:
            if not options.cargo_source or not options.cargo_glb: parser.error('--cargo-source and --cargo-glb must be provided together')
            cargo_source, cargo_glb, cargo_root = options.cargo_source, options.cargo_glb, options.cargo_root
        else:
            assert cargo and cargo.get('root'), 'Missing manifest native bananaRack root/source contract'
            cargo_source, cargo_glb, cargo_root = ROOT / cargo['source'], options.manifest.parent / cargo['file'], cargo['root']
        protected.extend([cargo_source, cargo_glb])
    with unchanged(protected) as hashes:
        skin = SKIN['verify_skin'](options); actor = bpy.data.objects[options.root]
        exports = {'hero': verify_export(actor, options.glb)}
        bike = append_root(bpy, options.bike_source, options.bike_root)
        exports['bicycle'] = verify_export(bike, options.bike_glb)
        contacts = verify_contacts(bpy, actor, bike, json.loads(options.metadata.read_text()))
        cargo_report = {'coverage': 'Explicitly skipped until candidate cargo assembly is available'}
        if not options.skip_cargo:
            assembly = append_root(bpy, cargo_source, cargo_root)
            while assembly.parent: assembly = assembly.parent
            heap = next((obj for obj in [assembly, *assembly.children_recursive] if obj.name == 'BananaCargo'), None)
            assert heap is not None, 'Cargo assembly is missing its 20-bundle BananaCargo root'
            exports['cargo'] = verify_export(assembly, cargo_glb)
            cargo_report = verify_cargo(bpy, heap, bike, cargo_glb)
            cargo_report['riderClearance'] = verify_clearance(bpy, actor, assembly)
        report = {'status': 'pass', 'blenderVersion': bpy.app.version_string, 'skin': skin, 'exportEvidence': exports,
                  'contacts': contacts, 'cargo': cargo_report, 'sha256': hashes,
                  'scope': 'Saved Tripo meshes/skin/Actions, real bike markers, runtime texture/UV and hierarchy, authored cargo matrices and support. Overall rendered appearance is checked separately.'}
        assert options.report.resolve() not in {Path(path).resolve() for path in protected}
        options.report.parent.mkdir(parents=True, exist_ok=True); options.report.write_text(json.dumps(report, indent=2) + '\n')
    print('HERO_NATIVE_PASS ' + json.dumps(report), flush=True)


if __name__ == '__main__': main()
