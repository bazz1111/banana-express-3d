"""Check the saved local Blender course, not a screenshot or inferred height function."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root=Path(__file__).resolve().parents[1]
course=json.loads((root/'assets/export/course.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/blender/endless-course.blend'))
assert bpy.context.scene.name=='EndlessCourse'
assert bpy.context.scene.unit_settings.system=='METRIC'
bpy.context.view_layer.update()
chunks=sorted(bpy.data.objects['EndlessRoadCourse'].children,key=lambda o:o['segment'])
assert len(chunks)==20
vertices=[];faces=[];roads=[];terrain=[]
for chunk in chunks:
    surfaces={o['surfaceRole']:o for o in chunk.children if 'surfaceRole' in o}
    assert set(surfaces)=={'road','terrain','guard'}
    roads.append(surfaces['road']);terrain.append(surfaces['terrain'])
    land=surfaces['terrain'];offset=len(vertices)
    vertices.extend(land.matrix_world@v.co for v in land.data.vertices)
    faces.extend(tuple(offset+i for i in p.vertices) for p in land.data.polygons)
    assert surfaces['road'].data.uv_layers.active
advance=Vector((course['road']['advance']['x'],-course['road']['advance']['z'],course['road']['advance']['y']))
max_seam=0
for i in range(20):
    for part,width in [(roads,4),(terrain,len(chunks[i]['terrainGrid']['x']))]:
        a,b=part[i],part[(i+1)%20]
        for k in range(width):
            end=a.matrix_world@a.data.vertices[len(a.data.vertices)-width+k].co
            start=b.matrix_world@b.data.vertices[k].co+(advance if i==19 else Vector())
            max_seam=max(max_seam,(end-start).length)
assert max_seam<.0002,('Mesh seam gap',max_seam)
assert course['points'][0]['x']==0 and course['points'][-1]['x']==0
assert max(p['x'] for p in course['points'])>180 and abs(advance.z+64)<1e-6
arc=sum(math.dist((a['x'],a['y'],a['z']),(b['x'],b['y'],b['z'])) for a,b in zip(course['points'],course['points'][1:]))
assert abs(arc-1600)<.001,('Route distances must be metres of arc length',arc)
assert roads[0].data.materials[0].node_tree.nodes.get('Image Texture').image.name=='Asphalt_Painted_Grain'
bvh=BVHTree.FromPolygons(vertices,faces,all_triangles=True)
roots=footprints=cliff_samples=0;max_root_error=0;min_clearance=math.inf;max_cliff_gap=-math.inf
for chunk in chunks:
    for obj in chunk.children:
        if obj.get('kind') in ['palm','tree','bananaPlant','sign']:
            p=obj.matrix_world.translation;hit=bvh.ray_cast(Vector((p.x,p.y,300)),Vector((0,0,-1)))[0]
            assert hit,obj.name
            max_root_error=max(max_root_error,abs(p.z-hit.z));roots+=1
        if obj.get('kind')=='foundation':
            bottom=(obj.matrix_world@Vector((0,0,0))).z;top=(obj.matrix_world@Vector((0,0,1))).z
            building=bpy.data.objects[obj['building']]
            assert abs(building.matrix_world.translation.z-top)<.0001
            for u in [-.5,0,.5]:
                for v in [-.5,0,.5]:
                    p=obj.matrix_world@Vector((u,v,0));hit=bvh.ray_cast(Vector((p.x,p.y,300)),Vector((0,0,-1)))[0]
                    assert hit and bottom-.001<=hit.z<=top+.001,(obj.name,p,hit)
                    min_clearance=min(min_clearance,top-hit.z);footprints+=1
        if obj.get('kind') in ['rock'+chr(65+i) for i in range(6)]:
            cap_count=int(obj.get('groundCapVertices',0));assert cap_count==16,('Rock missing sealed footprint',obj.name)
            for vertex in list(obj.data.vertices)[:cap_count]:
                p=obj.matrix_world@vertex.co;hit=bvh.ray_cast(Vector((p.x,p.y,300)),Vector((0,0,-1)))[0]
                assert hit and p.z<hit.z-.1498,(obj.name,'Floating cliff base',p,hit)
                max_cliff_gap=max(max_cliff_gap,p.z-hit.z);cliff_samples+=1
assert roots==720 and max_root_error<.0001 and footprints==108
assert cliff_samples==60*16
print('BLENDER_CURVED_ROAD_PASS',json.dumps({'chunks':20,'arc':arc,'maxSeam':max_seam,'roots':roots,'rootError':max_root_error,'foundationSamples':footprints,'minClearance':min_clearance,'cliffSamples':cliff_samples,'maxCliffGap':max_cliff_gap,'advance':list(advance)}))
