import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadManifest } from '../scripts/manifest.js';

const SCRIPT = new URL('../scripts/generate-doc-set.js', import.meta.url).pathname;

function tmpdirForTest() {
  return mkdtempSync(join(tmpdir(), 'docalign-generate-'));
}

function writeSpec(dir, spec) {
  const p = join(dir, 'spec.json');
  writeFileSync(p, JSON.stringify(spec, null, 2));
  return p;
}

test('generate-doc-set writes markdown files and manifest from a JSON spec', () => {
  const dir = tmpdirForTest();
  const specPath = writeSpec(dir, {
    docs: [
      {
        path: 'overview.md',
        type: 'overview',
        watch: ['README.md'],
        content: '# Overview\n',
      },
      {
        path: 'flows/refund.md',
        type: 'sequence',
        watch: ['src/billing/**'],
        content: '# Refund\n\n```mermaid\nsequenceDiagram\n  A->>B: refund()\n```\n',
      },
    ],
  });

  const out = JSON.parse(execFileSync('node', [
    SCRIPT, '--repo', dir, '--spec', specPath, '--commit', 'abc1234',
  ], { encoding: 'utf8' }));

  assert.equal(out.ok, true);
  assert.ok(existsSync(join(dir, 'docs/overview.md')));
  assert.ok(existsSync(join(dir, 'docs/flows/refund.md')));
  assert.equal(readFileSync(join(dir, 'docs/overview.md'), 'utf8'), '# Overview\n');
  assert.deepEqual(loadManifest(join(dir, 'docs/.docalign.yml')).docs, [
    { path: 'overview.md', type: 'overview', watch: ['README.md'], last_verified: 'abc1234' },
    { path: 'flows/refund.md', type: 'sequence', watch: ['src/billing/**'], last_verified: 'abc1234' },
  ]);
});

test('generate-doc-set refuses to overwrite without --force', () => {
  const dir = tmpdirForTest();
  const specPath = writeSpec(dir, {
    docs: [{ path: 'overview.md', type: 'overview', watch: ['README.md'], content: '# First\n' }],
  });
  execFileSync('node', [SCRIPT, '--repo', dir, '--spec', specPath]);
  assert.throws(() => execFileSync('node', [SCRIPT, '--repo', dir, '--spec', specPath], { stdio: 'pipe' }),
    /refusing to overwrite existing file/);
});

test('generate-doc-set validates paths, types, watch, and content', () => {
  const dir = tmpdirForTest();
  for (const spec of [
    { docs: [{ path: '../x.md', type: 'overview', watch: ['README.md'], content: '# X' }] },
    { docs: [{ path: 'x.md', type: 'bogus', watch: ['README.md'], content: '# X' }] },
    { docs: [{ path: 'x.md', type: 'overview', watch: [], content: '# X' }] },
    { docs: [{ path: 'x.md', type: 'overview', watch: ['README.md'], content: '' }] },
  ]) {
    const specPath = writeSpec(dir, spec);
    assert.throws(() => execFileSync('node', [SCRIPT, '--repo', dir, '--spec', specPath], { stdio: 'pipe' }));
  }
});
