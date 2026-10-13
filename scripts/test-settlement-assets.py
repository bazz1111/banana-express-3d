"""Inspect saved native river/settlement alignment, not instance counts alone."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

root=Path(__file__).resolve().parents[1]
course=json.loads((root/'public/assets/course.json').read_text())
scale=course['road']['advance']['z']/1600
def route(s):
    i=min(799,math.floor(s/2));a,b=course['points'][i:i+2];t=(s-a['s'])/2
    return Vector((a['x']+(b['x']-a['x'])*t,-(a['z']+(b['z']-a['z'])*t)/scale,-.04*s))
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/blender/valley-layout.blend'))
bpy.context.view_layer.update()
land=bpy.data.objects['ValleyTerrain'];nx,ny=67,93
errors=[]
for j in range(ny):
    s=j*1600/(ny-1);p=route(s);v=land.data.vertices[j*nx].co
    errors.append(max(abs(v.x-(p.x-100)),abs(v.y-p.y)))
failures=[]
if max(errors)>.001:failures.append('Native valley still follows a straight strip instead of the authored curved route')
water=bpy.data.objects['ValleyWater'];water.data.calc_loop_triangles()
if len(water.data.loop_triangles)<180:failures.append('Water must follow the same native along-course rows as terrain')
bases=bpy.data.objects['ValleyFoundations'].children
clusters=bpy.data.objects['EndlessValley'].get('settlements',[])
if len(clusters)!=6:failures.append('Missing native distributed settlements')
if len(bases)<180:failures.append('Too few native plots to form visible distributed settlements')
forest=bpy.data.objects['ValleyForest'].children
if len(forest)!=2400:failures.append('Forest coverage lost the authored native instance set')
xy=[(o.scale.x+o.scale.y)/2 for o in forest]
if sum(xy)/len(xy)<3.6:failures.append('Canopies still appear as uniformly sparse isolated trees')
report={'pass':not failures,'rowSamples':ny,'maxRouteAlignmentError':max(errors),'waterTriangles':len(water.data.loop_triangles),
        'settlementClusters':len(clusters),'buildings':len(bases),'forestTrees':len(forest),'meanCanopyScale':sum(xy)/len(xy),
        'failures':failures,'scope':'Saved native route/water/cluster authoring; visible town quality requires actual engine pixels and reference comparison.'}
(root/'artifacts/settlement-native-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('SETTLEMENT_NATIVE_REPORT',json.dumps(report))
assert not failures, '; '.join(failures)
print('SETTLEMENT_NATIVE_PASS')
