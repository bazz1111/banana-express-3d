"""Render current native hero drafts, never modify the saved authoring source.
--turnaround writes 2048px orthographic REST (not A-pose) sheets with meter grid.
"""
import bpy,math,sys,hashlib,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
snapshot='--snapshot' in sys.argv
source=ROOT/('artifacts/hero-drafts/source/rider-hero.blend' if snapshot else 'assets/blender/rider-hero.blend')
protected=[source,ROOT/('artifacts/hero-drafts/source/riderSkinned.glb' if snapshot else 'assets/export/riderSkinned.glb')]
before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
bpy.ops.wm.open_mainfile(filepath=str(source));turnaround='--turnaround' in sys.argv
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=32 if turnaround else 24
s.render.resolution_x=1536 if turnaround else 900;s.render.resolution_y=2048 if turnaround else 1100;s.render.resolution_percentage=100
s.world.color=(.18,.18,.18);s.view_settings.view_transform='Standard'
for obj in bpy.data.objects:obj.hide_render=obj.name not in ['RiderHeroSkin','RiderDeformRig']
rig=bpy.data.objects['RiderDeformRig'];skin=bpy.data.objects['RiderHeroSkin']
for track in rig.animation_data.nla_tracks:track.mute=True
bpy.ops.object.camera_add();camera=bpy.context.object;s.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=2.45 if turnaround else 2.9
for pos,power,size in [((3,-4,6),700,5),((-4,-1,3),350,4),((1,4,5),900,3)]:
    bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1.8))-o.location).to_track_quat('-Z','Y').to_euler()
folder=ROOT/('assets/reference' if turnaround else 'artifacts/hero-drafts');folder.mkdir(parents=True,exist_ok=True)
annotations=[]
def emission(name,color):
    mat=bpy.data.materials.new(name);mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear();shader=nodes.new('ShaderNodeEmission');shader.inputs['Color'].default_value=(*color,1);shader.inputs['Strength'].default_value=1;out=nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(shader.outputs[0],out.inputs[0]);return mat
line_material=emission('Draft grid',(.10,.10,.10));major_material=emission('Draft major grid',(.16,.16,.16));ink=emission('Draft labels',(.75,.75,.75))
def sheet(target):
    direction=(Vector(target)-camera.location).normalized();right=camera.rotation_euler.to_quaternion()@Vector((1,0,0));up=Vector((0,0,1));center=Vector(target)
    def at(x,z,front=False):return center+right*x+up*z+direction*(-.8 if front else .85)
    def line(a,b,material,width=.0007):
        data=bpy.data.curves.new('DraftGuide','CURVE');data.dimensions='3D';data.bevel_depth=width;data.bevel_resolution=0
        spline=data.splines.new('POLY');spline.points.add(1);spline.points[0].co=(*a,1);spline.points[1].co=(*b,1)
        o=bpy.data.objects.new('DraftGuide',data);s.collection.objects.link(o);data.materials.append(material);annotations.append(o)
    def text(label,x,z,size=.034):
        data=bpy.data.curves.new('DraftLabel','FONT');data.body=label;data.size=size;data.align_x='LEFT';data.extrude=.0003
        o=bpy.data.objects.new('DraftLabel',data);s.collection.objects.link(o);o.location=at(x,z,True);o.rotation_euler=camera.rotation_euler;data.materials.append(ink);annotations.append(o)
    # Camera-aligned plane: each minor interval is exactly .1 Blender meter.
    for i in range(-9,10):line(at(i*.1,-1.1),at(i*.1,1.1),major_material if i%5==0 else line_material)
    for i in range(-11,12):line(at(-.9,i*.1),at(.9,i*.1),major_material if i%5==0 else line_material)
    line(at(.78,-.9,True),at(.78,.1,True),ink,.0018)
    for i in range(11):line(at(.76,-.9+i*.1,True),at(.80,-.9+i*.1,True),ink,.001)
    text('1 m',.65,-.98,.041);text('10 cm grid | orthographic | Blender meters',-.84,-1.105,.031)
    return text
if turnaround:
    cases=[('front',None,0,(0,-6,1.96),(0,0,1.96),'REST FRONT'),('side',None,0,(6,0,1.96),(0,0,1.96),'REST SIDE'),('rear',None,0,(0,6,1.96),(0,0,1.96),'REST REAR'),('front-three-quarter',None,0,(4,-6,1.96),(0,0,1.96),'REST FRONT 3/4'),('rear-three-quarter',None,0,(4,6,1.96),(0,0,1.96),'REST REAR 3/4'),('seated-side','Rider_Ride_SeatedPedal',0,(6,0,1.22),(0,0,1.22),'SEATED SIDE / CRANK 0')]
else:
    cases=[('front','Rider_Ride_StandingBalance',0,(0,-6,2),(0,0,1.9),'standing'),('rear','Rider_Ride_StandingBalance',0,(0,6,2),(0,0,1.9),'standing'),('seated','Rider_Ride_SeatedPedal',15,(4,-6,3),(0,0,1.45),'seated'),('strike','Rider_Kick_Strike_R',21,(4,6,3),(0,0,1.4),'strike')]
selected_views=next((arg.split('=',1)[1].split(',') for arg in sys.argv if arg.startswith('--views=')),None)
if selected_views:cases=[case for case in cases if case[0] in selected_views]
outputs=[]
for name,action,frame,pos,target,label in cases:
    for ob in annotations:bpy.data.objects.remove(ob,do_unlink=True)
    annotations=[];rig.animation_data.action=bpy.data.actions[action] if action else None
    if not action:
        for bone in rig.pose.bones:bone.location=(0,0,0);bone.rotation_quaternion=(1,0,0,0);bone.scale=(1,1,1)
    s.frame_set(frame);bpy.context.view_layer.update();camera.location=pos;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    if turnaround:
        text=sheet(target);text('RIDER / '+label,-.84,1.10,.047);text('CURRENT IMPLEMENTATION DRAFT - NOT USER APPROVED',-.84,1.045,.026)
        text('Bicycle-support rest pose; no authored A-pose' if not action else 'Authored seated action; bicycle omitted',-.84,.99,.029)
        text('Shoulders 54 cm | thigh 54 cm | shin 48 cm',-.84,-1.045,.031)
    filename=('ref_char_rider-turnaround_v01_'+name if turnaround else name)+'.png';s.render.filepath=str(folder/filename);bpy.ops.render.render(write_still=True);outputs.append(str((folder/filename).relative_to(ROOT)))
assert before=={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in protected},'Rendering must not mutate hero source or GLB'
if turnaround:
    (ROOT/'artifacts/hero-turnaround-draft-report.json').write_text(json.dumps({'status':'rendered implementation draft, not independent art approval','source':str(source.relative_to(ROOT)),'canonicalSource':'assets/blender/rider-hero.blend','sourceSnapshot':snapshot,'pose':'Bicycle-support rest; no authored A-pose is claimed','orthographic':True,'heightPixels':2048,'gridMeters':.1,'scaleMeters':1,'outputs':[str(p.relative_to(ROOT)) for p in sorted(folder.glob('ref_char_rider-turnaround_v01_*.png'))],'renderedViews':outputs,'protectedSha256':before},indent=2)+'\n')
print('HERO_DRAFTS_RENDERED',json.dumps(outputs))
