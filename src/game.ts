export type Phase = 'ready'|'countdown'|'racing'|'paused'|'finished';
export type ObstacleKind = 'barrier'|'crate'|'wall'|'train'|'truck'|'car'|'pedestrian'|'goat';
export type PickupKind = 'banana'|'boost'|'shield'|'double';
export interface RoadPoint {s:number;x:number;y:number;z:number;yaw?:number}
export interface ObstacleDefinition {
  id:string;type:ObstacleKind;s:number;lane:number;crossing?:boolean;seed?:number;
  frequency?:number;speed?:number;lift?:number;
}
export interface ObstacleState extends ObstacleDefinition {
  originalLane:number;kicked:boolean;hit:boolean;passed:boolean;jumpCleared:boolean;flight:number;kickSide?:1|-1;
}
export interface PickupDefinition {id:string;type:PickupKind;s:number;lane:number;height:number}
export interface PickupState extends PickupDefinition {collected:boolean}
export interface Course {
  mode:'endless';seed:number;chunkLength:80;lookAhead:480;procedural?:boolean;
  obstacles?:ObstacleDefinition[];pickups?:PickupDefinition[];
  points?:RoadPoint[];step?:number;
  road?:{period:number;advance:{x:number;y:number;z:number}};
}
export interface PlayerInput {steer?:number;jump?:boolean;kick?:boolean;dash?:boolean}
export type GameEvent =
  |{type:'pickup';kind:PickupKind;count:number;points:number}
  |{type:'kick';id:string;charged:boolean}|{type:'miss';charged:boolean}
  |{type:'collision'|'shield';id:string}|{type:'stunt';points:number;label:string}
  |{type:'jump'|'launch'|'go'|'finish'|'dash'};
export interface Handling {
  steerSpeed:number;steerResponse:number;laneLimit:number;chargeSteerFactor:number;
  jumpVelocity:number;gravity:number;
}
export const DEFAULT_HANDLING:Readonly<Handling> = Object.freeze({
  steerSpeed:3.5,steerResponse:9,laneLimit:4.6,chargeSteerFactor:.65,
  jumpVelocity:6.4,gravity:14.5,
});
export interface GameState {
  course:Course;handling:Handling;phase:Phase;resumePhase:'countdown'|'racing';
  stance:'seated'|'standing';
  s:number;lane:number;lateralSpeed:number;speed:number;baseSpeed:number;elapsed:number;
  score:number;bananas:number;combo:number;chain:number;chainTimer:number;
  countdown:number;accumulator:number;jumpHeight:number;jumpVelocity:number;airTime:number;
  charge:number;kickPose:number;kickSide:1|-1;kickedCount:number;invulnerable:number;
  cooldowns:{kick:number;dash:number};buffs:{boost:number;shield:number;double:number};held:{jump:boolean;dash:boolean};
  events:GameEvent[];failure:string;endReason:'collision'|'quit'|'';
  obstacles:ObstacleState[];pickups:PickupState[];nextChunk:number;
}
export const FIXED_STEP = 1 / 60;
// E sprint: a short boost-buff burst on its own cooldown; it never shortens a longer boost pickup.
export const DASH = Object.freeze({duration:1.5,cooldown:6});
export const clamp = (v:number, min:number, max:number) => Math.max(min, Math.min(max, v));
export const obstacleSpecs:Readonly<Record<ObstacleKind,{width:number;length:number;height:number;jumpable:boolean}>> = {
  barrier:{width:2.2,length:.7,height:.5,jumpable:true},
  crate:{width:1.5,length:1.2,height:.85,jumpable:true},
  wall:{width:3.2,length:1,height:2.8,jumpable:false},
  train:{width:2.6,length:14,height:3,jumpable:false},
  truck:{width:2.6,length:4.9,height:2.6,jumpable:false},
  car:{width:1.8,length:3.4,height:1.3,jumpable:false},
  pedestrian:{width:.7,length:.7,height:1.8,jumpable:false},
  goat:{width:.8,length:1.2,height:.8,jumpable:true},
};

export {roadAt} from './route.ts';

const freshObstacle = (o:ObstacleDefinition):ObstacleState => ({...o,originalLane:o.lane,
  kicked:false,hit:false,passed:false,jumpCleared:false,flight:0});

export function createGame(course:Course, handling:Partial<Handling> = {}):GameState {
  const g:GameState = {
    course,handling:{...DEFAULT_HANDLING,...handling},phase:'ready',resumePhase:'racing',stance:'seated',
    s:0,lane:0,lateralSpeed:0,speed:0,baseSpeed:12,elapsed:0,score:0,bananas:0,
    combo:1,chain:0,chainTimer:0,countdown:3,accumulator:0,jumpHeight:0,jumpVelocity:0,airTime:0,
    charge:0,kickPose:0,kickSide:1,kickedCount:0,invulnerable:0,
    cooldowns:{kick:0,dash:0},buffs:{boost:0,shield:0,double:0},held:{jump:false,dash:false},
    events:[],failure:'',endReason:'',obstacles:(course.obstacles ?? []).map(freshObstacle),
    pickups:(course.pickups ?? []).map(p => ({...p,collected:false})),nextChunk:0,
  };
  rollCourse(g);
  return g;
}

export function startRun(g:GameState) {
  if (g.phase !== 'ready') return;
  g.phase = 'countdown'; g.countdown = 3; g.accumulator = 0;
  g.events.push({type:'launch'});
}

export function toggleStance(g:GameState) {
  if (g.phase === 'ready' || g.phase === 'countdown' || g.phase === 'racing')
    g.stance = g.stance === 'seated' ? 'standing' : 'seated';
}

export function togglePause(g:GameState) {
  if (g.phase === 'countdown' || g.phase === 'racing') {
    g.resumePhase = g.phase; g.phase = 'paused';
  } else if (g.phase === 'paused') g.phase = g.resumePhase;
  else return;
  g.charge = 0; g.held.jump = false; g.held.dash = false; g.accumulator = 0;
}

function finish(g:GameState, reason:'collision'|'quit') {
  g.phase = 'finished'; g.endReason = reason; g.speed = 0; g.lateralSpeed = 0; g.charge = 0;
  g.failure = reason === 'collision' ? '撞上障碍，本局结束。' : '';
  g.events.push({type:'finish'});
}

export function endRun(g:GameState) {
  if (g.phase === 'countdown' || g.phase === 'racing' || g.phase === 'paused') finish(g, 'quit');
}

function resetChain(g:GameState) {g.chain = 0; g.combo = 1; g.chainTimer = 0;}

function reward(g:GameState, base:number) {
  g.chain++; g.chainTimer = 2.5; g.combo = Math.min(2, 1 + Math.floor(g.chain / 5) * .2);
  const points = Math.round(base * g.combo * (g.buffs.double > 0 ? 2 : 1));
  g.score += points;
  return points;
}

function kickTarget(g:GameState, maxDistance=9) {
  return g.obstacles.filter(o => !o.kicked && !o.hit &&
    (o.type === 'truck' || o.type === 'car') && o.s - g.s >= -2 && o.s - g.s <= maxDistance &&
    Math.abs(o.lane - g.lane) <= 3.2)
    .sort((a,b) => Math.abs(a.s-g.s) - Math.abs(b.s-g.s))[0];
}

function kick(g:GameState) {
  const charged = g.charge >= .8 - 1e-9;
  g.kickPose = .7; g.cooldowns.kick = 18;
  const target = kickTarget(g);
  if (target && (charged || target.type === 'car')) {
    target.kicked = true; target.flight = 0; target.kickSide = target.lane >= g.lane ? 1 : -1;
    g.kickSide = target.kickSide; g.kickedCount++; reward(g, target.type === 'truck' ? 200 : 100);
    g.events.push({type:'kick',id:target.id,charged});
  } else g.events.push({type:'miss',charged});
  g.charge = 0;
}

// Intersect the time intervals of each relative-motion slab, including sideways crossings.
function sweep(axes:Array<[number,number,number]>):[number,number]|null {
  let enter = 0, leave = 1;
  for (const [before, after, extent] of axes) {
    const change = after - before;
    if (Math.abs(change) < 1e-12) {if (Math.abs(before) > extent) return null; continue;}
    const a = (-extent-before)/change, b = (extent-before)/change;
    enter = Math.max(enter, Math.min(a,b)); leave = Math.min(leave, Math.max(a,b));
    if (enter > leave) return null;
  }
  return [enter,leave];
}

const remaining = (time:number, dt:number) => time - dt > 1e-9 ? time - dt : 0;

function step(g:GameState, input:PlayerInput, dt:number) {
  if (g.phase === 'countdown') {
    g.countdown = remaining(g.countdown,dt);
    if (!g.countdown) {g.phase = 'racing'; g.speed = g.baseSpeed; g.events.push({type:'go'});}
    return;
  }
  if (g.phase !== 'racing') return;

  g.elapsed += dt;
  g.cooldowns.kick = remaining(g.cooldowns.kick,dt); g.cooldowns.dash = remaining(g.cooldowns.dash,dt);
  g.kickPose = remaining(g.kickPose,dt); g.invulnerable = remaining(g.invulnerable,dt);
  if (g.chainTimer < dt-1e-9) resetChain(g);
  else g.chainTimer = remaining(g.chainTimer,dt);
  for (const key of ['boost','shield','double'] as const) g.buffs[key] = remaining(g.buffs[key],dt);

  const oldS = g.s, oldLane = g.lane, oldHeight = g.jumpHeight;
  if (input.kick && !g.cooldowns.kick) g.charge = Math.min(1.2, g.charge + dt);
  if (!input.kick && g.charge > 0) kick(g);
  if (input.jump && !g.held.jump && !g.jumpHeight) {
    g.jumpVelocity = g.handling.jumpVelocity; g.jumpHeight = .01; g.airTime = 0;
    g.events.push({type:'jump'});
  }
  g.held.jump = !!input.jump;
  if (input.dash && !g.held.dash && !g.cooldowns.dash) {
    g.buffs.boost = Math.max(g.buffs.boost, DASH.duration); g.cooldowns.dash = DASH.cooldown;
    g.events.push({type:'dash'});
  }
  g.held.dash = !!input.dash;
  g.baseSpeed = Math.min(26, 12 + Math.floor((g.s+1e-8) / 250));
  g.speed = g.baseSpeed * (g.buffs.boost > 0 ? 1.25 : 1);
  g.s += g.speed * dt; g.score += (g.s-oldS) * (g.buffs.double > 0 ? 2 : 1);
  const h = g.handling;
  const target = clamp(input.steer || 0, -1, 1) * h.steerSpeed * (g.charge ? h.chargeSteerFactor : 1);
  g.lateralSpeed += (target-g.lateralSpeed) * Math.min(1,dt*h.steerResponse);
  g.lane = clamp(g.lane + g.lateralSpeed * dt, -h.laneLimit, h.laneLimit);
  if (g.jumpHeight > 0) {
    g.airTime += dt; g.jumpVelocity -= h.gravity * dt;
    g.jumpHeight = Math.max(0, g.jumpHeight + g.jumpVelocity * dt);
    if (!g.jumpHeight) g.jumpVelocity = 0;
  }
  rollCourse(g);

  for (const p of g.pickups) {
    if (p.collected || !sweep([[oldS-p.s,g.s-p.s,1.12],[oldLane-p.lane,g.lane-p.lane,.68],
      [oldHeight+1.25-p.height,g.jumpHeight+1.25-p.height,1]])) continue;
    p.collected = true;
    let points = 0;
    if (p.type === 'banana') {g.bananas++; points = reward(g,10);}
    else g.buffs[p.type] = p.type === 'boost' ? 5 : p.type === 'shield' ? 8 : 10;
    g.events.push({type:'pickup',kind:p.type,count:1,points});
  }

  for (const o of g.obstacles) {
    if (o.kicked) {o.flight += dt; continue;}
    const oldOS = o.s, oldOLane = o.lane;
    o.s += (o.speed ?? 0) * dt;
    if (o.crossing) o.lane = Math.sin(g.elapsed * (o.frequency ?? .25) + (o.seed ?? 0)) * 4;
    const spec = obstacleSpecs[o.type], extentS = spec.length / 2 + .8;
    const contact = sweep([[oldS-oldOS,g.s-o.s,extentS],
      [oldLane-oldOLane,g.lane-o.lane,spec.width/2+.36]]);
    const clear = contact ? Math.min(...contact.map(t => oldHeight+(g.jumpHeight-oldHeight)*t)) : 0;
    if (!o.hit && contact && (!spec.jumpable || clear <= spec.height+.1)) {
      o.hit = true;
      if (!g.invulnerable) {
        if (g.buffs.shield > 0) {
          g.buffs.shield = 0; g.invulnerable = .65; resetChain(g);
          g.events.push({type:'shield',id:o.id});
        } else {g.events.push({type:'collision',id:o.id}); finish(g,'collision'); return;}
      }
    }
    // Contact can end sideways before the rear edge is passed; retain that successful clearance.
    if (!o.hit && contact && spec.jumpable && clear > spec.height+.1) o.jumpCleared = true;
    if (!o.passed && g.s-o.s > extentS) {
      o.passed = true;
      if (!o.hit && o.jumpCleared) {
        const points = reward(g,50); g.events.push({type:'stunt',points,label:'跳跃越障'});
      }
    }
  }
  if (g.charge > 0) {
    // Choose the wind-up leg before an approached vehicle enters release range.
    const target = kickTarget(g, 9 + g.speed * .8);
    if (target) g.kickSide = target.lane >= g.lane ? 1 : -1;
  }
}

// A chunk seed depends only on its world index; pruning never changes future layouts.
function chunkRandom(seed:number, index:number) {
  let state = (seed ^ Math.imul(index + 1,0x9e3779b9)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function generateChunk(g:GameState, index:number) {
  // Keep the first two teaching chunks learnable; new run seeds vary the encounters after 160m.
  const rng = chunkRandom(index < 2 ? 137 : g.course.seed,index), start = index * g.course.chunkLength;
  let pickupIndex = 0;
  const pick = <T>(items:T[]) => items[Math.floor(rng() * items.length)];
  const addPickup = (type:PickupKind,s:number,lane:number,height=1.25) => g.pickups.push({
    id:`p:${index}:${pickupIndex++}`,type,s,lane,height,collected:false,
  });
  const encounter = (type:ObstacleKind, offset:number, lane:number, slot:number) => {
    const s = start + offset;
    const crossing = index > 3 && (type === 'goat' || type === 'pedestrian') && rng() < .5;
    const phase = rng()*Math.PI*2;
    const o = freshObstacle({id:`o:${index}:${slot}`,type,s,lane:crossing ? Math.sin(phase)*4 : lane,
      ...(crossing ? {crossing:true,seed:phase,frequency:.25} : {})});
    g.obstacles.push(o);
    for (let i = 0; i < 5; i++) {
      if (type === 'barrier') {
        const offsetS = (i-2)*3;
        addPickup('banana',s+offsetS,lane,1.25+.9*(1-Math.abs(offsetS)/6));
      } else if (crossing) addPickup('banana',s+8+i*2,0);
      else addPickup('banana',s+(i-2)*4,lane >= 0 ? -2.8 : 2.8);
    }
  };
  if (!index) {
    for (let s = 10; s <= 66; s += 8) addPickup('banana',s,0);
    encounter('barrier',76,0,0);
  } else if (index === 1) encounter('wall',64,0,1);
  else {
    encounter(pick<ObstacleKind>(['train','truck','car','wall','barrier']),24,pick([-2.4,0,2.4]),0);
    // A short second obstacle keeps even a 14m train's exit at least .9s from the next contact.
    encounter(pick<ObstacleKind>(['barrier','crate','wall','pedestrian','goat']),64,pick([-2.4,0,2.4]),1);
  }
  addPickup(pick<PickupKind>(index === 0 ? ['shield'] : ['boost','shield','double']),start+(index ? 10 : 22),0);
}

function rollCourse(g:GameState) {
  if (g.course.procedural === false) return;
  const behind = g.s - 80;
  g.nextChunk = Math.max(g.nextChunk, Math.max(0,Math.floor(behind/g.course.chunkLength)));
  while ((g.nextChunk+1)*g.course.chunkLength <= g.s+g.course.lookAhead+1e-9) generateChunk(g,g.nextChunk++);
  g.obstacles = g.obstacles.filter(o => o.s + obstacleSpecs[o.type].length / 2 >= behind);
  g.pickups = g.pickups.filter(p => p.s >= behind);
}

export function advance(g:GameState, input:PlayerInput, delta:number) {
  g.events = [];
  if (g.phase === 'paused' || g.phase === 'ready' || g.phase === 'finished') {g.accumulator = 0; return;}
  if (!Number.isFinite(delta) || delta <= 0) return;
  g.accumulator += Math.min(delta,.25);
  while (g.accumulator+1e-10 >= FIXED_STEP) {
    step(g,input,FIXED_STEP); g.accumulator = Math.max(0,g.accumulator-FIXED_STEP);
    if (g.endReason) {g.accumulator = 0; break;}
  }
}

export function resultFor(g:GameState) {
  return {total:Math.round(g.score),distance:Math.floor(g.s+1e-8),bananas:g.bananas,
    elapsed:g.elapsed,reason:g.endReason};
}
