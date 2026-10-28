"""Center the generated impact star and add small Blender particle carriers.

The star uses actual Tripo geometry, UVs and paint. Dust/spark carriers are
technical effect meshes, documented separately from generated game objects.
"""
import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Matrix,Vector

ROOT=Path(__file__).resolve().parents[2]
if not bpy.app.background:raise RuntimeError('Use an independent headless Blender')
source=ROOT/'assets/blender/tripo/impact-star.blend'
before=hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(source))
original=next(o for o in bpy.context.scene.objects if o.type=='MESH')
props={key:original.parent[key] for key in ['sourceId','provider','model','sourceSha256']}
data=original.data.copy()
low=Vector([min(v.co[i] for v in data.vertices) for i in range(3)])
high=Vector([max(v.co[i] for v in data.vertices) for i in range(3)])
data.transform(Matrix.Scale(.4,4)@Matrix.Translation(-(low+high)/2))
for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
scene=bpy.context.scene
for name in ['KickBurst','KickBurstGlow']:
    root=bpy.data.objects.new(name,None);scene.collection.objects.link(root)
    for key,value in props.items():root[key]=value
    root['derivation']='Tripo impact star centered and uniformly scaled in Blender'
    obj=bpy.data.objects.new(name+'Mesh',data);scene.collection.objects.link(obj);obj.parent=root

def particles(name,rgba,emission=0,radius=1):
    root=bpy.data.objects.new(name,None);scene.collection.objects.link(root)
    root['geometryProvider']='Blender technical particle carrier';root['purpose']='Transient effect, not a generated prop'
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=radius)
    obj=bpy.context.object;obj.name=name+'Mesh';obj.parent=root
    obj.scale=(1,1,.7);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    material=bpy.data.materials.new(name+'Palette');material.use_nodes=True
    bsdf=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value=(1,1,1,1);bsdf.inputs['Roughness'].default_value=1
    bsdf.inputs['Alpha'].default_value=rgba[3]
    if emission:
        bsdf.inputs['Emission Color'].default_value=rgba;bsdf.inputs['Emission Strength'].default_value=emission
    vertex=material.node_tree.nodes.new('ShaderNodeVertexColor');vertex.layer_name='Color'
    material.node_tree.links.new(vertex.outputs['Color'],bsdf.inputs['Base Color'])
    obj.data.materials.append(material)
    colors=obj.data.color_attributes.new(name='Color',type='BYTE_COLOR',domain='CORNER')
    colors.data.foreach_set('color',list(rgba)*len(colors.data))
    obj.data.color_attributes.active_color_index=obj.data.color_attributes.render_color_index=0
    return root

particles('Dust',(.53,.28,.10,.45))
particles('Spark',(1,.74,.16,1),.65,.12)
output=ROOT/'artifacts/tripo-effects';output.mkdir(parents=True,exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(output/'effects.blend'))
mapping={'burst':'KickBurst','burstGlow':'KickBurstGlow','dust':'Dust','spark':'Spark'}
for key,name in mapping.items():
    bpy.ops.object.select_all(action='DESELECT');root=bpy.data.objects[name]
    for obj in [root,*root.children_recursive]:obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(output/(key+'.glb')),export_format='GLB',use_selection=True,
        export_yup=True,export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_animations=False)
assert hashlib.sha256(source.read_bytes()).hexdigest()==before
(output/'report.json').write_text(json.dumps({'sourceNativeSha256':before,'sourceMasterSha256':props['sourceSha256'],
    'models':mapping,'technicalCarriers':['dust','spark'],'impactDimensions':[float(v)*.4 for v in high-low]},indent=2)+'\n')
print('TRIPO_EFFECTS_PASS',flush=True)
