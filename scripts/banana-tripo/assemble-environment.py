"""Assemble a candidate environment from existing Tripo masters, headless only.

Usage:
  blender --background --factory-startup --python-exit-code 1 --python
    scripts/banana-tripo/assemble-environment.py -- [--preflight]

Inputs are read-only: canonical native layout, course, and prepare-static recipe.
Outputs stay under artifacts/tripo-environment; no canonical manifest is changed.
The road/terrain/water are explicit Blender program surfaces. Road UVs, paint and
guard shape are sampled from the actual road-module source, never relabelled old
decorative meshes. Missing sources fail before any candidate is published.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path
import struct
import sys


ROOT = Path(__file__).resolve().parents[2]
REQUIRED_SOURCES = ('palm', 'tree', 'banana-plant', 'rock', 'bush', 'hut',
                    'stall', 'foundation', 'sign', 'mountain', 'cliff',
                    'road-module', 'cloud')
PROTOTYPES = {
    'palm': 'palm', 'tree': 'tree', 'forestTree': 'tree',
    'forestTreeLOD1': 'tree', 'forestTreeLOD2': 'tree',
    'bananaPlant': 'banana-plant', 'rock': 'rock', 'bush': 'bush',
    'hut': 'hut', 'villageHouse': 'hut', 'villageLonghouse': 'hut',
    'tower': 'hut', 'stall': 'stall', 'foundation': 'foundation',
    'cliff': 'cliff', 'sign': 'sign', 'mountain': 'mountain',
    'mountainB': 'mountain', 'midMountain': 'mountain',
    'midMountainB': 'mountain', 'forestHill': 'mountain',
    'forestHillB': 'mountain', 'cloud': 'cloud', 'cloudB': 'cloud',
    'cloudC': 'cloud',
    **{'rock'+letter: 'cliff' if letter in 'ABCD' else 'rock'
       for letter in 'ABCDEF'},
}
LOD_BUDGETS = {'tree': 900, 'forestTree': 100, 'forestTreeLOD1': 24,
               'forestTreeLOD2': 24, 'villageHouse': 1200,
               'villageLonghouse': 900, 'tower': 1200, 'foundation': 64}


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for data in iter(lambda: stream.read(1048576), b''):
            digest.update(data)
    return digest.hexdigest()


def output_path(project, path):
    allowed = Path(project).resolve() / 'artifacts/tripo-environment'
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(allowed):
        raise ValueError('Candidate output must remain under '+str(allowed))
    return resolved


def route_point(course, s, lateral=0., lift=0.):
    period = course['road']['period']
    cycle = math.floor(s/period)
    local = s-cycle*period
    points = course['points']
    index = max(0, min(len(points)-2,
                       bisect.bisect_right([p['s'] for p in points], local)-1))
    a, b = points[index:index+2]
    t = (local-a['s'])/(b['s']-a['s'])
    advance = course['road']['advance']
    yaw = a['yaw']+(b['yaw']-a['yaw'])*t
    x = a['x']+(b['x']-a['x'])*t+cycle*advance['x']
    y = -(a['z']+(b['z']-a['z'])*t+cycle*advance['z'])
    z = a['y']+(b['y']-a['y'])*t+cycle*advance['y']
    return (x+lateral*math.cos(yaw), y+lateral*math.sin(yaw), z+lift)


def in_bay_sector(position):
    radius = math.hypot(position[0], position[1])
    return radius > 1e-8 and position[0]/radius > .42


def read_recipe(project, path):
    data = json.loads(Path(path).read_text())['assets']
    items = {}
    for item in data:
        key = item['id']
        if key in items:
            raise ValueError('Duplicate recipe source: '+key)
        item = dict(item)
        item['native'] = (project/item['native']).resolve()
        if item['native'].parent != (project/'assets/blender/tripo').resolve():
            raise ValueError('Expected a prepared Tripo .blend: '+str(item['native']))
        items[key] = item
    return items


def source_preflight(recipe):
    missing = []
    for key in REQUIRED_SOURCES:
        item = recipe.get(key)
        if item is None or not item['native'].is_file():
            missing.append({'id': key, 'native': str(item['native']) if item else None})
            continue
        with item['native'].open('rb') as stream:
            header = stream.read(7)
            if not (header == b'BLENDER' or header[:4] == b'\x28\xb5\x2f\xfd'
                    or header[:2] == b'\x1f\x8b'):
                raise ValueError('Invalid native Blender source: '+str(item['native']))
    return missing



def sky_normal_metrics(path):
    blob = Path(path).read_bytes()
    length = struct.unpack_from('<I', blob, 12)[0]
    doc = json.loads(blob[20:20+length])
    primitive = doc['meshes'][0]['primitives'][0]
    def vectors(name):
        item = doc['accessors'][primitive['attributes'][name]]
        view = doc['bufferViews'][item['bufferView']]
        offset = 28+length+view.get('byteOffset', 0)+item.get('byteOffset', 0)
        return [struct.unpack_from('<3f', blob, offset+i*view.get('byteStride', 12)) for i in range(item['count'])]
    positions, normals = vectors('POSITION'), vectors('NORMAL')
    return {'positionRadiusError': max(abs(math.sqrt(sum(x*x for x in p))-1) for p in positions),
            'normalLengthError': max(abs(math.sqrt(sum(x*x for x in n))-1) for n in normals),
            'normalDirectionError': max(math.dist(p, n) for p, n in zip(positions, normals))}

def write_report(output, report):
    output.mkdir(parents=True, exist_ok=True)
    if report.get('status') == 'candidate-ready':
        actual = sky_normal_metrics(output/'export/sky.glb')
        report['skyNormalContract']['actual'] = actual
        if actual['positionRadiusError'] >= 1e-6 or actual['normalLengthError'] >= 1e-6 or actual['normalDirectionError'] >= 2.5e-4:
            raise ValueError('The saved-native program sky exceeds its declared quantization allowance')
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    print('TRIPO_ENVIRONMENT_REPORT '+json.dumps({'status': report['status'],
        'report': str(output/'report.json'), 'candidateBlend': report.get('candidateBlend'),
        'estimatedSubmittedTriangles': report.get('estimatedSubmittedTriangles'),
        'missingSources': [item['id'] for item in report.get('missingSources', [])]}), flush=True)



def hierarchy(root):
    return [root]+list(root.children_recursive)


def plain(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, 'keys'):
        return {key: plain(value[key]) for key in value.keys()}
    return [plain(item) for item in value]


def clean_ao(owner):
    for key in list(owner.keys()):
        if key in ('vertexAO', 'AOBaseColor', 'geometryBefore', 'geometryAfter'):
            del owner[key]
    if hasattr(owner, 'color_attributes'):
        layer = owner.color_attributes.get('AOBaseColor')
        if layer:
            owner.color_attributes.remove(layer)


def append_source(item):
    import bpy
    with bpy.data.libraries.load(str(item['native']), link=False) as (source, target):
        target.objects = source.objects
    objects = [obj for obj in target.objects if obj is not None]
    for obj in objects:
        bpy.context.scene.collection.objects.link(obj)
    roots = [obj for obj in objects if obj.parent is None and obj.get('sourceId') == item['id']]
    if len(roots) != 1:
        raise ValueError('Expected one authenticated source root: '+item['id'])
    root = roots[0]
    if root.get('provider') != 'Tripo' or root.get('model') != 'H3.1' or not root.get('sourceSha256'):
        raise ValueError('Missing Tripo/H3.1/source hash metadata: '+item['id'])
    meshes = [obj for obj in hierarchy(root) if obj.type == 'MESH']
    if len(meshes) != 1 or len(meshes[0].data.materials) != 1:
        raise ValueError('Instancing needs one mesh and one material: '+item['id'])
    obj = meshes[0]
    if not obj.data.uv_layers or not obj.data.polygons:
        raise ValueError('Expected textured source geometry: '+item['id'])
    obj.data = obj.data.copy()
    bpy.context.view_layer.update()
    obj.data.transform(obj.matrix_world)
    from mathutils import Matrix
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    for key in ('sourceId', 'provider', 'model', 'sourceSha256'):
        obj[key] = root[key]
    obj['nativeSource'] = str(item['native'])
    clean_ao(obj); clean_ao(obj.data)
    bpy.data.objects.remove(root, do_unlink=True)
    return obj


class RoadSampler:
    """Project source UV/color and cross-sections, without copying old road paint."""
    def __init__(self, source):
        import numpy as np
        from mathutils.bvhtree import BVHTree
        from mathutils import Vector
        import statistics
        self.source = source
        data = source.data
        data.calc_loop_triangles()
        self.triangles = list(data.loop_triangles)
        self.vertices = [v.co.copy() for v in data.vertices]
        self.bvh = BVHTree.FromPolygons(self.vertices,
            [tuple(t.vertices) for t in self.triangles], all_triangles=True)
        self.uv = [Vector((v.uv.x, v.uv.y, 0)) for v in data.uv_layers.active.data]
        self.low = [min(v[a] for v in self.vertices) for a in range(3)]
        self.high = [max(v[a] for v in self.vertices) for a in range(3)]
        material = data.materials[0]
        shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        images = [node.image for node in material.node_tree.nodes if node.type == 'TEX_IMAGE'
                  and node.image and node.outputs['Color'].is_linked]
        if len(images) != 1:
            raise ValueError('Road needs one prepared base-color texture')
        self.image = images[0]
        self.pixels = np.asarray(self.image.pixels[:], dtype=np.float32).reshape(
            self.image.size[1], self.image.size[0], 4)
        self.drive_height = (self.low[2]+self.high[2])/2
        samples = [self.hit(0, y)[0].z for y in (-8, -4, 0, 4, 8)]
        self.drive_height = statistics.median(samples)
        self.height_scale = .45/max(.01, self.high[2]-self.drive_height)
        self.material = material

    def source_xy(self, lateral, phase):
        width = self.high[0]-self.low[0]
        x = (self.low[0]+self.high[0])/2+lateral/11.6*width*.985
        y = self.low[1]+.2+phase*(self.high[1]-self.low[1]-.4)
        return x, y

    def hit(self, x, y):
        from mathutils import Vector
        point, normal, index, distance = self.bvh.ray_cast(
            Vector((x, y, self.high[2]+1)), Vector((0, 0, -1)))
        direct = point is not None
        if not direct:
            point, normal, index, distance = self.bvh.find_nearest(Vector((x, y, self.drive_height)))
        if point is None:
            raise ValueError('Road source contains no projectable surface')
        return point, index, direct

    def sample(self, lateral, phase):
        from mathutils import Vector
        from mathutils.geometry import barycentric_transform
        point, index, direct = self.hit(*self.source_xy(lateral, phase))
        triangle = self.triangles[index]
        a, b, c = [self.vertices[i] for i in triangle.vertices]
        u, v, w = [self.uv[i] for i in triangle.loops]
        uv = barycentric_transform(point, a, b, c, u, v, w)
        width, height = self.image.size
        color = self.pixels[min(height-1, max(0, int(uv.y*height))),
                            min(width-1, max(0, int(uv.x*width)))]
        return point.z, color, direct

    def profile(self, lateral, s):
        phase = (s % 20)/20
        z = self.sample(lateral, phase)[0]
        edge = (self.sample(lateral, 0)[0]+self.sample(lateral, 1)[0])/2
        blend = math.sin(math.pi*phase)**2
        return max(.012, min(.5, ((z*blend+edge*(1-blend))-self.drive_height)*self.height_scale))

    def bake_material(self, width=512, height=1024):
        import bpy
        import numpy as np
        pixels = np.empty((height, width, 4), dtype=np.float32)
        covered = 0
        for y in range(height):
            for x in range(width):
                z, color, direct = self.sample((x+.5)/width*11.6-5.8, (y+.5)/height)
                pixels[y, x] = color
                covered += direct
        coverage = covered/(width*height)
        if coverage < .98:
            raise ValueError('Tripo road UV projection coverage below 98%: '+str(coverage))
        image = bpy.data.images.new('TripoRoad_ProjectedBaseColor', width=width, height=height)
        image.pixels.foreach_set(pixels.ravel())
        image.update(); image.pack()
        material = self.material.copy()
        material.name = 'TripoRoad_ProjectedPaint'
        nodes = material.node_tree.nodes
        shader = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
        for link in list(shader.inputs['Base Color'].links):
            material.node_tree.links.remove(link)
        for node in list(nodes):
            if node.type == 'TEX_IMAGE':
                nodes.remove(node)
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = image
        material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
        return material, {'sourceId': 'road-module', 'sourceSha256': self.source['sourceSha256'],
            'nativeSourceSha256': sha256(self.source['nativeSource']),
            'method': 'source UV/base-color ray projection and sampled guard cross-sections',
            'directCoverage': coverage, 'nearestSourceFill': 1-coverage,
            'atlasSize': [width, height], 'sourceDrivingHeight': self.drive_height,
            'drivingHeight': 0, 'guardHeightScale': self.height_scale,
            'visibleGeometry': 'Blender continuous retopology; source paint and guard profiles'}


def make_mesh(name, vertices, faces, material, face_uvs=None):
    import bpy
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces); data.update()
    data.materials.append(material)
    color = data.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    color.data.foreach_set('color', [1.]*(len(color.data)*4))
    data.color_attributes.active_color_index = 0
    data.color_attributes.render_color_index = 0
    if face_uvs:
        uv = data.uv_layers.new(name='UVMap')
        for polygon, values in zip(data.polygons, face_uvs):
            for index, value in zip(polygon.loop_indices, values):
                uv.data[index].uv = value
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def road_strip(sampler, material, course, start, length, straight=False):
    rows = round(length/2)+1
    xs = [-5.2]+[-5.+i*.4 for i in range(26)]+[5.2]
    vertices, faces, uvs = [], [], []
    point = (lambda s, x, z: (x, -s, z)) if straight else (
        lambda s, x, z: route_point(course, s, x, z))
    for row in range(rows):
        s = start+row*2
        vertices.extend(point(s, x, 0) for x in xs)
    width = len(xs)
    for row in range(rows-1):
        v0 = ((start+row*2) % 20)/20
        v1 = v0+.1
        for column in range(width-1):
            a = row*width+column; b = a+width
            faces.append((a, b, b+1, a+1))
            u0, u1 = (xs[column]+5.8)/11.6, (xs[column+1]+5.8)/11.6
            uvs.append(((u0, v0), (u0, v1), (u1, v1), (u1, v0)))
    road = make_mesh('TripoPaintedRoadSurface', vertices, faces, material, uvs)
    road['surfaceRole'] = 'road'; road['crossSectionVertices'] = width
    vertices, faces, uvs = [], [], []
    for side in (-1, 1):
        offset = len(vertices)
        cross = [5.2, 5.2, 5.4, 5.6, 5.8, 5.8]
        for row in range(rows):
            s = start+row*2
            for index, x in enumerate(cross):
                z = 0 if index in (0, 5) else sampler.profile(side*x, s)
                vertices.append(point(s, side*x, z))
        for row in range(rows-1):
            v0 = ((start+row*2) % 20)/20; v1 = v0+.1
            for column in range(6):
                next_column = (column+1) % 6
                a = offset+row*6+column; b = offset+row*6+next_column
                faces.append((a, a+6, b+6, b) if side == -1 else (b, b+6, a+6, a))
                u0, u1 = (side*cross[column]+5.8)/11.6, (side*cross[next_column]+5.8)/11.6
                values = ((u0, v0), (u0, v1), (u1, v1), (u1, v0))
                uvs.append(values if side == -1 else tuple(reversed(values)))
    guard = make_mesh('TripoStoneGuardrails', vertices, faces, material, uvs)
    guard['surfaceRole'] = 'guard'
    for obj in (road, guard):
        for key in ('sourceId', 'provider', 'model', 'sourceSha256'):
            obj[key] = sampler.source[key]
        obj['derivation'] = 'Blender route retopology with actual source UV/color and guard profiles'
    return road, guard



def bake_source_vertex_colors(source, target):
    """Keep source pixels in linear corner colors after a UV-destroying remesh."""
    import bpy
    import numpy as np
    from mathutils import Vector
    from mathutils.geometry import barycentric_transform
    from mathutils.bvhtree import BVHTree
    original = source.data
    original.calc_loop_triangles()
    triangles = list(original.loop_triangles)
    points = [v.co.copy() for v in original.vertices]
    bvh = BVHTree.FromPolygons(points, [tuple(t.vertices) for t in triangles], all_triangles=True)
    uv_points = [Vector((item.uv.x, item.uv.y, 0)) for item in original.uv_layers.active.data]
    material = original.materials[0]
    image = next(node.image for node in material.node_tree.nodes
                 if node.type == 'TEX_IMAGE' and node.image and node.outputs['Color'].is_linked)
    width, height = image.size
    pixels = np.asarray(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
    linearize = image.colorspace_settings.name == 'sRGB' and not image.is_float
    for attr in list(target.data.color_attributes):
        target.data.color_attributes.remove(attr)
    colors = target.data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    uv_layer = target.data.uv_layers.active or target.data.uv_layers.new(name='ProjectedSourceUV')
    for loop in target.data.loops:
        position = target.data.vertices[loop.vertex_index].co
        hit, normal, index, distance = bvh.find_nearest(position)
        triangle = triangles[index]
        uv = barycentric_transform(hit, *[points[i] for i in triangle.vertices],
                                    *[uv_points[i] for i in triangle.loops])
        uv_layer.data[loop.index].uv = (uv.x, uv.y)
        rgba = pixels[min(height-1, max(0, int(uv.y*height))),
                      min(width-1, max(0, int(uv.x*width)))].copy()
        if linearize:
            rgba[:3] = np.where(rgba[:3] <= .04045, rgba[:3]/12.92,
                                ((rgba[:3]+.055)/1.055)**2.4)
        colors.data[loop.index].color = rgba
    target.data.color_attributes.active_color_index = 0
    target.data.color_attributes.render_color_index = 0
    baked = material.copy(); baked.name = 'SourcePixelVertexColor_'+target.name
    nodes = baked.node_tree.nodes
    shader = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
    for link in list(shader.inputs['Base Color'].links):
        baked.node_tree.links.remove(link)
    for node in list(nodes):
        if node.type == 'TEX_IMAGE':
            nodes.remove(node)
    vertex = nodes.new('ShaderNodeVertexColor'); vertex.layer_name = 'Color'
    baked.node_tree.links.new(vertex.outputs['Color'], shader.inputs['Base Color'])
    shader.inputs['Base Color'].default_value = (1, 1, 1, 1)
    target.data.materials.clear(); target.data.materials.append(baked)
    target['pixelSource'] = source['sourceSha256']
    target['pixelDerivation'] = 'nearest source triangle UV sampling; sRGB byte pixels decoded to linear FLOAT_COLOR'
    target['sourceImageColorSpace'] = image.colorspace_settings.name

def crown_trunk_hull(source, target, budget):
    """Closed overlapping crown lobes from the actual source vertex envelope."""
    import bpy
    import bmesh
    import numpy as np
    points = [v.co.copy() for v in source.data.vertices]
    low, high = min(v.z for v in points), max(v.z for v in points)
    split = low+(high-low)*.30
    crown = np.asarray([tuple(p) for p in points if p.z >= split], dtype=float)
    count = 6 if budget >= 900 else 3 if budget >= 100 else 1
    centers = [crown[np.argmax(np.linalg.norm(crown-crown.mean(axis=0), axis=1))]]
    while len(centers) < count:
        distances = np.linalg.norm(crown[:, None, :]-np.asarray(centers)[None, :, :], axis=2)
        centers.append(crown[np.argmax(distances.min(axis=1))])
    centers = np.asarray(centers)
    for iteration in range(10):
        distances = np.linalg.norm(crown[:, None, :]-centers[None, :, :], axis=2)
        labels = distances.argmin(axis=1)
        centers = np.asarray([crown[labels == i].mean(axis=0) for i in range(count)])
    distances = np.linalg.norm(crown[:, None, :]-centers[None, :, :], axis=2)
    nearest = distances.min(axis=1)
    overlap = (high-low)*.025
    trunk_cap = 32 if budget >= 900 else 12 if budget >= 100 else 8
    feet = np.asarray([tuple(p) for p in points if p.z <= low+(high-low)*.12])
    foot_center = feet[:, :2].mean(axis=0)
    span = max(crown[:, 0].max()-crown[:, 0].min(), crown[:, 1].max()-crown[:, 1].min())
    trunk = [tuple(p) for p in points if p.z <= split and
             np.linalg.norm(np.asarray((p.x, p.y))-foot_center) <=
             span*(.18-.10*(p.z-low)/max(1e-8, split-low))]
    parts = [(trunk, trunk_cap)]
    for i in range(count):
        # Overlapping source point selections keep closed lobes joined in space.
        selected = crown[distances[:, i] <= nearest*1.4+overlap]
        parts.append(([tuple(p) for p in selected], (budget-trunk_cap)//count))
    vertices, faces, part_counts = [], [], []
    for selected, cap in parts:
        bm = bmesh.new()
        for point in selected:
            bm.verts.new(point)
        bmesh.ops.convex_hull(bm, input=list(bm.verts))
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        data = bpy.data.meshes.new('ActualSourceTreeLobe')
        bm.to_mesh(data); bm.free()
        part = bpy.data.objects.new(data.name, data)
        bpy.context.scene.collection.objects.link(part)
        bpy.context.view_layer.objects.active = part
        data.calc_loop_triangles()
        if len(data.loop_triangles) > cap:
            modifier = part.modifiers.new('SourceEnvelopeCollapse', 'DECIMATE')
            modifier.ratio = cap/len(data.loop_triangles)*.99
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        part.data.calc_loop_triangles()
        part_counts.append(len(part.data.loop_triangles))
        offset = len(vertices)
        vertices.extend(tuple(v.co) for v in part.data.vertices)
        faces.extend(tuple(offset+i for i in p.vertices) for p in part.data.polygons)
        bpy.data.objects.remove(part, do_unlink=True)
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    positions = [Vector(point) for point in vertices]
    trunk_indices = {i for face in faces[:part_counts[0]] for i in face}
    trunk_low = min(positions[i].z for i in trunk_indices)
    trunk_high = max(positions[i].z for i in trunk_indices)
    top_indices = [i for i in trunk_indices if positions[i].z > trunk_low+(trunk_high-trunk_low)*.8]
    center = sum((positions[i] for i in top_indices), Vector())/len(top_indices)
    canopy = BVHTree.FromPolygons(positions, faces[part_counts[0]:])
    hit = canopy.ray_cast(Vector((center.x, center.y, low-1)), Vector((0, 0, 1)))[0]
    if hit is None:
        hit = canopy.find_nearest(center)[0]
    if hit is None:
        raise ValueError('Source crown has no support contact')
    join = hit-center+Vector((0, 0, (high-low)*.015))
    for index in top_indices:
        positions[index] += join
    vertices = [tuple(point) for point in positions]
    data = bpy.data.meshes.new('TripoTree_SourceEnvelopeLOD')
    data.from_pydata(vertices, [], faces); data.update()
    data.materials.append(source.data.materials[0])
    target.data = data
    return {'method': 'actual source overlapping crown/trunk point hulls then collapse',
            'trunkSplitHeight': split, 'crownClusters': count,
            'trunkBudget': trunk_cap, 'partTriangles': part_counts,
            'trunkJoinTranslation': list(join),
            'trunkPointSelection': 'source lower 30 percent around actual foot centroid; excludes low hanging leaf islands',
            'crownPointOverlap': 1.4, 'sourcePointSelection': 'deterministic spatial clusters of actual source vertices'}


def derive_mesh(source, target_bounds, name, budget=None):
    import bpy
    from mathutils import Matrix
    obj = source.copy(); obj.data = source.data.copy()
    bpy.context.scene.collection.objects.link(obj)
    obj.name = 'TripoDerived_'+name
    obj.animation_data_clear()
    if name.endswith('B'):
        obj.data.transform(Matrix.Diagonal((-1, 1, 1, 1)))
        for polygon in obj.data.polygons:
            polygon.flip()
    if budget and source['sourceId'] == 'tree':
        obj['volumeLOD'] = crown_trunk_hull(source, obj, budget)
        obj.data.calc_loop_triangles()
        if not 0 < len(obj.data.loop_triangles) <= budget:
            raise ValueError('Source tree envelope cannot satisfy budget: '+name)
        bake_source_vertex_colors(source, obj)
    elif budget:
        bpy.context.view_layer.update()
        bpy.context.view_layer.objects.active = obj
        weld = obj.modifiers.new('TripoSource_CoincidentSeams', 'WELD')
        weld.merge_threshold = max(1e-8, max(obj.dimensions)*4e-7)
        bpy.ops.object.modifier_apply(modifier=weld.name)
        for attempt in range(3):
            obj.data.calc_loop_triangles()
            count = len(obj.data.loop_triangles)
            if count <= budget:
                break
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new('TripoSource_LOD', 'DECIMATE')
            modifier.ratio = budget/count*.99
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.data.calc_loop_triangles()
        if not 0 < len(obj.data.loop_triangles) <= budget:
            # Open/disconnected leaf and UV islands impose a collapse floor.
            # Reconstruct volume from the real source, then project its pixels.
            obj.data = source.data.copy()
            bpy.context.view_layer.update()
            voxel = obj.modifiers.new('TripoSource_VolumeLOD', 'REMESH')
            voxel.mode = 'VOXEL'
            voxel.voxel_size = max(obj.dimensions)/32
            voxel.use_smooth_shade = True
            voxel_size = voxel.voxel_size
            bpy.ops.object.modifier_apply(modifier=voxel.name)
            for attempt in range(4):
                obj.data.calc_loop_triangles()
                count = len(obj.data.loop_triangles)
                if count <= budget:
                    break
                modifier = obj.modifiers.new('TripoSource_VolumeCollapse', 'DECIMATE')
                modifier.ratio = budget/count*.98
                modifier.use_collapse_triangulate = True
                bpy.ops.object.modifier_apply(modifier=modifier.name)
            obj.data.calc_loop_triangles()
            if not 0 < len(obj.data.loop_triangles) <= budget:
                raise ValueError('Source volume LOD cannot satisfy budget: '+name)
            bake_source_vertex_colors(source, obj)
            obj['volumeLOD'] = {'method': 'source voxel volume then collapse',
                                'voxelSize': voxel_size, 'budget': budget}
    points = [v.co for v in obj.data.vertices]
    low = [min(v[a] for v in points) for a in range(3)]
    high = [max(v[a] for v in points) for a in range(3)]
    if any(high[a]-low[a] < 1e-7 for a in range(3)):
        raise ValueError('Source reduction lost volumetric shape: '+name)
    for vertex in obj.data.vertices:
        vertex.co = tuple(target_bounds['min'][a]+(vertex.co[a]-low[a])/(high[a]-low[a])*
            (target_bounds['max'][a]-target_bounds['min'][a]) for a in range(3))
    obj.data.update()
    clean_ao(obj); clean_ao(obj.data)
    obj['derivation'] = (obj['volumeLOD']['method']+'; source-pixel projection/bounds fit'
                         if obj.get('volumeLOD') else 'source mesh reflection/bounds fit/local collapse LOD'
                         if budget else 'source mesh reflection/bounds fit')
    obj['runtimeKey'] = name
    if budget:
        obj['triangleBudget'] = budget
    return obj


def read_glb(path):
    with Path(path).open('rb') as stream:
        magic, version, size = struct.unpack('<III', stream.read(12))
        length, kind = struct.unpack('<II', stream.read(8))
        if magic != 0x46546c67 or version != 2 or size != Path(path).stat().st_size or kind != 0x4e4f534a:
            raise ValueError('Invalid candidate GLB: '+str(path))
        return json.loads(stream.read(length))


def ensure_legacy_map(project, output):
    import bpy
    filename = output/'legacy-map.json'
    canonical = project/'assets/blender/asset-library.blend'
    files = [canonical, project/'assets/export/manifest.json', project/'assets/export/course.json']
    hashes = {str(path.relative_to(project)): sha256(path) for path in files}
    if filename.exists():
        data = json.loads(filename.read_text())
        if any(data['files'].get(path) != digest for path, digest in hashes.items()):
            raise ValueError('Canonical input changed since legacy-map snapshot; preserve and review the snapshot')
        return data
    bpy.ops.wm.open_mainfile(filepath=str(canonical))
    records, mesh_data = [], {}
    manifest = json.loads(files[1].read_text())
    for key, item in manifest['models'].items():
        if item['source'] != 'assets/blender/asset-library.blend':
            continue
        doc = read_glb(project/'assets/export'/item['file'])
        names = [doc['nodes'][i]['name'] for i in doc['scenes'][doc.get('scene', 0)]['nodes']]
        obj = next((bpy.data.objects.get(name) for name in names if bpy.data.objects.get(name)), None)
        if obj is None:
            raise ValueError('Canonical root not found: '+key)
        meshes = []
        for child in hierarchy(obj):
            if child.type != 'MESH':
                continue
            data = child.data
            if data.name not in mesh_data:
                data.calc_loop_triangles()
                mesh_data[data.name] = {'vertices': len(data.vertices), 'triangles': len(data.loop_triangles),
                    'materials': [mat.name for mat in data.materials],
                    'bounds': {'min': [min(v.co[a] for v in data.vertices) for a in range(3)],
                               'max': [max(v.co[a] for v in data.vertices) for a in range(3)]}}
            meshes.append({'object': child.name, 'mesh': data.name,
                'parent': child.parent.name if child.parent else None,
                'matrixLocal': [list(row) for row in child.matrix_local],
                'properties': {key: plain(child[key]) for key in child.keys() if key != '_RNA_UI'}})
        records.append({'runtimeKey': key, 'root': obj.name, 'rootMatrix': [list(row) for row in obj.matrix_world],
            'properties': {key: plain(obj[key]) for key in obj.keys() if key != '_RNA_UI'}, 'meshes': meshes})
    result = {'schemaVersion': 1, 'readOnlyOriginals': True, 'files': hashes,
              'roots': records, 'meshData': mesh_data}
    output.mkdir(parents=True, exist_ok=True)
    with filename.open('x') as stream:
        json.dump(result, stream, indent=2)
    return result


def surface_query(objects):
    from mathutils.bvhtree import BVHTree
    vertices, triangles, patches = [], [], []
    for obj in objects:
        obj.data.calc_loop_triangles()
        points = [obj.matrix_world@v.co for v in obj.data.vertices]
        offset = len(vertices); vertices.extend(points)
        for triangle in obj.data.loop_triangles:
            indices = tuple(triangle.vertices)
            p = [points[i] for i in indices]
            material = obj.data.materials[obj.data.polygons[triangle.polygon_index].material_index]
            if material.use_backface_culling and (p[1]-p[0]).cross(p[2]-p[0]).z <= 1e-8:
                continue  # Respect glTF front faces; double-sided source roofs remain visible.
            triangles.append(tuple(offset+i for i in indices))
            patches.append((p, (min(v.x for v in p), max(v.x for v in p),
                                min(v.y for v in p), max(v.y for v in p))))
    if not triangles:
        raise ValueError('Empty support surface')
    return BVHTree.FromPolygons(vertices, triangles, all_triangles=True), patches


def footprint_points(patches, polygon):
    """Same exact polygon clipping used by the native layout builder."""
    bounds = (min(p.x for p in polygon), max(p.x for p in polygon),
              min(p.y for p in polygon), max(p.y for p in polygon))
    sign = 1 if sum(a.x*b.y-b.x*a.y for a, b in zip(polygon, polygon[1:]+polygon[:1])) > 0 else -1
    points = []
    for triangle, box in patches:
        if bounds[0] > box[1] or bounds[1] < box[0] or bounds[2] > box[3] or bounds[3] < box[2]:
            continue
        clipped = triangle[:]
        for a, b in zip(polygon, polygon[1:]+polygon[:1]):
            out = []
            for u, v in zip(clipped, clipped[1:]+clipped[:1]):
                fu = sign*((b.x-a.x)*(u.y-a.y)-(b.y-a.y)*(u.x-a.x))
                fv = sign*((b.x-a.x)*(v.y-a.y)-(b.y-a.y)*(v.x-a.x))
                if fu >= -1e-8:
                    out.append(u)
                if (fu >= -1e-8) != (fv >= -1e-8):
                    out.append(u.lerp(v, fu/(fu-fv)))
            clipped = out
            if not clipped:
                break
        points.extend(clipped)
    return points


def footprint_heights(patches, polygon, top_surface=None):
    points = footprint_points(patches, polygon)
    if top_surface is not None:
        from mathutils import Vector
        # Several new closed hills can overlap in XY. Hidden lower surfaces
        # cannot define a visible building's foundation bottom.
        if len(polygon) == 4:
            columns = max(1, math.ceil((polygon[1]-polygon[0]).length/.5))
            rows = max(1, math.ceil((polygon[3]-polygon[0]).length/.5))
            points.extend(polygon[0]+(polygon[1]-polygon[0])*(x/columns)+
                          (polygon[3]-polygon[0])*(y/rows)
                          for y in range(rows+1) for x in range(columns+1))
        hits = [top_surface.ray_cast(Vector((point.x, point.y, 5000)), Vector((0, 0, -1)))[0]
                for point in points]
        return [hit.z for hit in hits if hit is not None]
    return [point.z for point in points]


def sink_bottom(obj, patches, embed=.15):
    """Bury the actual lower source faces over their complete terrain overlap."""
    obj.data.calc_loop_triangles()
    low = min(v.co.z for v in obj.data.vertices)
    high = max(v.co.z for v in obj.data.vertices)
    world = obj.parent.matrix_world@obj.matrix_basis if obj.parent else obj.matrix_basis
    gaps = []
    for triangle in obj.data.loop_triangles:
        local = [obj.data.vertices[i].co for i in triangle.vertices]
        if max(p.z for p in local) > low+(high-low)*.15:
            continue
        points = [world@point for point in local]
        a, b, c = points
        normal = (b-a).cross(c-a)
        if normal.z >= -1e-8:
            continue
        for point in footprint_points(patches, points):
            bottom = a.z-(normal.x*(point.x-a.x)+normal.y*(point.y-a.y))/normal.z
            gaps.append(bottom-point.z)
    if not gaps:
        raise ValueError('No source bottom faces overlap terrain: '+obj.name)
    obj.location.z -= max(gaps)+embed
    obj['groundSupport'] = {'method': 'actual lower source faces / full terrain polygon clipping',
                            'bottomEmbed': embed, 'checkedIntersections': len(gaps)}
    return max(gaps)


def settle_rock_bottom(obj, surface, embed=.17):
    """Resolve ill-conditioned near-vertical source faces in actual world space.

    Full polygon clipping remains the area proof. Its tiny projected source
    triangles can magnify float coordinate error; probe their real vertices
    and centroids afterwards, without relaxing the minimum embed contract.
    """
    from mathutils import Vector
    low = min(v.co.z for v in obj.data.vertices)
    high = max(v.co.z for v in obj.data.vertices)
    world = obj.parent.matrix_world@obj.matrix_basis if obj.parent else obj.matrix_basis
    correction, count = 0., 0
    obj.data.calc_loop_triangles()
    for triangle in obj.data.loop_triangles:
        local = [obj.data.vertices[i].co for i in triangle.vertices]
        if max(p.z for p in local) > low+(high-low)*.15:
            continue
        a,b,c = [world@point for point in local]
        if (b-a).cross(c-a).z >= -1e-8:
            continue
        for point in (a,b,c,(a+b+c)/3):
            hit = surface.ray_cast(Vector((point.x,point.y,5000)),Vector((0,0,-1)))[0]
            if hit is None:
                raise ValueError('Source rock bottom extends outside support terrain: '+obj.name)
            correction = max(correction,point.z-hit.z+embed)
            count += 1
    if correction > 0:
        obj.location.z -= correction+.002
    obj['groundSupport']['worldProbeCorrection'] = correction+.002 if correction > 0 else 0
    obj['groundSupport']['worldProbeCount'] = count
    obj['groundSupport']['bottomEmbed'] = embed
    return correction


def support_objects(layout, terrain, far_terrain=None):
    import bpy
    from mathutils import Vector
    near_bvh, near_patches = surface_query(terrain)
    far_bvh, far_patches = surface_query(far_terrain) if far_terrain else (near_bvh, near_patches)
    meshes = [obj for obj in hierarchy(layout) if obj.type == 'MESH' and obj.get('sourceId')]
    foundations = {obj.get('building'): obj for obj in meshes if obj.get('building')}
    supported, removed, steep, max_slope = 0, [], [], 0.
    for obj in list(meshes):
        if obj.name not in bpy.data.objects or obj.get('building'):
            continue
        far = obj.parent and obj.parent.name.startswith('ValleyPanorama')
        if obj.parent and any(word in obj.parent.name for word in ('Mountains', 'Foothills', 'Clouds')):
            continue
        bvh, patches = (far_bvh, far_patches) if far else (near_bvh, near_patches)
        base = foundations.get(obj.name)
        is_building = obj['sourceId'] in ('hut', 'stall')
        if is_building:
            lo = [min(v.co[a] for v in obj.data.vertices) for a in range(3)]
            hi = [max(v.co[a] for v in obj.data.vertices) for a in range(3)]
            footprint = [obj.matrix_world@Vector((x, y, lo[2]))
                         for x, y in [(lo[0], lo[1]), (hi[0], lo[1]), (hi[0], hi[1]), (lo[0], hi[1])]]
            hits = [bvh.ray_cast(Vector((p.x, p.y, 5000)), Vector((0, 0, -1)))[0] for p in footprint]
            values = footprint_heights(patches, footprint, bvh) if all(hit is not None for hit in hits) else []
            if not values:
                if not far:
                    raise ValueError('Building misses preserved support terrain: '+obj.name)
                removed.append(obj.name)
                if base:
                    bpy.data.objects.remove(base, do_unlink=True)
                bpy.data.objects.remove(obj, do_unlink=True)
                continue
            top, bottom = max(values)+.03, min(values)-.25
            if far and top-bottom > 12:
                steep.append(obj.name)
                if base:
                    bpy.data.objects.remove(base, do_unlink=True)
                bpy.data.objects.remove(obj, do_unlink=True)
                continue
            # Layout roots are identity; only object-local Z is changed here.
            obj.location.z = top-lo[2]*obj.scale.z
            if base is None:
                raise ValueError('Building lacks its native foundation: '+obj.name)
            center = sum(footprint, Vector())/4
            center.z = bottom
            base.location = center
            base.scale = (math.dist(footprint[0], footprint[1]),
                          math.dist(footprint[1], footprint[2]), top-bottom)
            base['groundSupport'] = {'method': 'terrain triangle/footprint clipping plus visible top-envelope rays',
                                     'heightMin': min(values), 'heightMax': max(values), 'envelopeGridSpacing': .5}
            max_slope = max(max_slope, top-bottom)
        else:
            hit = bvh.ray_cast(Vector((obj.location.x, obj.location.y, 5000)), Vector((0, 0, -1)))[0]
            if hit is None:
                if not far:
                    raise ValueError('Scenery misses preserved support terrain: '+obj.name)
                removed.append(obj.name); bpy.data.objects.remove(obj, do_unlink=True); continue
            if obj['sourceId'] in ('rock', 'cliff'):
                sink_bottom(obj, patches)
            else:
                low = min(v.co.z for v in obj.data.vertices)
                obj.location.z = hit.z-low*obj.scale.z-.025
                obj['groundSupport'] = {'method': 'surface ray at stem/root', 'source': 'new Tripo hill' if far else 'preserved terrain'}
        supported += 1
    return {'supported': supported, 'removedWithoutSupport': removed,
            'removedOnSteepTerrain': steep, 'maxFoundationHeight': max_slope,
            'farTerraceHeightLimit': 12}


def proportional_bounds(data, width):
    """Keep the real source's three-axis ratios, centred for sky placement."""
    low = [min(v.co[a] for v in data.vertices) for a in range(3)]
    high = [max(v.co[a] for v in data.vertices) for a in range(3)]
    scale = width/(high[0]-low[0])
    size = [(high[a]-low[a])*scale for a in range(3)]
    return {'min': [-value/2 for value in size], 'max': [value/2 for value in size]}


def protected_surface_digest(objects):
    """Fingerprint the actual driving/physics geometry, UV/color and metadata."""
    digest = hashlib.sha256()
    for obj in sorted(objects, key=lambda item: item.name):
        digest.update(json.dumps({'name': obj.name, 'matrix': [list(row) for row in obj.matrix_local],
            'properties': plain(obj)}, sort_keys=True).encode())
        if obj.type != 'MESH':
            continue
        data = obj.data
        for vertex in data.vertices:
            digest.update(struct.pack('<3f', *vertex.co))
        for face in data.polygons:
            digest.update(struct.pack('<I', len(face.vertices)))
            digest.update(struct.pack('<'+'I'*len(face.vertices), *face.vertices))
        for layer in data.uv_layers:
            for value in layer.data:
                digest.update(struct.pack('<2f', *value.uv))
        for layer in data.color_attributes:
            for value in layer.data:
                digest.update(struct.pack('<4f', *value.color))
    return digest.hexdigest()


def submission_budget(valley, course_root):
    groups = [group for group in valley.children if group.type == 'EMPTY']
    total = 0
    for group in groups:
        meshes = [obj for obj in group.children if obj.type == 'MESH']
        meshes[0].data.calc_loop_triangles()
        panorama = group.name.startswith('ValleyPanorama') or any(
            word in group.name for word in ('Mountains', 'Foothills', 'Clouds'))
        total += len(meshes[0].data.loop_triangles)*len(meshes)*(1 if panorama else 2)
    chunks, counts = [], []
    for chunk in sorted(course_root.children, key=lambda obj: obj['segment']):
        count, kinds = 0, {}
        for obj in chunk.children:
            if obj.type != 'MESH':
                continue
            obj.data.calc_loop_triangles(); count += len(obj.data.loop_triangles)
            if obj.get('kind'):
                kinds[obj['kind']] = kinds.get(obj['kind'], 0)+1
        chunks.append(count); counts.append(kinds)
    total += max(sum((chunks*2)[i:i+8]) for i in range(len(chunks)))
    capacities = {key: max(sum((counts*2)[j].get(key, 0) for j in range(i,i+8))
                          for i in range(len(counts))) for key in
                  {key for count in counts for key in count}}
    if total >= 2000000 or max(capacities.values()) > 160:
        raise ValueError('Environment submission/instance capacity exceeded: '+str((total, capacities)))
    return total, capacities


def publish_candidate(output, assets, models, course_path):
    import bpy
    import tempfile
    with tempfile.TemporaryDirectory(prefix='.candidate-', dir=output) as directory:
        stage = Path(directory); (stage/'export').mkdir()
        validated, repairs = set(), []
        for key, root in assets.items():
            bpy.ops.object.select_all(action='DESELECT')
            for obj in hierarchy(root):
                if obj.type == 'MESH' and obj.get('sourceId') and obj.data.as_pointer() not in validated:
                    if obj.data.validate(clean_customdata=False):
                        repairs.append(obj.data.name)
                    validated.add(obj.data.as_pointer())
                obj.hide_set(False); obj.select_set(True)
            bpy.context.view_layer.objects.active = root
            path = stage/'export'/(key+'.glb')
            bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                export_yup=True, export_extras=True, export_vertex_color='ACTIVE',
                export_animations=False, export_skins=False, export_morph=False)
            doc = read_glb(path)
            unique = {obj.data.as_pointer(): obj.data for obj in hierarchy(root) if obj.type == 'MESH'}
            for data in unique.values():
                data.calc_loop_triangles()
            expected = sum(len(data.loop_triangles) for data in unique.values())
            exported = sum(doc['accessors'][primitive.get('indices', primitive['attributes']['POSITION'])]['count']//3
                           for mesh in doc.get('meshes', []) for primitive in mesh['primitives'])
            if expected != exported:
                raise ValueError('Native/GLB triangle mismatch for '+key+': '+str((expected, exported)))
            models.setdefault(key, {}).update(file=key+'.glb', bytes=path.stat().st_size,
                meshes=len(doc.get('meshes', [])), nodes=len(doc.get('nodes', [])), triangles=exported)
        (stage/'export/course.json').write_bytes(course_path.read_bytes())
        bpy.context.preferences.filepaths.save_version = 0
        bpy.data.orphans_purge(do_recursive=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(stage/'asset-library.blend'), check_existing=False)
        (output/'export').mkdir(exist_ok=True)
        for path in (stage/'export').iterdir():
            path.replace(output/'export'/path.name)
        (stage/'asset-library.blend').replace(output/'asset-library.blend')
    return repairs


def revise_visuals(project, output, recipe):
    """Revise the frozen pre-review candidate; promoted canonical stays read-only."""
    import bpy
    import numpy as np
    from mathutils import Vector
    if not bpy.app.background:
        raise RuntimeError('Use an independent headless process')
    backup = output/'backups/pre-visual-revision'
    report = json.loads((backup/'report.json').read_text())
    mapping = json.loads((backup/'runtime-map.json').read_text())
    bpy.ops.wm.open_mainfile(filepath=str(backup/'asset-library.blend'))
    assets = {key: bpy.data.objects[item['root']] for key, item in mapping.items()}
    course_root, valley = assets['roadCourse'], assets['valley']
    course = json.loads((backup/'export/course.json').read_text())
    protected = [course_root, assets['roadTile'], valley]+list(course_root.children)+[
        obj for root in (course_root, assets['roadTile'], valley) for obj in hierarchy(root)
        if obj.type == 'MESH' and (obj.get('surfaceRole') in ('road','guard','terrain') or
                                 obj.name in ('ValleyTerrain','ValleyWater'))]
    before = protected_surface_digest(protected)
    canonical_paths = ('assets/blender/asset-library.blend', 'assets/export/manifest.json', 'assets/export/course.json')
    originals = {path: sha256(project/path) for path in canonical_paths}
    source = append_source(recipe['cloud'])
    cloud_report = {}
    for key, width in (('cloud', 9), ('cloudB', 11), ('cloudC', 12)):
        old = next(obj.data for obj in hierarchy(assets[key]) if obj.type == 'MESH')
        bounds = proportional_bounds(source.data, width)
        derived = derive_mesh(source, bounds, key)
        for obj in list(bpy.data.objects):
            if obj.type == 'MESH' and obj.data == old:
                obj.data = derived.data
                obj['derivation'] = 'actual cloud master; uniform scale preserves H3 three-axis proportions'
        report['models'][key]['bounds'] = bounds
        cloud_report[key] = {'bounds': bounds, 'uniformSourceScale': width/5,
                              'preservesSourceProportions': True}
        bpy.data.objects.remove(derived, do_unlink=True)
    bpy.data.objects.remove(source, do_unlink=True)
    terrain = [obj for obj in hierarchy(course_root) if obj.get('surfaceRole') == 'terrain']
    surface, patches = surface_query(terrain)
    prototypes = {key: next(obj for obj in hierarchy(assets[key]) if obj.type == 'MESH')
                  for key in ('rockA','rockB','rockC','rockD')}
    for obj in list(hierarchy(course_root)):
        if obj.get('kind') in prototypes:
            bpy.data.objects.remove(obj, do_unlink=True)
    chunks = {chunk['segment']: chunk for chunk in course_root.children}
    counts = {key: 0 for key in prototypes}; min_clearance = float('inf')
    rock_details = []
    for layer, step in (('upper', 16), ('foot', 10)):
        for index in range(int(course['road']['period']/step)):
            s = min(1584 if layer == 'upper' else 1590,
                    max(16 if layer == 'upper' else 10, (index+.5)*step))
            key = ('rockA' if index%2 == 0 else 'rockB') if layer == 'upper' else (
                   'rockC' if index%2 == 0 else 'rockD')
            # Expose natural rock shelves below the existing tree line. A tall
            # constant-height row turns the real cliff into an artificial wall.
            wave = math.sin(index*1.37)+.6*math.sin(index*.43)
            target = (10.5+math.sin(index*.83), 23+2*math.sin(index*.71),
                      (11.6 if key == 'rockA' else 12.5)+wave*1.45) if layer == 'upper' else (
                      4.8, 16+math.sin(index*.91),
                      (7.8 if key == 'rockC' else 8.4)+math.sin(index*1.71)*1.0)
            lateral = -17.2-math.sin(index*.83) if layer == 'upper' else -9.0
            prototype = prototypes[key]
            obj = prototype.copy(); obj.data = prototype.data
            bpy.context.scene.collection.objects.link(obj)
            obj.parent = chunks[min(19,int(s//80))]
            obj.name = 'Road_'+key+'_Terrace_'+str(index)
            obj['kind'] = key; obj['visualLayer'] = layer; obj['courseS'] = s
            low = np.array([min(v.co[a] for v in obj.data.vertices) for a in range(3)])
            high = np.array([max(v.co[a] for v in obj.data.vertices) for a in range(3)])
            obj.scale = tuple(np.array(target)/(high-low))
            yaw = math.atan2(route_point(course,s,1)[1]-route_point(course,s)[1],
                             route_point(course,s,1)[0]-route_point(course,s)[0])
            obj.rotation_euler = (0, 0, yaw+math.sin(index*2.399)*.07)
            rotation = obj.rotation_euler.to_matrix()
            center = Vector(tuple((low+high)/2*np.array(obj.scale)))
            center.z = 0
            # Closest course-polyline distances use all actual mesh vertices,
            # including overhangs, rather than a nominal footprint radius.
            samples = np.array([route_point(course,s+delta)[:2] for delta in range(-36,38,2)])
            a, b = samples[:-1], samples[1:]; ab = b-a
            for attempt in range(20):
                position = Vector(route_point(course,s,lateral))
                obj.location = position-rotation@center
                obj.location.z = 0
                matrix = obj.parent.matrix_world@obj.matrix_basis
                points = np.array([tuple(matrix@v.co)[:2] for v in obj.data.vertices])
                ap = points[:,None,:]-a[None,:,:]
                t = np.clip(np.sum(ap*ab,axis=2)/np.sum(ab*ab,axis=1),0,1)
                d = ap-t[:,:,None]*ab
                clearance = float(np.sqrt(np.min(np.sum(d*d,axis=2))))
                if clearance >= 6.15:
                    break
                lateral -= .5
            else:
                raise ValueError('Unable to clear actual driving corridor: '+obj.name)
            hit = surface.ray_cast(Vector((position.x,position.y,5000)),Vector((0,0,-1)))[0]
            if hit is None:
                raise ValueError('Revised cliff has no terrain support: '+obj.name)
            obj.location.z = hit.z
            # The independent 5000m-down BVH rays quantize by about a
            # millimetre; retain the strict .149m check with 2cm real margin.
            sink_bottom(obj, patches, embed=.17)
            settle_rock_bottom(obj, surface, embed=.17)
            obj['roadClearance'] = clearance
            min_clearance = min(min_clearance,clearance); counts[key] += 1
            rock_details.append({'name': obj.name, 'kind': key, 'courseS': s,
                                 'layer': layer, 'dimensions': list(target),
                                 'roadClearance': clearance, 'lateral': lateral})
    bpy.context.view_layer.update()
    after = protected_surface_digest(protected)
    if before != after:
        raise ValueError('Visual revision altered protected driving/terrain/period data')
    total, capacities = submission_budget(valley, course_root)
    report['roadsideSupport']['supported'] = sum(
        1 for obj in hierarchy(course_root) if obj.type == 'MESH' and
        obj.get('sourceId') and not obj.get('building') and not obj.get('surfaceRole'))
    if any(sha256(project/path) != digest for path,digest in originals.items()):
        raise ValueError('Canonical input changed concurrently during visual revision')
    report['visualRevision'] = {'base': str(backup.relative_to(project)),
        'baseNativeSha256': sha256(backup/'asset-library.blend'),
        'protectedSurfaceSha256Before': before, 'protectedSurfaceSha256After': after,
        'clouds': cloud_report, 'cliffCounts': counts, 'cliffInstances': rock_details,
        'minActualVertexRoadClearance': min_clearance, 'maxVisibleInstancesByKind': capacities,
        'cliffBottomEmbedMetres': .17,
        'method': 'two overlapping actual Tripo cliff rows; uniform-source cloud proportions',
        'paidGenerationCalls': 0}
    report['estimatedSubmittedTriangles'] = total
    report['validatedMeshRepairs'] = publish_candidate(output, assets, report['models'], backup/'export/course.json')
    (output/'runtime-map.json').write_text(json.dumps(mapping,indent=2)+'\n')
    return report


def assemble(project, output, recipe):
    import bpy
    from mathutils import Matrix
    if not bpy.app.background:
        raise RuntimeError('Run only in an independent headless Blender process')
    legacy = ensure_legacy_map(project, output)
    original_hashes = {path: digest for path, digest in legacy['files'].items()
                       if path in ('assets/blender/asset-library.blend', 'assets/export/manifest.json', 'assets/export/course.json')}
    native_hashes = {key: sha256(recipe[key]['native']) for key in REQUIRED_SOURCES}
    bpy.ops.wm.open_mainfile(filepath=str(project/'assets/blender/asset-library.blend'))
    records = {item['runtimeKey']: item for item in legacy['roots']}
    assets = {key: bpy.data.objects[records[key]['root']] for key in
              list(PROTOTYPES)+['roadTile', 'roadCourse', 'valley', 'sky']}
    keep = {obj for root in assets.values() for obj in hierarchy(root)}
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    for root in assets.values():
        root.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()
    sources = {key: append_source(recipe[key]) for key in REQUIRED_SOURCES}
    replacements, models = {}, {}
    for key, source_id in PROTOTYPES.items():
        record = records[key]
        if len(record['meshes']) != 1:
            raise ValueError('Expected one canonical prototype mesh: '+key)
        old_name = record['meshes'][0]['mesh']
        bounds_key = 'forestTree' if key.startswith('forestTree') else key
        bounds_name = records[bounds_key]['meshes'][0]['mesh']
        target = legacy['meshData'][bounds_name]['bounds']
        derived = derive_mesh(sources[source_id], target, key, LOD_BUDGETS.get(key))
        replacements[old_name] = derived
        derived.data.calc_loop_triangles()
        models[key] = {'sourceId': source_id, 'sourceSha256': derived['sourceSha256'],
            'triangles': len(derived.data.loop_triangles),
            'geometry': 'source volume remesh with source-pixel colors' if derived.get('volumeLOD') else 'actual master-derived mesh',
            'bounds': target, 'lodBudget': LOD_BUDGETS.get(key),
            'volumeLOD': plain(derived.get('volumeLOD')), 'pixelDerivation': derived.get('pixelDerivation'),
            'sourceImageColorSpace': derived.get('sourceImageColorSpace')}
        for field in ('sourceId', 'provider', 'model', 'sourceSha256'):
            assets[key][field] = derived[field]
    far_foundation = bpy.data.objects.get('ValleyPanoramaFoundations')
    if far_foundation and far_foundation.children:
        old = far_foundation.children[0].data
        replacements[old.name] = derive_mesh(sources['foundation'],
            {'min': [-.5, -.5, 0], 'max': [.5, .5, 1]}, 'panoramaFoundation', 24)
    replaced = 0
    for root in assets.values():
        clean_ao(root)
        for obj in hierarchy(root):
            clean_ao(obj)
            if obj.type != 'MESH' or obj.data.name not in replacements:
                continue
            derived = replacements[obj.data.name]
            obj.data = derived.data
            for field in ('sourceId', 'provider', 'model', 'sourceSha256', 'derivation', 'runtimeKey',
                          'volumeLOD', 'pixelSource', 'pixelDerivation', 'sourceImageColorSpace'):
                if field in derived:
                    obj[field] = derived[field]
            replaced += 1
    valley, course_root = assets['valley'], assets['roadCourse']
    # Distant groups can use their own shared master-derived geometry/material.
    variants = {}
    for group_name, key, budget in [('ValleyPanoramaHouse', 'villageHouse', 120),
            ('ValleyPanoramaLonghouse', 'villageLonghouse', 100),
            ('ValleyPanoramaTower', 'tower', 160), ('ValleyPalms', 'palm', 300)]:
        bound_name = records[key]['meshes'][0]['mesh']
        derived = derive_mesh(sources[PROTOTYPES[key]], legacy['meshData'][bound_name]['bounds'],
                              group_name, budget)
        for obj in bpy.data.objects[group_name].children:
            obj.data = derived.data
            obj['derivation'] = derived['derivation']
            for field in ('volumeLOD', 'pixelSource', 'pixelDerivation', 'sourceImageColorSpace'):
                if field in derived:
                    obj[field] = derived[field]
        derived.data.calc_loop_triangles()
        variants[group_name] = {'sourceId': derived['sourceId'],
            'triangles': len(derived.data.loop_triangles), 'budget': budget,
            'volumeLOD': plain(derived.get('volumeLOD')), 'pixelDerivation': derived.get('pixelDerivation')}
        replacements['variant:'+group_name] = derived
    removed_hills = []
    for group_name in ('ValleyFoothills', 'ValleyFoothillsB', 'ValleyMidMountains', 'ValleyMidMountainsB'):
        group = bpy.data.objects[group_name]
        for obj in list(group.children):
            if in_bay_sector(obj.location):
                removed_hills.append(obj.name)
                bpy.data.objects.remove(obj, do_unlink=True)
    for name in ('ValleyMountains', 'ValleyMountainsB'):
        for obj in bpy.data.objects[name].children:
            if in_bay_sector(obj.location):
                obj.scale.z *= .38
                obj.location.x *= 1.12; obj.location.y *= 1.12
    for base in list(bpy.data.objects['ValleyPanoramaFoundations'].children):
        if base.get('groundSource') in removed_hills:
            building = bpy.data.objects.get(base.get('building', ''))
            if building:
                bpy.data.objects.remove(building, do_unlink=True)
            bpy.data.objects.remove(base, do_unlink=True)
    bpy.context.view_layer.update()
    support_groups = [group for group in valley.children if any(
        obj.type == 'MESH' and obj.get('sourceId') == 'mountain' for obj in group.children)]
    far_hills = [obj for group in support_groups for obj in group.children if obj.type == 'MESH']
    valley_support = support_objects(valley, [bpy.data.objects['ValleyTerrain']], far_hills)
    road_terrain = [obj for obj in hierarchy(course_root) if obj.get('surfaceRole') == 'terrain']
    road_support = support_objects(course_root, road_terrain)
    sampler = RoadSampler(sources['road-module'])
    material, projection = sampler.bake_material()
    course = json.loads((project/'assets/export/course.json').read_text())
    for obj in list(assets['roadTile'].children):
        if obj.type == 'MESH' and not obj.name.startswith('RoadsideTerrain'):
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in road_strip(sampler, material, course, 0, 80, straight=True):
        obj.parent = assets['roadTile']
    roads = []
    for chunk in sorted(course_root.children, key=lambda obj: obj['segment']):
        for obj in list(chunk.children):
            if obj.get('surfaceRole') in ('road', 'guard'):
                bpy.data.objects.remove(obj, do_unlink=True)
        pair = road_strip(sampler, material, course, chunk['segment']*80, 80)
        for obj in pair:
            obj.parent = chunk; obj['segment'] = chunk['segment']
        roads.append(pair[0])
    seam = 0.
    for a, b in zip(roads, roads[1:]):
        count = a['crossSectionVertices']
        seam = max(seam, max((u.co-v.co).length for u, v in zip(a.data.vertices[-count:], b.data.vertices[:count])))
    from mathutils import Vector
    advance = course['road']['advance']
    translation = Vector((advance['x'], -advance['z'], advance['y']))
    count = roads[0]['crossSectionVertices']
    seam = max(seam, max((u.co-v.co-translation).length for u, v in
        zip(roads[-1].data.vertices[-count:], roads[0].data.vertices[:count])))
    if seam > 1e-5:
        raise ValueError('Road chunk seam exceeds 0.01 mm: '+str(seam))
    groups = [obj for obj in valley.children if obj.type == 'EMPTY']
    group_counts = {}
    for group in groups:
        meshes = [obj for obj in group.children if obj.type == 'MESH']
        if not meshes or len({obj.data.as_pointer() for obj in meshes}) != 1 or any(len(obj.data.materials) != 1 for obj in meshes):
            raise ValueError('authoredBatch single-geometry/material contract failed: '+group.name)
        group_counts[group.name] = len(meshes)
    allowed_native = {'ValleyTerrain', 'ValleyWater', 'SkySphere'}
    visible_old = [obj.name for root in (valley, course_root) for obj in hierarchy(root)
                   if obj.type == 'MESH' and not obj.get('sourceId')
                   and obj.name not in allowed_native and obj.get('surfaceRole') != 'terrain']
    if visible_old:
        raise ValueError('Unreplaced old visible decoration: '+str(visible_old))
    panorama = {name for name in group_counts if name.startswith('ValleyPanorama') or
                any(word in name for word in ('Mountains', 'Foothills', 'Clouds'))}
    submitted = 0
    for group in groups:
        first = next(obj for obj in group.children if obj.type == 'MESH')
        first.data.calc_loop_triangles()
        submitted += len(first.data.loop_triangles)*group_counts[group.name]*(1 if group.name in panorama else 2)
    chunk_counts = []
    for chunk in course_root.children:
        triangles = 0
        for obj in chunk.children:
            if obj.type == 'MESH':
                obj.data.calc_loop_triangles(); triangles += len(obj.data.loop_triangles)
        chunk_counts.append(triangles)
    submitted += max(sum((chunk_counts*2)[i:i+8]) for i in range(len(chunk_counts)))
    if submitted > 2000000:
        raise ValueError('Candidate environment exceeds the 2M submitted-triangle guard: '+str(submitted))
    for obj in list(replacements.values())+list(sources.values()):
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for root in (assets['roadTile'], valley, course_root, assets['sky']):
        root['geometryProvider'] = 'Blender continuous surfaces / Tripo master-derived decoration'
    assets['sky']['geometryProvider'] = 'Blender procedural unit sphere; shader uses POSITION only'
    assets['sky']['normalSource'] = 'unit sphere POSITION shader; Blender split-normal glTF quantization (direction error below 2.5e-4)'
    source_files = {key: {'native': str(recipe[key]['native']), 'sha256': native_hashes[key]}
                    for key in REQUIRED_SOURCES}
    if any(sha256(project/path) != digest for path, digest in original_hashes.items()):
        raise RuntimeError('Original canonical input changed during assembly')
    if any(sha256(recipe[key]['native']) != digest for key, digest in native_hashes.items()):
        raise RuntimeError('A prepared source changed during assembly; rerun against a stable source set')
    output.mkdir(parents=True, exist_ok=True)
    repairs = publish_candidate(output, assets, models, project/'assets/export/course.json')
    mapping = {key: {'sourceCandidate': str((output/'asset-library.blend').relative_to(project)),
                     'root': root.name} for key, root in assets.items()}
    (output/'runtime-map.json').write_text(json.dumps(mapping, indent=2)+'\n')
    canonical_manifest = json.loads((project/'assets/export/manifest.json').read_text())
    excluded = {}
    for key, item in canonical_manifest['models'].items():
        if key in assets:
            continue
        doc = read_glb(project/'assets/export'/item['file'])
        roots = [doc['nodes'][index]['name'] for index in doc['scenes'][doc.get('scene', 0)]['nodes']]
        excluded[key] = {'source': item['source'], 'roots': roots,
                         'status': 'not included; root-owned replacement required'}
    return {'status': 'candidate-ready', 'candidateBlend': str(output/'asset-library.blend'),
        'models': models, 'sources': source_files, 'replacedMeshObjects': replaced,
        'groups': group_counts, 'variants': variants, 'roadProjection': projection,
        'roadChunkSeamMaxMetres': seam, 'estimatedSubmittedTriangles': submitted,
        'bay': {'clearedHills': removed_hills, 'sector': 'positive X coastal side, +/-65 degrees',
                'farRidgeHeightScale': .38, 'farRidgeRadiusScale': 1.12},
        'valleySupport': valley_support, 'roadsideSupport': road_support,
        'supportSurfaceGroups': [group.name for group in support_groups],
        'retainedProgramSurfaces': ['native road terrain and terrainGrid', 'ValleyTerrain',
            'ValleyWater', 'shader sky sphere', 'road driving-plane retopology'],
        'originalInputsUnchanged': True,
        'skyNormalContract': {'positionRadiusError': 1e-6, 'normalDirectionError': 2.5e-4,
            'reason': 'POSITION-only procedural sphere shader; saved-native Blender split-normal quantization, not a Tripo tolerance'},
        'validatedMeshRepairs': repairs,
        'courseSha256': original_hashes['assets/export/course.json'],
        'runtimeMap': str(output/'runtime-map.json'), 'excludedRuntimeKeys': excluded,
        'validationScope': 'headless geometry, source provenance, support and export structure; browser visual/performance acceptance is separate'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, default=ROOT)
    parser.add_argument('--recipe', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--preflight', action='store_true')
    parser.add_argument('--visual-revision', action='store_true',
                        help='Revise the backed-up candidate after visual review without reading promoted geometry')
    options = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:])
    project = options.project.resolve()
    output = output_path(project, options.output or project/'artifacts/tripo-environment')
    report = {'schemaVersion': 1, 'candidateOnly': True, 'status': 'checking'}
    try:
        recipe = read_recipe(project, options.recipe or project/'scripts/banana-tripo/static-recipe.json')
        missing = source_preflight(recipe)
        if missing:
            report.update(status='missing-sources', missingSources=missing)
            write_report(output, report)
            raise SystemExit(1)
        if options.preflight:
            report.update(status='sources-present', requiredSources=list(REQUIRED_SOURCES))
        elif options.visual_revision:
            report.update(revise_visuals(project, output, recipe))
        else:
            report.update(assemble(project, output, recipe))
        write_report(output, report)
    except Exception as error:
        report.update(status='failed', error=str(error))
        write_report(output, report)
        raise


if __name__ == '__main__':
    main()
