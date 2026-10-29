import * as THREE from 'three';

// One continuous chase pose across side changes, wind-up, impact and recovery.
// Shake is applied after this state, so it cannot accumulate in the follow pose.
export class CameraFollow {
  constructor(){this.position=new THREE.Vector3();this.target=new THREE.Vector3();this.probe=new THREE.PerspectiveCamera();this.reset();}
  reset(){this.ready=false;}
  update(camera,desired,target,fov,delta){
    const dt=Math.max(0,Math.min(.1,delta));
    if(!this.ready){
      this.position.copy(desired);this.target.copy(target);camera.position.copy(desired);camera.fov=fov;
      camera.lookAt(target);camera.updateProjectionMatrix();this.ready=true;return;
    }
    if(!dt)return;
    const approach=(value,wanted,response,limit)=>{
      const distance=value.distanceTo(wanted);
      value.lerp(wanted,Math.min(1-Math.exp(-dt*response),distance?limit*dt/distance:1));
    };
    approach(this.position,desired,8,12);approach(this.target,target,10,20);
    camera.position.copy(this.position);
    this.probe.position.copy(this.position);this.probe.lookAt(this.target);
    camera.quaternion.rotateTowards(this.probe.quaternion,dt*1.8);
    camera.fov+=THREE.MathUtils.clamp((fov-camera.fov)*(1-Math.exp(-dt*8)),-60*dt,60*dt);
    camera.updateProjectionMatrix();
  }
}
