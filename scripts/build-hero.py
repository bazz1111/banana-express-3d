"""Independent Blender hero authoring: Rigify controls -> baked deform Actions -> GLB.
Run with Blender --background --factory-startup --python scripts/build-hero.py.
All geometry is authored natively here. No asset-library geometry is reused.
"""
import bpy, addon_utils, math, json
from pathlib import Path
from mathutils import Vector, Quaternion, Matrix
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/export';OUT.mkdir(parents=True,exist_ok=True)
NATIVE=ROOT/'assets/blender';NATIVE.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.render.fps=60
scene['reference']='assets/reference/style-a.png; authored draft, not user-approved turnaround'
addon_utils.enable('rigify',default_set=True,persistent=False)

def collection(name):
    c=bpy.data.collections.new(name);scene.collection.children.link(c);return c
skin_collection=collection('HeroSkinned');author=collection('HeroRigifyAuthoring');fallback=collection('HeroFallback')
def move(obj,c):
    for old in list(obj.users_collection):old.objects.unlink(obj)
    c.objects.link(obj)

def knee_at(hip,ankle):
    d=ankle-hip;length=d.length;d.normalize();along=(.54**2-.48**2+length**2)/(2*length)
    b=Vector((0,-1,0));b=(b-d*b.dot(d)).normalized()
    return hip+d*along+b*math.sqrt(max(0,.54**2-along**2))
positions={'BalanceBody':Vector((0,.04,1.86)),'Spine':Vector((0,.015,2.10)),'Head':Vector((0,-.06,2.46))}
parents={'BalanceBody':None,'Spine':'BalanceBody','Head':'Spine'}
for side,tag in [(-1,'L'),(1,'R')]:
    hip=Vector((side*.17,.04,1.86));foot=Vector((-.30,-.58,1.311) if side<0 else (.04,.21,1.233));knee=knee_at(hip,foot)
    for name,pos,parent in [('Leg',hip,None),('Knee',knee,'Leg_'+tag),('Foot',foot,'Knee_'+tag),('Arm',Vector((side*.27,-.025,2.31)),'BalanceBody'),('Elbow',Vector((side*.48,-.06,2.18)),'Arm_'+tag),('Hand',Vector((side*.68,-.12,2.23)),'Elbow_'+tag)]:
        positions[name+'_'+tag]=pos;parents[name+'_'+tag]=parent
# +Y bone orientation is deliberate: authored rotations are delta rotations in Blender world axes.
def armature(name,c,prefix=''):
    data=bpy.data.armatures.new(name);obj=bpy.data.objects.new(name,data);c.objects.link(obj)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    for name,p in positions.items():
        b=data.edit_bones.new(prefix+name);b.head=p;b.tail=p+Vector((0,.12,0));b.use_deform=True
        if parents[name]:b.parent=data.edit_bones[prefix+parents[name]]
    bpy.ops.object.mode_set(mode='OBJECT');obj.select_set(False);return obj
meta=armature('RiderRigifyMeta',author)
controls_collection=meta.data.collections.new('Human Controls');controls_collection.rigify_ui_row=1
for b in meta.data.bones:controls_collection.assign(b)
for b in meta.pose.bones:
    b.rigify_type='basic.super_copy';b.rigify_parameters.make_control=True;b.rigify_parameters.make_deform=True
    b.rigify_parameters.relink_constraints=True
    if parents[b.name]:b.rigify_parameters.parent_bone=parents[b.name]
bpy.context.view_layer.objects.active=meta;meta.select_set(True);bpy.ops.pose.rigify_generate()
control=bpy.context.view_layer.objects.active;control.name='RiderRigifyControls';move(control,author)
control['rigDescription']='Rigify basic.super_copy human joint control rig, tailored to exact bicycle IK joint lengths. Not the stock Human template.'
rig=armature('RiderDeformRig',skin_collection,'DEF-');rig['sourceRig']='RiderRigifyControls';rig['inPlace']=True
# Native mesh builder keeps deformable quad loops and per-vertex weights.
verts=[];faces=[];colors=[];weights=[];parts=[]
palette={'skin':(.16,.07,.037,1),'shirt':(.66,.023,.016,1),'shirtDark':(.38,.012,.01,1),'pants':(.028,.095,.34,1),'hair':(.010,.008,.006,1),'shoe':(.028,.033,.043,1),'white':(.85,.83,.75,1),'black':(.008,.006,.004,1)}
def add(v,f,color,w,label):
    start=len(verts);verts.extend(tuple(p) for p in v);faces.extend(tuple(start+i for i in face) for face in f)
    shade=1.14 if label in ['Nose','Jaw'] else 1.;rgba=palette.get(color,color);colors.extend([tuple(c*shade for c in rgba[:3])+(rgba[3],)]*len(f));weights.extend(w if isinstance(w,list) else [w]*len(v));parts.append((label,start,len(v)))
def rings(points,radii,sides,color,ws,label,ellipse=1):
    v=[];f=[]
    for j,p in enumerate(points):
        tangent=(points[min(j+1,len(points)-1)]-points[max(0,j-1)]).normalized()
        u=tangent.cross(Vector((0,1,0)))
        if u.length<.01:u=tangent.cross(Vector((1,0,0)))
        u.normalize();vaxis=tangent.cross(u).normalized()
        for i in range(sides):
            a=math.tau*i/sides;fold=1+.032*math.sin(a*3+j*.8)
            v.append(p+radii[j]*fold*(u*math.cos(a)+vaxis*math.sin(a)*ellipse))
    for j in range(len(points)-1):
        for i in range(sides):a=j*sides+i;b=j*sides+(i+1)%sides;f.append((a,b,b+sides,a+sides))
    f.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+i for i in range(sides))])
    add(v,f,color,[ws[j] for j in range(len(points)) for i in range(sides)],label)
def uv(center,scale,color,bone,segments=24,rows=12,label='detail'):
    v=[];f=[]
    for j in range(rows+1):
        t=.001+(math.pi-.002)*j/rows
        for i in range(segments):
            a=math.tau*i/segments;v.append(Vector(center)+Vector((scale[0]*math.sin(t)*math.cos(a),scale[1]*math.sin(t)*math.sin(a),scale[2]*math.cos(t))))
    for j in range(rows):
        for i in range(segments):a=j*segments+i;b=j*segments+(i+1)%segments;f.append((a,b,b+segments,a+segments))
    add(v,f,color,{bone:1},label)
def tube(a,b,r,color,bone,sides=8):
    a,b=Vector(a),Vector(b);rings([a,a.lerp(b,.5),b],[r,r,r*.8],sides,color,[{bone:1}]*3,'trim')
# Tailored red cotton shirt, hem, waist folds, chest and collar loops.
profile=[(1.80,.04,.223,.153),(1.82,.04,.229,.155),(1.86,.035,.236,.157),(1.90,.032,.234,.154),(1.96,.027,.246,.161),(2.02,.019,.261,.161),(2.08,.01,.279,.163),(2.15,-.006,.29,.164),(2.22,-.019,.308,.16),(2.28,-.03,.312,.148),(2.32,-.039,.294,.136),(2.36,-.046,.248,.119),(2.39,-.05,.12,.084),(2.405,-.052,.095,.074)]
v=[];f=[];w=[]
for j,(z,y,width,depth) in enumerate(profile):
    blend=max(0,min(.85,(z-1.92)/.42))
    for i in range(32):
        a=math.tau*i/32;fold=1+.032*math.sin(a*5+j*.85);v.append((math.cos(a)*width*fold,y+math.sin(a)*depth*fold,z));w.append({'BalanceBody':1-blend,'Spine':blend})
for j in range(len(profile)-1):
    for i in range(32):a=j*32+i;b=j*32+(i+1)%32;f.append((a,b,b+32,a+32))
add(v,f,'shirt',w,'Shirt_continuous_quad_loops')
uv((0,.042,1.816),(.205,.133,.115),'pants','BalanceBody',24,8,'Waist')
rings([Vector((0,-.053,2.38)),Vector((0,-.057,2.43)),Vector((0,-.06,2.47))],[.065,.066,.07],20,'skin',[{'Head':1}]*3,'Neck')
uv((0,-.067,2.575),(.13,.12,.163),'skin','Head',24,16,'Head_face_loops')
uv((0,-.101,2.502),(.096,.081,.065),'skin','Head',20,8,'Jaw')
# Cropped curls: low profile cap plus staggered, tightly clustered native ico meshes.
uv((0,-.039,2.674),(.133,.125,.10),'hair','Head',24,10,'Hair_cap')
for i in range(18):
    a=i*2.399963;t=math.acos(1-(i+.5)/18*.93);p=Vector((.133*math.sin(t)*math.cos(a),-.036+.126*math.sin(t)*math.sin(a),2.667+.102*math.cos(t)))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(0,0,0));o=bpy.context.object
    size=.041+ .005*math.sin(i*2.1);add([p+x.co*size for x in o.data.vertices],[tuple(p.vertices) for p in o.data.polygons],'hair',{'Head':1},'Curl');bpy.data.objects.remove(o,do_unlink=True)
uv((0,-.192,2.578),(.027,.033,.028),'skin','Head',12,8,'Nose')
tube((-.032,-.175,2.525),(.032,-.175,2.525),.004,'shirtDark','Head')
for side,tag in [(-1,'L'),(1,'R')]:
    uv((side*.057,-.177,2.603),(.019,.009,.009),'white','Head',12,6,'Eye')
    uv((side*.057,-.185,2.603),(.008,.004,.008),'black','Head',10,6,'Pupil')
    tube((side*.035,-.175,2.63),(side*.081,-.171,2.632),.006,'hair','Head')
    uv((side*.13,-.05,2.573),(.022,.023,.04),'skin','Head',12,8,'Ear')
    # One continuous tube crosses each knee/elbow; five rings carry mixed weights.
    for first,joint,last,radius,sides,count,color in [('Leg','Knee','Foot',.103,24,20,'pants'),('Arm','Elbow','Hand',.064,16,16,'skin')]:
        a,b,c=[positions[n+'_'+tag] for n in [first,joint,last]];points=[];radii=[];ws=[]
        for j in range(count+1):
            t=j/count*2;p=a.lerp(b,t) if t<=1 else b.lerp(c,t-1);points.append(p)
            # Bell-shaped transition around the joint avoids a rigid hinge seam.
            blend=max(0,min(1,(t-.78)/.44));ws.append({first+'_'+tag:1-blend,joint+'_'+tag:blend})
            shape=(1-.24*t) if t<1 else (.76-.15*(t-1))
            if first=='Leg' and t<.22:shape*=.62+.38*t/.22
            radii.append(radius*shape*(1+.035*math.sin(j*1.6)))
        rings(points,radii,sides,color,ws,first+'_continuous_'+tag,.94)
        if first=='Arm':
            end=a.lerp(b,.57);inside=a-Vector((side*.035,0,0));rings([inside,a.lerp(end,.25),a.lerp(end,.75),end],[.075,.092,.087,.083],24,'shirt',[{'Arm_'+tag:1}]*4,'Sleeve_'+tag)
    hand=positions['Hand_'+tag];uv(hand,(.058,.032,.036),'skin','Hand_'+tag,16,8,'Palm')
    for i in range(4):
        p=hand+Vector((side*(-.025+i*.022),-.008,0));q=p+Vector((side*.008,-.048,-.002));r=q+Vector((-side*.004,-.015,-.018));tube(p,q,.008,'skin','Hand_'+tag);tube(q,r,.007,'skin','Hand_'+tag)
    tube(hand+Vector((-side*.045,0,0)),hand+Vector((-side*.055,-.036,-.02)),.011,'skin','Hand_'+tag)
    foot=positions['Foot_'+tag];p=foot+Vector((0,-.076,-.04))
    uv(p,(.093,.149,.061),'shoe','Foot_'+tag,20,8,'SneakerUpper')
    # White outsole profile and black tread remain distinguishable in rear chase view.
    uv(p+Vector((0,0,-.042)),(.096,.154,.020),'white','Foot_'+tag,20,4,'WhiteSole')
    uv(p+Vector((0,0,-.067)),(.089,.147,.008),'shoe','Foot_'+tag,20,4,'Tread')
    for i in range(4):tube(p+Vector((-.044,-.045+i*.027,.052)),p+Vector((.044,-.035+i*.027,.052)),.004,'white','Foot_'+tag)
meshdata=bpy.data.meshes.new('RiderHero_DeformationLoops');meshdata.from_pydata(verts,[],faces);meshdata.update()
mesh=bpy.data.objects.new('RiderHeroSkin',meshdata);skin_collection.objects.link(mesh)
attr=meshdata.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
for poly,col in zip(meshdata.polygons,colors):
    poly.use_smooth=True
    for li in poly.loop_indices:attr.data[li].color=col
material=bpy.data.materials.new('Hero_VertexPalette');material.use_nodes=True
nodes=material.node_tree.nodes;vc=nodes.new('ShaderNodeVertexColor');vc.layer_name='Color';bs=nodes.get('Principled BSDF');material.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color']);bs.inputs['Roughness'].default_value=.82;meshdata.materials.append(material)
for name in positions:mesh.vertex_groups.new(name='DEF-'+name)
for i,ws in enumerate(weights):
    for name,weight in ws.items():
        if weight>1e-6:mesh.vertex_groups['DEF-'+name].add([i],weight,'REPLACE')
mod=mesh.modifiers.new('Real weighted deformation','ARMATURE');mod.object=rig;mesh.parent=rig
mesh['topology']='Quad ring transitions: 21 leg rings, 17 arm rings, 14 shirt loops; explicit normalized blend weights.'
# Reusable legacy object hierarchy, rigidly partitioned from this same authored hero.
legacy=bpy.data.objects.new('StandingRider',None);fallback.objects.link(legacy);legacy['source']='rider-hero.blend / HeroFallback'
joints={}
for name,p in positions.items():
    if name in ['Spine','Head']:continue
    o=bpy.data.objects.new(name,None);fallback.objects.link(o);o.parent=joints.get(parents[name],legacy);o.location=p-(positions[parents[name]] if parents[name] else Vector());joints[name]=o
for tag in ['L','R']:
    joints['Leg_'+tag]['restUpper']=list(positions['Knee_'+tag]-positions['Leg_'+tag]);joints['Leg_'+tag]['support']=list(positions['Foot_'+tag])
partition={name:[] for name in joints}
for i,face in enumerate(faces):
    sums={}
    for vi in face:
        for name,weight in weights[vi].items():
            n='BalanceBody' if name in ['Head','Spine'] else name;sums[n]=sums.get(n,0)+weight
    partition[max(sums,key=sums.get)].append(i)
for joint,ids in partition.items():
    indices=sorted({v for fi in ids for v in faces[fi]});mapping={v:i for i,v in enumerate(indices)}
    data=bpy.data.meshes.new('Fallback_'+joint);data.from_pydata([Vector(verts[i])-positions[joint] for i in indices],[],[tuple(mapping[v] for v in faces[fi]) for fi in ids]);data.update()
    o=bpy.data.objects.new('HeroPart_'+joint,data);fallback.objects.link(o);o.parent=joints[joint];data.materials.append(material)
    attr=data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for poly,fi in zip(data.polygons,ids):
        poly.use_smooth=True
        for li in poly.loop_indices:attr.data[li].color=colors[fi]
# Pose the Rigify controls, then bake evaluated DEF transforms onto a minimal export skeleton.
clips=[('Rider_Idle_Ready',120),('Rider_Ride_SeatedPedal',60),('Rider_Ride_StandingBalance',120),('Rider_Trans_SitToStand',21),('Rider_Trans_StandToSit',21),('Rider_Jump_Takeoff',9),('Rider_Jump_Air',30),('Rider_Jump_Land',15),('Rider_Kick_Charge_L',24),('Rider_Kick_Charge_R',24),('Rider_Kick_Strike_L',42),('Rider_Kick_Strike_R',42),('Rider_Lean_L',1),('Rider_Lean_R',1),('Rider_Hit_Shield',24),('Rider_Crash',60)]
def pose_matrices(name,t):
    if 'Trans_' in name:
        start=pose_matrices('Rider_Ride_SeatedPedal',0);end=pose_matrices('Rider_Ride_StandingBalance',0)
        u=(1-math.cos(math.pi*t))*.5
        if 'StandToSit' in name:u=1-u
        result={}
        for joint in positions:
            parent=parents[joint]
            a=start[parent].inverted()@start[joint] if parent else start[joint]
            b=end[parent].inverted()@end[joint] if parent else end[joint]
            ap,aq,_=a.decompose();bp,bq,_=b.decompose()
            local=Matrix.LocRotScale(ap.lerp(bp,u),aq.slerp(bq,u),Vector((1,1,1)))
            result[joint]=result[parent]@local if parent else local
        return result
    stance=1. if 'StandingBalance' in name else t if 'SitToStand' in name else 1-t if 'StandToSit' in name else 0.
    phase=t*math.tau if 'SeatedPedal' in name else 0.;crouch=.007*math.sin(t*math.tau)
    if 'Jump' in name:crouch=.09*math.sin(t*math.pi)
    torso=Vector((0,.22*(1-stance)+.04*stance,1.30+.56*stance-crouch));q=Quaternion((1,0,0),.98*(1-stance))
    lean=(-1 if name.endswith('_L') else 1)*(.12 if 'Lean' in name else .07*math.sin(t*math.pi) if 'Charge' in name else 0.)
    q=q@Quaternion((0,1,0),lean)
    if 'Shield' in name:q=q@Quaternion((1,0,0),-.18*math.sin(t*math.pi))
    if 'Crash' in name:q=q@Quaternion((0,1,0),-.5*t)
    matrices={'BalanceBody':Matrix.LocRotScale(torso,q,Vector((1,1,1)))}
    for child in ['Spine','Head']:
        parent=parents[child];off=positions[child]-positions[parent];extra=Quaternion((0,1,0),.025*math.sin(t*math.tau)-lean*.15) if child=='Head' else Quaternion((1,0,0),.016*math.sin(t*math.tau)-(.12*math.sin(t*math.pi) if 'Shield' in name else 0.))@Quaternion((0,1,0),lean*.5-(.25*t if 'Crash' in name else 0.))
        matrices[child]=matrices[parent]@Matrix.Translation(off)@extra.to_matrix().to_4x4()
    for side,tag in [(-1,'L'),(1,'R')]:
        hip=Vector((side*.17,torso.y,torso.z));ankle=Vector((side*.21,-.04+side*.18*math.sin(phase)+.075,.538-side*.18*math.cos(phase))).lerp(positions['Foot_'+tag],stance);ankle.z+=math.sin(math.pi*stance)*.38
        knee=knee_at(hip,ankle);rest_upper=positions['Knee_'+tag]-positions['Leg_'+tag];rest_lower=positions['Foot_'+tag]-positions['Knee_'+tag]
        upper=rest_upper.rotation_difference(knee-hip);lower=rest_lower.rotation_difference(upper.inverted()@(ankle-knee))
        # Existing game uses opposite leg for a cross-body strike. Clip suffix denotes kick direction.
        kick_side=-1 if name.endswith('_L') else 1
        if ('Strike' in name or 'Charge' in name) and side==-kick_side:
            amount=math.sin(math.pi*t) if 'Strike' in name else .16
            direction=Vector((side*.92,-.22,.24)).normalized();target=rest_upper.rotation_difference(direction);local=rest_lower.rotation_difference(target.inverted()@direction)
            upper=upper.slerp(target,amount);lower=lower.slerp(local,amount)
        matrices['Leg_'+tag]=Matrix.LocRotScale(hip,upper,Vector((1,1,1)))
        matrices['Knee_'+tag]=matrices['Leg_'+tag]@Matrix.Translation(rest_upper)@lower.to_matrix().to_4x4()
        foot_q=(upper@lower).inverted();matrices['Foot_'+tag]=matrices['Knee_'+tag]@Matrix.Translation(rest_lower)@foot_q.to_matrix().to_4x4()
        shoulder=positions['Arm_'+tag]-positions['BalanceBody'];a=positions['Elbow_'+tag]-positions['Arm_'+tag];b=positions['Hand_'+tag]-positions['Elbow_'+tag]
        target=q.inverted()@(Vector((side*.36,-.50,1.20))-torso);balance=shoulder+a+b;balance.z+=math.sin(t*math.tau+side)*.025;target=target.lerp(balance,stance)
        d=target-shoulder;length=d.length;d.normalize();along=(a.length_squared-b.length_squared+length**2)/(2*length);bend=Vector((0,0,-1));bend=(bend-d*bend.dot(d)).normalized();elbow=shoulder+d*along+bend*math.sqrt(max(0,a.length_squared-along**2))
        aq=a.rotation_difference(elbow-shoulder);bq=b.rotation_difference(aq.inverted()@(target-elbow));hq=(q@aq@bq).inverted()
        matrices['Arm_'+tag]=matrices['BalanceBody']@Matrix.Translation(shoulder)@aq.to_matrix().to_4x4();matrices['Elbow_'+tag]=matrices['Arm_'+tag]@Matrix.Translation(a)@bq.to_matrix().to_4x4();matrices['Hand_'+tag]=matrices['Elbow_'+tag]@Matrix.Translation(b)@hq.to_matrix().to_4x4()
    return matrices
rig.animation_data_create();control.animation_data_create()
for name,duration in clips:
    source_action=bpy.data.actions.new('Authoring_'+name);source_action.use_fake_user=True;control.animation_data.action=source_action
    baked=bpy.data.actions.new(name);baked.use_fake_user=True;rig.animation_data.action=baked
    if 'Strike' in name:baked.pose_markers.new('impact').frame=8
    for frame in range(duration+1):
        scene.frame_set(frame);mats=pose_matrices(name,frame/duration)
        for joint,matrix in mats.items():
            pb=control.pose.bones[joint];pb.rotation_mode='QUATERNION';pb.matrix=matrix
            pb.keyframe_insert('location',frame=frame);pb.keyframe_insert('rotation_quaternion',frame=frame)
            bpy.context.view_layer.update()
        for joint in positions:
            pb=rig.pose.bones['DEF-'+joint];pb.rotation_mode='QUATERNION';pb.matrix=control.pose.bones['DEF-'+joint].matrix.copy();bpy.context.view_layer.update()
            pb.keyframe_insert('location',frame=frame);pb.keyframe_insert('rotation_quaternion',frame=frame)
    track=rig.animation_data.nla_tracks.new();track.name=name;track.strips.new(name,0,baked);track.mute=True
rig.animation_data.action=None;control.animation_data.action=None
for ob in [rig,control]:
    for b in ob.pose.bones:b.matrix_basis=Matrix.Identity(4)
scene.frame_set(0);scene.frame_start=0;scene.frame_end=120
for ob in author.all_objects:ob.hide_render=True;ob.hide_set(True)
for ob in fallback.all_objects:ob.hide_render=True;ob.hide_set(True)
meshdata.calc_loop_triangles()
metadata={'source':'rider-hero.blend','reference':'style-a.png','referenceStatus':'authored draft, not user-confirmed','rig':'Native Rigify basic.super_copy controls baked to deformation armature','rigifyAvailable':True,'fps':60,'triangles':len(meshdata.loop_triangles),'vertices':len(verts),'bones':len(positions),'maxInfluences':max(sum(v>0 for v in w.values()) for w in weights),'clips':[{'name':n,'seconds':frames/60,'frames':frames,'impact':8 if 'Strike' in n else None} for n,frames in clips],'coordinateConvention':'Blender Z up, forward -Y. GLB Y up, forward +Z. Runtime bone rest world quaternion is retained when applying legacy delta rotations.','restPositions':{k:list(v) for k,v in positions.items()},'parents':parents}
(OUT/'hero-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
bpy.ops.object.select_all(action='DESELECT');rig.hide_set(False);mesh.hide_set(False);rig.select_set(True);mesh.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE/'rider-hero.blend'))
# Tracks isolate the 16 export actions from the editable Rigify authoring actions.
for track in rig.animation_data.nla_tracks:track.mute=False
bpy.ops.export_scene.gltf(filepath=str(OUT/'riderSkinned.glb'),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_vertex_color='ACTIVE',export_skins=True,export_def_bones=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_frame_step=1,export_optimize_animation_size=True,export_reset_pose_bones=True,export_influence_nb=4)
print('HERO_RESULT',json.dumps(metadata))
