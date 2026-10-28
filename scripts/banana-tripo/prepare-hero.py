"""Derive the Banana rider from its actual Tripo Mixamo skin, never old geometry.

Read-only inspection: python3 scripts/banana-tripo/prepare-hero.py --inspect
Candidate build: blender --background --factory-startup --python-exit-code 1
  --python scripts/banana-tripo/prepare-hero.py -- [--output-dir artifacts/tripo-hero]

The same production JS contact solver authors the 16 native Actions and runs
after the game's Mixer. All output defaults to candidates, outside canonical assets.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import runpy
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/sources/banana-tripo-v1/hero-rigged.glb'
CLIPS = [
    ('Rider_Idle_Ready', 120), ('Rider_Ride_SeatedPedal', 60),
    ('Rider_Ride_StandingBalance', 120), ('Rider_Trans_SitToStand', 21),
    ('Rider_Trans_StandToSit', 21), ('Rider_Jump_Takeoff', 9),
    ('Rider_Jump_Air', 30), ('Rider_Jump_Land', 15),
    ('Rider_Kick_Charge_L', 24), ('Rider_Kick_Charge_R', 24),
    ('Rider_Kick_Strike_L', 42), ('Rider_Kick_Strike_R', 42),
    ('Rider_Lean_L', 1), ('Rider_Lean_R', 1),
    ('Rider_Hit_Shield', 24), ('Rider_Crash', 60),
]


def document(path):
    with path.open('rb') as stream:
        header = stream.read(20)
        if len(header) != 20 or struct.unpack_from('<II', header) != (0x46546c67, 2):
            raise ValueError('Expected a complete GLB 2 source')
        if struct.unpack_from('<I', header, 8)[0] != path.stat().st_size:
            raise ValueError('Truncated GLB source')
        if struct.unpack_from('<I', header, 16)[0] != 0x4e4f534a:
            raise ValueError('Missing GLB JSON')
        return json.loads(stream.read(struct.unpack_from('<I', header, 12)[0]))


def inspect_source(path):
    data = document(path)
    skins = data.get('skins', [])
    if len(skins) != 1 or len(skins[0]['joints']) != 65:
        raise ValueError('Expected one actual 65-joint Mixamo skin')
    if any(not data['nodes'][joint]['name'].startswith('mixamorig:') for joint in skins[0]['joints']):
        raise ValueError('Expected actual mixamorig:* source joints')
    if len(data.get('meshes', [])) != 1:
        raise ValueError('Expected one Tripo visible source mesh')
    triangles = 0
    heights = []
    for primitive in data['meshes'][0]['primitives']:
        for field in ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']:
            if field not in primitive['attributes']:
                raise ValueError('Missing source ' + field)
        position = data['accessors'][primitive['attributes']['POSITION']]
        heights.append(position['max'][1] - position['min'][1])
        triangles += data['accessors'][primitive.get('indices', primitive['attributes']['POSITION'])]['count'] // 3
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {'source': str(path), 'sha256': digest, 'sourceBytes': path.stat().st_size,
            'bones': 65, 'triangles': triangles, 'sourceHeight': max(heights)}


# This driver reads normalized glTF node matrices directly for offline authoring;
# verification additionally loads the real skin using GLTFLoader. Texture decoding
# alone is removed at the Node platform boundary; the output GLB retains its map.
NODE_DRIVER = r'''
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const [mode,input,output,repo]=process.argv.slice(1);
const {MixamoRiderAnimator}=await import(pathToFileURL(path.join(repo,'src/mixamoRiderAnimation.js')));
const bytes=fs.readFileSync(input),size=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+size));
const clips=JSON.parse(process.env.BANANA_HERO_CLIPS);
const contacts=JSON.parse(process.env.BANANA_HERO_CONTACTS??'{}');
function game(name,t){
 const g={phase:'racing',stance:'seated',kickPose:0,kickSide:1,charge:0,jumpHeight:0,jumpVelocity:0,lateralSpeed:0,events:[]};
 if(name.includes('StandingBalance')||name.includes('SitToStand'))g.stance='standing';
 if(name.endsWith('_L'))g.kickSide=-1;
 if(name.includes('Charge'))g.charge=.8;
 if(name.includes('Strike'))g.kickPose=.7*(1-t);
 if(name.includes('Takeoff')){g.jumpHeight=.5*t;g.jumpVelocity=6*(1-t);}
 if(name.includes('Jump_Air')){g.jumpHeight=1.1;g.jumpVelocity=0;}
 if(name.includes('Jump_Land')){g.jumpHeight=.5*(1-t);g.jumpVelocity=-3;}
 if(name.includes('Lean'))g.lateralSpeed=name.endsWith('_L')?-3.5:3.5;
 if(name.includes('Crash')){g.phase='finished';g.endReason='collision';}
 return g;
}
function rootTree(){
 const jointSet=new Set(doc.skins[0].joints),nodes=doc.nodes.map((n,i)=>{
  const o=jointSet.has(i)?new THREE.Bone():new THREE.Group();o.name=n.name??'';o.userData=n.extras??{};
  if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);
  else {o.position.fromArray(n.translation??[0,0,0]);o.quaternion.fromArray(n.rotation??[0,0,0,1]);o.scale.fromArray(n.scale??[1,1,1]);}
  return o;
 });
 doc.nodes.forEach((n,i)=>(n.children??[]).forEach(c=>nodes[i].add(nodes[c])));
 const root=new THREE.Group();doc.scenes[doc.scene??0].nodes.forEach(i=>root.add(nodes[i]));root.updateWorldMatrix(true,true);return root;
}
if(mode==='frames'){
 const root=rootTree(),a=new MixamoRiderAnimator(root,[],contacts),bones=[...a.rest.keys()],result={bones:bones.map(b=>b.name),clips:[]};
 for(const [name,count]of clips){
  a.reset();const initial=name.includes('StandingBalance')||name.includes('StandToSit')?'standing':'seated';
  a.update({...game(name,0),phase:'ready',stance:initial},0,0);
  const shield={type:'shield',id:'author'},frames=[];let maxSupportError=0,maxGripError=0;
  for(let frame=0;frame<=count;frame++){
   const t=frame/count,g=game(name,t);if(name.includes('Hit_Shield'))g.events=[shield];
   const angle=name.includes('SeatedPedal')?t*Math.PI*2:0;
   a.update(g,frame?1/60:0,angle);a.stateTime=t*count/60;
   if(name.includes('SitToStand'))a.stanceBlend=(1-Math.cos(t*Math.PI))/2;
   if(name.includes('StandToSit'))a.stanceBlend=(1+Math.cos(t*Math.PI))/2;
   a.applyContactPose({});root.updateWorldMatrix(true,true);
   for(const e of a.contactErrors){if(e.bone.includes('Foot'))maxSupportError=Math.max(maxSupportError,e.error);else if(a.stanceBlend<.001)maxGripError=Math.max(maxGripError,e.error);}
   frames.push(bones.map(b=>b.matrixWorld.elements.slice()));
  }
  result.clips.push({name,frames,maxSupportError,maxGripError});
 }
 fs.writeFileSync(output,JSON.stringify(result));
 console.log(JSON.stringify(result.clips.map(({name,maxSupportError,maxGripError})=>({name,maxSupportError,maxGripError}))));
}else{
 if(doc.meshes.length!==1)throw new Error('Candidate contains non-Tripo visible helper geometry');
 const clean=structuredClone(doc);clean.materials=[{pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:.85}}];
 for(const m of clean.meshes)for(const p of m.primitives)p.material=0;
 delete clean.images;delete clean.textures;delete clean.samplers;
 const text=Buffer.from(JSON.stringify(clean)),pad=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(pad);
 const binary=bytes.subarray(20+size),packed=Buffer.alloc(20+pad.length+binary.length);
 packed.writeUInt32LE(0x46546c67,0);packed.writeUInt32LE(2,4);packed.writeUInt32LE(packed.length,8);packed.writeUInt32LE(pad.length,12);packed.writeUInt32LE(0x4e4f534a,16);pad.copy(packed,20);binary.copy(packed,20+pad.length);
 const gltf=await new GLTFLoader().parseAsync(packed.buffer,''),a=new MixamoRiderAnimator(gltf.scene,gltf.animations,contacts);
 if(gltf.animations.length!==16)throw new Error('Expected 16 actual exported Actions');
 const report={bones:doc.skins[0].joints.length,clips:[],maxChildTranslation:0,maxContactError:0};
 for(const [name,count]of clips){
  const clip=gltf.animations.find(c=>c.name===name);if(!clip||Math.abs(clip.duration-count/60)>.002)throw new Error('Wrong clip or duration: '+name);
  let adjacentDegrees=0;
  for(const track of clip.tracks.filter(track=>track.ValueTypeName==='quaternion')){
   const interpolant=track.createInterpolant();let previous;
   for(let frame=0;frame<=count;frame++){
    const q=new THREE.Quaternion().fromArray(interpolant.evaluate(frame/60)).normalize();
    if(previous)adjacentDegrees=Math.max(adjacentDegrees,q.angleTo(previous)*180/Math.PI);previous=q;
   }
  }
  if((name.includes('Trans_')||name==='Rider_Crash')&&adjacentDegrees>15)throw new Error('Pose transition snaps '+adjacentDegrees+' degrees: '+name);
  const mixer=new THREE.AnimationMixer(gltf.scene),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  let span=0,vertexSpan=0;const first=new Map(),firstVertices=new Map();
  for(const t of [0,clip.duration*.5,clip.duration]){
   mixer.setTime(t);gltf.scene.updateWorldMatrix(true,true);
   for(const bone of a.rest.keys()){
    const q=bone.quaternion.clone();if(!first.has(bone))first.set(bone,q);span=Math.max(span,q.angleTo(first.get(bone)));
    if(bone!==a.bones.BalanceBody)report.maxChildTranslation=Math.max(report.maxChildTranslation,bone.position.distanceTo(a.rest.get(bone).p));
   }
   gltf.scene.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();for(let i=0;i<o.geometry.attributes.position.count;i+=113){
    const vertex=o.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(o.matrixWorld);
    if(!Number.isFinite(vertex.length()))throw new Error('Nonfinite skin: '+name);
    const key=o.uuid+':'+i;if(!firstVertices.has(key))firstVertices.set(key,vertex);vertexSpan=Math.max(vertexSpan,vertex.distanceTo(firstVertices.get(key)));
   }}});
  }
  if(vertexSpan<1e-5)throw new Error('Action does not deform the actual Tripo skin: '+name);
  mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);report.clips.push({name,seconds:clip.duration,rotationSpan:span,vertexSpan,maxAdjacentRotationDegrees:adjacentDegrees});
 }
 a.reset();
 for(const stance of ['seated','standing'])for(const angle of [0,.8,2.9,4.8]){
  a.update({...game('',0),phase:'ready',stance},0,angle);a.applyContactPose({});
  for(const e of a.contactErrors)if(e.bone.includes('Foot')||stance==='seated')report.maxContactError=Math.max(report.maxContactError,e.error);
 }
 const before=[...a.rest.keys()].map(b=>b.matrixWorld.elements.slice());
 for(let i=0;i<20;i++){a.update({...game('',0),phase:'ready',stance:'standing'},0,4.8);a.applyContactPose({});}
 report.repeatError=Math.max(...[...a.rest.keys()].flatMap((b,i)=>b.matrixWorld.elements.map((v,j)=>Math.abs(v-before[i][j]))));
 if(report.maxChildTranslation>.0001||report.maxContactError>.005||report.repeatError>1e-6)throw new Error('Candidate skin regression: '+JSON.stringify(report));
 fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
'''


def node_run(node, mode, source, output, contacts=None):
    import os
    environment = dict(os.environ, BANANA_HERO_CLIPS=json.dumps(CLIPS), BANANA_HERO_CONTACTS=json.dumps(contacts or {}))
    result = subprocess.run([node, '--input-type=module', '--eval', NODE_DRIVER,
                             mode, str(source), str(output), str(ROOT)],
                            cwd=ROOT, env=environment, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Hero JS ' + mode + ' failed:\n' + result.stdout + result.stderr)
    print('TRIPO_HERO_' + mode.upper(), result.stdout.strip(), flush=True)


def base_color(bpy, mesh, directory, size):
    images = set()
    for material in mesh.data.materials:
        material.use_nodes = True
        nodes = material.node_tree.nodes
        shader = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
        output = next(node for node in nodes if node.type == 'OUTPUT_MATERIAL')
        links = list(shader.inputs['Base Color'].links)
        if len(links) != 1 or links[0].from_node.type != 'TEX_IMAGE':
            raise ValueError('Expected actual Tripo baseColor image')
        texture = links[0].from_node
        images.add(texture.image)
        for node in list(nodes):
            if node not in {shader, output, texture}:
                nodes.remove(node)
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Roughness'].default_value = .85
        material.diffuse_color = (1, 1, 1, 1)
        material.name = 'Banana_Tripo_H31_BaseColor'
    reports = []
    for i, image in enumerate(images):
        ratio = min(1, size / max(image.size))
        image.scale(max(1, round(image.size[0] * ratio)), max(1, round(image.size[1] * ratio)))
        # Keep the source JPEG codec for opaque painted maps; PNG retains alpha
        # for any future cutout input. Both keep the same resized layout and UVs.
        format = 'JPEG' if image.file_format == 'JPEG' else 'PNG'
        filename = 'baseColor-' + str(i) + ('.jpg' if format == 'JPEG' else '.png')
        image.file_format = format; image.filepath_raw = str(directory / filename)
        image.save(quality=90); encoded = Path(image.filepath_raw).read_bytes()
        image.pack(data=encoded, data_len=len(encoded)); image.filepath = '//textures/' + filename
        reports.append({'size': list(image.size), 'bytes': len(encoded), 'format': format})
    for image in list(bpy.data.images):
        if image not in images:
            bpy.data.images.remove(image, do_unlink=True)
    return reports


def make_markers(bpy, arm, mesh, factor):
    from mathutils import Matrix, Vector
    conversion = Matrix.Rotation(math.pi / 2, 4, 'X')
    inverse = conversion.inverted()
    reports = {}

    def marker(name, bone, position, frame):
        obj = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(obj)
        obj.empty_display_type = 'ARROWS'; obj.empty_display_size = .05
        obj.parent = arm; obj.parent_type = 'BONE'; obj.parent_bone = bone.name
        bpy.context.view_layer.update()
        # glTF converts Empty local axes as well as world axes, unlike bone bases.
        matrix = frame @ inverse; matrix.translation = position; obj.matrix_world = matrix
        bpy.context.view_layer.update()
        reports[name] = {'bone': bone.name, 'restPosition': list(inverse @ position)}

    order = sorted(['Left', 'Right'], key=lambda side: arm.data.bones['mixamorig:' + side + 'Foot'].head_local.x)
    for side, tag in zip(order, ['L', 'R']):
        names = ['mixamorig:' + side + suffix for suffix in ['Foot', 'ToeBase', 'Toe_End']]
        groups = {mesh.vertex_groups[name].index for name in names if mesh.vertex_groups.get(name)}
        points = [vertex.co.copy() for vertex in mesh.data.vertices
                  if sum(group.weight for group in vertex.groups if group.group in groups) > .5]
        floor = min(point.z for point in points)
        low = [point for point in points if point.z < floor + .006 * factor]
        position = sum(low, Vector()) / len(low); position.z = floor
        foot = arm.data.bones[names[0]]; toe = arm.data.bones[names[2]]
        forward = inverse.to_3x3() @ (toe.head_local - foot.head_local); forward.y = 0; forward.normalize()
        yaw = math.atan2(forward.x, forward.z)
        marker('Sole_' + tag, foot, position, conversion @ Matrix.Rotation(yaw, 4, 'Y'))

        hand = arm.data.bones['mixamorig:' + side + 'Hand']
        knuckles = [arm.data.bones['mixamorig:' + side + 'Hand' + finger + '1'].head_local
                    for finger in ['Index', 'Middle', 'Ring', 'Pinky']]
        along = (sum(knuckles, Vector()) / len(knuckles) - hand.head_local).normalized()
        across = (knuckles[0] - knuckles[-1]).normalized()
        normal = along.cross(across).normalized()
        if normal.y > 0: normal.negate(); across.negate()
        across = normal.cross(along).normalized()
        frame = Matrix((across, normal, along)).transposed().to_4x4()
        target = hand.head_local.lerp(sum(knuckles, Vector()) / len(knuckles), .5) + normal * .009 * factor
        group = mesh.vertex_groups[hand.name].index
        candidates = [vertex for vertex in mesh.data.vertices if any(g.group == group and g.weight > .8 for g in vertex.groups)]
        selected = min(candidates, key=lambda vertex: (vertex.co - target).length_squared)
        marker('Palm_' + tag, hand, selected.co, frame)
        reports['Palm_' + tag]['sourceVertex'] = selected.index

    hips = arm.data.bones['mixamorig:Hips']
    target = hips.head_local + Vector((0, .05 * factor, -.045 * factor))
    candidates = [vertex for vertex in mesh.data.vertices if abs(vertex.co.x) < .05 * factor and
                  hips.head_local.z - .085 * factor < vertex.co.z < hips.head_local.z + .02 * factor and vertex.co.y > .02 * factor]
    selected = min(candidates, key=lambda vertex: (vertex.co - target).length_squared)
    marker('SeatContact', hips, selected.co, conversion)
    reports['SeatContact']['sourceVertex'] = selected.index
    return reports


def bake(bpy, arm, frames):
    from mathutils import Matrix
    conversion = Matrix.Rotation(math.pi / 2, 4, 'X')
    bones = frames['bones']; actions = {}
    maximum_translation = 0
    for clip in frames['clips']:
        action = bpy.data.actions.new(clip['name']); action.use_fake_user = True
        arm.animation_data_create(); arm.animation_data.action = action
        if 'Strike' in clip['name']: action.pose_markers.new('impact').frame = 8
        for frame, matrices in enumerate(clip['frames']):
            bpy.context.scene.frame_set(frame)
            desired = {name: conversion @ Matrix([matrix[i:i + 4] for i in range(0, 16, 4)]).transposed()
                       for name, matrix in zip(bones, matrices)}
            for bone in arm.data.bones:
                pose = arm.pose.bones[bone.name]
                parent = bone.parent
                kwargs = {'parent_matrix': desired[parent.name], 'parent_matrix_local': parent.matrix_local} if parent else {}
                basis = bone.convert_local_to_pose(desired[bone.name], bone.matrix_local, invert=True, **kwargs)
                pose.matrix_basis = basis
                pose.rotation_mode = 'QUATERNION'
                if parent: maximum_translation = max(maximum_translation, pose.location.length)
                if max(abs(value - 1) for value in pose.scale) > 1e-4:
                    raise RuntimeError('Pose introduced bone scaling: ' + bone.name)
                pose.scale = (1, 1, 1)
                pose.keyframe_insert('location', frame=frame, group=bone.name)
                pose.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
        actions[clip['name']] = action
        track = arm.animation_data.nla_tracks.new(); track.name = clip['name']
        strip = track.strips.new(clip['name'], 0, action); strip.action_frame_start = 0
        strip.action_frame_end = len(clip['frames']) - 1; track.mute = True
    if maximum_translation > 1e-4:
        raise RuntimeError('Bake changed child bone offsets: ' + str(maximum_translation))
    arm.animation_data.action = None
    for pose in arm.pose.bones: pose.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    return actions, maximum_translation


def prepare(options, report):
    import bpy
    from mathutils import Matrix, Vector
    if not bpy.app.background:
        raise RuntimeError('Hero preparation requires an independent headless Blender process')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'; bpy.context.scene.unit_settings.scale_length = 1
    bpy.context.scene.render.fps = 60
    bpy.context.scene.frame_start = 0; bpy.context.scene.frame_end = 120
    bpy.ops.import_scene.gltf(filepath=str(options.source))
    # Blender 5.2's importer creates a visible Icosphere custom bone shape.
    # It is an editor helper, not part of the single-mesh Tripo GLB.
    shapes = {bone.custom_shape for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'
              for bone in obj.pose.bones if bone.custom_shape}
    for obj in bpy.context.scene.objects:
        if obj.type == 'ARMATURE':
            for bone in obj.pose.bones: bone.custom_shape = None
    for shape in shapes: bpy.data.objects.remove(shape, do_unlink=True)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    arms = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if len(meshes) != 1 or len(arms) != 1 or len(arms[0].data.bones) != 65:
        raise ValueError('Expected the original one-mesh, 65-bone source after import: ' +
                         str([(obj.name, obj.type, len(obj.data.bones) if obj.type == 'ARMATURE' else None)
                              for obj in bpy.context.scene.objects]))
    mesh, arm = meshes[0], arms[0]
    points = [mesh.matrix_world @ vertex.co for vertex in mesh.data.vertices]
    bottom = min(point.z for point in points); height = max(point.z for point in points) - bottom
    factor = options.height / height
    center = (min(point.x for point in points) + max(point.x for point in points)) / 2
    transform = Matrix.Translation((-center * factor, 0, -bottom * factor)) @ Matrix.Scale(factor, 4)
    mesh_world, arm_world = mesh.matrix_world.copy(), arm.matrix_world.copy()
    mesh.parent = None; arm.parent = None
    arm.data.transform(transform @ arm_world); mesh.data.transform(transform @ mesh_world)
    arm.matrix_world = Matrix.Identity(4); mesh.matrix_world = Matrix.Identity(4)
    for modifier in mesh.modifiers:
        if modifier.type == 'ARMATURE': modifier.object = arm
    mesh.parent = arm; mesh.matrix_parent_inverse = Matrix.Identity(4)
    root = bpy.data.objects.new('BananaTripoHero', None); bpy.context.scene.collection.objects.link(root)
    arm.parent = root; arm.name = 'BananaTripoMixamoRig'; mesh.name = 'BananaTripoHeroSkin'
    root['provider'] = 'Tripo'; root['sourceSha256'] = report['sha256']; root['sourceAsset'] = str(options.source.relative_to(ROOT))
    root['rigProfile'] = 'mixamo65-banana-v1'; root['naturalHeight'] = options.height
    if report.get('contactConfig'):
        root['riderContactConfigJSON'] = json.dumps(report['contactConfig'], sort_keys=True)
    bpy.context.view_layer.update()
    contacts = make_markers(bpy, arm, mesh, factor)
    output = options.output_dir; output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='banana-tripo-hero-') as scratch:
        scratch = Path(scratch)
        textures = base_color(bpy, mesh, scratch, options.texture_size)
        bpy.ops.object.select_all(action='SELECT')
        for obj in bpy.context.selected_objects:
            if obj.type == 'MESH' and obj != mesh:
                raise RuntimeError('Unexpected visible geometry in Tripo hero candidate')
        common = dict(export_format='GLB', use_selection=True, export_yup=True, export_extras=True,
                      export_skins=True, export_def_bones=False, export_influence_nb=4)
        bind = scratch / 'bind.glb'
        bpy.ops.export_scene.gltf(filepath=str(bind), export_animations=False, **common)
        posed = scratch / 'poses.json'; node_run(options.node, 'frames', bind, posed, report.get('contactConfig'))
        frames = json.loads(posed.read_text())
        actions, max_translation = bake(bpy, arm, frames)
        for track in arm.animation_data.nla_tracks: track.mute = False
        glb = output / 'riderSkinned.glb'
        bpy.ops.export_scene.gltf(filepath=str(glb), export_animations=True, export_animation_mode='NLA_TRACKS',
                                  export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True,
                                  export_reset_pose_bones=True, **common)
        for track in arm.animation_data.nla_tracks: track.mute = True
        arm.animation_data.action = actions['Rider_Ride_SeatedPedal']; bpy.context.scene.frame_set(0)
    mesh.data.calc_loop_triangles()
    metadata = {**report, 'provider': 'Tripo', 'model': 'H3.1', 'rig': 'Original Tripo Mixamo65 skin; no old visible mesh',
                'fps': 60, 'naturalHeight': options.height, 'uniformScale': factor, 'runtimeTriangles': len(mesh.data.loop_triangles),
                'vertices': len(mesh.data.vertices), 'textures': textures, 'contactMarkers': contacts,
                'clips': [{'name': name, 'frames': count, 'seconds': count / 60} for name, count in CLIPS],
                'maxChildPoseTranslation': max_translation,
                'authoringContactErrors': [{key: clip[key] for key in ['name', 'maxSupportError', 'maxGripError']} for clip in frames['clips']],
                'coordinateConvention': 'Blender metres, Z up, forward -Y; glTF Y up, forward +Z. Canonical L is actor -X (actual Right).'}
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'hero.blend'), check_existing=False)
    # The saved native file is the rebuild authority. Reopening it also makes
    # bone-parented marker transforms identical to all later saved exports.
    with tempfile.TemporaryDirectory(prefix='banana-hero-saved-export-') as scratch:
        manifest = Path(scratch) / 'manifest.json'
        manifest.write_text(json.dumps({'sourceFiles': ['hero.blend'], 'models': {'riderSkinned': {
            'file': 'riderSkinned.glb', 'source': 'hero.blend', 'root': root.name,
            'animations': True, 'bones': 65, 'clips': [name for name, _ in CLIPS]}}}))
        exporter = runpy.run_path(str(ROOT / 'scripts/export-saved-assets.py'))
        exporter['export_saved_assets'](manifest, output, root=output)
    node_run(options.node, 'verify', glb, output / 'verification.json', report.get('contactConfig'))
    metadata['verification'] = json.loads((output / 'verification.json').read_text())
    (output / 'hero-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    if hashlib.sha256(options.source.read_bytes()).hexdigest() != report['sha256']:
        raise RuntimeError('Immutable rigged source changed')
    print('TRIPO_HERO_RESULT ' + json.dumps(metadata), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'artifacts/tripo-hero')
    parser.add_argument('--height', type=float, default=1.85)
    parser.add_argument('--texture-size', type=int, default=2048)
    parser.add_argument('--contact-config', type=Path, help='Measured bike contacts in glTF Y-up metres')
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--inspect', action='store_true')
    arguments = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    options = parser.parse_args(arguments)
    if not math.isfinite(options.height) or options.height <= 0:
        parser.error('Expected a positive finite height')
    if options.texture_size <= 0:
        parser.error('Expected a positive texture size')
    options.source = options.source.resolve(); options.output_dir = options.output_dir.resolve()
    report = inspect_source(options.source)
    if options.contact_config:
        contacts = json.loads(options.contact_config.read_text())
        vectors = {'seat': 1, 'standing': 2, 'grips': 2, 'pedalCenter': 1, 'pedalOffsets': 2, 'pelvisStanding': 1}
        if not isinstance(contacts, dict): parser.error('Contact config must be an object')
        for key in ['seat', 'standing', 'grips', 'pedalCenter', 'pedalWidth', 'crankRadius']:
            if key not in contacts: parser.error('Contact config is missing ' + key)
        for key, count in vectors.items():
            if key not in contacts: continue
            values = [contacts[key]] if count == 1 else contacts[key]
            if not isinstance(values, list) or len(values) != count or any(
                    not isinstance(value, list) or len(value) != 3 or any(
                        not isinstance(number, (int, float)) or isinstance(number, bool) or not math.isfinite(number) for number in value)
                    for value in values):
                parser.error(key + ' must contain three finite numbers per point')
        for key in ['pedalWidth', 'crankRadius']:
            value = contacts[key]
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0:
                parser.error(key + ' must be positive and finite')
        if set(contacts) - (set(vectors) | {'pedalWidth', 'crankRadius'}): parser.error('Unknown contact config field')
        report['contactConfig'] = contacts
        report['contactConfigSha256'] = hashlib.sha256(options.contact_config.read_bytes()).hexdigest()
    if options.inspect:
        print(json.dumps(report)); return
    if options.source in {(options.output_dir / name).resolve() for name in ['riderSkinned.glb', 'hero.blend', 'hero-metadata.json']}:
        parser.error('Refusing to overwrite source with a derived candidate')
    if not options.node:
        parser.error('Node.js is required for the shared production contact solver')
    prepare(options, report)


if __name__ == '__main__':
    main()
