import test from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, matchesAny } from '../scripts/lib/glob.js';

test('** matches any depth under a prefix', () => {
  assert.ok(globToRegExp('src/billing/**').test('src/billing/refund.py'));
  assert.ok(globToRegExp('src/billing/**').test('src/billing/deep/x.py'));
  assert.ok(!globToRegExp('src/billing/**').test('src/api/refund.py'));
});

test('* stays within one path segment', () => {
  assert.ok(globToRegExp('src/*.py').test('src/main.py'));
  assert.ok(!globToRegExp('src/*.py').test('src/pkg/main.py'));
});

test('leading **/ matches zero or more segments', () => {
  assert.ok(globToRegExp('**/test_*.py').test('a/b/test_x.py'));
  assert.ok(globToRegExp('**/test_*.py').test('test_x.py'));
});

test('literal dots are not wildcards', () => {
  assert.ok(!globToRegExp('src/a.py').test('src/aXpy'));
});

test('matchesAny checks a pattern list', () => {
  assert.ok(matchesAny('src/api/routes/refund.py', ['src/billing/**', 'src/api/routes/refund.py']));
  assert.ok(!matchesAny('README.md', ['src/**']));
});
