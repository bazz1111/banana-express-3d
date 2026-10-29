import * as THREE from 'three';
const axis=new THREE.Vector3(1,0,0),rotation=new THREE.Quaternion(),point=new THREE.Vector3();
const phases={GoatLeg_Front_L:0,GoatLeg_Rear_R:Math.PI/2,GoatLeg_Front_R:Math.PI,GoatLeg_Rear_L:Math.PI*1.5,PedLeg_L:0,PedLeg_R:Math.PI};

// Native pivots/materials stay intact. Rules own travel and velocity; rendering
// never advances movement or a second independent locomotion clock.
export class ObstacleAnimator {
  constructor(root,kind){
    this.kind=kind;this.legs=[];
    root.traverse(node=>{
      if(phases[node.name]!==undefined){
        const feet=[],positions=node.geometry.attributes.position;node.geometry.computeBoundingBox();
        const floor=node.geometry.boundingBox.min.y;
        for(let i=0;i<positions.count;i++)if(positions.getY(i)<floor+.06)feet.push(new THREE.Vector3().fromBufferAttribute(positions,i));
        this.legs.push({node,rest:node.quaternion.clone(),phase:phases[node.name],feet});
      }
    });
    this.reset();
  }
  reset(){this.heading=null;this.lift=0;for(const p of this.legs)p.node.quaternion.copy(p.rest);}
  update(o,dt){
    const wanted=o.heading??((o.speed??0)<0?Math.PI:0);
    if(this.heading===null)this.heading=wanted;
    else this.heading+=Math.atan2(Math.sin(wanted-this.heading),Math.cos(wanted-this.heading))*(1-Math.exp(-Math.max(0,dt)*9));
    const speed=Math.hypot(o.velocityS??0,o.velocityLane??0),travel=o.travel??0;
    const goat=this.kind==='goat',stride=goat?.48:1.05,amplitude=(goat?.30:.25)*Math.min(1,speed/.65);
    let floor=Infinity;
    for(const leg of this.legs){
      rotation.setFromAxisAngle(axis,Math.sin(travel/stride*Math.PI*2+leg.phase)*amplitude).premultiply(leg.rest);
      if(speed>.001)leg.node.quaternion.copy(rotation);
      else leg.node.quaternion.slerp(leg.rest,1-Math.exp(-Math.max(0,dt)*12));
      for(const foot of leg.feet)floor=Math.min(floor,point.copy(foot).applyQuaternion(leg.node.quaternion).add(leg.node.position).y);
    }
    // Keep the lowest authored hoof/sole above the road, without time-based bobbing.
    this.lift=Number.isFinite(floor)?Math.max(0,-floor):0;
    return {heading:this.heading,lift:this.lift};
  }
}
