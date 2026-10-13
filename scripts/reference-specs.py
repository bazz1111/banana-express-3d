"""Read native Blender layout and export editable technical reference drafts.

These document the implementation; they are not user-approved concept art.
Run inside Blender. No authoring scene or game asset is saved or modified.
"""
import bpy,json,math
from pathlib import Path
from xml.sax.saxutils import escape
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/reference';OUT.mkdir(parents=True,exist_ok=True)
def svg(name,body,w=1200,h=1000):
    header=f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><rect width="100%" height="100%" fill="#f6f1e6"/><g font-family="sans-serif" fill="#293f3c">'
    (OUT/name).write_text(header+body+'</g></svg>')
def text(x,y,s,size=16):return f'<text x="{x}" y="{y}" font-size="{size}">{escape(s)}</text>'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blender/valley-layout.blend'))
bpy.context.view_layer.update()
body=text(40,44,'COASTAL LAYOUT v01 / IMPLEMENTATION DRAFT',26)+text(40,73,'Native Blender XY plan; route from course.json. Unconfirmed artwork. Scale in metres.')
scale=.45;ox=140;oy=140
def p(x,y):return ox+x*scale,oy+y*scale
def path(points,color,width=1,fill='none'):
    xy=[p(*a) for a in points];return f'<path d="'+('M'+' L'.join(f'{x:.2f},{y:.2f}' for x,y in xy))+f'" fill="{fill}" stroke="{color}" stroke-width="{width}"/>'
course=json.loads((ROOT/'assets/export/course.json').read_text());advance=course['road']['advance']['z']/1600
water=bpy.data.objects['ValleyWater'];verts=[water.matrix_world@v.co for v in water.data.vertices]
body+=path([(v.x,v.y) for v in verts[:4]]+[(v.x,v.y) for v in reversed(verts[-4:])]+[(verts[0].x,verts[0].y)],'#1f6fa8',2,'#7acee1')
shore=[]
for s in range(0,1601,20):
    a=course['points'][min(len(course['points'])-1,s//2)]
    u=310+50*math.sin((s-300)/1600*math.tau)+20*math.cos(s/1600*math.tau*2)
    shore.append((a['x']+u,-a['z']/advance))
# Native mesh uses Blender forward -Y; invert Y only for a top-to-bottom reading direction.
oy=930
def p(x,y):return ox+x*scale,oy+y*scale
body=text(40,44,'COASTAL LAYOUT v01 / IMPLEMENTATION DRAFT',26)+text(40,73,'Native Blender XY plan; route from course.json. Unconfirmed artwork. Scale in metres.')
body+=path([(v.x,v.y) for v in verts[:4]]+[(v.x,v.y) for v in reversed(verts[-4:])]+[(verts[0].x,verts[0].y)],'#1f6fa8',2,'#7acee1')
body+=path(shore,'#c8925a',4)
route=[(a['x'],-a['z']/advance) for a in course['points']];body+=path(route,'#43545a',9)+path(route,'#f1ca48',1)
for group in ['ValleyVillageHouse','ValleyVillageLonghouse','ValleyTower']:
    for o in bpy.data.objects[group].children:
        x,y=p(o.matrix_world.translation.x,o.matrix_world.translation.y)
        body+=f'<rect x="{x-2.5:.2f}" y="{y-2:.2f}" width="5" height="4" fill="#c8553d"/>'
for o in bpy.data.objects['ValleyTower'].children:
    v=o.matrix_world.translation;x,y=p(v.x,v.y);body+=f'<circle cx="{x}" cy="{y}" r="13" fill="none" stroke="#cf8c35" stroke-width="2"/>'+text(x+20,y,'Core plaza / bell tower')
for s in [200,380,900]:
    a=course['points'][s//2];x,y=p(a['x'],-a['z']/advance)
    body+=f'<path d="M{x},{y} l100,-36" stroke="#d96b36" stroke-dasharray="5 4"/>'+text(x+6,y+18,f'view s={s}m',13)
body+=text(905,200,'Open bay')+text(905,229,'1300m authored width')+text(905,300,'Red roofs = houses')+text(905,330,'Gold circle = plaza')+text(905,365,'Dashed = sightline')
body+=f'<path d="M930,870 h{100*scale}" stroke="#293f3c" stroke-width="3"/>'+text(930,895,'100m',14)
svg('ref_env_coastal-layout_v01.svg',body)
rows=[('Red rock light','#E8894A'),('Red rock sun','#D9763A'),('Rock side','#B5532A'),('Rock shade','#7A3320'),('Rock base','#C8925A'),('Near green','#4E9A3A'),('Mid blue-green','#4F8A7A'),('Far blue','#8FB5CC'),('Shallow water','#3FB6C9'),('Middle water','#258CB8'),('Deep water','#1F6FA8'),('Roof','#C8553D'),('Wall','#F2E8D8'),('Sky zenith','#4b9fe8'),('Sky horizon','#d2eef4'),('Foreground fog','#c3e0e6'),('Panorama fog','#a8d4e6')]
body=text(40,45,'PALETTE v01 / DRAFT TARGET + RUNTIME ATMOSPHERE',25)+text(40,76,'Rock and water HEX are native authored values. Vegetation/building swatches are art targets; lit pixels vary.')
for i,(label,color) in enumerate(rows):
    x=45+(i%3)*390;y=112+(i//3)*125
    body+=f'<rect x="{x}" y="{y}" width="85" height="80" fill="{color}"/>'+text(x+100,y+30,label)+text(x+100,y+56,color)
svg('ref_env_palette_v01.svg',body,1240,960)
body=text(40,45,'LIGHTING + DEPTH v01 / IMPLEMENTATION SPEC',26)
for i,line in enumerate(['Main reference: style-a.png. Draft, no new artistic confirmation.','Sun: Three.js (35,70,-30), warm #ffe2ae, intensity3.0.','Hemisphere: sky#cfe6ff, ground#8a6248, intensity1.35.','Toon ramp: 3steps (80,170,255); skin smooth normals, scenery flat.','Foreground fog: #c3e0e6,110-460m. Panorama fog: #a8d4e6,560-2000m.','Near forest canopy:172tri; farLOD1:32tri; panoramaLOD2:12tri.','Low: both streamed tiles45% density, nearby valleyLOD1, far valleyLOD2.','Two render passes: distant layer1, clearDepth, foreground layer0.','Additive glow uses native144tri mesh; no full-screen Bloom pass.','Colors are sRGB targets; Blender vertex colors exported in linear space.']):body+=text(45,105+i*65,line,19)
svg('ref_env_lighting_v01.svg',body,1240,820)
print('REFERENCE_DRAFT_SPECS_WRITTEN')
