// tests/sql-ddl.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSqlDdl, normalizeType } from '../scripts/lib/sql-ddl.js';

test('normalizeType maps SQL types onto doc-level types', () => {
  assert.equal(normalizeType('VARCHAR(255)'), 'string');
  assert.equal(normalizeType('BIGINT'), 'int');
  assert.equal(normalizeType('timestamptz'), 'datetime');
  assert.equal(normalizeType('jsonb'), 'jsonb'); // unknown types pass through lowercased
});

test('parses CREATE TABLE with constraints skipped', () => {
  const { tables } = parseSqlDdl(`
    CREATE TABLE users (
      id SERIAL,
      email VARCHAR(255) NOT NULL,
      PRIMARY KEY (id)
    );
  `);
  assert.deepEqual(Object.keys(tables.users.columns).sort(), ['email', 'id']);
  assert.equal(tables.users.columns.email.type, 'string');
});

test('applies ALTER ADD/DROP and DROP TABLE across migrations', () => {
  const { tables } = parseSqlDdl(`
    CREATE TABLE users (id INT);
    CREATE TABLE tmp (id INT);
    ALTER TABLE users ADD COLUMN age INT;
    ALTER TABLE users DROP COLUMN id;
    DROP TABLE tmp;
  `);
  assert.deepEqual(Object.keys(tables), ['users']);
  assert.deepEqual(Object.keys(tables.users.columns), ['age']);
});

test('unsupported statements are reported, not silently dropped', () => {
  const { unsupported } = parseSqlDdl('CREATE INDEX idx ON users (email);');
  assert.equal(unsupported.length, 1);
  assert.match(unsupported[0], /CREATE INDEX/i);
});
