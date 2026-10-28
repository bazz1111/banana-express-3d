"""Small contract checks; run with system Python, no Blender required."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

try:
    import bpy
except ImportError:
    bpy = None


SCRIPT = Path(__file__).with_name('assemble-environment.py')


def module():
    assert SCRIPT.is_file(), 'The candidate assembler is not implemented'
    spec = importlib.util.spec_from_file_location('banana_environment', SCRIPT)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class EnvironmentContracts(unittest.TestCase):
    def test_periodic_route_preserves_native_axes_and_road_height(self):
        # A cycle-offset bug opens road seams or moves the driving plane.
        env = module()
        course = {'points': [
            {'s': 0, 'x': 0, 'y': 0, 'z': 0, 'yaw': 0},
            {'s': 2, 'x': 0, 'y': -.08, 'z': 2, 'yaw': 0},
            {'s': 4, 'x': 0, 'y': -.16, 'z': 4, 'yaw': 0}],
            'road': {'period': 4, 'advance': {'x': 0, 'y': -.16, 'z': 4}}}
        for s, expected in [(1, (3, -1, .46)), (5, (3, -5, .30)),
                            (-1, (3, 1, .54)), (4, (3, -4, .34))]:
            actual = env.route_point(course, s, 3, .5)
            for got, want in zip(actual, expected):
                self.assertAlmostEqual(got, want, places=7)

    def test_missing_sources_fail_without_creating_a_candidate(self):
        # Silently retaining canonical visible meshes would turn this green.
        env = module()
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            recipe = project / 'recipe.json'
            recipe.write_text(json.dumps({'assets': [
                {'id': key, 'root': 'Tripo'+key.title(),
                 'native': 'assets/blender/tripo/'+key+'.blend'}
                for key in env.REQUIRED_SOURCES]}))
            result = subprocess.run([sys.executable, str(SCRIPT), '--preflight',
                '--project', directory, '--recipe', str(recipe)],
                text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            output = project / 'artifacts/tripo-environment'
            report = json.loads((output / 'report.json').read_text())
            self.assertEqual(report['status'], 'missing-sources')
            self.assertEqual({item['id'] for item in report['missingSources']},
                             set(env.REQUIRED_SOURCES))
            self.assertFalse((output / 'asset-library.blend').exists())
            self.assertFalse((output / 'export').exists())

    def test_output_cannot_overwrite_canonical_sources_or_escape_by_symlink(self):
        env = module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            allowed = root / 'artifacts/tripo-environment'
            self.assertEqual(env.output_path(root, allowed), allowed)
            with self.assertRaises(ValueError):
                env.output_path(root, root / 'assets/blender')
            allowed.parent.mkdir(parents=True)
            allowed.symlink_to(root / 'assets')
            with self.assertRaises(ValueError):
                env.output_path(root, allowed)

    def test_bay_opening_keeps_an_inland_ridge_and_clears_the_sea_side(self):
        # Clearing the wrong hemisphere would leave the large green wall.
        env = module()
        self.assertTrue(env.in_bay_sector((660, 0, -25)))
        self.assertTrue(env.in_bay_sector((600, -300, -25)))
        self.assertFalse(env.in_bay_sector((-660, 0, -25)))
        self.assertFalse(env.in_bay_sector((0, 660, -25)))

    def test_compressed_native_header_is_not_rejected_as_a_missing_source(self):
        # Blender 5 writes Zstandard-compressed .blend files in this project.
        env = module()
        with tempfile.TemporaryDirectory() as directory:
            native = Path(directory)/'rock.blend'
            native.write_bytes(b'\x28\xb5\x2f\xfd')
            missing = env.source_preflight({'rock': {'native': native}})
            self.assertNotIn('rock', {item['id'] for item in missing})


@unittest.skipUnless(bpy is not None, 'Run inside headless Blender for actual mesh checks')
class NativeRoadContract(unittest.TestCase):
    def test_cloud_fit_keeps_actual_source_proportions(self):
        env = module()
        recipe = env.read_recipe(env.ROOT, env.ROOT/'scripts/banana-tripo/static-recipe.json')
        source = env.append_source(recipe['cloud'])
        source_size = [max(v.co[a] for v in source.data.vertices)-
                       min(v.co[a] for v in source.data.vertices) for a in range(3)]
        bounds = env.proportional_bounds(source.data, 11)
        target = env.derive_mesh(source, bounds, 'cloudProportionTest')
        ratios = [(max(v.co[a] for v in target.data.vertices)-
                   min(v.co[a] for v in target.data.vertices))/source_size[a] for a in range(3)]
        self.assertLess(max(ratios)-min(ratios), 1e-5,
                        'Fitting the old flattened cloud bbox destroys H3 volume')

    def test_protected_surface_digest_detects_collision_metadata_and_geometry_changes(self):
        env = module()
        material = bpy.data.materials.new('ProtectedFixture')
        obj = env.make_mesh('ProtectedTerrain', [(0,0,0),(1,0,0),(0,1,0)], [(0,1,2)], material)
        obj['surfaceRole'] = 'terrain'
        obj['terrainGrid'] = {'width': 2, 'heights': [0.,1.,2.,3.]}
        original = env.protected_surface_digest([obj])
        obj['terrainGrid']['heights'][2] = 4
        self.assertNotEqual(env.protected_surface_digest([obj]), original)
        obj['terrainGrid']['heights'][2] = 2
        obj.data.vertices[1].co.z = .1
        self.assertNotEqual(env.protected_surface_digest([obj]), original)

    def test_whole_rock_bottom_is_buried_on_a_slope(self):
        env = module()
        material = bpy.data.materials.new('RockSupportFixture')
        terrain = env.make_mesh('SlopeFixture', [(-2, -2, -2), (2, -2, 2),
            (2, 2, 2), (-2, 2, -2)], [(0, 1, 2, 3)], material)
        vertices = [(x, y, z) for z in (0, 2) for x, y in
                    [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
        rock = env.make_mesh('RockFixture', vertices, [(0, 3, 2, 1), (4, 5, 6, 7),
            (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], material)
        bvh, patches = env.surface_query([terrain])
        env.sink_bottom(rock, patches)
        self.assertAlmostEqual(rock.location.z, -1.15, places=5)

    def test_closed_terrain_bottom_is_not_a_foundation_height_sample(self):
        env = module()
        material = bpy.data.materials.new('SupportFixture')
        vertices = [(x, y, z) for z in (-10, 2) for x, y in
                    [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                 (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        terrain = env.make_mesh('ClosedSupportFixture', vertices, faces, material)
        lower = env.make_mesh('OccludedUpwardFloor', [(x, y, 0) for x, y in
            [(-1, -1), (1, -1), (1, 1), (-1, 1)]], [(0, 1, 2, 3)], material)
        roof = env.make_mesh('VisibleDoubleSidedRoof', [(x, y, 3) for x, y in
            [(-1, -1), (1, -1), (1, 1), (-1, 1)]], [(0, 3, 2, 1)], material)
        from mathutils import Vector
        bvh, patches = env.surface_query([terrain, lower, roof])
        values = env.footprint_heights(patches,
            [Vector((x, y, 0)) for x, y in [(-.5, -.5), (.5, -.5), (.5, .5), (-.5, .5)]], bvh)
        self.assertTrue(values)
        self.assertEqual(min(values), 3)
        self.assertEqual(max(values), 3)

    def test_real_leaf_islands_make_source_derived_forest_lods(self):
        env = module()
        recipe = env.read_recipe(env.ROOT, env.ROOT/'scripts/banana-tripo/static-recipe.json')
        if not recipe['tree']['native'].is_file():
            self.skipTest('The real tree native has not arrived')
        source = env.append_source(recipe['tree'])
        for budget in (900, 100, 24):
            derived = env.derive_mesh(source, {'min': [-1.25, -1.1, 0],
                'max': [1.25, 1.1, 3.4]}, 'testTree'+str(budget), budget)
            derived.data.calc_loop_triangles()
            self.assertTrue(0 < len(derived.data.loop_triangles) <= budget)
            self.assertEqual(len(derived.data.materials), 1)
            if derived.get('volumeLOD'):
                self.assertEqual(derived['pixelSource'], source['sourceSha256'])
                self.assertTrue(any(sum(item.color[:3]) < 2.5
                                    for item in derived.data.color_attributes['Color'].data))
                from mathutils import Vector
                from mathutils.bvhtree import BVHTree
                count = derived['volumeLOD']['partTriangles'][0]
                trunk = {i for face in derived.data.polygons[:count] for i in face.vertices}
                points = [v.co.copy() for v in derived.data.vertices]
                low, high = min(points[i].z for i in trunk), max(points[i].z for i in trunk)
                top = [points[i] for i in trunk if points[i].z > low+(high-low)*.8]
                center = sum(top, Vector())/len(top)
                crown = BVHTree.FromPolygons(points,
                    [tuple(face.vertices) for face in derived.data.polygons[count:]])
                hit = crown.ray_cast(Vector((center.x, center.y, low-1)), Vector((0, 0, 1)))[0]
                self.assertIsNotNone(hit)
                self.assertGreaterEqual(high+1e-5, hit.z, 'The source-derived crown floats above its trunk')

    def test_real_master_derivative_keeps_uvs_and_the_source_immutable(self):
        env = module()
        recipe = env.read_recipe(env.ROOT, env.ROOT/'scripts/banana-tripo/static-recipe.json')
        before = env.sha256(recipe['rock']['native'])
        source = env.append_source(recipe['rock'])
        derived = env.derive_mesh(source, {'min': [-1, -2, 0], 'max': [1, 2, 3]},
                                  'testRock', 24)
        derived.data.calc_loop_triangles()
        self.assertLessEqual(len(derived.data.loop_triangles), 24)
        self.assertGreater(len(derived.data.loop_triangles), 0)
        for axis, low, high in [(0, -1, 1), (1, -2, 2), (2, 0, 3)]:
            self.assertAlmostEqual(min(v.co[axis] for v in derived.data.vertices), low, places=5)
            self.assertAlmostEqual(max(v.co[axis] for v in derived.data.vertices), high, places=5)
        self.assertTrue(derived.data.uv_layers)
        self.assertEqual(len(derived.data.materials), 1)
        self.assertNotIn('vertexAO', derived)
        self.assertEqual(env.sha256(recipe['rock']['native']), before)
        mirrored = env.derive_mesh(source, {'min': [-1, -2, 0], 'max': [1, 2, 3]},
                                   'testRockB', 100)
        self.assertEqual(mirrored['sourceSha256'], source['sourceSha256'])

    def test_real_tripo_road_projection_and_chunk_join(self):
        env = module()
        recipe = env.read_recipe(env.ROOT, env.ROOT/'scripts/banana-tripo/static-recipe.json')
        source = env.append_source(recipe['road-module'])
        sampler = env.RoadSampler(source)
        material, report = sampler.bake_material(32, 64)
        self.assertGreaterEqual(report['directCoverage'], .98)
        course = json.loads((env.ROOT/'assets/export/course.json').read_text())
        road_a, guard_a = env.road_strip(sampler, material, course, 0, 80)
        road_b, guard_b = env.road_strip(sampler, material, course, 80, 80)
        self.assertEqual(len(road_a.data.materials), 1)
        self.assertEqual(road_a['surfaceRole'], 'road')
        self.assertEqual(guard_a['surfaceRole'], 'guard')
        # Explicit row indices avoid geometric-nearest ambiguity on a bent route.
        count = road_a['crossSectionVertices']
        self.assertEqual([tuple(v.co) for v in road_a.data.vertices[-count:]],
                         [tuple(v.co) for v in road_b.data.vertices[:count]])
        self.assertTrue(all(abs(v.co.z-env.route_point(course, s)[2])<1e-5
                            for s, row in [(0, road_a.data.vertices[:count]),
                                           (80, road_a.data.vertices[-count:])]
                            for v in row))
        self.assertEqual(report['sourceId'], 'road-module')
        with tempfile.TemporaryDirectory() as directory:
            bpy.ops.object.select_all(action='DESELECT')
            road_a.select_set(True); guard_a.select_set(True)
            bpy.context.view_layer.objects.active = road_a
            path = Path(directory)/'road.glb'
            bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                export_extras=True, export_vertex_color='ACTIVE', export_animations=False)
            doc = env.read_glb(path)
            roles = {node.get('extras', {}).get('surfaceRole') for node in doc['nodes']}
            self.assertTrue({'road', 'guard'}.issubset(roles))
            self.assertEqual(len(doc['meshes']), 2)
            self.assertEqual(len(doc['materials']), 1)
            self.assertTrue(doc['images'][0].get('bufferView') is not None)


if __name__ == '__main__':
    unittest.main(argv=[__file__])
