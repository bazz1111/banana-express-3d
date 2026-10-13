"""Independent, read-only exact piecewise-planar support review of saved sources."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/scenery-support-report.json'
report = {'scope': 'Saved native Blender terrain and complete occupied rectangles / cliff bottom caps; exact planar clipping, not nine point sampling.', 'sources': []}

def area(poly):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))*.5 if len(poly)>2 else 0

def clip(poly, value):
    out=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        fa,fb=value(a),value(b)
        ina,inb=fa>=-1e-9,fb>=-1e-9
        if ina:out.append(a)
        if ina!=inb:
            t=fa/(fa-fb)
            out.append(tuple(a[i]+(b[i]-a[i])*t for i in range(len(a))))
    return out

def triangles(obj):
    obj.data.calc_loop_triangles()
    return [[tuple(obj.matrix_world@obj.data.vertices[i].co) for i in t.vertices] for t in obj.data.loop_triangles]

def terrain(objects):
    result=[]
    for obj in objects:
        for tri in triangles(obj):
            bbox=(min(p[0] for p in tri),max(p[0] for p in tri),min(p[1] for p in tri),max(p[1] for p in tri))
            result.append((tri,bbox))
    return result

def bbox_overlap(a,b):
    return a[0]<=b[1]+1e-8 and a[1]>=b[0]-1e-8 and a[2]<=b[3]+1e-8 and a[3]>=b[2]-1e-8

def full_foundation(base,land):
    inv=base.matrix_world.inverted()
    corners=[base.matrix_world@Vector((x,y,0)) for x in (-.5,.5) for y in (-.5,.5)]
    bbox=(min(p.x for p in corners),max(p.x for p in corners),min(p.y for p in corners),max(p.y for p in corners))
    heights=[];coverage=0;patches=0
    for tri,tbox in land:
        if not bbox_overlap(bbox,tbox):continue
        poly=[]
        for p in tri:
            local=inv@Vector(p);poly.append((local.x,local.y,p[2]))
        for axis,sign in ((0,1),(0,-1),(1,1),(1,-1)):
            if not poly:break
            poly=clip(poly,lambda p,axis=axis,sign=sign:.5-sign*p[axis])
        clipped_area=area(poly)
        if clipped_area>1e-10:
            coverage+=clipped_area;heights.extend(p[2] for p in poly);patches+=1
    bottom=(base.matrix_world@Vector((0,0,0))).z
    top=(base.matrix_world@Vector((0,0,1))).z
    building=bpy.data.objects[base['building']]
    building_corners=[building.matrix_world@Vector(c) for c in building.bound_box]
    local_building=[inv@p for p in building_corners]
    footprint_inside=all(abs(p.x)<=.5+1e-5 and abs(p.y)<=.5+1e-5 for p in local_building)
    result={'name':base.name,'building':building.name,'patches':patches,'fullCoverage':coverage,'bottom':bottom,'top':top,'buildingBaseError':abs(building.matrix_world.translation.z-top),'buildingBoundsInsideFoundation':footprint_inside,
        'heightMin':min(heights) if heights else None,'heightMax':max(heights) if heights else None,
        'minTopClearance':top-max(heights) if heights else None,'minBottomEmbed':min(heights)-bottom if heights else None}
    result['pass']=bool(heights) and abs(coverage-1)<2e-4 and result['minTopClearance']>=-2e-4 and result['minBottomEmbed']>=-2e-4 and result['buildingBaseError']<2e-4 and footprint_inside
    return result

def plane_height(tri,x,y):
    a,b,c=tri
    det=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1])
    u=((x-a[0])*(c[1]-a[1])-(y-a[1])*(c[0]-a[0]))/det
    v=((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))/det
    return a[2]+u*(b[2]-a[2])+v*(c[2]-a[2])

def full_cliff_bottom(obj,land):
    obj.data.calc_loop_triangles()
    cap_count=int(obj.get('groundCapVertices',12))
    assert cap_count>=3, ('Invalid closed rock footprint',obj.name)
    caps=[t for t in obj.data.loop_triangles if all(i<cap_count for i in t.vertices)]
    expected=coverage=0;gaps=[];patches=0
    for t in caps:
        bottom=[tuple(obj.matrix_world@obj.data.vertices[i].co) for i in t.vertices]
        expected+=area(bottom)
        bbox=(min(p[0] for p in bottom),max(p[0] for p in bottom),min(p[1] for p in bottom),max(p[1] for p in bottom))
        for tri,tbox in land:
            if not bbox_overlap(bbox,tbox):continue
            poly=bottom[:]
            signed=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(tri,tri[1:]+tri[:1]))
            sign=1 if signed>0 else -1
            for a,b in zip(tri,tri[1:]+tri[:1]):
                if not poly:break
                poly=clip(poly,lambda p,a=a,b=b,sign=sign:sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])))
            clipped_area=area(poly)
            if clipped_area>1e-9:
                coverage+=clipped_area;patches+=1
                gaps.extend(p[2]-plane_height(tri,p[0],p[1]) for p in poly)
    result={'name':obj.name,'bottomCapTriangles':len(caps),'patches':patches,'projectedBottomArea':expected,'coveredArea':coverage,'coverageFraction':coverage/expected if expected else 0,'maxBottomGap':max(gaps) if gaps else None,'minBottomGap':min(gaps) if gaps else None}
    result['pass']=bool(gaps) and len(caps)==cap_count-2 and abs(coverage/expected-1)<2e-4 and max(gaps)<-.1498
    return result

for source,root_name in [('endless-course.blend','EndlessRoadCourse'),('valley-layout.blend','EndlessValley')]:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blender'/source));bpy.context.view_layer.update()
    root=bpy.data.objects[root_name]
    all_objects=[]
    def visit(obj):
        all_objects.append(obj)
        for child in obj.children:visit(child)
    visit(root)
    grounds=[o for o in all_objects if o.type=='MESH' and (o.get('surfaceRole')=='terrain' or o.name=='ValleyTerrain')]
    land=terrain(grounds)
    bases=[o for o in all_objects if o.type=='MESH' and o.get('building')]
    cliffs=[o for o in all_objects if o.type=='MESH' and (o.get('kind')=='cliff' or str(o.get('kind','')) in ['rock'+chr(65+i) for i in range(6)])]
    distant_hills=[o for o in all_objects if o.type=='MESH' and o.parent and o.parent.name in ('ValleyFoothills','ValleyFoothillsB')]
    distant_land=terrain(distant_hills)
    hill_land={o.name:terrain([o]) for o in distant_hills}
    foundations=[]
    for base in bases:
        source_hill=base.get('groundSource')
        result=full_foundation(base,hill_land[source_hill] if source_hill else land)
        if source_hill:
            # The chosen hill must cover the complete footprint, and the plinth must
            # also clear every overlapping hill surface in the native panorama.
            overlay=full_foundation(base,distant_land)
            result['groundSource']=source_hill;result['overlayTopClearance']=overlay['minTopClearance']
            result['pass']=result['pass'] and overlay['minTopClearance'] is not None and overlay['minTopClearance']>=-2e-4
        foundations.append(result)
    cliff_bases=[full_cliff_bottom(o,land) for o in cliffs]
    entry={'file':source,'terrainTriangles':len(land),'foundations':foundations,'cliffs':cliff_bases}
    report['sources'].append(entry)
    print('INDEPENDENT_NATIVE_SOURCE',source,'foundations',len(foundations),'failed',len([x for x in foundations if not x['pass']]),'cliffs',len(cliff_bases),'failed',len([x for x in cliff_bases if not x['pass']]))
report['failures']=[{'source':s['file'],**r} for s in report['sources'] for r in s['foundations']+s['cliffs'] if not r['pass']]
report['pass']=not report['failures']
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(report,indent=2)+'\n')
print('INDEPENDENT_NATIVE_REPORT',json.dumps({'pass':report['pass'],'failures':report['failures'],'out':str(OUT)}))
assert report['pass'], 'Native scenery has unsupported foundation or cliff surfaces; see '+str(OUT)
