import RAPIER,{type RigidBody,type World} from '@dimforge/rapier3d-compat';
import {FIXED_STEP,clamp,type Course,type GameState,type ObstacleState} from './game.ts';
import {roadAt,roadPosition,roadQuaternion,frameQuaternion,cyclePosition,rebasePosition,rebaseVector,
  rebaseQuaternion,type XYZ,type XYZW} from './route.ts';

export interface CollisionSurface {vertices:Float32Array;indices:Uint32Array;segment?:number}
interface Pose {position:XYZ;rotation:XYZW}
let initialized:Promise<void>|undefined;
// m/s per unit mass. A lower, rolling arc keeps the flip inside the chase camera for ~1 s instead of leaving the top edge.
export const KICK_IMPULSE=Object.freeze({outward:5.5,up:7.5,forward:6,roll:5.5});
const zero={x:0,y:0,z:0};
const pose=(g:GameState,o?:ObstacleState):Pose=>{
  const q=roadQuaternion(g.course,o?.s??g.s,g.s);
  return {position:roadPosition(g.course,o?.s??g.s,o?.lane??g.lane,o?(o.lift??0):g.jumpHeight,g.s),
    rotation:o&&(o.speed??0)<0?{x:-q.z,y:q.w,z:q.x,w:-q.y}:q};
};
function snap(body:RigidBody,{position,rotation}:Pose){
  body.setTranslation(position,true);body.setRotation(rotation,true);
  body.setNextKinematicTranslation(position);body.setNextKinematicRotation(rotation);
  body.setLinvel(zero,true);body.setAngvel(zero,true);
}
function blendRotation(a:XYZW,b:XYZW,t:number):XYZW{
  const sign=a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w<0?-1:1;
  const x=a.x*(1-t)+sign*b.x*t,y=a.y*(1-t)+sign*b.y*t;
  const z=a.z*(1-t)+sign*b.z*t,w=a.w*(1-t)+sign*b.w*t,n=Math.hypot(x,y,z,w);
  return {x:x/n,y:y/n,z:z/n,w:w/n};
}

// Results use the arcade swept collision; Rapier handles kicked traffic on authored surfaces.
export class ScenePhysics {
  readonly world:World;
  readonly player:RigidBody;
  readonly vehicles=new Map<string,RigidBody>();
  private course:Course;
  private roadRoots:RigidBody[]=[];
  private roadHeadings=new Map<string,number>();
  private launched=new Set<string>();
  private accumulator=0;
  private lastDistance=0;
  static async create(course:Course,surfaces:CollisionSurface[]){
    initialized??=RAPIER.init();await initialized;
    return new ScenePhysics(course,surfaces);
  }
  private constructor(course:Course,surfaces:CollisionSurface[]){
    this.course=course;
    this.world=new RAPIER.World({x:0,y:-9.81,z:0});this.world.timestep=FIXED_STEP;
    if(surfaces.some(s=>s.segment!==undefined))
      this.roadRoots=Array.from({length:2},()=>this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
    for(const surface of surfaces){
      const roots=surface.segment===undefined?[undefined]:this.roadRoots;
      for(const root of roots)this.world.createCollider(RAPIER.ColliderDesc.trimesh(surface.vertices,surface.indices,
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES_TWO_SIDED).setFriction(.8).setRestitution(.12),root);
    }
    this.player=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(.35,1.35,1.05).setTranslation(0,1.35,0).setSensor(true),this.player);
    this.moveGround(0);
  }
  private moveGround(origin:number){
    const cycle=Math.floor((origin-80)/(this.course.road?.period??1600));
    const rotation=frameQuaternion(this.course,origin);
    for(const [i,body]of this.roadRoots.entries()){
      body.setTranslation(cyclePosition(this.course,cycle+i,origin),false);body.setRotation(rotation,false);
    }
  }
  private rebaseBody(body:RigidBody,oldS:number,newS:number){
    const position=rebasePosition(this.course,body.translation(),oldS,newS);
    const rotation=rebaseQuaternion(this.course,body.rotation(),oldS,newS);
    body.setTranslation(position,false);body.setRotation(rotation,false);
    if(body.isDynamic()){
      body.setLinvel(rebaseVector(this.course,body.linvel(),oldS,newS),false);
      body.setAngvel(rebaseVector(this.course,body.angvel(),oldS,newS),false);
    }else{
      body.setNextKinematicTranslation(position);body.setNextKinematicRotation(rotation);
    }
  }
  private reconcile(g:GameState){
    const ids=new Set(g.obstacles.filter(o=>o.type==='truck'||o.type==='car').map(o=>o.id));
    for(const [id,body]of this.vehicles)if(!ids.has(id)){
      this.world.removeRigidBody(body);this.vehicles.delete(id);this.launched.delete(id);this.roadHeadings.delete(id);
    }
    for(const o of g.obstacles){
      if((o.type!=='truck'&&o.type!=='car')||this.vehicles.has(o.id))continue;
      const truck=o.type==='truck';
      const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setLinearDamping(.12).setAngularDamping(.18).setCcdEnabled(true));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(truck?1.3:.9,truck?1.3:.65,truck?2.45:1.7)
        .setTranslation(0,truck?1.3:.65,0).setMass(truck?4000:1100).setFriction(.65).setRestitution(.18),body);
      snap(body,pose(g,o));this.vehicles.set(o.id,body);this.roadHeadings.set(o.id,roadAt(this.course,o.s).yaw);
    }
  }
  reset(g:GameState){
    for(const body of this.vehicles.values())this.world.removeRigidBody(body);
    this.vehicles.clear();this.launched.clear();this.roadHeadings.clear();this.accumulator=0;this.lastDistance=g.s;
    this.moveGround(g.s);this.reconcile(g);snap(this.player,pose(g));
    this.world.propagateModifiedBodyPositionsToColliders();
  }
  // carry: rider speed, so the launched vehicle tumbles ahead of the chase camera instead of falling behind it.
  release(id:string,side:1|-1,carry=0){
    const body=this.vehicles.get(id);if(!body||this.launched.has(id))return;
    const yaw=(this.roadHeadings.get(id)??0)-roadAt(this.course,this.lastDistance).yaw;
    const c=Math.cos(yaw),s=Math.sin(yaw);
    body.setEnabled(true);body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);
    body.recomputeMassPropertiesFromColliders();const mass=body.mass(),inertia=body.principalInertia();
    const forward=KICK_IMPULSE.forward+Math.max(0,carry),out=KICK_IMPULSE.outward;
    body.applyImpulse({x:(-side*out*c+forward*s)*mass,y:KICK_IMPULSE.up*mass,z:(side*out*s+forward*c)*mass},true);
    const tx=inertia.x*1.2,tz=inertia.z*KICK_IMPULSE.roll*side;
    body.applyTorqueImpulse({x:tx*c+tz*s,y:inertia.y*1.6*side,z:-tx*s+tz*c},true);
    this.launched.add(id);
  }
  sync(g:GameState,dt:number){
    if(g.phase==='paused'||g.phase==='finished'){this.accumulator=0;return;}
    if(g.s!==this.lastDistance){
      this.rebaseBody(this.player,this.lastDistance,g.s);
      for(const body of this.vehicles.values())this.rebaseBody(body,this.lastDistance,g.s);
    }
    this.lastDistance=g.s;this.moveGround(g.s);this.reconcile(g);
    const targets:Array<{body:RigidBody;start:XYZ;startRotation:XYZW;target:Pose}>=[];
    const queue=(body:RigidBody,target:Pose)=>targets.push({body,start:body.translation(),startRotation:body.rotation(),target});
    queue(this.player,pose(g));
    for(const o of g.obstacles){
      const body=this.vehicles.get(o.id);if(!body)continue;
      this.roadHeadings.set(o.id,roadAt(this.course,o.s).yaw);
      if(o.kicked&&!this.launched.has(o.id)){snap(body,pose(g,o));this.release(o.id,o.kickSide??1,g.speed);}
      if(this.launched.has(o.id)){body.setEnabled(o.flight<3);continue;}
      const nearby=o.s-g.s>-60&&o.s-g.s<240;
      if(nearby&&!body.isEnabled())snap(body,pose(g,o));
      body.setEnabled(nearby);if(nearby)queue(body,pose(g,o));
    }
    if(g.phase!=='racing'){
      for(const {body,target}of targets)snap(body,target);
      this.world.propagateModifiedBodyPositionsToColliders();this.accumulator=0;return;
    }
    this.world.propagateModifiedBodyPositionsToColliders();
    this.accumulator+=clamp(dt,0,.1);
    const steps=Math.floor((this.accumulator+1e-9)/FIXED_STEP);
    for(let i=1;i<=steps;i++){
      const t=i/steps;
      for(const {body,start,startRotation,target}of targets){
        const p=target.position;
        body.setNextKinematicTranslation({x:start.x+(p.x-start.x)*t,y:start.y+(p.y-start.y)*t,z:start.z+(p.z-start.z)*t});
        body.setNextKinematicRotation(blendRotation(startRotation,target.rotation,t));
      }
      this.world.step();
    }
    this.accumulator=Math.max(0,this.accumulator-steps*FIXED_STEP);
  }
  dispose(){this.world.free();}
}
