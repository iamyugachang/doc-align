// scripts/lib/deps-graph.js — layers 文件的機械驗證零件（純函式，無 I/O）。
//
// layers 文件宣告「哪些目錄屬於哪一層」（層級表）與「哪層可以依賴哪層」（flowchart 的邊），
// 這裡提供：解析層級表、解析允許邊、從原始碼抽 import、把 import 解析成 repo 內檔案、
// 最後算出違規（實際 import 邊不在允許集合內）。支援 Python 與 JS/TS 的相對／repo 內 import；
// 外部套件與無法解析的路徑一律略過（不猜）。

import { extractMermaidBlocks } from './mermaid-er.js';
import { matchesAny } from './glob.js';

// 層級表：markdown 表格，欄位順序固定「層 | 目錄 | 說明」（說明可省略）。目錄欄可含多個 glob，
// 以 `、` 或 `,` 分隔；每格可用反引號包。回傳 [{ layer, globs }]。
export function parseLayerTable(md) {
  const rows = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i].trim();
    if (!l.startsWith('|')) continue;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const head = cells[0].replace(/[*`]/g, '');
    if (/^層|^layer$/i.test(head)) { // header row
      // consume separator row if present
      continue;
    }
    if (/^:?-+:?$/.test(cells[0])) continue;
    const layer = head;
    const globs = cells[1].replace(/`/g, '').split(/[、,]\s*/).map((g) => g.trim()).filter(Boolean);
    if (!layer || !globs.length) continue;
    rows.push({ layer, globs });
  }
  return rows;
}

// 允許邊：文件內第一個 flowchart／graph 區塊中的 A --> B（A 可依賴 B）。節點 id 後可帶 [標籤]。
// 也接受 `A --> B & C`、`A & B --> C`。回傳 Set("A->B")。
export function parseAllowedEdges(md) {
  const edges = new Set();
  const blocks = extractMermaidBlocks(md).filter((b) => /^\s*(flowchart|graph)\b/.test(b.trim()));
  if (!blocks.length) return edges;
  for (const raw of blocks[0].split('\n')) {
    const line = raw.replace(/%%.*$/, '').trim();
    const m = line.match(/^(.+?)\s*-{2,}>?\s*(?:\|[^|]*\|\s*)?(.+)$/);
    if (!m || !/-->|--->|==>/.test(line)) continue;
    const clean = (side) => side.split('&').map((s) => s.trim().replace(/[\[\(\{].*$/, '').replace(/^["']|["']$/g, '').trim()).filter(Boolean);
    const lhs = clean(m[1]);
    const rhs = clean(m[2].replace(/-{2,}>.*$/, ''));
    for (const a of lhs) for (const b of rhs) if (a && b && a !== b) edges.add(`${a}->${b}`);
  }
  return edges;
}

export function layerOf(file, table) {
  for (const { layer, globs } of table) if (matchesAny(file, globs)) return layer;
  return null;
}

// 從單一檔案內容抽 import 規格（不解析）。回傳 [{ spec, line, kind }]，kind ∈ py-abs/py-rel/js。
export function extractImports(file, text) {
  const out = [];
  const lines = text.split('\n');
  if (/\.py$/.test(file)) {
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      let m = l.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+/);
      if (m) { out.push({ spec: m[1] + m[2], line: i + 1, kind: m[1] ? 'py-rel' : 'py-abs' }); continue; }
      m = l.match(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/);
      if (m) for (const sp of m[1].split(',')) out.push({ spec: sp.trim().split(/\s+as\s+/)[0], line: i + 1, kind: 'py-abs' });
    }
  } else if (/\.(m?js|cjs|jsx|ts|tsx|mts|cts)$/.test(file)) {
    const re = /(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+[^'";]*?\s+from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;
    for (let i = 0; i < lines.length; i += 1) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(lines[i]))) out.push({ spec: m[1], line: i + 1, kind: 'js' });
    }
  }
  return out;
}

const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

function dirnameOf(f) { return f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''; }
function normalize(p) {
  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join('/');
}

// 把 import 規格解析成 repo 內檔案（fileSet：repo 檔案集合）。解析不到回 null（外部套件等）。
// pyRoots：Python 絕對 import 的搜尋根（預設 '' 與 'src'）。
export function resolveImport(fromFile, imp, fileSet, { pyRoots = ['', 'src'] } = {}) {
  const has = (p) => p && fileSet.has(p);
  const tryPy = (base) => has(`${base}.py`) ? `${base}.py` : has(`${base}/__init__.py`) ? `${base}/__init__.py` : null;
  if (imp.kind === 'py-rel') {
    const dots = imp.spec.match(/^\.+/)[0].length;
    let dir = dirnameOf(fromFile);
    for (let i = 1; i < dots; i += 1) dir = dirnameOf(dir);
    const rest = imp.spec.slice(dots).replace(/\./g, '/');
    const base = normalize(rest ? `${dir}/${rest}` : dir);
    if (base === null) return null;
    return tryPy(base) || (has(base) ? base : null);
  }
  if (imp.kind === 'py-abs') {
    const rel = imp.spec.replace(/\./g, '/');
    for (const root of pyRoots) {
      const r = tryPy(root ? `${root}/${rel}` : rel);
      if (r) return r;
    }
    // 也試「from pkg.mod import name」裡 name 其實是子模組的情況不處理；只解析 spec 本身
    return null;
  }
  if (imp.kind === 'js') {
    if (!imp.spec.startsWith('.') && !imp.spec.startsWith('/')) return null; // bare specifier＝套件或 alias，不猜
    if (imp.spec.startsWith('/')) return null;
    const base = normalize(`${dirnameOf(fromFile)}/${imp.spec}`);
    if (base === null) return null;
    if (has(base) && !fileSet.has(`${base}/index.js`)) return base;
    for (const e of JS_EXT) if (has(base + e)) return base + e;
    for (const e of JS_EXT) if (has(`${base}/index${e}`)) return `${base}/index${e}`;
    // TS 慣例：import './x.js' 實為 x.ts
    const stripped = base.replace(/\.(m?js|cjs)$/, '');
    if (stripped !== base) for (const e of ['.ts', '.tsx', '.mts', '.cts']) if (has(stripped + e)) return stripped + e;
    return null;
  }
  return null;
}

// 主函式：回傳 { status, violations, unassigned, edges, stats }。
// files：[{ path, text }]（呼叫端只餵層級表 glob 涵蓋到的原始碼即可）。
export function checkLayers({ docText, files, pyRoots }) {
  const table = parseLayerTable(docText);
  const allowed = parseAllowedEdges(docText);
  if (!table.length) return { status: 'unsupported', reason: 'no layer table (| 層 | 目錄 | … |)', violations: [], unassigned: [], edges: [], stats: {} };
  if (!allowed.size) return { status: 'unsupported', reason: 'no flowchart edges (A --> B) declaring allowed dependencies', violations: [], unassigned: [], edges: [], stats: {} };
  const declared = new Set(table.map((t) => t.layer));
  for (const e of allowed) for (const n of e.split('->')) if (!declared.has(n)) {
    return { status: 'unsupported', reason: `edge node '${n}' is not a layer in the table`, violations: [], unassigned: [], edges: [], stats: {} };
  }
  const fileSet = new Set(files.map((f) => f.path));
  const violations = [];
  const unassigned = new Set();
  const edgeCounts = new Map();
  let imports = 0; let resolved = 0;
  for (const f of files) {
    const fromLayer = layerOf(f.path, table);
    if (!fromLayer) continue;
    for (const imp of extractImports(f.path, f.text)) {
      imports += 1;
      const target = resolveImport(f.path, imp, fileSet, { pyRoots });
      if (!target) continue;
      resolved += 1;
      const toLayer = layerOf(target, table);
      if (!toLayer) { unassigned.add(target); continue; }
      if (toLayer === fromLayer) continue;
      const key = `${fromLayer}->${toLayer}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      if (!allowed.has(key)) violations.push({ from: f.path, line: imp.line, import: imp.spec, to: target, fromLayer, toLayer });
    }
  }
  return {
    status: violations.length ? 'drift' : 'ok',
    violations,
    unassigned: [...unassigned].sort(),
    edges: [...edgeCounts].map(([k, n]) => ({ edge: k, count: n, allowed: allowed.has(k) })),
    stats: { files: files.length, imports, resolved, layers: table.length, allowedEdges: allowed.size },
  };
}
