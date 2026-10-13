"""Checks editable skin, weights, authored actions and sampled glTF output."""
import bpy,json,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'assets/blender/rider-hero.blend'
assert source.exists(), 'independent editable hero source missing'
bpy.ops.wm.open_mainfile(filepath=str(source))
rig=bpy.data.objects['RiderDeformRig'];mesh=bpy.data.objects['RiderHeroSkin']
assert rig.type=='ARMATURE' and len(rig.data.bones)<=70
assert any(m.type=='ARMATURE' and m.object==rig for m in mesh.modifiers)
mesh.data.calc_loop_triangles();assert 8000<=len(mesh.data.loop_triangles)<=12000,len(mesh.data.loop_triangles)
blended=0
for v in mesh.data.vertices:
    weights=[g.weight for g in v.groups if g.weight>1e-5]
    assert 1<=len(weights)<=4
    assert abs(sum(weights)-1)<1e-4
    blended+=len(weights)>1
assert blended>250,('missing deformation transition weights',blended)
assert bpy.context.scene.render.fps==60
names=['Rider_Idle_Ready','Rider_Ride_SeatedPedal','Rider_Ride_StandingBalance','Rider_Trans_SitToStand','Rider_Trans_StandToSit','Rider_Jump_Takeoff','Rider_Jump_Air','Rider_Jump_Land','Rider_Kick_Charge_L','Rider_Kick_Charge_R','Rider_Kick_Strike_L','Rider_Kick_Strike_R','Rider_Lean_L','Rider_Lean_R','Rider_Hit_Shield','Rider_Crash']
for name in names:
    action=bpy.data.actions.get(name);assert action,name
    if 'Strike' in name:
        assert action.pose_markers['impact'].frame==8
        assert tuple(action.frame_range)==(0.,42.)
blob=(ROOT/'assets/export/riderSkinned.glb').read_bytes();n=struct.unpack_from('<I',blob,12)[0];doc=json.loads(blob[20:20+n])
assert set(names)=={a['name'] for a in doc['animations']}
assert doc['skins'] and max(len(s['joints']) for s in doc['skins'])<=70
for m in doc['meshes']:
    for p in m['primitives']:assert 'JOINTS_0' in p['attributes'] and 'WEIGHTS_0' in p['attributes']
print(json.dumps({'triangles':len(mesh.data.loop_triangles),'vertices':len(mesh.data.vertices),'bones':len(rig.data.bones),'blendedVertices':blended,'clips':len(names),'status':'PASS'}))
