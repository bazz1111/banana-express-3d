"""Copy completed, explicitly named Tripo downloads into the source ledger."""
import argparse
import hashlib
import json
import shutil
import struct
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--downloads',type=Path,default=Path.home()/'Downloads')
options=parser.parse_args()
def sha256(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

ledger=ROOT/'assets/sources/banana-tripo-v1/manifest.json'
data=json.loads(ledger.read_text())
copied=[]
for asset in data['assets']:
    identifier=asset['id']
    names=[f'Banana_{identifier}_H31_master.glb']
    if identifier=='hero':names.append('Banana_Hero_H31_master.glb')
    if identifier=='bicycle':names.append('Banana_Bicycle_H31_master.glb')
    if identifier=='impact-star':names.append('explosion+burst+3d+model.glb')
    source=next((options.downloads/name for name in names if (options.downloads/name).is_file()),None)
    if source is None:continue
    with source.open('rb') as stream:
        magic,version,size=struct.unpack('<III',stream.read(12))
        if magic!=0x46546c67 or version!=2 or size!=source.stat().st_size:
            raise ValueError('Incomplete GLB download: '+str(source))
        count,kind=struct.unpack('<II',stream.read(8))
        if kind!=0x4e4f534a:raise ValueError('Missing GLB JSON: '+str(source))
        model=json.loads(stream.read(count))
    digest=sha256(source)
    destination=ledger.parent/(identifier+'-master.glb')
    if destination.exists():
        existing=sha256(destination)
        if existing!=digest:raise ValueError('Refusing to replace a different source master: '+str(destination))
    else:
        shutil.copy2(source,destination)
        copied.append(identifier)
    relative=str(destination.relative_to(ROOT))
    asset['sourceFiles']=[entry for entry in asset['sourceFiles'] if entry['file']!=relative]+[
        {'file':relative,'bytes':size,'sha256':digest}]
    asset['masterTriangles']=sum(model['accessors'][p.get('indices',p['attributes']['POSITION'])]['count']//3
        for mesh in model.get('meshes',[]) for p in mesh['primitives'])
    if not asset['status'].startswith('rigged-'):asset['status']='master-downloaded'
ledger.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'copied':copied,'downloaded':sum(bool(a['sourceFiles']) for a in data['assets']),
    'waiting':[a['id'] for a in data['assets'] if not a['sourceFiles']]},ensure_ascii=False),flush=True)
