// tests/ci-gate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = new URL('../scripts/ci-gate.js', import.meta.url).pathname;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function makePr({ verified = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-ci-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@test');
  git(dir, 'config', 'user.name', 'test');
  mkdirSync(join(dir, 'src/billing'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'src/billing/refund.py'), 'def refund(): pass\n');
  writeFileSync(join(dir, 'README.md'), 'hi\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'docs/.docalign.yml'), `docs:
  - path: flows/refund.md
    type: sequence
    watch:
      - src/billing/**
${verified ? `    last_verified: ${base}\n` : ''}`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'manifest');
  git(dir, 'checkout', '-b', 'feature');
  return dir;
}

function run(dir, extraEnv = {}) {
  const out = execFileSync('node', [SCRIPT, '--base', 'main', '--repo', dir],
    { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  return JSON.parse(out);
}

test('watched change → skip=false with affected doc listed', () => {
  const dir = makePr();
  writeFileSync(join(dir, 'src/billing/refund.py'), 'def refund(x): return x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'change');
  const out = run(dir);
  assert.equal(out.skip, false);
  assert.deepEqual(out.affectedDocs, ['flows/refund.md']);
});

test('unwatched change → skip=true (zero-cost per spec §8), unmatched still reported', () => {
  const dir = makePr();
  writeFileSync(join(dir, 'README.md'), 'changed\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'readme only');
  const out = run(dir);
  assert.equal(out.skip, true);
  assert.deepEqual(out.unmatchedFiles, ['README.md']);
});

test('doc without last_verified is judged by the PR range like any other (CI cares about the diff, not repo hygiene)', () => {
  const dir = makePr({ verified: false });
  writeFileSync(join(dir, 'README.md'), 'changed\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'readme only');
  const out = run(dir);
  assert.equal(out.skip, true);
});

test('bad base ref is a loud error, not a silent skip', () => {
  const dir = makePr();
  assert.throws(() => execFileSync('node', [SCRIPT, '--base', 'no-such-ref', '--repo', dir], { stdio: 'pipe' }),
    /cannot diff range/);
});

test('writes GITHUB_OUTPUT when env var set', () => {
  const dir = makePr();
  writeFileSync(join(dir, 'src/billing/refund.py'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'change');
  const ghOut = join(mkdtempSync(join(tmpdir(), 'gho-')), 'out');
  writeFileSync(ghOut, '');
  run(dir, { GITHUB_OUTPUT: ghOut });
  const content = readFileSync(ghOut, 'utf8');
  assert.match(content, /^skip=false$/m);
  assert.match(content, /^range=main\.\.\.HEAD$/m);
});

test('missing --base is a loud error', () => {
  const dir = makePr();
  assert.throws(() => execFileSync('node', [SCRIPT, '--repo', dir], { stdio: 'pipe' }));
});

test('docs-only PR (hand-edited tracked diagram) → skip=true but changedDocs lists it for zero-cost lint', () => {
  const dir = makePr();
  mkdirSync(join(dir, 'docs/flows'), { recursive: true });
  writeFileSync(join(dir, 'docs/flows/refund.md'), '# refund\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'hand-edit diagram');
  const out = run(dir);
  assert.equal(out.skip, true);
  assert.deepEqual(out.changedDocs, ['docs/flows/refund.md']);
});

test('manifest-only change → changedDocs excludes the manifest itself', () => {
  const dir = makePr();
  writeFileSync(join(dir, 'docs/.docalign.yml'), `docs:
  - path: flows/refund.md
    type: sequence
    watch:
      - src/billing/**
`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'manifest tweak');
  const out = run(dir);
  assert.deepEqual(out.changedDocs, []);
});

test('deleted doc → changedDocs excludes it (mermaid lint would crash on a gone file), changed_docs output empty', () => {
  const dir = makePr();
  mkdirSync(join(dir, 'docs/flows'), { recursive: true });
  writeFileSync(join(dir, 'docs/flows/refund.md'), '# refund\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'add doc');
  git(dir, 'branch', '-f', 'main', 'HEAD'); // doc exists on main before this PR
  git(dir, 'rm', 'docs/flows/refund.md');
  git(dir, 'commit', '-m', 'delete doc');
  const ghOut = join(mkdtempSync(join(tmpdir(), 'gho-')), 'out');
  writeFileSync(ghOut, '');
  const out = run(dir, { GITHUB_OUTPUT: ghOut });
  assert.deepEqual(out.changedDocs, []);
  const content = readFileSync(ghOut, 'utf8');
  assert.match(content, /^changed_docs=$/m);
});

test('GITHUB_OUTPUT contains changed_docs line', () => {
  const dir = makePr();
  mkdirSync(join(dir, 'docs/flows'), { recursive: true });
  writeFileSync(join(dir, 'docs/flows/refund.md'), '# refund\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'hand-edit diagram');
  const ghOut = join(mkdtempSync(join(tmpdir(), 'gho-')), 'out');
  writeFileSync(ghOut, '');
  run(dir, { GITHUB_OUTPUT: ghOut });
  const content = readFileSync(ghOut, 'utf8');
  assert.match(content, /^changed_docs=docs\/flows\/refund\.md$/m);
});
