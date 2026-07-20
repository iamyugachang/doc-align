import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkBlock } from '../scripts/mermaid-check.js';

const SCRIPT = new URL('../scripts/mermaid-check.js', import.meta.url).pathname;

test('valid sequenceDiagram passes', () => {
  assert.deepEqual(checkBlock('sequenceDiagram\n  A->>B: hello\n  B-->>A: ok\n'), []);
});

test('erDiagram relation cardinality does not false-positive', () => {
  const er = 'erDiagram\n  USERS {\n    int id PK\n  }\n  USERS ||--o{ ORDERS : places\n';
  assert.deepEqual(checkBlock(er), []);
});

test('unknown diagram type is flagged', () => {
  assert.deepEqual(checkBlock('notADiagram\n  x\n'), ['unknown diagram type: notADiagram']);
});

test('unbalanced brackets are flagged', () => {
  assert.ok(checkBlock('classDiagram\n  class Foo {\n    +int x\n').includes('unbalanced brackets'));
});

test('empty body is flagged', () => {
  assert.ok(checkBlock('flowchart TD\n').includes('empty diagram body'));
});

test('flowchart with quoted labels and a no-space arrow does not false-positive', () => {
  const block = 'flowchart TD\n  A["API Gateway"]-->B["Auth Service"]\n';
  assert.deepEqual(checkBlock(block), []);
});

test('an init directive before the diagram type keyword is skipped for type detection', () => {
  const block = '%%{init: {"theme": "base"}}%%\nflowchart TD\n  A --> B\n';
  assert.deepEqual(checkBlock(block), []);
});

test('an unterminated quote is confined to its own line', () => {
  const block = 'flowchart TD\n  A[Cable 5" spec] --> B\n  C --> D\n';
  const errors = checkBlock(block);
  assert.ok(errors.includes('unterminated string'));
  assert.ok(!errors.includes('unbalanced brackets'));
});

test('sequenceDiagram with a no-space arrow does not false-positive', () => {
  assert.deepEqual(checkBlock('sequenceDiagram\n  BillingService-->>API: ok\n'), []);
});

test('CLI exits 1 when a file contains an invalid block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-mmd-'));
  const good = join(dir, 'good.md');
  const bad = join(dir, 'bad.md');
  writeFileSync(good, '```mermaid\nflowchart TD\n  A --> B\n```\n');
  writeFileSync(bad, '```mermaid\nbogusDiagram\n  x\n```\n');
  execFileSync('node', [SCRIPT, good]); // exit 0
  assert.throws(() => execFileSync('node', [SCRIPT, bad]));
});
