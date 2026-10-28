"""Render HUD icons from the same saved Tripo meshes used by the game."""
import argparse
import hashlib
from pathlib import Path
import sys

import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--only',default='banana-bunch,boost,shield,double')
parser.add_argument('--out-dir',type=Path,default=ROOT/'public/ui')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if not bpy.app.background:raise RuntimeError('Use an independent headless Blender')
args.out_dir.mkdir(parents=True,exist_ok=True)
for asset in args.only.split(','):
    source=ROOT/'assets/blender/tripo'/f'{asset}.blend'
    before=hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene=bpy.context.scene
    points=[o.matrix_world@Vector(p) for o in scene.objects if o.type=='MESH' for p in o.bound_box]
    low=Vector([min(p[i] for p in points) for i in range(3)])
    high=Vector([max(p[i] for p in points) for i in range(3)])
    center=(low+high)/2;size=max(high-low)
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    scene.render.resolution_x=192;scene.render.resolution_y=192;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.render.film_transparent=True;scene.view_settings.view_transform='Standard'
    scene.world=scene.world or bpy.data.worlds.new('UIWorld');scene.world.use_nodes=True
    next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND').inputs['Strength'].default_value=.65
    for offset,power in [((1,-2,3),110),((-2,-1,1),55)]:
        bpy.ops.object.light_add(type='AREA',location=center+Vector(offset)*size)
        lamp=bpy.context.object;lamp.data.energy=power*size*size;lamp.data.size=size*2
        lamp.rotation_euler=(center-lamp.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=center+Vector((.5,-2,.55))*size)
    camera=bpy.context.object;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=size*1.18;scene.camera=camera
    scene.render.filepath=str(args.out_dir/('banana.png' if asset=='banana-bunch' else asset+'.png'))
    bpy.ops.render.render(write_still=True)
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before
    print('TRIPO_UI_PASS '+asset,flush=True)
