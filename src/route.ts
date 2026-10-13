import type {Course} from './game.ts';

export interface XYZ {x:number;y:number;z:number}
export interface XYZW extends XYZ {w:number}
const rotateY = (v:XYZ, angle:number):XYZ => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return {x:v.x*c+v.z*s,y:v.y,z:-v.x*s+v.z*c};
};
const yawQuaternion = (yaw:number):XYZW => ({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)});

export function roadAt(course:Course, s:number) {
  const points = course.points;
  if (!points || points.length < 2) return {x:0,y:0,z:s,yaw:0,grade:0};
  const cycle = course.road ? Math.floor(s/course.road.period) : 0;
  const localS = course.road ? s-cycle*course.road.period : s;
  const i = Math.max(0,Math.min(points.length-2,Math.floor((localS-points[0].s)/(course.step ?? 4))));
  const a = points[i], b = points[i+1], t = Math.max(0,Math.min(1,(localS-a.s)/(b.s-a.s)));
  const tangent = Math.atan2(b.x-a.x,b.z-a.z), yawA = a.yaw ?? tangent, yawB = b.yaw ?? tangent;
  const yawDelta = Math.atan2(Math.sin(yawB-yawA),Math.cos(yawB-yawA));
  const advance = course.road?.advance;
  return {x:a.x+(b.x-a.x)*t+cycle*(advance?.x ?? 0),
    y:a.y+(b.y-a.y)*t+cycle*(advance?.y ?? 0),
    z:a.z+(b.z-a.z)*t+cycle*(advance?.z ?? 0),
    yaw:yawA+yawDelta*t,grade:(a.y-b.y)/(Math.hypot(b.x-a.x,b.z-a.z) || 1)};
}

export function framePosition(course:Course, world:XYZ, originS:number):XYZ {
  const origin = roadAt(course,originS);
  return rotateY({x:world.x-origin.x,y:world.y-origin.y,z:world.z-origin.z},-origin.yaw);
}

export function frameQuaternion(course:Course, originS:number):XYZW {
  return yawQuaternion(-roadAt(course,originS).yaw);
}

export function roadPosition(course:Course, s:number, lane=0, lift=0, origin=0):XYZ {
  const road = roadAt(course,s);
  return framePosition(course,{x:road.x-lane*Math.cos(road.yaw),y:road.y+lift,
    z:road.z+lane*Math.sin(road.yaw)},origin);
}

export function roadQuaternion(course:Course, s:number, origin=0):XYZW {
  const road = roadAt(course,s), halfYaw = (road.yaw-roadAt(course,origin).yaw)/2;
  const halfPitch = Math.atan(road.grade)/2, sy = Math.sin(halfYaw), cy = Math.cos(halfYaw);
  const sp = Math.sin(halfPitch), cp = Math.cos(halfPitch);
  return {x:cy*sp,y:sy*cp,z:-sy*sp,w:cy*cp};
}

export function cyclePosition(course:Course, cycleIndex:number, originS:number):XYZ {
  const advance = course.road?.advance;
  return framePosition(course,{x:cycleIndex*(advance?.x ?? 0),y:cycleIndex*(advance?.y ?? 0),
    z:cycleIndex*(advance?.z ?? 0)},originS);
}

export function rebasePosition(course:Course, p:XYZ, oldS:number, newS:number):XYZ {
  const old = roadAt(course,oldS), world = rotateY(p,old.yaw);
  return framePosition(course,{x:world.x+old.x,y:world.y+old.y,z:world.z+old.z},newS);
}

export function rebaseVector(course:Course, v:XYZ, oldS:number, newS:number):XYZ {
  return rotateY(v,roadAt(course,oldS).yaw-roadAt(course,newS).yaw);
}

export function rebaseQuaternion(course:Course, q:XYZW, oldS:number, newS:number):XYZW {
  const halfYaw = (roadAt(course,oldS).yaw-roadAt(course,newS).yaw)/2;
  const c = Math.cos(halfYaw), s = Math.sin(halfYaw);
  return {x:c*q.x+s*q.z,y:c*q.y+s*q.w,z:c*q.z-s*q.x,w:c*q.w-s*q.y};
}
