"""Split the actual Tripo truck for the game's existing debris interface.

Run headless Blender with --python-exit-code 1. Outputs remain candidates.
Every original face stays in exactly one part; cargo derives from the new crate.
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
parser.add_argument('--output-dir',type=Path,default=ROOT/'artifacts/tripo-truck')
options=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if not bpy.app.background:raise RuntimeError('Use an independent headless Blender')
sources={name:ROOT/'assets/blender/tripo'/f'{name}.blend' for name in ['truck','crate']}
for source in sources.values():
    if not source.is_file():raise FileNotFoundError(source)
before={name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in sources.items()}
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'

def append_source(name):
    with bpy.data.libraries.load(str(sources[name]),link=False) as (source,destination):
        destination.objects=source.objects
    objects=[o for o in destination.objects if o]
    for obj in objects:scene.collection.objects.link(obj)
    meshes=[o for o in objects if o.type=='MESH']
    if len(meshes)!=1:raise ValueError('Expected one prepared source mesh: '+name)
    return objects,meshes[0]

truck_objects,source=append_source('truck')
source.data.validate(clean_customdata=False)
source.data.calc_loop_triangles()
source_triangles=len(source.data.loop_triangles)
source.data.update()
groups={name:[] for name in ['Cab','Bed','Tarp','Door_L','Door_R','Tailgate',
    'Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR']}
for face in source.data.polygons:
    x,y,z=face.center
    axle=min([-1.55,.72,1.70],key=lambda cy:abs(y-cy))
    if abs(x)>.88 and z<.94 and (y-axle)**2+(z-.44)**2<.51**2:
        name=('Wheel_F' if axle<0 else 'Wheel_R')+('L' if x<0 else 'R')
    elif abs(x)>.94 and -1.55<y<-.53 and .88<z<1.84 and abs(face.normal.x)>.35:
        name='Door_L' if x<0 else 'Door_R'
    elif y>2.28 and .80<z<1.67 and face.normal.y>.25:name='Tailgate'
    elif y>-.70 and z>1.53:name='Tarp'
    else:name='Cab' if y<-.63 else 'Bed'
    groups[name].append(face.index)
if any(not faces for faces in groups.values()):
    raise ValueError('Empty truck part: '+','.join(name for name,faces in groups.items() if not faces))
if sum(map(len,groups.values()))!=len(source.data.polygons):raise ValueError('Truck face partition drift')
root=bpy.data.objects.new('Truck',None)
scene.collection.objects.link(root)
for obj in truck_objects:
    for key in ['sourceId','provider','model','sourceSha256']:
        if key in obj:root[key]=obj[key]
root['derivedFrom']='Tripo H3.1 truck + Tripo H3.1 crate; local Blender face partition'
parts=[]

def part(name,data,position,breakaway=False,mass=1.):
    obj=bpy.data.objects.new('TruckPart_'+name,data)
    scene.collection.objects.link(obj)
    obj.parent=root
    obj.location=position
    points=[Vector(c) for c in obj.bound_box]
    half=[max(.015,(max(p[i] for p in points)-min(p[i] for p in points))/2) for i in range(3)]
    obj['breakaway']=breakaway
    obj['mass']=mass
    obj['halfExtents']=half
    parts.append(obj)
    return obj

for name,indices in groups.items():
    keep=set(indices)
    mesh=bpy.data.meshes.new('TripoTruck_'+name)
    bm=bmesh.new()
    bm.from_mesh(source.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.index not in keep],context='FACES')
    bm.to_mesh(mesh)
    bm.free()
    for material in source.data.materials:mesh.materials.append(material)
    points=[v.co for v in mesh.vertices]
    pivot=Vector([(min(p[i] for p in points)+max(p[i] for p in points))/2 for i in range(3)])
    mesh.transform(Matrix.Translation(-pivot))
    obj=part(name,mesh,pivot,name in ['Door_L','Door_R','Tailgate'],2. if name=='Tailgate' else 1.)
    obj['sourceFaceCount']=len(indices)
    if obj['breakaway']:
        bpy.context.view_layer.objects.active=obj
        obj.select_set(True)
        solid=obj.modifiers.new('PanelThickness','SOLIDIFY')
        solid.thickness=.012
        bpy.ops.object.modifier_apply(modifier=solid.name)
        obj.select_set(False)

crate_objects,crate=append_source('crate')
bpy.context.view_layer.objects.active=crate
crate.select_set(True)
crate.data.calc_loop_triangles()
reduce=crate.modifiers.new('CargoCrateLOD','DECIMATE')
reduce.ratio=min(1,300/max(1,len(crate.data.loop_triangles))*.995)
reduce.use_collapse_triangulate=True
bpy.ops.object.modifier_apply(modifier=reduce.name)
crate.data.validate(clean_customdata=False)
crate.data.transform(Matrix.Diagonal(Vector((.45,.54,.65,1))))
for i in range(6):
    obj=part(f'Crate_{i+1:02}',crate.data,Vector((-.48 if i%2==0 else .48,-.10+(i//2)*.85,.98)),True,.55)
    obj['sourceId']='crate'
    obj['sourceSha256']=next(o['sourceSha256'] for o in crate_objects if 'sourceSha256' in o)
for obj in truck_objects+crate_objects:bpy.data.objects.remove(obj,do_unlink=True)
bpy.context.view_layer.update()
# Physics places a fragment body at its mesh origin. Centre every shared mesh
# once, moving all of its instances equally so the intact truck does not change.
for mesh in {obj.data for obj in parts}:
    points=[v.co for v in mesh.vertices]
    lo=Vector([min(p[i] for p in points) for i in range(3)])
    hi=Vector([max(p[i] for p in points) for i in range(3)])
    center=(lo+hi)/2;mesh.transform(Matrix.Translation(-center))
    for obj in parts:
        if obj.data==mesh:obj.location+=center
    half=(hi-lo)/2
    for obj in parts:
        if obj.data==mesh:
            obj['halfExtents']=[max(.015,half.x),max(.015,half.z),max(.015,half.y)]
            obj['halfExtentsSpace']='glTF Y-up metres'
bpy.context.view_layer.update()
for obj in parts:
    obj.data.validate(clean_customdata=False)
    if not obj.data.uv_layers or not obj.data.polygons:raise ValueError('Invalid part geometry: '+obj.name)
    if not obj.data.color_attributes.get('Color'):raise ValueError('Missing native color layer: '+obj.name)
    obj.select_set(True)
root.select_set(True)
bpy.context.view_layer.objects.active=root
triangles=0
for obj in parts:
    obj.data.calc_loop_triangles()
    triangles+=len(obj.data.loop_triangles)
if triangles>30000:raise ValueError('Truck exceeds 30k primary asset budget')
root['triangles']=triangles
root['sourceTrianglesPrepared']=source_triangles
root['partCount']=len(parts)
output=options.output_dir.resolve()
if (output/'truck.blend') in [p.resolve() for p in sources.values()]:
    raise ValueError('Refusing to overwrite a source native')
output.mkdir(parents=True,exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(output/'truck.blend'))
bpy.ops.export_scene.gltf(filepath=str(output/'truck.glb'),export_format='GLB',use_selection=True,
    export_yup=True,export_extras=True,export_vertex_color='ACTIVE',export_animations=False)
if before!={name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in sources.items()}:
    raise RuntimeError('Truck preparation changed a source native')
report={'sourceHashes':before,'sourceTriangles':source_triangles,'triangles':triangles,
    'sourceFaceCoverage':sum(len(f) for f in groups.values()),'parts':[
        {'name':o.name,'triangles':len(o.data.loop_triangles),'breakaway':o['breakaway'],
         'position':list(o.location),'halfExtents':list(o['halfExtents'])} for o in parts]}
(output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print('TRIPO_TRUCK_REPORT '+json.dumps(report),flush=True)
