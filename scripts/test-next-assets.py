"""Read-only native checks for the new art and LOD set. Run inside local Blender."""
import bpy,json,math,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/next-native-report.json'
OUT.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blender/asset-library.blend'))
report={}
for level,limit in [(1,44),(2,12)]:
    group=bpy.data.objects.get('ForestCanopyLOD'+str(level))
    assert group is not None,'Missing native forest LOD'+str(level)
    meshes=[o for o in group.children_recursive if o.type=='MESH']
    for o in meshes:o.data.calc_loop_triangles()
    triangles=sum(len(o.data.loop_triangles) for o in meshes)
    assert triangles<=limit,'LOD exceeds screen triangle budget'
    assert all(o.data.color_attributes.get('Color') for o in meshes)
    report['forestLOD'+str(level)]=triangles
for i in range(6):
    r=bpy.data.objects.get('RockModule'+chr(65+i));assert r is not None,'Missing red rock kit module'
    meshes=[o for o in r.children_recursive if o.type=='MESH']
    for o in meshes:o.data.calc_loop_triangles()
    n=sum(len(o.data.loop_triangles) for o in meshes)
    assert 300<=n<=900,(r.name,n)
    for o in meshes:
        edges={}
        for p in o.data.polygons:
            for a,b in zip(p.vertices,list(p.vertices[1:])+[p.vertices[0]]):
                e=tuple(sorted([a,b]));edges[e]=edges.get(e,0)+1
        assert all(v==2 for v in edges.values()),'Rock must be sealed, including bottom cap'
        assert all(math.isfinite(v) for p in o.data.vertices for v in p.co)
        colors=o.data.color_attributes['Color'];assert len({tuple(round(c,3) for c in x.color) for x in colors.data})>=3
    report[r.name]=n
truck=bpy.data.objects['Truck']
names={o.name for o in truck.children}
required={'TruckPart_'+n for n in ['Cab','Bed','Tarp','Door_L','Door_R','Tailgate','Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR']}
required|={f'TruckPart_Crate_{i:02}' for i in range(1,7)}
assert required<=names,'Truck breakaway parts missing'
for o in truck.children:
    if o.get('breakaway'):
        assert o.get('mass',0)>0 and len(o['halfExtents'])==3
        assert all(v>0 for v in o['halfExtents'])
report['truckParts']=len(names)
sky=(ROOT/'assets/export/sky.glb').read_bytes();json_size=struct.unpack_from('<I',sky,12)[0]
gltf=json.loads(sky[20:20+json_size]);binary_start=28+json_size
primitive=gltf['meshes'][0]['primitives'][0]
def buffer_for(index):
    accessor=gltf['accessors'][index];view=gltf['bufferViews'][accessor['bufferView']]
    offset=binary_start+view.get('byteOffset',0)+accessor.get('byteOffset',0)
    return sky[offset:offset+accessor['count']*12]
assert buffer_for(primitive['attributes']['POSITION'])==buffer_for(primitive['attributes']['NORMAL']),'Unit sphere must retain deterministic analytic normals'
assert bpy.data.objects['SkyDome'].get('normalSource','').startswith('analytic unit sphere')
report['skyAnalyticNormals']=True
report['pass']=True
OUT.write_text(json.dumps(report,indent=2)+'\n')
print('NEXT_NATIVE_PASS',json.dumps(report))
