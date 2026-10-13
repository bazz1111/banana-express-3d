"""Inspect real Blender-authored distant canopy and village support."""
import bpy
import json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/blender/valley-layout.blend'))
bpy.context.view_layer.update()
names=['ValleyPanoramaForest','ValleyPanoramaHouse','ValleyPanoramaLonghouse','ValleyPanoramaTower','ValleyPanoramaFoundations']
missing=[name for name in names if name not in bpy.data.objects]
assert not missing, 'Missing native panorama props: '+', '.join(missing)
forest=bpy.data.objects[names[0]].children
assert len(forest)==3600, 'The full native distant grove set must be retained'
assert len({o.data.as_pointer() for o in forest})==1, 'Distant canopies must share one native mesh'
assert forest[0].data.as_pointer()==bpy.data.objects['ValleyForest'].children[0].data.as_pointer(), 'Far and near forests must reuse the existing native template'
forest[0].data.calc_loop_triangles()
triangles=len(forest[0].data.loop_triangles)
assert triangles<180, 'Far canopy template exceeds the performance budget'
vertices=[];faces=[]
for hill in bpy.data.objects['ValleyFoothills'].children:
    offset=len(vertices);vertices.extend(hill.matrix_world@v.co for v in hill.data.vertices)
    faces.extend(tuple(offset+i for i in p.vertices) for p in hill.data.polygons)
bvh=BVHTree.FromPolygons(vertices,faces)
errors=[]
for tree in forest:
    p=tree.matrix_world.translation
    hit=bvh.ray_cast(Vector((p.x,p.y,300)),Vector((0,0,-1)))[0]
    assert hit is not None, 'Far tree is outside the native hills'
    errors.append(abs(hit.z-p.z))
    assert p.z>-24, 'Distant forest roots must stay on the visible dry hillside'
assert max(errors)<.001, 'Distant trees float above or intersect the hills'
bases=bpy.data.objects['ValleyPanoramaFoundations'].children
assert len(bases)>=300, 'Distant villages lack distributed roofs'
houses=list(bpy.data.objects['ValleyPanoramaHouse'].children)+list(bpy.data.objects['ValleyPanoramaLonghouse'].children)
compact=0
for house in houses:
    points=[Vector(p) for p in house.bound_box]
    height=max(p.z for p in points)-min(p.z for p in points)
    width=max(p.x for p in points)-min(p.x for p in points)
    compact+=height/width<.9
assert compact/len(houses)>=.70, 'Reference A village silhouettes need mostly broad low roofs, not tall narrow houses'
assert len(bpy.data.objects['ValleyPanoramaTower'].children)<=6, 'Repeated bell towers dominate the distant villages'
report={'pass':True,'trees':len(forest),'templateTriangles':triangles,'sharedForestMeshes':1,'maxRootError':max(errors),
        'buildings':len(bases),'hills':18,'compactHouseFraction':compact/len(houses),'towers':len(bpy.data.objects['ValleyPanoramaTower'].children),
        'scope':'Saved native far-forest and buildings; full foundation clipping and actual runtime pixels checked separately.'}
(root/'artifacts/panorama-props-native-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('PANORAMA_PROPS_NATIVE_PASS',json.dumps(report))
