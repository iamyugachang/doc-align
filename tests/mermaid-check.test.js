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

test('ASCII parens directly adjacent to CJK text are flagged', () => {
  const block = 'flowchart TD\n  A[dbt run(執行全部模型)] --> B\n';
  assert.ok(checkBlock(block).includes('mixed-width parens near CJK text (use （） )'));
});

test('full-width parens beside CJK text do not false-positive', () => {
  const block = 'flowchart TD\n  A[dbt run（執行全部模型）] --> B\n';
  assert.deepEqual(checkBlock(block), []);
});

test('pure-English ASCII parens do not false-positive', () => {
  const block = 'flowchart TD\n  A[run(all)] --> B\n';
  assert.deepEqual(checkBlock(block), []);
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

// ── complexity budget（diagram-design 換算）──────────────────────────────────

test('checkBudget counts flowchart nodes/edges/subgraphs and warns over budget; ER is exempt', async () => {
  const { checkBudget } = await import('../scripts/mermaid-check.js');
  const small = 'flowchart TD\n  a[A] --> b[B]\n  b -->|x| c\n  subgraph s\n    c --> d\n  end\n';
  const r = checkBudget(small);
  assert.equal(r.kind, 'flowchart');
  assert.deepEqual(r.stats, { nodes: 4, edges: 3, subgraphs: 1 });
  assert.deepEqual(r.warnings, []);
  const big = 'flowchart LR\n' + Array.from({ length: 14 }, (_, i) => `  n${i} --> n${i + 1}`).join('\n');
  const rb = checkBudget(big);
  assert.equal(rb.stats.nodes, 15);
  assert.ok(rb.warnings.some((w) => /nodes=15 exceeds budget 12/.test(w)));
  assert.deepEqual(checkBudget('erDiagram\n' + Array.from({ length: 20 }, (_, i) => `  T${i} ||--o{ T${i + 1} : r`).join('\n')).warnings, []);
});

test('checkBudget: sequence lifelines/alt/nesting, state states/transitions, class classes/relations', async () => {
  const { checkBudget } = await import('../scripts/mermaid-check.js');
  const seq = 'sequenceDiagram\n  participant A\n  A->>B: x\n  B-->>C: y\n  alt ok\n    C->>D: z\n  else bad\n    loop retry\n      D->>E: w\n    end\n  end\n  E->>F: q\n';
  const rs = checkBudget(seq);
  assert.equal(rs.kind, 'sequence');
  assert.equal(rs.stats.lifelines, 6);
  assert.equal(rs.stats.alt, 2);
  assert.equal(rs.stats.nesting, 1);
  assert.ok(rs.warnings.some((w) => /lifelines=6 exceeds budget 5/.test(w)));
  const st = 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> Done\n  Done --> [*]\n';
  assert.deepEqual(checkBudget(st).stats, { states: 3, transitions: 4 });
  const cl = 'classDiagram\n  class A {\n    +int x\n  }\n  class B\n  A <|-- B\n  B --> C : uses\n';
  const rc = checkBudget(cl);
  assert.equal(rc.stats.classes, 3);
  assert.equal(rc.stats.relations, 2);
  assert.equal(checkBudget('gantt\n  title x\n').kind, null);
});

test('CLI: warnings do not fail unless --strict-budget; JSON carries kind/stats', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-budget-'));
  const f = join(dir, 'big.md');
  writeFileSync(f, '# big\n\n```mermaid\nflowchart LR\n' + Array.from({ length: 14 }, (_, i) => `  n${i} --> n${i + 1}`).join('\n') + '\n```\n');
  const out = JSON.parse(execFileSync('node', [SCRIPT, f], { encoding: 'utf8' }));
  assert.equal(out.results[0].kind, 'flowchart');
  assert.ok(out.results[0].warnings.length > 0);
  assert.throws(() => execFileSync('node', [SCRIPT, '--strict-budget', f], { stdio: 'pipe' }));
});
