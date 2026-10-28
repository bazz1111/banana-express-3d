"""Build this inspected Tripo bicycle candidate in headless Blender.

The unchanged --master GLB supplies geometry, UVs and original baseColor.
--use-prepared explicitly reuses an intermediate --source .blend instead.
Every visible face is derived from the new Tripo bicycle; outputs stay in artifacts/.
"""
import argparse
from collections import Counter,defaultdict
import json
import math
from pathlib import Path
import runpy
import struct
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
CENTERS={'WheelRear':(-.276,.003,.223),'WheelFront':(.329,-.042,.222)}
AXES={'WheelRear':(-.060,.998,.012),'WheelFront':(.678,.731,.080)}
TARGETS={'WheelRear':(0,.58,.36),'WheelFront':(0,-.64,.36)}
BB=(0,0,.196)
PEDALS={'L':(.068,-.110,.122),'R':(.051,.102,.274)}
RADIUS=.36


def segment_distance(point,a,b):
    delta=[y-x for x,y in zip(a,b)]
    t=max(0,min(1,sum((x-y)*d for x,y,d in zip(point,a,delta))/sum(d*d for d in delta)))
    return math.sqrt(sum((x-y-t*d)**2 for x,y,d in zip(point,a,delta)))


def wheel_coordinates(point,name):
    delta=[a-b for a,b in zip(point,CENTERS[name])]
    axis=AXES[name];length=math.sqrt(sum(v*v for v in axis))
    depth=sum(a*b for a,b in zip(delta,axis))/length
    return depth,math.sqrt(max(0,sum(v*v for v in delta)-depth*depth))


def source_role(point,metallic=0.):
    """Explicit masks for this inspected source, not a general bike segmenter."""
    x,y,z=point
    if .025<x<.112 and -.190<y<-.060 and .096<z<.148:
        return 'Pedal_L'
    if .012<x<.112 and .035<y<.180 and .256<z<.311:
        return 'Pedal_R'
    for tag in ['L','R']:
        if (y<-.050 if tag=='L' else y>.040) and segment_distance((x,z),(BB[0],BB[2]),(PEDALS[tag][0],PEDALS[tag][2]))<.013:
            return 'Crank_'+tag
    if .520<z<.600 and -.230<x<.015 and abs(y)<.085:
        return 'SeatFixed'
    if z>.515 and x>-.030:
        return 'HandlebarFixed'
    for start,end,width in [
        ((0,0,.196),(-.114,0,.500),.020),
        ((-.114,0,.500),(.213,0,.500),.018),
        ((0,0,.196),(.244,0,.440),.032),
        ((.244,0,.440),(.213,0,.500),.020),
    ]:
        if segment_distance(point,start,end)<width:return 'FrameFixed'
    for name in ['WheelRear','WheelFront']:
        depth,radius=wheel_coordinates(point,name)
        center=CENTERS[name]
        if radius>.270 or abs(depth)>.105:
            continue
        if radius<.028 and abs(depth)<.025:
            return name
        if name=='WheelRear' and x>-.200 and .140<z<.280 and -.024<y<.070 and radius<.202:
            return 'FrameFixed'  # The real chaincase crosses the wheel's projection.
        if name=='WheelFront':
            path=[(.244,0,.440),(.272,-.005,.410),(.258,-.008,.350),(.280,-.020,.280),CENTERS[name]]
            for side in [-1,1]:
                shifted=[(p[0],p[1]+side*.030,p[2]) for p in path[:-1]]
                shifted.append(tuple(c+side*.030*n for c,n in zip(path[-1],AXES[name])))
                if any(segment_distance(point,a,b)<.025 for a,b in zip(shifted,shifted[1:])):
                    return 'FrontFork'
            if segment_distance(point,(.252,-.027,.419),(.295,.027,.419))<.021:
                return 'FrontFork'
        strut=False
        if name=='WheelRear':
            for side in [-1,1]:
                strut|=segment_distance(point,(-.276,side*.035,.223),(-.114,side*.018,.490))<.012
                strut|=segment_distance(point,(-.276,side*.040,.223),(0,side*.025,.196))<.013
        else:
            axis=AXES[name]
            for side in [-1,1]:
                start=tuple(c+side*.036*n for c,n in zip(center,axis))
                end=(.244,side*.023,.432)
                strut|=segment_distance(point,start,end)<.015
        if strut and radius>.035 and abs(depth)>.022:
            return 'FrontFork' if name=='WheelFront' else 'FrameFixed'
        if name=='WheelFront' and abs(depth)>.018:
            for side in [-1,1]:
                start=tuple(c+side*.025*n for c,n in zip(center,AXES[name]))
                end=tuple(c+side*.025*n for c,n in zip((.185,.090,.250),AXES[name]))
                if segment_distance(point,start,end)<.009:
                    return 'FrontFender'
        fender_depth=.105 if name=='WheelFront' else .065
        if .210<radius<.270 and z>center[2]-.045 and abs(depth)<fender_depth and metallic>.35:
            return 'RearFender' if name=='WheelRear' else 'FrontFender'
        limit=.032 if radius>.16 else .012+.027*(1-min(1,radius/.16))
        if radius<.229 and abs(depth)<limit:
            return name
        # The front chrome tail curls inside the tire's maximum radius, but
        # sits outside its narrow depth slab. It is fixed, never a fork leg.
        fender_min=.185 if name=='WheelFront' and metallic>.35 else .202
        if fender_min<radius<.270 and z>center[2]-.045 and abs(depth)<fender_depth:
            return 'RearFender' if name=='WheelRear' else 'FrontFender'
    return 'FrameFixed'


def prepare(source,master,output,render=False,use_prepared=False):
    import bpy
    import numpy as np
    from mathutils import Matrix,Vector
    from mathutils.bvhtree import BVHTree

    if not bpy.app.background:
        raise RuntimeError('Use an independent headless Blender process')
    if not output.is_relative_to(ROOT/'artifacts'):
        raise ValueError('Bicycle candidates must stay under artifacts/')
    helper=runpy.run_path(str(Path(__file__).with_name('prepare-static.py')),run_name='static_helpers')
    if use_prepared and source is None:
        raise ValueError('--use-prepared requires an explicit --source blend')
    protected={str(p):helper['sha256'](p) for p in ([source,master] if use_prepared else [master])}
    doc=helper['glb_json'](master)
    if doc.get('skins'):
        raise ValueError('This bicycle tool accepts static source geometry only')
    position=doc['accessors'][doc['meshes'][0]['primitives'][0]['attributes']['POSITION']]
    raw=[b-a for a,b in zip(position['min'],position['max'])]
    native_dimensions=[raw[0],raw[2],raw[1]]
    geometry_operations={}
    if use_prepared:
        bpy.ops.wm.open_mainfile(filepath=str(source))
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(master))
    original=next(obj for obj in bpy.context.scene.objects if obj.type=='MESH')
    bpy.ops.object.select_all(action='DESELECT');original.select_set(True);bpy.context.view_layer.objects.active=original
    world=original.matrix_world.copy();original.parent=None;original.matrix_world=world
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    if not use_prepared:
        before_vertices=len(original.data.vertices)
        threshold=max(max(original.dimensions)*4e-7,1e-8)
        weld=original.modifiers.new('Weld_Source_UV_Seams','WELD');weld.merge_threshold=threshold
        bpy.ops.object.modifier_apply(modifier=weld.name)
        welded_vertices=before_vertices-len(original.data.vertices)
        original.data.calc_loop_triangles()
        decimate=original.modifiers.new('PreDeform_80000_Triangles','DECIMATE')
        decimate.ratio=min(1,80000/len(original.data.loop_triangles)*.995);decimate.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        # Calibrate before the final reduction. Long thin low-poly triangles
        # become flags when only their endpoints sample a curved deformation.
        import bmesh
        bm=bmesh.new();bm.from_mesh(original.data)
        long_edges=[edge for edge in bm.edges if edge.calc_length()>.030]
        if long_edges:bmesh.ops.subdivide_edges(bm,edges=long_edges,cuts=2,use_grid_fill=True)
        bm.to_mesh(original.data);bm.free();original.data.update()
        geometry_operations={'source':'master GLB','weldedVertices':welded_vertices,'mergeThreshold':threshold,
            'intermediateTargetTriangles':80000,'longEdgesSubdivided':len(long_edges),'deformBeforeFinalDecimation':True}
    else:
        geometry_operations={'source':'explicit reduced blend','path':str(source)}
    dimensions=list(original.dimensions)
    original.data.transform(Matrix.Diagonal(Vector([native_dimensions[i]/dimensions[i] for i in range(3)]+[1.])))
    original.data.update();original.data.calc_loop_triangles()
    data=original.data
    if len(data.loop_triangles)>300000:
        raise ValueError('The pre-deformation mesh exceeds its intermediate budget')
    points=[vertex.co.copy() for vertex in data.vertices]
    uv=data.uv_layers.active
    if uv is None:raise ValueError('The source bicycle lost its real UVs')
    with master.open('rb') as stream:
        stream.seek(12);json_size=struct.unpack('<I',stream.read(4))[0]

    def embedded_image(texture_info,path):
        texture=doc['textures'][texture_info['index']];image=doc['images'][texture['source']]
        view=doc['bufferViews'][image['bufferView']]
        with master.open('rb') as stream:
            stream.seek(28+json_size+view.get('byteOffset',0));path.write_bytes(stream.read(view['byteLength']))
        return bpy.data.images.load(str(path),check_existing=False)

    metal_pixels=None
    color_pixels=None
    mr=doc['materials'][0]['pbrMetallicRoughness'].get('metallicRoughnessTexture')
    if mr:
        with tempfile.TemporaryDirectory(prefix='bicycle-mr-mask-') as temporary:
            metal_image=embedded_image(mr,Path(temporary)/'source-mr.jpg')
            metal_image.colorspace_settings.name='Non-Color';metal_image.scale(512,512)
            metal_pixels=np.empty(512*512*4,dtype=np.float32);metal_image.pixels.foreach_get(metal_pixels)
            metal_pixels=metal_pixels.reshape(512,512,4)
            bpy.data.images.remove(metal_image)
    with tempfile.TemporaryDirectory(prefix='bicycle-rubber-mask-') as temporary:
        color_image=embedded_image(doc['materials'][0]['pbrMetallicRoughness']['baseColorTexture'],Path(temporary)/'source-color.jpg')
        color_image.scale(512,512)
        color_pixels=np.empty(512*512*4,dtype=np.float32);color_image.pixels.foreach_get(color_pixels)
        color_pixels=color_pixels.reshape(512,512,4);bpy.data.images.remove(color_image)
    face_samples={}
    def face_metal(polygon):
        value=sum((uv.data[i].uv for i in polygon.loop_indices),Vector((0,0)))/len(polygon.loop_indices)
        row=min(511,int(value.y%1*512));column=min(511,int(value.x%1*512))
        metal=float(metal_pixels[row,column,2]) if metal_pixels is not None else 0.
        rgb=color_pixels[row,column,:3]
        face_samples[polygon.index]=(metal,float(np.mean(rgb)),float(np.max(rgb)-np.min(rgb)))
        return metal
    # polygon centers are derived lazily after a mesh data transform.
    roles={polygon.index:source_role(tuple(sum((points[i] for i in polygon.vertices),Vector())/len(polygon.vertices)),face_metal(polygon))
           for polygon in data.polygons}
    # The generated tires are slightly oval. A fixed radius mask otherwise
    # captures short chrome fender ends where their radius is below the tire's
    # maximum. Use dark, nonmetal rubber to measure the local outer envelope.
    tyre_envelopes={};fender_reclassified=0
    for name in CENTERS:
        axis=Vector(AXES[name]).normalized();center=Vector(CENTERS[name]);rotation=axis.rotation_difference(Vector((0,1,0)))
        bins=[[] for _ in range(72)]
        for polygon in data.polygons:
            if roles[polygon.index]!=name:continue
            metal,light,chroma=face_samples[polygon.index]
            if metal>.25 or light>.18:continue
            p=rotation@(sum((points[i] for i in polygon.vertices),Vector())/len(polygon.vertices)-center)
            radius=math.hypot(p.x,p.z)
            if radius>.16:bins[min(71,int((math.atan2(p.z,p.x)%(2*math.pi))/(2*math.pi)*72))].append(radius)
        profile=np.array([float(np.quantile(values,.95)) if values else 0 for values in bins])
        known=np.flatnonzero(profile>.16)
        if len(known)<45:raise ValueError('Insufficient real rubber samples for '+name)
        for i in range(72):
            if profile[i]<.16:
                nearest=min(known,key=lambda j:min(abs(i-j),72-abs(i-j)));profile[i]=profile[nearest]
        profile=np.median(np.stack([np.roll(profile,-1),profile,np.roll(profile,1)]),axis=0)
        tyre_envelopes[name]=profile
        for polygon in data.polygons:
            if roles[polygon.index]!=name:continue
            metal,light,chroma=face_samples[polygon.index]
            if metal<.35 and not (light>.22 and chroma<.055):continue
            p=rotation@(sum((points[i] for i in polygon.vertices),Vector())/len(polygon.vertices)-center)
            slot=min(71,int((math.atan2(p.z,p.x)%(2*math.pi))/(2*math.pi)*72))
            if math.hypot(p.x,p.z)>profile[slot]+.0015:
                roles[polygon.index]='RearFender' if name=='WheelRear' else 'FrontFender';fender_reclassified+=1
    source_counts=Counter(roles.values())
    for name in ['WheelFront','WheelRear','Pedal_L','Pedal_R','Crank_L','Crank_R','SeatFixed','HandlebarFixed']:
        if not source_counts[name]:
            raise ValueError('An inspected source mask is empty: '+name)
    wheel_quaternions={name:Vector(AXES[name]).normalized().rotation_difference(Vector((0,1,0))) for name in CENTERS}
    profiles={}
    wheel_scales={}
    for name in CENTERS:
        indices={i for polygon in data.polygons if roles[polygon.index]==name for i in polygon.vertices}
        profile=np.zeros(72)
        for index in indices:
            p=wheel_quaternions[name]@(points[index]-Vector(CENTERS[name]))
            radius=math.hypot(p.x,p.z);angle=math.atan2(p.z,p.x)%(2*math.pi)
            slot=min(71,int(angle/(2*math.pi)*72));profile[slot]=max(profile[slot],radius)
        known=np.flatnonzero(profile>.17)
        if len(known)<50:
            raise ValueError('Wheel mask lost too much tire circumference: '+name)
        for i in range(72):
            if profile[i]<.17:
                nearest=min(known,key=lambda j:min(abs(i-j),72-abs(i-j)));profile[i]=profile[nearest]
        profiles[name]=tyre_envelopes[name]
        wheel_scales[name]=RADIUS/float(np.median(tyre_envelopes[name]))
    scale=sum(wheel_scales.values())/2
    longitudinal=1.18/(CENTERS['WheelFront'][0]-CENTERS['WheelRear'][0])
    source_grips=[Vector((.026,-.118,.614)),Vector((.314,.117,.601))]
    grip_mid=(source_grips[0]+source_grips[1])/2
    bar_rotation=(source_grips[1]-source_grips[0]).rotation_difference(Vector((0,1,0)))
    vertical_shift=.36-(CENTERS['WheelRear'][2]+CENTERS['WheelFront'][2])/2*scale

    def frame_point(p):
        return Vector((p.y*scale,.58-(p.x-CENTERS['WheelRear'][0])*longitudinal,p.z*scale+vertical_shift))

    # The old tall supports visibly distorted the new frame. Keep its source
    # proportions and report the actual contact differences for hero adaptation.
    seat_target=frame_point(Vector((-.114,0,.558)))
    bar_mid=frame_point(grip_mid);bar_mid.x=0
    bb_game=frame_point(Vector(BB))
    pedal_axes={tag:Vector((-.21 if tag=='L' else .21,bb_game.y,bb_game.z+(.18 if tag=='L' else -.18))) for tag in ['L','R']}

    def wheel_point(p,name,rounded,clear_fender=True):
        q=wheel_quaternions[name]@(p-Vector(CENTERS[name]))
        radius=math.hypot(q.x,q.z);s=wheel_scales[name]
        if rounded and radius>1e-8:
            angle=math.atan2(q.z,q.x)%(2*math.pi);slot=angle/(2*math.pi)*72-.5
            lower=math.floor(slot);fraction=slot-lower
            outer=float(profiles[name][lower%72]*(1-fraction)+profiles[name][(lower+1)%72]*fraction)
            blend=max(0,min(1,(radius/outer-.92)/.08));blend=blend*blend*(3-2*blend)
            fitted=radius*RADIUS/outer*(1-blend)+RADIUS*blend
            q.x*=fitted/radius;q.z*=fitted/radius
            q.y*=s
        else:
            q*=s
            if clear_fender and not rounded and radius>.18:
                current=math.hypot(q.x,q.z);fitted=max(current,RADIUS+.025)
                q.x*=fitted/max(1e-8,current);q.z*=fitted/max(1e-8,current)
        return Vector(TARGETS[name])+Vector((q.y,-q.x,q.z))

    def smooth(value):
        value=max(0,min(1,value));return value*value*(3-2*value)

    def fixed_point(p):
        return frame_point(p)

    def transform(p,role):
        if role in CENTERS:
            return wheel_point(p,role,True)
        if role in ['RearFender','FrontFender']:
            return wheel_point(p,'WheelRear' if role=='RearFender' else 'WheelFront',False)
        if role=='FrontFork':
            head=Vector((.244,0,.440));center=Vector(CENTERS['WheelFront'])
            def aligned(value):
                # The generated fork is less steered than its wheel. Retain
                # its two real legs in separate lateral planes while bringing
                # the crown and axle onto the straightened bicycle.
                path=[(.222,-.042),(.280,-.020),(.350,-.008),(.410,-.005),(.440,0.)]
                cy=path[-1][1]
                for (za,ya),(zb,yb) in zip(path,path[1:]):
                    if value.z<=zb:
                        t=max(0,min(1,(value.z-za)/(zb-za)));cy=ya+(yb-ya)*t;break
                return frame_point(head)+Vector(((value.y-cy)*scale,-(value.x-head.x)*scale,(value.z-head.z)*scale))
            correction=Vector(TARGETS['WheelFront'])-aligned(center)
            return aligned(p)+correction*((head.z-p.z)/(head.z-center.z))
        if role=='SeatFixed':
            delta=p-Vector((-.114,0,.558))
            return seat_target+Vector((delta.y,-delta.x,delta.z))*scale
        if role=='HandlebarFixed':
            delta=bar_rotation@(p-grip_mid)
            bar=bar_mid+Vector((delta.y,-delta.x,delta.z))*scale
            return frame_point(p).lerp(bar,smooth((p.z-.50)/.045))
        if role.startswith('Pedal_'):
            tag=role[-1];axis=pedal_axes[tag]
            delta=p-Vector(PEDALS[tag])
            return axis+Vector((delta.y,-delta.x,delta.z))*scale
        if role.startswith('Crank_'):
            tag=role[-1];pedal=Vector(PEDALS[tag]);v=Vector((pedal.x-BB[0],pedal.z-BB[2]))
            angle=(math.pi/2 if tag=='L' else -math.pi/2)-math.atan2(v.y,v.x)
            x=p.x-BB[0];z=p.z-BB[2];ratio=.18/v.length
            along=max(0,min(1,(x*v.x+z*v.y)/(v.length*v.length)))
            lateral=p.y*scale+along*((-.21 if tag=='L' else .21)-pedal.y*scale)
            return Vector((lateral,bb_game.y-(x*math.cos(angle)-z*math.sin(angle))*ratio,
                           bb_game.z+(x*math.sin(angle)+z*math.cos(angle))*ratio))
        return fixed_point(p)

    material=data.materials[0]
    with tempfile.TemporaryDirectory(prefix='bicycle-color-') as temporary:
        albedo=embedded_image(doc['materials'][0]['pbrMetallicRoughness']['baseColorTexture'],Path(temporary)/'bicycle-basecolor.jpg')
        for node in material.node_tree.nodes:
            if node.type=='TEX_IMAGE':node.image=albedo
        helper['simplify_materials'](bpy,data,2048)
    if not use_prepared:
        output.mkdir(parents=True,exist_ok=True)
        bpy.context.scene['sourceSha256']=protected[str(master)]
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(output/'source-reduced.blend'),check_existing=False)
    groups=defaultdict(list)
    for polygon in data.polygons:
        role=roles[polygon.index]
        output_role='Crank' if role.startswith('Crank_') else role if role in [*CENTERS,'Pedal_L','Pedal_R'] else 'FrameFixed'
        groups[output_role].append(polygon)
    origins={'FrameFixed':Vector(),**{k:Vector(v) for k,v in TARGETS.items()},'Crank':bb_game,
             **{'Pedal_'+tag:axis for tag,axis in pedal_axes.items()}}
    fixed_roles=defaultdict(set)
    for polygon in groups['FrameFixed']:
        for index in polygon.vertices:fixed_roles[index].add(roles[polygon.index])
    fixed_positions={index:sum((transform(points[index],role) for role in sorted(tags)),Vector())/len(tags) for index,tags in fixed_roles.items()}
    stretched=[]
    for polygon in groups['FrameFixed']:
        indices=list(polygon.vertices)
        for a,b in zip(indices,indices[1:]+indices[:1]):
            before=(points[a]-points[b]).length;after=(fixed_positions[a]-fixed_positions[b]).length
            if after>.10 and after>before*4:
                stretched.append({'face':polygon.index,'role':roles[polygon.index],'before':before,'after':after,
                    'sourcePoints':[list(points[a]),list(points[b])],'vertexRoles':[sorted(fixed_roles[a]),sorted(fixed_roles[b])]})
    print('DEFORM_EDGE_AUDIT '+json.dumps({role:sorted([e for e in stretched if e['role']==role],key=lambda e:-e['after'])[:3]
        for role in sorted({e['role'] for e in stretched})}),flush=True)
    made={};vertex_roles={};vertex_sources={}
    for name,polygons in groups.items():
        mapping={};coordinates=[];faces=[];tags=[];indices=[]
        for polygon in polygons:
            role=roles[polygon.index];face=[]
            for index in polygon.vertices:
                key=(index,'fixed' if name=='FrameFixed' else role)
                if key not in mapping:
                    mapped=fixed_positions[index] if name=='FrameFixed' else transform(points[index],role)
                    mapping[key]=len(coordinates);coordinates.append(mapped-origins[name]);tags.append(role);indices.append(index)
                face.append(mapping[key])
            faces.append(face)
        mesh=bpy.data.meshes.new(name+'_SourceFaces');mesh.from_pydata(coordinates,[],faces);mesh.update()
        mesh.materials.append(material);layer=mesh.uv_layers.new(name=uv.name)
        for polygon,old in zip(mesh.polygons,polygons):
            polygon.use_smooth=old.use_smooth
            for new_loop,old_loop in zip(polygon.loop_indices,old.loop_indices):layer.data[new_loop].uv=uv.data[old_loop].uv
        color=mesh.color_attributes.new(name='Color',type='BYTE_COLOR',domain='CORNER')
        color.data.foreach_set('color',[1.]*(len(color.data)*4));mesh.color_attributes.active_color_index=0;mesh.color_attributes.render_color_index=0
        # Decimation interpolates integer attributes; this is an audit seed,
        # never a claim of persistent vertex identity after edge collapses.
        source_index=mesh.attributes.new(name='SourceVertexSeed',type='INT',domain='POINT')
        source_index.data.foreach_set('value',indices)
        source_face=mesh.attributes.new(name='SourceFace',type='INT',domain='FACE')
        source_face.data.foreach_set('value',[polygon.index for polygon in polygons])
        ob=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(ob);ob.location=origins[name]
        ob['sourceId']='bicycle';ob['provider']='Tripo';ob['sourceFaceCount']=len(polygons)
        made[name]=ob;vertex_roles[name]=tags;vertex_sources[name]=indices
    for ob in list(bpy.data.objects):
        if ob not in made.values():bpy.data.objects.remove(ob,do_unlink=True)
    root=bpy.data.objects.new('Bicycle',None);bpy.context.scene.collection.objects.link(root)
    for name,ob in made.items():
        ob.parent=root;ob.rotation_mode='XYZ'
    for tag in ['L','R']:
        pedal=made['Pedal_'+tag];pedal.parent=made['Crank'];pedal.location=origins['Pedal_'+tag]-origins['Crank']
    ropes=bpy.data.objects.new('CargoRopes',None);bpy.context.scene.collection.objects.link(ropes);ropes.parent=root
    bpy.context.view_layer.update()
    # The whole-object source fuses tires with their occluding fork/chaincase.
    # Recover the complete moving wheels from their unobstructed bottom sector.
    # BMesh interpolation/duplication keeps the actual source corner UVs.
    import bmesh
    wheel_repairs={}
    for name in CENTERS:
        ob=made[name];bm=bmesh.new();bm.from_mesh(ob.data)
        original_faces=len(bm.faces)
        for normal in [(0,1,1),(0,-1,1)]:
            bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                plane_co=(0,0,0),plane_no=normal,clear_outer=True,clear_inner=False,dist=1e-7)
        sector_faces=len(bm.faces);base=list(bm.verts)+list(bm.edges)+list(bm.faces)
        for step in [1,2,3]:
            copied=bmesh.ops.duplicate(bm,geom=base)['geom']
            vertices=[element for element in copied if isinstance(element,bmesh.types.BMVert)]
            bmesh.ops.rotate(bm,cent=(0,0,0),matrix=Matrix.Rotation(step*math.pi/2,3,'X'),verts=vertices)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.003)
        bm.normal_update();bm.to_mesh(ob.data);bm.free();ob.data.update()
        wheel_repairs[name]={'method':'Four copies of actual unobstructed bottom 90-degree source sector',
            'sourceFacesBeforeRepair':original_faces,'sourceSectorFaces':sector_faces,'uv':'Original source corner UVs retained and interpolated at sector cuts',
            'sourceSectorDegrees':[-135,-45],'copiedRotationsDegrees':[0,90,180,270],
            'replacedRegion':'All moving wheel geometry outside the unobstructed bottom sector',
            'seamWeldMeters':.003,'reason':'Master geometry contains fork/chaincase fused to hidden wheel arcs'}
    fixed=made['FrameFixed']
    fender_vertices={name:set() for name in CENTERS}
    fork_vertices=set()
    for polygon in groups['FrameFixed']:
        role=roles[polygon.index]
        if role=='FrontFork':fork_vertices.update(polygon.vertices)
        if role in ['RearFender','FrontFender']:
            fender_vertices['WheelRear' if role=='RearFender' else 'WheelFront'].update(polygon.vertices)

    def tree(ob):
        return BVHTree.FromPolygons([ob.matrix_world@v.co for v in ob.data.vertices],[list(p.vertices) for p in ob.data.polygons])

    def top_at(ob,x,y,footprint=0):
        surface=tree(ob);hits=[]
        offsets=[-footprint,0,footprint] if footprint else [0]
        for dx in offsets:
            for dy in offsets:
                hit=surface.ray_cast(Vector((x+dx,y+dy,3)),Vector((0,0,-1)))[0]
                if hit is not None:hits.append(hit)
        if not hits:raise ValueError(f'No real support surface at {ob.name} {(x,y)}')
        return max(hits,key=lambda p:p.z)

    grip_xy={tag:(transform(point,'HandlebarFixed').x*.97,transform(point,'HandlebarFixed').y)
             for tag,point in zip(['L','R'],source_grips)}
    clearance_edits=0;max_clearance_shift=0.
    for vertex,role,index in zip(fixed.data.vertices,vertex_roles['FrameFixed'],vertex_sources['FrameFixed']):
        p=points[index]
        case_weight=smooth((-.015-p.x)/.045)*smooth((.30-p.z)/.035)*smooth((-.006-p.y)/.012)
        if case_weight and vertex.co.x>-.070:
            old=vertex.co.x;vertex.co.x-=case_weight*(vertex.co.x+.070)
            clearance_edits+=1;max_clearance_shift=max(max_clearance_shift,abs(vertex.co.x-old))
        for name in CENTERS:
            delta=vertex.co-Vector(TARGETS[name]);radial=math.hypot(delta.y,delta.z)
            if name=='WheelFront' and index in fork_vertices and p.z>.395 and radial>.25:
                factor=max(1,(RADIUS+.025)/radial)
                vertex.co.y=TARGETS[name][1]+delta.y*factor;vertex.co.z=TARGETS[name][2]+delta.z*factor
                continue
            if index in fender_vertices[name] and radial>.25:
                factor=max(1,(RADIUS+.025)/radial)
                vertex.co.y=TARGETS[name][1]+delta.y*factor;vertex.co.z=TARGETS[name][2]+delta.z*factor
                continue
            if .075<radial<.373 and abs(delta.x)<.047:
                old=vertex.co.x;vertex.co.x=math.copysign(.047,delta.x or 1.)
                clearance_edits+=1;max_clearance_shift=max(max_clearance_shift,abs(vertex.co.x-old))
    fixed.data.update();bpy.context.view_layer.update()
    copies=defaultdict(list)
    for vertex,index in zip(fixed.data.vertices,vertex_sources['FrameFixed']):copies[index].append(vertex.co.copy())
    seam_spread=max(((a-b).length for values in copies.values() for a in values for b in values),default=0.)
    budgets={'FrameFixed':9000,'WheelFront':5500,'WheelRear':5500,'Crank':600,'Pedal_L':400,'Pedal_R':400}
    for name,ob in made.items():
        bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
        weld=ob.modifiers.new('Join_Identical_Source_Seams','WELD');weld.merge_threshold=1e-7
        bpy.ops.object.modifier_apply(modifier=weld.name)
        ob.data.calc_loop_triangles()
        if len(ob.data.loop_triangles)>budgets[name]:
            decimate=ob.modifiers.new('Final_Component_Budget','DECIMATE')
            decimate.ratio=budgets[name]/len(ob.data.loop_triangles)*.995;decimate.use_collapse_triangulate=True
            bpy.ops.object.modifier_apply(modifier=decimate.name)
    # The inspected whole-object source has loose scraps at the fused wheel
    # contacts. Keep its main fixed shell and the substantial separate front
    # mudguard shell; remove the disconnected contact/spoke shards seen in QA.
    neighbors=[[] for _ in fixed.data.vertices]
    for edge in fixed.data.edges:
        a,b=edge.vertices;neighbors[a].append(b);neighbors[b].append(a)
    labels={};components=[]
    for vertex in fixed.data.vertices:
        if vertex.index in labels:continue
        tag=len(components);todo=[vertex.index];labels[vertex.index]=tag;component=[]
        while todo:
            a=todo.pop();component.append(a)
            for b in neighbors[a]:
                if b not in labels:labels[b]=tag;todo.append(b)
        components.append(component)
    face_counts=[0]*len(components)
    for polygon in fixed.data.polygons:face_counts[labels[polygon.vertices[0]]]+=len(polygon.vertices)-2
    keep={max(range(len(components)),key=lambda tag:face_counts[tag])}
    for tag,indices in enumerate(components):
        if face_counts[tag]>=100 and max(fixed.data.vertices[i].co.y for i in indices)<-.7:keep.add(tag)
    discarded=[{'triangles':face_counts[tag],'vertices':len(indices)} for tag,indices in enumerate(components) if tag not in keep]
    bm=bmesh.new();bm.from_mesh(fixed.data);bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm,geom=[v for v in bm.verts if labels[v.index] not in keep],context='VERTS')
    bm.to_mesh(fixed.data);bm.free();fixed.data.update()
    validated=[]
    for ob in made.values():
        # Sector welding can leave duplicate triangles. The glTF exporter
        # validates them too; do it before saving so native and GLB agree.
        if ob.data.validate(clean_customdata=False):validated.append(ob.name)
        ob.data.update()
    bpy.context.view_layer.update()
    markers={}

    def marker(name,world,parent=root,target=None):
        ob=bpy.data.objects.new(name,None);bpy.context.scene.collection.objects.link(ob);ob.parent=parent
        ob.location=parent.matrix_world.inverted()@Vector(world);ob.empty_display_type='SPHERE';ob.empty_display_size=.025
        entry={'position':list(world),'rootLocalPosition':list(root.matrix_world.inverted()@Vector(world)),
               'parentLocalPosition':list(ob.location),'parent':parent.name,'surface':True}
        if target is not None:entry.update(target=list(target),residual=list(Vector(world)-Vector(target)))
        markers[name]=entry;return ob

    seat=top_at(fixed,seat_target.x,seat_target.y)
    marker('RiderSeat',seat,target=(0,.21,1.115));marker('RiderStand_R',top_at(fixed,.04,seat_target.y),target=(.04,.21,1.115))
    rack_reference=frame_point(Vector((-.31,0,.470)));rack_tree=tree(fixed);rack_hits=[]
    for i in range(-12,13):
        for j in range(-12,13):
            hit,normal,face,distance=rack_tree.ray_cast(Vector((rack_reference.x+i*.01,rack_reference.y+j*.01,2)),Vector((0,0,-1)))
            if hit is None:continue
            seed=fixed.data.attributes['SourceFace'].data[face].value;polygon=data.polygons[seed]
            center=sum((points[index] for index in polygon.vertices),Vector())/len(polygon.vertices)
            if center.z>.455 and center.x<-.15 and abs(center.y)<.15 and hit.z>rack_reference.z-.025:
                rack_hits.append(hit)
    if not rack_hits:raise ValueError('No actual source rack top surface near its midpoint')
    cargo=min(rack_hits,key=lambda p:(p.x-rack_reference.x)**2+(p.y-rack_reference.y)**2)
    marker('CargoMount',cargo)
    for tag,x in [('L',-.30),('R',.30)]:
        support=top_at(fixed,*grip_xy[tag],footprint=.008)
        marker('RiderGrip_'+tag,support,target=(x,-.58,1.193))
        if tag=='L':marker('RiderStand_L',support,target=(-.30,-.58,1.193))
        pedal=made['Pedal_'+tag];support=top_at(pedal,pedal.matrix_world.translation.x,pedal.matrix_world.translation.y)
        marker('RiderPedal_'+tag,support,parent=pedal)
    bpy.context.view_layer.update()
    fixed_tree=tree(fixed);closest=100.;samples=0;worst=None
    for name in CENTERS:
        wheel=made[name]
        outer=[vertex.co.copy() for vertex in wheel.data.vertices if math.hypot(vertex.co.y,vertex.co.z)>.33]
        for angle in [0,math.pi/4,math.pi/2,math.pi,math.pi*1.5]:
            rotation=Matrix.Rotation(angle,4,'X')
            for local in outer:
                nearest=fixed_tree.find_nearest(wheel.matrix_world@(rotation@local))
                if nearest:
                    samples+=1
                    if nearest[3]<closest:
                        closest=nearest[3]
                        source_face=fixed.data.attributes['SourceFace'].data[nearest[2]].value
                        worst={'wheel':name,'angle':angle,'wheelPoint':list(wheel.matrix_world@(rotation@local)),
                               'framePoint':list(nearest[0]),'sourceRole':roles.get(source_face,'FrameFixed'),'sourceFace':source_face}
    parts={};all_points=[]
    for name,ob in made.items():
        ob.data.calc_loop_triangles();world=[ob.matrix_world@v.co for v in ob.data.vertices];all_points+=world
        parts[name]={'triangles':len(ob.data.loop_triangles),'vertices':len(world),'origin':list(ob.matrix_world.translation),
            'bounds':{'min':[min(p[i] for p in world) for i in range(3)],'max':[max(p[i] for p in world) for i in range(3)]}}
    triangles=sum(part['triangles'] for part in parts.values())
    lo=[min(p[i] for p in all_points) for i in range(3)];hi=[max(p[i] for p in all_points) for i in range(3)]
    provenance={'sourceId':'bicycle','provider':'Tripo','model':'H3.1','sourceSha256':protected[str(master)],
        'geometrySourceSha256':protected[str(source if use_prepared else master)],'triangles':triangles,'wheelRadiusMeters':RADIUS,'wheelbaseMeters':TARGETS['WheelRear'][1]-TARGETS['WheelFront'][1],
        'dimensionsMeters':[b-a for a,b in zip(lo,hi)]}
    for key,value in provenance.items():root[key]=value
    root['markers']=markers
    root['wheelDerivation']=wheel_repairs
    report={**provenance,'sourceFaceCount':len(data.polygons),'assignedFaceCount':sum(source_counts.values()),'fixedSeamMaxSpread':seam_spread,
        'sourceRoleFaceCounts':dict(source_counts),'fixedFenderFaces':source_counts['RearFender']+source_counts['FrontFender'],'fenderReclassifiedFaces':fender_reclassified,
        'parts':parts,'markers':markers,'bounds':{'min':lo,'max':hi},'outputs':[],
        'clearance':{'outerWheelFrameMin':closest,'sampleCount':samples,'localFrameEdits':clearance_edits,'maxShift':max_clearance_shift,'worst':worst},
        'operations':{'geometryPreparation':geometry_operations,'wheelRepairs':wheel_repairs,
            'fixedContactCleanup':{'keptComponents':len(keep),'discardedFusionShards':discarded},
            'validatedMeshes':validated,
            'uniformFrameScale':scale,'wheelUniformScales':wheel_scales,'frameLongitudinalScale':longitudinal,
            'frontAxleSource':AXES['WheelFront'],'rearAxleSource':AXES['WheelRear'],'axlesBakedTo':'Blender X',
            'frontAxleAdjustmentMeters':-.04,'frontAxleAdjustmentReason':'Straightened complete circular tire clears the original down tube; the frame head joint is retained.',
            'wheelRounding':'Local radial tire profile correction in 72 angular bins; no global axial wheel scaling',
            'finalTriangleBudgets':budgets,
            'preserveSourceProportions':True,'frameTransform':{'longitudinalScale':longitudinal,'verticalScale':scale,'verticalShift':vertical_shift},
            'contactPriority':'Original source contour retained; old tall supports are reported as residuals, not forced.',
            'bottomBracket':{'position':list(bb_game),'target':[0,-.04,.4],'residual':list(bb_game-Vector((0,-.04,.4)))},
            'crankRadius':.18,'pedalCounterRotation':'Pedal_L/R.rotation.x = -Crank.rotation.x'},
        'protectedSha256':protected,'limitations':['Source masks are specific to this inspected Tripo export.','Candidate needs visual and hero contact review; old support Y is not forced onto the short bicycle.']}
    if triangles>24000:raise ValueError('Bicycle triangle budget exceeded')
    output.mkdir(parents=True,exist_ok=True)
    bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1
    bpy.data.orphans_purge(do_recursive=True);bpy.context.preferences.filepaths.save_version=0
    bpy.ops.object.select_all(action='DESELECT')
    for ob in [root,*list(root.children_recursive)]:ob.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'bicycle.blend'),check_existing=False)
    bpy.ops.export_scene.gltf(filepath=str(output/'bicycle.glb'),export_format='GLB',use_selection=True,export_yup=True,
        export_extras=True,export_vertex_color='ACTIVE',export_animations=False,export_skins=False,export_morph=False)
    report.update(nativeBytes=(output/'bicycle.blend').stat().st_size,outputBytes=(output/'bicycle.glb').stat().st_size)
    if render:
        report['outputs']=render_views(bpy,made,output)
    for path,digest in protected.items():
        if helper['sha256'](Path(path))!=digest:raise RuntimeError('Source changed: '+path)
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print('TRIPO_BICYCLE_REPORT '+json.dumps(report),flush=True)
    return report


def render_views(bpy,made,output):
    from mathutils import Vector
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=8;scene.cycles.use_denoising=True
    scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='Standard'
    if scene.world is None:scene.world=bpy.data.worlds.new('BicycleReviewWorld')
    background=scene.world.node_tree.nodes.get('Background');background.inputs['Color'].default_value=(.65,.65,.65,1);background.inputs['Strength'].default_value=.8
    target=Vector((0,0,.65))
    bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=2.25
    for position,power in [((3,-4,5),500),((-3,-1,4),250),((1,4,3),300)]:
        bpy.ops.object.light_add(type='AREA',location=position);lamp=bpy.context.object;lamp.data.energy=power;lamp.data.size=4
        lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    outputs=[]
    for name,position,spin in [('side',(4,0,.65),0),('front',(0,-4,.65),0),('three-quarter',(3,-4,2),0),('spin-90-side',(4,0,.65),math.pi/2)]:
        for wheel in ['WheelFront','WheelRear']:made[wheel].rotation_euler.x=spin
        camera.location=position;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
        file=output/(name+'.png');scene.render.filepath=str(file);bpy.ops.render.render(write_still=True);outputs.append(str(file.relative_to(ROOT)))
    palette={'FrameFixed':(.22,.66,.25,1),'WheelFront':(.2,.4,.95,1),'WheelRear':(.90,.24,.18,1),'Crank':(.95,.70,.12,1),'Pedal_L':(.15,.85,.9,1),'Pedal_R':(.85,.25,.80,1)}
    for name,ob in made.items():
        if name.startswith('Wheel'):ob.rotation_euler.x=0
        material=ob.data.materials[0].copy();shader=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        for link in list(shader.inputs['Base Color'].links):material.node_tree.links.remove(link)
        shader.inputs['Base Color'].default_value=palette[name];ob.data.materials[0]=material
    camera.location=(4,0,.65);camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    file=output/'parts-side.png';scene.render.filepath=str(file);bpy.ops.render.render(write_still=True);outputs.append(str(file.relative_to(ROOT)))
    return outputs


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,help='Explicit intermediate blend, used only with --use-prepared')
    parser.add_argument('--master',type=Path,default=ROOT/'assets/sources/banana-tripo-v1/bicycle-master.glb')
    parser.add_argument('--output-dir',type=Path,default=ROOT/'artifacts/tripo-bicycle')
    parser.add_argument('--render',action='store_true')
    parser.add_argument('--use-prepared',action='store_true',help='Use the explicit reduced blend instead of welding and reducing the master')
    arguments=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ([] if 'bpy' in sys.modules else sys.argv[1:])
    args=parser.parse_args(arguments)
    if bool(args.source)!=args.use_prepared:parser.error('--source and --use-prepared must be supplied together')
    prepare(args.source.resolve() if args.source else None,args.master.resolve(),args.output_dir.resolve(),args.render,args.use_prepared)


if __name__=='__main__':main()
