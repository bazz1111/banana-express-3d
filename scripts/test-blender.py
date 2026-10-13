"""Local Blender integration: rebuild all sources, validate standing support and obstacle extents."""
import runpy
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root=Path(__file__).resolve().parents[1]
# CI rebuilds by default; --verify-only checks settled sources without racing another writer.
if '--verify-only' not in sys.argv:
    builders=runpy.run_path(str(Path(__file__).with_name('build-assets.py')))
    probe=builders['rod']((0,0,0),(2,0,0),.025,'black')
    bpy.context.view_layer.update()
    bounds=[probe.matrix_world@Vector(p) for p in probe.bound_box]
    extent=[max(p[i] for p in bounds)-min(p[i] for p in bounds) for i in range(3)]
    assert abs(extent[0]-2)<.001 and extent[2]<.06, extent
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/blender/asset-library.blend'))
bpy.context.view_layer.update()
rider=bpy.data.objects['StandingRider']
for tag,expected in [('L',(-.30,-.58,1.311)),('R',(.04,.21,1.233))]:
    foot=bpy.data.objects['Foot_'+tag]
    local=rider.matrix_world.inverted()@foot.matrix_world.translation
    assert (local-Vector(expected)).length<.00001, (tag,local)
    sole=bpy.data.objects['HeroPart_Foot_'+tag]
    vertices=[rider.matrix_world.inverted()@sole.matrix_world@v.co for v in sole.data.vertices]
    support_top=1.193 if tag=='L' else 1.115
    assert support_top-.001<min(v.z for v in vertices)<support_top+.010
    assert bpy.data.objects['Arm_'+tag].parent.name=='BalanceBody'
    assert bpy.data.objects['HeroPart_Hand_'+tag].parent.name=='Hand_'+tag
print('BLENDER_STANDING_SUPPORT_PASS')
for name,size in [('LowBarrier',(2.2,.7,.5)),('HighWall',(3.22,1.03,2.8)),('LongTrain',(2.6,14,3.0))]:
    obj=bpy.data.objects[name]
    vertices=[obj.matrix_world.inverted()@child.matrix_world@v.co for child in obj.children_recursive if child.type=='MESH' for v in child.data.vertices]
    actual=[max(v[i] for v in vertices)-min(v[i] for v in vertices) for i in range(3)]
    assert all(abs(a-b)<.18 for a,b in zip(actual,size)), (name,actual,size)
    print('BLENDER_OBSTACLE_EXTENT_PASS',name,actual)
for name in ['Bicycle','BananaFruit','Pickup_boost','Pickup_shield','Pickup_double','EndlessRoadTile','Elbow_L','Elbow_R','Hand_L','Hand_R']:
    assert bpy.data.objects.get(name), name
goat=bpy.data.objects['Goat']
heights=[(goat.matrix_world.inverted()@o.matrix_world@v.co).z for o in goat.children_recursive if o.type=='MESH' for v in o.data.vertices]
assert .79<max(heights)-min(heights)<.82, 'Goat horn height must match its jumpable .8m collision proxy'
print('BLENDER_ENDLESS_SOURCE_PASS' if '--verify-only' in sys.argv else 'BLENDER_ENDLESS_REBUILD_PASS',bpy.app.version_string)
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/blender/standing-motion.blend'))
for frame in [1,9,17,25,33]:
    bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
    for side,tag in [(-1,'L'),(1,'R')]:
        foot=bpy.data.objects['Foot_'+tag].matrix_world.translation;pedal=bpy.data.objects['Pedal_'+tag].matrix_world.translation
        assert (foot-pedal-Vector((0,.075,.138))).length<.00001, ('seated foot',frame,tag,foot,pedal)
        hand=bpy.data.objects['Hand_'+tag].matrix_world.translation
        assert (hand-Vector((side*.36,-.50,1.20))).length<.00001, ('seated hand',frame,tag,hand)
bpy.context.scene.frame_set(48);bpy.context.view_layer.update()
for tag,expected in [('L',(-.30,-.58,1.311)),('R',(.04,.21,1.233))]:
    assert (bpy.data.objects['Foot_'+tag].matrix_world.translation-Vector(expected)).length<.00001
print('BLENDER_SEATED_AND_STANDING_MOTION_PASS')
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/blender/valley-layout.blend'))
assert bpy.context.scene.name=='ValleyLayout'
bpy.context.view_layer.update();land=bpy.data.objects['ValleyTerrain'];valley=bpy.data.objects['EndlessValley']
bvh=BVHTree.FromPolygons([land.matrix_world@v.co for v in land.data.vertices],[list(p.vertices) for p in land.data.polygons])
water=bpy.data.objects['ValleyWater'];water_bvh=BVHTree.FromPolygons([water.matrix_world@v.co for v in water.data.vertices],[list(p.vertices) for p in water.data.polygons])
def water_height(p):
    hit=water_bvh.ray_cast(Vector((p.x,p.y,300)),Vector((0,0,-1)))[0]
    assert hit,'Missing actual native water at '+str(p)
    return hit.z
vertices=land.data.vertices
assert all(abs(vertices[i].co.z-vertices[len(vertices)-67+i].co.z-64)<.0001 for i in range(67)),'Valley seam must follow the native downhill period'
colors={loop.vertex_index:tuple(land.data.color_attributes['Color'].data[loop.index].color) for loop in land.data.loops}
assert all(colors[i]==colors[len(vertices)-67+i] for i in range(67)),'Valley seam palette must be continuous'
foundations=bpy.data.objects['ValleyFoundations'].children;centres=[];samples=0
assert len(foundations)==valley['buildings'] and len(foundations)>80
for base in foundations:
    building=bpy.data.objects[base['building']];top=(base.matrix_world@Vector((0,0,1))).z;bottom=(base.matrix_world@Vector((0,0,0))).z
    assert abs(building.matrix_world.translation.z-top)<.0001
    for x in [-.5,0,.5]:
        for y in [-.5,0,.5]:
            p=base.matrix_world@Vector((x,y,0));hit=bvh.ray_cast(Vector((p.x,p.y,300)),Vector((0,0,-1)))[0]
            assert hit and bottom-.001<=hit.z<=top+.001 and hit.z>water_height(p)+1, (base.name,p,hit)
            samples+=1
    centre=base.matrix_world.translation;radius=(base.scale.x**2+base.scale.y**2)**.5/2
    assert all((Vector((centre.x,centre.y))-xy).length>=radius+r+1.39 for xy,r in centres),base.name
    centres.append((Vector((centre.x,centre.y)),radius))
forest=list(bpy.data.objects['ValleyForest'].children)+list(bpy.data.objects['ValleyForestFar'].children)
assert len(forest)==2400
for tree in forest:
    p=tree.matrix_world.translation;hit=bvh.ray_cast(Vector((p.x,p.y,300)),Vector((0,0,-1)))[0]
    assert hit and abs(p.z-hit.z)<.0001 and hit.z>water_height(p)+1.3,tree.name
for palm in bpy.data.objects['ValleyPalms'].children:
    p=palm.matrix_world.translation
    assert all((Vector((p.x,p.y))-Vector((t.matrix_world.translation.x,t.matrix_world.translation.y))).length>.899 for t in forest),'Palm and forest trunks overlap'
print('BLENDER_VALLEY_LAYOUT_PASS',{'buildings':len(foundations),'samples':samples,'trees':valley['trees'],'palms':valley['palms']})
