"""Prepare this project's Tripo H3.1 static assets inside headless Blender.

blender --background --factory-startup --python-exit-code 1 --python
scripts/banana-tripo/prepare-static.py -- --recipe PATH [--only ID]

Recipe: {"assets": [{id, source, root, rotationDegrees, targetDimensions,
triangleBudget, textureSize, native, output}]}. Paths are relative to the
project root; rotations/dimensions use Blender XYZ metres (Z up). Dimensions
are fitted independently after reduction; textureSize caps the longest edge.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile


ROOT=Path(__file__).resolve().parents[2]


def glb_json(path):
    with path.open('rb') as stream:
        magic,version,size=struct.unpack('<III',stream.read(12))
        if magic!=0x46546c67 or version!=2 or size!=path.stat().st_size:
            raise ValueError('Expected a complete GLB 2 source: '+str(path))
        length,kind=struct.unpack('<II',stream.read(8))
        if kind!=0x4e4f534a:
            raise ValueError('Missing GLB JSON: '+str(path))
        return json.loads(stream.read(length))


def sha256(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            digest.update(chunk)
    return digest.hexdigest()


def read_recipe(path,only):
    assets=json.loads(path.read_text())['assets']
    if not isinstance(assets,list) or not assets:
        raise ValueError('Recipe assets must be a nonempty list')
    identifiers=set()
    for item in assets:
        for field in ['id','source','root','native','output']:
            if not isinstance(item.get(field),str) or not item[field].strip():
                raise ValueError('Missing recipe field: '+field)
        if item['id'] in identifiers:
            raise ValueError('Duplicate asset id: '+item['id'])
        identifiers.add(item['id'])
        for field in ['rotationDegrees','targetDimensions']:
            values=item.get(field)
            if not isinstance(values,list) or len(values)!=3 or any(
                    isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value)
                    or field=='targetDimensions' and value<=0 for value in values):
                raise ValueError('Expected three finite '+field+' values for '+item['id'])
        for field in ['triangleBudget','textureSize']:
            if type(item.get(field)) is not int or item[field]<1:
                raise ValueError('Expected positive integer '+field+' for '+item['id'])
        for field in ['source','native','output']:
            item[field]=(ROOT/item[field]).resolve()
    if only and only not in identifiers:
        raise ValueError('Unknown asset id: '+only)
    selected=[item for item in assets if not only or item['id']==only]
    sources={item['source'] for item in assets}
    outputs=set()
    for item in selected:
        for field,suffix in [('native','.blend'),('output','.glb')]:
            target=item[field]
            if target in sources or target.exists() and any(source.exists() and target.samefile(source) for source in sources):
                raise ValueError('Refusing to overwrite source: '+str(target))
            if target in outputs or target.suffix.lower()!=suffix:
                raise ValueError('Invalid or duplicate '+field+' path: '+str(target))
            outputs.add(target)
        if not item['source'].is_file():
            raise FileNotFoundError('Missing Tripo source: '+str(item['source']))
        doc=glb_json(item['source'])
        if doc.get('skins') or any('skin' in node for node in doc.get('nodes',[])):
            raise ValueError('Static preparation rejects skin: '+str(item['source']))
        if doc.get('animations') or any(primitive.get('targets') for mesh in doc.get('meshes',[])
                                       for primitive in mesh['primitives']):
            raise ValueError('Static preparation rejects animation/morph targets: '+str(item['source']))
    return selected


def triangle_count(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def simplify_materials(bpy,mesh,texture_size):
    images=set()
    for material in mesh.materials:
        if material is None:
            raise ValueError('A source mesh has an empty material slot')
        nodes=material.node_tree.nodes
        shader=next((node for node in nodes if node.type=='BSDF_PRINCIPLED'),None)
        output=next((node for node in nodes if node.type=='OUTPUT_MATERIAL'),None)
        if shader is None or output is None:
            raise ValueError('Expected a glTF Principled baseColor material: '+material.name)
        keep={shader,output}

        def upstream(socket):
            for link in socket.links:
                node=link.from_node
                if node in keep:
                    continue
                keep.add(node)
                for node_input in node.inputs:
                    upstream(node_input)

        for name in ['Base Color','Alpha']:
            upstream(shader.inputs[name])
        for socket in shader.inputs:
            if socket.name not in ['Base Color','Alpha']:
                for link in list(socket.links):
                    material.node_tree.links.remove(link)
        shader.inputs['Metallic'].default_value=0
        shader.inputs['Roughness'].default_value=.85
        for node in list(nodes):
            if node not in keep:
                nodes.remove(node)
        images.update(node.image for node in nodes if node.type=='TEX_IMAGE' and node.image)
    # Re-encode scaled pixels before packing. Reusing the imported packed bytes
    # would silently leave the original high resolution image in the GLB.
    with tempfile.TemporaryDirectory(prefix='banana-tripo-textures-') as directory:
        for index,image in enumerate(sorted(images,key=lambda value:value.name)):
            width,height=image.size
            scale=min(1,texture_size/max(width,height))
            image.scale(max(1,round(width*scale)),max(1,round(height*scale)))
            # Generated opaque maps are JPEG. Keep that encoding rather than
            # expanding painted texture noise into a large lossless PNG.
            # Existing PNGs retain alpha for foliage/impostor cutouts.
            format='JPEG' if image.file_format=='JPEG' else 'PNG'
            extension='jpg' if format=='JPEG' else 'png'
            filename='basecolor-'+str(index)+'.'+extension
            image.file_format=format
            image.filepath_raw=str(Path(directory)/filename)
            image.save()
            encoded=Path(image.filepath_raw).read_bytes()
            image.pack(data=encoded,data_len=len(encoded))
            image.filepath='//textures/'+filename
    for image in list(bpy.data.images):
        if image not in images:
            bpy.data.images.remove(image,do_unlink=True)
    return [{'name':image.name,'size':list(image.size)} for image in sorted(images,key=lambda value:value.name)]


def prepare_asset(item):
    import bpy
    from mathutils import Vector

    if not bpy.app.background:
        raise RuntimeError('Run prepare-static.py in an independent headless Blender process')
    source=item['source'];source_hash=sha256(source)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system='METRIC'
    bpy.context.scene.unit_settings.scale_length=1
    bpy.ops.import_scene.gltf(filepath=str(source))
    meshes=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
    if not meshes or any(obj.type=='ARMATURE' for obj in bpy.context.scene.objects):
        raise ValueError('Expected static mesh objects in '+str(source))
    worlds=[obj.matrix_world.copy() for obj in meshes]
    bpy.ops.object.select_all(action='DESELECT')
    for obj,world in zip(meshes,worlds):
        obj.parent=None;obj.matrix_world=world;obj.hide_set(False);obj.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0]
    if len(meshes)>1:
        bpy.ops.object.join()
    obj=bpy.context.view_layer.objects.active
    obj.animation_data_clear()
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    for other in list(bpy.data.objects):
        if other!=obj:
            bpy.data.objects.remove(other,do_unlink=True)
    obj.name=item['root']+'_Mesh'
    obj.rotation_mode='XYZ'
    obj.rotation_euler=[math.radians(value) for value in item['rotationDegrees']]
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
    source_triangles=triangle_count(obj.data)
    # glTF splits vertex indices at UV/normal seams. Collapsing each open side
    # independently pulls coincident boundaries apart into visible dark cracks.
    # Weld geometry first; Blender keeps the per-corner UVs and material slots.
    source_vertices=len(obj.data.vertices)
    merge_threshold=max(1e-8,max(obj.dimensions)*4e-7)
    weld=obj.modifiers.new('Tripo_Weld_Coincident_Seams','WELD')
    weld.merge_threshold=merge_threshold
    bpy.ops.object.modifier_apply(modifier=weld.name)
    obj.data.validate(clean_customdata=False)
    welded_vertices=source_vertices-len(obj.data.vertices)
    triangles=triangle_count(obj.data)
    for attempt in range(3):
        if triangles<=item['triangleBudget']:
            break
        modifier=obj.modifiers.new('Tripo_RuntimeBudget','DECIMATE')
        modifier.ratio=min(1,item['triangleBudget']/triangles*.995)
        modifier.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        triangles=triangle_count(obj.data)
    # Collapsing seam vertices may leave a degenerate polygon that glTF would
    # discard. Validate it before counting/saving so native and GLB agree.
    obj.data.validate(clean_customdata=False)
    triangles=triangle_count(obj.data)
    if not 0<triangles<=item['triangleBudget']:
        raise ValueError(f"Cannot satisfy triangle budget for {item['id']}: {triangles} / {item['triangleBudget']}")
    bpy.context.view_layer.update()
    if any(dimension<1e-8 for dimension in obj.dimensions):
        raise ValueError('Cannot fit a source with a zero dimension: '+item['id'])
    obj.scale=[target/actual for target,actual in zip(item['targetDimensions'],obj.dimensions)]
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bpy.context.view_layer.update()
    corners=[Vector(corner) for corner in obj.bound_box]
    lo=[min(point[axis] for point in corners) for axis in range(3)]
    hi=[max(point[axis] for point in corners) for axis in range(3)]
    obj.location=(-(lo[0]+hi[0])/2,-(lo[1]+hi[1])/2,-lo[2])
    bpy.ops.object.transform_apply(location=True,rotation=False,scale=False)
    if not obj.data.uv_layers:
        raise ValueError('Missing source UVs: '+item['id'])
    textures=simplify_materials(bpy,obj.data,item['textureSize'])
    for color in list(obj.data.color_attributes):
        obj.data.color_attributes.remove(color)
    colors=obj.data.color_attributes.new(name='Color',type='BYTE_COLOR',domain='CORNER')
    colors.data.foreach_set('color',[1.]*(len(colors.data)*4))
    obj.data.color_attributes.active_color_index=0
    obj.data.color_attributes.render_color_index=0
    root=bpy.data.objects.new(item['root'],None)
    bpy.context.scene.collection.objects.link(root)
    obj.parent=root
    provenance={'sourceId':item['id'],'provider':'Tripo','model':'H3.1','sourceSha256':source_hash,
                'sourceTriangles':source_triangles,'triangles':triangles,'triangleBudget':item['triangleBudget'],
                'weldedVertices':welded_vertices,'mergeThreshold':merge_threshold}
    for key,value in provenance.items():
        root[key]=value
    bpy.context.view_layer.update()
    corners=[obj.matrix_world@Vector(corner) for corner in obj.bound_box]
    lo=[min(point[axis] for point in corners) for axis in range(3)]
    hi=[max(point[axis] for point in corners) for axis in range(3)]
    obj.select_set(True);root.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.data.orphans_purge(do_recursive=True)
    for field in ['native','output']:
        item[field].parent.mkdir(parents=True,exist_ok=True)
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(item['native']),check_existing=False)
    bpy.ops.export_scene.gltf(filepath=str(item['output']),export_format='GLB',use_selection=True,
        export_yup=True,export_extras=True,export_vertex_color='ACTIVE',export_animations=False,
        export_skins=False,export_morph=False)
    exported=glb_json(item['output'])
    exported_triangles=sum(exported['accessors'][primitive.get('indices',primitive['attributes']['POSITION'])]['count']//3
        for mesh in exported['meshes'] for primitive in mesh['primitives'])
    if exported_triangles!=triangles or sha256(source)!=source_hash:
        raise RuntimeError('Export triangle drift or source changed during preparation: '+item['id'])
    report={**provenance,'source':str(source),'native':str(item['native']),'output':str(item['output']),
        'boundsBlender':{'min':lo,'max':hi,'dimensions':[b-a for a,b in zip(lo,hi)]},
        'sourceBytes':source.stat().st_size,'nativeBytes':item['native'].stat().st_size,
        'outputBytes':item['output'].stat().st_size,'materials':len(exported.get('materials',[])),'textures':textures}
    print('TRIPO_STATIC_REPORT '+json.dumps(report,sort_keys=True),flush=True)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe',required=True,type=Path)
    parser.add_argument('--only')
    arguments=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    options=parser.parse_args(arguments)
    for item in read_recipe(options.recipe,options.only):
        prepare_asset(item)


if __name__=='__main__':
    main()
