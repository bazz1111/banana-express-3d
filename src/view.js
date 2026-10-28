import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {MixamoRiderAnimator} from './mixamoRiderAnimation.js';
import {cargoVisibleCounts} from './cargo.js';
import {KickCamera,cameraHull,cameraRiderBounds} from './kickCamera.js';
import {VehicleDebris} from './vehicleDebris.js';
import {clamp} from './game.ts';
import {roadPosition,roadQuaternion,frameQuaternion,cyclePosition,rebasePosition,rebaseVector} from './route.ts';

const compose=new THREE.Object3D(),tint=new THREE.Color();
export const RUNTIME_ASSETS=['bicycle','riderSkinned','bananaRack','looseBanana','truck','car','pedestrian','goat','barrier','crate','wall','train','boost','shield','double','dust','spark','burst','burstGlow','roadCourse','valley','sky'];
export function authoredPrototypes(root){
  const prototypes=new Map();
  root.traverse(object=>{if(object.isMesh&&object.userData.kind&&!prototypes.has(object.userData.kind))
    prototypes.set(object.userData.kind,{geometry:object.geometry,material:object.material});});
  return prototypes;
}
export function paintedMaterial(source,{gradient,name,anisotropy}){
  if(source.map)source.map.anisotropy=anisotropy;
  const material=source.metalness>.2?source:new THREE.MeshToonMaterial({
    color:source.color,map:source.map,vertexColors:source.vertexColors,gradientMap:gradient,
    side:['shield','burst'].includes(name)?THREE.DoubleSide:source.side,
    transparent:source.transparent,opacity:source.opacity,alphaTest:source.alphaTest,
    depthWrite:source.depthWrite,emissive:source.emissive,emissiveIntensity:source.emissiveIntensity,
  });
  material.flatShading=!['rider','riderSkinned'].includes(name);
  return material;
}
export function impactMaterial(source,glow=false){
  return new THREE.MeshBasicMaterial({color:source.color,map:source.map,vertexColors:source.vertexColors,
    alphaTest:source.alphaTest,opacity:source.opacity,transparent:glow||source.transparent,
    blending:glow?THREE.AdditiveBlending:THREE.NormalBlending,depthWrite:!glow,
    side:THREE.DoubleSide,toneMapped:false});
}
// Deterministic 0..1 noise per instance index, so color variation never flickers between frames.
export const instanceNoise=(i,salt=0)=>{const x=Math.sin((i+1)*12.9898+salt*78.233)*43758.5453;return x-Math.floor(x);};
// Small HSL offsets on top of the authored vertex colors; magnitudes stay below a visible palette change.
export function variedColor(target,i,{hue=.02,sat=.08,light=.10,salt=0}={}){
  const warm=(instanceNoise(i,salt)-.5)*hue*4,green=(instanceNoise(i,salt+2)-.5)*sat,scale=1+(instanceNoise(i,salt+1)-.5)*light;
  return target.setRGB((1+warm)*scale,(1+green)*scale,(1-warm)*scale);
}
const windVertex='transformed.x += sin(uWindTime*1.4+instanceMatrix[3].x*.18+position.y)*.022*min(3.,max(0.,position.y));';
export function foliageWind(material,clock){
  material.onBeforeCompile=shader=>{
    shader.uniforms.uWindTime=clock;shader.vertexShader='uniform float uWindTime;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+windVertex);
  };
  material.customProgramCacheKey=()=> 'banana-foliage-wind-v2';
  return material;
}
export const worldAt=(course,s,lane=0,lift=0,origin=0)=>new THREE.Vector3().copy(roadPosition(course,s,lane,lift,origin));
const support=side=>side<0?new THREE.Vector3(-.30,1.311,.58):new THREE.Vector3(.04,1.233,-.21);
function kneeAt(hip,ankle){
  const direction=ankle.clone().sub(hip),distance=direction.length();direction.normalize();
  const along=(.54**2-.48**2+distance**2)/(2*distance);
  const bend=new THREE.Vector3(0,0,1).addScaledVector(direction,-direction.z).normalize();
  return hip.clone().addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,.54**2-along**2)));
}
export function standingRest(side){
  const hip=new THREE.Vector3(side*.17,1.86,-.04),ankle=support(side),knee=kneeAt(hip,ankle);
  return {hip,upper:knee.clone().sub(hip),lower:ankle.clone().sub(knee)};
}
function legJoints(side,hip,ankle){
  const rest=standingRest(side),knee=kneeAt(hip,ankle);
  const upper=new THREE.Quaternion().setFromUnitVectors(rest.upper.clone().normalize(),knee.clone().sub(hip).normalize());
  const localLower=ankle.clone().sub(knee).applyQuaternion(upper.clone().invert()).normalize();
  const lower=new THREE.Quaternion().setFromUnitVectors(rest.lower.clone().normalize(),localLower);
  return {hip,upper,lower,foot:upper.clone().multiply(lower).invert()};
}
export const standingJoints=(side,crouch=0,sway=0)=>legJoints(side,new THREE.Vector3(side*.17+sway,1.86-crouch,-.04),support(side));
const pedalAnkle=(side,angle)=>new THREE.Vector3(side*.21,.4-side*.18*Math.cos(angle)+.138,.04-side*.18*Math.sin(angle)-.075);
export const ridingJoints=(side,angle,crouch=0,sway=0)=>legJoints(side,new THREE.Vector3(side*.17+sway,1.30-crouch,-.22),pedalAnkle(side,angle));
export const armRest=side=>({shoulder:new THREE.Vector3(side*.27,.45,.065),upper:new THREE.Vector3(side*.21,-.13,.035),lower:new THREE.Vector3(side*.20,.05,.06)});
export function armJoints(side,torso,rotation,standing,time){
  const rest=armRest(side),target=new THREE.Vector3(side*.36,1.20,.50).sub(torso).applyQuaternion(rotation.clone().invert());
  const balancing=rest.shoulder.clone().add(rest.upper).add(rest.lower);balancing.y+=Math.sin(time*2+side)*.025;
  target.lerp(balancing,standing);
  const direction=target.clone().sub(rest.shoulder),distance=direction.length();direction.normalize();
  const a=rest.upper.length(),b=rest.lower.length(),along=(a*a-b*b+distance*distance)/(2*distance);
  const bend=new THREE.Vector3(0,-1,0).addScaledVector(direction,direction.y).normalize();
  const elbow=rest.shoulder.clone().addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,a*a-along*along)));
  const upper=new THREE.Quaternion().setFromUnitVectors(rest.upper.clone().normalize(),elbow.clone().sub(rest.shoulder).normalize());
  const lower=new THREE.Quaternion().setFromUnitVectors(rest.lower.clone().normalize(),target.sub(elbow).applyQuaternion(upper.clone().invert()).normalize());
  return {upper,lower,hand:rotation.clone().multiply(upper).multiply(lower).invert()};
}
export function terrainHeight(grid,x,s){
  if(!grid)return -.15;
  const xs=grid.x,period=(grid.rows-1)*grid.step,t=(s%period+period)%period;
  let column=0;while(column<xs.length-2&&x>xs[column+1])column++;
  const row=Math.min(grid.rows-2,Math.floor(t/grid.step)),u=clamp((x-xs[column])/(xs[column+1]-xs[column]),0,1),v=(t-row*grid.step)/grid.step;
  const i=row*xs.length+column,[a,b,c,d]=[grid.heights[i],grid.heights[i+1],grid.heights[i+xs.length],grid.heights[i+xs.length+1]];
  return u>=v?(1-u)*a+(u-v)*b+v*d:(1-v)*a+(v-u)*c+u*d;
}
export function kickJoints(side,amount,base){
  const rest=standingRest(side),direction=new THREE.Vector3(side*.92,.24,.22).normalize();
  const upperTarget=new THREE.Quaternion().setFromUnitVectors(rest.upper.clone().normalize(),direction);
  const lowerTarget=new THREE.Quaternion().setFromUnitVectors(rest.lower.clone().normalize(),direction.clone().applyQuaternion(upperTarget.clone().invert()));
  const upper=(base?.upper.clone()??new THREE.Quaternion()).slerp(upperTarget,amount),lower=(base?.lower.clone()??new THREE.Quaternion()).slerp(lowerTarget,amount);
  return {upper,lower,foot:upper.clone().multiply(lower).invert()};
}

export class GameView {
  constructor(canvas,onProgress){
    this.canvas=canvas;this.onProgress=onProgress;this.assets={};this.obstacleModels=new Map();this.pool=new Map();
    this.assetAnimations={};this.rigMode='skinned';
    this.kickCamera=new KickCamera();this.pendingDebris=new Set();this.landingPlayed=new Set();
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure=1.0;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.renderer.autoClear=false;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#8dcff1');this.scene.fog=new THREE.Fog('#c3e0e6',110,460);
    this.camera=new THREE.PerspectiveCamera(52,1,.1,1800);this.panoramaCamera=this.camera.clone();this.panoramaCamera.layers.set(1);
    const fill=new THREE.HemisphereLight(0xcfe6ff,0x8a6248,1.35);fill.layers.enable(1);this.scene.add(fill);
    this.sun=new THREE.DirectionalLight(0xffefd4,2.8);this.sun.layers.enable(1);this.sun.castShadow=true;
    this.sun.position.set(35,70,-30);this.sun.target.position.set(0,0,16);
    this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:160});
    this.sun.shadow.bias=-.00003;this.sun.shadow.normalBias=.028;this.sun.shadow.radius=2.5;this.scene.add(this.sun,this.sun.target);
    this.quality='high';this.motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;this.time=0;this.shake=0;
    this.effects=[];this.windTime={value:0};this.cameraReady=false;this.lastDistance=0;
    this.lookTarget=new THREE.Vector3();this.resize();window.addEventListener('resize',()=>this.resize());
    this.canvas.addEventListener('webglcontextrestored',()=>{this.needsRender=true;});
  }
  resize(){
    this.needsRender=true;
    const w=Math.max(1,this.canvas.clientWidth),h=Math.max(1,this.canvas.clientHeight);
    this.renderer.setPixelRatio(this.quality==='high'?Math.min(devicePixelRatio,1.5):.8);this.renderer.setSize(w,h,false);
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
  }
  setQuality(quality){
    this.quality=quality;this.renderer.shadowMap.enabled=quality==='high';
    // Both streamed tiles use the same native LOD and evenly distributed density.
    for(const mesh of this.thinnedBatches??[]){
      mesh.count=quality==='high'?mesh.userData.fullCount:Math.ceil(mesh.userData.fullCount*.45);
      if(mesh.lowGeometry){mesh.geometry=quality==='high'?mesh.fullGeometry:mesh.lowGeometry;mesh.boundingSphere=null;mesh.boundingBox=null;}
    }
    this.resize();
  }
  async load(onProgress=this.onProgress){
    const loader=new GLTFLoader(),base=import.meta.env.BASE_URL+'assets/',physicsModule=import('./physics.ts');
    loader.setMeshoptDecoder(MeshoptDecoder);
    const response=await fetch(base+'course.json');if(!response.ok)throw new Error('路线配置载入失败');this.course=await response.json();
    const names=RUNTIME_ASSETS;
    const gradient=new THREE.DataTexture(new Uint8Array([80,170,255]),3,1,THREE.RedFormat);gradient.minFilter=gradient.magFilter=THREE.NearestFilter;gradient.needsUpdate=true;
    const materials=new Map();let done=0;
    await Promise.all(names.map(async name=>{
      const gltf=await loader.loadAsync(base+name+'.glb');gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(o=>{if(!o.isMesh)return;
        const convert=source=>{
          if(materials.has(source))return materials.get(source);
          const m=paintedMaterial(source,{gradient,name,anisotropy:Math.min(8,this.renderer.capabilities.getMaxAnisotropy())});
          materials.set(source,m);return m;
        };
        o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);
        o.castShadow=o.receiveShadow=!['boost','shield','double','burst','burstGlow','dust','spark'].includes(name);
      });this.assets[name]=gltf.scene;this.assetAnimations[name]=gltf.animations;onProgress?.(++done,names.length);
    }));
    const authoredCourse=this.assets.roadCourse.getObjectByName('EndlessRoadCourse');
    this.layoutPrototypes=authoredPrototypes(authoredCourse);
    this.terrainGrid=authoredCourse.children.find(chunk=>chunk.userData.segment===0).userData.terrainGrid;
    this.roadChunks=authoredCourse.children.map(chunk=>({
      segment:chunk.userData.segment,
      surfaces:chunk.children.filter(o=>o.userData.surfaceRole).map(o=>({
        role:o.userData.surfaceRole,geometry:o.geometry.clone().applyMatrix4(o.matrixWorld),material:o.material,
      })),
      scenery:chunk.children.filter(o=>o.userData.kind).map(o=>({kind:o.userData.kind,matrix:o.matrixWorld.clone(),name:o.name,building:o.userData.building})),
    })).sort((a,b)=>a.segment-b.segment);
    // Convex support is immutable and shared by every clone of this vehicle.
    // Build it while loading instead of on the first impact's render frame.
    this.cameraSupports=Object.fromEntries(['truck','car'].map(name=>[name,cameraHull(this.assets[name])]));
    this.buildScene();
    const surfaces=this.roadChunks.flatMap(chunk=>chunk.surfaces.map(({geometry})=>{
      const p=geometry.getAttribute('position'),vertices=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){vertices[i*3]=p.getX(i);vertices[i*3+1]=p.getY(i);vertices[i*3+2]=p.getZ(i);}return {segment:chunk.segment,vertices,
        indices:geometry.index?new Uint32Array(geometry.index.array):Uint32Array.from({length:p.count},(_,i)=>i)};
    }));
    const {ScenePhysics}=await physicsModule;this.physics=await ScenePhysics.create(this.course,surfaces);this.debrisView=new VehicleDebris(this.physics,this.scene);
    // The low tier disables the shadow renderer but keeps the sun as a shadow
    // light. That is a different shader variant from the panorama's shadowless
    // sun. Compile both shipped tiers, including actors not yet on the road.
    const actors=new THREE.Group(),shadows=this.renderer.shadowMap.enabled,warmCamera=this.camera.clone();
    warmCamera.layers.enableAll();
    for(const name of ['truck','car','pedestrian','goat','barrier','crate','wall','train'])actors.add(this.clone(name));
    this.scene.add(actors);
    const visibility=[];
    this.scene.traverse(object=>{visibility.push([object,object.visible,object.frustumCulled]);object.visible=true;object.frustumCulled=false;});
    try{
      for(const enabled of [true,false]){
        this.renderer.shadowMap.enabled=enabled;
        for(const castShadow of [true,false]){
          this.sun.castShadow=castShadow;
          await this.renderer.compileAsync(this.scene,warmCamera);
          // compileAsync visits every mesh, so the first-use draw must also
          // include both layers; otherwise an impact variant stays unexercised.
          this.renderer.setSize(1,1,false);this.renderer.clear();this.renderer.render(this.scene,warmCamera);
        }
      }
    }finally{
      for(const [object,visible,frustumCulled] of visibility){object.visible=visible;object.frustumCulled=frustumCulled;}
      this.sun.castShadow=true;this.renderer.shadowMap.enabled=shadows;this.scene.remove(actors);this.resize();
    }
    return this.course;
  }
  clone(name){return name==='riderSkinned'?cloneSkeleton(this.assets[name]):this.assets[name].clone(true);}
  geometry(name){
    const prototype=this.layoutPrototypes?.get(name);
    if(prototype)return {geometry:prototype.geometry.clone(),material:prototype.material};
    let mesh;this.assets[name].traverse(o=>{if(o.isMesh&&!mesh)mesh=o;});
    return {geometry:mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),material:mesh.material};
  }
  instances(name,count,shadows=false){
    const {geometry,material}=this.geometry(name),mesh=new THREE.InstancedMesh(geometry,material,count);
    mesh.name=name;mesh.count=0;mesh.castShadow=shadows;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);return mesh;
  }
  setInstance(mesh,i,p,scale=1,rotation=0,dimensions){
    compose.position.copy(p);if(dimensions)compose.scale.copy(dimensions);else compose.scale.setScalar(scale);
    compose.rotation.set(0,rotation,0);compose.updateMatrix();mesh.setMatrixAt(i,compose.matrix);
  }
  finishInstances(mesh,count){mesh.count=count;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
  authoredBatch(group,name,{thin=false,vary=null}={}){
    let sources=this.assets.valley.getObjectByName(group).children.filter(o=>o.isMesh);
    // Even indices first: any prefix is then a spatially uniform subset of the authored layout.
    if(thin)sources=[...sources.filter((_,i)=>i%2===0),...sources.filter((_,i)=>i%2===1)];
    const mesh=new THREE.InstancedMesh(sources[0].geometry,sources[0].material,sources.length);mesh.name=name;mesh.layers.set(1);
    sources.forEach((o,i)=>{mesh.setMatrixAt(i,o.matrixWorld);if(vary)mesh.setColorAt(i,variedColor(tint,i,vary));});
    this.finishInstances(mesh,sources.length);this.scene.add(mesh);
    if(thin){mesh.userData.fullCount=sources.length;(this.thinnedBatches??=[]).push(mesh);}
    return mesh;
  }
  buildScene(){
    const sky=this.geometry('sky');
    this.sky=new THREE.Mesh(sky.geometry,new THREE.ShaderMaterial({
      side:THREE.BackSide,depthWrite:false,toneMapped:false,
      uniforms:{horizon:{value:new THREE.Color('#d2eef4')},zenith:{value:new THREE.Color('#4b9fe8')}},
      vertexShader:'varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'uniform vec3 horizon;uniform vec3 zenith;varying vec3 vDirection;void main(){float h=smoothstep(-.12,.72,normalize(vDirection).y);gl_FragColor=vec4(mix(horizon,zenith,h),1.);\n#include <colorspace_fragment>\n}',
    }));this.sky.name='BlenderSkyDome';this.sky.scale.setScalar(1700);this.sky.layers.set(1);this.sky.renderOrder=-1000;this.sky.frustumCulled=false;this.scene.add(this.sky);
    this.roadTiles=Array.from({length:8},()=>{
      const group=new THREE.Group();
      for(const surface of this.roadChunks[0].surfaces){const m=new THREE.Mesh(surface.geometry,surface.material);m.userData.surfaceRole=surface.role;
        m.name={terrain:'RoadsideTerrain',road:'PaintedRoadSurface',guard:'StoneGuardrailsAndMarkings'}[surface.role];m.receiveShadow=true;group.add(m);}
      this.scene.add(group);return group;
    });
    this.scenery={};for(const name of this.layoutPrototypes.keys())this.scenery[name]=this.instances(name,160);
    const sceneryVariation={palm:{hue:.05,sat:.14,light:.20},tree:{hue:.07,sat:.16,light:.22},bananaPlant:{hue:.05,sat:.16,light:.22},bush:{hue:.07,sat:.16,light:.24},rock:{hue:.03,sat:.12,light:.20}};
    for(const name of ['rockA','rockB','rockC','rockD','rockE','rockF'])sceneryVariation[name]={hue:.025,sat:.12,light:.16};
    this.sceneryColors={};
    for(const [name,vary] of Object.entries(sceneryVariation)){
      const mesh=this.scenery[name];for(let i=0;i<mesh.instanceMatrix.count;i++)mesh.setColorAt(i,new THREE.Color(1,1,1));
      this.sceneryColors[name]=this.roadChunks.map(chunk=>chunk.scenery.map((_,i)=>variedColor(new THREE.Color(),chunk.segment*977+i,{...vary,salt:11})));
    }
    this.sceneryShadows={};
    for(const [name,source] of Object.entries(this.scenery)){
      // Reuse native geometry; this small batch submits only nearby casters to the shadow map.
      const material=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,shadowSide:THREE.DoubleSide});
      const mesh=new THREE.InstancedMesh(source.geometry,material,64);mesh.name=name+'_shadow';mesh.castShadow=true;mesh.count=0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.scene.add(mesh);this.sceneryShadows[name]=mesh;
    }
    for(const name of ['palm','tree','bananaPlant']){
      const mesh=this.scenery[name],shadow=this.sceneryShadows[name];mesh.material=foliageWind(mesh.material.clone(),this.windTime);
      foliageWind(shadow.material,this.windTime);
      shadow.customDepthMaterial=foliageWind(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),this.windTime);
    }
    this.valleyMeshes={};this.valleyPeriod=this.assets.valley.getObjectByName('EndlessValley').userData.period;
    const valleyTile=new THREE.Group();valleyTile.name='ValleyTile_0';this.scene.add(valleyTile);
    for(const name of ['ValleyTerrain','ValleyWater']){
      const source=this.assets.valley.getObjectByName(name),mesh=source.clone();mesh.matrixAutoUpdate=false;mesh.matrix.copy(source.matrixWorld);
      mesh.layers.set(1);mesh.castShadow=false;mesh.receiveShadow=false;valleyTile.add(mesh);this.valleyMeshes[name]=mesh;
    }
    const forest={thin:true,vary:{hue:.06,sat:.16,light:.24,salt:3}},houses={vary:{hue:.03,sat:.10,light:.12,salt:5}},palms={vary:{hue:.05,sat:.14,light:.18,salt:7}};
    this.valleyBatches=Object.fromEntries([['ValleyVillageHouse','villageHouse',houses],['ValleyVillageLonghouse','villageLonghouse',houses],['ValleyTower','tower'],['ValleyFoundations','valleyFoundation'],['ValleyForest','forestTree',forest],['ValleyPalms','valleyPalm',palms],['ValleyMountains','valleyMountain'],['ValleyFoothills','panoramaFoothills'],['ValleyClouds','panoramaClouds'],
      ['ValleyForestFar','forestTreeFar',forest],['ValleyMountainsB','valleyMountainB'],['ValleyMidMountains','valleyMidMountain'],['ValleyMidMountainsB','valleyMidMountainB'],['ValleyFoothillsB','panoramaFoothillsB'],['ValleyCloudsB','panoramaCloudsB'],['ValleyCloudsC','panoramaCloudsC'],
      ['ValleyPanoramaForest','panoramaForest',forest],['ValleyPanoramaHouse','panoramaHouse',houses],['ValleyPanoramaLonghouse','panoramaLonghouse',houses],['ValleyPanoramaTower','panoramaTower'],['ValleyPanoramaFoundations','panoramaFoundations']].map(([group,name,options])=>[group,this.authoredBatch(group,name,options)]));
    const panoramaGroups=['ValleyMountains','ValleyMountainsB','ValleyMidMountains','ValleyMidMountainsB','ValleyFoothills','ValleyFoothillsB','ValleyClouds','ValleyCloudsB','ValleyCloudsC','ValleyPanoramaForest','ValleyPanoramaHouse','ValleyPanoramaLonghouse','ValleyPanoramaTower','ValleyPanoramaFoundations'];
    for(const [group,mesh] of Object.entries(this.valleyBatches))if(!panoramaGroups.includes(group))valleyTile.add(mesh);
    const nextValley=valleyTile.clone(true);nextValley.name='ValleyTile_1';this.scene.add(nextValley);this.valleyTiles=[valleyTile,nextValley];
    nextValley.traverse(mesh=>{if(mesh.isInstancedMesh&&mesh.userData.fullCount)this.thinnedBatches.push(mesh);});
    for(const tile of this.valleyTiles)for(const [name,low] of [['forestTree',this.valleyBatches.ValleyForestFar.geometry],['forestTreeFar',this.valleyBatches.ValleyPanoramaForest.geometry]]){
      const forest=tile.getObjectByName(name);forest.fullGeometry=forest.geometry;forest.lowGeometry=low;
    }
    this.farPanorama=new THREE.Group();this.scene.add(this.farPanorama);this.farPanorama.add(...panoramaGroups.map(group=>this.valleyBatches[group]));
    this.panoramaFog=new THREE.Fog('#a8d4e6',560,2000);
    for(const name of ['ValleyClouds','ValleyCloudsB','ValleyCloudsC']){
      const clouds=this.valleyBatches[name],source=clouds.material;
      clouds.receiveShadow=false;
      clouds.material=new THREE.MeshBasicMaterial({color:source.color.clone().multiplyScalar(2.2),map:source.map,vertexColors:source.vertexColors,side:source.side,toneMapped:false});
      for(const mesh of this.assets.valley.getObjectByName(name).children)if(mesh.isMesh)mesh.material=clouds.material;
    }
    this.player=new THREE.Group();this.bike=this.clone('bicycle');this.rider=this.clone('riderSkinned');this.player.add(this.bike,this.rider);this.scene.add(this.player);
    this.riderAnimator=new MixamoRiderAnimator(this.rider,this.assetAnimations.riderSkinned,this.bike);
    this.wheels=['WheelFront','WheelRear'].map(n=>this.bike.getObjectByName(n));this.crank=this.bike.getObjectByName('Crank');
    this.pedals=['Pedal_L','Pedal_R'].map(n=>this.bike.getObjectByName(n));
    this.cargoRopes=this.assets.bananaRack.getObjectByName('CargoTieDowns').clone(true);this.cargoRopes.visible=false;this.player.add(this.cargoRopes);
    const joint=n=>this.riderAnimator?.bones[n]??this.rider.getObjectByName(n);
    this.legs=['Leg_L','Leg_R'].map(joint);this.knees=['Knee_L','Knee_R'].map(joint);
    this.feet=['Foot_L','Foot_R'].map(joint);this.arms=['Arm_L','Arm_R'].map(joint);this.torso=this.riderAnimator?new THREE.Object3D():joint('BalanceBody');
    this.elbows=['Elbow_L','Elbow_R'].map(joint);this.hands=['Hand_L','Hand_R'].map(joint);
    const bundles=this.assets.bananaRack.getObjectByName('BananaCargo').children.filter(o=>o.isMesh).sort((a,b)=>a.name.localeCompare(b.name));
    this.cargo=new THREE.Group();this.cargo.name='bananaRack';this.cargo.count=0;this.cargoGroups=[];
    const variants=new Map();bundles.forEach((bundle,index)=>{if(!variants.has(bundle.geometry))variants.set(bundle.geometry,[]);variants.get(bundle.geometry).push({bundle,index});});
    for(const hands of variants.values()){
      const m=new THREE.InstancedMesh(hands[0].bundle.geometry,hands[0].bundle.material,hands.length);m.name='bananaRackVariant'+this.cargoGroups.length;m.castShadow=true;
      hands.forEach(({bundle,index},i)=>{m.setMatrixAt(i,bundle.matrixWorld);m.setColorAt(i,variedColor(tint,index,{hue:.035,sat:.18,light:.16,salt:17}));});
      m.userData.globalIndices=hands.map(h=>h.index);m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();m.count=0;this.cargo.add(m);this.cargoGroups.push(m);
    }
    this.player.add(this.cargo);
    this.pickupMeshes={};for(const name of ['banana','boost','shield','double'])this.pickupMeshes[name]=this.instances(name==='banana'?'looseBanana':name,name==='banana'?400:48);
    this.burst=this.clone('burst');this.burst.visible=false;this.scene.add(this.burst);
    this.burst.traverse(o=>{if(o.isMesh)o.material=Array.isArray(o.material)?o.material.map(m=>impactMaterial(m)):impactMaterial(o.material);});
    this.burstGlow=this.clone('burstGlow');this.burstGlow.visible=false;this.scene.add(this.burstGlow);
    this.burstGlow.traverse(o=>{if(o.isMesh)o.material=Array.isArray(o.material)?o.material.map(m=>impactMaterial(m,true)):impactMaterial(o.material,true);});
    this.shieldBadge=this.clone('shield');this.shieldBadge.position.set(0,3.2,0);this.shieldBadge.scale.setScalar(.35);this.shieldBadge.visible=false;this.player.add(this.shieldBadge);
    this.particleMeshes={};for(const name of ['dust','spark','rock']){const m=this.instances(name,48);m.frustumCulled=false;m.castShadow=false;this.particleMeshes[name]=m;}
  }
  reset(g){
    this.needsRender=true;this.lastRenderedPhase=null;
    this.lastGame=g;this.lastDistance=g.s;this.effects=[];this.shake=0;this.cameraReady=false;this.time=0;this.stanceBlend=g.stance==='standing'?1:0;this.kickBlend=[0,0];
    this.debrisView?.reset();this.pendingDebris.clear();this.landingPlayed.clear();this.kickCamera.reset();this.riderAnimator?.reset(g.stance);
    // Procedural ids repeat across seeds; an early restart can change their kinds.
    for(const model of this.obstacleModels.values()){
      this.scene.remove(model);const kind=model.userData.kind;
      if(!this.pool.has(kind))this.pool.set(kind,[]);this.pool.get(kind).push(model);
    }
    this.obstacleModels.clear();
    this.physics.reset(g);this.wheels.forEach(w=>w.rotation.x=0);this.crank.rotation.x=0;this.pedals.forEach(p=>p.rotation.x=0);
    for(const m of Object.values(this.particleMeshes))m.count=0;
  }
  emit(name,p,count,speed=3){
    const scale=()=>name==='dust'?.10+Math.random()*.14:name==='rock'?.025+Math.random()*.04:.55;
    for(let i=0;i<count&&this.effects.filter(v=>v.name===name).length<48;i++)this.effects.push({name,p:p.clone(),v:new THREE.Vector3((Math.random()-.5)*speed*2,1+Math.random()*speed,(Math.random()-.5)*speed),age:0,ttl:(name==='rock'?1.1:.65)+Math.random()*.4,scale:scale()});
  }
  events(events,g){
    this.riderAnimator?.events(events);
    for(const e of events){
      if(e.type==='kick'){
        if(e.charged&&g.obstacles.find(o=>o.id===e.id)?.type==='truck')this.pendingDebris.add(e.id);
        this.shake=.5;this.burstAge=0;const o=g.obstacles.find(v=>v.id===e.id);if(o){const p=worldAt(this.course,o.s,o.lane,1.3,this.lastDistance);this.emit('spark',p,24,8);this.emit('dust',p,20,4);
          this.emit('rock',worldAt(this.course,o.s,o.lane,.4,this.lastDistance),e.charged?22:12,5);}
      }else if(e.type==='collision'||e.type==='shield'){this.shake=.28;this.emit('spark',worldAt(this.course,g.s,g.lane,1,this.lastDistance),12,4);}
      else if(e.type==='pickup')this.emit('spark',worldAt(this.course,g.s,g.lane,1.5,this.lastDistance),e.kind==='banana'?2:8,1.2);
    }
  }
  streamScenery(g){
    const rotation=frameQuaternion(this.course,g.s),period=this.course.road.period;
    const firstCycle=Math.floor((g.s-80)/period);
    this.valleyTiles.forEach((tile,i)=>{tile.position.copy(cyclePosition(this.course,firstCycle+i,g.s));tile.quaternion.copy(rotation);tile.scale.z=this.course.road.advance.z/this.valleyPeriod;tile.userData.cycle=firstCycle+i;});
    this.farPanorama.quaternion.copy(rotation);
    const chunk=Math.floor(g.s/80),counts=Object.fromEntries(Object.keys(this.scenery).map(n=>[n,0]));
    const shadowCounts=Object.fromEntries(Object.keys(this.sceneryShadows).map(n=>[n,0]));
    const transform=new THREE.Matrix4(),instance=new THREE.Matrix4();
    for(let k=-1;k<7;k++){
      const logical=chunk+k,segment=((logical%this.roadChunks.length)+this.roadChunks.length)%this.roadChunks.length;
      const source=this.roadChunks[segment],tile=this.roadTiles[k+1];tile.userData.logical=logical;tile.userData.segment=segment;
      tile.position.copy(cyclePosition(this.course,Math.floor(logical/this.roadChunks.length),g.s));tile.quaternion.copy(rotation);tile.updateMatrix();transform.copy(tile.matrix);
      const nearGuard=logical*80-g.s<55&&(logical+1)*80-g.s> -25;
      tile.children.forEach(mesh=>{const s=source.surfaces.find(s=>s.role===mesh.userData.surfaceRole);mesh.geometry=s.geometry;mesh.material=s.material;
        mesh.castShadow=mesh.userData.surfaceRole==='guard'&&nearGuard;});
      for(const [p,placement] of source.scenery.entries()){const mesh=this.scenery[placement.kind];instance.multiplyMatrices(transform,placement.matrix);
        const colors=this.sceneryColors[placement.kind];if(colors)mesh.setColorAt(counts[placement.kind],colors[segment][p]);mesh.setMatrixAt(counts[placement.kind]++,instance);
        if(instance.elements[14]> -35&&instance.elements[14]<70&&Math.abs(instance.elements[12])<35)
          this.sceneryShadows[placement.kind].setMatrixAt(shadowCounts[placement.kind]++,instance);
      }
    }
    for(const [name,mesh] of Object.entries(this.scenery)){this.finishInstances(mesh,counts[name]);if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
    for(const [name,mesh] of Object.entries(this.sceneryShadows)){mesh.visible=this.quality==='high';this.finishInstances(mesh,shadowCounts[name]);}
  }
  update(g,dt,visualDt=dt){
    if(g.phase==='paused'&&this.lastGame===g&&this.lastRenderedPhase==='paused'&&!this.needsRender)return;
    if(this.lastGame!==g)this.reset(g);
    const active=g.phase!=='paused'&&g.phase!=='finished',delta=active?Math.min(dt,.1):0,previousDistance=this.lastDistance;this.lastDistance=g.s;
    for(const p of this.effects){p.p.copy(rebasePosition(this.course,p.p,previousDistance,g.s));p.v.copy(rebaseVector(this.course,p.v,previousDistance,g.s));}
    this.time+=delta;this.windTime.value=this.motion?this.time:0;this.streamScenery(g);
    this.player.position.copy(worldAt(this.course,g.s,g.lane,g.jumpHeight,g.s));this.player.quaternion.copy(roadQuaternion(this.course,g.s,g.s));
    this.player.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),g.lateralSpeed*.045));
    this.sun.position.set(35,70,-30).applyQuaternion(new THREE.Quaternion().copy(frameQuaternion(this.course,g.s)));
    const stance=this.riderAnimator.stanceBlend;
    if(active){this.wheels.forEach(w=>w.rotation.x+=g.speed*delta/.36);this.crank.rotation.x+=(5+Math.max(0,g.speed-12)*.16)*(1-stance*.72)*delta;this.pedals.forEach(p=>p.rotation.x=-this.crank.rotation.x);}
    const kickLeg=g.kickSide>0?0:1;
    this.riderAnimator.update(g,g.phase==='ready'||g.phase==='finished'&&g.endReason==='collision'?Math.min(visualDt,.1):delta,this.crank.rotation.x);
    this.riderAnimator.applyContactPose();this.stanceBlend=this.riderAnimator.stanceBlend;
    const cargoCounts=cargoVisibleCounts(this.cargoGroups.map(m=>m.userData.globalIndices),g.bananas);
    this.cargoGroups.forEach((m,i)=>{if(m.count!==cargoCounts[i]){m.count=cargoCounts[i];m.boundingBox=null;m.computeBoundingSphere();}});
    this.cargo.count=cargoCounts.reduce((a,b)=>a+b,0);this.cargoRopes.visible=g.bananas>=80;this.shieldBadge.visible=g.buffs.shield>0;
    this.shieldBadge.rotation.y=this.time*1.2;
    this.physics.sync(g,delta);
    const visibleIds=new Set();
    for(const o of g.obstacles){
      if(o.s-g.s>260||o.s-g.s< -45)continue;visibleIds.add(o.id);
      let model=this.obstacleModels.get(o.id);
      if(!model){model=this.pool.get(o.type)?.pop()??this.clone(o.type);model.userData.kind=o.type;this.obstacleModels.set(o.id,model);this.scene.add(model);}
      model.visible=!o.kicked||o.flight<3;model.traverse(m=>{if(m.isMesh)m.castShadow=o.s-g.s<55;});
      if(o.kicked){const body=this.physics.vehicles.get(o.id);if(body){model.position.copy(body.translation());model.quaternion.copy(body.rotation());}}
      else{
        model.position.copy(worldAt(this.course,o.s,o.lane,o.lift??0,g.s));model.quaternion.copy(roadQuaternion(this.course,o.s,g.s));
        const direction=o.crossing?(Math.cos(g.elapsed*(o.frequency??1)+(o.seed??0))>0?Math.PI/2:-Math.PI/2):(o.speed<0?Math.PI:0);
        model.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),direction));
        if(o.crossing)model.position.y+=Math.abs(Math.sin(this.time*7))*.035;
        for(const [i,name] of (o.type==='goat'?['GoatLeg_Front_L','GoatLeg_Front_R','GoatLeg_Rear_L','GoatLeg_Rear_R']:['PedLeg_L','PedLeg_R']).entries()){
          const leg=model.getObjectByName(name);if(leg)leg.rotation.x=Math.sin(this.time*7+i*Math.PI)*.32;
        }
      }
    }
    for(const [id,model] of this.obstacleModels)if(!visibleIds.has(id)){
      this.landingPlayed.delete(id);this.pendingDebris.delete(id);
      this.debrisView.restoreVehicle(id);
      this.scene.remove(model);this.obstacleModels.delete(id);const kind=model.userData.kind;if(!this.pool.has(kind))this.pool.set(kind,[]);this.pool.get(kind).push(model);
    }
    for(const id of this.pendingDebris){const model=this.obstacleModels.get(id);if(model){this.debrisView.release(id,model);this.pendingDebris.delete(id);}}
    this.debrisView.update();
    if(delta>0)for(const o of g.obstacles)if(o.kicked&&o.flight>.15&&!this.landingPlayed.has(o.id)){
      const body=this.physics.vehicles.get(o.id);if(!body)continue;let groundContact=false;
      this.physics.world.contactPairsWith(body.collider(0),collider=>{if(collider.parent()?.isFixed())groundContact=true;});
      if(groundContact){this.landingPlayed.add(o.id);this.onSound?.({type:'land'});}
    }
    const counts={banana:0,boost:0,shield:0,double:0};
    for(const p of g.pickups){
      if(p.collected||p.s-g.s< -8||p.s-g.s>280)continue;
      const mesh=this.pickupMeshes[p.type],i=counts[p.type]++;compose.position.copy(worldAt(this.course,p.s,p.lane,p.height+Math.sin(this.time*2+p.s)*.055,g.s));
      compose.scale.setScalar(p.type==='banana'?1.3:1);compose.quaternion.copy(roadQuaternion(this.course,p.s,g.s));
      compose.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),this.time*1.4));compose.updateMatrix();mesh.setMatrixAt(i,compose.matrix);
    }
    for(const [name,m] of Object.entries(this.pickupMeshes))this.finishInstances(m,counts[name]);
    this.effects=this.effects.filter(p=>p.age<p.ttl);
    const pc={dust:0,spark:0,rock:0};for(const p of this.effects){p.age+=delta;p.v.y-=7*delta;p.p.addScaledVector(p.v,delta);
      this.setInstance(this.particleMeshes[p.name],pc[p.name]++,p.p,p.scale*(1-p.age/p.ttl),this.time*4);}
    for(const [name,m] of Object.entries(this.particleMeshes))this.finishInstances(m,pc[name]);
    if(g.speed>10&&g.jumpHeight===0&&delta>0&&Math.random()<delta*10)this.emit('dust',new THREE.Vector3(-g.lane,.1,-.6),1,1.2);
    this.burst.visible=g.kickPose>.24&&g.kickPose<.56;
    if(this.burst.visible){this.feet[kickLeg].getWorldPosition(this.burst.position);this.burst.position.add(new THREE.Vector3(g.kickSide>0?-.1:.1,0,.04).applyQuaternion(this.player.quaternion));
      const t=clamp((.56-g.kickPose)/.32,0,1);this.burst.scale.setScalar(1.25+.55*Math.sin(Math.PI*Math.min(1,t*1.6)));}
    const ready=g.phase==='ready',portrait=1-clamp((this.camera.aspect-.6)/.6,0,1);
    const offset=ready?THREE.MathUtils.lerp(3.4,1.2,portrait):1.6;
    let cameraSide=this.cameraReady?(this.cameraRoadSide??-1):-1;
    if(!ready&&Math.abs(-g.lane+cameraSide*offset)>4.2)cameraSide=Math.sign(g.lane)||-1;
    const sideChanged=this.cameraReady&&cameraSide!==this.cameraRoadSide;this.cameraRoadSide=cameraSide;
    const height=ready?3.0:THREE.MathUtils.lerp(2.25,2.7,portrait),distance=ready?THREE.MathUtils.lerp(5.4,6.6,portrait):THREE.MathUtils.lerp(3.9,7.2,portrait);
    const desired=new THREE.Vector3(-g.lane+cameraSide*offset,height+g.jumpHeight,-distance);
    const target=worldAt(this.course,g.s+(ready?1.5:6),ready?g.lane*THREE.MathUtils.lerp(.65,.96,portrait):g.lane,ready?1.48:.8,g.s);
    if(!ready)target.x-=cameraSide*THREE.MathUtils.lerp(1.5,1.2,portrait);
    target.y+=g.jumpHeight;
    let fov=ready?52:52+clamp((g.speed-12)*.34,0,7),kickShot=false;
    const flying=g.obstacles.filter(o=>o.kicked&&o.flight<1.2&&this.obstacleModels.has(o.id)).sort((a,b)=>a.flight-b.flight)[0];
    if(flying||this.kickCamera.weight>.0001||this.kickCamera.retreat>.001||(this.kickCamera.lastFov??fov)-fov>.05){
      this.player.updateWorldMatrix(true,true);
      const riderBounds=cameraRiderBounds(this.rider),heroBox=riderBounds.box.union(new THREE.Box3().setFromObject(this.bike,true));
      if(this.cargoRopes.visible)heroBox.union(new THREE.Box3().setFromObject(this.cargoRopes,true));
      for(const m of this.cargoGroups)if(m.count){m.computeBoundingBox();heroBox.union(new THREE.Box3().setFromObject(m));}
      const vehicleModel=flying?this.obstacleModels.get(flying.id):null;
      const vehicleBox=vehicleModel?new THREE.Box3().setFromObject(vehicleModel,true):null;
      const vehiclePoints=vehicleModel?this.cameraSupports[flying.type]:null;
      const wheelCenters=this.wheels.map(w=>w.getWorldPosition(new THREE.Vector3())),below=new THREE.Vector3(0,-.36,0).applyQuaternion(this.player.quaternion);
      const subjectPoints=[riderBounds.top,...wheelCenters.map(p=>p.clone().add(below))];
      fov=this.kickCamera.adjust({desired,target,fov,camera:this.camera,vehicleBox,heroBox,flight:flying?.flight??Infinity,
        vehiclePoints,vehicleMatrix:vehicleModel?.matrixWorld,subjectPoints,wheelCenters,kickSide:flying?.kickSide??g.kickSide,
        delta,reducedMotion:!this.motion,paused:g.phase==='paused'||g.phase==='finished'});
      kickShot=!!flying;
    }
    if(!this.cameraReady||sideChanged){this.camera.position.copy(desired);this.lookTarget.copy(target);this.cameraReady=true;}
    const t=1-Math.exp(-delta*8),vertical=1-Math.exp(-delta*64),cameraY=this.camera.position.y,targetY=this.lookTarget.y;
    this.camera.position.lerp(desired,t);this.lookTarget.lerp(target,t);
    this.camera.position.y=THREE.MathUtils.lerp(cameraY,desired.y,vertical);this.lookTarget.y=THREE.MathUtils.lerp(targetY,target.y,vertical);
    if(kickShot){this.camera.position.copy(desired);this.lookTarget.copy(target);}
    this.shake=Math.max(0,this.shake-delta);if(this.motion&&this.shake&&active)this.camera.position.y+=(Math.random()-.5)*this.shake*.15;
    if(Math.abs(this.camera.fov-fov)>.1){this.camera.fov=fov;this.camera.updateProjectionMatrix();}
    this.camera.lookAt(this.lookTarget);
    if(this.burst.visible)this.burst.quaternion.copy(this.camera.quaternion);
    this.burstGlow.visible=this.burst.visible;if(this.burstGlow.visible){this.burstGlow.position.copy(this.burst.position);this.burstGlow.quaternion.copy(this.burst.quaternion);this.burstGlow.scale.copy(this.burst.scale).multiplyScalar(1.10);}
    this.sky.position.copy(this.camera.position);
    // Background keeps the distant valley readable while foreground uses short visibility/fog.
    this.panoramaCamera.copy(this.camera);this.panoramaCamera.layers.set(1);this.panoramaCamera.rotateX(-.04);
    const fog=this.scene.fog,sky=this.scene.background;this.scene.fog=this.panoramaFog;this.sun.castShadow=false;
    this.renderer.render(this.scene,this.panoramaCamera);this.sun.castShadow=true;this.scene.fog=fog;this.renderer.clearDepth();this.scene.background=null;
    this.renderer.render(this.scene,this.camera);this.scene.background=sky;
    this.lastRenderedPhase=g.phase;this.needsRender=false;
  }
}
