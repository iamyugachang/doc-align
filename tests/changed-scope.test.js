// tests/changed-scope.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = new URL('../scripts/changed-scope.js', import.meta.url).pathname;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-repo-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@test');
  git(dir, 'config', 'user.name', 'test');
  mkdirSync(join(dir, 'src/billing'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'src/billing/refund.py'), 'def refund(): pass\n');
  writeFileSync(join(dir, 'src/other.py'), 'x = 1\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'docs/.docalign.yml'), `docs:
  - path: flows/refund.md
    type: sequence
    watch:
      - src/billing/**
    last_verified: ${base}
  - path: architecture.md
    type: architecture
    watch:
      - src/**
`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'manifest');
  return { dir, base };
}

function run(dir, ...args) {
  return JSON.parse(execFileSync('node', [SCRIPT, '--repo', dir, ...args], { encoding: 'utf8' }));
}

test('per-doc mode: doc is affected only when its watch matches the diff', () => {
  const { dir } = makeRepo();
  writeFileSync(join(dir, 'src/billing/refund.py'), 'def refund(x): return x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'change billing');
  const out = run(dir);
  const flow = out.docs.find((d) => d.path === 'flows/refund.md');
  assert.equal(flow.status, 'affected');
  assert.deepEqual(flow.matchedFiles, ['src/billing/refund.py']);
});

test('doc without last_verified is reported unverified', () => {
  const { dir } = makeRepo();
  const out = run(dir);
  assert.equal(out.docs.find((d) => d.path === 'architecture.md').status, 'unverified');
});

test('unmatched changed files are surfaced as coverage gaps', () => {
  const { dir } = makeRepo();
  writeFileSync(join(dir, 'newfile.txt'), 'hi\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'uncovered change');
  const out = run(dir);
  assert.deepEqual(out.unmatchedFiles, ['newfile.txt']);
});

test('--full marks every doc affected', () => {
  const { dir } = makeRepo();
  const out = run(dir, '--full');
  assert.ok(out.docs.every((d) => d.status === 'affected'));
  assert.equal(out.mode, 'full');
});

test('bad last_verified degrades to unverified instead of crashing', () => {
  const { dir } = makeRepo();
  writeFileSync(join(dir, 'docs/.docalign.yml'), `docs:
  - path: flows/refund.md
    type: sequence
    watch:
      - src/billing/**
    last_verified: 0000000
`);
  const out = run(dir);
  assert.equal(out.docs[0].status, 'unverified');
  assert.match(out.docs[0].reason, /bad last_verified/);
});
