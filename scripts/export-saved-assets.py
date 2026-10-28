"""Export GLBs from the manifest's saved .blend files, without ever saving a source.

Run in an independent headless Blender process. --out-dir selects a candidate
directory; otherwise only the GLBs beside --manifest are replaced.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_plan(manifest_path, root):
    manifest = json.loads(manifest_path.read_text())
    files = manifest.get('sourceFiles')
    if not isinstance(files, list) or not files or any(not isinstance(file, str) for file in files):
        raise ValueError('Manifest requires a nonempty sourceFiles list of saved native paths')
    if len(set(files)) != len(files):
        raise ValueError('Manifest sourceFiles contains duplicate saved native paths')
    sources = {}
    for file in files:
        path = (root / file).resolve()
        if Path(file).is_absolute() or not path.is_relative_to(root) or path.suffix != '.blend':
            raise ValueError('Expected a repo-relative .blend source: ' + file)
        if not path.is_file():
            raise FileNotFoundError('Missing saved source: ' + file)
        with path.open('rb') as stream: header = stream.read(7)
        if not (header == b'BLENDER' or header.startswith(b'\x28\xb5\x2f\xfd') or header.startswith(b'\x1f\x8b')):
            raise ValueError('Invalid Blender source: ' + file)
        sources[file] = path
    models = manifest.get('models')
    if not isinstance(models, dict) or not models:
        raise ValueError('Manifest requires models with file, source and root')
    groups = {file: [] for file in files}; outputs = set()
    for name, item in models.items():
        if not isinstance(item, dict):
            raise ValueError('Invalid model entry: ' + name)
        source, filename, object_name = item.get('source'), item.get('file'), item.get('root')
        if not isinstance(source, str) or source not in sources:
            raise ValueError(name + ': model source must exist in sourceFiles: ' + str(source))
        if not isinstance(object_name, str) or not object_name.strip():
            raise ValueError(name + ': missing saved root object name')
        if not isinstance(filename, str) or Path(filename).name != filename or not filename.endswith('.glb'):
            raise ValueError(name + ': file must be a .glb filename: ' + str(filename))
        if filename in outputs:
            raise ValueError('Duplicate .glb output: ' + filename)
        if 'animations' in item and not isinstance(item['animations'], bool):
            raise ValueError(name + ': animations must be true or false')
        if 'clips' in item and (not isinstance(item['clips'], list)
                              or any(not isinstance(clip, str) or not clip for clip in item['clips'])):
            raise ValueError(name + ': clips must be a list of saved NLA clip names')
        outputs.add(filename); groups[source].append((name, item))
    return sources, groups


def inspect_model(bpy, name, item):
    root = bpy.context.scene.objects.get(item['root'])
    if root is None:
        raise ValueError(name + ': missing saved root object ' + item['root'])
    objects = [root, *root.children_recursive]
    if any(obj.name not in bpy.context.view_layer.objects for obj in objects):
        raise ValueError(name + ': root descendants must be in the active view layer')
    meshes = [obj for obj in objects if obj.type == 'MESH']
    if not meshes or not any(obj.data.polygons for obj in meshes):
        raise ValueError(name + ': saved root has no mesh faces')
    for mesh in meshes:
        if any(modifier.type == 'ARMATURE' and modifier.object not in objects for modifier in mesh.modifiers):
            raise ValueError(name + ': skinned mesh references an armature outside its saved root')
        if any(not math.isfinite(value) for vertex in mesh.data.vertices for value in vertex.co):
            raise ValueError(name + ': non-finite mesh position in ' + mesh.name)
        textures = []
        for slot in mesh.material_slots:
            material = slot.material
            if material and material.use_nodes:
                textures.extend(node for node in material.node_tree.nodes if node.type == 'TEX_IMAGE'
                                and any(output.is_linked for output in node.outputs))
        if textures and not mesh.data.uv_layers.active:
            raise ValueError(name + ': textured mesh is missing UV coordinates: ' + mesh.name)
        if mesh.data.uv_layers.active and any(not math.isfinite(value) for uv in mesh.data.uv_layers.active.data for value in uv.uv):
            raise ValueError(name + ': non-finite UV coordinates in ' + mesh.name)
        for texture in textures:
            image = texture.image
            if image is None:
                raise ValueError(name + ': missing texture image data in ' + mesh.name)
            if image.source == 'FILE' and not image.packed_file and not Path(bpy.path.abspath(image.filepath, library=image.library)).is_file():
                raise FileNotFoundError(name + ': missing unpacked texture: ' + image.filepath)
            if not all(image.size):
                raise ValueError(name + ': unreadable texture image in ' + mesh.name)
    arms = [obj for obj in objects if obj.type == 'ARMATURE']
    tracks = []
    if item.get('animations', False):
        if not arms or not any(modifier.type == 'ARMATURE' and modifier.object in arms
                               for mesh in meshes for modifier in mesh.modifiers):
            raise ValueError(name + ': animations require an armature and its actual skinned mesh')
        for arm in arms:
            if arm.animation_data:
                tracks.extend(track for track in arm.animation_data.nla_tracks if track.strips)
        if not tracks or any(not strip.action for track in tracks for strip in track.strips):
            raise ValueError(name + ': animations require saved NLA tracks with Actions')
        names = [track.name for track in tracks]
        if len(set(names)) != len(names):
            raise ValueError(name + ': duplicate saved NLA clip names')
        if 'clips' in item and (set(item['clips']) != set(names) or len(item['clips']) != len(names)):
            raise ValueError(name + ': saved NLA Actions do not match manifest clips')
        if 'bones' in item and sum(len(arm.data.bones) for arm in arms) != item['bones']:
            raise ValueError(name + ': saved armature bone count does not match manifest')
    return root, objects, tracks


def export_model(bpy, item, root, objects, tracks, output):
    location = root.location.copy(); frame = bpy.context.scene.frame_current
    actions = [(obj.animation_data, obj.animation_data.action) for obj in objects if obj.animation_data]
    muted = [(track, track.mute) for track in tracks]
    colors = [(obj.data.color_attributes, obj.data.color_attributes.active_color_index,
               obj.data.color_attributes.render_color_index) for obj in objects
              if obj.type == 'MESH' and obj.data.color_attributes]
    try:
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects: obj.select_set(True)
        bpy.context.view_layer.objects.active = root
        root.location = (0, 0, 0)
        for attributes, _, _ in colors:
            index = attributes.find('Color')
            if index != -1:
                attributes.active_color_index = index; attributes.render_color_index = index
        animated = item.get('animations', False)
        options = dict(export_format='GLB', use_selection=True, export_yup=True,
                       export_extras=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                       export_animations=animated,
                       export_skins=True, export_def_bones=False, export_influence_nb=4)
        if animated:
            for data, _ in actions: data.action = None
            for track, _ in muted: track.mute = False
            options.update(export_animation_mode='NLA_TRACKS', export_force_sampling=True,
                           export_frame_step=1, export_optimize_animation_size=True, export_reset_pose_bones=True)
        bpy.context.view_layer.update()
        result = bpy.ops.export_scene.gltf(filepath=str(output), **options)
        if 'FINISHED' not in result:
            raise RuntimeError('GLB export failed: ' + str(output))
        blob = output.read_bytes()
        if blob[:4] != b'glTF':
            raise RuntimeError('Exporter did not write a GLB: ' + str(output))
        length = struct.unpack_from('<I', blob, 12)[0]; document = json.loads(blob[20:20 + length])
        if any(modifier.type == 'ARMATURE' for obj in objects if obj.type == 'MESH' for modifier in obj.modifiers) and not document.get('skins'):
            raise RuntimeError('GLB lost the saved native skin: ' + str(output))
        if animated:
            expected = {track.name for track in tracks}
            actual = [clip.get('name') for clip in document.get('animations', [])]
            if set(actual) != expected or len(actual) != len(expected) or not document.get('skins'):
                raise RuntimeError('GLB lost saved skin or NLA Actions: ' + str(output))
        elif document.get('animations'):
            raise RuntimeError('Static export unexpectedly contains animation: ' + str(output))
        return len(blob)
    finally:
        for attributes, active, render in colors:
            attributes.active_color_index = active; attributes.render_color_index = render
        for track, mute in muted: track.mute = mute
        for data, action in actions: data.action = action
        bpy.context.scene.frame_set(frame)
        root.location = location
        bpy.context.view_layer.update()


def process_saved_assets(manifest_path, out_dir, root):
    import bpy
    if not bpy.app.background:
        raise RuntimeError('Saved asset export requires an independent headless Blender process')
    root = Path(root).resolve(); manifest_path = Path(manifest_path).resolve()
    sources, groups = load_plan(manifest_path, root)
    if out_dir is not None:
        out_dir = Path(out_dir).resolve()
        for entries in groups.values():
            for _, item in entries:
                target = (out_dir / item['file']).resolve()
                if target.parent != out_dir or target in sources.values():
                    raise ValueError('Refusing to overwrite saved source through output: ' + str(target))
        out_dir.mkdir(parents=True, exist_ok=True)
    before = {file: sha256(path) for file, path in sources.items()}
    report = {'sources': before, 'models': {}}
    try:
        for file, entries in groups.items():
            bpy.ops.wm.open_mainfile(filepath=str(sources[file]))
            for name, item in entries:
                model_root, objects, tracks = inspect_model(bpy, name, item)
                record = {'source': file, 'root': model_root.name,
                          'meshes': sum(obj.type == 'MESH' for obj in objects), 'clips': [track.name for track in tracks]}
                if out_dir is not None:
                    record['bytes'] = export_model(bpy, item, model_root, objects, tracks, out_dir / item['file'])
                report['models'][name] = record
    finally:
        changed = [file for file, path in sources.items() if not path.is_file() or sha256(path) != before[file]]
        if changed:
            raise RuntimeError('Saved native sources changed during validation/export: ' + ', '.join(changed))
    return report


def validate_saved_assets(manifest_path, root=ROOT):
    return process_saved_assets(manifest_path, None, root)


def export_saved_assets(manifest_path, out_dir=None, root=ROOT):
    manifest_path = Path(manifest_path)
    return process_saved_assets(manifest_path, out_dir if out_dir is not None else manifest_path.parent, root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'assets/export/manifest.json')
    parser.add_argument('--out-dir', type=Path)
    # Blender keeps its own engine options in sys.argv. Without a separator
    # this documented default invocation has no Python-script arguments.
    arguments = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    options = parser.parse_args(arguments)
    report = export_saved_assets(options.manifest, options.out_dir)
    print('SAVED_ASSET_EXPORT_PASS ' + json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
