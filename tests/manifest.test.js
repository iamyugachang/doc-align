// tests/manifest.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadManifest } from '../scripts/manifest.js';

const SCRIPT = new URL('../scripts/manifest.js', import.meta.url).pathname;

function tmpManifest(content) {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-'));
  const p = join(dir, '.docalign.yml');
  writeFileSync(p, content);
  return p;
}

const VALID = `docs:
  - path: flows/refund.md
    type: sequence
    watch:
      - src/billing/**
    last_verified: a1b2c3d
`;

test('loadManifest validates required keys', () => {
  const p = tmpManifest(VALID);
  assert.equal(loadManifest(p).docs[0].type, 'sequence');
  const bad = tmpManifest('docs:\n  - path: x.md\n');
  assert.throws(() => loadManifest(bad), /missing path\/type/);
});

test('loadManifest rejects an unknown type', () => {
  const bad = tmpManifest('docs:\n  - path: x.md\n    type: bogus\n');
  assert.throws(() => loadManifest(bad), /unknown type 'bogus' for x\.md/);
});

test('CLI read prints JSON', () => {
  const p = tmpManifest(VALID);
  const out = JSON.parse(execFileSync('node', [SCRIPT, 'read', '--manifest', p], { encoding: 'utf8' }));
  assert.equal(out.docs[0].path, 'flows/refund.md');
});

test('CLI set-verified updates last_verified in place', () => {
  const p = tmpManifest(VALID);
  execFileSync('node', [SCRIPT, 'set-verified', '--manifest', p, '--doc', 'flows/refund.md', '--commit', 'deadbee']);
  assert.match(readFileSync(p, 'utf8'), /last_verified: deadbee/);
});

test('CLI set-watch replaces the watch list', () => {
  const p = tmpManifest(VALID);
  execFileSync('node', [SCRIPT, 'set-watch', '--manifest', p, '--doc', 'flows/refund.md',
    '--watch', 'src/billing/**', '--watch', 'src/notify/**']);
  assert.deepEqual(loadManifest(p).docs[0].watch, ['src/billing/**', 'src/notify/**']);
});

test('CLI set-watch rejects a trailing --watch with no value, leaving the file unchanged', () => {
  const p = tmpManifest(VALID);
  const before = readFileSync(p, 'utf8');
  assert.throws(() => execFileSync('node', [SCRIPT, 'set-watch', '--manifest', p, '--doc', 'flows/refund.md', '--watch'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(readFileSync(p, 'utf8'), before);
});

test('add-doc creates the manifest file when missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-'));
  const p = join(dir, '.docalign.yml');
  execFileSync('node', [SCRIPT, 'add-doc', '--manifest', p, '--doc', 'architecture.md',
    '--type', 'architecture', '--watch', 'src/**', '--commit', 'abc1234']);
  const { docs } = loadManifest(p);
  assert.deepEqual(docs, [{ path: 'architecture.md', type: 'architecture', watch: ['src/**'], last_verified: 'abc1234' }]);
});

test('add-doc appends to an existing manifest and preserves entries', () => {
  const p = tmpManifest(VALID);
  execFileSync('node', [SCRIPT, 'add-doc', '--manifest', p, '--doc', 'db-schema.md',
    '--type', 'db-schema', '--watch', 'migrations/**']);
  const { docs } = loadManifest(p);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].path, 'flows/refund.md');
  assert.equal(docs[1].last_verified, undefined);
});

test('add-doc rejects duplicate path and unknown type', () => {
  const p = tmpManifest(VALID);
  assert.throws(() => execFileSync('node', [SCRIPT, 'add-doc', '--manifest', p,
    '--doc', 'flows/refund.md', '--type', 'sequence', '--watch', 'x/**'], { stdio: 'pipe' }));
  assert.throws(() => execFileSync('node', [SCRIPT, 'add-doc', '--manifest', p,
    '--doc', 'new.md', '--type', 'bogus', '--watch', 'x/**'], { stdio: 'pipe' }));
});
