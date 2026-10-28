"""Export real, hand-saved native fixtures without regenerating or resaving them."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BLENDER = os.environ.get('BLENDER_BIN') or shutil.which('blender') or '/Applications/Blender.app/Contents/MacOS/Blender'
CLIPS = ['Rider_Idle_Ready', 'Rider_Ride_SeatedPedal', 'Rider_Ride_StandingBalance',
         'Rider_Trans_SitToStand', 'Rider_Trans_StandToSit', 'Rider_Jump_Takeoff', 'Rider_Jump_Air',
         'Rider_Jump_Land', 'Rider_Kick_Charge_L', 'Rider_Kick_Charge_R', 'Rider_Kick_Strike_L',
         'Rider_Kick_Strike_R', 'Rider_Lean_L', 'Rider_Lean_R', 'Rider_Hit_Shield', 'Rider_Crash']


def verify(directory):
    import bpy
    from bpy.app.handlers import persistent
    import hashlib
    import importlib.util
    import json
    import struct

    spec = importlib.util.spec_from_file_location('saved_exporter', ROOT / 'scripts/export-saved-assets.py')
    exporter = importlib.util.module_from_spec(spec); spec.loader.exec_module(exporter)
    bpy.context.preferences.filepaths.save_version = 0

    def empty(name, parent=None):
        obj = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        return obj

    def color(mesh):
        for name, rgba in [('Color', (.2, .4, .7, 1)), ('ArtistBackup', (1, 1, 1, 1))]:
            attr = mesh.data.color_attributes.new(name=name, type='BYTE_COLOR', domain='CORNER')
            for entry in attr.data: entry.color = rgba
        mesh.data.color_attributes.active_color_index = 1
        mesh.data.color_attributes.render_color_index = 1

    def save(name):
        native = directory / name
        bpy.ops.wm.save_as_mainfile(filepath=str(native))
        return str(native.relative_to(ROOT))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    assembly = empty('ArtistAssembly'); assembly.location = (12, -9, 7); assembly['artistRevision'] = 'hand-edited-42'
    nested = empty('NestedPivot', assembly); nested.location = (1, 2, 3)
    bpy.ops.mesh.primitive_cube_add(); mesh = bpy.context.object; mesh.name = 'TexturedBox'; mesh.parent = nested
    mesh.location = (.25, 0, .5); color(mesh)
    marker = empty('RiderSeat', nested); marker.location = (.2, .3, .4); marker['contactRole'] = 'seat'
    image = bpy.data.images.new('ArtistAlbedo', width=8, height=4, alpha=False)
    image.pixels.foreach_set([.7, .15, .05, 1] * 32); image.file_format = 'JPEG'
    image.filepath_raw = str(directory / 'artist-albedo.jpg'); image.save(quality=90)
    encoded = Path(image.filepath_raw).read_bytes(); image.pack(data=encoded, data_len=len(encoded)); image.filepath = '//artist-albedo.jpg'
    material = bpy.data.materials.new('ArtistMaterial'); material.use_nodes = True
    texture = material.node_tree.nodes.new('ShaderNodeTexImage'); texture.image = image
    material.node_tree.links.new(texture.outputs['Color'], material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    mesh.data.materials.append(material)
    # A second selected root from the same file must never leak into the first GLB.
    other = empty('OtherAssembly'); other.location = (-14, 5, 1)
    bpy.ops.mesh.primitive_plane_add(); plain = bpy.context.object; plain.name = 'ColorOnlyMesh'; plain.parent = other
    for layer in list(plain.data.uv_layers): plain.data.uv_layers.remove(layer)
    color(plain)
    plain.rotation_euler.z = 0; plain.keyframe_insert('rotation_euler', frame=0)
    plain.rotation_euler.z = .6; plain.keyframe_insert('rotation_euler', frame=12)
    bpy.context.scene.frame_set(0)
    static_source = save('artist-props.blend')

    bpy.ops.wm.read_factory_settings(use_empty=True)
    actor = empty('HandAuthoredActor'); actor.location = (5, 4, 3); actor['rigProfile'] = 'fixture-two-bone-skin'
    armature = bpy.data.armatures.new('ArtistRig'); rig = bpy.data.objects.new('ArtistRig', armature)
    bpy.context.scene.collection.objects.link(rig); rig.parent = actor
    bpy.context.view_layer.objects.active = rig; rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
    hip = armature.edit_bones.new('Hip'); hip.head = (0, 0, 0); hip.tail = (0, 0, 1)
    hand = armature.edit_bones.new('Hand'); hand.head = (0, 0, 1); hand.tail = (0, 0, 2); hand.parent = hip
    bpy.ops.object.mode_set(mode='OBJECT')
    data = bpy.data.meshes.new('ArtistSkin'); data.from_pydata([(-.1, 0, .2), (.1, 0, .2), (.1, 0, 1.8), (-.1, 0, 1.8)], [], [(0, 1, 2, 3)])
    skin = bpy.data.objects.new('ArtistSkin', data); bpy.context.scene.collection.objects.link(skin); skin.parent = rig; color(skin)
    skin.vertex_groups.new(name='Hip').add([0, 1], 1, 'REPLACE')
    skin.vertex_groups.new(name='Hand').add([2, 3], 1, 'REPLACE')
    modifier = skin.modifiers.new('ArtistSkin', 'ARMATURE'); modifier.object = rig
    empty('Sole_L', rig)['contactRole'] = 'sole'
    palm = empty('Palm_L', rig); palm.parent_type = 'BONE'; palm.parent_bone = 'Hand'
    palm.location = (.01, .08, .02); palm['contactRole'] = 'palm'
    rig.animation_data_create(); actions = []
    for index, name in enumerate(CLIPS):
        action = bpy.data.actions.new(name); action.use_fake_user = True; rig.animation_data.action = action
        bone = rig.pose.bones['Hand']; bone.rotation_mode = 'QUATERNION'
        for frame, angle in [(0, 0), (6, .15 + index * .02), (12, 0)]:
            from mathutils import Quaternion
            bone.rotation_quaternion = Quaternion((1, 0, 0), angle); bone.keyframe_insert('rotation_quaternion', frame=frame)
        track = rig.animation_data.nla_tracks.new(); track.name = name
        track.strips.new(name, 0, action); track.mute = True; actions.append(action)
    rig.animation_data.action = actions[1]; bpy.context.scene.render.fps = 60; bpy.context.scene.frame_set(6)
    actor_source = save('artist-actor.blend')
    bpy.ops.wm.read_factory_settings(use_empty=True); empty('NativeNotes')
    notes_source = save('artist-layout-not-a-model.blend')
    manifest = {'sourceFiles': [static_source, actor_source, notes_source], 'models': {
        'box': {'file': 'box.glb', 'source': static_source, 'root': 'ArtistAssembly'},
        'color': {'file': 'color.glb', 'source': static_source, 'root': 'OtherAssembly'},
        'actor': {'file': 'actor.glb', 'source': actor_source, 'root': 'HandAuthoredActor', 'animations': True, 'clips': CLIPS, 'bones': 2},
        'actorStatic': {'file': 'actor-static.glb', 'source': actor_source, 'root': 'HandAuthoredActor'}}}
    manifest_path = directory / 'manifest.json'; manifest_path.write_text(json.dumps(manifest))
    original = {source: hashlib.sha256((ROOT / source).read_bytes()).hexdigest() for source in manifest['sourceFiles']}
    opened = []

    @persistent
    def on_load(_): opened.append(Path(bpy.data.filepath).name)
    bpy.app.handlers.load_post.append(on_load)

    readonly = exporter.validate_saved_assets(manifest_path)
    assert not list(directory.glob('*.glb')), 'Read-only validation wrote runtime files'
    assert set(readonly['sources']) == set(original), readonly
    first, second = directory / 'first', directory / 'second'
    for output in [first, second]: exporter.export_saved_assets(manifest_path, output)
    for name in ['artist-props.blend', 'artist-actor.blend', 'artist-layout-not-a-model.blend']:
        assert opened.count(name) == 3, ('Open once per source per operation', opened)
    reordered = {**manifest, 'models': dict(reversed(list(manifest['models'].items())))}
    manifest_path.write_text(json.dumps(reordered)); third = directory / 'reordered'
    exporter.export_saved_assets(manifest_path, third)
    manifest_path.write_text(json.dumps(manifest))
    # Exercise main with real Blender engine arguments, including CI's no--
    # default invocation. Redirect only the default manifest into this fixture.
    default_output = directory / 'assets/export'; default_output.mkdir(parents=True)
    (default_output / 'manifest.json').write_text(json.dumps(manifest))
    explicit_output = directory / 'explicit-cli'
    engine_arguments = [BLENDER, '--background', '--factory-startup', '--python-exit-code', '1',
                        '--python', str(ROOT / 'scripts/export-saved-assets.py')]
    previous_arguments, previous_root = sys.argv, exporter.ROOT
    try:
        exporter.ROOT = directory
        for arguments in [engine_arguments, engine_arguments + ['--', '--manifest', str(manifest_path), '--out-dir', str(explicit_output)]]:
            sys.argv = arguments; exporter.main()
    finally:
        sys.argv, exporter.ROOT = previous_arguments, previous_root
    for name in ['artist-props.blend', 'artist-actor.blend', 'artist-layout-not-a-model.blend']:
        assert opened.count(name) == 6, ('CLI must also open each source once', opened)

    def glb(file):
        blob = file.read_bytes(); length = struct.unpack_from('<I', blob, 12)[0]
        return json.loads(blob[20:20 + length]), blob[28 + length:]

    def values(document, binary, index):
        accessor = document['accessors'][index]; view = document['bufferViews'][accessor['bufferView']]
        code, size = {5121: ('B', 1), 5123: ('H', 2), 5126: ('f', 4)}[accessor['componentType']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
        start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0); stride = view.get('byteStride', width * size)
        return [struct.unpack_from('<' + code * width, binary, start + i * stride) for i in range(accessor['count'])]

    for name in ['box.glb', 'color.glb', 'actor.glb', 'actor-static.glb']:
        assert (first / name).read_bytes() == (second / name).read_bytes(), 'Repeated export changed ' + name
        assert (first / name).read_bytes() == (third / name).read_bytes(), 'Shared-source model order changed ' + name
        for output in [default_output, explicit_output]:
            assert (first / name).read_bytes() == (output / name).read_bytes(), 'CLI arguments changed ' + name
    box, binary = glb(first / 'box.glb'); nodes = {node['name']: node for node in box['nodes']}
    assert set(nodes) == {'ArtistAssembly', 'NestedPivot', 'TexturedBox', 'RiderSeat'}, nodes
    assert nodes['ArtistAssembly'].get('translation', [0, 0, 0]) == [0, 0, 0]
    assert nodes['ArtistAssembly']['extras']['artistRevision'] == 'hand-edited-42'
    assert max(abs(a - b) for a, b in zip(nodes['NestedPivot']['translation'], [1, 3, -2])) < 1e-6
    assert nodes['RiderSeat']['extras']['contactRole'] == 'seat'
    assert {box['nodes'][index]['name'] for index in nodes['NestedPivot']['children']} == {'TexturedBox', 'RiderSeat'}
    primitive = box['meshes'][0]['primitives'][0]
    assert 'TEXCOORD_0' in primitive['attributes'] and 'COLOR_0' in primitive['attributes']
    assert [key for key in primitive['attributes'] if key.startswith('COLOR_')] == ['COLOR_0']
    colors = values(box, binary, primitive['attributes']['COLOR_0'])
    assert max(colors[0][:3]) > min(colors[0][:3]), 'ACTIVE Color exported the white artist backup layer'
    assert box['images'][0]['mimeType'] == 'image/jpeg'; view = box['bufferViews'][box['images'][0]['bufferView']]
    assert binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']] == encoded
    assert not box.get('animations') and not glb(first / 'color.glb')[0].get('animations')
    actor_doc, actor_binary = glb(first / 'actor.glb')
    assert len(actor_doc['skins']) == 1 and len(actor_doc['skins'][0]['joints']) == 2
    assert {clip['name'] for clip in actor_doc['animations']} == set(CLIPS)
    assert len(actor_doc['animations']) == 16
    static_skin, _ = glb(first / 'actor-static.glb')
    assert len(static_skin.get('skins', [])) == 1 and not static_skin.get('animations'), 'Disabling Actions must not discard the saved skin'
    assert any(len(set(values(actor_doc, actor_binary, sampler['output']))) > 1
               for clip in actor_doc['animations'] for sampler in clip['samplers']), 'Exported Actions do not deform the real skin'

    def rejected(changed, expected):
        manifest_path.write_text(json.dumps(changed))
        try: exporter.export_saved_assets(manifest_path, directory / 'rejected')
        except (ValueError, RuntimeError, FileNotFoundError) as error:
            assert expected.lower() in str(error).lower(), (expected, str(error))
        else: raise AssertionError('Accepted invalid native input: ' + expected)

    def changed_model(**fields):
        changed = json.loads(json.dumps(manifest)); changed['models'] = {'box': {**changed['models']['box'], **fields}}
        return changed

    changed = changed_model(); del changed['models']['box']['root']; rejected(changed, 'root')
    rejected(changed_model(root='MissingArtistRoot'), 'MissingArtistRoot')
    rejected(changed_model(source='assets/blender/missing-native.blend'), 'source')
    rejected(changed_model(file='../../hand-edited.blend'), '.glb')
    rejected(changed_model(animations=True), 'armature')
    changed = changed_model(); changed['sourceFiles'].remove(static_source); rejected(changed, 'sourceFiles')
    changed = changed_model(); changed['sourceFiles'].append('assets/blender/missing-native.blend'); rejected(changed, 'source')
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / static_source))
    mesh = bpy.data.objects['TexturedBox']
    for layer in list(mesh.data.uv_layers): mesh.data.uv_layers.remove(layer)
    invalid_source = save('missing-uv.blend')
    changed = changed_model(source=invalid_source); changed['sourceFiles'].append(invalid_source); rejected(changed, 'UV')
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / actor_source))
    for track in list(bpy.data.objects['ArtistRig'].animation_data.nla_tracks):
        bpy.data.objects['ArtistRig'].animation_data.nla_tracks.remove(track)
    no_actions = save('missing-actions.blend')
    changed = json.loads(json.dumps(manifest)); changed['sourceFiles'].append(no_actions)
    changed['models'] = {'actor': {**changed['models']['actor'], 'source': no_actions}}
    rejected(changed, 'NLA tracks')

    # The guard must also detect a concurrent source write while Blender is exporting.
    tampered = directory / 'concurrently-edited.blend'; shutil.copyfile(ROOT / static_source, tampered)
    relative = str(tampered.relative_to(ROOT)); changed = changed_model(source=relative); changed['sourceFiles'].append(relative)
    original_export = exporter.export_model

    def concurrent_edit(*arguments):
        result = original_export(*arguments)
        tampered.write_bytes(tampered.read_bytes() + b'concurrent artist edit')
        return result
    exporter.export_model = concurrent_edit
    try: rejected(changed, 'sources changed')
    finally: exporter.export_model = original_export
    for source, expected in original.items():
        assert hashlib.sha256((ROOT / source).read_bytes()).hexdigest() == expected, 'Saved source changed: ' + source
    assert sorted(path.name for path in first.iterdir()) == ['actor-static.glb', 'actor.glb', 'box.glb', 'color.glb'], 'Exporter wrote non-GLB files'
    print('SAVED_NATIVE_EXPORT_PASS', json.dumps({'models': 4, 'sources': original, 'actions': 16}), flush=True)


class SavedNativeExportTest(unittest.TestCase):
    def test_saved_sources_hierarchy_texture_skin_actions_and_repeated_export(self):
        (ROOT / 'artifacts').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='saved-native-export-', dir=ROOT / 'artifacts') as directory:
            result = subprocess.run([BLENDER, '--background', '--factory-startup', '--python-exit-code', '1',
                                     '--python', str(Path(__file__).resolve()), '--', '--fixture', directory],
                                    capture_output=True, text=True, timeout=180)
            self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
            self.assertIn('SAVED_NATIVE_EXPORT_PASS', result.stdout)
            print(result.stdout)


if __name__ == '__main__':
    if '--fixture' in sys.argv: verify(Path(sys.argv[-1]))
    else: unittest.main()
