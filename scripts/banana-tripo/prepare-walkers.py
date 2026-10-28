"""Separate textured Tripo obstacle legs at their natural limb pivots.

This preserves every prepared source face and the imported corner UV/color
layers. Only the independent leg pieces are rotated by the existing crossing
animation; obstacle motion and collision remain governed by game.ts.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir',type=Path,default=ROOT/'artifacts/tripo-walkers')
options=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if not bpy.app.background:raise RuntimeError('Use an independent headless Blender')
output=options.output_dir.resolve();output.mkdir(parents=True,exist_ok=True)
reports={}
for name in ['pedestrian','goat']:
    source=ROOT/'assets/blender/tripo'/f'{name}.blend'
    before=hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    mesh_obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    original_root=mesh_obj.parent
    props={key:original_root[key] for key in ['sourceId','provider','model','sourceSha256']}
    mesh_obj.data.calc_loop_triangles();source_triangles=len(mesh_obj.data.loop_triangles)
    groups={}
    for polygon in mesh_obj.data.polygons:
        x,y,z=polygon.center
        if name=='pedestrian':
            tag='PedLeg_'+('L' if x<0 else 'R') if z<.91 else 'PedBody'
        else:
            tag='GoatLeg_'+('Front' if y<0 else 'Rear')+'_'+('L' if x<0 else 'R') if z<.335 else 'GoatBody'
        groups.setdefault(tag,[]).append(polygon.index)
    expected=3 if name=='pedestrian' else 5
    if len(groups)!=expected or any(len(faces)<15 for faces in groups.values()):
        raise ValueError('Source lacks distinct body and leg geometry: '+name)
    root=bpy.data.objects.new('Pedestrian' if name=='pedestrian' else 'Goat',None)
    bpy.context.scene.collection.objects.link(root)
    for key,value in props.items():root[key]=value
    root['derivedFrom']='Tripo source face partition; crossing legs animated around measured pivots'
    made=[]
    for tag,indices in groups.items():
        keep=set(indices);bm=bmesh.new();bm.from_mesh(mesh_obj.data);bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[face for face in bm.faces if face.index not in keep],context='FACES')
        mesh=bpy.data.meshes.new(tag+'Mesh');bm.to_mesh(mesh);bm.free()
        for material in mesh_obj.data.materials:mesh.materials.append(material)
        points=[vertex.co for vertex in mesh.vertices]
        pivot=Vector((0,0,0))
        if 'Leg_' in tag:
            top=max(p.z for p in points)
            near=[p for p in points if p.z>top-.04]
            pivot=Vector((sum(p.x for p in near)/len(near),sum(p.y for p in near)/len(near),top))
        mesh.transform(Matrix.Translation(-pivot))
        obj=bpy.data.objects.new(tag,mesh);bpy.context.scene.collection.objects.link(obj)
        obj.parent=root;obj.location=pivot;obj['sourceFaceCount']=len(indices)
        made.append(obj)
    for obj in [mesh_obj,original_root]:bpy.data.objects.remove(obj,do_unlink=True)
    bpy.context.view_layer.update();bpy.ops.object.select_all(action='DESELECT')
    for obj in [root,*made]:obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    for obj in made:
        obj.data.validate(clean_customdata=False);obj.data.calc_loop_triangles()
        if not obj.data.uv_layers or not obj.data.color_attributes.get('Color'):
            raise ValueError('Source UV/color layer lost: '+obj.name)
    triangles=sum(len(obj.data.loop_triangles) for obj in made)
    if triangles!=source_triangles:raise ValueError('Source face coverage changed: '+name)
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(output/(name+'.blend')))
    bpy.ops.export_scene.gltf(filepath=str(output/(name+'.glb')),export_format='GLB',use_selection=True,
        export_yup=True,export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_animations=False)
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before
    reports[name]={'sourceNativeSha256':before,'sourceMasterSha256':props['sourceSha256'],
        'sourceTriangles':source_triangles,'triangles':triangles,'parts':[
            {'name':obj.name,'pivot':list(obj.location),'sourceFaces':obj['sourceFaceCount']} for obj in made]}
(output/'report.json').write_text(json.dumps(reports,indent=2)+'\n')
print('TRIPO_WALKERS_REPORT '+json.dumps(reports),flush=True)
