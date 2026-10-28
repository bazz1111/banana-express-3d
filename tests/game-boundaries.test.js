import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, advance, togglePause, endRun } from '../src/game.ts';

const course = (obstacles = [], pickups = []) => ({
  mode: 'endless', seed: 137, chunkLength: 80, lookAhead: 480,
  procedural: false, obstacles, pickups,
});
const boosted = (obstacles = [], pickups = []) => {
  const g = createGame(course(obstacles, pickups));
  Object.assign(g, { phase: 'racing', s: 3500 });
  g.buffs.boost = 10;
  return g;
};
const run = (g, frames, input = {}) => {
  const events = [];
  for (let frame = 0; frame < frames; frame++) {
    advance(g, input, 1 / 60);
    events.push(...g.events);
  }
  return events;
};

test('a boosted jump keeps its reward after steering out of contact before passing the obstacle', () => {
  for (const fps of [30, 60, 120]) for (const side of [-1, 1]) {
    const g = createGame(course([{ id: 'barrier', type: 'barrier', s: 3506, lane: 0 }]));
    Object.assign(g, { phase: 'racing', s: 3500, lane: side });
    g.buffs.boost = 10;
    const events = [];
    for (let frame = 0; frame < fps; frame++) {
      advance(g, { jump: true, steer: side }, 1 / fps);
      events.push(...g.events);
    }
    assert.equal(g.speed, 32.5);
    assert.equal(g.phase, 'racing');
    assert.equal(g.obstacles[0].passed, true);
    assert.deepEqual(events.filter(e => e.type === 'stunt').map(e => e.points), [50]);
    assert.ok(Math.abs(g.score - (g.s - 3500 + 50)) < 1e-8);
  }
});

test('maximum-speed diagonal contacts require overlapping lateral and longitudinal time intervals', () => {
  for (const side of [-1, 1]) for (const [s, phase] of [[3498.9, 'racing'], [3499.1, 'finished']]) {
    const g = boosted([{ id: 'barrier', type: 'barrier', s, lane: 0 }]);
    g.lane = side * 1.47;
    g.lateralSpeed = -side * 3.5;
    advance(g, { steer: -side }, 1 / 60);
    assert.equal(g.phase, phase, `side ${side}, obstacle at ${s}`);
    assert.equal(g.events.filter(e => e.type === 'collision').length, phase === 'finished' ? 1 : 0);
  }
});

test('a safe airborne contact can pause before passage and still award exactly once after resuming', () => {
  const g = boosted([{ id: 'barrier', type: 'barrier', s: 3506, lane: 0 }]);
  g.lane = 1;
  assert.equal(run(g, 12, { jump: true, steer: 1 }).filter(e => e.type === 'stunt').length, 0);
  assert.equal(g.obstacles[0].passed, false);
  togglePause(g);
  const before = [g.s, g.elapsed, g.score, g.jumpHeight, g.buffs.boost];
  advance(g, { steer: -1, jump: true, kick: true, dash: true }, 30);
  assert.deepEqual([g.s, g.elapsed, g.score, g.jumpHeight, g.buffs.boost], before);
  togglePause(g);
  assert.deepEqual(run(g, 60, { steer: 1 }).filter(e => e.type === 'stunt').map(e => e.points), [50]);
  endRun(g);
  assert.equal(run(g, 60, { jump: true, kick: true, dash: true }).length, 0);
  const fresh = createGame(g.course);
  assert.equal(fresh.obstacles[0].passed, false);
  assert.equal(fresh.score, 0);
});

test('landing onto a previously cleared obstacle consumes the shield and cancels its jump reward', () => {
  const g = boosted([{ id: 'barrier', type: 'barrier', s: 3502.2, lane: 0 }]);
  Object.assign(g, { jumpHeight: .8, jumpVelocity: -2 });
  g.buffs.shield = 8;
  const events = run(g, 30);
  assert.equal(g.phase, 'racing');
  assert.equal(g.obstacles[0].hit, true);
  assert.equal(events.filter(e => e.type === 'shield').length, 1);
  assert.equal(events.filter(e => e.type === 'stunt').length, 0);
  assert.ok(Math.abs(g.score - (g.s - 3500)) < 1e-8);
});

test('jumping beside an obstacle gives no reward and same-step shield pickup protects a boosted collision', () => {
  const outside = boosted([{ id: 'barrier', type: 'barrier', s: 3506, lane: 0 }]);
  outside.lane = 3;
  assert.equal(run(outside, 60, { jump: true }).filter(e => e.type === 'stunt').length, 0);
  const g = boosted([{ id: 'wall', type: 'wall', s: 3501.7, lane: 0 }], [
    { id: 'shield', type: 'shield', s: 3501.3, lane: 0, height: 1.25 },
    { id: 'banana', type: 'banana', s: 3501.3, lane: 0, height: 1.25 },
  ]);
  const events = run(g, 60);
  assert.equal(g.phase, 'racing');
  assert.equal(g.bananas, 1);
  assert.equal(g.buffs.shield, 0);
  assert.deepEqual(events.slice(0, 3).map(e => e.type), ['pickup', 'pickup', 'shield']);
  assert.equal(events.filter(e => e.type === 'pickup').length, 2);
  assert.equal(events.filter(e => e.type === 'shield').length, 1);
});

test('maximum-speed charge and sprint keep their independent cooldowns and launch the truck once', () => {
  const g = boosted([{ id: 'truck', type: 'truck', s: 3532, lane: 2 }]);
  g.buffs.boost = 0;
  const events = run(g, 48, { kick: true, dash: true });
  assert.equal(g.speed, 32.5);
  assert.equal(events.filter(e => e.type === 'dash').length, 1);
  advance(g, {}, 1 / 60);
  assert.equal(g.phase, 'racing');
  assert.equal(g.cooldowns.kick, 18);
  assert.ok(Math.abs(g.cooldowns.dash - 5.2) < 1e-8);
  assert.deepEqual(g.events.filter(e => e.type === 'kick'), [{ type: 'kick', id: 'truck', charged: true }]);
  assert.equal(g.kickedCount, 1);
  assert.ok(Math.abs(g.score - (g.s - 3500 + 200)) < 1e-8);
});
