import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  anchorFor, convertMarkdown, docTitle, renderHandbook, renderInline,
} from '../scripts/lib/markdown-html.js';

const SCRIPT = new URL('../scripts/render-handbook.js', import.meta.url).pathname;

// ── renderInline ─────────────────────────────────────────────────────────────

test('renderInline escapes HTML and renders bold/code', () => {
  const out = renderInline('a <b> & **粗** `c<d>`');
  assert.ok(out.includes('&lt;b&gt;'));
  assert.ok(out.includes('&amp;'));
  assert.ok(out.includes('<strong>粗</strong>'));
  assert.ok(out.includes('<code>c&lt;d&gt;</code>'));
});

test('renderInline turns （file:line）citations into cite chips', () => {
  const out = renderInline('規則（genie/cli.py:62-76）成立');
  assert.ok(out.includes('<code class="cite">genie/cli.py:62-76</code>'));
});

test('renderInline links manifest doc paths to section anchors', () => {
  const linkMap = new Map([['flows/a.md', 'flows-a']]);
  const out = renderInline('詳見 flows/a.md 說明', linkMap);
  assert.ok(out.includes('<a href="#flows-a">flows/a.md</a>'));
});

test('double-star glob inside inline code is not bolded', () => {
  const out = renderInline('watch `src/**` 與 `lib/**` 兩個範圍');
  assert.ok(out.includes('<code>src/**</code>'));
  assert.ok(!out.includes('<strong>'));
});

// ── convertMarkdown ──────────────────────────────────────────────────────────

test('mermaid fences become pre.mermaid, other fences stay code', () => {
  const out = convertMarkdown('```mermaid\ngraph LR\n  A --> B\n```\n```sql\nSELECT 1;\n```');
  assert.ok(out.includes('<pre class="mermaid">graph LR\n  A --&gt; B</pre>'));
  assert.ok(out.includes('<pre><code>SELECT 1;</code></pre>'));
});

test('pipe tables become table with header and rows', () => {
  const out = convertMarkdown('| 欄 | 值 |\n|---|---|\n| a | b |\n| c | d |');
  assert.ok(out.includes('<th>欄</th>'));
  assert.ok(out.includes('<td>d</td>'));
  assert.equal((out.match(/<tr>/g) || []).length, 3);
});

test('numbered lines become ol.rules preserving start', () => {
  const out = convertMarkdown('3. 第三條\n4. 第四條');
  assert.ok(out.includes('<ol class="rules" start="3">'));
  assert.equal((out.match(/<li>/g) || []).length, 2);
});

test('h1 is dropped, h2 becomes h3', () => {
  const out = convertMarkdown('# 標題\n\n## 段落標\n\n內文');
  assert.ok(!out.includes('標題</h'));
  assert.ok(out.includes('<h3>段落標</h3>'));
  assert.ok(out.includes('<p>內文</p>'));
});

test('docTitle reads the first h1', () => {
  assert.equal(docTitle('# 我的文件\n\n內容', 'x'), '我的文件');
  assert.equal(docTitle('無標題', 'fallback'), 'fallback');
});

test('anchorFor slugs paths deterministically', () => {
  assert.equal(anchorFor('flows/trino-research-direct.md'), 'flows-trino-research-direct');
  assert.equal(anchorFor('overview.md'), 'overview');
});

// ── renderHandbook ───────────────────────────────────────────────────────────

const DOCS = [
  { path: 'flows/refund.md', type: 'sequence', md: '# 退款流程\n\n見 overview.md（app/x.py:12）' },
  { path: 'overview.md', type: 'overview', md: '# 導讀\n\n先讀本文件' },
];

test('renderHandbook orders sections by type (overview first) and links cross-refs', () => {
  const html = renderHandbook(DOCS, { repoName: 'demo', generatedAt: '2026-08-14', headSha: 'abc1234' });
  assert.ok(html.indexOf('id="overview"') < html.indexOf('id="flows-refund"'));
  assert.ok(html.includes('<a href="#overview">overview.md</a>'));
  assert.ok(html.includes('<code class="cite">app/x.py:12</code>'));
  assert.ok(html.includes('demo Handbook'));
  assert.ok(html.includes('abc1234'));
});

test('renderHandbook output is a complete standalone document', () => {
  const html = renderHandbook(DOCS, { repoName: 'demo', generatedAt: '', headSha: '' });
  for (const marker of ['<!doctype html>', '</head>', '<body>', '</body>', '</html>', 'mermaid.esm.min.mjs']) {
    assert.equal(html.split(marker).length - 1, 1, marker);
  }
  assert.equal((html.match(/<section /g) || []).length, 2);
  assert.equal((html.match(/<\/section>/g) || []).length, 2);
});

// ── CLI end-to-end ───────────────────────────────────────────────────────────

test('render-handbook.js renders manifest docs and reports skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-render-'));
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', '.docalign.yml'),
    '# managed by doc-align\ndocs:\n' +
    '  - path: overview.md\n    type: overview\n' +
    '  - path: missing.md\n    type: class\n');
  writeFileSync(join(dir, 'docs', 'overview.md'), '# 導讀\n\n哈囉');
  const stdout = execFileSync('node', [SCRIPT], { cwd: dir }).toString();
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.sections, 1);
  assert.deepEqual(result.skipped, ['missing.md']);
  const html = readFileSync(join(dir, result.out), 'utf8');
  assert.ok(html.includes('哈囉'));
  assert.ok(html.includes('Handbook'));
});

test('render-handbook.js exits 1 without a manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-render-'));
  assert.throws(() => execFileSync('node', [SCRIPT], { cwd: dir, stdio: 'pipe' }));
});
