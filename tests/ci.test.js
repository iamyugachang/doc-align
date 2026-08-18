// tests/ci.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = ['ci/doc-align-claude.yml', 'ci/doc-align-opencode.yml'];

test('workflow templates exist with PR trigger and comment permission', () => {
  for (const f of FILES) {
    const y = readFileSync(ROOT + f, 'utf8');
    assert.match(y, /^name:/m, `${f} has a name`);
    assert.match(y, /pull_request/, `${f} triggers on PR`);
    assert.match(y, /pull-requests:\s*write/, `${f} can comment`);
  }
});

test('cheap gate runs before the LLM step and gates it', () => {
  for (const f of FILES) {
    const y = readFileSync(ROOT + f, 'utf8');
    const gateIdx = y.indexOf('ci-gate.js');
    const llmIdx = f.includes('claude') ? y.indexOf('claude -p') : y.indexOf('opencode run');
    assert.ok(gateIdx > -1 && llmIdx > -1, `${f} has both steps`);
    assert.ok(gateIdx < llmIdx, `${f}: gate precedes LLM`);
    assert.match(y, /steps\.gate\.outputs\.skip != 'true'/, `${f}: LLM conditioned on gate`);
  }
});

test('report comment is upserted via marker and job never fails on drift', () => {
  for (const f of FILES) {
    const y = readFileSync(ROOT + f, 'utf8');
    assert.match(y, /<!-- doc-align-report -->/, `${f} has upsert marker`);
    assert.ok(!/exit 1/.test(y), `${f} never fails the job on drift`);
    assert.match(y, /playbook\/check\.md/, `${f} points the agent at the check playbook`);
  }
});

test('mermaid lint on changed docs runs between the gate and the LLM step, gated on changed_docs', () => {
  for (const f of FILES) {
    const y = readFileSync(ROOT + f, 'utf8');
    assert.match(y, /mermaid-check\.js/, `${f}: mermaid lint step present`);
    assert.match(y, /steps\.gate\.outputs\.changed_docs != ''/, `${f}: mermaid lint gated on changed_docs`);
    const gateIdx = y.indexOf('name: Cheap gate');
    const mermaidIdx = y.indexOf('name: Mermaid lint');
    const llmIdx = y.indexOf('name: Drift check');
    assert.ok(gateIdx < mermaidIdx && mermaidIdx < llmIdx, `${f}: mermaid lint sits between gate and LLM`);
  }
});

test('untrusted step-output/context expressions are spliced via env:, never directly into a run: line', () => {
  // Regression lock: ${{ }} expressions derived from untrusted PR input (gate
  // outputs, github.base_ref) must never be interpolated straight into a
  // run: shell command — that's a script-injection vector. They may only
  // appear as env: assignments (KEY: ${{ ... }}), which the shell then reads
  // as an inert environment variable.
  const untrustedExprs = [
    '${{ steps.gate.outputs.changed_docs }}',
    '${{ steps.gate.outputs.range }}',
    '${{ github.base_ref }}',
  ];
  for (const f of FILES) {
    const y = readFileSync(ROOT + f, 'utf8');
    for (const line of y.split('\n')) {
      for (const expr of untrustedExprs) {
        if (line.includes(expr)) {
          assert.match(
            line,
            /^\s*[A-Za-z_][A-Za-z0-9_]*:\s*\$\{\{/,
            `${f}: "${expr}" must only appear as an env: assignment, not spliced into run: — got line: ${line}`,
          );
        }
      }
    }
  }
});

// ── GitLab 範本（結構與 GitHub 版不同，單獨驗證）─────────────────────────────

const GITLAB = 'ci/doc-align-gitlab.yml';

test('gitlab template triggers on MR and never fails on drift', () => {
  const y = readFileSync(ROOT + GITLAB, 'utf8');
  assert.match(y, /merge_request_event/, 'runs on MR pipelines');
  assert.ok(!/exit 1/.test(y), 'never fails the job on drift');
  assert.match(y, /<!-- doc-align-report -->/, 'has upsert marker');
  assert.match(y, /playbook\/check\.md/, 'points the agent at the check playbook');
});

test('gitlab template: gate → mermaid lint → LLM, in order and gated', () => {
  const y = readFileSync(ROOT + GITLAB, 'utf8');
  const gateIdx = y.indexOf('ci-gate.js');
  const lintIdx = y.indexOf('mermaid-check.js');
  const llmIdx = y.indexOf('opencode run');
  assert.ok(gateIdx > -1 && lintIdx > -1 && llmIdx > -1, 'all three steps present');
  assert.ok(gateIdx < lintIdx && lintIdx < llmIdx, 'gate precedes lint precedes LLM');
  assert.match(y, /\[ "\$SKIP" = "true" \]/, 'LLM gated on cheap-gate skip');
});

test('gitlab template: LLM goes through OpenAI-compatible custom provider', () => {
  const y = readFileSync(ROOT + GITLAB, 'utf8');
  assert.match(y, /@ai-sdk\/openai-compatible/, 'opencode custom provider');
  for (const v of ['DOC_ALIGN_LLM_BASE_URL', 'DOC_ALIGN_LLM_API_KEY', 'DOC_ALIGN_LLM_MODEL',
                   'DOC_ALIGN_GITLAB_TOKEN', 'DOC_ALIGN_REPO_URL']) {
    assert.ok(y.includes(v), `documents/uses ${v}`);
  }
});

test('gitlab template upserts a single MR note (PUT when found, POST otherwise)', () => {
  const y = readFileSync(ROOT + GITLAB, 'utf8');
  assert.match(y, /-X PUT/, 'updates existing note');
  assert.match(y, /-X POST/, 'creates note when absent');
  assert.match(y, /merge_requests\/\$CI_MERGE_REQUEST_IID\/notes/, 'targets MR notes API');
});

// ── direct 模式（不依賴 agent）───────────────────────────────────────────────

const DIRECT = 'ci/doc-align-direct.yml';

test('direct template: gate → mermaid lint → llm-check.js, no agent runtime installed', () => {
  const y = readFileSync(ROOT + DIRECT, 'utf8');
  assert.match(y, /pull_request/);
  assert.match(y, /pull-requests:\s*write/);
  const gateIdx = y.indexOf('ci-gate.js');
  const lintIdx = y.indexOf('mermaid-check.js');
  const llmIdx = y.indexOf('llm-check.js');
  assert.ok(gateIdx > -1 && lintIdx > -1 && llmIdx > -1, 'all three steps present');
  assert.ok(gateIdx < lintIdx && lintIdx < llmIdx, 'gate precedes lint precedes LLM');
  assert.match(y, /steps\.gate\.outputs\.skip != 'true'/, 'LLM conditioned on gate');
  assert.ok(!/opencode run|opencode\.ai\/install|claude -p|npm install -g @anthropic-ai/.test(y), 'no agent CLI dependency');
  assert.match(y, /<!-- doc-align-report -->/, 'upsert marker');
  assert.ok(!/exit 1/.test(y), 'never fails on drift');
  for (const v of ['DOC_ALIGN_LLM_API_KEY', 'DOC_ALIGN_LLM_BASE_URL', 'DOC_ALIGN_LLM_MODEL']) {
    assert.ok(y.includes(v), `uses ${v}`);
  }
});

test('gitlab template: direct runner is the default and opencode is opt-in; MR note still posted in direct mode', () => {
  const y = readFileSync(ROOT + GITLAB, 'utf8');
  assert.match(y, /DOC_ALIGN_LLM_RUNNER:-direct/, 'defaults to direct');
  assert.match(y, /llm-check\.js/, 'direct path calls llm-check');
  const opencodeIf = y.indexOf('= "opencode" ]; then');
  const opencodeRun = y.indexOf('opencode run');
  const noteIdx = y.indexOf('Upsert MR note');
  assert.ok(opencodeIf > -1 && opencodeIf < opencodeRun, 'opencode install/run guarded by runner check');
  assert.ok(opencodeRun < noteIdx, 'note upsert comes after both runners');
  // 早退 exit 0 只允許出現在 cheap-gate skip 那一行；LLM 區塊不得 exit，否則 direct 模式會跳過 MR note
  const exits = [...y.matchAll(/exit 0/g)].map((m) => m.index);
  assert.equal(exits.length, 1, 'exactly one early exit (the cheap-gate skip)');
  assert.ok(exits[0] < y.indexOf('Drift check'), 'the only exit is before the LLM section');
});
