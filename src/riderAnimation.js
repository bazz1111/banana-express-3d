import * as THREE from 'three';

export const RIDER_CLIPS={idle:'Rider_Idle_Ready',seated:'Rider_Ride_SeatedPedal',standing:'Rider_Ride_StandingBalance',sitToStand:'Rider_Trans_SitToStand',standToSit:'Rider_Trans_StandToSit',jumpTakeoff:'Rider_Jump_Takeoff',jumpAir:'Rider_Jump_Air',jumpLand:'Rider_Jump_Land',kickChargeL:'Rider_Kick_Charge_L',kickChargeR:'Rider_Kick_Charge_R',kickStrikeL:'Rider_Kick_Strike_L',kickStrikeR:'Rider_Kick_Strike_R',leanL:'Rider_Lean_L',leanR:'Rider_Lean_R',shield:'Rider_Hit_Shield',crash:'Rider_Crash'};
const ONCE=new Set(['sitToStand','standToSit','jumpTakeoff','jumpLand','kickStrikeL','kickStrikeR','shield','crash']);
const REST={BalanceBody:[0,1.86,-.04],Arm_L:[-.27,2.31,.025],Arm_R:[.27,2.31,.025],Elbow_L:[-.48,2.18,.06],Elbow_R:[.48,2.18,.06],Hand_L:[-.68,2.23,.12],Hand_R:[.68,2.23,.12]};
const vector=a=>new THREE.Vector3(...a);
export function riderState(g){
  if(g.phase==='finished'&&g.endReason==='collision')return 'crash';
  if(g.kickPose>0)return g.kickSide>0?'kickStrikeR':'kickStrikeL';
  if(g.charge>0)return g.kickSide>0?'kickChargeR':'kickChargeL';
  if(g.jumpHeight>0)return g.jumpVelocity>0?'jumpTakeoff':'jumpAir';
  if(g.phase==='ready')return 'idle';
  return g.stance==='standing'?'standing':'seated';
}

/** Blender Z-up is converted by GLTFLoader. Contact poses use the existing Y-up
 * view helpers' DELTA quaternions, not raw bone-local quaternions. Capture each
 * exported bone's rest basis, then conjugate through its actual parent matrix.
 * Call update first, applyContactPose second, skeleton.update before vertex QA.
 */
export class RiderAnimator{
  constructor(root,clips){
    this.root=root;this.mixer=new THREE.AnimationMixer(root);this.actions={};this.bones={};this.rest=new Map();this.restWorld={};
    root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert();
    root.traverse(o=>{if(o.isBone){this.bones[o.name.replace(/^DEF-/,'')]=o;this.rest.set(o,{p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});const m=inverse.clone().multiply(o.matrixWorld);this.restWorld[o.name.replace(/^DEF-/,'')]={p:new THREE.Vector3().setFromMatrixPosition(m),q:new THREE.Quaternion().setFromRotationMatrix(m)};}});
    for(const clip of clips){
      let c=clip;
      if(clip.name.startsWith('Rider_Lean_')){
        // Convert against the seated frame; using the single-frame lean as its
        // own reference would subtract the entire pose and make lean invisible.
        const reference=clips.find(c=>c.name===RIDER_CLIPS.seated);
        if(reference)c=THREE.AnimationUtils.makeClipAdditive(clip.clone(),0,reference,60);
      }
      this.actions[clip.name]=this.mixer.clipAction(c);
    }
    this.reset();
  }
  reset(){
    this.mixer.stopAllAction();this.mixer.setTime(0);
    for(const action of Object.values(this.actions))action.reset().setEffectiveWeight(0);
    for(const [bone,rest] of this.rest){bone.position.copy(rest.p);bone.quaternion.copy(rest.q);bone.scale.copy(rest.s);}
    this.state=null;this.previousStance=null;this.airborne=false;this.hold=0;this.lastShield=null;this.pendingShield=null;this.root.updateWorldMatrix(true,true);
  }
  events(events){const shield=events.find(e=>e.type==='shield');if(shield)this.pendingShield=shield;}
  update(g,delta,crankAngle=0){
    if(g.phase==='paused')return;
    delta=Math.max(0,delta);this.hold=Math.max(0,this.hold-delta);
    let state=riderState(g);
    const priority=['crash','kickStrikeL','kickStrikeR','kickChargeL','kickChargeR'].includes(state);
    if(priority)this.hold=0;
    const shield=this.pendingShield??g.events?.find(e=>e.type==='shield');this.pendingShield=null;
    if(shield&&shield!==this.lastShield){this.lastShield=shield;state='shield';this.hold=.4;}
    else if(!priority){
      if(this.hold>0)state=this.state;
      else if(this.airborne&&!g.jumpHeight){state='jumpLand';this.hold=.25;}
      else if(this.previousStance&&g.stance!==this.previousStance&&!g.jumpHeight){state=g.stance==='standing'?'sitToStand':'standToSit';this.hold=.35;}
    }
    this.airborne=g.jumpHeight>0;this.previousStance=g.stance;
    if(state!==this.state){
      const before=this.actions[RIDER_CLIPS[this.state]],next=this.actions[RIDER_CLIPS[state]];
      if(next){next.reset().setEffectiveWeight(1).setLoop(ONCE.has(state)?THREE.LoopOnce:THREE.LoopRepeat,ONCE.has(state)?1:Infinity);next.clampWhenFinished=ONCE.has(state);next.play();if(before)before.crossFadeTo(next,.15,false);}
      this.state=state;
    }
    const pedal=this.actions[RIDER_CLIPS.seated];
    if(pedal){pedal.paused=true;pedal.time=((crankAngle/(Math.PI*2))%1+1)%1*pedal.getClip().duration;}
    for(const side of ['L','R']){
      const a=this.actions[RIDER_CLIPS['lean'+side]];if(a){a.play();a.paused=true;a.time=a.getClip().duration;a.setEffectiveWeight(Math.min(1,Math.max(0,(side==='L'?-1:1)*(g.lateralSpeed||0)/3.5)));}
    }
    if(state==='kickStrikeL'||state==='kickStrikeR'){const strike=this.actions[RIDER_CLIPS[state]];if(strike){strike.paused=true;strike.time=Math.max(0,Math.min(1,1-g.kickPose/.7))*strike.getClip().duration;}}
    this.mixer.update(delta);this.root.updateWorldMatrix(true,true);
  }
  applyContactPose({torso,legs,arms}){
    const desired={};
    const put=(name,p,q)=>{const bone=this.bones[name],rest=this.restWorld[name];if(!bone||!rest)return;desired[name]=new THREE.Matrix4().compose(p,q.clone().multiply(rest.q),new THREE.Vector3(1,1,1));};
    put('BalanceBody',torso.position,torso.quaternion);
    for(let i=0;i<2;i++){
      const tag=i===0?'L':'R',l=legs[i],a=arms[i];
      if(l){
        const ru=this.restWorld['Knee_'+tag].p.clone().sub(this.restWorld['Leg_'+tag].p),rl=this.restWorld['Foot_'+tag].p.clone().sub(this.restWorld['Knee_'+tag].p);
        const k=l.hip.clone().add(ru.applyQuaternion(l.upper)),kq=l.upper.clone().multiply(l.lower),f=k.clone().add(rl.applyQuaternion(kq));
        put('Leg_'+tag,l.hip,l.upper);put('Knee_'+tag,k,kq);put('Foot_'+tag,f,kq.clone().multiply(l.foot));
      }
      if(a){
        const shoulder=vector(REST['Arm_'+tag]).sub(vector(REST.BalanceBody)).applyQuaternion(torso.quaternion).add(torso.position),uq=torso.quaternion.clone().multiply(a.upper);
        const elbow=vector(REST['Elbow_'+tag]).sub(vector(REST['Arm_'+tag])).applyQuaternion(uq).add(shoulder),lq=uq.clone().multiply(a.lower),hand=vector(REST['Hand_'+tag]).sub(vector(REST['Elbow_'+tag])).applyQuaternion(lq).add(elbow);
        put('Arm_'+tag,shoulder,uq);put('Elbow_'+tag,elbow,lq);put('Hand_'+tag,hand,lq.clone().multiply(a.hand));
      }
    }
    // Parent-first traversal works with either glTF armature root convention.
    this.root.updateWorldMatrix(true,true);
    this.root.traverse(bone=>{const m=desired[bone.name.replace(/^DEF-/,'')];if(!bone.isBone||!m)return;
      const world=this.root.matrixWorld.clone().multiply(m),local=bone.parent.matrixWorld.clone().invert().multiply(world);
      local.decompose(bone.position,bone.quaternion,bone.scale);bone.updateWorldMatrix(false,true);
    });
    this.root.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
  }
}
