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
    const gateIdx = y.indexOf('ci-gate.js');
    const mermaidIdx = y.indexOf('mermaid-check.js');
    const llmIdx = f.includes('claude') ? y.indexOf('claude -p') : y.indexOf('opencode run');
    assert.ok(gateIdx < mermaidIdx && mermaidIdx < llmIdx, `${f}: mermaid lint sits between gate and LLM`);
  }
});
