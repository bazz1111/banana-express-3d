import * as THREE from 'three';

export class VehicleDebris {
  constructor(physics,scene){this.physics=physics;this.scene=scene;this.models=new Map();}
  release(id,model){
    model.updateWorldMatrix(true,true);
    const candidates=['TruckPart_Door_R','TruckPart_Tailgate','TruckPart_Crate_01'].map(n=>model.getObjectByName(n)).filter(p=>p?.userData.breakaway&&p.visible);
    const parts=candidates.map(p=>({name:p.name,position:p.getWorldPosition(new THREE.Vector3()),rotation:p.getWorldQuaternion(new THREE.Quaternion()),
      scale:p.getWorldScale(new THREE.Vector3()),mass:p.userData.mass,halfExtents:p.userData.halfExtents}));
    for(const key of this.physics.spawnDebris(id,parts)){
      const d=this.physics.debris.get(key),source=candidates.find(p=>p.name===d.partName),copy=source.clone(false);
      source.visible=false;copy.name='Debris_'+source.name;copy.visible=true;copy.castShadow=true;copy.scale.copy(d.scale);
      this.scene.add(copy);this.models.set(key,{copy,source,vehicleId:id});
    }
    this.update();
  }
  restoreVehicle(id){
    for(const part of this.models.values())if(part.vehicleId===id&&part.source){part.source.visible=true;part.source=null;}
  }
  update(){
    for(const [id,p] of this.models){const d=this.physics.debris.get(id);
      if(d){p.copy.position.copy(d.body.translation());p.copy.quaternion.copy(d.body.rotation());}
      else{this.scene.remove(p.copy);if(p.source)p.source.visible=true;this.models.delete(id);}}
  }
  reset(){for(const p of this.models.values()){this.scene.remove(p.copy);if(p.source)p.source.visible=true;}this.models.clear();}
}
