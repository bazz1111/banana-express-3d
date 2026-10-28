"""Promote visually approved candidates, then export their saved Blender sources.

This never generates geometry or contacts Tripo. Run only after candidate visual
and native checks pass. The raw downloaded masters remain unchanged and local.
"""
import argparse
import json
from pathlib import Path
import shutil
import struct
import subprocess

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--hero-dir',default='artifacts/tripo-hero-bike')
parser.add_argument('--blender',default='/Applications/Blender.app/Contents/MacOS/Blender')
parser.add_argument('--apply',action='store_true',help='Copy candidates and replace canonical exports; otherwise print the plan')
args=parser.parse_args()

def read(path):return json.loads((ROOT/path).read_text())
def glb(path):
    data=(ROOT/path).read_bytes()
    if data[:4]!=b'glTF' or struct.unpack_from('<I',data,8)[0]!=len(data):raise ValueError('Incomplete candidate: '+path)
    doc=json.loads(data[20:20+struct.unpack_from('<I',data,12)[0]])
    return doc,sum(doc['accessors'][p.get('indices',p['attributes']['POSITION'])]['count']//3 for m in doc['meshes'] for p in m['primitives'])

environment=read('artifacts/tripo-environment/report.json')
if environment['status']!='candidate-ready' or not environment['originalInputsUnchanged']:
    raise ValueError('Environment candidate is not verified')
if environment['roadChunkSeamMaxMetres']>1e-5 or environment['roadProjection']['directCoverage']<.98:
    raise ValueError('Environment seam/source paint checks failed')
hero=read(args.hero_dir+'/hero-metadata.json')
if hero['bones']!=65 or hero['runtimeTriangles']>22000 or len(hero['clips'])!=16:
    raise ValueError('Unexpected hero candidate')
ledger=read('assets/sources/banana-tripo-v1/manifest.json')
if len(ledger['assets'])!=29 or any(not item['sourceFiles'] for item in ledger['assets']):raise ValueError('Missing downloaded source category')
old=read('assets/export/manifest.json')
copies={
    'artifacts/tripo-environment/asset-library.blend':'assets/blender/tripo-environment.blend',
    args.hero_dir+'/hero.blend':'assets/blender/tripo/hero.blend',
    'artifacts/tripo-bicycle/bicycle.blend':'assets/blender/tripo/bicycle.blend',
    'artifacts/tripo-cargo/cargo.blend':'assets/blender/tripo-cargo.blend',
    'artifacts/tripo-truck/truck.blend':'assets/blender/tripo-truck.blend',
    'artifacts/tripo-walkers/pedestrian.blend':'assets/blender/tripo-pedestrian.blend',
    'artifacts/tripo-walkers/goat.blend':'assets/blender/tripo-goat.blend',
    'artifacts/tripo-effects/effects.blend':'assets/blender/tripo-effects.blend',
    'artifacts/tripo-pickups/pickups.blend':'assets/blender/tripo-pickups.blend',
}
models={}
def add(name,source,root,candidate,ids,**metadata):
    doc,triangles=glb(candidate)
    if not any(node.get('name')==root for node in doc['nodes']):raise ValueError(name+': missing candidate root '+root)
    if name in ('roadCourse','valley','truck'):
        ids=sorted({node.get('extras',{}).get('sourceId') for node in doc['nodes']
                    if node.get('extras',{}).get('sourceId')})
    models[name]={'file':name+'.glb','source':source,'root':root,'triangles':triangles,'sourceIds':ids,**metadata}

for name,item in read('artifacts/tripo-environment/runtime-map.json').items():
    ids=[environment['models'][name]['sourceId']] if environment['models'][name].get('sourceId') else {
        'roadTile':['road-module'],'roadCourse':['road-module'],
        'valley':['palm','tree','hut','foundation','mountain','cloud'],'sky':[]}[name]
    add(name,copies[item['sourceCandidate']],item['root'],'artifacts/tripo-environment/export/'+name+'.glb',ids)
for name in ['rider','riderSkinned']:
    add(name,'assets/blender/tripo/hero.blend','BananaTripoHero',args.hero_dir+'/riderSkinned.glb',['hero'],
        animations=True,bones=65,clips=[clip['name'] for clip in hero['clips']])
add('bicycle','assets/blender/tripo/bicycle.blend','Bicycle','artifacts/tripo-bicycle/bicycle.glb',['bicycle'])
add('truck','assets/blender/tripo-truck.blend','Truck','artifacts/tripo-truck/truck.glb',['truck','crate'])
for name in ['pedestrian','goat']:
    add(name,'assets/blender/tripo-'+name+'.blend',name.title(),'artifacts/tripo-walkers/'+name+'.glb',[name])
for name in ['banana','bananaB','bananaC','bananaD']:
    add(name,'assets/blender/tripo-cargo.blend',name[0].upper()+name[1:],'artifacts/tripo-cargo/'+name+'.glb',['banana-bunch'])
add('bananaRack','assets/blender/tripo-cargo.blend','CargoAssembly','artifacts/tripo-cargo/bananaRack.glb',['banana-bunch'],
    localFinishing=['Blender tie-down curves'])
for name,root in [('burst','KickBurst'),('burstGlow','KickBurstGlow'),('dust','Dust'),('spark','Spark')]:
    add(name,'assets/blender/tripo-effects.blend',root,'artifacts/tripo-effects/'+name+'.glb',['impact-star'] if name.startswith('burst') else [])
recipe={item['id']:item for item in read('scripts/banana-tripo/static-recipe.json')['assets']}
for name,id in [('looseBanana','banana-single'),*[(key,key) for key in ['boost','shield','double']]]:
    item=recipe[id];add(name,'assets/blender/tripo-pickups.blend',item['root'],'artifacts/tripo-pickups/'+name+'.glb',[id])
for name,id in [(key,key) for key in ['car','crate','barrier','wall','train']]:
    item=recipe[id];add(name,item['native'],item['root'],item['output'],[id])
add('lake','assets/blender/tripo-environment.blend','ValleyWater','artifacts/tripo-environment/export/valley.glb',[])
# lake exports the one saved technical water mesh, rather than the whole valley.
models['lake']['triangles']=None
if set(models)!=set(old['models']):raise ValueError('Incomplete replacement: '+str(sorted(set(models)^set(old['models']))))
for source in copies:
    if not (ROOT/source).is_file():raise FileNotFoundError(source)
source_files=list(dict.fromkeys(item['source'] for item in models.values()))
manifest={'generator':'Tripo H3.1 source masters; local Blender saved-native export','pipeline':'Tripo H3.1 → saved Blender → Three.js',
    'mode':'endless','blenderVersion':'5.2.2 LTS','reference':'assets/reference/style-a-2026-10-28.png',
    'generationLedger':'assets/sources/banana-tripo-v1/manifest.json','sourceFiles':source_files,
    'functionalSurfaces':['continuous terrain and water','unit sky sphere','transient dust/spark particle carriers'],
    'forestLODs':{'near':796,'mid':94,'far':20},'models':models}
print(json.dumps({'apply':args.apply,'models':len(models),'sourceFiles':source_files,'copyCandidates':copies},indent=2))
if not args.apply:raise SystemExit(0)
for source,target in copies.items():
    (ROOT/target).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/source,ROOT/target)
manifest_path=ROOT/'assets/export/manifest.json'
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
subprocess.run([args.blender,'--background','--factory-startup','--python-exit-code','1','--python','scripts/export-saved-assets.py'],cwd=ROOT,check=True)
for name,item in models.items():
    _,count=glb('assets/export/'+item['file'])
    if item['triangles'] is not None and count!=item['triangles']:raise ValueError('Saved native/export triangles changed: '+name)
    item['triangles']=count
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
for asset in ledger['assets']:
    asset['runtimeFiles']=['public/assets/'+item['file'] for item in models.values() if asset['id'] in item['sourceIds']]
    asset['status']='integrated-saved-native'
(ROOT/'assets/sources/banana-tripo-v1/manifest.json').write_text(json.dumps(ledger,indent=2,ensure_ascii=False)+'\n')
def portable(value):
    if isinstance(value,str):return value.replace(str(ROOT)+'/','')
    if isinstance(value,list):return [portable(item) for item in value]
    if isinstance(value,dict):return {key:portable(item) for key,item in value.items()}
    return value
(ROOT/'assets/export/hero-metadata.json').write_text(json.dumps(portable(hero),indent=2)+'\n')
print('TRIPO_INTEGRATION_PASS',len(models),'saved native models')
