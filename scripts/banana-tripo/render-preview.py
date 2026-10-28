"""Render a saved asset for visual QA without saving changes to the .blend."""
import argparse
import hashlib
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('id')
parser.add_argument('--native',type=Path)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
source=args.native or ROOT/'assets/blender/tripo'/f'{args.id}.blend'
before=hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(source))
scene=bpy.context.scene
meshes=[o for o in scene.objects if o.type=='MESH']
points=[o.matrix_world@Vector(p) for o in meshes for p in o.bound_box]
lo=Vector([min(p[i] for p in points) for i in range(3)])
hi=Vector([max(p[i] for p in points) for i in range(3)])
center=(lo+hi)/2
size=max(hi-lo)
scene.render.engine='CYCLES'
scene.cycles.samples=16
scene.cycles.use_denoising=True
scene.render.resolution_x=1200
scene.render.resolution_y=900
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='Standard'
scene.world=scene.world or bpy.data.worlds.new('AssetQAWorld')
scene.world.use_nodes=True
background=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND')
background.inputs['Color'].default_value=(.40,.49,.53,1)
background.inputs['Strength'].default_value=.7
for offset,power in [((1.5,-2,3),150),((-2,-1,1),70),((1,2,2),100)]:
    bpy.ops.object.light_add(type='AREA',location=center+Vector(offset)*size)
    lamp=bpy.context.object
    lamp.data.energy=power*size*size
    lamp.data.size=size*2
    lamp.rotation_euler=(center-lamp.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add()
camera=bpy.context.object
scene.camera=camera
camera.data.type='ORTHO'
camera.data.ortho_scale=size*1.35
output=ROOT/'artifacts/tripo-previews'
output.mkdir(parents=True,exist_ok=True)
for name,offset in [('front',(1.2,-2,1)),('side',(2,0,.45)),('rear',(1.2,2,1))]:
    camera.location=center+Vector(offset)*size
    camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(output/f'{args.id}-{name}.png')
    bpy.ops.render.render(write_still=True)
assert hashlib.sha256(source.read_bytes()).hexdigest()==before
print('TRIPO_PREVIEW_PASS',args.id,flush=True)
