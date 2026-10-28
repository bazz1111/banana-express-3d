"""Headless codec/layout regression for the production hero texture preparation."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BLENDER = os.environ.get('BLENDER_BIN') or shutil.which('blender') or '/Applications/Blender.app/Contents/MacOS/Blender'


class HeroTextureTest(unittest.TestCase):
    def test_preserves_jpeg_and_png_layout_and_the_packed_native_encoding(self):
        with tempfile.TemporaryDirectory(prefix='tripo-hero-texture-', dir=ROOT / 'artifacts') as directory:
            directory = Path(directory)
            script = directory / 'verify.py'
            script.write_text(r'''
import bpy, hashlib, importlib.util, json, struct, sys
from pathlib import Path
repo, output = map(Path, sys.argv[-2:])
spec = importlib.util.spec_from_file_location('hero', repo / 'scripts/banana-tripo/prepare-hero.py')
hero = importlib.util.module_from_spec(spec); spec.loader.exec_module(hero)
palette = [(.8,.2,.1,1),(.1,.7,.2,1),(.15,.3,.8,1),(.8,.7,.1,1)]
for format, extension, mime in [('JPEG','jpg','image/jpeg'),('PNG','png','image/png')]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    image = bpy.data.images.new('source_'+format, width=128, height=64, alpha=format=='PNG')
    pixels = []
    for y in range(64):
        for x in range(128):
            color = palette[(x>=64)+2*(y>=32)]
            pixels.extend(color[:3] + ((.35 if format=='PNG' else 1.),))
    image.pixels.foreach_set(pixels); image.file_format = format
    source = output / ('source.'+extension); image.filepath_raw = str(source); image.save(quality=90)
    original = source.read_bytes(); image.pack(data=original, data_len=len(original))
    bpy.ops.mesh.primitive_plane_add(); mesh=bpy.context.object
    original_positions = [tuple(vertex.co) for vertex in mesh.data.vertices]
    original_uvs = [tuple(loop.uv) for loop in mesh.data.uv_layers.active.data]
    material=bpy.data.materials.new('source_material');material.use_nodes=True
    shader=material.node_tree.nodes.get('Principled BSDF');texture=material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=image
    material.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color']);mesh.data.materials.append(material)
    reports = hero.base_color(bpy, mesh, output, 64)
    assert image.file_format==format, 'opaque JPEG expanded to '+image.file_format
    assert tuple(image.size)==(64,32), tuple(image.size)
    assert image.filepath.endswith('.'+extension), image.filepath
    assert source.read_bytes()==original, 'source image was overwritten'
    assert [tuple(vertex.co) for vertex in mesh.data.vertices]==original_positions
    assert [tuple(loop.uv) for loop in mesh.data.uv_layers.active.data]==original_uvs
    native=output/(format+'.blend');bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(native))
    glb=output/(format+'.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB')
    blob=glb.read_bytes();n=struct.unpack_from('<I',blob,12)[0];document=json.loads(blob[20:20+n]);binary=blob[28+n:]
    assert len(document['images'])==1 and document['images'][0]['mimeType']==mime, document.get('images')
    view=document['bufferViews'][document['images'][0]['bufferView']]
    encoded=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
    assert encoded.startswith(bytes.fromhex('ffd8' if format=='JPEG' else '89504e47')), encoded[:8]
    bpy.ops.wm.open_mainfile(filepath=str(native))
    packed=next(image for image in bpy.data.images if image.name.startswith('source_'))
    assert packed.packed_file and packed.packed_file.data==encoded, 'native and GLB use different image encoding'
    assert packed.file_format==format and tuple(packed.size)==(64,32)
    for (x,y), expected in zip([(16,8),(48,8),(16,24),(48,24)],palette):
        actual=packed.pixels[(y*64+x)*4:(y*64+x)*4+4]
        assert max(abs(actual[i]-expected[i]) for i in range(3))<.06, (format,x,y,actual,expected)
        assert abs(actual[3]-(.35 if format=='PNG' else 1.))<.02, actual
    print('HERO_TEXTURE_CODEC_PASS',format,len(encoded),reports,flush=True)
''')
            result = subprocess.run([BLENDER, '--background', '--factory-startup', '--python-exit-code', '1',
                                     '--python', str(script), '--', str(ROOT), str(directory)],
                                    capture_output=True, text=True, timeout=90)
            self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
            self.assertIn('HERO_TEXTURE_CODEC_PASS JPEG', result.stdout)
            self.assertIn('HERO_TEXTURE_CODEC_PASS PNG', result.stdout)
            print(result.stdout)


if __name__ == '__main__':
    unittest.main()
