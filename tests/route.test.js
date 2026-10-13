import test from 'node:test';
import assert from 'node:assert/strict';
import { roadAt as gameRoadAt } from '../src/game.ts';

const route = await import('../src/route.ts').catch(() => ({}));
const fn = name => {
  assert.equal(typeof route[name], 'function', `route.ts must export ${name}`);
  return route[name];
};
const near = (actual, expected, tolerance = 1e-8) => assert.ok(
  Math.abs(actual - expected) < tolerance, `${actual} must be near ${expected}`,
);
const nearObject = (actual, expected, tolerance) => {
  for (const [key, value] of Object.entries(expected)) near(actual[key], value, tolerance);
};
const c = Math.SQRT1_2;
const curved = {
  mode: 'endless', seed: 1, chunkLength: 80, lookAhead: 480, procedural: false, step: 2,
  road: { period: 8, advance: { x: 4, y: -1.6, z: 4 } },
  points: [
    { s: 0, x: 0, y: 0, z: 0, yaw: 0 },
    { s: 2, x: 0, y: -.4, z: 2, yaw: Math.PI / 4 },
    { s: 4, x: 2, y: -.8, z: 2, yaw: Math.PI / 2 },
    { s: 6, x: 4, y: -1.2, z: 2, yaw: Math.PI / 4 },
    { s: 8, x: 4, y: -1.6, z: 4, yaw: 0 },
  ],
};

test('periodic route extends author positions and slope through positive and negative cycles', () => {
  nearObject(gameRoadAt(curved, 10), { x: 4, y: -2, z: 6, yaw: Math.PI / 4, grade: .2 });
  nearObject(gameRoadAt(curved, -2), { x: 0, y: .4, z: -2, yaw: Math.PI / 4, grade: .2 });
  nearObject(gameRoadAt(curved, -8), { x: -4, y: 1.6, z: -4, yaw: 0, grade: .2 });
  nearObject(fn('roadAt')(curved, 3), { x: 1, y: -.6, z: 2, yaw: Math.PI * 3 / 8, grade: .2 });
});

test('authored yaw interpolates through the short angle across the pi boundary', () => {
  const data = { points: [{ s: 0, x: 0, y: 0, z: 0, yaw: Math.PI * 179 / 180 },
    { s: 2, x: 0, y: 0, z: 2, yaw: -Math.PI * 179 / 180 }], step: 2 };
  near(Math.abs(gameRoadAt(data, 1).yaw), Math.PI);
});

test('legacy finite points clamp at their endpoints and missing points remain a straight road', () => {
  const { road, ...finite } = curved;
  nearObject(gameRoadAt(finite, 20), { x: 4, y: -1.6, z: 4 });
  nearObject(gameRoadAt(finite, -20), { x: 0, y: 0, z: 0 });
  nearObject(gameRoadAt({}, -10), { x: 0, y: 0, z: -10, yaw: 0, grade: 0 });
});

test('positive lane stays on screen right in every route frame and lift stays vertical', () => {
  const position = fn('roadPosition');
  for (const s of [-2, 0, 2, 4, 6, 8, 1000000])
    nearObject(position(curved, s, 1.5, .75, s), { x: -1.5, y: .75, z: 0 });
  nearObject(position(curved, 4, 1, 0, 2), { x: c, y: -.4, z: 3 * c });
});

test('author positions and cycle roots share the current center and inverse yaw frame', () => {
  nearObject(fn('framePosition')(curved, { x: 2, y: .6, z: 2 }, 2), { x: 2 * c, y: 1, z: 2 * c });
  nearObject(fn('frameQuaternion')(curved, 2), { x: 0, y: -Math.sin(Math.PI / 8), z: 0, w: Math.cos(Math.PI / 8) });
  nearObject(fn('cyclePosition')(curved, 3, 10), { x: 2 * c, y: -2.8, z: 14 * c });
});

test('road orientation composes relative yaw followed by downhill pitch', () => {
  const q = fn('roadQuaternion')(curved, 4, 0), pitch = Math.atan(.2) / 2;
  nearObject(q, { x: c * Math.sin(pitch), y: c * Math.cos(pitch),
    z: -c * Math.sin(pitch), w: c * Math.cos(pitch) });
  const forward = { x: 2 * (q.x * q.z + q.w * q.y),
    y: 2 * (q.y * q.z - q.w * q.x), z: 1 - 2 * (q.x * q.x + q.y * q.y) };
  nearObject(forward, { x: 1 / Math.sqrt(1.04), y: -.2 / Math.sqrt(1.04), z: 0 });
  nearObject(fn('roadQuaternion')(curved, 2, 2), { x: Math.sin(pitch), y: 0, z: 0, w: Math.cos(pitch) });
});

test('rebasing translates positions while only rotating velocity and orientation', () => {
  const p = { x: 2, y: 3, z: 5 }, v = { x: 2, y: 3, z: 5 }, q = { x: 0, y: c, z: 0, w: c };
  const moved = fn('rebasePosition')(curved, p, 2, 4);
  nearObject(moved, { x: -3 * c, y: 3.4, z: 7 * c - 2 });
  const velocity = fn('rebaseVector')(curved, v, 2, 4);
  nearObject(velocity, { x: -3 * c, y: 3, z: 7 * c });
  const rotated = fn('rebaseQuaternion')(curved, q, 2, 4);
  nearObject(rotated, { x: 0, y: Math.sin(Math.PI / 8), z: 0, w: Math.cos(Math.PI / 8) });
  nearObject(fn('rebasePosition')(curved, moved, 4, 2), p);
  nearObject(fn('rebaseVector')(curved, velocity, 4, 2), v);
  nearObject(fn('rebaseQuaternion')(curved, rotated, 4, 2), q);
  near(Math.hypot(...Object.values(velocity)), Math.sqrt(38));
});

test('local route coordinates stay small after a million metres of period extension', () => {
  const position = fn('roadPosition');
  nearObject(position(curved, 1000006, 2, 1, 1000000), { x: 4 - 2 * c, y: -.2, z: 2 + 2 * c }, 1e-7);
});
