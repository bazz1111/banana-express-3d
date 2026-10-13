"""Read saved native geometry: varying rock cut, dense ridge silhouettes and protected lane."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root = Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/blender/endless-course.blend'))
bpy.context.view_layer.update()
vertices, faces = [], []
for chunk in bpy.data.objects['EndlessRoadCourse'].children:
    land = next(o for o in chunk.children if o.get('surfaceRole') == 'terrain')
    offset = len(vertices)
    vertices.extend(land.matrix_world @ v.co for v in land.data.vertices)
    faces.extend(tuple(offset+i for i in p.vertices) for p in land.data.polygons)
bvh = BVHTree.FromPolygons(vertices, faces, all_triangles=True)
course = json.loads((root/'public/assets/course.json').read_text())
heights = []
for s in range(0,1600,2):
    sample = course['points'][s//2]
    p = Vector((sample['x']-10*math.cos(sample['yaw']), -sample['z']-10*math.sin(sample['yaw']), 300))
    hit = bvh.ray_cast(p,Vector((0,0,-1)))[0]
    assert hit is not None, ('Missing native right bank',s)
    heights.append(hit.z-sample['y'])
failures = []
bank_range = max(heights)-min(heights)
if bank_range < 1.2: failures.append('The road cut is still longitudinally flat, without modeled rock relief')
if len(faces) < 20000: failures.append('Rock relief lacks the authored 2m surface resolution')
if min(heights) < 4.8: failures.append('Relief has removed the continuous right rock bank')
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/blender/asset-library.blend'))
ridges = {}
for name in ['Mountain','ForestHill']:
    obj = bpy.data.objects[name]
    geometry = next(o.data for o in obj.children_recursive if o.type == 'MESH')
    triangles = sum(len(p.vertices)-2 for p in geometry.polygons)
    ridges[name] = {'vertices':len(geometry.vertices),'triangles':triangles}
    if triangles < 1800: failures.append(name+' still has coarse, smooth repeated silhouettes')
report = {'pass':not failures,'bankSamples':len(heights),'bankHeightMin':min(heights),
          'bankHeightMax':max(heights),'bankHeightRange':bank_range,'terrainTriangles':len(faces),
          'ridges':ridges,'failures':failures,'scope':'Saved native surface relief and template resolution; visual fidelity requires actual scene comparison.'}
(root/'artifacts/rock-ridges-native-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('ROCK_RIDGES_NATIVE_REPORT',json.dumps(report))
assert not failures, '; '.join(failures)
print('ROCK_RIDGES_NATIVE_PASS')
