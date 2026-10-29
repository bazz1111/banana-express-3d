import * as THREE from 'three';
import {ConvexHull} from 'three/addons/math/ConvexHull.js';

// A cached convex support is the exact projected envelope of the static native
// mesh, without the empty corners introduced by rotating a world-space AABB.
export function cameraHull(root){
  root.updateWorldMatrix(true,true);
  const inverse=root.matrixWorld.clone().invert(),points=[];
  root.traverseVisible(mesh=>{if(!mesh.isMesh)return;
    const matrix=inverse.clone().multiply(mesh.matrixWorld);
    for(let i=0;i<mesh.geometry.attributes.position.count;i++)points.push(mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(matrix));
  });
  if(points.length<4)return points;
  const hull=new ConvexHull().setFromPoints(points),support=new Set();
  for(const face of hull.faces){let edge=face.edge;do{support.add(edge.head().point);edge=edge.next;}while(edge!==face.edge);}
  return support.size?[...support]:points;
}
export function cameraRiderBounds(root){
  root.updateWorldMatrix(true,true);
  const box=new THREE.Box3(),top=new THREE.Vector3(0,-Infinity,0),point=new THREE.Vector3();
  root.traverseVisible(mesh=>{if(!mesh.isMesh)return;
    for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);box.expandByPoint(point);if(point.y>top.y)top.copy(point);
    }
  });
  return {box,top};
}

// visibleArea describes the projected rectangle, not the count of mesh pixels.
export function projectPoints(points,camera,matrix){
  const min=new THREE.Vector2(Infinity,Infinity),max=new THREE.Vector2(-Infinity,-Infinity);
  const projection=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  if(matrix)projection.multiply(matrix);
  const p=new THREE.Vector3();let behind=false;
  for(const point of points){
    p.copy(point).applyMatrix4(projection);behind ||= p.z < -1 || p.z > 1;
    min.min(p);max.max(p);
  }
  const area=(max.x-min.x)*(max.y-min.y),clipped=Math.max(0,Math.min(1,max.x)-Math.max(-1,min.x))*Math.max(0,Math.min(1,max.y)-Math.max(-1,min.y));
  return {min,max,visibleArea:behind?0:area>0?clipped/area:0,behind};
}
export function projectBox(box,camera,matrix){
  const points=[];
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z));
  return projectPoints(points,camera,matrix);
}

// Frame a short future envelope as well as the current silhouette. A damped
// camera otherwise trails an outward-tumbling truck even after wind-up framing.
export function anticipatedSupport(points,matrix,localCenter,linear,angular,seconds=.18){
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  matrix.decompose(position,rotation,scale);
  const center=localCenter.clone().applyMatrix4(matrix);
  const turn=angular.length();
  if(turn)rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(angular.clone().multiplyScalar(1/turn),turn*seconds));
  center.addScaledVector(linear,seconds);center.y-=4.905*seconds*seconds;
  position.copy(center).sub(localCenter.clone().multiply(scale).applyQuaternion(rotation));
  const future=new THREE.Matrix4().compose(position,rotation,scale);
  return points.flatMap(point=>[point.clone().applyMatrix4(matrix),point.clone().applyMatrix4(future)]);
}

export class KickCamera {
  constructor(){this.probe=new THREE.PerspectiveCamera();this.reset();}
  reset(){this.weight=0;this.retreat=0;this.safetyFov=0;this.lastFov=null;this.framedTarget=null;}
  adjust({desired,target,fov,camera,vehicleBox,heroBox,vehiclePoints,vehicleMatrix,subjectPoints,wheelCenters,kickSide=0,flight=Infinity,delta=0,reducedMotion=false,paused=false}){
    if(paused){desired.copy(camera.position);if(this.framedTarget)target.copy(this.framedTarget);return camera.fov;}
    const active=vehicleBox&&!vehicleBox.isEmpty()&&flight<1.2;
    const dt=Math.max(0,Math.min(.1,delta)),smooth=1-Math.exp(-dt*6);
    this.weight=reducedMotion?0:this.weight+((active?1-flight/1.2:0)-this.weight)*smooth;
    const normalFov=reducedMotion?fov:Math.min(62,fov+6*this.weight);
    if(!active){
      this.retreat+=(0-this.retreat)*smooth;this.safetyFov=0;this.framedTarget=null;
      this.lastFov=Math.max(normalFov,this.lastFov===null?fov:this.lastFov+(fov-this.lastFov)*smooth);
      return this.lastFov;
    }
    const heroCenter=heroBox.getCenter(new THREE.Vector3()),vehicleCenter=vehicleBox.getCenter(new THREE.Vector3());
    target.copy(heroCenter).lerp(vehicleCenter,.35);
    const direction=vehicleCenter.clone().sub(heroCenter);direction.y=0;direction.normalize();
    const anchor=wheelCenters?.length===2?wheelCenters[0].clone().add(wheelCenters[1]).multiplyScalar(.5):heroCenter;
    const baseRadius=Math.hypot(desired.x-anchor.x,desired.z-anchor.z),height=desired.y,previousSafety=this.safetyFov;
    let result=Math.max(normalFov,this.safetyFov),radius=baseRadius,framedTarget=target.clone(),framedPosition=desired.clone(),subjectHeight=0;
    const truckProjection=()=>vehiclePoints?projectPoints(vehiclePoints,this.probe,vehicleMatrix):projectBox(vehicleBox,this.probe);
    const positionAt=(distance,minSide)=>{
      const r=radius+distance;let x=THREE.MathUtils.clamp(anchor.x-direction.x*r,-4.2,4.2),forced=false;
      if(Math.abs(x-anchor.x)<minSide){
        const side=Math.abs(anchor.x)>4.2-minSide?-Math.sign(anchor.x):(kickSide||Math.sign(desired.x-anchor.x)||-1);
        x=THREE.MathUtils.clamp(anchor.x+side*minSide,-4.2,4.2);forced=true;
      }
      return {position:new THREE.Vector3(x,height,anchor.z-Math.sqrt(Math.max(.01,r*r-(x-anchor.x)**2))),forced};
    };
    const fits=distance=>{
      const r=radius+distance;
      // Start near the minimum rear-quarter offset for the native 1.22m bike,
      // then refine against its actual projected wheel centres.
      let minSide=Math.min(r*.75,.035*2*r*r*Math.tan(THREE.MathUtils.degToRad(result/2))*camera.aspect/1.22*1.1),gap=1;
      this.probe.copy(camera);this.probe.fov=result;this.probe.updateProjectionMatrix();
      for(let angle=0;angle<4;angle++){
        const frame=positionAt(distance,minSide);this.probe.position.copy(frame.position);framedTarget.copy(target);
        for(let i=0;i<4;i++){
          this.probe.lookAt(framedTarget);this.probe.updateMatrixWorld(true);
          const rider=projectBox(heroBox,this.probe),truck=truckProjection();
          const center=new THREE.Vector2(Math.min(rider.min.x,truck.min.x)+Math.max(rider.max.x,truck.max.x),Math.min(rider.min.y,truck.min.y)+Math.max(rider.max.y,truck.max.y)).multiplyScalar(.5);
          const range=this.probe.position.distanceTo(framedTarget),ray=new THREE.Vector3(center.x,center.y,0).unproject(this.probe).sub(this.probe.position).normalize();
          framedTarget.copy(this.probe.position).addScaledVector(ray,range);
        }
        this.probe.lookAt(framedTarget);this.probe.updateMatrixWorld(true);
        if(!wheelCenters)break;
        const wheels=wheelCenters.map(p=>p.clone().project(this.probe));gap=Math.abs(wheels[0].x-wheels[1].x)/2;
        if(angle===3||gap>=.0365&&(!frame.forced||gap<=.039))break;
        minSide=Math.max(.05,Math.max(minSide,Math.abs(frame.position.x-anchor.x))*.0375/Math.max(.00001,gap));
      }
      framedPosition.copy(this.probe.position);
      const size=subjectPoints?projectPoints(subjectPoints,this.probe):projectBox(heroBox,this.probe);subjectHeight=(size.max.y-size.min.y)/2;
      const margin=result>62?.98:.92;
      return gap>.035&&[projectBox(heroBox,this.probe),truckProjection()].every(p=>!p.behind&&p.min.x>=-margin&&p.max.x<=margin&&p.min.y>=-margin&&p.max.y<=margin);
    };
    const maxFov=camera.aspect<.75?95:62;
    let needed=0,solved=false;
    // A safety-only dolly zoom keeps an edge-lane rider readable while fitting
    // the truck from the road interior. Ordinary shots retain the normal lens.
    for(;;){
      radius=result>normalFov+.001||this.safetyFov>0?Math.max(3.2,baseRadius*Math.tan(THREE.MathUtils.degToRad(fov/2))/Math.tan(THREE.MathUtils.degToRad(result/2))):baseRadius;
      needed=0;
      while(needed<40){
        if(fits(needed)&&subjectHeight>=.18){solved=true;break;}
        if(subjectHeight<.18)break;
        needed+=.25;
      }
      if(solved||result>=maxFov)break;
      result=Math.min(maxFov,result+2);
    }
    if(!solved){needed=0;while(needed<40&&!fits(needed))needed+=.5;}
    if(result>normalFov+.001)this.safetyFov=result;
    const lensChanged=this.safetyFov!==previousSafety;
    this.retreat=lensChanged?needed:needed>this.retreat||reducedMotion?Math.max(needed,this.retreat):this.retreat+(needed-this.retreat)*smooth;
    if(!fits(this.retreat)||subjectHeight<.18){this.retreat=needed;fits(needed);}
    desired.copy(framedPosition);target.copy(framedTarget);this.framedTarget=target.clone();this.lastFov=result;
    return result;
  }
}
