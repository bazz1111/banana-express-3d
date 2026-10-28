import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const script = 'scripts/banana-tripo/prepare-hero.py';
test('hero preparation inspects the actual weighted Tripo source without importing Blender or writing candidates', () => {
  const result = spawnSync('python3', [script, '--inspect'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.bones, 65); assert.equal(report.triangles, 19121);
  assert.equal(report.sha256, 'c5e49d048684b79f3070e9e52a00d6638b7843594ce0e7f5f4ff1c07b8b8de7c');
  assert.ok(report.sourceHeight > .97 && report.sourceHeight < .98);
});

test('hero preparation rejects a source with missing weights before any Blender operation', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'banana-hero-'));
  try {
    const original = readFileSync('assets/sources/banana-tripo-v1/hero-rigged.glb');
    const size = original.readUInt32LE(12), document = JSON.parse(original.subarray(20, 20 + size));
    delete document.meshes[0].primitives[0].attributes.WEIGHTS_0;
    const raw = Buffer.from(JSON.stringify(document)), text = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(text);
    const binary = original.subarray(20 + size), bytes = Buffer.alloc(20 + text.length + binary.length);
    original.copy(bytes, 0, 0, 20); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(text.length, 12);
    text.copy(bytes, 20); binary.copy(bytes, 20 + text.length);
    const source = path.join(directory, 'unweighted.glb'); writeFileSync(source, bytes);
    const result = spawnSync('python3', [script, '--inspect', '--source', source], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /WEIGHTS_0/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('hero preparation rejects invalid dimensions before importing Blender', () => {
  const result = spawnSync('python3', [script, '--height', '0'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /positive finite height/);
});

test('hero preparation validates and records measured bike contacts before importing Blender', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'banana-hero-contacts-'));
  const contacts = { seat: [0, .944, -.264], standing: [[-.3, 1.03, .282], [.04, .94, -.264]],
    grips: [[-.3, 1.03, .282], [.3, 1.07, .282]], pedalCenter: [0, .3144, -.0417],
    pedalWidth: .21, crankRadius: .18, pedalOffsets: [[0, .013, 0], [0, .020, 0]] };
  try {
    const file = path.join(directory, 'contacts.json'); writeFileSync(file, JSON.stringify(contacts));
    const result = spawnSync('python3', [script, '--inspect', '--contact-config', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).contactConfig, contacts);
    writeFileSync(file, JSON.stringify({ ...contacts, grips: [[1, 2], [3, 4, 5]] }));
    const invalid = spawnSync('python3', [script, '--inspect', '--contact-config', file], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /grips.*three.*finite/i);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('hero preparation refuses to replace its immutable source with a derived candidate', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'banana-hero-source-'));
  try {
    const source = path.join(directory, 'riderSkinned.glb');
    writeFileSync(source, readFileSync('assets/sources/banana-tripo-v1/hero-rigged.glb'));
    const before = readFileSync(source);
    const result = spawnSync('python3', [script, '--source', source, '--output-dir', directory], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Refusing to overwrite source/);
    assert.deepEqual(readFileSync(source), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
