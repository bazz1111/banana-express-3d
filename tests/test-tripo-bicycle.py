"""Headless checks for the local Tripo bicycle candidate; no canonical writes."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import struct
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/banana-tripo/prepare-bicycle.py'
MASTER=ROOT/'assets/sources/banana-tripo-v1/bicycle-master.glb'
BLENDER=os.environ.get('BLENDER_BIN') or shutil.which('blender') or '/Applications/Blender.app/Contents/MacOS/Blender'


def document(path):
    data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0]
    return json.loads(data[20:20+length]),data[28+length:]


class BicycleMasksTest(unittest.TestCase):
    def test_masks_leave_fenders_and_chaincase_fixed_and_select_real_moving_parts(self):
        self.assertTrue(SCRIPT.exists(),'Missing bicycle preparation tool')
        module=runpy.run_path(str(SCRIPT),run_name='bicycle_masks_test')
        classify=module['source_role']
        for point,want in [
            ((-.276,.003,.003),'WheelRear'),((-.276,.003,.459),'RearFender'),
            ((.329,-.042,.002),'WheelFront'),((.329,-.042,.472),'FrontFender'),
            ((0,0,.50),'FrameFixed'),((-.10,-.06,.19),'FrameFixed'),
            ((.068,-.13,.12),'Pedal_L'),((.05,.10,.278),'Pedal_R'),
            ((.03,-.07,.16),'Crank_L'),
        ]:
            self.assertEqual(classify(point),want,(point,want))
        # Measured chrome tail of the real front mudguard, behind the tire.
        # A broad front-fork fallback previously moved it through the tire.
        self.assertEqual(classify((.170100,.072156,.250507),.592),'FrontFender')
        self.assertEqual(classify((.022482,-.087708,.584350)),'HandlebarFixed')
        self.assertEqual(classify((.082297,.106560,.274591),.8),'Pedal_R')
        self.assertEqual(classify((.436163,-.126436,.363516),0),'WheelFront')
        self.assertEqual(classify((.143404,.014117,.369539),.7),'FrameFixed')
        self.assertEqual(classify((.288060,.010937,.421316),.1),'FrontFork')
        self.assertEqual(classify((.243904,.036048,.354720),.1),'FrontFork')
        self.assertEqual(classify((-.080881,.030127,.253452),.1),'FrameFixed')


class BicycleIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        folder=ROOT/'artifacts/tripo-bicycle';folder.mkdir(parents=True,exist_ok=True)
        cls.temporary=tempfile.TemporaryDirectory(prefix='test-',dir=folder)
        cls.output=Path(cls.temporary.name)
        cls.protected={MASTER:hashlib.sha256(MASTER.read_bytes()).hexdigest()}
        cls.result=subprocess.run([BLENDER,'--background','--factory-startup','--python-exit-code','1',
            '--python',str(SCRIPT),'--','--master',str(MASTER),'--output-dir',str(cls.output)],
            capture_output=True,text=True,timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def built(self):
        self.assertEqual(self.result.returncode,0,self.result.stdout+'\n'+self.result.stderr)

    def test_exports_actual_source_parts_under_budget_with_2k_color_and_provenance(self):
        self.built()
        for file,digest in self.protected.items():
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),digest)
        doc,binary=document(self.output/'bicycle.glb')
        names={node.get('name') for node in doc['nodes']}
        self.assertTrue({'Bicycle','FrameFixed','WheelFront','WheelRear','Crank','Pedal_L','Pedal_R',
            'CargoRopes','RiderPedal_L','RiderPedal_R','RiderGrip_L','RiderGrip_R',
            'RiderStand_L','RiderStand_R','RiderSeat','CargoMount'}<=names,names)
        count=sum(doc['accessors'][primitive['indices']]['count']//3 for mesh in doc['meshes'] for primitive in mesh['primitives'])
        self.assertTrue(10000<count<=24000,count)
        root=next(node for node in doc['nodes'] if node.get('name')=='Bicycle')
        self.assertEqual(root['extras']['provider'],'Tripo')
        self.assertEqual(root['extras']['model'],'H3.1')
        self.assertEqual(root['extras']['sourceSha256'],self.protected[MASTER])
        self.assertEqual(root['extras']['triangles'],count)
        self.assertFalse(doc.get('skins'))
        self.assertEqual(len(doc['materials']),1)
        self.assertEqual(len(doc['images']),1)
        self.assertEqual(doc['images'][0]['mimeType'],'image/jpeg')
        for mesh in doc['meshes']:
            for primitive in mesh['primitives']:
                self.assertIn('TEXCOORD_0',primitive['attributes'])
                self.assertIn('COLOR_0',primitive['attributes'])
        report=json.loads((self.output/'report.json').read_text())
        self.assertEqual(report['triangles'],count)
        self.assertEqual(report['sourceFaceCount'],report['assignedFaceCount'])
        self.assertGreater(report['parts']['WheelFront']['triangles'],1000)
        self.assertGreater(report['parts']['WheelRear']['triangles'],1000)
        self.assertGreater(report['parts']['Crank']['triangles'],20)
        self.assertGreater(report['fenderReclassifiedFaces'],20)
        for name in ['WheelFront','WheelRear']:
            repair=report['operations']['wheelRepairs'][name]
            self.assertGreater(repair['sourceSectorFaces'],100)
            self.assertLess(repair['sourceSectorFaces'],repair['sourceFacesBeforeRepair'])

    def test_wheels_are_round_and_rotate_without_moving_fixed_fenders(self):
        self.built()
        self.verify('spin',r'''
from mathutils import Vector
from mathutils.bvhtree import BVHTree
fixed=bpy.data.objects['FrameFixed']
baseline=[fixed.matrix_world@v.co for v in fixed.data.vertices]
assert report['fixedSeamMaxSpread']<1e-4
assert min((fixed.data.vertices[e.vertices[0]].co-fixed.data.vertices[e.vertices[1]].co).length for e in fixed.data.edges)>1e-7
neighbors=[[] for _ in fixed.data.vertices]
for edge in fixed.data.edges:
    a,b=edge.vertices;neighbors[a].append(b);neighbors[b].append(a)
labels={};components=[]
for vertex in fixed.data.vertices:
    if vertex.index in labels:continue
    tag=len(components);todo=[vertex.index];labels[vertex.index]=tag;component=[]
    while todo:
        a=todo.pop();component.append(a)
        for b in neighbors[a]:
            if b not in labels:labels[b]=tag;todo.append(b)
    components.append(component)
face_counts=[0]*len(components)
for polygon in fixed.data.polygons:face_counts[labels[polygon.vertices[0]]]+=1
assert all(count>=100 for count in face_counts),('Detached fusion shards remain',face_counts)
frame_tree=BVHTree.FromPolygons([v.co for v in fixed.data.vertices],[list(p.vertices) for p in fixed.data.polygons])
assert frame_tree.ray_cast(Vector((2,-.05,.65)),Vector((-1,0,0)))[0] is None,'Main frame negative space was filled'
for name,want_y in [('WheelRear',.58),('WheelFront',-.64)]:
    wheel=bpy.data.objects[name]
    assert wheel.type=='MESH' and abs(wheel.location.y-want_y)<.005 and abs(wheel.location.z-.36)<.01
    assert abs(wheel.location.x)<.005 and tuple(wheel.scale)==(1.,1.,1.)
    assert all(abs(angle)<1e-6 for angle in wheel.rotation_euler)
    radii=[(v.co.y*v.co.y+v.co.z*v.co.z)**.5 for v in wheel.data.vertices]
    assert .355<=max(radii)<=.365,(name,max(radii))
    profile=[0.]*36
    for vertex,radius in zip(wheel.data.vertices,radii):
        angle=math.atan2(vertex.co.z,vertex.co.y)%(2*math.pi)
        index=min(35,int(angle/(2*math.pi)*36));profile[index]=max(profile[index],radius)
    assert min(profile)>.348,(name,min(profile))
    wheel_tree=BVHTree.FromPolygons([v.co for v in wheel.data.vertices],[list(p.vertices) for p in wheel.data.polygons])
    openings=0
    for step in range(20):
        angle=(step+.37)/20*2*math.pi
        if wheel_tree.ray_cast(Vector((1,.2*math.cos(angle),.2*math.sin(angle))),Vector((-1,0,0)))[0] is None:openings+=1
    assert openings>=8,(name,'spoke negative space',openings)
    original=[wheel.matrix_world@v.co for v in wheel.data.vertices]
    wheel.rotation_euler.x=math.pi/2;bpy.context.view_layer.update()
    moved=[wheel.matrix_world@v.co for v in wheel.data.vertices]
    assert max((a-b).length for a,b in zip(original,moved))>.3
    assert all((a-fixed.matrix_world@v.co).length<1e-7 for a,v in zip(baseline,fixed.data.vertices))
    wheel.rotation_euler.x=2*math.pi;bpy.context.view_layer.update()
    assert max((a-wheel.matrix_world@v.co).length for a,v in zip(original,wheel.data.vertices))<1e-6
    wheel.rotation_euler.x=0
assert report['fixedFenderFaces']>50
assert report['clearance']['outerWheelFrameMin']>=.001,report['clearance']
''')

    def test_real_surface_markers_follow_pedals_and_report_contact_residuals(self):
        self.built()
        self.verify('markers',r'''
from mathutils import Vector
from mathutils.bvhtree import BVHTree
frame=bpy.data.objects['FrameFixed']
tree=BVHTree.FromPolygons([frame.matrix_world@v.co for v in frame.data.vertices],[list(p.vertices) for p in frame.data.polygons])
for name in ['RiderSeat','RiderGrip_L','RiderGrip_R','RiderStand_L','RiderStand_R','CargoMount']:
    marker=bpy.data.objects[name];nearest=tree.find_nearest(marker.matrix_world.translation)
    assert nearest and nearest[3]<.003,(name,nearest)
assert .85<bpy.data.objects['RiderSeat'].matrix_world.translation.z<1.03
assert .95<bpy.data.objects['RiderStand_L'].matrix_world.translation.z<1.15
assert report['operations']['preserveSourceProportions'] is True
assert abs(bpy.data.objects['RiderStand_R'].matrix_world.translation.x-.04)<.005
assert report['markers']['RiderStand_R']['target']==[.04,.21,1.115]
cargo=bpy.data.objects['CargoMount'].matrix_world.translation
assert abs(cargo.x)<.13 and .4<cargo.y<.9 and .72<cargo.z<.92,tuple(cargo)
crank=bpy.data.objects['Crank'];old=[]
for tag in ['L','R']:
    marker=bpy.data.objects['RiderPedal_'+tag];pedal=bpy.data.objects['Pedal_'+tag]
    assert marker.parent==pedal and pedal.parent==crank
    old.append(marker.matrix_world.translation.copy())
crank.rotation_euler.x=math.pi/2
for tag in ['L','R']:bpy.data.objects['Pedal_'+tag].rotation_euler.x=-math.pi/2
bpy.context.view_layer.update()
for tag,prior in zip(['L','R'],old):
    marker=bpy.data.objects['RiderPedal_'+tag]
    assert (marker.matrix_world.translation-prior).length>.15
    assert abs((marker.matrix_world.to_quaternion()@Vector((0,0,1))).z-1)<1e-6
for name,entry in report['markers'].items():
    if entry.get('target'):
        expected=[a-b for a,b in zip(entry['position'],entry['target'])]
        assert all(abs(a-b)<1e-6 for a,b in zip(expected,entry['residual'])),name
assert bpy.data.objects['CargoRopes'].type=='EMPTY' and not bpy.data.objects['CargoRopes'].children
images=list(bpy.data.images)
assert len(images)==1 and tuple(images[0].size)==(2048,2048) and images[0].packed_file
for obj in bpy.context.scene.objects:
    if obj.type=='MESH':
        assert obj.data.uv_layers.active
        assert all(all(abs(channel-1)<1e-6 for channel in color.color) for color in obj.data.color_attributes['Color'].data)
''')

    def verify(self,name,checks):
        file=self.output/('verify-'+name+'.py')
        file.write_text("import bpy,json,math\nfrom pathlib import Path\nfolder=Path(__file__).resolve().parent\n"
            "bpy.ops.wm.open_mainfile(filepath=str(folder/'bicycle.blend'))\n"
            "report=json.loads((folder/'report.json').read_text())\n"+checks+"\nprint('BICYCLE_"+name.upper()+"_PASS')\n")
        result=subprocess.run([BLENDER,'--background','--factory-startup','--python-exit-code','1','--python',str(file)],
            capture_output=True,text=True,timeout=90)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)


if __name__=='__main__':
    unittest.main(verbosity=2)
