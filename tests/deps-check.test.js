import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkLayers, extractImports, parseAllowedEdges, parseLayerTable, resolveImport,
} from '../scripts/lib/deps-graph.js';

const SCRIPT = new URL('../scripts/deps-check.js', import.meta.url).pathname;

const DOC = `# 分層依賴

## 圖

\`\`\`mermaid
flowchart TD
  api[API 層] --> domain[Domain 層]
  domain --> infra[Infra 層]
  api --> infra
\`\`\`

## 層級表

| 層 | 目錄 | 說明 |
|---|---|---|
| api | \`src/api/**\` | HTTP 入口 |
| domain | \`src/domain/**\`、\`src/core/**\` | 商業邏輯 |
| infra | \`src/infra/**\` | DB／外部服務 |
`;

test('parseLayerTable reads layer → globs (multi-glob cell, backticks), skipping header/separator', () => {
  assert.deepEqual(parseLayerTable(DOC), [
    { layer: 'api', globs: ['src/api/**'] },
    { layer: 'domain', globs: ['src/domain/**', 'src/core/**'] },
    { layer: 'infra', globs: ['src/infra/**'] },
  ]);
});

test('parseAllowedEdges reads A --> B from the first flowchart, ignoring labels and & fan-out', () => {
  assert.deepEqual([...parseAllowedEdges(DOC)].sort(), ['api->domain', 'api->infra', 'domain->infra']);
  const fan = '```mermaid\nflowchart LR\n  a --> b & c\n  b & c --> d\n  x -->|uses| y\n```';
  assert.deepEqual([...parseAllowedEdges(fan)].sort(), ['a->b', 'a->c', 'b->d', 'c->d', 'x->y']);
  assert.equal(parseAllowedEdges('no diagram').size, 0);
});

test('extractImports handles python abs/rel and js import/require/export-from/dynamic', () => {
  const py = extractImports('src/a/b.py', 'import os, sys\nfrom . import x\nfrom ..infra.db import conn\nfrom src.core.svc import S\nimport json as j\n');
  assert.deepEqual(py.map((i) => [i.kind, i.spec]), [
    ['py-abs', 'os'], ['py-abs', 'sys'], ['py-rel', '.'], ['py-rel', '..infra.db'], ['py-abs', 'src.core.svc'], ['py-abs', 'json'],
  ]);
  const js = extractImports('src/a.ts', "import x from './x';\nimport { y } from \"../y.js\";\nexport * from './z';\nconst q = require('./q');\nconst d = await import('./d');\nimport pkg from 'pkg';\n");
  assert.deepEqual(js.map((i) => i.spec), ['./x', '../y.js', './z', './q', './d', 'pkg']);
});

test('resolveImport: py abs via roots / rel dots / __init__; js ext + index + .js→.ts; bare specifiers null', () => {
  const files = new Set(['src/api/r.py', 'src/domain/__init__.py', 'src/domain/svc.py', 'src/infra/db.py', 'web/a.ts', 'web/b/index.ts', 'web/c.ts']);
  const py = (spec, kind, from = 'src/api/r.py') => resolveImport(from, { spec, kind }, files);
  assert.equal(py('src.domain.svc', 'py-abs'), 'src/domain/svc.py');
  assert.equal(py('domain.svc', 'py-abs'), 'src/domain/svc.py', 'src root fallback');
  assert.equal(py('domain', 'py-abs'), 'src/domain/__init__.py');
  assert.equal(py('os', 'py-abs'), null);
  assert.equal(py('..infra.db', 'py-rel'), 'src/infra/db.py');
  assert.equal(py('.svc', 'py-rel', 'src/domain/x.py'), 'src/domain/svc.py');
  assert.equal(py('.', 'py-rel', 'src/domain/x.py'), 'src/domain/__init__.py');
  const js = (spec, from = 'web/a.ts') => resolveImport(from, { spec, kind: 'js' }, files);
  assert.equal(js('./b'), 'web/b/index.ts');
  assert.equal(js('./c'), 'web/c.ts');
  assert.equal(js('./c.js'), 'web/c.ts');
  assert.equal(js('react'), null);
  assert.equal(js('@/x'), null);
});

test('checkLayers: allowed edges pass, reverse import is a violation, unassigned targets listed, unsupported when no table', () => {
  const files = [
    { path: 'src/api/r.py', text: 'from src.domain.svc import S\nfrom src.infra.db import conn\n' },
    { path: 'src/domain/svc.py', text: 'from src.infra.db import conn\nfrom src.api.r import R  # 反向\nfrom src.util.h import h\n' },
    { path: 'src/infra/db.py', text: 'import os\n' },
    { path: 'src/util/h.py', text: '' },
  ];
  const r = checkLayers({ docText: DOC, files });
  assert.equal(r.status, 'drift');
  assert.deepEqual(r.violations.map((v) => [v.from, v.line, v.fromLayer, v.toLayer]), [['src/domain/svc.py', 2, 'domain', 'api']]);
  assert.deepEqual(r.unassigned, ['src/util/h.py']);
  assert.ok(r.edges.find((e) => e.edge === 'api->domain' && e.allowed));
  assert.ok(r.edges.find((e) => e.edge === 'domain->api' && !e.allowed));
  const ok = checkLayers({ docText: DOC, files: files.slice(0, 1) });
  assert.equal(ok.status, 'ok');
  assert.equal(checkLayers({ docText: '# nothing', files }).status, 'unsupported');
  assert.match(checkLayers({ docText: DOC.replace('api[API 層] --> domain[Domain 層]', 'api --> ghost'), files }).reason, /ghost/);
});

test('deps-check.js CLI: scans repo files under the layer globs and prints JSON; exit 0 on drift, 1 on unsupported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-deps-'));
  for (const d of ['docs', 'src/api', 'src/domain', 'src/infra']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'docs', 'layers.md'), DOC);
  writeFileSync(join(dir, 'src', 'api', 'r.py'), 'from src.domain.svc import S\n');
  writeFileSync(join(dir, 'src', 'domain', 'svc.py'), 'from src.infra.db import conn\n');
  writeFileSync(join(dir, 'src', 'infra', 'db.py'), 'from src.api.r import R\n');
  const out = JSON.parse(execFileSync('node', [SCRIPT, '--doc', 'docs/layers.md'], { cwd: dir, encoding: 'utf8' }));
  assert.equal(out.status, 'drift');
  assert.equal(out.violations.length, 1);
  assert.equal(out.violations[0].fromLayer, 'infra');
  assert.equal(out.stats.files, 3);
  writeFileSync(join(dir, 'docs', 'bad.md'), '# no table');
  assert.throws(() => execFileSync('node', [SCRIPT, '--doc', 'docs/bad.md'], { cwd: dir, stdio: 'pipe' }), /unsupported|no layer table|Command failed/);
});
