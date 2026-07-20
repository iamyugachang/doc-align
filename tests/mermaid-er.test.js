// tests/mermaid-er.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseErDiagram, extractMermaidBlocks } from '../scripts/lib/mermaid-er.js';

const ER = `erDiagram
  USERS {
    int id PK
    string email "login identity"
  }
  ORDERS {
    int id PK
    int user_id FK
  }
  USERS ||--o{ ORDERS : places
`;

test('parses tables, columns, and relations', () => {
  const { tables, relations } = parseErDiagram(ER);
  assert.deepEqual(Object.keys(tables).sort(), ['orders', 'users']);
  assert.equal(tables.users.columns.email.type, 'string');
  assert.equal(tables.users.columns.id.key, 'PK');
  assert.deepEqual(relations, [{ from: 'users', to: 'orders' }]);
});

test('rejects non-erDiagram source', () => {
  assert.throws(() => parseErDiagram('classDiagram\n  class A\n'), /not an erDiagram/);
});

test('extractMermaidBlocks pulls fenced blocks out of markdown', () => {
  const md = '# Schema\n\n```mermaid\n' + ER + '```\n\ntext\n';
  const blocks = extractMermaidBlocks(md);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /^erDiagram/);
});
