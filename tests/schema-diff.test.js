// tests/schema-diff.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { diffSchemas } from '../scripts/schema-diff.js';

const SCRIPT = new URL('../scripts/schema-diff.js', import.meta.url).pathname;

test('diffSchemas reports missing tables/columns and type mismatches', () => {
  const doc = { users: { columns: { id: { type: 'int' }, email: { type: 'string' }, ghost: { type: 'int' } } } };
  const db = {
    users: { columns: { id: { type: 'int' }, email: { type: 'datetime' } } },
    orders: { columns: { id: { type: 'int' } } },
  };
  const kinds = diffSchemas(doc, db).map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['column_missing_in_db', 'table_missing_in_doc', 'type_mismatch']);
});

test('CLI compares doc erDiagram against a migrations dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-schema-'));
  mkdirSync(join(dir, 'migrations'));
  writeFileSync(join(dir, 'migrations/001.sql'), 'CREATE TABLE users (id SERIAL, email VARCHAR(255));');
  writeFileSync(join(dir, 'migrations/002.sql'), 'ALTER TABLE users ADD COLUMN age INT;');
  writeFileSync(join(dir, 'db-schema.md'), `# Schema

\`\`\`mermaid
erDiagram
  USERS {
    int id PK
    string email
  }
\`\`\`
`);
  const out = JSON.parse(execFileSync('node',
    [SCRIPT, '--doc', join(dir, 'db-schema.md'), '--sql', join(dir, 'migrations')], { encoding: 'utf8' }));
  assert.equal(out.status, 'drift');
  assert.deepEqual(out.drifts, [{ kind: 'column_missing_in_doc', table: 'users', column: 'age' }]);
});

test('CLI reports unsupported when doc has no erDiagram', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-schema-'));
  writeFileSync(join(dir, 'db-schema.md'), '# empty\n');
  writeFileSync(join(dir, 'schema.sql'), 'CREATE TABLE t (id INT);');
  const out = JSON.parse(execFileSync('node',
    [SCRIPT, '--doc', join(dir, 'db-schema.md'), '--sql', join(dir, 'schema.sql')], { encoding: 'utf8' }));
  assert.equal(out.status, 'unsupported');
});
