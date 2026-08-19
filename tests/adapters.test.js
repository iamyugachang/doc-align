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

test('init and check playbooks cover every manifest type (applicability + verification method)', async () => {
  const { KNOWN_TYPES } = await import('../scripts/manifest.js');
  const init = readFileSync(ROOT + 'playbook/init.md', 'utf8');
  const check = readFileSync(ROOT + 'playbook/check.md', 'utf8');
  const readme = readFileSync(ROOT + 'README.md', 'utf8');
  for (const t of KNOWN_TYPES) {
    assert.ok(init.includes(`${t}：`) || init.includes(`${t} 用`) || init.includes(`${t}（`), `init.md decides/skeletons ${t}`);
    assert.ok(check.includes(`**${t}**`) || check.includes(`**${t} /`) || check.includes(t), `check.md verifies ${t}`);
    assert.ok(readme.includes(`\`${t}\``), `README lists ${t}`);
  }
  assert.ok(init.includes('不適用就不寫'), 'init forbids forcing inapplicable types');
  assert.ok(init.includes('每條 DAG／pipeline 各一份文件'), 'one doc per DAG');
  assert.ok(init.includes('deps-check.js') && check.includes('deps-check.js'), 'layers mechanical check wired');
});

test('writing.md exists, is referenced by init and sync, and carries the core heuristics; optional-skills.md never vendors', () => {
  const w = readFileSync(ROOT + 'playbook/writing.md', 'utf8');
  for (const k of ['arc42', 'C4', 'Diátaxis', 'ADR', '每條箭頭要標文字', '不混象限', 'checklist']) assert.ok(w.includes(k), `writing.md mentions ${k}`);
  assert.ok(readFileSync(ROOT + 'playbook/init.md', 'utf8').includes('playbook/writing.md'));
  assert.ok(readFileSync(ROOT + 'playbook/sync.md', 'utf8').includes('writing.md'));
  const o = readFileSync(ROOT + 'playbook/optional-skills.md', 'utf8');
  assert.ok(o.includes('不複製進本 repo') && o.includes('DOC_ALIGN_SKILLS_DIR'));
  assert.ok(!existsSync(ROOT + 'vendor'), 'no vendored third-party skills');
});

test('diagrams.md is a required playbook: referenced by init/sync and carries budget + remove test', () => {
  const d = readFileSync(ROOT + 'playbook/diagrams.md', 'utf8');
  for (const k of ['刪到不能再刪', '複雜度預算', 'remove test', 'classDef focal', 'erDiagram', '反模式']) assert.ok(d.includes(k), `diagrams.md mentions ${k}`);
  assert.ok(readFileSync(ROOT + 'playbook/init.md', 'utf8').includes('playbook/diagrams.md'));
  assert.ok(readFileSync(ROOT + 'playbook/sync.md', 'utf8').includes('diagrams.md'));
});
