// tests/pipeline.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const S = (name) => new URL(`../scripts/${name}`, import.meta.url).pathname;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const node = (args, cwd) => JSON.parse(execFileSync('node', args, { cwd, encoding: 'utf8' }));

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-fixture-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@test');
  git(dir, 'config', 'user.name', 'test');
  mkdirSync(join(dir, 'src/billing'), { recursive: true });
  mkdirSync(join(dir, 'migrations'), { recursive: true });
  mkdirSync(join(dir, 'docs/flows'), { recursive: true });
  writeFileSync(join(dir, 'src/billing/refund.py'), 'def refund(order_id): pass\n');
  writeFileSync(join(dir, 'migrations/001.sql'), 'CREATE TABLE refunds (id SERIAL, order_id INT);');
  writeFileSync(join(dir, 'docs/flows/refund.md'), `# 退款流程

\`\`\`mermaid
sequenceDiagram
  API->>BillingService: refund(order_id)
  BillingService-->>API: ok
\`\`\`

- 退款只允許 30 天內的訂單。
`);
  writeFileSync(join(dir, 'docs/db-schema.md'), `# DB Schema

\`\`\`mermaid
erDiagram
  REFUNDS {
    int id PK
    int order_id
  }
\`\`\`
`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'docs/.docalign.yml'), `docs:
  - path: flows/refund.md
    type: sequence
    watch:
      - src/billing/**
    last_verified: ${base}
  - path: db-schema.md
    type: db-schema
    watch:
      - migrations/**
    last_verified: ${base}
`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'docs + manifest');
  return dir;
}

test('pipeline: change code -> detect -> schema drift -> verify -> clean', () => {
  const dir = makeFixture();

  // 1. 改 code：billing 邏輯變動 + 新增 migration
  appendFileSync(join(dir, 'src/billing/refund.py'), 'def cancel(order_id): pass\n');
  writeFileSync(join(dir, 'migrations/002.sql'), 'ALTER TABLE refunds ADD COLUMN reason VARCHAR(255);');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'add cancel + reason column');

  // 2. changed-scope 抓到兩份文件受影響
  const scope = node([S('changed-scope.js'), '--repo', dir], dir);
  assert.equal(scope.docs.find((d) => d.path === 'flows/refund.md').status, 'affected');
  assert.deepEqual(scope.docs.find((d) => d.path === 'flows/refund.md').matchedFiles, ['src/billing/refund.py']);
  assert.equal(scope.docs.find((d) => d.path === 'db-schema.md').status, 'affected');
  assert.deepEqual(scope.docs.find((d) => d.path === 'db-schema.md').matchedFiles, ['migrations/002.sql']);

  // 3. schema-diff 抓到欄位缺漏
  const sd = node([S('schema-diff.js'), '--doc', join(dir, 'docs/db-schema.md'), '--sql', join(dir, 'migrations')], dir);
  assert.equal(sd.status, 'drift');
  assert.deepEqual(sd.drifts, [{ kind: 'column_missing_in_doc', table: 'refunds', column: 'reason' }]);
  assert.deepEqual(sd.unsupportedStatements, []);

  // 4. （模擬 sync 完成後）set-verified 推進，changed-scope 轉 clean
  const head = git(dir, 'rev-parse', 'HEAD');
  for (const doc of ['flows/refund.md', 'db-schema.md']) {
    execFileSync('node', [S('manifest.js'), 'set-verified', '--manifest', join(dir, 'docs/.docalign.yml'), '--doc', doc, '--commit', head]);
  }
  const after = node([S('changed-scope.js'), '--repo', dir], dir);
  assert.ok(after.docs.every((d) => d.status === 'clean'));
});
