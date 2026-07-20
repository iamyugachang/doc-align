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

// --- hardening: string/comment-aware preprocessing ---

test('a semicolon inside a string literal does not split the statement', () => {
  const { tables } = parseSqlDdl(`CREATE TABLE t (id INT, note TEXT DEFAULT 'a;b');`);
  assert.deepEqual(Object.keys(tables.t.columns).sort(), ['id', 'note']);
});

test('a -- sequence inside a string literal is not treated as a comment', () => {
  const { tables } = parseSqlDdl(`CREATE TABLE t (id INT, note TEXT DEFAULT '-- not a comment');`);
  assert.deepEqual(Object.keys(tables.t.columns).sort(), ['id', 'note']);
  assert.equal(tables.t.columns.note.type, 'string');
});

test('a /* */ block comment before a column does not swallow the column', () => {
  const { tables } = parseSqlDdl('CREATE TABLE t (id INT, /* comment */ name TEXT);');
  assert.deepEqual(Object.keys(tables.t.columns).sort(), ['id', 'name']);
});

// --- hardening: schema-qualified names ---

test('schema-qualified table names are keyed by the bare table name', () => {
  const { tables } = parseSqlDdl(`
    CREATE TABLE shop.customers (id SERIAL, name VARCHAR(50));
    ALTER TABLE shop.customers ADD COLUMN email VARCHAR(255);
  `);
  assert.deepEqual(Object.keys(tables), ['customers']);
  assert.deepEqual(Object.keys(tables.customers.columns).sort(), ['email', 'id', 'name']);
});

// --- hardening: multi-word types ---

test('normalizeType maps multi-word SQL types onto doc-level types', () => {
  assert.equal(normalizeType('CHARACTER VARYING(30)'), 'string');
  assert.equal(normalizeType('DOUBLE PRECISION'), 'number');
  assert.equal(normalizeType('TIMESTAMP WITH TIME ZONE'), 'datetime');
  assert.equal(normalizeType('TIMESTAMP WITHOUT TIME ZONE'), 'datetime');
});

test('parses multi-word column types out of a CREATE TABLE', () => {
  const { tables } = parseSqlDdl(`
    CREATE TABLE items (
      name CHARACTER VARYING(30),
      price DOUBLE PRECISION,
      created_at TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITHOUT TIME ZONE
    );
  `);
  assert.equal(tables.items.columns.name.type, 'string');
  assert.equal(tables.items.columns.price.type, 'number');
  assert.equal(tables.items.columns.created_at.type, 'datetime');
  assert.equal(tables.items.columns.updated_at.type, 'datetime');
});

// --- hardening: trailing table-level clauses ---

test('CREATE TABLE tolerates trailing clauses after the column-list close paren', () => {
  const { tables: t1 } = parseSqlDdl('CREATE TABLE t (id INT) ENGINE=InnoDB DEFAULT CHARSET=utf8;');
  assert.deepEqual(Object.keys(t1.t.columns), ['id']);

  const { tables: t2 } = parseSqlDdl('CREATE TABLE t (id INT) WITHOUT OIDS;');
  assert.deepEqual(Object.keys(t2.t.columns), ['id']);
});

// --- hardening: splitTopLevel is quote-aware ---

test('commas inside a string literal do not split column definitions', () => {
  const { tables } = parseSqlDdl(`CREATE TABLE t (id INT, note TEXT DEFAULT 'a,b,c');`);
  assert.deepEqual(Object.keys(tables.t.columns).sort(), ['id', 'note']);
});
