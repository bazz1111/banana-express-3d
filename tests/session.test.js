import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game.ts';

import { createSessionCourse, readPreferences, savePreferences } from '../src/session.js';
const sourceCourse = () => ({
  mode: 'endless', seed: 137, chunkLength: 80, lookAhead: 480,
  points: [{ s: 0, x: 0, y: 0, z: 0 }],
  road: { period: 1600, advance: { x: 0, y: -64, z: 1600 } },
});
const params = search => new URLSearchParams(search);
const storageKey = 'banana-endless-preferences';
const storage = raw => {
  const items = new Map(raw === undefined ? [] : [[storageKey, raw]]);
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
};

test('each normal session chooses a new seed even if entropy repeats, and owns its course copy', () => {
  const source = sourceCourse(), random = Math.random;
  Math.random = () => .5;
  try {
    const first = createSessionCourse(source, params(''));
    const next = createSessionCourse(source, params(''), first.seed);
    assert.equal(first.seed, 2147483648);
    assert.equal(next.seed, 2147483649);
    first.procedural = false;
    first.seed = 99;
    assert.deepEqual(source, sourceCourse());
    assert.equal(next.procedural, undefined);
    assert.equal(next.seed, 2147483649);
  } finally { Math.random = random; }
});

test('explicit uint32 seed URLs replay the same generated encounters on every restart', () => {
  for (const seed of [0, 137, 4294967295]) {
    const first = createSessionCourse(sourceCourse(), params(`seed=${seed}`));
    const restart = createSessionCourse(sourceCourse(), params(`seed=${seed}`), first.seed);
    assert.equal(first.seed, seed);
    assert.equal(restart.seed, seed);
    assert.deepEqual(createGame(first).obstacles, createGame(restart).obstacles);
    assert.deepEqual(createGame(first).pickups, createGame(restart).pickups);
  }
});

test('invalid replay seeds fall back to a playable normal session', () => {
  const random = Math.random;
  Math.random = () => .25;
  try {
    for (const invalid of ['', '-1', '1.5', '1e3', 'Infinity', '4294967296', 'nope']) {
      const c = createSessionCourse(sourceCourse(), params(`seed=${invalid}`));
      assert.equal(c.seed, 1073741824);
      assert.equal(createGame(c).phase, 'ready');
    }
  } finally { Math.random = random; }
});

test('new session seeds preserve the learnable first 160 metres while later encounters vary', () => {
  const runs = [137, 138].map(seed => createGame(createSessionCourse(sourceCourse(), params(`seed=${seed}`))));
  for (const objects of ['obstacles', 'pickups']) {
    assert.deepEqual(runs[0][objects].filter(o => o.s < 160), runs[1][objects].filter(o => o.s < 160));
  }
  assert.notDeepEqual(runs[0].obstacles.filter(o => o.s >= 160), runs[1].obstacles.filter(o => o.s >= 160));
});

test('manual quality and sound preferences survive reload without rewriting unrelated storage', () => {
  const disk = storage();
  disk.setItem('banana-endless-best', '{"total":222}');
  const changed = { quality: 'low', sound: false };
  assert.equal(savePreferences(changed, disk), true);
  assert.deepEqual(readPreferences(disk), changed);
  assert.equal(disk.getItem('banana-endless-best'), '{"total":222}');
  assert.equal(savePreferences({ quality: 'high', sound: true }, disk), true);
  assert.deepEqual(readPreferences(disk), { quality: 'high', sound: true });
});

test('malformed preference fields and damaged JSON fall back independently', () => {
  for (const raw of [undefined, '{', 'null', '42', '[]', '{"quality":"ultra","sound":"false"}']) {
    assert.deepEqual(readPreferences(storage(raw)), { quality: null, sound: true });
  }
  assert.deepEqual(readPreferences(storage('{"quality":"low","sound":0}')), { quality: 'low', sound: true });
  assert.deepEqual(readPreferences(storage('{"quality":false,"sound":false}')), { quality: null, sound: false });
});

test('disabled storage and failed writes leave preferences usable in memory', () => {
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(readPreferences(blocked), { quality: null, sound: true });
  const changed = { quality: 'low', sound: false };
  assert.equal(savePreferences(changed, blocked), false);
  assert.deepEqual(changed, { quality: 'low', sound: false });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied getter'); } });
  try {
    assert.deepEqual(readPreferences(), { quality: null, sound: true });
    assert.equal(savePreferences(changed), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
