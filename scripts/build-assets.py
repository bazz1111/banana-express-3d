"""Run ONLY inside local Blender: blender --background --python scripts/build-assets.py."""
import bpy
import math
import random
import json
import hashlib
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'assets'
SOURCE = ROOT / 'assets' / 'blender'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
random.seed(28)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'

COLORS = {
    'black': (0.035, .045, .053, 1), 'rubber': (.024, .028, .031, 1),
    'steel': (.43, .49, .49, 1), 'skin': (.16, .07, .037, 1),
    'red': (.80, .036, .018, 1), 'blue': (.035, .09, .32, 1),
    'yellow': (.95, .44, .006, 1), 'banana': (1, .63, .018, 1),
    'stem': (.22, .115, .035, 1), 'cream': (.89, .84, .65, 1),
    'rope': (.13, .115, .043, 1),
    'glass': (.16, .43, .56, 1), 'olive': (.34, .39, .17, 1),
    'green': (.12, .36, .045, 1), 'leaf': (.28, .50, .065, 1),
    'wood': (.38, .19, .065, 1), 'roof': (.66, .21, .095, 1),
    'white': (.95, .94, .83, 1), 'dust': (.78, .45, .22, 1),
}
mat = bpy.data.materials.new('Arcade_VertexPalette')
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Roughness'].default_value = .88
vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Color'
mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
metal = mat.copy()
metal.name = 'Roadster_WeatheredChrome'
metal_bsdf = next(n for n in metal.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
metal_bsdf.inputs['Metallic'].default_value = .32
metal_bsdf.inputs['Roughness'].default_value = .43

def paint(obj, color):
    rgba = COLORS.get(color, color) if isinstance(color, str) else color
    obj.data.materials.clear()
    obj.data.materials.append(metal if color == 'steel' else mat)
    attr = obj.data.color_attributes.get('Color') or obj.data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    for item in attr.data:
        item.color = rgba
    for face in obj.data.polygons:
        face.use_smooth = False
    return obj

def cube(pos, size, color):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return paint(o, color)

def ico(pos, size, color, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=pos)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return paint(o, color)

def rod(a, b, radius, color, sides=8):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=d.length, location=(a+b)/2)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    return paint(o, color)

def mesh(name, vertices, faces, color):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return paint(obj, color)

def root(name):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    return o

def pack(parts, name, parent, origin=(0,0,0)):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.scene.cursor.location = origin
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    o.parent = parent
    return o

def tire(center, radius, width, spokes=False):
    parts = []
    bpy.ops.mesh.primitive_torus_add(major_segments=40, minor_segments=8,
        major_radius=radius-width*.55, minor_radius=width*.55, location=center,
        rotation=(0, math.pi/2, 0))
    parts.append(paint(bpy.context.object, 'rubber'))
    x,y,z = center
    if spokes:
        bpy.ops.mesh.primitive_torus_add(major_segments=40, minor_segments=6,
            major_radius=radius-width*1.2, minor_radius=.012, location=center,
            rotation=(0, math.pi/2, 0))
        parts.append(paint(bpy.context.object, 'steel'))
        for i in range(32):
            t = i*math.tau/32
            hub=(x+(.025 if i%2 else -.025),y+math.cos(t+.55)*.033,z+math.sin(t+.55)*.033)
            parts.append(rod(hub, (x,y+math.cos(t)*(radius-.04),z+math.sin(t)*(radius-.04)), .0045, 'steel', 5))
        parts.append(rod((x-.045,y,z),(x+.045,y,z),.036,'steel'))
    else:
        parts.append(rod((x-width*.55,y,z),(x+width*.55,y,z),radius*.48,'steel',10))
    return parts

assets = {}

def bicycle():
    r = root('Bicycle')
    rear=(0,.76,.36); front=(0,-.95,.36); bb=(0,-.04,.4)
    seat=(0,.22,1.01); head=(0,-.65,1.02)
    pts=[(rear,bb),(rear,seat),(bb,seat),(seat,head),(head,bb),(head,front)]
    p=[rod(a,b,.025,'black') for a,b in pts]
    for side in [-1,1]:
        p += [rod((side*.08,.76,.36),(side*.08,.22,1.01),.014,'black'),
              rod((side*.07,-.65,1.02),(side*.07,-.95,.36),.019,'black'),
              rod((side*.28,.45,1.00),(side*.07,.76,.36),.012,'steel'),
              rod((side*.28,1.17,1.00),(side*.07,.76,.36),.012,'steel')]
    # Broad leather rear, narrow saddle nose, with the same 1.115 m support top.
    outline=[(-.033,-.08),(.033,-.08),(.105,.04),(.17,.19),(.15,.32),(.085,.40),(-.085,.40),(-.15,.32),(-.17,.19),(-.105,.04)]
    v=[(x,y,z) for z in [1.065,1.107] for x,y in outline]+[(0,.21,1.115)]
    f=[tuple(range(9,-1,-1))]+[(i,(i+1)%10,(i+1)%10+10,i+10) for i in range(10)]+[(20,i+10,(i+1)%10+10) for i in range(10)]
    p.append(mesh('LeatherRoadsterSaddle',v,f,'stem'))
    for side in [-1,1]:
        for j in range(12):
            a=j*math.tau/4;b=(j+1)*math.tau/4
            p.append(rod((side*.11+.026*math.cos(a),.28+.026*math.sin(a),1.011+j*.0045),
                         (side*.11+.026*math.cos(b),.28+.026*math.sin(b),1.011+(j+1)*.0045),.004,'steel',5))
        for y in [.12,.24,.33]:p.append(ico((side*(.162 if y<.3 else .14),y,1.10),(.006,.008,.006),'steel',1))
    p += [rod(seat,(0,.21,1.073),.025,'steel'),
          rod((0,-.64,1.02),(0,-.66,1.17),.026,'steel'),
          rod((-.36,-.65,1.16),(.36,-.65,1.16),.023,'steel'),
          rod((-.36,-.65,1.16),(-.38,-.43,1.16),.033,'black'),
          rod((.36,-.65,1.16),(.38,-.43,1.16),.033,'black'),
          rod((0,.77,.36),(0,.77,.67),.012,'steel'),
          cube((0,1.03,.67),(.13,.035,.08),'red')]
    for x in [-.36,-.18,0,.18,.36]:p.append(rod((x,.40,1.04),(x,1.26,1.04),.015,'black',6))
    for y in [.40,.83,1.26]:p.append(rod((-.36,y,1.04),(.36,y,1.04),.016,'black',6))
    # Continuous silver mudguard ribbons, matching the classic roadster silhouette.
    for cy in [.76,-.95]:
        v=[]
        for i in range(29):
            a=-.12+i*(math.pi+.24)/28
            for x in [-.038,.038]:v.append((x,cy+math.cos(a)*.395,.36+math.sin(a)*.395))
        p.append(mesh('SilverMudguard',v,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(28)],'steel'))
    # A curved half-chaincase leaves the working chainring and lower chain visible.
    v=[]
    for i in range(13):
        t=i/12;y=-.04+t*.79
        v.extend([(-.128,y,.4+.157*(1-t)+.071*t),(-.128,y,.4+.125*(1-t)+.043*t)])
    p.append(mesh('CurvedHalfChaincase',v,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(12)],'black'))
    p += [rod((-.112,.76,.436),(-.112,-.04,.538),.008,'steel',6),
          rod((-.112,.76,.325),(-.112,-.04,.257),.008,'steel',6),
          cube((0,1.05,.67),(.15,.015,.10),'steel')]
    # Brake cables and levers remain editable Blender meshes.
    for side in [-1,1]:
        p.append(rod((side*.32,-.56,1.16),(side*.31,-.46,1.12),.010,'steel',6))
        cable=[(side*.31,-.56,1.15),(side*.24,-.82,1.08),(side*.08,-.80,.86),(side*.03,-.95,.69)]
        p.extend(rod(a,b,.005,'black',5) for a,b in zip(cable,cable[1:]))
    pack(p,'BikeFrame',r)
    ropes=[]
    for y in [.49,1.06]:
        for i in range(16):
            a=i*math.pi/16; b=(i+1)*math.pi/16
            ropes.append(rod((.43*math.cos(a),y,1.04+.40*math.sin(a)),
                             (.43*math.cos(b),y,1.04+.40*math.sin(b)),.007,'rope',5))
        ropes.append(rod((-.43,y,1.04),(.43,y,1.04),.007,'rope',5))
    pack(ropes,'CargoRopes',r)
    pack(tire(rear,.36,.049,True),'WheelRear',r,rear)
    pack(tire(front,.36,.049,True),'WheelFront',r,front)
    cp=[rod((-.15,-.04,.4),(.15,-.04,.4),.035,'steel'),
        rod((-.15,-.04,.4),(-.15,-.04,.58),.018,'steel'),
        rod((.15,-.04,.4),(.15,-.04,.22),.018,'steel'),
        ]
    v=[]
    for x in [-.135,-.119]:
        for radius in [.058,.143]:
            for i in range(40):
                a=i*math.tau/40;rr=radius+(.006 if radius>.1 and i%2==0 else 0)
                v.append((x,-.04+math.cos(a)*rr,.4+math.sin(a)*rr))
    f=[]
    for i in range(40):
        n=(i+1)%40
        f.extend([(i,n,n+40,i+40),(80+i,120+i,120+n,80+n),
                  (40+i,40+n,120+n,120+i),(i,80+i,80+n,n)])
    cp.append(mesh('RoadsterChainring',v,f,'steel'))
    for i in range(5):
        a=i*math.tau/5
        cp.append(rod((-.14,-.04+math.cos(a)*.025,.4+math.sin(a)*.025),
                      (-.14,-.04+math.cos(a)*.092,.4+math.sin(a)*.092),.007,'steel',6))
    crank=pack(cp,'Crank',r,bb)
    for side,tag,z in [(-1,'L',.58),(1,'R',.22)]:
        pedal=pack([cube((side*.21,-.04,z),(.16,.15,.04),'black')],'Pedal_'+tag,crank,(side*.21,-.04,z))
        pedal.location=(side*.21,0,z-.4)
    return r

def smooth(obj):
    for face in obj.data.polygons:face.use_smooth=True
    return obj

def limb(a,b,radius,color):
    a,b=Vector(a),Vector(b);axis=(b-a).normalized()
    u=axis.cross(Vector((0,0,1)))
    if u.length<.01:u=axis.cross(Vector((1,0,0)))
    u.normalize();v=axis.cross(u).normalized();verts=[];faces=[]
    rings=8 if color=='blue' else 5 if color=='red' else 10
    sides=10 if color=='blue' else 12 if color=='red' else 16
    for j in range(rings):
        t=j/(rings-1);center=a.lerp(b,t)
        profile=1-.23*t+.13*math.sin(t*math.pi)
        if color=='blue':profile+=.035*math.sin(t*math.pi*3)*(1-t)*math.sin(t*math.pi)
        r=radius*profile
        for i in range(sides):
            angle=i*math.tau/sides
            fold=1+(.045*math.sin(angle*2+t*8)*math.sin(t*math.pi) if color=='blue' else .025*math.cos(angle*2))
            p=center+(u*math.cos(angle)+v*math.sin(angle))*r*fold
            verts.append(tuple(p))
    for j in range(rings-1):
        for i in range(sides):
            n=j*sides+i;q=j*sides+(i+1)%sides
            faces.extend([(n,q,q+sides),(n,q+sides,n+sides)])
    faces.extend([tuple(range(sides-1,-1,-1)),tuple((rings-1)*sides+i for i in range(sides))])
    o=mesh('TailoredLimb',verts,faces,color)
    if color=='blue':
        for face in o.data.polygons:
            shade=.97+.045*math.sin(face.center.z*6+face.center.y*4+face.center.x*3)
            for li in face.loop_indices:o.data.color_attributes['Color'].data[li].color=tuple(c*shade for c in COLORS[color][:3])+(1,)
    return o

def sneaker(x):
    v=[];f=[];profile=[(.025,.076,.057,.451),(-.04,.094,.063,.453),(-.12,.098,.059,.451),(-.20,.084,.04,.441),(-.267,.046,.021,.427)]
    for y,w,h,z in profile:
        for i in range(12):
            a=i*math.tau/12;v.append((x+math.cos(a)*w,y,z+math.sin(a)*h))
    for j in range(len(profile)-1):
        for i in range(12):a=j*12+i;b=j*12+(i+1)%12;f.append((a,b,b+12,a+12))
    f += [tuple(range(11,-1,-1)),tuple((len(profile)-1)*12+i for i in range(12))]
    p=[mesh('SneakerUpper',v,f,(.028,.031,.036,1))]
    outline=[(-.07,.04),(.07,.04),(.10,-.055),(.10,-.16),(.064,-.275),(-.064,-.275),(-.10,-.16),(-.10,-.055)]
    v=[(x+px,py,z) for z in [.375,.404] for px,py in outline]
    f=[tuple(range(8)),tuple(range(15,7,-1))]+[(i,i+8,(i+1)%8+8,(i+1)%8) for i in range(8)]
    p.append(mesh('SneakerSole',v,f,'white'))
    for edge in [-1,1]:p.append(rod((x+edge*.094,-.19,.451),(x+edge*.088,-.075,.483),.008,'white',6))
    for i in range(4):
        y=-.175+i*.038
        p.append(rod((x-.049,y,.510),(x+.049,y+.012,.510),.005,'white',6))
    for i in range(5):p.append(rod((x-.055,-.21+i*.047,.376),(x+.055,-.21+i*.047,.376),.003,(.38,.39,.38,1),5))
    return p

def standing_pose(side, crouch=0, sway=0):
    hip=Vector((side*.17+sway,.04,1.86-crouch))
    ankle=Vector((-.30,-.58,1.311) if side<0 else (.04,.21,1.233))
    delta=ankle-hip;d=delta.length;direction=delta/d
    along=(.54**2-.48**2+d*d)/(2*d)
    bend=Vector((0,-1,0));bend=(bend-direction*bend.dot(direction)).normalized()
    knee=hip+direction*along+bend*math.sqrt(max(0,.54**2-along*along))
    return hip,knee,ankle

def rider():
    r=root('StandingRider');r['pose']='left foot on handlebar; right foot on saddle'
    torso=root('BalanceBody');torso.parent=r;torso.location=(0,.04,1.86)
    v=[];f=[]
    rings=[(1.81,.04,.23,.155),(1.88,.035,.25,.16),(1.98,.02,.27,.17),
           (2.08,.00,.29,.17),(2.19,-.025,.31,.18),(2.30,-.035,.315,.16),
           (2.36,-.04,.28,.14),(2.41,-.045,.12,.10)]
    sides=16
    for j,(z,y,w,d) in enumerate(rings):
        for i in range(sides):
            angle=i*math.tau/sides
            fold=1+.035*math.cos(angle*3+j*.4)*math.sin(math.pi*j/(len(rings)-1))
            v.append((w*math.cos(angle)*fold,y+d*math.sin(angle)*fold,z))
    for j in range(len(rings)-1):
        for i in range(sides):a=j*sides+i;b=j*sides+(i+1)%sides;f.append((a,b,b+sides,a+sides))
    p=[mesh('StandingRedShirt',v,f,'red'),ico((0,.04,1.81),(.235,.18,.14),'blue',2),
       rod((0,-.045,2.37),(0,-.06,2.48),.072,'skin',12),
       ico((0,-.06,2.57),(.135,.13,.17),'skin',3),ico((0,-.08,2.49),(.101,.094,.084),'skin',2)]
    hv=[];hf=[]
    for j in range(6):
        for i in range(24):
            angle=i*math.tau/24;theta=(1.36 if math.sin(angle)<0 else 1.88)*(.06+j*.94/5)
            hv.append((.137*math.sin(theta)*math.cos(angle),-.05+.141*math.sin(theta)*math.sin(angle),2.65+.119*math.cos(theta)))
    for j in range(5):
        for i in range(24):a=j*24+i;b=j*24+(i+1)%24;hf.append((a,a+24,b+24,b))
    hf.append(tuple(range(24)));p.append(mesh('ShortCurledHairCap',hv,hf,(.015,.018,.021,1)))
    for i in range(100):
        angle=i*2.39996;theta=math.acos(1-(i+.5)/100*(1-math.cos(1.80)))
        if math.sin(angle)<0 and theta>1.38:continue
        size=.024*(.94+.12*math.sin(i*1.7))
        p.append(ico((.137*math.sin(theta)*math.cos(angle),-.05+.141*math.sin(theta)*math.sin(angle),2.65+.119*math.cos(theta)),(size,size,size*.88),(.018,.021,.024,1),1))
    p += [ico((0,-.197,2.58),(.027,.033,.029),'skin',2),rod((-.027,-.186,2.528),(.027,-.186,2.528),.004,(.085,.026,.017,1),7)]
    for side in [-1,1]:
        p += [ico((side*.056,-.181,2.607),(.017,.010,.009),'white',1),ico((side*.056,-.190,2.607),(.008,.006,.008),'black',1),
              rod((side*.036,-.178,2.634),(side*.08,-.173,2.632),.007,'black',6),ico((side*.134,-.05,2.57),(.025,.025,.045),'skin',1)]
    pack(p,'StandingBody',torso,(0,.04,1.86)).location=(0,0,0)
    for side,tag in [(-1,'L'),(1,'R')]:
        shoulder=(side*.27,-.025,2.31);elbow=(side*.48,-.06,2.18);hand=(side*.68,-.12,2.23)
        arm=root('Arm_'+tag);arm.parent=torso;arm.location=Vector(shoulder)-Vector((0,.04,1.86))
        sleeve_end=Vector(shoulder).lerp(Vector(elbow),.52)
        pack([limb(shoulder,elbow,.075,'skin'),limb(shoulder,sleeve_end,.098,'red')],'UpperArm_'+tag,arm,shoulder).location=(0,0,0)
        elbow_joint=root('Elbow_'+tag);elbow_joint.parent=arm;elbow_joint.location=Vector(elbow)-Vector(shoulder)
        pack([limb(elbow,hand,.06,'skin')],'Forearm_'+tag,elbow_joint,elbow).location=(0,0,0)
        hand_joint=root('Hand_'+tag);hand_joint.parent=elbow_joint;hand_joint.location=Vector(hand)-Vector(elbow)
        parts=[ico(hand,(.065,.037,.045),'skin',2)]
        for finger in range(4):
            x=side*(.66+finger*.024)
            parts.extend([rod((x,-.13,2.23),(x+side*.014,-.18,2.23),.009,'skin',7),rod((x+side*.014,-.18,2.23),(x+side*.007,-.20,2.205),.009,'skin',7)])
        parts.append(rod((side*.64,-.13,2.23),(side*.62,-.17,2.205),.012,'skin',7))
        pack(parts,'RiderHand_'+tag,hand_joint,hand).location=(0,0,0)
        hip,knee,foot=standing_pose(side)
        leg=root('Leg_'+tag);leg.parent=r;leg.location=hip
        leg['restUpper']=list(knee-hip);leg['support']=list(foot)
        pack([limb(hip,knee,.112,'blue'),ico(knee,(.105,.095,.10),'blue',2)],'Thigh_'+tag,leg,hip).location=(0,0,0)
        joint=root('Knee_'+tag);joint.parent=leg;joint.location=knee-hip
        pack([limb(knee,foot,.085,'blue'),rod(foot+Vector((0,0,-.02)),foot+Vector((0,0,.04)),.073,'red',12)],'Shin_'+tag,joint,knee).location=(0,0,0)
        ankle=root('Foot_'+tag);ankle.parent=joint;ankle.location=foot-knee
        shoes=sneaker(0)
        for obj in shoes:obj.location += foot-Vector((0,-.03,.49))
        pack(shoes,'Shoe_'+tag,ankle,foot).location=(0,0,0)
    # Editable object-rig Actions in Blender; runtime solves support-foot IK.
    for side,tag in [(-1,'L'),(1,'R')]:
        arm=bpy.data.objects['Arm_'+tag]
        for frame,angle in [(1,-.10),(16,.10),(32,-.10)]:
            arm.rotation_euler[1]=angle*side;arm.keyframe_insert(data_path='rotation_euler',frame=frame)
        arm.animation_data.action.name='StandingBalance_'+tag
    bpy.context.scene.frame_set(1)
    for tag in ['L','R']:
        bpy.data.objects['Arm_'+tag].rotation_euler=(0,0,0)
    return r

def banana(count=5):
    r=root('Banana' if count==5 else 'BananaFruit')
    p=[]
    for j in range(count):
        verts=[]; rings=13; sides=10
        finger=j-(count-1)/2
        fan=finger*.075;out=Vector((math.cos(fan),math.sin(fan),0))
        tangent_side=Vector((-math.sin(fan),math.cos(fan),0))
        length=.53+.028*math.cos(finger*.95)
        tip_height=.026+.012*math.sin(j*1.9)
        for k in range(rings):
            t=k/(rings-1);curve=.21+.022*math.cos(j*2)
            bend=.095*(1-t)+curve*math.sin(t*math.pi)+.022*t
            spread=finger*(.018+.055*math.sin(t*math.pi)**.8)
            center=out*bend+tangent_side*spread+Vector((0,0,tip_height+length*t))
            tangent=(out*(-.073+curve*math.pi*math.cos(t*math.pi))
                     +tangent_side*(finger*.044*math.pi*math.cos(t*math.pi)*max(math.sin(t*math.pi),.0001)**(-.2))+Vector((0,0,length))).normalized()
            cross=(out-tangent*out.dot(tangent)).normalized();across=tangent.cross(cross)
            radius=(.064+.004*math.sin(j*2.1))*(.27+.73*math.sin(t*math.pi)**.65)
            for h in range(sides):
                # Two close corners bevel each of the five long, broad peel faces.
                a=(h//2)*math.tau/5+(-.075 if h%2==0 else .075)
                verts.append(tuple(center+(cross*math.cos(a)+across*math.sin(a))*radius))
        faces=[]
        for k in range(rings-1):
            for h in range(sides):
                a=k*sides+h; b=k*sides+(h+1)%sides
                faces.append((a,b,b+sides,a+sides))
        faces += [tuple(range(sides-1,-1,-1)),tuple((rings-1)*sides+h for h in range(sides))]
        fruit=mesh('CurvedBanana',verts,faces,'banana')
        attr=fruit.data.color_attributes['Color']
        for face in fruit.data.polygons:
            segment=min(rings-2,face.index//sides);t=(segment+.5)/(rings-1)
            shade=.86+.105*math.cos((face.index%sides)*math.tau/sides)+.012*math.sin(j*2+segment*.7)
            c=(.985*shade,(.545+.012*math.cos(j*1.3))*shade,.009,1)
            if t>.89:c=(.64*shade,.46*shade,.018,1)
            for li in face.loop_indices:attr.data[li].color=c
        p.append(fruit)
        tip=out*.095+tangent_side*(finger*.018)+Vector((0,0,tip_height))
        p.append(ico(tuple(tip-Vector((0,0,.012))),(.013,.014,.016),(.12,.065,.018,1),1))
        p.append(rod(tuple(out*.022+tangent_side*(finger*.018)+Vector((0,0,tip_height+length))),(0,0,.618),.013,(.20,.25,.026,1),7))
    p.append(rod((0,0,.603),(0,0,.65),.023,(.10,.16,.018,1),9))
    pack(p,'BananaMesh',r)
    return r

def cargo():
    r=root('BananaCargo')
    data=next(o.data for o in assets['banana'].children_recursive if o.type=='MESH')
    bpy.context.view_layer.update()
    frame=bpy.data.objects['BikeFrame']
    rack_vertices=[frame.matrix_world@v.co for v in frame.data.vertices]
    rack_faces=[tuple(p.vertices) for p in frame.data.polygons if all(
        -.39<=rack_vertices[i].x<=.39 and .36<=rack_vertices[i].y<=1.30 and 1.00<=rack_vertices[i].z<=1.09 for i in p.vertices)]
    rack=BVHTree.FromPolygons(rack_vertices,rack_faces)
    rng=random.Random(2807)
    for i in range(20):
        n=i%9;layer=i//9
        x=(n%3-1)*.20+rng.uniform(-.025,.025)
        y=.54+(n//3)*.28+rng.uniform(-.035,.035)
        z=1.41+layer*.12+rng.uniform(-.025,.03)
        yaw=rng.uniform(-math.pi,math.pi)
        tilt=rng.uniform(-.45,.65);roll=rng.uniform(-.38,.38)
        if i<3:x=-.22+i*.20;y=.55;z=1.15;tilt=1.45;yaw=rng.uniform(-.18,.18);roll=-.15
        elif i in (4,7,10,14):tilt=rng.uniform(1.2,1.75);z=1.30
        if i==9:y+=.20  # Keep this upper front hand behind the seated rider's hips.
        # A handful of loose outer hands hang off the rack, rather than every
        # shared fan pointing upright and forming identical yellow circles.
        if i>=16:
            side=-1 if i%2==0 else 1
            x=side*(.34+rng.uniform(-.025,.025));y=.64+(i//2-8)*.44
            z=1.37+rng.uniform(-.03,.025);tilt=rng.uniform(-.15,.22)
            roll=side*.25;yaw=0 if side>0 else math.pi
        rotation=Euler((tilt,roll,yaw),'XYZ').to_matrix().to_4x4()
        scale=.66+rng.uniform(-.035,.035)
        o=bpy.data.objects.new(f'CargoBundle{i:02}',data);bpy.context.collection.objects.link(o);o.parent=r
        placement=Matrix.Translation((x,y,z)) @ rotation @ Matrix.Scale(scale,4) @ Matrix.Translation((0,0,-.65))
        # Early collected hands touch a real rack tube before the rest of the heap appears.
        if i<3:
            candidates=[(point,rack.find_nearest(point)) for point in (placement@v.co for v in data.vertices)]
            point,hit=min(candidates,key=lambda item:item[1][3])
            placement=Matrix.Translation(hit[0]-point+Vector((0,0,.002)))@placement
        o.matrix_local=placement
        o['bananas']=5
    r['maxDisplayedBananas']=100;r['style_reference']='style-a.png';r['purpose']='collected cargo; empty at start'
    return r

def truck_wheel(center,width=.24,side=1):
    x,y,z=center;radius=.47;rings=32;v=[];f=[]
    profile=[(-.52,.57),(-.50,.89),(-.34,1),(.34,1),(.50,.89),(.52,.57)]
    for offset,r in profile:
        for i in range(rings):
            a=i*math.tau/rings;v.append((x+offset*width,y+math.cos(a)*r*radius,z+math.sin(a)*r*radius))
    for j in range(len(profile)):
        for i in range(rings):
            a=j*rings+i;b=j*rings+(i+1)%rings
            f.append((a,b,((j+1)%len(profile))*rings+(i+1)%rings,((j+1)%len(profile))*rings+i))
    rubber=mesh('TruckTireSidewall',v,f,(.022,.024,.027,1));p=[rubber]
    for i in range(32):
        a=i*math.tau/32
        block=cube((x,y+math.cos(a)*radius,z+math.sin(a)*radius),(width*.90,.024,.068),(.028,.029,.031,1))
        block.rotation_euler.x=a;p.append(block)
    # Recessed rims, an axle cap and eight lug nuts keep the wheel readable in flight.
    outer=x+side*width*.53
    p += [rod((x-width*.53,y,z),(x+width*.53,y,z),.265,(.16,.16,.145,1),24),
          rod((outer,y,z),(outer+side*.045,y,z),.085,'steel',12)]
    for i in range(8):
        a=i*math.tau/8;cy=y+math.cos(a)*.14;cz=z+math.sin(a)*.14
        p.append(rod((outer,cy,cz),(outer+side*.020,cy,cz),.015,'steel',6))
    return p

def truck():
    r=root('Truck')
    chassis=(.115,.109,.094,1)
    p=[cube((-.67,.2,.62),(.14,4.6,.23),chassis),cube((.67,.2,.62),(.14,4.6,.23),chassis),
       cube((0,-1.60,1.2),(2.2,1.45,1.45),'cream'),
       cube((0,-1.60,2.0),(2.25,1.48,.13),'olive'),cube((0,.77,.94),(2.25,3.1,.15),'wood'),
       cube((0,-2.34,1.54),(1.86,.025,.57),'glass'),
       cube((0,-2.35,.83),(2.15,.16,.13),'steel')]
    # Separate wooden boards, canvas folds, metal tailgate and visible cargo.
    for j in range(5):
        z=1.04+j*.15
        col=(.22+.032*(j%3),.27+.025*(j%3),.14+.018*(j%3),1)
        for side in [-1,1]:p.append(cube((side*1.12,.77,z),(.075,3.12,.14),col))
        p.append(cube((0,2.35,z),(2.19,.075,.14),col))
    for side in [-1,1]:
        for y in [-.76,.02,.80,1.58,2.30]:
            p += [cube((side*1.17,y,1.31),(.065,.065,.79),'steel'),
                  cube((side*1.17,y,1.66),(.085,.16,.07),'steel')]
    p += [cube((0,2.417,1.23),(2.17,.066,.55),(.58,.55,.49,1)),cube((0,2.46,.64),(2.35,.10,.18),'steel'),
          cube((0,2.465,.78),(.43,.02,.16),'black')]
    for x in [-.70,0,.70]:p.append(cube((x,2.458,1.23),(.64,.026,.40),(.44,.42,.38,1)))
    for x in [-.86,.86]:
        p.append(rod((x-.085,2.497,.966),(x+.085,2.497,.966),.025,'steel',8))
    for side in [-1,1]:
        p += [cube((side*1.04,2.495,1.24),(.05,.03,.23),'steel'),
              rod((side*1.04,2.51,1.23),(side*1.04,2.55,1.31),.012,chassis,6)]
    for x in [-1.02,1.02]:
        for z in [.9,1.07,1.24]:p.append(cube((x,2.44,z),(.095,.025,.16),'red' if z!=1.07 else 'white'))
    for x in [-.65,0,.65]:
        for z in [1.30,1.86]:
            p.append(cube((x,1.70,z),(.58,.70,.56),(.57,.37,.20,1)))
            for dz in [-.22,.22]:p.append(cube((x,2.057,z+dz),(.60,.026,.045),(.33,.205,.10,1)))
    canvas_mat=mat.copy();canvas_mat.name='Truck_SlateCanvas'
    canvas_bsdf=next(n for n in canvas_mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    canvas_bsdf.inputs['Roughness'].default_value=.97
    canvas_bsdf.inputs['Emission Color'].default_value=(.018,.022,.029,1)
    canvas_bsdf.inputs['Emission Strength'].default_value=.65
    def cloth(name,vertices,faces):
        o=mesh(name,vertices,faces,(.083,.094,.123,1))
        o.data.materials.clear();o.data.materials.append(canvas_mat)
        for face in o.data.polygons:
            shade=.84+.19*math.sin(face.center.x*9+face.center.y*5+face.center.z*11)
            color=(.083*shade,.094*shade,.123*shade,1)
            for li in face.loop_indices:o.data.color_attributes['Color'].data[li].color=color
        p.append(o)
    def canvas_height(x,y):
        return 2.12+.56*(1-abs(x/1.17))+.045*math.sin(y*4.7+x*5.2)
    verts=[];faces=[];cols=11;rows=13
    for j in range(rows):
        y=-.82+j*3.2/(rows-1)
        for i in range(cols):
            x=-1.17+i*2.34/(cols-1);verts.append((x,y,canvas_height(x,y)))
    for j in range(rows-1):
        for i in range(cols-1):
            a=j*cols+i;faces.extend([(a,a+1,a+cols+1),(a,a+cols+1,a+cols)])
    cloth('FacetedCanvasRoof',verts,faces)
    for side in [-1,1]:
        v=[];f=[]
        for j in range(rows):
            y=-.82+j*3.2/(rows-1)
            v.extend([(side*(1.17+.045*math.sin(j*2.7)),y,1.73+.07*math.sin(j*2.1)),
                      (side*1.17,y,canvas_height(side*1.17,y))])
        for j in range(rows-1):
            a=j*2;quad=(a,a+1,a+3,a+2)
            f.append(quad if side<0 else quad[::-1])
        cloth('CanvasSideFolds',v,f)
        for y in [-.6,.18,.98,1.78,2.20]:
            p.append(rod((side*1.19,y,1.80),(side*1.18,y-.07,1.38),.012,(.15,.14,.11,1),5))
    # The folded rear curtains frame an opening, rather than exposing a black roof underside.
    xs=[-1.17,-.86,-.57,0,.57,.86,1.17]
    hem=[1.67,1.80,2.22,2.30,2.17,1.78,1.68];v=[];f=[]
    for i,x in enumerate(xs):
        y=2.40+.045*math.sin(i*1.9)
        v.extend([(x,y,hem[i]),(x,2.38,canvas_height(x,2.38))])
    for i in range(len(xs)-1):a=i*2;f.extend([(a,a+1,a+3),(a,a+3,a+2)])
    cloth('RearCanvasCurtains',v,f)
    for i in range(len(xs)-1):
        p.append(rod((xs[i],2.415,hem[i]),(xs[i+1],2.415,hem[i+1]),.022,(.10,.115,.14,1),6))
    for j in range(rows-1):
        a=-.82+j*3.2/(rows-1);b=-.82+(j+1)*3.2/(rows-1)
        p.append(rod((0,a,canvas_height(0,a)+.008),(0,b,canvas_height(0,b)+.008),.008,(.075,.086,.105,1),6))
    for side in [-1,1]:
        p += [cube((side*1.105,-1.61,1.6),(.025,1.01,.6),'glass'),
              cube((side*.76,-2.355,1.04),(.38,.04,.19),'white'),
              cube((side*.74,2.39,.81),(.36,.035,.1),'red')]
        p += truck_wheel((side*1.15,-1.45,.47),.28,side)
        for y in [.85,1.80]:
            for x in [.94,1.17]:p += truck_wheel((side*x,y,.47),.20,side)
        for y in [-1.45,.85,1.80]:
            v=[]
            for i in range(9):
                a=math.pi*(.08+i*.84/8);cy=y+math.cos(a)*.54;cz=.47+math.sin(a)*.54
                v.extend([(side*.98,cy,cz),(side*1.34,cy,cz)])
            p.append(mesh('TruckWheelArch',v,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(8)],chassis))
        p.append(cube((side*1.12,2.28,.43),(.42,.045,.43),'rubber'))
        # Cab doors, steps and mirrors remain visible from the approach side.
        p += [cube((side*1.12,-1.60,1.09),(.025,1.12,.06),(.59,.56,.45,1)),
              cube((side*1.145,-1.28,1.35),(.045,.17,.035),chassis),
              cube((side*1.20,-.96,.62),(.36,.42,.09),chassis),
              rod((side*1.08,-2.11,1.64),(side*1.36,-2.10,1.82),.025,chassis,6),
              cube((side*1.38,-2.10,1.83),(.045,.18,.34),chassis)]
        for y in [-.65,.1,.85,1.60,2.22]:
            p.append(rod((side*1.15,y,1.32),(side*1.15,y,2.35),.027,'wood'))
        for y in [-.5,.55,1.6]:
            p.append(rod((side*1.15,y,1.6),(side*.45,y+.48,2.44),.026,'stem',5))
    for y in [-1.45,.85,1.80]:
        p += [rod((-1.1,y,.47),(1.1,y,.47),.095,chassis,12),ico((0,y,.47),(.25,.21,.19),chassis,2)]
        for side in [-1,1]:
            for layer in range(3):p.append(cube((side*.67,y,.51+layer*.035),(.09,.94-layer*.17,.03),chassis))
            p.append(rod((side*.67,y-.32,.52),(side*.67,y+.13,.75),.035,'steel',8))
    for y in [-1,-.2,.6,1.4,2.2]:p.append(cube((0,y,.67),(1.45,.09,.1),chassis))
    p += [cube((0,-1.35,.56),(.50,.61,.39),chassis),cube((0,-.92,.47),(.26,.32,.22),chassis),
          rod((0,-.92,.44),(0,1.80,.47),.055,chassis,10),
          rod((.85,-.4,.74),(.85,.38,.74),.16,'steel',12),rod((-.48,-.3,.4),(-.48,1.3,.4),.046,chassis,10)]
    pack(p,'TruckMesh',r)
    return r

def car():
    r=root('Car');p=[];verts=[];faces=[]
    body_color=(.74,.70,.53,1)
    for y,w,top in [(-1.64,.73,.78),(-1.50,.86,.86),(-.7,.88,.88),(.93,.88,.87),(1.55,.86,.83),(1.64,.73,.76)]:
        for x,z in [(-w*.84,.30),(w*.84,.30),(w,.38),(w,top-.07),(w*.84,top),(-w*.84,top),(-w,top-.07),(-w,.38)]:verts.append((x,y,z))
    for j in range(5):
        for i in range(8):a=j*8+i;b=j*8+(i+1)%8;faces.append((a,b,b+8,a+8))
    faces.extend([tuple(range(7,-1,-1)),tuple(40+i for i in range(8))]);p.append(mesh('CreasedCarBody',verts,faces,body_color))
    roof=[(-.75,-.71,.84),(.75,-.71,.84),(.75,.98,.84),(-.75,.98,.84),(-.65,-.44,1.30),(.65,-.44,1.30),(.65,.77,1.30),(-.65,.77,1.30)]
    p.append(mesh('CarCabin',roof,[(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5),(4,5,6,7)],body_color))
    p.append(mesh('FrontWindshield',[(-.65,-.724,.89),(.65,-.724,.89),(.59,-.468,1.255),(-.59,-.468,1.255)],[(0,1,2,3)],'glass'))
    p.append(mesh('RearWindshield',[(-.63,.995,.90),(-.59,.795,1.25),(.59,.795,1.25),(.63,.995,.90)],[(0,1,2,3)],'glass'))
    for side in [-1,1]:
        for y0,y1 in [(-.61,.02),(.11,.84)]:
            p.append(mesh('CarSideWindow',[(side*.759,y0,.91),(side*.759,y1,.91),(side*.659,min(y1,.74),1.245),(side*.659,max(y0,-.4),1.245)],[(0,1,2,3)],'glass'))
        for y in [-.67,.065,.93]:p.append(rod((side*.78,y,.89),(side*.67,max(-.43,min(.77,y)),1.27),.022,'black',7))
        p += [rod((side*.88,-.70,.51),(side*.88,.95,.51),.011,'black',6),
              rod((side*.89,.05,.36),(side*.89,.05,.88),.009,'stem',6),
              cube((side*.90,-.24,.81),(.035,.14,.03),'steel'),cube((side*.90,.61,.80),(.035,.14,.03),'steel'),
              cube((side*.92,-.54,1.0),(.14,.18,.10),'black')]
        for y in [-1.04,1.03]:
            p+=tire((side*.88,y,.33),.33,.21)
            for j in range(15):
                aa=j*math.pi/15;bb=(j+1)*math.pi/15
                p.append(rod((side*.907,y+math.cos(aa)*.37,.33+math.sin(aa)*.37),(side*.907,y+math.cos(bb)*.37,.33+math.sin(bb)*.37),.019,body_color,6))
    for y in [-1.66,1.66]:
        p += [cube((0,y,.46),(1.6,.09,.10),'steel'),cube((0,y*1.006,.41),(1.56,.10,.08),'black'),cube((0,y*1.036,.60),(.32,.023,.11),'cream')]
        for side in [-1,1]:p.append(cube((side*.60,y*1.01,.71),(.24,.035,.17),'white' if y<0 else 'red'))
    p += [cube((0,-1.68,.64),(.72,.035,.15),'black'),rod((-.29,-1.708,.65),(.29,-1.708,.65),.013,'steel',6),
          rod((-.55,1.655,.75),(.55,1.655,.75),.009,'stem',6),cube((0,1.659,.77),(.20,.03,.03),'steel')]
    pack(p,'CarMesh',r);return r

def pedestrian():
    r=root('Pedestrian')
    p=[ico((0,0,1.09),(.23,.17,.32),'cream',1),ico((0,0,1.57),(.15,.15,.19),'skin'),
       ico((0,0,1.77),(.29,.26,.035),'wood'),ico((0,0,1.80),(.16,.16,.10),'wood')]
    pack(p,'PedestrianBody',r)
    for side,tag in [(-1,'L'),(1,'R')]:
        hip=(side*.11,0,.88)
        pack([rod(hip,(side*.16,0,.48),.095,'olive'),
              rod((side*.16,0,.48),(side*.17,0,.1),.062,'skin'),
              cube((side*.17,-.06,.07),(.14,.23,.12),'black')],'PedLeg_'+tag,r,hip)
        shoulder=(side*.2,0,1.28)
        pack([rod(shoulder,(side*.32,-.04,1.01),.061,'skin'),
              rod((side*.32,-.04,1.01),(side*.39,-.18,1.24),.05,'skin')],'PedArm_'+tag,r,shoulder)
    return r

def goat():
    r=root('Goat')
    p=[ico((0,0,.64),(.28,.52,.28),'white',2),ico((0,-.45,.87),(.19,.24,.23),'cream',1),
       ico((0,-.60,.79),(.13,.15,.13),'white')]
    for side in [-1,1]:
        p += [rod((side*.105,-.44,1.03),(side*.16,-.31,1.25),.025,'stem',5),
              ico((side*.21,-.47,.96),(.15,.047,.055),'white'),
              ico((side*.165,-.55,.90),(.025,.025,.025),'black')]
    p.append(rod((0,.45,.73),(0,.66,.88),.025,'white',6))
    pack(p,'GoatBody',r)
    for side,tag in [(-1,'L'),(1,'R')]:
        for y,end in [(-.27,'Front'),(.29,'Rear')]:
            origin=(side*.16,y,.56)
            pack([rod(origin,(side*.18,y,.07),.047,'cream',6),
                  cube((side*.18,y-.018,.052),(.10,.13,.10),'stem')],'GoatLeg_'+end+'_'+tag,r,origin)
    return r

def palm():
    r=root('Palm')
    p=[]
    for k in range(5):
        p.append(rod((.07*k,0,k*.72),(.07*(k+1),0,(k+1)*.72),.16-k*.011,'wood',7))
    for k in range(8):
        a=k*math.tau/8; c=Vector((.35,0,3.65)); d=Vector((math.cos(a)*2,math.sin(a)*2,-.65))
        n=Vector((-math.sin(a),math.cos(a),0))*.31
        mid=c+d*.55+Vector((0,0,.18))
        p.append(mesh('PalmLeaf',[tuple(c),tuple(mid+n),tuple(c+d),tuple(mid-n),tuple(mid+Vector((0,0,.16)))],
                      [(0,1,4),(1,2,4),(2,3,4),(3,0,4)],'leaf' if k%2 else 'green'))
        sideways=Vector((-math.sin(a),math.cos(a),0))
        for j in range(1,12):
            t=j/13;center=c+d*t+Vector((0,0,.23*math.sin(t*math.pi)))
            for side in [-1,1]:
                tip=center+sideways*side*(.58*math.sin(t*math.pi))+d*.11-Vector((0,0,.16))
                p.append(mesh('PalmLeaflet',[tuple(center-d*.035),tuple(center+d*.035),tuple(tip)],[(0,1,2)],'leaf' if j%3 else 'green'))
    pack(p,'PalmMesh',r)
    return r

def banana_plant():
    r=root('BananaPlant');p=[]
    for stem in [-1,0,1]:p.append(rod((stem*.12,0,0),(stem*.17,-.1,2.6+stem*.14),.095,'green',7))
    for k in range(9):
        a=k*2.4;c=Vector((0,0,2.1+(k%3)*.34));d=Vector((math.cos(a),math.sin(a),0))
        n=Vector((-math.sin(a),math.cos(a),0));v=[];f=[];length=1.7+(k%4)*.20
        for j in range(7):
            t=j/6;center=c+d*length*t+Vector((0,0,.65*math.sin(t*math.pi)-.6*t*t))
            width=.42*math.sin(t*math.pi)**.7
            v.extend([tuple(center+n*width),tuple(center+Vector((0,0,.055))),tuple(center-n*width)])
        for j in range(6):
            b=j*3;f.extend([(b,b+3,b+4),(b,b+4,b+1),(b+1,b+4,b+5),(b+1,b+5,b+2)])
        leaf=mesh('BroadBananaLeaf',v,f,'leaf' if k%3 else 'green')
        # Thin leaves show their palette from both sides.
        leaf.data.materials[0].use_backface_culling=False;p.append(leaf)
    pack(p,'BananaPlantMesh',r);return r

def stall():
    r=root('MountainBananaStall');p=[]
    p.append(ico((0,0,-.15),(2.6,1.8,.20),(.38,.36,.31,1),1))
    p.append(cube((0,0,.04),(4.8,3,.08),(.38,.36,.31,1)))
    for x in [-2.1,2.1]:
        for y in [-1.1,1.1]:p.append(rod((x,y,0),(x,y,2.6),.10,'wood',7))
    p += [cube((0,0,.96),(4.4,2.4,.15),'wood')]
    for k in range(16):
        y=-1.55+k*.2;z=2.63+.30*(1-abs(y/1.6))
        p.append(cube((0,y,z),(5.0,.19,.06),(.43+(k%3)*.04,.24+(k%3)*.025,.075,1)))
    for x in [-1.3,0,1.3]:
        p += [cube((x,0,1.10),(1.1,1.7,.30),'wood')]
        for k in range(8):p.append(ico((x+(k%4-1.5)*.23,-.4+(k//4)*.5,1.44),(.19,.32,.11),'banana',1))
    for x in [-2.0,-1.0,0,1.0,2.0]:p.append(rod((x,1.3,.1),(x,1.3,1.4),.06,'wood',6))
    for z in [.45,1.0]:p.append(rod((-2.3,1.3,z),(2.3,1.3,z),.065,'wood',6))
    pack(p,'StallMesh',r);return r

def cliff():
    r=root('RedRockCliff');v=[];f=[]
    rng=random.Random(2841);sides=12
    tiers=[(-.3,3.8,6.2),(1.25,4.3,5.9),(2.65,4.2,5.5),(3.95,3.7,5.2),(5.05,3.0,4.2),(6.1,2.4,3.5)]
    for j,(z,w,d) in enumerate(tiers):
        for i in range(sides):
            a=i*math.tau/sides+j*.035
            v.append((math.cos(a)*w+rng.uniform(-.4,.4),math.sin(a)*d+rng.uniform(-.5,.5),z+rng.uniform(-.45,.45)))
    for j in range(len(tiers)-1):
        for i in range(sides):
            a=j*sides+i;b=j*sides+(i+1)%sides;f.extend([(a,b,b+sides),(a,b+sides,a+sides)])
    f.append(tuple(range((len(tiers)-1)*sides,len(tiers)*sides)))
    f.append(tuple(reversed(range(sides))))
    m=mesh('AngularRockFace',v,f,'dust')
    for face in m.data.polygons:
        c=rng.choice([(.61,.20,.07,1),(.75,.30,.12,1),(.54,.16,.05,1),(.70,.25,.10,1)])
        for li in face.loop_indices:m.data.color_attributes['Color'].data[li].color=c
    rock_mat=mat.copy();rock_mat.name='WarmRedRock_AmbientFill'
    rock_bsdf=next(n for n in rock_mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    rock_bsdf.inputs['Emission Color'].default_value=(.08,.025,.012,1)
    rock_bsdf.inputs['Emission Strength'].default_value=1
    p=[m]
    for i in range(7):
        a=i*math.tau/7
        p.append(ico((math.cos(a)*3.2,math.sin(a)*4.6,.4),(.6+rng.random()*.5,.5+rng.random()*.6,.5+rng.random()*.4),'dust',1))
    for o in p:o.data.materials.clear();o.data.materials.append(rock_mat)
    pack(p,'CliffMesh',r);return r

def tree():
    r=root('Tree')
    p=[rod((0,0,0),(0,0,2.3),.16,'wood',6),ico((0,0,2.35),(1.05,.9,1.05),'green',1),
       ico((-.65,0,2.15),(.65,.65,.74),'leaf',1),ico((.55,.1,2.55),(.75,.65,.77),'leaf',1)]
    pack(p,'TreeMesh',r)
    return r

def forest_tree():
    r=root('ForestCanopyTree')
    p=[rod((0,0,0),(0,0,2.2),.13,'wood',6)]
    crowns=[(0,0,2.6,1.05),(-.72,.05,2.2,.86),(.72,.1,2.35,.82),
            (.1,.65,2.35,.82),(-.08,-.62,2.25,.80),(.22,-.1,3.13,.67)]
    palette=[(.065,.18,.047,1),(.095,.24,.061,1),(.12,.27,.075,1)]
    for i,(x,y,z,size) in enumerate(crowns):
        p.append(ico((x,y,z),(size,size*.86,size*.80),palette[i%3],1))
        if i in (1,2):p.append(rod((0,0,1.5),(x,y,z),.055,'wood',5))
    pack(p,'ForestCanopyMesh',r);return r

def hut():
    r=root('Hut')
    p=[cube((0,0,1.2),(3.5,2.8,2.4),'cream')]
    p.append(mesh('Roof',[(-2,-1.65,2.3),(2,-1.65,2.3),(0,-1.65,3.3),(-2,1.65,2.3),(2,1.65,2.3),(0,1.65,3.3)],
                  [(0,1,2),(3,5,4),(0,2,5,3),(1,4,5,2)],'roof'))
    p += [cube((0,1.409,.82),(.72,.03,1.62),'wood'),cube((1.05,1.409,1.38),(.65,.03,.7),'glass'),
          cube((-1.05,1.409,1.38),(.65,.03,.7),'glass'),cube((0,2.03,1.93),(3.7,1.25,.13),'olive')]
    for side in [-1,1]: p.append(rod((side*1.65,2.48,0),(side*1.65,2.48,1.98),.07,'wood'))
    pack(p,'HutMesh',r)
    return r

def village_house(longhouse=False):
    r=root('VillageLonghouse' if longhouse else 'VillageHouse')
    width=5.8 if longhouse else 3.5;depth=3.3;wall=2.5 if longhouse else 4.35
    peak=wall+1.0;p=[cube((0,0,wall/2),(width,depth,wall),(.74,.69,.52,1))]
    w=width/2+.22;d=depth/2+.24
    p.append(mesh('VillageTileRoof',[(-w,-d,wall),(w,-d,wall),(0,-d,peak),(-w,d,wall),(w,d,wall),(0,d,peak)],
        [(0,1,2),(3,5,4),(0,2,5,3),(1,4,5,2)],(.53,.15,.067,1)))
    # Tile courses, shutters and balconies give the distant silhouettes distinct breaks.
    for side in [-1,1]:
        for i in range(7):
            x=side*(i+.45)*w/7;z=peak-abs(x)/w
            p.append(rod((x,-d,z+.013),(x,d,z+.013),.018,(.59,.19,.081,1),5))
    floors=[1.2] if longhouse else [1.2,3.25]
    for z in floors:
        for x in [-width*.28,width*.28]:
            for side in [-1,1]:
                y=side*(depth/2+.012)
                p.append(cube((x,y,z),(.57,.025,.74),'wood'))
                p.append(cube((x,y+side*.016,z),(.40,.025,.61),(.045,.11,.14,1)))
                for shutter in [-1,1]:p.append(cube((x+shutter*.39,y,z),(.19,.06,.76),(.24,.30,.15,1)))
    p.append(cube((0,d-.21,.88),(.66,.035,1.76),'wood'))
    if longhouse:
        p.append(cube((0,d+.48,.06),(width+1,1.4,.12),(.46,.42,.32,1)))
        p.append(cube((0,d+.43,2.22),(width+.4,1.3,.11),'roof'))
        for x in [-width/2,width/2]:p.append(rod((x,d+1,0),(x,d+1,2.23),.06,'wood',6))
    else:
        p.append(cube((0,d+.23,2.72),(width+.24,.76,.13),'cream'))
        for x in [-width/2,0,width/2]:p.append(rod((x,d+.55,2.77),(x,d+.55,3.28),.025,'wood',5))
        p.append(rod((-width/2,d+.55,3.28),(width/2,d+.55,3.28),.028,'wood',5))
    pack(p,'VillageHouseMesh',r);return r

def gate():
    r=root('Gate')
    p=[cube((-5.1,0,2),(.25,.28,4),'wood'),cube((5.1,0,2),(.25,.28,4),'wood'),
       cube((0,0,3.86),(10.5,.24,.64),'yellow')]
    for i in range(20):
        p.append(cube((-4.75+i*.5,.14,3.8),(.5,.025,.24),'black' if i%2 else 'white'))
    pack(p,'GateMesh',r)
    return r

def simple(name, build):
    r=root(name); pack(build(),name+'Mesh',r); return r

assets['bicycle']=bicycle(); assets['rider']=rider(); assets['banana']=banana();assets['looseBanana']=banana(1)
collected_rack=cargo()
assets['truck']=truck(); assets['car']=car(); assets['pedestrian']=pedestrian(); assets['goat']=goat()
# Compact the goat, including horn tips, to its 0.8 m jumpable silhouette.
for obj in assets['goat'].children_recursive:
    obj.location.z*=.634
    if obj.type=='MESH':
        for vertex in obj.data.vertices:vertex.co.z*=.634
assets['palm']=palm(); assets['tree']=tree(); assets['hut']=hut(); assets['gate']=gate()
assets['forestTree']=forest_tree();assets['villageHouse']=village_house();assets['villageLonghouse']=village_house(True)
assets['foundation']=simple('VillageStoneFoundation',lambda:[cube((0,0,.5),(1,1,1),(.34,.31,.24,1))])
assets['bananaPlant']=banana_plant();assets['stall']=stall();assets['cliff']=cliff()
assets['rock']=simple('Rock',lambda:[ico((0,0,.35),(.62,.46,.42),'dust',1)])
assets['crate']=simple('Crate',lambda:[cube((0,0,.425),(1.5,1.2,.85),'wood')]+[cube((0,y,.425),(1.51,.035,.10),'cream') for y in [-.61,.61]])
assets['dust']=simple('Dust',lambda:[ico((0,0,0),(1,1,1),'dust',1)])
assets['spark']=simple('Spark',lambda:[ico((0,0,0),(.12,.12,.8),'yellow',1)])
def burst():
    r=root('KickBurst');parts=[]
    radius=.35;inner=.145;verts=[(0,0,0)]
    rays=[.90,.93,.70,1.55,.72,.85,.94,.85]
    for i in range(16):
        a=i*math.tau/16;rad=radius*rays[i//2] if i%2==0 else inner
        verts.append((math.cos(a)*rad,0,math.sin(a)*rad))
    parts.append(mesh('KickFlash',verts,[(0,i+1,(i+1)%16+1) for i in range(16)],(.98,.77,.155,1)))
    pack(parts,'BurstMesh',r);return r
assets['burst']=burst()
assets['cloud']=simple('Cloud',lambda:[ico((0,0,0),(2.2,1,.75),'white',1),ico((1.4,0,.2),(1.4,.8,.7),'white',1),ico((-1.2,0,.1),(1.1,.9,.7),'white',1)])
assets['sign']=simple('Sign',lambda:[rod((0,0,0),(0,0,1.7),.06,'wood'),cube((0,0,1.8),(1,.10,.62),'yellow'),
                                         rod((-.17,.062,1.61),(.12,.062,1.8),.035,'black',5),rod((.12,.062,1.8),(-.17,.062,1.99),.035,'black',5)])
assets['bush']=simple('Bush',lambda:[ico((math.cos(i*2.4)*.48,math.sin(i*2.4)*.4,.25+(i%3)*.17),(.26,.22,.25),
                                    'green' if i%3 else 'leaf',1) for i in range(14)])
assets['tower']=simple('VillageTower',lambda:[cube((0,0,2.4),(1.9,1.7,4.8),'cream'),
    cube((0,.865,3.5),(.55,.035,.85),'black'),cube((0,.87,3.5),(.36,.04,.7),'glass'),
    mesh('TowerRoof',[(-1.15,-1.05,4.8),(1.15,-1.05,4.8),(1.15,1.05,4.8),(-1.15,1.05,4.8),(0,0,6.1)],
          [(0,1,4),(1,2,4),(2,3,4),(3,0,4)],'roof')])
def mountain(forest=False):
    r=root('ForestHill' if forest else 'Mountain');v=[];f=[];nx=36;ny=27
    peaks=[(-.65,-.12,.44,.44,.78),(-.28,.12,.61,.40,.72),
           (.27,.10,.82,.43,.80),(.66,-.03,.30,.35,.66),(-.05,.57,.25,.58,.37)]
    for j in range(ny):
        y=j/(ny-1)*2-1
        for i in range(nx):
            x=i/(nx-1)*2-1
            # Connected angular ridges with secondary spurs and narrow eroded gullies.
            h=sum(level*math.exp(-((x-cx)/width)**2-((y-cy)/depth)**2)
                  for cx,cy,level,width,depth in peaks)
            h*=max(0,1-abs(x)**6)*max(0,1-abs(y)**4)
            h*=1+.055*math.sin(x*37+y*18)+.025*math.sin(x*71-y*29)
            v.append((x,y,h))
    height_scale=(.39 if forest else .80)/max(p[2] for p in v)
    v=[(x,y,h*height_scale-(.14*max(abs(x),abs(y))**8 if forest else 0)) for x,y,h in v]
    for j in range(ny-1):
        for i in range(nx-1):
            a=j*nx+i;f.extend([(a,a+1,a+nx),(a+1,a+nx+1,a+nx)])
    if forest:
        edge=list(range(nx))+[j*nx+nx-1 for j in range(1,ny)]+list(range((ny-1)*nx+nx-2,(ny-1)*nx-1,-1))+[j*nx for j in range(ny-2,0,-1)]
        bottom=len(v)
        v.extend([(v[i][0],v[i][1],-.45) for i in edge])
        for i,a in enumerate(edge):
            b=edge[(i+1)%len(edge)];f.append((a,b,bottom+(i+1)%len(edge),bottom+i))
    m=mesh('MountainRidges',v,f,(.18,.34,.47,1));attr=m.data.color_attributes['Color']
    for face in m.data.polygons:
        p=face.center
        # Broad vegetation/rock masses, rather than independently noisy triangle colors.
        patch=math.sin(p.x*14+p.y*9)+.55*math.cos(p.x*27-p.y*17)
        palette=[(.065,.19,.033,1),(.095,.24,.045,1),(.14,.29,.068,1),(.08,.21,.037,1)] if forest else [(.075,.22,.39,1),(.10,.28,.47,1),(.14,.34,.54,1),(.085,.25,.43,1)]
        c=palette[min(3,max(0,int((patch+1.55)/3.1*4)))]
        for li in face.loop_indices:attr.data[li].color=c
    pack([m],'MountainMesh',r);return r
assets['mountain']=mountain()
assets['forestHill']=mountain(True)

def hierarchy(r):
    return [r]+list(r.children_recursive)

def export_selected(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]
    # Blender's multi-color-layer path inserted a white COLOR_0 before the real Color.
    # Keep source evidence intact, but give the exporter exactly one native color layer.
    unique={o.data.as_pointer():o.data for o in objs if o.type=='MESH'}
    backups=[]
    try:
        for data in unique.values():
            base=data.color_attributes.get('AOBaseColor')
            if base:
                original=np.empty(len(base.data)*4,dtype=np.float32);base.data.foreach_get('color',original)
                backups.append((data,base.data_type,base.domain,original))
                data.color_attributes.remove(base)
            color_index=next(i for i,a in enumerate(data.color_attributes) if a.name=='Color')
            data.color_attributes.active_color_index=color_index;data.color_attributes.render_color_index=color_index
        bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
                                  export_animations=False,export_yup=True,export_extras=True,export_vertex_color='ACTIVE')
    finally:
        for data,kind,domain,original in backups:
            base=data.color_attributes.new(name='AOBaseColor',type=kind,domain=domain)
            base.data.foreach_set('color',original)
            color_index=next(i for i,a in enumerate(data.color_attributes) if a.name=='Color')
            data.color_attributes.active_color_index=color_index;data.color_attributes.render_color_index=color_index

# New obstacle/pickup shapes are all authored in this Blender process.
for obsolete in ['gate','cargo']:
    old_root=assets.pop(obsolete,None)
    if old_root:
        for obj in list(old_root.children_recursive)+[old_root]:bpy.data.objects.remove(obj,do_unlink=True)
assets['barrier']=simple('LowBarrier',lambda:[cube((0,0,.35),(2.2,.28,.30),'yellow'),
    cube((-1,0,.18),(.13,.7,.36),'black'),cube((1,0,.18),(.13,.7,.36),'black')]+
    [cube((-.88+i*.35,-.15,.35),(.16,.015,.31),'black') for i in range(6)])
assets['wall']=simple('HighWall',lambda:[cube((0,0,1.4),(3.2,1,2.8),'roof')]+
    [cube((0,-.51,z),(3.22,.03,.035),'cream') for z in [.45,.95,1.45,1.95,2.45]]+
    [cube((x,-.515,2.2),(.03,.025,.48),'cream') for x in [-1.1,0,1.1]])
def train():
    r=root('LongTrain');p=[cube((0,0,1.65),(2.6,14,2.7),(.018,.22,.31,1)),cube((0,0,2.98),(2.62,14.05,.04),'steel')]
    for side in [-1,1]:
        p.append(cube((side*1.305,0,.65),(.025,13.9,.24),'yellow'))
        for y in [-5,-3,-1,1,3,5]:
            p.extend([cube((side*1.31,y,2.1),(.03,1.4,.78),'glass'),cube((side*1.332,y,2.1),(.035,.04,.82),'cream')])
        for y in [-5.6,5.6]:p+=tire((side*1.12,y,.38),.37,.19)
    for y in [-7.015,7.015]:
        p.extend([cube((0,y,1.98),(1.9,.04,1.0),'glass'),cube((0,y,.75),(2.35,.08,.20),'yellow')])
        for x in [-.8,.8]:p.append(ico((x,y*1.002,.9),(.10,.04,.10),'white',1))
    pack(p,'TrainMesh',r);return r
assets['train']=train()
def pickup(kind):
    r=root('Pickup_'+kind);p=[]
    if kind=='shield':
        pts=[(-.48,0,.42),(.48,0,.42),(.43,0,-.17),(0,0,-.57),(-.43,0,-.17)]
        p.append(mesh('ShieldBadge',pts,[(0,1,2,3,4)],(.03,.36,.88,1)))
        p.extend(rod(a,b,.045,'cream',8) for a,b in zip(pts,pts[1:]+pts[:1]))
        p.extend([rod((0,-.035,-.22),(0,-.035,.25),.04,'white',8),rod((-.19,-.035,.02),(.19,-.035,.02),.04,'white',8)])
    elif kind=='boost':
        for offset in [-.24,.14]:
            p.extend([rod((-.3,0,offset-.16),(0,0,offset+.10),.09,(.012,.68,.40,1),8),rod((0,0,offset+.10),(.3,0,offset-.16),.09,(.012,.68,.40,1),8)])
    else:
        purple=(.40,.045,.76,1)
        p=[ico((0,.03,0),(.57,.13,.57),purple,2)]
        p.extend([rod((-.32,-.14,-.13),(-.12,-.14,.13),.035,'white',8),rod((-.32,-.14,.13),(-.12,-.14,-.13),.035,'white',8)])
        glyph=[(.04,-.15,.22),(.27,-.15,.22),(.31,-.15,.13),(.07,-.15,-.20),(.34,-.15,-.20)]
        p.extend(rod(a,b,.035,'white',8) for a,b in zip(glyph,glyph[1:]))
    pack(p,'PickupMesh_'+kind,r);return r
for kind in ['boost','shield','double']:assets[kind]=pickup(kind)
# A painted raster tile is packed by local Blender, with an explicit UV and vertex palette.
rng=np.random.default_rng(2817);yy,xx=np.mgrid[0:256,0:256]/256
asphalt_pixels=np.ones((256,256,4),dtype=np.float32)
grains=rng.uniform(-.036,.036,(256,256))
brush=.020*np.sin(xx*math.tau*13+np.sin(yy*math.tau)*.9)+.025*np.sin(xx*math.tau*3)
patch=.025*np.cos(yy*math.tau*3+xx*math.tau*2)
asphalt_pixels[:,:,:3]=np.clip(.92+grains+brush+patch,.78,1)[:,:,None]
asphalt_image=bpy.data.images.new('Asphalt_Painted_Grain',width=256,height=256,alpha=False)
asphalt_image.pixels.foreach_set(asphalt_pixels.ravel());asphalt_image.update();asphalt_image.pack()
asphalt_mat=mat.copy();asphalt_mat.name='Painted_Asphalt_VertexTint'
asphalt_bsdf=next(n for n in asphalt_mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
asphalt_tex=asphalt_mat.node_tree.nodes.new('ShaderNodeTexImage');asphalt_tex.image=asphalt_image
mix=asphalt_mat.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
asphalt_vc=next(n for n in asphalt_mat.node_tree.nodes if n.type=='VERTEX_COLOR')
asphalt_mat.node_tree.links.new(asphalt_vc.outputs['Color'],mix.inputs[1]);asphalt_mat.node_tree.links.new(asphalt_tex.outputs['Color'],mix.inputs[2])
asphalt_mat.node_tree.links.new(mix.outputs[0],asphalt_bsdf.inputs['Base Color'])
def road_tile():
    r=root('EndlessRoadTile');xs=[-42,-36,-30,-25,-21,-18,-15,-13,-11,-9.5,-8,-7,-6.3,-5.6,-5.2,0,5.2,5.6,7,10,15,22,30,42];rows=41;step=2
    v=[];f=[];heights=[]
    for j in range(rows):
        along=j*step
        for x in xs:
            distance=max(0,abs(x)-5.6)
            # A continuous sculpted road cut: the negative-X side is uphill/screen right.
            # The playable asphalt and guard coordinates stay unchanged.
            if x<0:
                bank_x=[5.6,7,10,15,22,30,42]
                bank_z=[-.15,1.8,7.0,9.0,12.0,14.0,17.0]
                h=float(np.interp(abs(x),bank_x,bank_z))
            else:h=-.15-distance*.42
            # This straight template remains a regular height grid. The authored curved
            # course adds periodic rock relief before export; Rapier loads those meshes.
            v.append((x,-along,h));heights.append(h)
    for j in range(rows-1):
        for i in range(len(xs)-1):
            a=j*len(xs)+i;f.extend([(a,a+len(xs)+1,a+1),(a,a+len(xs),a+len(xs)+1)])
    ground=mesh('RoadsideTerrain',v,f,'dust')
    for polygon in ground.data.polygons:
        middle=sum((ground.data.vertices[i].co for i in polygon.vertices),Vector())/3
        if -15<middle.x<-6:
            palette=[(.54,.21,.075,1),(.66,.29,.12,1),(.43,.15,.05,1),(.60,.24,.095,1)]
        else:palette=[(.45,.19,.085,1),(.50,.23,.11,1),(.38,.17,.078,1)] if abs(middle.x)<11 else [(.13,.29,.055,1),(.19,.34,.070,1),(.16,.31,.060,1)]
        shade=palette[(polygon.index*7)%len(palette)]
        for index in polygon.loop_indices:ground.data.color_attributes['Color'].data[index].color=shade
    ground.parent=r;r['terrainGrid']={'x':xs,'rows':rows,'step':step,'heights':heights}
    def ribbon(name,x,width,bottom,top,color):
        vertices=[(x+dx,-j*2,h) for j in range(41) for dx,h in [(-width/2,top),(width/2,top),(-width/2,bottom),(width/2,bottom)]]
        faces=[]
        for j in range(40):
            a=j*4;faces.extend([(a,a+4,a+5,a+1),(a+2,a+3,a+7,a+6),(a,a+2,a+6,a+4),(a+1,a+5,a+7,a+3)])
        faces.extend([(0,1,3,2),(160,162,163,161)])
        return mesh(name,vertices,faces,color)
    asphalt=ribbon('PaintedRoadSurface',0,10.4,-.24,0,(.16,.17,.18,1));asphalt.parent=r
    asphalt.data.materials.clear();asphalt.data.materials.append(asphalt_mat)
    uv=asphalt.data.uv_layers.active or asphalt.data.uv_layers.new(name='RoadUV')
    for loop in asphalt.data.loops:
        x,y,_=asphalt.data.vertices[loop.vertex_index].co;uv.data[loop.index].uv=((x+5.2)/10.4,y/8)
    p=[]
    for side in [-1,1]:
        p.append(ribbon('RoadEdge',side*5.0,.12,-.001,.017,'cream'))
        for n in range(40):
            y=-(n+.5)*2;top=.42+(.02 if n%4==0 else 0)
            p.append(cube((side*5.62,y,top/2),(.36,1.94,top),(.40+(n%3)*.018,.41+(n%3)*.018,.36,1)))
    for x in [-.10,.10]:p.append(ribbon('DoubleYellow',x,.075,.002,.022,'yellow'))
    pack(p,'StoneGuardrailsAndMarkings',r);return r
assets['roadTile']=road_tile()
assets['lake']=simple('BackdropLake',lambda:[cube((0,0,-.3),(1200,1800,.05),(.032,.31,.67,1))])

# One native Blender road period; rules and rendering consume the exact same samples.
course_data={'mode':'endless','seed':2817,'chunkLength':80,'lookAhead':480,'step':2,'points':[]}
def heading(s):return .9*math.sin(s/800*math.tau)+.15*math.sin(s/400*math.tau)
cx=cz=0;horizontal=math.sqrt(1-.04**2)
for s in range(0,1601,2):
    if s:
        angle=heading(s-1);cx+=2*horizontal*math.sin(angle);cz+=2*horizontal*math.cos(angle)
    course_data['points'].append({'s':s,'x':cx,'y':-.04*s,'z':cz,'yaw':heading(s)})
course_data['points'][-1]['x']=0
course_data['road']={'period':1600,'advance':{'x':0,'y':-64,'z':cz}}
def route(s):
    cycle=math.floor(s/1600);local=s-cycle*1600;i=min(799,math.floor(local/2));a,b=course_data['points'][i:i+2];t=(local-a['s'])/2
    return Vector((a['x']+(b['x']-a['x'])*t,-(a['z']+(b['z']-a['z'])*t+cycle*cz),-.04*s)),a['yaw']+(b['yaw']-a['yaw'])*t
def ground_patches(vertices,faces):
    patches=[]
    for face in faces:
        triangle=[vertices[i] for i in face]
        patches.append((triangle,(min(p.x for p in triangle),max(p.x for p in triangle),
                                  min(p.y for p in triangle),max(p.y for p in triangle))))
    return patches

def occupied_surface(patches,polygon):
    """Exact extrema over a complete footprint on piecewise-planar native terrain."""
    bounds=(min(p.x for p in polygon),max(p.x for p in polygon),min(p.y for p in polygon),max(p.y for p in polygon))
    sign=1 if sum(a.x*b.y-b.x*a.y for a,b in zip(polygon,polygon[1:]+polygon[:1]))>0 else -1
    points=[]
    for triangle,box in patches:
        if bounds[0]>box[1] or bounds[1]<box[0] or bounds[2]>box[3] or bounds[3]<box[2]:continue
        clipped=triangle[:]
        for a,b in zip(polygon,polygon[1:]+polygon[:1]):
            if not clipped:break
            out=[]
            for u,v in zip(clipped,clipped[1:]+clipped[:1]):
                fu=sign*((b.x-a.x)*(u.y-a.y)-(b.y-a.y)*(u.x-a.x))
                fv=sign*((b.x-a.x)*(v.y-a.y)-(b.y-a.y)*(v.x-a.x))
                if fu>=-1e-8:out.append(u)
                if (fu>=-1e-8)!=(fv>=-1e-8):out.append(u.lerp(v,fu/(fu-fv)))
            clipped=out
        points.extend(clipped)
    if not points:raise RuntimeError('Scenery footprint misses the native terrain')
    return points

def roadside_course():
    r=root('EndlessRoadCourse');chunks=[];terrain_vertices=[];terrain_faces=[]
    for segment in range(20):
        chunk=road_tile();chunk.name='CourseChunk_'+str(segment);chunk.parent=r;chunk['segment']=segment;chunks.append(chunk)
        for obj in chunk.children:
            role='terrain' if obj.name.startswith('RoadsideTerrain') else 'road' if obj.name.startswith('PaintedRoadSurface') else 'guard'
            obj['surfaceRole']=role;obj['segment']=segment
            # Apply every source transform before bending the native mesh in Blender.
            obj.data.transform(obj.matrix_local);obj.matrix_basis=Matrix.Identity(4)
            if role=='terrain':
                for vertex in obj.data.vertices:
                    p=vertex.co;along=segment*80-p.y;phase=along/1600*math.tau
                    weight=min(1,max(0,(-p.x-7)/3))
                    p.z+=weight*(.68*math.sin(phase*73-p.x*.34)+.28*math.sin(phase*149+p.x*.57))
                    p.x+=weight*.65*math.sin(phase*113+p.x*.31)
                obj.data.update()
                palette=[(.47,.17,.065,1),(.62,.25,.095,1),(.35,.10,.034,1),(.54,.20,.074,1)]
                for polygon in obj.data.polygons:
                    middle=sum((obj.data.vertices[i].co for i in polygon.vertices),Vector())/len(polygon.vertices)
                    if middle.x<-6:
                        along=segment*80-middle.y
                        phase=along/1600*math.tau
                        patch=math.sin(phase*73+middle.x*.43)+.65*math.cos(phase*149-middle.x*.26)
                        shade=palette[min(3,max(0,int((patch+1.65)/3.3*4)))]
                        for li in polygon.loop_indices:obj.data.color_attributes['Color'].data[li].color=shade
            for vertex in obj.data.vertices:
                p=vertex.co.copy();along=segment*80-p.y;center,yaw=route(along)
                vertex.co=center+Vector((p.x*math.cos(yaw),p.x*math.sin(yaw),p.z))
            obj.data.update()
            if role=='terrain':
                offset=len(terrain_vertices);terrain_vertices.extend(vertex.co.copy() for vertex in obj.data.vertices)
                terrain_faces.extend(tuple(offset+i for i in polygon.vertices) for polygon in obj.data.polygons)
    ground_bvh=BVHTree.FromPolygons(terrain_vertices,terrain_faces,all_triangles=True)
    terrain_patches=ground_patches(terrain_vertices,terrain_faces)
    def occupied_ground(polygon):
        return occupied_surface(terrain_patches,polygon)
    def ground(x,y):
        hit=ground_bvh.ray_cast(Vector((x,y,300)),Vector((0,0,-1)))[0]
        if hit is None:raise RuntimeError('Roadside object outside the authored terrain: '+str((x,y)))
        return hit.z
    def instance(name,chunk,index,p,scale,yaw):
        source=next(o for o in hierarchy(assets[name]) if o.type=='MESH')
        obj=source.copy();obj.data=source.data;obj.animation_data_clear();obj.name='Road_'+name+'_'+str(index)
        bpy.context.collection.objects.link(obj);obj.parent=chunk;obj.location=p;obj.rotation_mode='XYZ';obj.rotation_euler=(0,0,yaw)
        obj.scale=scale if isinstance(scale,tuple) else (scale,scale,scale);obj['kind']=name
        return obj
    def place(name,segment,along,x,scale,yaw,index):
        center,angle=route(segment*80+along);p=center+Vector((x*math.cos(angle),x*math.sin(angle),0));p.z=ground(p.x,p.y)
        return instance(name,chunks[segment],index,p,scale,yaw-angle)
    def building(name,segment,along,x,scale,yaw,index):
        obj=place(name,segment,along,x,scale,yaw,index);bpy.context.view_layer.update()
        source=next(o for o in hierarchy(assets[name]) if o.type=='MESH');bounds=[source.matrix_local@Vector(c) for c in source.bound_box]
        xmin,xmax=min(p.x for p in bounds)*scale,max(p.x for p in bounds)*scale
        ymin,ymax=min(p.y for p in bounds)*scale,max(p.y for p in bounds)*scale
        width,depth=xmax-xmin+.3,ymax-ymin+.3;rotation=obj.rotation_euler.to_matrix()
        center=obj.location+rotation@Vector(((xmin+xmax)/2,(ymin+ymax)/2,0))
        corners=[center+rotation@Vector((u*width,v*depth,0)) for u,v in [(-.5,-.5),(.5,-.5),(.5,.5),(-.5,.5)]]
        heights=[p.z for p in occupied_ground(corners)]
        top,bottom=max(heights)+.015,min(heights)-.20;obj.location.z=top;center.z=bottom
        base=instance('foundation',chunks[segment],index,center,(width,depth,top-bottom),obj.rotation_euler.z);base['building']=obj.name
        base['groundSupport']={'method':'complete terrain polygon clipping','heightMin':min(heights),'heightMax':max(heights)}
    layout=random.Random(2917)
    for segment in range(20):
        for i in range(14):
            along=3+layout.random()*74;side=1 if i%2 else -1;index=segment*100+i
            for name,x,scale in [('palm',side*(8+layout.random()*7),.9+layout.random()*.8),('bananaPlant',side*(6.8+layout.random()*8),1+layout.random()*.65),('bush',side*(7+layout.random()*14),.8+layout.random()*1.1)]:
                place(name,segment,along,x,scale,layout.random()*math.tau,index)
            if i<7:place('tree',segment,along,side*(15+layout.random()*13),1.5,layout.random()*math.tau,index)
            if i<3:place('rock',segment,along,side*(6.1+layout.random()*15),.55,layout.random()*math.tau,index)
        if segment%2==0:
            cliff=place('cliff',segment,36,-24,1.2,segment*.2,segment);bpy.context.view_layer.update()
            cliff.data.calc_loop_triangles();gaps=[]
            for triangle in cliff.data.loop_triangles:
                if not all(i<12 for i in triangle.vertices):continue
                cap=[cliff.matrix_world@cliff.data.vertices[i].co for i in triangle.vertices]
                a,b,c=cap;normal=(b-a).cross(c-a)
                for p in occupied_ground(cap):
                    bottom=a.z-(normal.x*(p.x-a.x)+normal.y*(p.y-a.y))/normal.z
                    gaps.append(bottom-p.z)
            cliff.location.z-=max(0,max(gaps)+.15)
            cliff['groundSupport']={'method':'complete sealed-bottom clipping','buriedBy':.15}
        if segment%3==0:building('hut',segment,26,14,1,.2,segment)
        if segment%4==0:building('stall',segment,37,-12,.9,math.pi,segment)
        place('sign',segment,8,-6.4,.85,0,segment)
    r['period']=1600;r['advance']=course_data['road']['advance'];r['style_reference']='style-a.png';return r
assets['roadCourse']=roadside_course()

def valley():
    """Author the complete distant layout here; Three.js only batches these transforms."""
    r=root('EndlessValley');water_level=-32;layout_rng=random.Random(9128)
    period=1600;nx,ny=67,93;xs=np.linspace(-100,1000,nx);ss=np.linspace(0,period,ny)
    z_scale=course_data['road']['advance']['z']/period
    def author_point(x,s,z=0):
        center,_=route(s)
        return Vector((center.x+x,center.y/z_scale,z))
    def height(x,s):
        x=-x
        river=-420+60*math.sin((s-300)/period*math.tau)
        bank=abs(x-river)-(85+12*math.sin(s/period*math.tau+.5))
        h=water_level-3+max(0,bank)*.082
        h+=5*math.sin(x*.010+s/period*math.tau*2)*min(1,max(0,bank)/80)
        for cx,cs,level in [(-125,305,-25),(-710,680,-27)]:
            ds=(s-cs+period/2)%period-period/2
            t=((x-cx)/100)**2+(ds/150)**2;blend=math.exp(-t*t)
            h=h*(1-blend)+level*blend
        return h-.04*s
    vertices=[tuple(author_point(float(x),float(s),height(float(x),float(s)))) for s in ss for x in xs];faces=[]
    for j in range(ny-1):
        for i in range(nx-1):
            a=j*nx+i;faces.extend([(a,a+nx+1,a+1),(a,a+nx,a+nx+1)])
    land=mesh('ValleyTerrain',vertices,faces,'green');land.parent=r
    for loop in land.data.loops:
        point=land.data.vertices[loop.vertex_index].co;s=float(ss[loop.vertex_index//nx]);x=float(xs[loop.vertex_index%nx])
        if point.z<water_level-.04*s+2:shade=(.38,.32,.15,1)
        else:
            patch=math.sin(x*.037-s/period*math.tau*3)+math.cos(s/period*math.tau*4)
            shade=[(.11,.25,.043,1),(.16,.30,.060,1),(.20,.34,.08,1)][0 if patch<-.65 else 2 if patch>.65 else 1]
        land.data.color_attributes['Color'].data[loop.index].color=shade
    vectors=[Vector(v) for v in vertices];bvh=BVHTree.FromPolygons(vectors,faces,all_triangles=True)
    patches=ground_patches(vectors,faces)
    def ground(x,y):
        hit=bvh.ray_cast(Vector((x,y,300)),Vector((0,0,-1)))[0]
        return hit.z if hit else None
    image=bpy.data.images.new('Valley_Water_Ripples',width=256,height=256,alpha=False)
    pixels=np.ones((256,256,4),dtype=np.float32)
    ripples=.006*np.sin(yy*math.tau*36+.9*np.sin(xx*math.tau*3))+.004*np.cos(yy*math.tau*7+xx*math.tau)
    pixels[:,:,:3]=np.clip(.90+ripples,.8,1)[:,:,None];image.pixels.foreach_set(pixels.ravel());image.update();image.pack()
    water_mat=asphalt_mat.copy();water_mat.name='Valley_Painted_Water'
    next(n for n in water_mat.node_tree.nodes if n.type=='TEX_IMAGE').image=image
    water_vertices=[author_point(x,float(s),water_level-.02-.04*float(s)) for s in ss for x in (-100,1000)]
    water_faces=[]
    for j in range(ny-1):
        a=j*2;water_faces.extend([(a,a+3,a+1),(a,a+2,a+3)])
    water=mesh('ValleyWater',water_vertices,water_faces,(.025,.24,.43,1));water.parent=r
    water_bvh=BVHTree.FromPolygons(water_vertices,water_faces,all_triangles=True)
    def water_at(x,y):
        hit=water_bvh.ray_cast(Vector((x,y,300)),Vector((0,0,-1)))[0]
        return hit.z if hit else None
    water.data.materials.clear();water.data.materials.append(water_mat)
    uv=water.data.uv_layers.active or water.data.uv_layers.new(name='WaterUV')
    for loop in water.data.loops:
        x,y,_=water.data.vertices[loop.vertex_index].co;uv.data[loop.index].uv=(x/85,y/100)
    groups={name:root(name) for name in ['ValleyVillageHouse','ValleyVillageLonghouse','ValleyTower','ValleyFoundations','ValleyForest','ValleyPalms','ValleyMountains','ValleyFoothills','ValleyClouds',
                                      'ValleyPanoramaForest','ValleyPanoramaHouse','ValleyPanoramaLonghouse','ValleyPanoramaTower','ValleyPanoramaFoundations']}
    for group in groups.values():group.parent=r
    def instance(asset,group,index,position,scale,yaw=0):
        model=assets[asset] if isinstance(asset,str) else asset
        prototype=next(o for o in hierarchy(model) if o.type=='MESH')
        obj=prototype.copy();obj.data=prototype.data;obj.animation_data_clear();obj.name=group+'_'+str(index)
        bpy.context.collection.objects.link(obj);obj.parent=groups[group];obj.location=position;obj.rotation_mode='XYZ';obj.rotation_euler=(0,0,yaw);obj.scale=scale
        return obj
    occupied=[];buildings=[]
    def building(asset,group,x,s,scale,yaw,native_position=None,hill=None):
        prototype=next(o for o in hierarchy(assets[asset]) if o.type=='MESH')
        points=[prototype.matrix_local@Vector(c) for c in prototype.bound_box]
        xmin,xmax=min(p.x for p in points)*scale,max(p.x for p in points)*scale
        ymin,ymax=min(p.y for p in points)*scale,max(p.y for p in points)*scale
        center=Vector(((xmin+xmax)/2,(ymin+ymax)/2,0));width=xmax-xmin+.3;depth=ymax-ymin+.3
        rotation=Euler((0,0,yaw)).to_matrix();position=native_position.copy() if native_position is not None else author_point(x,s)
        centre=position+rotation@center;cx,cy=centre.x,centre.y
        radius=math.hypot(width,depth)/2
        if any(math.hypot(cx-px,cy-py)<radius+pr+1.4 for px,py,pr in occupied):return False
        corners=[centre+rotation@Vector((width*u,depth*v,0)) for u,v in [(-.5,-.5),(.5,-.5),(.5,.5),(-.5,.5)]]
        surface=occupied_surface(hill_patches[hill.name] if hill is not None else patches,corners)
        if hill is None:
            if any(water_at(p.x,p.y) is None or p.z<water_at(p.x,p.y)+1 for p in surface):return False
        elif min(p.z for p in surface)<-24:return False
        samples=[p.z for p in surface]
        top=max([p.z for p in occupied_surface(far_patches,corners)] if hill is not None else samples)+.03
        bottom=min(samples)-.25;i=len(buildings)
        position.z=top;obj=instance(asset,group,i,position,(scale,scale,scale),yaw);obj['courseS']=s;obj['valleyOffset']=x
        obj['footprint']={'width':width,'depth':depth,'center':[center.x,center.y],'samples':samples}
        base=instance(far_foundation if hill is not None else 'foundation','ValleyFoundations',i,(cx,cy,bottom),(width,depth,top-bottom),yaw)
        if hill is not None:
            base.parent=groups['ValleyPanoramaFoundations'];base['groundSource']=hill.name
            obj['sourceFrame']='panorama';base['sourceFrame']='panorama'
        base['building']=obj.name;base['groundSupport']={'method':'complete terrain polygon clipping'}
        occupied.append((cx,cy,radius));buildings.append(obj)
        return True
    settlement_centres=[120,380,640,900,1160,1440];settlements=[]
    for s in settlement_centres:building('tower','ValleyTower',91,s,3.5,0)
    for number,centre_s in enumerate(settlement_centres):
        before=len(buildings)
        for row in range(7):
            for col,x in enumerate([58,78,100,122,146,170,198,222]):
                s=centre_s+(row-3)*18;u=x+2.2*math.sin(row*1.6+number*.7);longhouse=(row+col+number)%5==0
                building('villageLonghouse' if longhouse else 'villageHouse','ValleyVillageLonghouse' if longhouse else 'ValleyVillageHouse',u,s,2.6+(col%3)*.14,-.12*math.sin(row+col+number))
        for row in range(4):
            for col,x in enumerate([690,716,742]):
                building('villageHouse','ValleyVillageHouse',x+3*math.sin(row+number),centre_s+(row-1.5)*22,2.2,-.08)
        settlements.append({'s':centre_s,'houses':len(buildings)-before})
    trees=palms=0;forest_roots=[];palm_roots=[]
    for i in range(50000):
        u=layout_rng.uniform(48,260) if i%4 else layout_rng.uniform(260,985)
        s=layout_rng.uniform(17,period-17);p=author_point(u,s);h=ground(p.x,p.y);w=water_at(p.x,p.y)
        if h is None or w is None or h<w+1.4:continue
        canopy=3.8+layout_rng.random()*1.8
        if any(math.hypot(p.x-px,p.y-py)<pr+canopy*1.6 for px,py,pr in occupied):continue
        density=.58+.30*math.sin(s/period*math.tau*7+u*.018)*math.cos(u*.024)
        if layout_rng.random()>density:continue
        p.z=h
        if i%11==0 and palms<160 and all(math.hypot(p.x-px,p.y-py)>.9 for px,py in forest_roots):
            scale=1.25+layout_rng.random()*.8
            instance('palm','ValleyPalms',palms,p,(scale,scale,scale),layout_rng.random()*math.tau);palms+=1;palm_roots.append((p.x,p.y));continue
        if trees<2400 and all(math.hypot(p.x-px,p.y-py)>.9 for px,py in palm_roots):
            instance('forestTree','ValleyForest',trees,p,(canopy,canopy,3.2+layout_rng.random()*1.9),layout_rng.random()*math.tau);trees+=1;forest_roots.append((p.x,p.y))
        if trees==2400 and palms==160:break
    # Native panoramic rings keep the distant silhouettes present through every authored turn.
    panorama_rng=random.Random(8176)
    for i in range(24):
        angle=i*math.tau/24;radius=1280+panorama_rng.uniform(-70,90)
        instance('mountain','ValleyMountains',i,(radius*math.sin(angle),-radius*math.cos(angle),-65),
                 (270+panorama_rng.random()*70,190+panorama_rng.random()*40,330+panorama_rng.random()*100),angle+(math.pi if i%3==0 else 0))
    for i in range(18):
        angle=(i+.4)*math.tau/18;radius=850+panorama_rng.uniform(-45,65)
        instance('forestHill','ValleyFoothills',i,(radius*math.sin(angle),-radius*math.cos(angle),-25),
                 (235+panorama_rng.random()*55,145+panorama_rng.random()*55,280+panorama_rng.random()*80),angle+(math.pi if i%2==0 else 0))
    # Author small roofs and true canopy silhouettes on the distant hills. They remain
    # in the panorama frame; the two near-valley tiles never duplicate these instances.
    near_buildings=len(buildings);far_tree=assets['forestTree']
    far_foundation=simple('DistantEarthTerrace',lambda:[cube((0,0,.5),(1,1,1),(.10,.20,.038,1))])
    bpy.context.view_layer.update()
    hills=list(groups['ValleyFoothills'].children);hill_patches={};far_vertices=[];far_faces=[]
    for hill in hills:
        native_vertices=[hill.matrix_world@v.co for v in hill.data.vertices]
        hill.data.calc_loop_triangles();native_faces=[tuple(t.vertices) for t in hill.data.loop_triangles]
        hill_patches[hill.name]=ground_patches(native_vertices,native_faces)
        offset=len(far_vertices);far_vertices.extend(native_vertices);far_faces.extend(tuple(offset+i for i in face) for face in native_faces)
    far_patches=ground_patches(far_vertices,far_faces);far_bvh=BVHTree.FromPolygons(far_vertices,far_faces,all_triangles=True)
    far_rng=random.Random(7024)
    for number,hill in enumerate(hills):
        front=-1 if number%2==0 else 1
        p=hill.matrix_world@Vector((.08,front*.18,0))
        if number%3==0:building('tower','ValleyPanoramaTower',0,0,2.25,hill.rotation_euler.z,p,hill)
        for row in range(5):
            for col in range(6):
                x=(col-2.5)*.22+far_rng.uniform(-.028,.028);y=front*(.06+row*.10+far_rng.uniform(-.022,.022))
                p=hill.matrix_world@Vector((x,y,0));longhouse=(row+col+number)%5!=0
                building('villageLonghouse' if longhouse else 'villageHouse','ValleyPanoramaLonghouse' if longhouse else 'ValleyPanoramaHouse',
                         0,0,2.0+far_rng.random()*.24,hill.rotation_euler.z+far_rng.uniform(-.14,.14),p,hill)
    far_roots=[];far_trees=0
    for number,hill in enumerate(hills):
        target=far_trees+200
        for attempt in range(9000):
            p=hill.matrix_world@Vector((far_rng.uniform(-.76,.76),far_rng.uniform(-.66,.70),0))
            hit=far_bvh.ray_cast(Vector((p.x,p.y,300)),Vector((0,0,-1)))[0]
            if hit is None or hit.z<=18:continue
            canopy=6.0+far_rng.random()*2.0
            if any(math.hypot(p.x-px,p.y-py)<pr+canopy*1.65 for px,py,pr in occupied):continue
            if any(math.hypot(p.x-px,p.y-py)<2.5 for px,py in far_roots):continue
            p.z=hit.z;instance(far_tree,'ValleyPanoramaForest',far_trees,p,(canopy,canopy,6.0+far_rng.random()*2.2),far_rng.random()*math.tau)
            far_roots.append((p.x,p.y));far_trees+=1
            if far_trees==target:break
        assert far_trees==target, 'Missing distant native grove on hill '+hill.name
    for i in range(24):
        angle=(i+.18)*math.tau/24;radius=920+panorama_rng.uniform(-140,110);size=6+panorama_rng.random()*4
        instance('cloud','ValleyClouds',i,(radius*math.sin(angle),-radius*math.cos(angle),115+panorama_rng.random()*90),
                 (size,size,size),angle)
    r['panorama']={'mountains':24,'foothills':18,'clouds':24,'trees':far_trees,'buildings':len(buildings)-near_buildings,'layout':'native full angular rings with hillside canopy and villages'}
    r['waterLevel']=water_level;r['grade']=.04;r['buildings']=near_buildings;r['trees']=trees;r['palms']=palms;r['period']=period
    r['settlements']=settlements;r['courseAligned']=True;r['nativeZScale']=z_scale
    r['style_reference']='style-a.png';return r
assets['valley']=valley()

# A native sphere is exported first so the renderer can load its sky while AO finishes.
sky_root=root('SkyDome')
bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,radius=1)
sky_mesh=paint(bpy.context.object,(.38,.62,.76,1));sky_mesh.name='SkySphere';sky_mesh.parent=sky_root
for vertex in sky_mesh.data.vertices:vertex.co.normalize()
sky_mesh.data.update()
for face in sky_mesh.data.polygons:
    face.use_smooth=True
    for li in face.loop_indices:
        z=sky_mesh.data.vertices[sky_mesh.data.loops[li].vertex_index].co.z
        low=(.68,.74,.73);horizon=(.38,.62,.76);high=(.065,.30,.55)
        a,b,t=(horizon,high,z) if z>=0 else (horizon,low,-z)
        sky_mesh.data.color_attributes['Color'].data[li].color=tuple(a[i]+(b[i]-a[i])*t for i in range(3))+(1,)
sky_root['nativePrimitive']='UV sphere';sky_root['radius']=1;sky_root['segments']=32;sky_root['rings']=16
assets['sky']=sky_root
export_selected(OUT/'sky.glb',hierarchy(sky_root))
print('LIGHT_SKY_EXPORTED',str(OUT/'sky.glb'),flush=True)

# Reuse the local Blender-authored heap for gradual roadside collection, preserving old template order.
assets['bananaRack']=collected_rack

AO_TARGETS=['rider','bicycle','banana','looseBanana','truck','car','hut','villageHouse','villageLonghouse',
            'stall','tower','foundation','palm','tree','forestTree','bananaPlant','bush','rock','cliff']
AO_SETTINGS={'method':'local BVH cosine hemisphere','samples':24,'distance':.28,'strength':.30}

def geometry_hash(data):
    vertices=np.empty(len(data.vertices)*3,dtype=np.float32);data.vertices.foreach_get('co',vertices)
    loops=np.empty(len(data.loops),dtype=np.int32);data.loops.foreach_get('vertex_index',loops)
    polygons=np.asarray([(p.loop_start,p.loop_total,p.use_smooth) for p in data.polygons],dtype=np.int32)
    return hashlib.sha256(vertices.tobytes()+loops.tobytes()+polygons.tobytes()).hexdigest()

def bake_vertex_ao(asset):
    bpy.context.view_layer.update()
    objects=[o for o in hierarchy(asset) if o.type=='MESH']
    vertices=[];polygons=[]
    for obj in objects:
        offset=len(vertices);vertices.extend(obj.matrix_world@v.co for v in obj.data.vertices)
        polygons.extend(tuple(offset+i for i in p.vertices) for p in obj.data.polygons)
    # Only this template is in the BVH, never the co-located library or layout instances.
    bvh=BVHTree.FromPolygons(vertices,polygons)
    directions=[]
    for i in range(AO_SETTINGS['samples']):
        u=(i+.5)/AO_SETTINGS['samples'];angle=i*math.pi*(3-math.sqrt(5))
        directions.append((math.sqrt(u)*math.cos(angle),math.sqrt(u)*math.sin(angle),math.sqrt(1-u)))
    for obj in objects:
        data=obj.data
        if data.get('vertexAO'):continue  # Shared prototype data is baked exactly once.
        signature=geometry_hash(data);attr=data.color_attributes['Color']
        original=np.empty(len(attr.data)*4,dtype=np.float32);attr.data.foreach_get('color',original)
        original=original.reshape(-1,4);factors=np.ones(len(data.loops),dtype=np.float32)
        normal_matrix=obj.matrix_world.to_3x3().inverted().transposed()
        for face in data.polygons:
            # Keep rubber and pure black stable; one factor per facet avoids speckled shading.
            if original[list(face.loop_indices),:3].max()<.06:continue
            normal=(normal_matrix@face.normal).normalized()
            if normal.length<.5:continue
            tangent=normal.cross(Vector((0,0,1)) if abs(normal.z)<.9 else Vector((1,0,0))).normalized()
            bitangent=normal.cross(tangent)
            origin=obj.matrix_world@face.center+normal*.0001;occlusion=0
            for x,y,z in directions:
                hit=bvh.ray_cast(origin,tangent*x+bitangent*y+normal*z,AO_SETTINGS['distance'])
                if hit[0] is not None:occlusion+=(1-hit[3]/AO_SETTINGS['distance'])**2
            factor=1-AO_SETTINGS['strength']*occlusion/AO_SETTINGS['samples']
            factors[list(face.loop_indices)]=factor
        base=data.color_attributes.new(name='AOBaseColor',type='FLOAT_COLOR',domain='CORNER')
        base.data.foreach_set('color',original.ravel())
        baked=original.copy();baked[:,:3]*=factors[:,None];attr.data.foreach_set('color',baked.ravel())
        factor_attr=data.attributes.new(name='AOFactor',type='FLOAT',domain='CORNER')
        factor_attr.data.foreach_set('value',factors)
        data.color_attributes.active_color_index=data.color_attributes.find('Color')
        data.color_attributes.render_color_index=data.color_attributes.find('Color')
        after=geometry_hash(data);assert signature==after,'Vertex AO changed native geometry'
        data['vertexAO']={**AO_SETTINGS,'bakeCount':1,'geometryBefore':signature,'geometryAfter':after,
                          'minFactor':float(factors.min()),'changedLoops':int(np.count_nonzero(factors<.99999))}
    print('LIGHT_AO_BAKED',asset.name,flush=True)

for name in AO_TARGETS:bake_vertex_ao(assets[name])
# Linked road/valley instances inherit the same Color data and provenance without another bake.
for obj in bpy.data.objects:
    if obj.type=='MESH' and obj.data.get('vertexAO'):obj['vertexAO']=obj.data['vertexAO'].to_dict()

manifest={'generator':'local Blender bpy','mode':'endless','blenderVersion':bpy.app.version_string,
          'sourceFiles':['assets/blender/asset-library.blend','assets/blender/endless-course.blend','assets/blender/standing-motion.blend','assets/blender/valley-layout.blend'],
          'vertexAO':{**AO_SETTINGS,'assets':AO_TARGETS},'models':{}}
for index,(name,r) in enumerate(assets.items()):
    unique_meshes={o.data.as_pointer():o.data for o in hierarchy(r) if o.type=='MESH'}
    baked=[data['vertexAO'] for data in unique_meshes.values() if data.get('vertexAO')]
    if baked:r['vertexAO']={**AO_SETTINGS,'meshes':len(baked),'minFactor':min(d['minFactor'] for d in baked),
                            'changedLoops':sum(d['changedLoops'] for d in baked),'templatesOnly':name not in AO_TARGETS}
    export_selected(OUT/(name+'.glb'),hierarchy(r))
    triangles=sum(sum(len(poly.vertices)-2 for poly in data.polygons) for data in unique_meshes.values())
    manifest['models'][name]={'file':name+'.glb','triangles':triangles,'source':'assets/blender/asset-library.blend'}
    if baked:manifest['models'][name]['vertexAO']=r['vertexAO'].to_dict()
    r.location=(index%6*7,index//6*17,0)
bpy.context.scene.cursor.location=(0,0,0)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'asset-library.blend'))
# Save a scene that opens on the actual background layout, with linked editable prototypes.
main_scene=bpy.context.scene;valley_scene=bpy.data.scenes.new('ValleyLayout');valley_scene.unit_settings.system='METRIC'
assets['valley'].location=(0,0,0)
for obj in hierarchy(assets['valley']):valley_scene.collection.objects.link(obj)
bpy.context.window.scene=valley_scene
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'valley-layout.blend'))
bpy.context.window.scene=main_scene;bpy.data.scenes.remove(valley_scene)
# Save the actual twenty curved modules and native roadside layout in a dedicated scene.
course_scene=bpy.data.scenes.new('EndlessCourse');course_scene.unit_settings.system='METRIC';assets['roadCourse'].location=(0,0,0)
for obj in hierarchy(assets['roadCourse']):course_scene.collection.objects.link(obj)
bpy.context.window.scene=course_scene;bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'endless-course.blend'))
bpy.context.window.scene=main_scene;bpy.data.scenes.remove(course_scene)
# Rebuild a co-located editable preview of the entire object rig and bicycle.
keep=set(hierarchy(assets['bicycle'])+hierarchy(assets['rider']))
for obj in list(bpy.data.objects):
    if obj not in keep:bpy.data.objects.remove(obj,do_unlink=True)
bike=assets['bicycle'];actor=assets['rider'];bike.location=(0,0,0);actor.location=(0,0,0)
for tag in ['L','R']:bpy.data.objects['Arm_'+tag].animation_data_clear()
def joint_pose(rest_upper,rest_lower,delta,hint):
    distance=delta.length;direction=delta.normalized();a=rest_upper.length;b=rest_lower.length
    along=(a*a-b*b+distance*distance)/(2*distance)
    bend=(hint-direction*hint.dot(direction)).normalized()
    knee=direction*along+bend*math.sqrt(max(0,a*a-along*along))
    upper=rest_upper.normalized().rotation_difference(knee.normalized())
    lower=rest_lower.normalized().rotation_difference(upper.inverted()@(delta-knee).normalized())
    return upper,lower
poses=[(1,0,0,0,0,0),(9,0,0,0,0,math.pi/2),(17,0,0,0,0,math.pi),
       (25,0,0,0,0,math.pi*1.5),(33,0,0,0,0,math.tau),(40,.5,0,0,0,math.tau),(48,1,0,0,0,math.tau),
       (64,1,.035,0,0,math.tau),(80,1,0,0,0,math.tau),(88,1,.12,0,0,math.tau),
       (96,1,.06,1.1,0,math.tau),(104,1,.12,0,0,math.tau),(112,1,0,0,.18,math.tau),
       (120,1,0,0,1,math.tau),(128,1,0,0,0,math.tau),(144,.5,0,0,0,math.tau),(160,0,0,0,0,math.tau)]
for frame,stance,crouch,lift,kick_amount,phase in poses:
    for obj in [bike,actor]:obj.location.z=lift;obj.keyframe_insert(data_path='location',frame=frame)
    crank=bpy.data.objects['Crank'];crank.rotation_mode='XYZ';crank.rotation_euler[0]=phase;crank.keyframe_insert(data_path='rotation_euler',frame=frame)
    for tag in ['L','R']:
        pedal=bpy.data.objects['Pedal_'+tag];pedal.rotation_mode='XYZ';pedal.rotation_euler[0]=-phase;pedal.keyframe_insert(data_path='rotation_euler',frame=frame)
    body=bpy.data.objects['BalanceBody'];body.location=(0,.22*(1-stance)+.04*stance,1.30+.56*stance-crouch)
    body.rotation_euler[0]=.98*(1-stance);body.keyframe_insert(data_path='location',frame=frame);body.keyframe_insert(data_path='rotation_euler',frame=frame)
    body_q=body.rotation_euler.to_quaternion()
    for side,tag in [(-1,'L'),(1,'R')]:
        rest_hip,rest_knee,rest_foot=standing_pose(side)
        hip=Vector((side*.17,body.location.y,body.location.z))
        foot=Vector((side*.21,.035+side*.18*math.sin(phase),.538-side*.18*math.cos(phase))).lerp(rest_foot,stance)
        foot.z+=math.sin(math.pi*stance)*.38
        upper,lower=joint_pose(rest_knee-rest_hip,rest_foot-rest_knee,foot-hip,Vector((0,-1,0)))
        if side==-1 and kick_amount:
            direction=Vector((side*.92,-.22,.24)).normalized()
            upper=upper.slerp((rest_knee-rest_hip).normalized().rotation_difference(direction),kick_amount)
            lower=lower.slerp((rest_foot-rest_knee).normalized().rotation_difference(upper.inverted()@direction),kick_amount)
        leg=bpy.data.objects['Leg_'+tag];leg.location=hip;leg.keyframe_insert(data_path='location',frame=frame)
        joints=[(leg,upper),(bpy.data.objects['Knee_'+tag],lower),(bpy.data.objects['Foot_'+tag],(upper@lower).inverted())]
        shoulder=Vector((side*.27,-.065,.45));ru=Vector((side*.21,-.035,-.13));rl=Vector((side*.20,-.06,.05))
        target=body_q.inverted()@(Vector((side*.36,-.50,1.20))-body.location)
        balancing=shoulder+ru+rl;balancing.z+=math.sin(frame/24*2+side)*.025;target=target.lerp(balancing,stance)
        arm_upper,arm_lower=joint_pose(ru,rl,target-shoulder,Vector((0,0,-1)))
        joints.extend([(bpy.data.objects['Arm_'+tag],arm_upper),(bpy.data.objects['Elbow_'+tag],arm_lower),
                       (bpy.data.objects['Hand_'+tag],(body_q@arm_upper@arm_lower).inverted())])
        for obj,q in joints:
            obj.rotation_mode='QUATERNION';obj.rotation_quaternion=q;obj.keyframe_insert(data_path='rotation_quaternion',frame=frame)
            obj.animation_data.action.name='RidingMotion_'+obj.name
for label,frame in [('坐姿踩踏',1),('切换站姿',40),('站立平衡',48),('跳跃起势',88),('腾空',96),('落地',104),('蓄力',112),('飞踢',120),('恢复坐姿',144)]:
    bpy.context.scene.timeline_markers.new(label,frame=frame)
bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=160;bpy.context.scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'standing-motion.blend'))
(OUT/'course.json').write_text(json.dumps(course_data,separators=(',',':')))
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
# Obsolete finite runtime meshes no longer ship.
for name in ['gate','cargo','course']:
    old=OUT/(name+'.glb')
    if old.exists():old.unlink()
print('BANANA_ASSETS_COMPLETE',json.dumps({k:v['triangles'] for k,v in manifest['models'].items()}))
