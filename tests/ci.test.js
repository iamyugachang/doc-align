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

// ── custom runner（自帶 harness）────────────────────────────────────────────

test('gitlab template: custom runner runs DOC_ALIGN_LLM_CUSTOM_CMD between opencode and note upsert, with the env contract', () => {
  const y = readFileSync(ROOT + GITLAB, 'utf8');
  const customIf = y.indexOf('= "custom" ]; then');
  const opencodeRun = y.indexOf('opencode run');
  const noteIdx = y.indexOf('Upsert MR note');
  assert.ok(customIf > opencodeRun && customIf < noteIdx, 'custom block sits after opencode and before note upsert');
  const block = y.slice(customIf, noteIdx);
  assert.match(block, /DOC_ALIGN_LLM_CUSTOM_CMD:\?/, 'missing command fails loudly (parameter-expansion error, not exit 1)');
  assert.match(block, /sh -c "\$DOC_ALIGN_LLM_CUSTOM_CMD"/, 'command runs via sh -c');
  for (const v of ['DOC_ALIGN_RANGE', 'DOC_ALIGN_GATE', 'DOC_ALIGN_REPORT']) {
    assert.ok(block.includes(`${v}=`), `exports ${v}`);
  }
  assert.match(block, /\[ -s report\.md \]/, 'empty report is a harness error');
  assert.ok(!/exit 0|exit 1/.test(block), 'custom block never exits — note upsert must still run');
});

test('direct template: DOC_ALIGN_LLM_CUSTOM_CMD swaps llm-check.js for a custom harness step under the same gate', () => {
  const y = readFileSync(ROOT + DIRECT, 'utf8');
  const directStep = y.indexOf('Drift check (direct LLM call)');
  const customStep = y.indexOf('Drift check (custom harness)');
  const upsert = y.indexOf('Upsert PR comment');
  assert.ok(directStep < customStep && customStep < upsert, 'custom step between direct step and upsert');
  const directBlock = y.slice(directStep, customStep);
  const customBlock = y.slice(customStep, upsert);
  assert.match(directBlock, /vars\.DOC_ALIGN_LLM_CUSTOM_CMD == ''/, 'direct step only when no custom cmd');
  assert.match(customBlock, /steps\.gate\.outputs\.skip != 'true' && vars\.DOC_ALIGN_LLM_CUSTOM_CMD != ''/, 'custom step gated and opt-in');
  assert.match(customBlock, /DOC_ALIGN_LLM_CUSTOM_CMD: \$\{\{ vars\.DOC_ALIGN_LLM_CUSTOM_CMD \}\}/, 'command reaches the shell via env:, not spliced');
  assert.match(customBlock, /DOC_ALIGN_RANGE: \$\{\{ steps\.gate\.outputs\.range \}\}/, 'range via env');
  for (const v of ['DOC_ALIGN_DIR=', 'DOC_ALIGN_REPORT=', 'DOC_ALIGN_GATE=']) assert.ok(customBlock.includes(v), `exports ${v}`);
  assert.match(y, /ci-gate\.js" --base "origin\/\$BASE_REF" \| tee "\$RUNNER_TEMP\/gate\.json"/, 'gate JSON persisted for the harness');
  assert.match(customBlock, /\[ -s "\$DOC_ALIGN_REPORT" \]/, 'empty report is a harness error');
});

test('opencode CI templates grant external_directory permission on the doc-align dir (opencode run auto-rejects otherwise)', () => {
  for (const f of ['ci/doc-align-opencode.yml', GITLAB]) {
    const y = readFileSync(ROOT + f, 'utf8');
    const permIdx = y.indexOf('permission: { external_directory:');
    const runIdx = y.indexOf('opencode run');
    assert.ok(permIdx > -1, `${f}: writes permission.external_directory`);
    assert.ok(permIdx < runIdx, `${f}: permission written before opencode run`);
    assert.match(y, /process\.env\.DOC_ALIGN_DIR \+ "\/\*\*"/, `${f}: permission keyed on DOC_ALIGN_DIR`);
    assert.match(y, /export DOC_ALIGN_DIR=/, `${f}: DOC_ALIGN_DIR exported for the config`);
    // permission is unconditional; provider block only when BASE_URL set
    assert.match(y, /if \(process\.env\.DOC_ALIGN_LLM_BASE_URL\) cfg\.provider/, `${f}: provider block conditional`);
  }
});

// ── agent runner（內建 tool loop：bin/doc-align.js）─────────────────────────

test('gitlab + direct templates: DOC_ALIGN_LLM_RUNNER=agent runs bin/doc-align.js check non-interactively into the same report path', () => {
  const gl = readFileSync(`${ROOT}ci/doc-align-gitlab.yml`, 'utf8');
  const agentIf = gl.indexOf('= "agent" ]; then');
  assert.ok(agentIf > -1, 'gitlab has agent branch');
  assert.ok(agentIf > gl.indexOf('= "direct" ]; then') && agentIf < gl.indexOf('= "opencode" ]; then'), 'agent block sits between direct and opencode');
  assert.match(gl.slice(agentIf, agentIf + 300), /bin\/doc-align\.js" sync --dry-run --range "\$RANGE" --yes --quiet --out report\.md/);
  assert.match(gl, /DOC_ALIGN_LLM_RUNNER\s+— 選配：direct（預設）／agent／opencode／custom/);

  const gh = readFileSync(`${ROOT}ci/doc-align-direct.yml`, 'utf8');
  assert.match(gh, /DOC_ALIGN_LLM_RUNNER: \$\{\{ vars\.DOC_ALIGN_LLM_RUNNER \}\}/, 'runner reaches the shell via env:');
  assert.match(gh, /if \[ "\$DOC_ALIGN_LLM_RUNNER" = "agent" \]; then\n\s+node "\$RUNNER_TEMP\/doc-align\/bin\/doc-align\.js" sync --dry-run --range "\$RANGE" --yes --quiet --out "\$RUNNER_TEMP\/report\.md"/);
  assert.match(gh, /else\n\s+node "\$RUNNER_TEMP\/doc-align\/scripts\/llm-check\.js"/, 'direct stays the default');
});
