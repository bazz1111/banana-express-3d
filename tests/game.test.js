import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/game.ts';

const { createGame, advance, resultFor } = core;
const course = (obstacles = [], pickups = []) => ({
  mode: 'endless', seed: 137, chunkLength: 80, lookAhead: 480,
  procedural: false, obstacles, pickups,
});
const obstacle = (type, s, lane = 0, id = type) => ({ id, type, s, lane });
const pickup = (type, s, lane = 0, height = 1.25, id = `${type}:${s}`) => ({ id, type, s, lane, height });
const ticks = (g, seconds, input = {}, fps = 60) => {
  const events = [];
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    advance(g, input, 1 / fps); events.push(...g.events);
  }
  return events;
};
const racer = (c = course()) => {
  const g = createGame(c); g.phase = 'racing'; g.speed = 12;
  return g;
};
const near = (actual, expected, tolerance = 1e-8) => assert.ok(
  Math.abs(actual - expected) < tolerance, `${actual} must be near ${expected}`,
);

test('new runs begin seated and do not inherit a previous standing stance', () => {
  const g = createGame(course()); assert.equal(g.stance, 'seated');
  core.toggleStance(g); assert.equal(g.stance, 'standing');
  assert.equal(createGame(g.course).stance, 'seated');
});

test('riding stance switches in ready, countdown and racing without touching other rules', () => {
  assert.equal(typeof core.toggleStance, 'function');
  for (const phase of ['ready', 'countdown', 'racing']) {
    const g = createGame(course([obstacle('truck', 15, 2)], [pickup('banana', .2)]));
    g.phase = phase; g.speed = 15; g.score = 41; g.charge = .6;
    g.cooldowns.kick = 12; g.buffs = { boost: 4, shield: 7, double: 9 };
    g.events.push({ type: 'jump' });
    const before = structuredClone(g);
    core.toggleStance(g); assert.deepEqual(g, { ...before, stance: 'standing' });
    core.toggleStance(g); assert.deepEqual(g, before);
  }
});

test('paused and finished runs ignore stance toggles', () => {
  assert.equal(typeof core.toggleStance, 'function');
  for (const phase of ['paused', 'finished']) for (const stance of ['seated', 'standing']) {
    const g = createGame(course()); g.phase = phase; g.stance = stance;
    const before = structuredClone(g); core.toggleStance(g);
    assert.deepEqual(g, before);
  }
});

test('an explicit start enters a three-second countdown before automatic riding', () => {
  const g = createGame(course());
  assert.equal(g.phase, 'ready');
  ticks(g, 2); assert.equal(g.s, 0);
  core.startRun(g); assert.equal(g.phase, 'countdown');
  assert.ok(g.events.some(e => e.type === 'launch'));
  ticks(g, 2.5); assert.equal(g.phase, 'countdown'); assert.equal(g.s, 0);
  const events = ticks(g, .5);
  assert.equal(g.phase, 'racing'); assert.equal(g.countdown, 0);
  assert.equal(g.speed, 12); assert.equal(g.elapsed, 0);
  assert.equal(events.filter(e => e.type === 'go').length, 1);
  ticks(g, 1); near(g.s, 12); near(g.score, 12);
});

test('pause freezes countdown, motion, buffs and cooldowns and cancels held actions', () => {
  const g = createGame(course());
  assert.equal(typeof core.togglePause, 'function');
  core.startRun(g); ticks(g, .5); core.togglePause(g);
  const countdown = g.countdown; ticks(g, 10);
  assert.equal(g.phase, 'paused'); assert.equal(g.resumePhase, 'countdown');
  assert.equal(g.countdown, countdown);
  core.togglePause(g); ticks(g, 2.5); assert.equal(g.phase, 'racing');
  ticks(g, .2, { kick: true }); g.buffs.shield = 6; g.cooldowns.kick = 4;
  g.held.jump = true; core.togglePause(g);
  const before = [g.s, g.elapsed, g.buffs.shield, g.cooldowns.kick];
  ticks(g, 5, { steer: 1, kick: true, jump: true });
  assert.deepEqual([g.s, g.elapsed, g.buffs.shield, g.cooldowns.kick], before);
  assert.equal(g.charge, 0); assert.equal(g.held.jump, false); assert.equal(g.accumulator, 0);
  core.togglePause(g); advance(g, {}, 1 / 60);
  assert.equal(g.phase, 'racing'); assert.ok(g.s > before[0]);
  assert.ok(!g.events.some(e => e.type === 'miss'));
});

test('ending an active or paused run creates an integer result and freezes simulation', () => {
  const g = racer(); ticks(g, 2);
  assert.equal(typeof core.endRun, 'function');
  core.togglePause(g); core.endRun(g);
  assert.equal(g.phase, 'finished'); assert.equal(g.endReason, 'quit'); assert.equal(g.speed, 0);
  assert.equal(g.events.filter(e => e.type === 'finish').length, 1);
  assert.deepEqual(resultFor(g), { total: 24, distance: 24, bananas: 0, elapsed: g.elapsed, reason: 'quit' });
  const before = [g.s, g.score, g.elapsed]; ticks(g, 8);
  assert.deepEqual([g.s, g.score, g.elapsed], before);
});

test('speed rises by distance tiers and ignores the removed manual throttle controls', () => {
  const g = racer(); g.s = 250;
  advance(g, { throttle: true, brake: true }, 1 / 60);
  assert.equal(g.baseSpeed, 13); assert.equal(g.speed, 13);
  g.s = 3500; advance(g, {}, 1 / 60);
  assert.equal(g.baseSpeed, 26); assert.equal(g.speed, 26);
  g.buffs.boost = 5; advance(g, {}, 1 / 60); assert.equal(g.speed, 32.5);
  ticks(g, 5); assert.equal(g.speed, 26);
  const boundary = racer(); boundary.s = 244; ticks(boundary, .5);
  advance(boundary, {}, 1 / 60); assert.equal(boundary.speed, 13);
});

test('continuous steering retains its response and charging slows lateral movement', () => {
  const g = racer(), charged = racer();
  advance(g, { steer: 1 }, 1 / 60);
  advance(charged, { steer: 1, kick: true }, 1 / 60);
  near(g.lateralSpeed, .525); near(g.lane, .00875);
  near(charged.lateralSpeed, .34125);
  ticks(g, 4, { steer: 1 }); assert.equal(g.lane, 4.6);
  const tuned = createGame(course(), { laneLimit: 2 }); tuned.phase = 'racing';
  ticks(tuned, 4, { steer: 1 }); assert.equal(tuned.lane, 2);
  assert.equal(g.handling.laneLimit, 4.6);
});

test('fixed simulation steps produce equal movement and rewards at different render rates', () => {
  const runs = [30, 60, 120].map(fps => {
    const g = racer(course([], [pickup('banana', 50, 2)]));
    ticks(g, 30, { steer: .15 }, fps); return g;
  });
  for (const g of runs) {
    near(g.s, runs[0].s); near(g.lane, runs[0].lane); near(g.elapsed, 30);
    near(g.score, runs[0].score); assert.equal(g.bananas, runs[0].bananas);
  }
});

test('riding continues past the old endpoint and timeout without cargo', () => {
  const g = racer(); ticks(g, 270);
  assert.equal(g.phase, 'racing'); assert.ok(g.s > 2000);
  near(g.elapsed, 270, 1e-7); assert.equal(g.bananas, 0); assert.ok(g.score > 2000);
});

test('banana contact respects horizontal and vertical body reach', () => {
  const g = racer(course([], [
    pickup('banana', .2, 0, 1.25, 'ground'),
    pickup('banana', .2, 1.1, 1.25, 'side'),
    pickup('banana', .2, 0, 3.8, 'high'),
  ]));
  advance(g, {}, 1 / 60);
  assert.equal(g.bananas, 1); near(g.score, 10.2);
  assert.deepEqual(g.events.find(e => e.type === 'pickup'), { type: 'pickup', kind: 'banana', count: 1, points: 10 });
  const airborne = racer(course([], [pickup('banana', 5, 0, 2.5, 'arc'), pickup('banana', 5, 0, 1.25, 'below')]));
  ticks(airborne, .5, { jump: true });
  assert.equal(airborne.pickups.find(p => p.id === 'arc').collected, true);
  assert.equal(airborne.pickups.find(p => p.id === 'below').collected, false);
});

test('successive individual bananas raise the combo while a quiet gap resets it', () => {
  const bananas = Array.from({ length: 10 }, (_, i) => pickup('banana', .2, 0, 1.25, `b${i}`));
  const g = racer(course([], bananas)); advance(g, {}, 1 / 60);
  assert.equal(g.bananas, 10); assert.equal(g.chain, 10); near(g.combo, 1.4); near(g.score, 114.2);
  ticks(g, 2.6); assert.equal(g.chain, 0); assert.equal(g.combo, 1);
  g.pickups.push({ ...pickup('banana', g.s), collected: false }); advance(g, {}, 1 / 60);
  assert.equal(g.chain, 1); assert.equal(g.events.find(e => e.type === 'pickup').points, 10);
  const many = racer(course([], Array.from({ length: 30 }, (_, i) => pickup('banana', .2, 0, 1.25, `cap${i}`))));
  advance(many, {}, 1 / 60); assert.equal(many.combo, 2); near(many.score, 610.2);
});

test('a reward exactly two and a half seconds later still extends the chain', () => {
  const g = racer(course([], Array.from({ length: 5 }, (_, i) => pickup('banana', .2, 0, 1.25, `edge${i}`))));
  advance(g, {}, 1 / 60); assert.equal(g.chain, 5);
  ticks(g, 149 / 60);
  g.pickups.push({ ...pickup('banana', g.s + 1.32 - 1e-9), collected: false });
  advance(g, {}, 1 / 60);
  assert.equal(g.chain, 6); near(g.combo, 1.2);
  assert.equal(g.events.find(e => e.type === 'pickup').points, 12);
});

test('boost, shield and double coexist and repeat pickups refresh rather than stack', () => {
  const g = racer(course([], ['boost', 'shield', 'double'].map(type => pickup(type, .2))));
  advance(g, {}, 1 / 60);
  assert.deepEqual(g.buffs, { boost: 5, shield: 8, double: 10 }); assert.equal(g.chain, 0);
  ticks(g, 1);
  assert.equal(g.speed, 15); near(g.score, 30.2);
  g.pickups.push(...['boost', 'shield', 'double'].map(type => ({ ...pickup(type, g.s, 0, 1.25, `again:${type}`), collected: false })));
  advance(g, {}, 1 / 60);
  assert.deepEqual(g.buffs, { boost: 5, shield: 8, double: 10 }); assert.equal(g.speed, 15);
  g.pickups.push({ ...pickup('banana', g.s), collected: false }); advance(g, {}, 1 / 60);
  assert.equal(g.events.find(e => e.type === 'pickup').points, 20);
  assert.equal(g.bananas, 1);
});

test('unprotected swept contact ends the run and uses full obstacle dimensions', () => {
  const g = racer(course([obstacle('crate', 1)])); g.lane = 1.05;
  advance(g, {}, 1 / 60);
  assert.equal(g.phase, 'finished'); assert.equal(g.endReason, 'collision');
  assert.equal(g.obstacles[0].hit, true); assert.equal(g.speed, 0);
  assert.deepEqual(g.events.filter(e => ['collision', 'finish'].includes(e.type)).map(e => e.type), ['collision', 'finish']);
  const outside = racer(course([obstacle('crate', 1)])); outside.lane = 1.2;
  ticks(outside, .4); assert.equal(outside.phase, 'racing');
  const long = racer(course([obstacle('train', 7.7)])); advance(long, {}, 1 / 60);
  assert.equal(long.phase, 'finished', 'The 14m train front must be solid well before its center');
});

test('swept relative motion catches a fast crossing between simulation endpoints', () => {
  const g = racer(course([{ ...obstacle('wall', 2), speed: -400 }]));
  advance(g, {}, 1 / 60);
  assert.equal(g.phase, 'finished'); assert.equal(g.endReason, 'collision');
});

test('jumping clears a crate and awards only the successful obstacle crossing', () => {
  const g = racer(course([obstacle('crate', 5.4)]));
  let highest = 0; const events = [];
  for (let i = 0; i < 66; i++) {
    advance(g, { jump: true }, 1 / 60); highest = Math.max(highest, g.jumpHeight); events.push(...g.events);
  }
  assert.ok(highest > .95); assert.equal(g.phase, 'racing'); assert.equal(g.obstacles[0].passed, true);
  assert.equal(events.filter(e => e.type === 'jump').length, 1);
  assert.deepEqual(events.filter(e => e.type === 'stunt').map(e => e.points), [50]);
  assert.equal(g.chain, 1); near(g.score, g.s + 50); assert.equal(g.jumpHeight, 0);
  const late = racer(course([obstacle('barrier', 1)])); ticks(late, .1, { jump: true });
  assert.equal(late.phase, 'finished', 'Starting a jump while already touching a barrier must collide');
});

test('jumping cannot cross a tall train or wall even near the jump apex', () => {
  for (const type of ['train', 'wall']) {
    const g = racer(course([obstacle(type, 0)])); g.jumpHeight = 1.35; g.jumpVelocity = 0;
    advance(g, { jump: true }, 1 / 60); assert.equal(g.phase, 'finished', type);
  }
});

test('a shield consumes one collision, clears the chain and protects the full long contact', () => {
  const g = racer(course([obstacle('train', 5)], [pickup('shield', .2), pickup('banana', .2)]));
  const events = ticks(g, 1.5);
  assert.equal(g.phase, 'racing'); assert.equal(g.buffs.shield, 0); assert.equal(g.invulnerable, 0);
  assert.equal(g.obstacles[0].hit, true); assert.equal(g.chain, 0); assert.equal(g.combo, 1);
  assert.equal(events.filter(e => e.type === 'shield').length, 1);
  g.obstacles.push({ ...obstacle('wall', g.s), originalLane: 0, kicked: false, hit: false, passed: false, flight: 0 });
  advance(g, {}, 1 / 60); assert.equal(g.phase, 'finished');
});

test('a different obstacle touched during shield immunity cannot kill on a later repeated contact', () => {
  const g = racer(course([obstacle('barrier', 1), obstacle('train', 10)], [pickup('shield', .2)]));
  ticks(g, 1.4); assert.equal(g.phase, 'racing');
  assert.equal(g.obstacles[0].hit, true); assert.equal(g.obstacles[1].hit, true);
});

test('charged kicks launch trucks and award simulation points with an eight-second cooldown', () => {
  const g = racer(course([obstacle('truck', 15, 2)]));
  ticks(g, .8, { kick: true }); advance(g, {}, 1 / 60);
  assert.equal(g.obstacles[0].kicked, true); assert.equal(g.kickedCount, 1);
  assert.equal(g.cooldowns.kick, 8); assert.equal(g.charge, 0);
  assert.deepEqual(g.events.find(e => e.type === 'kick'), { type: 'kick', id: 'truck', charged: true });
  near(g.score, g.s + 200); ticks(g, .5, { kick: true });
  assert.ok(g.obstacles[0].flight > .4); assert.equal(g.charge, 0);
});

test('charge previews the release target side before a vehicle enters the nine-metre kick range', () => {
  for (const fps of [30, 60, 120]) for (const side of [-1, 1]) for (const type of ['truck', 'car']) {
    const g = racer(course([obstacle(type, 18.5, side * 2)])); g.kickSide = -side;
    assert.ok(g.obstacles[0].s - g.s > 9);
    for (let frame = 0; frame < fps * .8; frame++) {
      advance(g, { kick: true }, 1 / fps);
      if (g.charge > 0) assert.equal(g.kickSide, side, `${type}, frame ${frame}: preview must use the approached target`);
      assert.equal(g.obstacles[0].kicked, false);
    }
    const chargedSide = g.kickSide;
    assert.ok(g.obstacles[0].s - g.s <= 9);
    advance(g, {}, 1 / 60);
    assert.equal(g.kickSide, chargedSide); assert.equal(g.obstacles[0].kickSide, chargedSide);
    assert.equal(g.kickedCount, 1); assert.equal(g.cooldowns.kick, 8);
    assert.deepEqual(g.events.find(event => event.type === 'kick'), { type: 'kick', id: type, charged: true });
  }
});

test('wind-up uses the same vehicle eligibility and nearest-target ordering as release', () => {
  const g = racer(course([obstacle('truck', -3, -2, 'behind'), obstacle('train', 1, -2, 'train'),
    obstacle('truck', 2, -2, 'kicked'), obstacle('car', 3, -2, 'hit'), obstacle('car', 4, -4, 'outside'),
    obstacle('truck', 100, -2, 'distant'), obstacle('car', 18.55, -2, 'other-eligible'), obstacle('truck', 18.5, 2, 'chosen')]));
  g.obstacles.find(vehicle => vehicle.id === 'kicked').kicked = true;
  g.obstacles.find(vehicle => vehicle.id === 'hit').hit = true;
  g.kickSide = -1;
  ticks(g, .8, { kick: true }); assert.equal(g.kickSide, 1);
  advance(g, {}, 1 / 60);
  assert.deepEqual(g.events.find(event => event.type === 'kick'), { type: 'kick', id: 'chosen', charged: true });
  assert.equal(g.obstacles.find(vehicle => vehicle.id === 'other-eligible').kicked, false);
  assert.equal(g.kickedCount, 1);
});

test('a car accepts a tap while short truck charges and tall obstacles consume a miss cooldown', () => {
  const car = racer(course([obstacle('car', 6, 2)]));
  advance(car, { kick: true }, 1 / 60); advance(car, {}, 1 / 60);
  assert.equal(car.obstacles[0].kicked, true); near(car.score, car.s + 100);
  for (const type of ['truck', 'train', 'wall']) {
    const g = racer(course([obstacle(type, 8, 2.8)])); ticks(g, .2, { kick: true });
    advance(g, {}, 1 / 60); assert.equal(g.obstacles[0].kicked, false);
    assert.equal(g.cooldowns.kick, 8); assert.equal(g.events.find(e => e.type === 'miss').charged, false);
  }
});

test('new runs isolate collectible and vehicle state from both the course and prior runs', () => {
  const c = course([obstacle('car', 6, 2)], [pickup('banana', .2)]);
  const g = racer(c); advance(g, { kick: true }, 1 / 60); advance(g, {}, 1 / 60);
  const fresh = createGame(c);
  assert.equal(fresh.phase, 'ready'); assert.equal(fresh.obstacles[0].kicked, false);
  assert.equal(fresh.pickups[0].collected, false); assert.equal(fresh.bananas, 0);
  assert.equal(c.obstacles[0].kicked, undefined); assert.equal(c.pickups[0].collected, undefined);
});

test('seeded chunks are repeatable, provide safe collectibles and reserve side-switching time', () => {
  const c = { mode: 'endless', seed: 137, chunkLength: 80, lookAhead: 480 };
  const first = createGame(c), same = createGame(c), other = createGame({ ...c, seed: 138 });
  assert.ok(first.obstacles.length > 5); assert.ok(first.pickups.length > 20);
  assert.deepEqual(first.obstacles, same.obstacles); assert.deepEqual(first.pickups, same.pickups);
  assert.notDeepEqual(first.obstacles, other.obstacles);
  const objects = [...first.obstacles].sort((a, b) => a.s - b.s);
  for (let i = 1; i < objects.length; i++) {
    const a = objects[i - 1], b = objects[i];
    const aLength = core.obstacleSpecs[a.type].length, bLength = core.obstacleSpecs[b.type].length;
    assert.ok((b.s - a.s - aLength / 2 - bLength / 2 - 1.6) / 32.5 >= .9,
      `${a.id} → ${b.id} must allow at least .9s at boosted maximum speed`);
  }
  for (const p of first.pickups) for (const o of objects) {
    const spec = core.obstacleSpecs[o.type];
    const inside = Math.abs(p.s - o.s) < spec.length / 2 + .2 &&
      Math.abs(p.lane - o.lane) < spec.width / 2 + .2 && p.height < spec.height + .2;
    assert.equal(inside, false, `${p.id} cannot be inside ${o.id}`);
  }
  for (const o of objects) assert.ok(core.obstacleSpecs[o.type].width + .72 < 9.2,
    'Every encounter leaves a continuous player-width corridor');
});

test('rolling generation stays bounded and creates fresh obstacles far beyond two kilometres', () => {
  const g = createGame({ mode: 'endless', seed: 4, chunkLength: 80, lookAhead: 480 });
  g.phase = 'racing'; g.invulnerable = 10000;
  const firstIds = new Set(g.obstacles.map(o => o.id));
  for (let s = 0; s <= 100000; s += 800) {
    g.s = s; advance(g, {}, 1 / 60);
    assert.equal(g.phase, 'racing'); assert.ok(g.obstacles.length <= 18); assert.ok(g.pickups.length <= 100);
    for (const o of g.obstacles) {
      assert.ok(o.s + core.obstacleSpecs[o.type].length / 2 >= g.s - 80);
      assert.ok(o.s <= g.s + 480);
    }
    for (const p of g.pickups) assert.ok(p.s >= g.s - 80 && p.s <= g.s + 480);
  }
  assert.ok(g.nextChunk > 1250); assert.ok(g.obstacles.every(o => !firstIds.has(o.id)));
  assert.ok(g.obstacles.every(o => o.s > 99000));
});

test('chunk pickup identities do not depend on which old chunks remain in memory', () => {
  const c = { mode: 'endless', seed: 7, chunkLength: 80, lookAhead: 480 };
  const regular = createGame(c), skipped = createGame(c);
  for (const g of [regular, skipped]) {g.phase = 'racing'; g.invulnerable = 10000;}
  for (let s = 0; s <= 800; s += 80) {regular.s = s; advance(regular, {}, 1 / 60);}
  skipped.s = 800; advance(skipped, {}, 1 / 60);
  const upcoming = g => g.pickups.filter(p => p.s >= 721).map(p => [p.id, p.type, p.s, p.lane, p.height]);
  assert.deepEqual(upcoming(skipped), upcoming(regular));
});

test('freshly generated distant chunks respect retention bounds at partial chunk positions', () => {
  const g = createGame({ mode: 'endless', seed: 8, chunkLength: 80, lookAhead: 480 });
  g.phase = 'racing'; g.invulnerable = 10000;
  for (const s of [818, 1997, 80113, 99777]) {
    g.s = s; advance(g, {}, 1 / 60);
    assert.ok(g.pickups.every(p => p.s >= g.s - 80 && p.s <= g.s + 480));
    assert.ok(g.obstacles.every(o => o.s + core.obstacleSpecs[o.type].length / 2 >= g.s - 80));
  }
});

test('collectibles avoid all obstacle volumes across varied seeds and later chunks', () => {
  for (let seed = 0; seed < 32; seed++) {
    const g = createGame({ mode: 'endless', seed, chunkLength: 80, lookAhead: 480 });
    g.phase = 'racing'; g.invulnerable = 10000;
    for (const s of [0, 1200, 10400]) {
      g.s = s; advance(g, {}, 1 / 60);
      for (const p of g.pickups) for (const o of g.obstacles) {
        const spec = core.obstacleSpecs[o.type];
        const inside = Math.abs(p.s - o.s) < spec.length / 2 + .32 &&
          Math.abs(p.lane - o.lane) < spec.width / 2 + .32 && p.height < spec.height + .2;
        assert.equal(inside, false, `seed${seed}, ${p.id} cannot be inside ${o.id}`);
      }
    }
  }
});

test('E sprint is edge-triggered, boosts for 1.5 s and then waits a six-second cooldown', () => {
  const g = racer();
  const events = ticks(g, 1, { dash: true });
  assert.equal(events.filter(e => e.type === 'dash').length, 1, 'Holding E must not retrigger');
  assert.equal(g.speed, 15); near(g.cooldowns.dash, 6 - 59 / 60, 1e-6); near(g.buffs.boost, 1.5 - 59 / 60, 1e-6);
  ticks(g, .6); assert.equal(g.speed, 12);
  assert.equal(ticks(g, 1, { dash: true }).filter(e => e.type === 'dash').length, 0, 'Cooldown blocks a new sprint');
  ticks(g, 3.5); assert.equal(g.cooldowns.dash, 0);
  assert.equal(ticks(g, 1 / 60, { dash: true }).filter(e => e.type === 'dash').length, 1);
});

test('E sprint never shortens a longer boost pickup and freezes with pause', () => {
  const g = racer(); g.buffs.boost = 4;
  ticks(g, 1 / 60, { dash: true }); near(g.buffs.boost, 4 - 1 / 60, 1e-9);
  core.togglePause(g); assert.equal(g.held.dash, false);
  const cooldown = g.cooldowns.dash; ticks(g, 3, { dash: true });
  assert.equal(g.cooldowns.dash, cooldown);
});
