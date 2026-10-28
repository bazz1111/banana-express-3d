"""Give floating collectibles a centre origin matching their collision height."""
import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Matrix,Vector

ROOT=Path(__file__).resolve().parents[2]
if not bpy.app.background:raise RuntimeError('Use an independent headless Blender')
bpy.ops.wm.read_factory_settings(use_empty=True)
mapping={'looseBanana':('banana-single','TripoBananaSingle'),
    'boost':('boost','TripoBoost'),'shield':('shield','TripoShield'),'double':('double','TripoDouble')}
before={};report={}
for key,(id,root_name) in mapping.items():
    source=ROOT/'assets/blender/tripo'/f'{id}.blend'
    before[source]=hashlib.sha256(source.read_bytes()).hexdigest()
    with bpy.data.libraries.load(str(source),link=False) as (available,loaded):loaded.objects=available.objects
    objects=[obj for obj in loaded.objects if obj]
    for obj in objects:bpy.context.scene.collection.objects.link(obj)
    root=next(obj for obj in objects if obj.name==root_name)
    mesh=next(obj for obj in objects if obj.type=='MESH');mesh.name=root_name+'Mesh'
    points=[v.co for v in mesh.data.vertices]
    low=Vector([min(p[i] for p in points) for i in range(3)])
    high=Vector([max(p[i] for p in points) for i in range(3)])
    mesh.data.transform(Matrix.Translation(-(low+high)/2))
    root['originRole']='centre of floating collectible and pickup collision'
    report[key]={'root':root_name,'sourceId':id,'sourceSha256':root['sourceSha256'],'sourceNativeSha256':before[source]}
output=ROOT/'artifacts/tripo-pickups';output.mkdir(parents=True,exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(output/'pickups.blend'))
for key,(_,name) in mapping.items():
    bpy.ops.object.select_all(action='DESELECT');root=bpy.data.objects[name]
    for obj in [root,*root.children_recursive]:obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(output/(key+'.glb')),export_format='GLB',use_selection=True,
        export_yup=True,export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_animations=False)
assert all(hashlib.sha256(path.read_bytes()).hexdigest()==value for path,value in before.items())
(output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print('TRIPO_PICKUPS_PASS',flush=True)
