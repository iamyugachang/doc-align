import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize } from '../scripts/lib/yaml-lite.js';

const SAMPLE = `docs:
  - path: flows/refund.md
    type: sequence
    watch:
      - src/billing/**
      - src/api/routes/refund.py
    last_verified: a1b2c3d

  - path: db-schema.md
    type: db-schema
    watch:
      - migrations/**
`;

test('parse reads the manifest subset', () => {
  const { docs } = parse(SAMPLE);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].path, 'flows/refund.md');
  assert.equal(docs[0].type, 'sequence');
  assert.deepEqual(docs[0].watch, ['src/billing/**', 'src/api/routes/refund.py']);
  assert.equal(docs[0].last_verified, 'a1b2c3d');
  assert.equal(docs[1].last_verified, undefined);
});

test('serialize then parse round-trips', () => {
  const once = parse(SAMPLE);
  assert.deepEqual(parse(serialize(once)), once);
});

test('comments and blank lines are ignored', () => {
  const { docs } = parse('# managed by doc-align\n\n' + SAMPLE);
  assert.equal(docs.length, 2);
});

test('unrecognized structure throws', () => {
  assert.throws(() => parse('foo:\n  bar: 1\n'), /unrecognized line/);
});

test('serialize throws on entry missing type', () => {
  assert.throws(() => serialize({ docs: [{ path: 'x.md' }] }), /missing path\/type/);
});
