"""Native art kit, executed by build-assets.py inside local Blender.

Helpers deliberately use the parent builder's mesh/palette API. These are
editable native meshes, never runtime Three.js primitive substitutes.
"""

def linear_hex(value):
    channels=[int(value[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in channels)+(1,)

def forest_tree_lod(level):
    r=root('ForestCanopyLOD'+str(level))
    if level==1:
        parts=[rod((0,0,0),(0,0,2.25),.13,'wood',3)]
        # Three angular, closed octahedral crowns: 24 faces, readable at 150m.
        points=[(0,0,2.5,1.20),(-.55,0,2.1,.76),(.55,.12,2.3,.77)]
        for i,(x,y,z,s) in enumerate(points):
            verts=[(x-s,y,z),(x+s,y,z),(x,y-s*.83,z),(x,y+s*.83,z),(x,y,z+s*.72),(x,y,z-s*.65)]
            faces=[(0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5)]
            parts.append(mesh('AngularCanopyLOD1',verts,faces,[(.075,.24,.045,1),(.11,.29,.058,1),(.13,.31,.07,1)][i]))
    else:
        parts=[]
        for axis in range(2):
            def p(x,z):return (x,0,z) if axis==0 else (0,x,z)
            trunk=mesh('CanopyCrossTrunk', [p(-.13,0),p(.13,0),p(.13,1.4),p(-.13,1.4)],[(0,1,2),(0,2,3)],'wood')
            crown=mesh('CanopyCrossCrown',[p(-.94,1.05),p(-1.13,2.3),p(-.48,3.18),p(.44,3.26),p(1.1,2.42),p(.99,1.10)],
                [(0,1,2),(0,2,3),(0,3,4),(0,4,5)],(.09,.27,.054,1))
            for face in crown.data.polygons:
                col=[(.07,.22,.045,1),(.12,.31,.066,1),(.10,.27,.05,1),(.055,.19,.034,1)][face.index]
                for li in face.loop_indices:crown.data.color_attributes['Color'].data[li].color=col
            parts.extend([trunk,crown])
    m=pack(parts,'ForestLOD'+str(level)+'Mesh',r)
    r['lod']=level;m['lod']=level;r['style_reference']='style-a.png'
    return r

def rock_module(variant):
    r=root('RockModule'+chr(65+variant));rng=random.Random(8013+variant*77)
    widths=[2.4,2.0,3.1,2.7,3.0,2.2];depths=[3.2,3.5,2.6,3.0,2.6,2.1]
    heights=[6.6,7.5,3.4,4.1,1.1,1.7];sides=16;levels=12;v=[];f=[]
    for j in range(levels):
        t=j/(levels-1)
        # Offset ledges and deep radial gullies break long horizontal color bands.
        terrace=1-.47*t+.10*math.sin(t*math.pi*5+variant*.8)
        for i in range(sides):
            a=i*math.tau/sides
            groove=1-.19*max(0,math.cos(a*3+variant*.7+t*.6))**5
            radius=terrace*groove*(1+.045*math.sin(a*7+t*11+variant))
            x=math.cos(a)*widths[variant]*radius+.28*math.sin(t*2+variant)*t
            y=math.sin(a)*depths[variant]*radius+.22*math.cos(t*4+variant)*t
            z=0 if j==0 else heights[variant]*t+.18*math.sin(a*4+variant)*math.sin(t*math.pi)
            v.append((x,y,z))
    for j in range(levels-1):
        for i in range(sides):
            a=j*sides+i;b=j*sides+(i+1)%sides
            f.extend([(a,b,b+sides),(a,b+sides,a+sides)])
    f.extend([tuple(reversed(range(sides))),tuple((levels-1)*sides+i for i in range(sides))])
    m=mesh('RedRockKit'+chr(65+variant),v,f,'dust');m['groundCapVertices']=sides
    sun=Vector((35,30,70)).normalized();colors=[linear_hex(c) for c in ['7A3320','B5532A','D9763A','E8894A','C8925A']]
    for face in m.data.polygons:
        amount=face.normal.dot(sun)
        col=colors[3 if amount>.63 else 2 if amount>.22 else 1 if amount>-.16 else 0]
        if face.center.z<heights[variant]*.11:col=colors[4]
        for li in face.loop_indices:m.data.color_attributes['Color'].data[li].color=col
    m.parent=r;r['variant']=variant;r['sealed']=True;r['style_reference']='style-a.png'
    return r

def cloud_variant(variant):
    r=root('CloudVariant'+str(variant));parts=[]
    shapes=[(-1.9,0,.10,1.35),(-.6,0,.50,1.45),(.6,.1,.57,1.5),(1.9,0,.2,1.15)]
    if variant==2:shapes=[(-2.3,0,.05,1.3),(-.6,0,.1,1.6),(1.15,0,.14,1.7),(2.7,0,.05,.8)]
    for i,(x,y,z,s) in enumerate(shapes):
        parts.append(ico((x,y,z),(s,s*.55,s*(.58 if variant==1 else .27)),(.89+.025*(i%2),.93,.96,1),1))
    pack(parts,'CloudKitMesh'+str(variant),r);r['variant']=variant
    return r

def split_truck_parts(parts,parent):
    groups={name:[] for name in ['Cab','Bed','Tarp','Door_L','Door_R','Tailgate','Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR']}
    groups.update({f'Crate_{i:02}':[] for i in range(1,7)})
    centers=[(x,1.70,z) for x in [-.65,0,.65] for z in [1.30,1.86]]
    for side in [-1,1]:
        panel=cube((side*1.125,-1.60,1.23),(.05,1.09,.69),'cream')
        groups['Door_L' if side<0 else 'Door_R'].append(panel)
    bpy.context.view_layer.update()
    for o in parts:
        pts=[o.matrix_world@Vector(c) for c in o.bound_box]
        lo=Vector(tuple(min(p[i] for p in pts) for i in range(3)));hi=Vector(tuple(max(p[i] for p in pts) for i in range(3)))
        center=(lo+hi)/2;size=hi-lo
        if o.name.startswith(('FacetedCanvas','CanvasSide','RearCanvas')):group='Tarp'
        elif abs(center.x)>.8 and hi.z<1.02 and min(abs(center.y-y) for y in [-1.45,.85,1.8])<.57:
            group=('Wheel_F' if center.y<0 else 'Wheel_R')+('L' if center.x<0 else 'R')
        elif 1.3<center.y<2.09 and size.x<.72 and size.y<.76 and .98<center.z<2.17 and abs(center.x)<.95:
            group=f'Crate_{min(range(6),key=lambda i:(center-Vector(centers[i])).length)+1:02}'
        elif center.y>2.39 and .9<center.z<1.60:group='Tailgate'
        elif abs(center.x)>1.09 and -2.05<center.y<-.94 and 1.02<center.z<1.96:group='Door_L' if center.x<0 else 'Door_R'
        elif center.y<-.78:group='Cab'
        else:group='Bed'
        groups[group].append(o)
    for name,items in groups.items():
        assert items,'Empty truck part '+name
        pts=[o.matrix_world@Vector(c) for o in items for c in o.bound_box]
        lo=Vector(tuple(min(p[i] for p in pts) for i in range(3)));hi=Vector(tuple(max(p[i] for p in pts) for i in range(3)))
        o=pack(items,'TruckPart_'+name,parent,tuple((lo+hi)/2))
        o['breakaway']=name in ['Tarp','Door_L','Door_R','Tailgate'] or name.startswith('Crate_')
        o['mass']=75 if name.startswith('Door') else 28 if name.startswith('Crate') else 45 if name=='Tarp' else 90 if name=='Tailgate' else 150
        size=(hi-lo)/2;o['halfExtents']=[max(.02,size.x),max(.02,size.z),max(.02,size.y)]
    parent['partConvention']='Y-up glTF halfExtents; origins at local geometry centers'
    return parent
