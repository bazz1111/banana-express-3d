"""Author the collected heap from the actual Tripo bunch, on the new bike rack.

The twenty bundles share four mesh variants. This is a visual capacity of one
hundred fruit; the endless game continues counting pickups beyond it.
"""
import argparse
import hashlib
import json
from math import radians
from pathlib import Path
import sys

import bpy
from mathutils import Euler, Matrix, Vector

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir',type=Path,default=ROOT/'artifacts/tripo-cargo')
parser.add_argument('--mount',default='0,.6763139963,.7969864607',help='Measured Bicycle CargoMount in Blender metres')
options=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if not bpy.app.background:raise RuntimeError('Use an independent headless Blender')
source=ROOT/'assets/blender/tripo/banana-bunch.blend'
before=hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(source))
original=next(o for o in bpy.context.scene.objects if o.type=='MESH')
source_hash=original.parent['sourceSha256']
mesh=original.data.copy()
materials=list(mesh.materials)
for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
mount=Vector([float(v) for v in options.mount.split(',')])
if len(mount)!=3:raise ValueError('Expected three mount coordinates')
scene=bpy.context.scene

def empty(name):
    obj=bpy.data.objects.new(name,None);scene.collection.objects.link(obj)
    obj['provider']='Tripo';obj['model']='H3.1';obj['sourceId']='banana-bunch';obj['sourceSha256']=source_hash
    return obj

variants=[]
for i,(scale,angles) in enumerate(zip([.76,.82,.72,.78],[(0,0,-8),(-18,22,16),(22,-26,28),(12,-18,-22)])):
    data=mesh.copy();data.name=f'TripoCargoBunchVariant{i}'
    data.transform(Euler(tuple(radians(angle) for angle in angles)).to_matrix().to_4x4()@Matrix.Scale(scale,4))
    low=Vector([min(v.co[axis] for v in data.vertices) for axis in range(3)])
    high=Vector([max(v.co[axis] for v in data.vertices) for axis in range(3)])
    data.transform(Matrix.Translation((-(low.x+high.x)/2,-(low.y+high.y)/2,-low.z)))
    variants.append(data)

assembly=empty('CargoAssembly')
root=empty('BananaCargo');root.parent=assembly;root['visualCapacity']=100;root['bundleFruitCount']=5
root['cargoMount']=list(mount);root['derivedFrom']='Four variants of one generated Tripo bunch, arranged in Blender'
bundles=[]
for i in range(20):
    layer=i//6;slot=i%6
    # Broad lower courses and a smaller crown leave the saddle and standing foot clear.
    spread=[.35,.29,.21][layer] if layer<3 else .13
    x=mount.x+([0,-spread,spread][slot%3] if layer<3 else [-spread,spread][slot%2])
    rows=[[-.04,.20],[-.015,.17],[.01,.13]]
    y=mount.y+(rows[layer][slot//3] if layer<3 else .07)
    z=mount.z+[0,.105,.205,.25][layer]
    obj=bpy.data.objects.new(f'CargoBundle{i:02}',variants[i%4]);scene.collection.objects.link(obj)
    obj.parent=root;obj.location=(x,y,z);obj.rotation_euler.z=radians([-6,4,10,-3,7,-9][slot])
    obj['globalBundleIndex']=i;obj['variant']=i%4;bundles.append(obj)

# Tie-downs are a small Blender finishing detail on the generated cargo. They
# appear only once the upper courses are populated, never around an empty rack.
ties=empty('CargoTieDowns');ties.parent=assembly;ties['localFinishing']='Blender tie-down curves on the Tripo cargo'
rope_material=bpy.data.materials.new('CargoRope_HandpaintedBrown');rope_material.use_nodes=True
bsdf=next(n for n in rope_material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
bsdf.inputs['Base Color'].default_value=(1,1,1,1);bsdf.inputs['Roughness'].default_value=.95
vertex=rope_material.node_tree.nodes.new('ShaderNodeVertexColor');vertex.layer_name='Color'
rope_material.node_tree.links.new(vertex.outputs['Color'],bsdf.inputs['Base Color'])
rope_objects=[]
for y in [mount.y+.06,mount.y+.17]:
    curve=bpy.data.curves.new('CargoTieDownCurve','CURVE');curve.dimensions='3D'
    curve.bevel_depth=.007;curve.bevel_resolution=1;curve.resolution_u=4
    points=[(-.16,.775),(-.57,1.02),(-.43,1.23),(-.17,1.37),(.17,1.37),(.43,1.23),(.57,1.02),(.16,.775)]
    spline=curve.splines.new('BEZIER');spline.bezier_points.add(len(points)-1);spline.use_cyclic_u=True
    for point,(x,z) in zip(spline.bezier_points,points):
        point.co=(x,y,z+(mount.z-.8005434275));point.handle_left_type=point.handle_right_type='AUTO'
    obj=bpy.data.objects.new('CargoTieDown',curve);scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH');rope_objects.append(bpy.context.object)
bpy.ops.object.select_all(action='DESELECT')
for obj in rope_objects:obj.select_set(True)
bpy.context.view_layer.objects.active=rope_objects[0];bpy.ops.object.join()
rope=bpy.context.object;rope.name='CargoTieDownMesh';rope.parent=ties;rope.data.materials.append(rope_material)
colors=rope.data.color_attributes.new(name='Color',type='BYTE_COLOR',domain='CORNER')
colors.data.foreach_set('color',[.18,.105,.047,1]*len(colors.data))
rope.data.color_attributes.active_color_index=rope.data.color_attributes.render_color_index=0

for name,data in zip(['Banana','BananaB','BananaC','BananaD'],variants):
    prototype=empty(name)
    obj=bpy.data.objects.new(name+'Mesh',data);scene.collection.objects.link(obj);obj.parent=prototype

bpy.context.view_layer.update()
points=[o.matrix_world@Vector(p) for o in bundles for p in o.bound_box]
lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
if lo[2]<mount.z-1e-5 or lo[1]<.40:raise ValueError('Heap intersects the rack or saddle clearance zone')
if hi[2]>1.60 or hi[0]-lo[0]>1.30:raise ValueError('Heap exceeds the rider silhouette budget')
if len({id(o.data) for o in bundles})!=4:raise ValueError('Heap lost its shared variants')
output=options.output_dir.resolve();output.mkdir(parents=True,exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(output/'cargo.blend'))
for name,obj in [('bananaRack',assembly)]+[(n[0].lower()+n[1:],bpy.data.objects[n]) for n in ['Banana','BananaB','BananaC','BananaD']]:
    bpy.ops.object.select_all(action='DESELECT')
    for child in [obj,*obj.children_recursive]:child.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.export_scene.gltf(filepath=str(output/(name+'.glb')),export_format='GLB',use_selection=True,
        export_yup=True,export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_animations=False)
assert hashlib.sha256(source.read_bytes()).hexdigest()==before
report={'sourceNativeSha256':before,'sourceMasterSha256':source_hash,'mount':list(mount),
    'bundles':len(bundles),'sharedVariants':4,'boundsBlender':{'min':lo,'max':hi},'localFinishing':'Two Blender tie-down loops; visible above 80 pickups',
    'nativeBytes':(output/'cargo.blend').stat().st_size}
(output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print('TRIPO_CARGO_REPORT '+json.dumps(report),flush=True)
