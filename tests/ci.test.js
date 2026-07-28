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
