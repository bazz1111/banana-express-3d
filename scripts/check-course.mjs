// Search sampled continuous steering, then replay it through the production rules.
// This is a bounded existence check, not a proof for all seeds or human difficulty.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createGame,advance,FIXED_STEP} from '../src/game.ts';

function initial(course,start,seconds,lane=0){
  const g=createGame(course);g.phase='racing';g.s=start;g.lane=lane;g.buffs.boost=seconds+10;
  g.pickups=[];advance(g,{},FIXED_STEP);g.pickups=[];
  return g;
}
const unassisted=g=>!g.invulnerable&&!g.buffs.shield&&!g.buffs.double&&!g.kickedCount&&
  !g.events.some(e=>e.type==='pickup'||e.type==='shield');
const copy=g=>({...g,events:[],objective:{...g.objective},held:{...g.held},buffs:{...g.buffs},cooldowns:{...g.cooldowns},
  obstacles:g.obstacles.map(o=>({...o})),pickups:[]});

export function findSteeringRoute(course,{start=0,seconds=12,beam=128,entryLanes=[0]}={}){
  if(!(Number.isFinite(start)&&start>=0&&Number.isFinite(seconds)&&seconds>0&&Number.isInteger(beam)&&beam>0&&entryLanes.length&&entryLanes.every(lane=>Number.isFinite(lane)&&Math.abs(lane)<=4.6)))throw new Error('Invalid route sample configuration');
  const step=.1,blocks=Math.ceil(seconds/step);let states=entryLanes.map(lane=>({g:initial(course,start,seconds,lane),parent:null}))
    .filter(node=>node.g.phase==='racing'&&unassisted(node.g)),tested=0;
  if(!states.length)throw new Error('No sampled steering route from an unassisted initial state');
  for(let block=0;block<blocks;block++){
    const unique=new Map();
    for(const state of states)for(const steer of [-1,0,1]){
      const g=copy(state.g);advance(g,{steer},step);tested++;
      if(g.phase!=='racing'||!unassisted(g))continue;
      const key=`${Math.round(g.lane*10)}:${Math.round(g.lateralSpeed*2)}`;
      if(!unique.has(key))unique.set(key,{g,parent:state,steer});
    }
    const pool=[...unique.values()].sort((a,b)=>a.g.lane-b.g.lane||a.g.lateralSpeed-b.g.lateralSpeed);
    if(!pool.length)throw new Error(`No sampled steering route for seed ${course.seed} at ${states[0].g.s.toFixed(2)}m`);
    // Retain coverage across the road and steering velocities instead of a left-biased prefix.
    states=pool.length<=beam?pool:Array.from({length:beam},(_,i)=>pool[Math.floor(i*pool.length/beam)]);
  }
  const inputs=[];let node=states[Math.floor(states.length/2)];
  for(;node.parent;node=node.parent)inputs.push(node.steer);
  return {start,lane:node.g.lane,seconds,step,beam,tested,inputs:inputs.reverse()};
}

export function replaySteeringRoute(course,route){
  const g=initial(course,route.start,route.seconds,route.lane);
  if(g.phase!=='racing'||!unassisted(g))throw new Error('Sampled route has an unsafe initial state');
  for(const steer of route.inputs){g.pickups=[];advance(g,{steer},route.step);if(g.phase!=='racing'||!unassisted(g))throw new Error('Sampled route failed unassisted production replay');}
  return g;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const seeds=[0,1,2,3,7,42,137,138,2817,2026,65535,0xffffffff];
  const results=[];
  for(const seed of seeds)for(const start of [0,4000,1000000]){
    const course={mode:'endless',seed,chunkLength:80,lookAhead:480};
    // At late-region checkpoints the entering lane is not necessarily the center.
    // A forced center teleport can start too close to a long train to steer away.
    const route=findSteeringRoute(course,{start,entryLanes:start?[-2.4,0,2.4]:[0]}),g=replaySteeringRoute(course,route);
    results.push({seed,...route,end:g.s,speed:g.speed,phase:g.phase,obstacles:g.obstacles.length});
  }
  const report={status:'pass',method:'Sampled continuous steering followed by exact production replay; no jump, kick, shield or invulnerability; boost and starting distance/lane are fixtures; late regions use three candidate entering lanes; pickups excluded; local route samples do not prove connectivity from every preceding lane',
    exhaustive:false,scenarios:results.length,results};
  const out=process.env.COURSE_REPORT||'artifacts/course-report.json';fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,scenarios:report.scenarios,output:out}));
}
