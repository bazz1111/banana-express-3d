"""Read-only acceptance for manifest-declared Tripo environment sources.

The eight historical entry points select these checks. Use --candidate to
check the isolated environment before promotion; default resolves source/root
from assets/export/manifest.json and never silently selects a candidate.
"""
import json
import math
from pathlib import Path
import re
import struct
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = '--candidate' in sys.argv
ENVMAP = ROOT/'artifacts/tripo-environment/runtime-map.json'
MANIFEST = json.loads((ROOT/'assets/export/manifest.json').read_text())
MAPPING = json.loads(ENVMAP.read_text()) if CANDIDATE else {}
LEDGER = json.loads((ROOT/'assets/sources/banana-tripo-v1/manifest.json').read_text())
HASHES = {item['id']: {f['sha256'] for f in item.get('sourceFiles', [])} for item in LEDGER['assets']}
CACHE = {}
DETAILS = {}
bpy.ops.wm.read_factory_settings(use_empty=True)


def glb(path):
    blob = Path(path).read_bytes()
    magic, version, size = struct.unpack_from('<III', blob)
    length, kind = struct.unpack_from('<II', blob, 12)
    assert magic == 0x46546c67 and version == 2 and size == len(blob) and kind == 0x4e4f534a
    return blob, json.loads(blob[20:20+length])


def entry(key):
    if key in MAPPING:
        item = MAPPING[key]
        return ROOT/item['sourceCandidate'], item['root'], ROOT/'artifacts/tripo-environment/export'/(key+'.glb')
    item = MANIFEST['models'][key]
    path = ROOT/'assets/export'/item['file']
    doc = glb(path)[1]
    root_name = item.get('root') or doc['nodes'][doc['scenes'][doc.get('scene', 0)]['nodes'][0]]['name']
    return ROOT/item['source'], root_name, path


def source(key):
    path, root_name, export = entry(key)
    if path not in CACHE:
        selected = {node['name'] for node in glb(export)[1]['nodes']} if CANDIDATE and key not in MAPPING else None
        with bpy.data.libraries.load(str(path), link=False) as (data, target):
            names = tuple(name for name in data.objects if selected is None or name in selected)
            target.objects = list(names)
        lookup = dict(zip(names, target.objects))
        for obj in lookup.values():
            if obj is not None:
                bpy.context.scene.collection.objects.link(obj)
        CACHE[path] = lookup
        bpy.context.view_layer.update()
    lookup = CACHE[path]
    obj = lookup[root_name]
    assert obj is not None, (key, path, root_name)
    if not obj.matrix_world.is_identity:
        obj.matrix_world = Matrix.Identity(4)
        bpy.context.view_layer.update()
    return obj


def named(key, name):
    source(key)
    return CACHE[entry(key)[0]][name]


def hierarchy(root):
    return [root]+list(root.children_recursive)


def triangles(data):
    data.calc_loop_triangles()
    return len(data.loop_triangles)


def prototype(key):
    obj = source(key)
    meshes = [o for o in hierarchy(obj) if o.type == 'MESH']
    assert len(meshes) == 1, (key, 'Instancing requires one source mesh')
    mesh = meshes[0]
    assert len(mesh.data.materials) == 1
    provenance(mesh)
    assert triangles(mesh.data) > 0
    return mesh


def provenance(obj):
    data = obj.data
    identifier = obj.get('sourceId')
    assert identifier in HASHES, (obj.name, 'Missing actual Tripo source id')
    assert obj.get('provider') == 'Tripo' and obj.get('model') == 'H3.1', obj.name
    assert obj.get('sourceSha256') in HASHES[identifier], (obj.name, identifier, 'Source hash is not a downloaded master')
    assert 'vertexAO' not in obj and 'vertexAO' not in data
    assert data.color_attributes.get('AOBaseColor') is None
    color = data.color_attributes.get('Color')
    assert color is not None
    values = np.empty(len(color.data)*4, dtype=np.float32)
    color.data.foreach_get('color', values)
    assert np.isfinite(values).all() and values.min() >= -1e-6 and values.max() <= 1.00001
    assert values.reshape(-1, 4)[:, :3].max() > .01
    if obj.get('volumeLOD'):
        assert obj.get('pixelSource') == obj['sourceSha256']
        assert 'source' in obj.get('pixelDerivation', '').lower()
    for vertex in data.vertices:
        assert all(math.isfinite(v) for v in vertex.co)


def accessor(blob, doc, index):
    item = doc['accessors'][index]
    view = doc['bufferViews'][item['bufferView']]
    dtype = {5121:'<u1', 5123:'<u2', 5125:'<u4', 5126:'<f4'}[item['componentType']]
    columns = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}[item['type']]
    size = np.dtype(dtype).itemsize
    offset = 28+int.from_bytes(blob[12:16], 'little')+view.get('byteOffset', 0)+item.get('byteOffset', 0)
    values = np.ndarray((item['count'], columns), dtype=dtype, buffer=blob, offset=offset,
        strides=(view.get('byteStride', size*columns), size)).astype(np.float64)
    if item.get('normalized'):
        values /= 65535 if item['componentType'] == 5123 else 255
    return values


def check_lighting():
    keys = list(MAPPING) if CANDIDATE else [key for key in MANIFEST['models']
        if key in ('palm','tree','forestTree','forestTreeLOD1','forestTreeLOD2','hut',
                   'villageHouse','villageLonghouse','tower','foundation','bananaPlant',
                   'bush','rock','cliff','sign','cloud','cloudB','cloudC','mountain',
                   'mountainB','midMountain','midMountainB','forestHill','forestHillB',
                   'rockA','rockB','rockC','rockD','rockE','rockF','roadTile','roadCourse','valley','sky','stall')]
    checked, vertices, textures = 0, 0, 0
    for key in keys:
        root = source(key)
        path, root_name, export = entry(key)
        blob, doc = glb(export)
        assert any(node['name'] == root_name for node in doc['nodes'])
        seen = set()
        for node in doc['nodes']:
            if 'mesh' not in node or node['mesh'] in seen:
                continue
            seen.add(node['mesh'])
            native = CACHE[path][node['name']]
            if native.get('sourceId'):
                provenance(native)
            color = native.data.color_attributes['Color']
            expected = {}
            native.data.calc_loop_triangles()
            for tri in native.data.loop_triangles:
                values = []
                for loop in tri.loops:
                    point = native.data.vertices[native.data.loops[loop].vertex_index].co
                    values.append(((round(point.x,5),round(point.z,5),round(-point.y,5)),
                                   tuple(color.data[loop].color)))
                values.sort(key=lambda value:value[0])
                expected.setdefault(tuple(value[0] for value in values), []).append(
                    np.asarray([value[1] for value in values]))
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                positions = accessor(blob, doc, primitive['attributes']['POSITION'])
                rgba = accessor(blob, doc, primitive['attributes']['COLOR_0'])
                if rgba.shape[1] == 3:
                    rgba = np.column_stack((rgba, np.ones(len(rgba))))
                indices = accessor(blob, doc, primitive['indices']).astype(int).reshape(-1, 3)
                for tri in indices:
                    values = sorted([(tuple(np.round(positions[i],5)),rgba[i]) for i in tri], key=lambda value:value[0])
                    candidates = expected.get(tuple(value[0] for value in values))
                    assert candidates, (key, node['name'], 'GLB geometry differs from its declared native')
                    actual = np.asarray([value[1] for value in values])
                    assert any(np.allclose(actual, value, atol=5e-5, rtol=0) for value in candidates), (key, 'Source colors changed during export')
                    checked += 1
                vertices += len(positions)
                texture = doc.get('materials', [])[primitive.get('material', 0)].get('pbrMetallicRoughness', {}).get('baseColorTexture')
                if texture:
                    image = doc['images'][doc['textures'][texture['index']]['source']]
                    assert 'bufferView' in image and not image.get('uri')
                    textures += 1
    DETAILS['lighting'] = {'nativeExportTrianglesCompared': checked, 'vertices':vertices, 'packedTexturedPrimitives':textures}


def course():
    path = ROOT/'artifacts/tripo-environment/export/course.json' if CANDIDATE else ROOT/'assets/export/course.json'
    return json.loads(path.read_text())


def route(data, s):
    period = data['road']['period']; cycle = math.floor(s/period); local = s-cycle*period
    index = min(len(data['points'])-2, math.floor(local/2))
    a,b = data['points'][index:index+2]; t = (local-a['s'])/2
    advance = data['road']['advance']
    return Vector((a['x']+(b['x']-a['x'])*t+cycle*advance['x'],
        -(a['z']+(b['z']-a['z'])*t+cycle*advance['z']),
        a['y']+(b['y']-a['y'])*t+cycle*advance['y'])), a['yaw']+(b['yaw']-a['yaw'])*t


def check_road():
    root = source('roadCourse'); data = course()
    chunks = sorted(root.children, key=lambda obj:obj['segment'])
    assert [obj['segment'] for obj in chunks] == list(range(20))
    roads, terrain, guards = [], [], []
    for chunk in chunks:
        surfaces = [obj for obj in chunk.children if obj.get('surfaceRole')]
        assert len(surfaces) == 3 and {obj['surfaceRole'] for obj in surfaces} == {'road','guard','terrain'}
        parts = {obj['surfaceRole']:obj for obj in surfaces}
        road = parts['road']; roads.append(road); terrain.append(parts['terrain']); guards.append(parts['guard'])
        assert road['sourceId'] == 'road-module' and parts['guard']['sourceId'] == 'road-module'
        for obj in (road, parts['guard']):
            provenance(obj); assert obj.data.uv_layers.active
        width = road['crossSectionVertices']
        assert len(road.data.vertices) == width*41
        for row in range(41):
            center,yaw = route(data, chunk['segment']*80+row*2)
            normal = Vector((math.cos(yaw),math.sin(yaw),0))
            tangent = Vector((-math.sin(yaw),math.cos(yaw),0))
            offsets = []
            for vertex in road.data.vertices[row*width:(row+1)*width]:
                point = road.matrix_world@vertex.co; delta = point-center
                assert abs(delta.z)<2e-4 and abs(delta.dot(tangent))<2e-4
                offsets.append(delta.dot(normal))
            assert abs(min(offsets)+5.2)<2e-4 and abs(max(offsets)-5.2)<2e-4
    advance = data['road']['advance']; translation = Vector((advance['x'],-advance['z'],advance['y']))
    seam = 0.
    for i in range(20):
        for objects,width in [(roads,roads[i]['crossSectionVertices']), (terrain,len(chunks[i]['terrainGrid']['x']))]:
            a,b = objects[i],objects[(i+1)%20]
            for u,v in zip(a.data.vertices[-width:],b.data.vertices[:width]):
                seam = max(seam,((a.matrix_world@u.co)-(b.matrix_world@v.co)-(translation if i==19 else Vector())).length)
    assert seam < .0002
    arc = sum(math.dist((a['x'],a['y'],a['z']),(b['x'],b['y'],b['z'])) for a,b in zip(data['points'],data['points'][1:]))
    assert abs(arc-1600)<.001 and max(p['x'] for p in data['points'])>180
    assert abs(translation.z+64)<1e-6
    DETAILS['road'] = {'chunks':20,'arcLength':arc,'maxSeam':seam,'drivingWidth':10.4,'sourceId':'road-module'}


def bvh(objects):
    vertices,faces = [],[]
    for obj in objects:
        obj.data.calc_loop_triangles(); offset=len(vertices)
        vertices.extend(obj.matrix_world@vertex.co for vertex in obj.data.vertices)
        for tri in obj.data.loop_triangles:
            a,b,c=[vertices[offset+i] for i in tri.vertices]
            material=obj.data.materials[obj.data.polygons[tri.polygon_index].material_index]
            if material.use_backface_culling and (b-a).cross(c-a).z<=1e-8:
                continue
            faces.append(tuple(offset+i for i in tri.vertices))
    return BVHTree.FromPolygons(vertices,faces,all_triangles=True)


def group(name):
    return [obj for obj in named('valley',name).children if obj.type=='MESH']


def check_settlement():
    root=source('valley'); data=course(); scale=data['road']['advance']['z']/1600
    land=named('valley','ValleyTerrain'); water=named('valley','ValleyWater')
    errors=[]
    for row in range(93):
        s=row*1600/92; center,yaw=route(data,s); point=land.data.vertices[row*67].co
        errors.append(max(abs(point.x-(center.x-100)),abs(point.y-center.y/scale)))
    assert max(errors)<.001
    assert len(water.data.vertices)==372 and triangles(water.data)==552
    colors={tuple(round(c,5) for c in item.color) for item in water.data.color_attributes['Color'].data}
    assert len(colors)==3
    assert len(root['settlements'])==6 and all(item['houses']>0 for item in root['settlements'])
    assert len(group('ValleyFoundations'))>80 and len(group('ValleyTower'))==1
    forest=group('ValleyForest')+group('ValleyForestFar')
    assert len(forest)==2400 and sum((obj.scale.x+obj.scale.y)/2 for obj in forest)/len(forest)>=3.6
    for name in ('ValleyVillageHouse','ValleyVillageLonghouse','ValleyTower'):
        for obj in group(name): provenance(obj); assert obj['sourceId']=='hut'
    DETAILS['settlement']={'rowAlignmentError':max(errors),'waterBands':3,'mainTownBuildings':len(group('ValleyFoundations')),'forestTrees':len(forest)}



def terrain_patches(objects):
    patches = []
    for obj in objects:
        obj.data.calc_loop_triangles()
        for triangle in obj.data.loop_triangles:
            points = [obj.matrix_world@obj.data.vertices[i].co for i in triangle.vertices]
            patches.append((points, (min(p.x for p in points), max(p.x for p in points),
                                      min(p.y for p in points), max(p.y for p in points))))
    return patches


def exact_foundation(base, patches):
    """Independent full-area clipping for the retained single-valued ground."""
    inverse = base.matrix_world.inverted()
    corners = [base.matrix_world@Vector((x, y, 0)) for x, y in
               [(-.5,-.5),(.5,-.5),(.5,.5),(-.5,.5)]]
    bounds = (min(p.x for p in corners), max(p.x for p in corners),
              min(p.y for p in corners), max(p.y for p in corners))
    coverage, heights = 0., []
    for points, box in patches:
        if bounds[0]>box[1] or bounds[1]<box[0] or bounds[2]>box[3] or bounds[3]<box[2]:
            continue
        polygon = [(float((inverse@p).x), float((inverse@p).y), float(p.z)) for p in points]
        for axis, sign in [(0,1),(0,-1),(1,1),(1,-1)]:
            clipped = []
            for a,b in zip(polygon,polygon[1:]+polygon[:1]):
                u,v = .5-sign*a[axis], .5-sign*b[axis]
                if u>=-1e-9: clipped.append(a)
                if (u>=-1e-9)!=(v>=-1e-9):
                    t=u/(u-v);clipped.append(tuple(a[i]+(b[i]-a[i])*t for i in range(3)))
            polygon = clipped
            if not polygon: break
        area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(polygon,polygon[1:]+polygon[:1])))/2 if len(polygon)>2 else 0
        if area>1e-10:
            coverage+=area;heights.extend(p[2] for p in polygon)
    assert heights and abs(coverage-1)<.0003,(base.name,'Incomplete occupied footprint',coverage)
    bottom=(base.matrix_world@Vector((0,0,0))).z
    top=(base.matrix_world@Vector((0,0,1))).z
    assert bottom<=min(heights)+.001 and top>=max(heights)-.001,(base.name,'Exact support envelope missed')
    return len(heights)

def check_support():
    checks=roots=bottom_checks=exact_samples=0; max_root_error=0.; far_max=0.
    for key in ('roadCourse','valley'):
        root=source(key)
        terrain=[obj for obj in hierarchy(root) if obj.type=='MESH' and (obj.get('surfaceRole')=='terrain' or obj.name.startswith('ValleyTerrain'))]
        near=bvh(terrain)
        patches=terrain_patches(terrain)
        mountain_groups=[item for item in root.children if any(
            obj.type=='MESH' and obj.get('sourceId')=='mountain' for obj in item.children)]
        far=bvh([obj for item in mountain_groups for obj in item.children if obj.type=='MESH']) if key=='valley' else near
        objects=[obj for obj in hierarchy(root) if obj.type=='MESH' and obj.get('sourceId')]
        for obj in objects:
            is_far=obj.parent and obj.parent.name.startswith('ValleyPanorama')
            surface=far if is_far else near
            if obj.get('building'):
                if not is_far: exact_samples+=exact_foundation(obj,patches)
                bottom=(obj.matrix_world@Vector((0,0,0))).z
                top=(obj.matrix_world@Vector((0,0,1))).z
                building=next(item for item in objects if item.name==obj['building'])
                building_min=min((building.matrix_world@Vector(corner)).z for corner in building.bound_box)
                assert abs(building_min-top)<.001,(obj.name,'Building does not meet its foundation')
                inverse=obj.matrix_world.inverted()
                assert all(abs((inverse@(building.matrix_world@Vector(c))).x)<=.5001 and
                           abs((inverse@(building.matrix_world@Vector(c))).y)<=.5001 for c in building.bound_box)
                for x in np.linspace(-.5,.5,9):
                    for y in np.linspace(-.5,.5,9):
                        point=obj.matrix_world@Vector((float(x),float(y),0))
                        hit=surface.ray_cast(Vector((point.x,point.y,5000)),Vector((0,0,-1)))[0]
                        assert hit is not None and bottom-.001<=hit.z<=top+.001,(obj.name,'Unsupported occupied foundation',point,hit,bottom,top)
                        checks+=1
                if is_far: far_max=max(far_max,top-bottom); assert top-bottom<=12.001
            elif obj['sourceId'] in ('palm','tree','banana-plant','bush','sign'):
                point=obj.matrix_world.translation
                hit=surface.ray_cast(Vector((point.x,point.y,5000)),Vector((0,0,-1)))[0]
                assert hit is not None,obj.name
                low=min((obj.matrix_world@v.co).z for v in obj.data.vertices)
                error=abs(low-hit.z+.025); max_root_error=max(max_root_error,error)
                assert error<.001,(obj.name,'Floating plant/root',error)
                roots+=1
            elif key=='roadCourse' and obj['sourceId'] in ('rock','cliff'):
                low=min(v.co.z for v in obj.data.vertices); high=max(v.co.z for v in obj.data.vertices)
                obj.data.calc_loop_triangles(); covered=0
                for tri in obj.data.loop_triangles:
                    local=[obj.data.vertices[i].co for i in tri.vertices]
                    if max(p.z for p in local)>low+(high-low)*.15: continue
                    a,b,c=[obj.matrix_world@p for p in local]
                    if (b-a).cross(c-a).z>=-1e-8: continue
                    for point in (a,b,c,(a+b+c)/3):
                        hit=near.ray_cast(Vector((point.x,point.y,5000)),Vector((0,0,-1)))[0]
                        assert hit is not None and point.z<=hit.z-.149,(obj.name,'Floating source rock bottom',point,hit)
                        covered+=1; bottom_checks+=1
                assert covered>0,(obj.name,'No real lower source faces')
    DETAILS['support']={'foundationRaySamples':checks,'exactNearFootprintIntersections':exact_samples,
        'rootSamples':roots,'maxRootError':max_root_error,'rockBottomSamples':bottom_checks,'maxFarFoundationHeight':far_max}


def check_lods():
    values={key:triangles(prototype(key).data) for key in ('tree','forestTree','forestTreeLOD1','forestTreeLOD2')}
    assert 0<values['tree']<=900 and 0<values['forestTree']<=100
    assert 0<values['forestTreeLOD1']<=24 and 0<values['forestTreeLOD2']<=24
    assert values['tree']>values['forestTree']>values['forestTreeLOD1']
    for name in ('ValleyForest','ValleyForestFar','ValleyPanoramaForest','ValleyPalms',
                 'ValleyVillageHouse','ValleyVillageLonghouse','ValleyPanoramaHouse',
                 'ValleyPanoramaLonghouse','ValleyPanoramaTower'):
        items=group(name)
        assert items and len({obj.data.as_pointer() for obj in items})==1
        assert all(len(obj.data.materials)==1 for obj in items)
        for obj in items: provenance(obj)
    assert triangles(group('ValleyForest')[0].data)>triangles(group('ValleyForestFar')[0].data)
    assert len(group('ValleyPanoramaForest'))>1000
    assert sum(len(group(name)) for name in ('ValleyPanoramaHouse','ValleyPanoramaLonghouse','ValleyPanoramaTower'))>=3
    DETAILS['lods']=values


def check_landscape():
    root=source('roadCourse')
    terrain=[obj for obj in hierarchy(root) if obj.get('surfaceRole')=='terrain']
    surface=bvh(terrain); data=course(); heights=[]
    for s in range(0,1600,2):
        center,yaw=route(data,s)
        point=center+Vector((-10*math.cos(yaw),-10*math.sin(yaw),0))
        hit=surface.ray_cast(Vector((point.x,point.y,5000)),Vector((0,0,-1)))[0]
        assert hit is not None
        heights.append(hit.z-center.z)
    assert min(heights)>=4.8 and max(heights)-min(heights)>1.2
    for names in [('ValleyFoothills','ValleyFoothillsB'),('ValleyMidMountains','ValleyMidMountainsB')]:
        items=[obj for name in names for obj in group(name)]
        assert items and not any(obj.location.x/math.hypot(obj.location.x,obj.location.y)>.42 for obj in items)
        assert all(min(obj.scale)>0 for obj in items)
    ridges=group('ValleyMountains')+group('ValleyMountainsB')
    assert len(ridges)==24
    angles=sorted(math.atan2(obj.location.x,-obj.location.y)%math.tau for obj in ridges)
    gaps=[angles[(i+1)%len(angles)]+(math.tau if i==len(angles)-1 else 0)-angle for i,angle in enumerate(angles)]
    assert max(gaps)<.45
    DETAILS['landscape']={'bankSamples':800,'bankHeightMin':min(heights),'bankHeightRange':max(heights)-min(heights),'farRidges':24,'openBaySector':True}


def check_rocks():
    counts={}
    for key in ('rock','cliff','rockA','rockB','rockC','rockD','rockE','rockF',
                'mountain','mountainB','midMountain','midMountainB','forestHill','forestHillB'):
        mesh=prototype(key); values=[v.co.z for v in mesh.data.vertices]
        assert max(values)>min(values) and len({round(v,5) for v in values})>=10
        counts[key]=triangles(mesh.data)
        edges={}
        for face in mesh.data.polygons:
            for a,b in zip(face.vertices,list(face.vertices[1:])+[face.vertices[0]]):
                edge=tuple(sorted((a,b)));edges[edge]=edges.get(edge,0)+1
        boundary=sum(value!=2 for value in edges.values())
        assert boundary<=max(8,len(edges)*.025),(key,'Large open boundary',boundary,len(edges))
    a,b=prototype('mountain'),prototype('mountainB')
    assert [tuple(v.co) for v in a.data.vertices]!=[tuple(v.co) for v in b.data.vertices]
    DETAILS['rocks']={'actualSourceTriangles':counts}


def check_next():
    check_lods(); check_rocks()
    truck=source('truck')
    names={obj.name.split('.')[0] for obj in truck.children}
    required={'TruckPart_'+name for name in ('Cab','Bed','Tarp','Door_L','Door_R','Tailgate','Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR')}
    required|={f'TruckPart_Crate_{i:02}' for i in range(1,7)}
    assert required<=names,('Missing actual truck breakaway parts',names)
    for obj in truck.children:
        if obj.get('breakaway'):
            assert obj.get('mass',0)>0 and len(obj['halfExtents'])==3 and min(obj['halfExtents'])>0
    root=source('sky');assert root.get('normalSource','').startswith('unit sphere POSITION shader')
    blob,doc=glb(entry('sky')[2]);primitive=doc['meshes'][0]['primitives'][0]
    positions=accessor(blob,doc,primitive['attributes']['POSITION'])
    normals=accessor(blob,doc,primitive['attributes']['NORMAL'])
    # Only this POSITION-driven program sphere permits Blender's documented
    # split-normal quantization. Tripo geometry/UV/color comparisons stay exact.
    assert np.isfinite(positions).all() and np.isfinite(normals).all()
    radius_error=float(np.abs(np.linalg.norm(positions,axis=1)-1).max())
    normal_length_error=float(np.abs(np.linalg.norm(normals,axis=1)-1).max())
    normal_direction_error=float(np.linalg.norm(positions-normals,axis=1).max())
    assert radius_error<1e-6 and normal_length_error<1e-6 and normal_direction_error<2.5e-4
    DETAILS['next']={'truckParts':len(required),'skyRadiusError':radius_error,
        'skyNormalLengthError':normal_length_error,'skyNormalDirectionError':normal_direction_error}


CHECKS={'lighting':check_lighting,'settlement':check_settlement,'curved-road':check_road,
        'scenery-support':check_support,'landscape':check_landscape,'rock-ridges':check_rocks,
        'panorama':check_lods,'next':check_next}


def run(name):
    CHECKS[name]()
    report={'pass':True,'check':name,'candidate':CANDIDATE,'details':DETAILS,
            'scope':'Manifest-declared actual native/GLB/source checks; engine pixels and device performance are separate'}
    output=ROOT/'artifacts/tripo-environment'/('validation-'+name+'.json')
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
    print('TRIPO_NATIVE_PASS '+json.dumps({'check':name,'report':str(output),'candidate':CANDIDATE}),flush=True)
