"""Read-only contracts for the actual saved Tripo skin and its exported Actions.

Candidate example: blender -b --python-exit-code 1 --python scripts/test-skinned-hero.py --
  --source artifacts/tripo-hero/hero.blend --glb artifacts/tripo-hero/riderSkinned.glb
  --metadata artifacts/tripo-hero/hero-metadata.json
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
CLIPS = [('Rider_Idle_Ready', 120), ('Rider_Ride_SeatedPedal', 60), ('Rider_Ride_StandingBalance', 120),
         ('Rider_Trans_SitToStand', 21), ('Rider_Trans_StandToSit', 21), ('Rider_Jump_Takeoff', 9),
         ('Rider_Jump_Air', 30), ('Rider_Jump_Land', 15), ('Rider_Kick_Charge_L', 24), ('Rider_Kick_Charge_R', 24),
         ('Rider_Kick_Strike_L', 42), ('Rider_Kick_Strike_R', 42), ('Rider_Lean_L', 1), ('Rider_Lean_R', 1),
         ('Rider_Hit_Shield', 24), ('Rider_Crash', 60)]


@contextmanager
def unchanged(paths):
    paths = {Path(path).resolve() for path in paths if path is not None}
    before = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    try:
        yield before
    finally:
        assert all(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == before[str(path)] for path in paths), 'Validation changed a protected native/runtime/source file'


def read_glb(path):
    blob = Path(path).read_bytes()
    assert blob[:4] == b'glTF' and struct.unpack_from('<I', blob, 4)[0] == 2, (str(path), 'invalid GLB')
    assert struct.unpack_from('<I', blob, 8)[0] == len(blob), 'Truncated GLB'
    document, binary, offset = None, None, 12
    while offset < len(blob):
        size, kind = struct.unpack_from('<I4s', blob, offset); chunk = blob[offset + 8:offset + 8 + size]
        if kind == b'JSON': document = json.loads(chunk)
        elif kind == b'BIN\x00': binary = chunk
        offset += 8 + size
    assert document is not None and binary is not None, 'Missing GLB chunks'
    return document, binary


def accessor(document, binary, index):
    import numpy as np
    item = document['accessors'][index]; view = document['bufferViews'][item['bufferView']]
    dtype = np.dtype({5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[item['componentType']])
    columns = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[item['type']]
    values = np.ndarray((item['count'], columns), dtype=dtype, buffer=binary,
                        offset=view.get('byteOffset', 0) + item.get('byteOffset', 0),
                        strides=(view.get('byteStride', columns * dtype.itemsize), dtype.itemsize)).astype(np.float64)
    if item.get('normalized'): values /= np.iinfo(dtype).max
    assert np.isfinite(values).all(), 'Non-finite exported accessor'
    return values


def arguments(parser=None):
    parser = parser or argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'assets/blender/tripo/hero.blend')
    parser.add_argument('--glb', type=Path, default=ROOT / 'assets/export/riderSkinned.glb')
    parser.add_argument('--metadata', type=Path, default=ROOT / 'assets/export/hero-metadata.json')
    parser.add_argument('--original-source', type=Path, default=ROOT / 'assets/sources/banana-tripo-v1/hero-rigged.glb')
    parser.add_argument('--root', default='BananaTripoHero')
    return parser


def verify_skin(options):
    import bpy
    import numpy as np
    from mathutils import Matrix, Vector
    from mathutils.bvhtree import BVHTree
    protected = [options.source, options.glb, options.metadata, options.original_source]
    with unchanged(protected) as hashes:
        original, original_binary = read_glb(options.original_source)
        expected_bones = {original['nodes'][index]['name'] for index in original['skins'][0]['joints']}
        assert len(expected_bones) == 65 and all(name.startswith('mixamorig:') for name in expected_bones)
        metadata = json.loads(options.metadata.read_text()); digest = hashes[str(options.original_source.resolve())]
        assert metadata['sha256'] == digest, 'Metadata no longer identifies the actual immutable Tripo source'
        bpy.ops.wm.open_mainfile(filepath=str(options.source.resolve()))
        bpy.context.view_layer.update(); scene = bpy.context.scene
        assert scene.unit_settings.system == 'METRIC' and scene.unit_settings.scale_length == 1
        assert scene.render.fps == 60, 'Actions must use the game 60 Hz clock'
        root = bpy.data.objects[options.root]; objects = [root, *root.children_recursive]
        assert root.get('provider') == 'Tripo' and root.get('sourceSha256') == digest
        assert root.get('rigProfile') == 'mixamo65-banana-v1'
        meshes = [obj for obj in objects if obj.type == 'MESH']; arms = [obj for obj in objects if obj.type == 'ARMATURE']
        assert len(meshes) == len(arms) == 1, 'Only the actual one-mesh Tripo skin may be visible'
        mesh, rig = meshes[0], arms[0]
        assert all(obj.library is None and (obj.data is None or obj.data.library is None) for obj in objects), 'Native hero must remain locally editable'
        assert {bone.name for bone in rig.data.bones} == expected_bones, 'Original Mixamo65 hierarchy was replaced'
        original_parents = {child: index for index, node in enumerate(original['nodes']) for child in node.get('children', [])}
        for index in original['skins'][0]['joints']:
            parent = original['nodes'][original_parents[index]]['name'] if index in original_parents else None
            expected = parent if parent in expected_bones else None
            bone = rig.data.bones[original['nodes'][index]['name']]
            assert (bone.parent.name if bone.parent else None) == expected, (bone.name, 'Original bone hierarchy changed')
        assert any(modifier.type == 'ARMATURE' and modifier.object == rig for modifier in mesh.modifiers)
        mesh.data.calc_loop_triangles(); triangles = len(mesh.data.loop_triangles)
        assert triangles == metadata['runtimeTriangles'] == 19121
        assert len(mesh.data.vertices) == metadata['vertices']
        primitive = original['meshes'][0]['primitives'][0]
        original_positions = accessor(original, original_binary, primitive['attributes']['POSITION'])
        expected_positions = original_positions[:, [0, 2, 1]].copy(); expected_positions[:, 1] *= -1
        expected_positions[:, 0] -= (original_positions[:, 0].max() + original_positions[:, 0].min()) / 2
        expected_positions[:, 2] -= original_positions[:, 1].min(); expected_positions *= metadata['uniformScale']
        assert np.allclose(expected_positions, np.asarray([vertex.co for vertex in mesh.data.vertices]), atol=1e-5, rtol=0), 'Visible native mesh no longer comes from the actual Tripo source'
        original_uv = accessor(original, original_binary, primitive['attributes']['TEXCOORD_0'])
        original_joints = accessor(original, original_binary, primitive['attributes']['JOINTS_0']).astype(np.int64)
        original_weights = accessor(original, original_binary, primitive['attributes']['WEIGHTS_0'])
        joint_names = [original['nodes'][index]['name'] for index in original['skins'][0]['joints']]
        assert abs(max(v.co.z for v in mesh.data.vertices) - min(v.co.z for v in mesh.data.vertices) - metadata['naturalHeight']) < 1e-4
        assert 1.7 <= metadata['naturalHeight'] <= 2.0, 'Hero is not in natural human metre scale'
        assert mesh.data.uv_layers.active and all(np.isfinite(loop.uv).all() for loop in mesh.data.uv_layers.active.data), 'Missing or non-finite native UV coordinates'
        for loop in mesh.data.loops:
            expected = original_uv[loop.vertex_index].copy(); expected[1] = 1 - expected[1]
            assert np.allclose(expected, mesh.data.uv_layers.active.data[loop.index].uv, atol=1e-6, rtol=0), 'Actual Tripo painted UV layout changed'
        blended = 0
        for vertex in mesh.data.vertices:
            weights = [group.weight for group in vertex.groups if group.weight > 1e-5]
            assert 1 <= len(weights) <= 4 and abs(sum(weights) - 1) < 1e-4, (vertex.index, 'Invalid skin weights')
            assert all(mesh.vertex_groups[group.group].name in expected_bones for group in vertex.groups)
            expected = {joint_names[joint]: weight for joint, weight in zip(original_joints[vertex.index], original_weights[vertex.index]) if weight > 1e-5}
            actual = {mesh.vertex_groups[group.group].name: group.weight for group in vertex.groups if group.weight > 1e-5}
            assert set(actual) == set(expected) and all(abs(actual[name] - expected[name]) < 2e-6 for name in actual), (vertex.index, 'Original Tripo skin influences changed')
            blended += len(weights) > 1
        assert blended > 250, 'Missing the actual blended deformation weights'
        tracks = rig.animation_data.nla_tracks
        assert {track.name for track in tracks} == {name for name, _ in CLIPS} and len(tracks) == 16, 'Missing one of the 16 saved native NLA Actions'
        for track in tracks: track.mute = True
        deformation = []
        samples = list(range(0, len(mesh.data.vertices), 113))
        for name, count in CLIPS:
            action = bpy.data.actions.get(name); assert action is not None, ('Missing native Action', name)
            assert tuple(action.frame_range) == (0., float(count)), (name, 'Native Action duration changed')
            if 'Strike' in name: assert action.pose_markers['impact'].frame == 8
            rig.animation_data.action = action; first = None; span = 0.; previous = None; adjacent = 0.
            for frame in sorted({0, count // 2, count} | (set(range(count + 1)) if 'Trans_' in name or name == 'Rider_Crash' else set())):
                scene.frame_set(frame); bpy.context.view_layer.update()
                for bone in rig.pose.bones:
                    if bone.parent: assert bone.location.length < 1e-4, (name, bone.name, 'Child bone stretched')
                    assert max(abs(value - 1) for value in bone.scale) < 1e-4, (name, bone.name, 'Bone scaled')
                pose = {bone.name: bone.rotation_quaternion.copy() for bone in rig.pose.bones}
                if previous:
                    differences = [q.rotation_difference(previous[key]).angle for key, q in pose.items()]
                    adjacent = max(adjacent, max(min(angle, 2 * np.pi - angle) for angle in differences))
                previous = pose
                if frame not in {0, count // 2, count}: continue
                evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
                positions = np.asarray([evaluated.matrix_world @ evaluated.data.vertices[index].co for index in samples])
                assert np.isfinite(positions).all(), (name, 'Non-finite deformed visible mesh')
                if first is None: first = positions
                span = max(span, float(np.linalg.norm(positions - first, axis=1).max()))
            assert span > 1e-5, (name, 'Native Action does not deform the actual Tripo mesh')
            if 'Trans_' in name or name == 'Rider_Crash': assert adjacent < np.deg2rad(15.01), (name, 'Adjacent native joint rotation snapped', np.rad2deg(adjacent))
            deformation.append({'name': name, 'vertexSpan': span})
        rig.animation_data.action = None
        for bone in rig.pose.bones: bone.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        surface = BVHTree.FromPolygons([mesh.matrix_world @ vertex.co for vertex in mesh.data.vertices], [list(face.vertices) for face in mesh.data.polygons])
        marker_errors = {}
        for name in ['Sole_L', 'Sole_R', 'Palm_L', 'Palm_R', 'SeatContact']:
            marker = bpy.data.objects.get(name); assert marker and marker.parent == rig and marker.parent_type == 'BONE'
            record = metadata['contactMarkers'][name]
            assert marker.parent_bone == record['bone']
            expected = Vector((record['restPosition'][0], -record['restPosition'][2], record['restPosition'][1]))
            assert (marker.matrix_world.translation - expected).length < 1e-5, (name, 'Marker moved from its actual mesh-derived rest point')
            distance = surface.find_nearest(marker.matrix_world.translation)[3]
            assert distance < (.02 if name.startswith('Sole') else .001), (name, 'Contact marker is separated from visible skin', distance)
            if 'sourceVertex' in record:
                assert (mesh.matrix_world @ mesh.data.vertices[record['sourceVertex']].co - marker.matrix_world.translation).length < 1e-5
            marker_errors[name] = distance
        document, binary = read_glb(options.glb)
        assert len(document['meshes']) == len(document['skins']) == 1 and len(document['skins'][0]['joints']) == 65
        assert {document['nodes'][index]['name'] for index in document['skins'][0]['joints']} == expected_bones
        assert {clip['name'] for clip in document['animations']} == {name for name, _ in CLIPS} and len(document['animations']) == 16
        for primitive in document['meshes'][0]['primitives']:
            assert {'POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'} <= set(primitive['attributes'])
            weights = accessor(document, binary, primitive['attributes']['WEIGHTS_0'])
            assert np.allclose(weights.sum(axis=1), 1, atol=1e-4, rtol=0)
            assert accessor(document, binary, primitive['attributes']['JOINTS_0']).max() < 65
        for clip in document['animations']:
            duration = max(float(accessor(document, binary, sampler['input']).max()) for sampler in clip['samplers'])
            assert abs(duration - dict(CLIPS)[clip['name']] / 60) < .002
        images = document.get('images', []); assert len(images) == 1 and images[0]['mimeType'] == 'image/jpeg'
        view = document['bufferViews'][images[0]['bufferView']]
        encoded = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        for material in mesh.data.materials:
            shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
            assert shader.inputs['Metallic'].default_value <= .05 and shader.inputs['Roughness'].default_value >= .6
            image = shader.inputs['Base Color'].links[0].from_node.image
            assert tuple(image.size) == (2048, 2048) and image.file_format == 'JPEG'
            assert image.packed_file and image.packed_file.data == encoded, 'GLB texture differs from native painted JPEG'
        return {'status': 'pass', 'source': str(options.source.resolve()), 'glb': str(options.glb.resolve()),
                'triangles': triangles, 'vertices': len(mesh.data.vertices), 'bones': 65, 'blendedVertices': blended,
                'clips': deformation, 'markerSurfaceDistance': marker_errors, 'textureBytes': len(encoded), 'sha256': hashes}


if __name__ == '__main__':
    options = arguments().parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    print('TRIPO_SKIN_PASS ' + json.dumps(verify_skin(options)), flush=True)
