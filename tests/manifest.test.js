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
