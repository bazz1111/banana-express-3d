"""Headless integration checks; writes fixtures only under artifacts/."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest


ROOT=Path(__file__).resolve().parents[1]
TOOL=ROOT/'scripts/banana-tripo/prepare-static.py'
BLENDER=os.environ.get('BLENDER_BIN') or shutil.which('blender') or '/Applications/Blender.app/Contents/MacOS/Blender'


def glb(path):
    data=path.read_bytes()
    length=struct.unpack_from('<I',data,12)[0]
    return json.loads(data[20:20+length]),data[28+length:]


class StaticPreparationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT/'artifacts').mkdir(exist_ok=True)
        cls.temporary=tempfile.TemporaryDirectory(prefix='tripo-static-test-',dir=ROOT/'artifacts')
        cls.directory=Path(cls.temporary.name)
        fixture=cls.directory/'fixture.py'
        fixture.write_text('''
import bpy, sys
from pathlib import Path
root=Path(sys.argv[-1])
bpy.ops.wm.read_factory_settings(use_empty=True)
color=bpy.data.images.new('baseColor',width=64,height=32)
color.pixels.foreach_set([.25,.5,.75,1.]*(64*32))
color.file_format='JPEG';color.filepath_raw=str(root/'source-basecolor.jpg');color.save()
encoded=(root/'source-basecolor.jpg').read_bytes();color.pack(data=encoded,data_len=len(encoded))
unused=bpy.data.images.new('roughMetalNormal',width=32,height=32)
unused.pixels.foreach_set([.5,.5,1.,1.]*(32*32));unused.pack()
for index,x in enumerate([-2,2]):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=(x,0,0))
    obj=bpy.context.object;obj.name='source_part_'+str(index)
    mat=bpy.data.materials.new('source_material_'+str(index));mat.use_nodes=True
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    albedo=mat.node_tree.nodes.new('ShaderNodeTexImage');albedo.image=color
    mat.node_tree.links.new(albedo.outputs['Color'],shader.inputs['Base Color'])
    extra=mat.node_tree.nodes.new('ShaderNodeTexImage');extra.image=unused
    mat.node_tree.links.new(extra.outputs['Color'],shader.inputs['Roughness'])
    mat.node_tree.links.new(extra.outputs['Color'],shader.inputs['Metallic'])
    normal=mat.node_tree.nodes.new('ShaderNodeNormalMap')
    mat.node_tree.links.new(extra.outputs['Color'],normal.inputs['Color'])
    mat.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal'])
    obj.data.materials.append(mat)
bpy.ops.export_scene.gltf(filepath=str(root/'static-master.glb'),export_format='GLB',export_extras=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.object.armature_add()
rig=bpy.context.object
bpy.ops.mesh.primitive_cube_add()
mesh=bpy.context.object;group=mesh.vertex_groups.new(name=rig.data.bones[0].name)
group.add(list(range(len(mesh.data.vertices))),1.,'REPLACE')
modifier=mesh.modifiers.new('skin','ARMATURE');modifier.object=rig
mesh.parent=rig
bpy.ops.export_scene.gltf(filepath=str(root/'skinned-master.glb'),export_format='GLB',export_skins=True)
''')
        cls.blender_script(fixture,[str(cls.directory)])

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    @classmethod
    def blender_script(cls,script,arguments):
        result=subprocess.run([BLENDER,'--background','--factory-startup','--python-exit-code','1',
            '--python',str(script),'--',*arguments],capture_output=True,text=True,timeout=90)
        if result.returncode:
            raise AssertionError(result.stdout+'\n'+result.stderr)
        return result

    def recipe(self,**changes):
        item={'id':'fixture','source':str(self.directory/'static-master.glb'),'root':'StaticFixture',
            'rotationDegrees':[0,0,90],'targetDimensions':[2,4,3],'triangleBudget':300,'textureSize':16,
            'native':str(self.directory/'prepared.blend'),'output':str(self.directory/'prepared.glb')}
        item.update(changes)
        return item

    def invoke(self,assets,only=None):
        recipe=self.directory/'recipe.json'
        recipe.write_text(json.dumps({'assets':assets}))
        arguments=['--recipe',str(recipe)]
        if only:
            arguments+=['--only',only]
        return subprocess.run([BLENDER,'--background','--factory-startup','--python-exit-code','1',
            '--python',str(TOOL),'--',*arguments],capture_output=True,text=True,timeout=90)

    def test_prepares_real_meshes_and_packed_texture_without_changing_source(self):
        source=self.directory/'static-master.glb'
        before=hashlib.sha256(source.read_bytes()).hexdigest()
        pending=self.recipe(id='not-arrived',source=str(self.directory/'missing.glb'),
            native=str(self.directory/'pending.blend'),output=str(self.directory/'pending.glb'))
        result=self.invoke([self.recipe(),pending],only='fixture')
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)
        doc,binary=glb(self.directory/'prepared.glb')
        self.assertFalse(doc.get('skins'))
        self.assertFalse(doc.get('animations'))
        self.assertEqual(len(doc['meshes']),1)
        self.assertEqual(len(doc['materials']),2)
        triangles=0
        for primitive in doc['meshes'][0]['primitives']:
            self.assertIn('TEXCOORD_0',primitive['attributes'])
            self.assertIn('COLOR_0',primitive['attributes'])
            triangles+=doc['accessors'][primitive['indices']]['count']//3
            color=doc['accessors'][primitive['attributes']['COLOR_0']]
            view=doc['bufferViews'][color['bufferView']]
            kind,white={5121:('B',255),5123:('H',65535),5126:('f',1.)}[color['componentType']]
            components={'VEC3':3,'VEC4':4}[color['type']]
            format='<'+kind*components
            stride=view.get('byteStride',struct.calcsize(format))
            offset=view.get('byteOffset',0)+color.get('byteOffset',0)
            for index in range(color['count']):
                self.assertTrue(all(abs(value-white)<1e-6 for value in struct.unpack_from(format,binary,offset+index*stride)))
        self.assertTrue(0<triangles<=300,triangles)
        for material in doc['materials']:
            pbr=material['pbrMetallicRoughness']
            self.assertIn('baseColorTexture',pbr)
            self.assertNotIn('metallicRoughnessTexture',pbr)
            self.assertNotIn('normalTexture',material)
            self.assertNotIn('occlusionTexture',material)
            self.assertEqual(pbr.get('metallicFactor',1),0)
            self.assertAlmostEqual(pbr.get('roughnessFactor',1),.85,places=5)
        self.assertEqual(len(doc['images']),1)
        for image in doc['images']:
            view=doc['bufferViews'][image['bufferView']]
            encoded=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
            # Opaque Tripo JPEGs must stay JPEG after resize; forcing PNG here
            # made a 900-triangle rock exceed 1.5 MB just for its 1K texture.
            self.assertEqual(image['mimeType'],'image/jpeg')
            self.assertEqual(encoded[:2],b'\xff\xd8')
        root=next(node for node in doc['nodes'] if node['name']=='StaticFixture')
        self.assertEqual(root['extras']['sourceId'],'fixture')
        self.assertEqual(root['extras']['provider'],'Tripo')
        self.assertEqual(root['extras']['model'],'H3.1')
        self.assertEqual(root['extras']['sourceSha256'],before)
        self.assertEqual(root['extras']['triangles'],triangles)
        self.assertGreater(root['extras']['sourceTriangles'],triangles)
        report=json.loads(next(line.removeprefix('TRIPO_STATIC_REPORT ') for line in result.stdout.splitlines()
            if line.startswith('TRIPO_STATIC_REPORT ')))
        self.assertEqual(report['outputBytes'],(self.directory/'prepared.glb').stat().st_size)
        self.assertEqual(report['nativeBytes'],(self.directory/'prepared.blend').stat().st_size)
        self.assertEqual(report['triangles'],triangles)
        for actual,want in zip(report['boundsBlender']['dimensions'],[2,4,3]):
            self.assertAlmostEqual(actual,want,places=5)
        print('STATIC_FIXTURE_RESULT '+json.dumps({key:report[key] for key in [
            'sourceTriangles','triangles','sourceBytes','nativeBytes','outputBytes','boundsBlender','textures']}),flush=True)
        verify=self.directory/'verify.py'
        verify.write_text('''
import bpy, sys
from pathlib import Path
bpy.ops.wm.open_mainfile(filepath=str(Path(sys.argv[-1])/'prepared.blend'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
assert len(meshes)==1
mesh=meshes[0];root=bpy.data.objects['StaticFixture']
from collections import Counter
edges=Counter(tuple(sorted((a,b))) for face in mesh.data.polygons
              for a,b in zip(face.vertices,list(face.vertices[1:])+[face.vertices[0]]))
assert all(count==2 for count in edges.values()),'Reduction opened cracks along source UV seams'
assert mesh.parent==root and not mesh.modifiers
assert tuple(root.location)==(0.,0.,0.)
points=[mesh.matrix_world@v.co for v in mesh.data.vertices]
lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
assert all(abs(hi[i]-lo[i]-want)<1e-5 for i,want in enumerate([2,4,3])),(lo,hi)
assert abs(lo[0]+hi[0])<1e-5 and abs(lo[1]+hi[1])<1e-5 and abs(lo[2])<1e-5,(lo,hi)
centres=[sum(p.center.y for p in mesh.data.polygons if p.material_index==i)/sum(p.material_index==i for p in mesh.data.polygons) for i in [0,1]]
assert centres[0]<-1 and centres[1]>1,centres
assert mesh.data.uv_layers.active and len(mesh.data.uv_layers.active.data)==len(mesh.data.loops)
assert max(uv.uv.x for uv in mesh.data.uv_layers.active.data)-min(uv.uv.x for uv in mesh.data.uv_layers.active.data)>.5
colors=mesh.data.color_attributes['Color']
assert all(all(abs(channel-1)<1e-5 for channel in item.color) for item in colors.data)
assert len(bpy.data.images)==1
assert all(image.packed_file and tuple(image.size)==(16,8) for image in bpy.data.images)
assert all(abs(actual-want)<.03 for image in bpy.data.images for actual,want in zip(image.pixels[:4],[.25,.5,.75,1.])),[tuple(image.pixels[:4]) for image in bpy.data.images]
print('REOPEN_STATIC_NATIVE_PASS')
''')
        reopened=self.blender_script(verify,[str(self.directory)])
        self.assertIn('REOPEN_STATIC_NATIVE_PASS',reopened.stdout)

    def test_missing_source_is_a_failure_and_does_not_fabricate_outputs(self):
        item=self.recipe(source=str(self.directory/'not-generated.glb'),
            native=str(self.directory/'missing.blend'),output=str(self.directory/'missing-output.glb'))
        result=self.invoke([item])
        self.assertNotEqual(result.returncode,0)
        self.assertIn('not-generated.glb',result.stdout+result.stderr)
        self.assertFalse(Path(item['native']).exists())
        self.assertFalse(Path(item['output']).exists())

    def test_skin_is_rejected_before_export(self):
        item=self.recipe(source=str(self.directory/'skinned-master.glb'),
            native=str(self.directory/'skin.blend'),output=str(self.directory/'skin.glb'))
        source=Path(item['source']);before=hashlib.sha256(source.read_bytes()).hexdigest()
        result=self.invoke([item])
        self.assertNotEqual(result.returncode,0)
        self.assertIn('rejects skin',result.stdout+result.stderr)
        self.assertFalse(Path(item['native']).exists())
        self.assertFalse(Path(item['output']).exists())
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)

    def test_source_cannot_be_used_as_output(self):
        source=self.directory/'static-master.glb';before=source.read_bytes()
        result=self.invoke([self.recipe(output=str(source))])
        self.assertNotEqual(result.returncode,0)
        self.assertIn('overwrite source',result.stdout+result.stderr)
        self.assertEqual(source.read_bytes(),before)

    def test_hardlinked_source_cannot_be_used_as_output(self):
        source=self.directory/'protected-master.glb'
        shutil.copyfile(self.directory/'static-master.glb',source)
        alias=self.directory/'protected-alias.glb'
        os.link(source,alias)
        before=source.read_bytes()
        result=self.invoke([self.recipe(source=str(source),output=str(alias),
            native=str(self.directory/'protected.blend'))])
        self.assertNotEqual(result.returncode,0)
        self.assertIn('overwrite source',result.stdout+result.stderr)
        self.assertEqual(source.read_bytes(),before)


if __name__=='__main__':
    unittest.main(verbosity=2)
