import * as THREE from 'three';

// Conservative projected bounds, not just the origin. visibleArea is the fraction
// of the projected bounding rectangle clipped by the viewport, not mesh pixels.
export function projectBox(box,camera){
  const min=new THREE.Vector2(Infinity,Infinity),max=new THREE.Vector2(-Infinity,-Infinity);
  let behind=false;
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const p=new THREE.Vector3(x,y,z).project(camera);
    behind ||= p.z < -1 || p.z > 1;
    min.x=Math.min(min.x,p.x);min.y=Math.min(min.y,p.y);max.x=Math.max(max.x,p.x);max.y=Math.max(max.y,p.y);
  }
  const area=(max.x-min.x)*(max.y-min.y),clipped=Math.max(0,Math.min(1,max.x)-Math.max(-1,min.x))*Math.max(0,Math.min(1,max.y)-Math.max(-1,min.y));
  return {min,max,visibleArea:behind?0:area>0?clipped/area:0,behind};
}

export class KickCamera {
  constructor(){this.weight=0;this.retreat=0;this.probe=new THREE.PerspectiveCamera();}
  reset(){this.weight=0;this.retreat=0;}
  adjust({desired,target,fov,camera,vehicleBox,heroBox,flight=Infinity,delta=0,reducedMotion=false,paused=false}){
    const narrow=1-THREE.MathUtils.clamp((camera.aspect-.6)/.6,0,1);
    if(!narrow||reducedMotion){this.reset();return fov;}
    const active=vehicleBox&&!vehicleBox.isEmpty()&&flight<1.2;
    const dt=paused?0:Math.max(0,Math.min(.1,delta)),smooth=1-Math.exp(-dt*6);
    this.weight+=(active?narrow*(1-flight/1.2)-this.weight:-this.weight)*smooth;
    if(this.weight<.0001&&!active){this.retreat+=(0-this.retreat)*smooth;return fov;}
    if(active)target.lerp(vehicleBox.getCenter(new THREE.Vector3()),.35*this.weight);
    const result=Math.min(62,fov+6*this.weight);
    if(paused){desired.copy(camera.position);return camera.fov;}
    const backwards=desired.clone().sub(target).normalize();
    const base=desired.clone().addScaledVector(backwards,1.5*this.weight);
    // Keep the existing left rear viewing angle as we retreat. A straight
    // retreat compresses the two authored wheels into the same silhouette.
    const positionAt=distance=>{
      const position=base.clone().addScaledVector(backwards,distance);
      position.x-=(distance+1.5*this.weight)*.4*narrow;
      return position;
    };
    const fits=distance=>{
      this.probe.copy(camera);this.probe.fov=result;this.probe.position.copy(positionAt(distance));
      this.probe.lookAt(target);this.probe.updateProjectionMatrix();this.probe.updateMatrixWorld(true);
      for(const box of [heroBox,active?vehicleBox:null])if(box&&!box.isEmpty()){
        const p=projectBox(box,this.probe);
        if(p.behind||p.min.x<-.92||p.max.x>.92||p.min.y<-.92||p.max.y>.92)return false;
      }
      return true;
    };
    let needed=0;
    // Keep every authored bound in the safe frame. Expand immediately if needed;
    // easing an insufficient horizontal field of view would crop the first kick.
    if(active){while(needed<40&&!fits(needed))needed+=.5;}
    if(!paused)this.retreat=needed>this.retreat?needed:this.retreat+(needed-this.retreat)*smooth;
    desired.copy(positionAt(this.retreat));
    return result;
  }
}
