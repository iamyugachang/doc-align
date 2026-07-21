import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'has frontmatter');
  return m[1];
}

test('both adapters exist and reference every playbook subcommand', () => {
  for (const p of ['adapters/claude-code/SKILL.md', 'adapters/opencode/commands/doc-align.md']) {
    const md = readFileSync(ROOT + p, 'utf8');
    for (const sub of ['check', 'sync', 'init']) {
      assert.ok(md.includes(sub), `${p} mentions ${sub}`);
      assert.ok(existsSync(`${ROOT}playbook/${sub}.md`), `playbook/${sub}.md exists`);
    }
  }
});

test('opencode command has description frontmatter and resolves repo root', () => {
  const relPath = 'adapters/opencode/commands/doc-align.md';
  const md = readFileSync(ROOT + relPath, 'utf8');
  assert.match(frontmatter(md), /^description:\s+\S/m);
  assert.ok(md.includes('$ARGUMENTS'), 'passes user arguments');

  const shellMatch = md.match(/^!`(.*)`$/m);
  assert.ok(shellMatch, 'has a shell-injection line');
  const snippet = shellMatch[1];

  // Simulate a global install: ~/.config/opencode/commands/doc-align.md is a
  // symlink to the real command file, exactly like the README's install step.
  const fakeHome = mkdtempSync(join(tmpdir(), 'docalign-opencode-'));
  mkdirSync(join(fakeHome, '.config', 'opencode', 'commands'), { recursive: true });
  const realFile = realpathSync(ROOT + relPath);
  symlinkSync(realFile, join(fakeHome, '.config', 'opencode', 'commands', 'doc-align.md'));

  const stdout = execFileSync('bash', ['-c', snippet], {
    env: { ...process.env, HOME: fakeHome },
    encoding: 'utf8',
  });
  const expectedRoot = realpathSync(ROOT.replace(/\/$/, ''));
  assert.equal(stdout.trim(), expectedRoot, 'resolves the actual repo root, not a parent/child of it');
});

test('adapters contain no agent-specific tool names', () => {
  for (const p of ['adapters/claude-code/SKILL.md', 'adapters/opencode/commands/doc-align.md']) {
    const md = readFileSync(ROOT + p, 'utf8');
    assert.ok(!/Grep tool|Read tool|Task tool|Bash tool|TodoWrite|WebFetch/.test(md), `${p} is agent-agnostic`);
  }
});
