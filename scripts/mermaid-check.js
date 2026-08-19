import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractMermaidBlocks } from './lib/mermaid-er.js';

const TYPES = [
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'erDiagram',
  'stateDiagram', 'stateDiagram-v2', 'journey', 'gantt', 'pie', 'mindmap',
  'timeline', 'quadrantChart', 'C4Context', 'C4Container', 'C4Component',
];

export function checkBlock(source) {
  const errors = [];
  const lines = source.trim().split('\n');

  // Diagram type: the first line that isn't blank and isn't a comment /
  // `%%{init: ...}%%` directive line.
  const typeLine = lines.find((l) => l.trim() !== '' && !l.trim().startsWith('%%'));
  const head = (typeLine ?? '').trim().split(/[\s;]/)[0];
  if (!TYPES.includes(head)) errors.push(`unknown diagram type: ${head}`);
  if (lines.length < 2) errors.push('empty diagram body');

  // Heuristic bracket balance, evaluated per line in this order:
  //   1. Skip comment / `%%{init: ...}%%` directive lines entirely.
  //   2. Strip well-formed double-quoted segments. Mermaid strings never
  //      span lines, so quote state does NOT carry across lines: an odd
  //      quote count on a line is flagged as 'unterminated string' for that
  //      line only, and never leaks into the bracket check of later lines.
  //   3. Strip `--`-containing tokens (e.g. `-->`, `||--o{`), since their
  //      arrow/cardinality markers are legitimately asymmetric.
  //   4. Feed what remains to a bracket-balance stack that DOES span lines,
  //      since class/er `{...}` blocks legitimately span multiple lines.
  //
  // Accepted heuristic limitations (this is a lint, not a parser):
  //   - Step 3 strips the whole no-space token containing `--`, so a
  //     genuine bracket imbalance living inside that same token (e.g.
  //     `A[--`) is masked rather than flagged.
  //   - Step 4 balances brackets found anywhere on a line, including
  //     inside free-text labels/descriptions, not just structural syntax —
  //     this can flag sloppy prose as "unbalanced brackets", but that's
  //     accepted as a useful typo-catcher.
  //
  // Separately, after the quote-stripping step, each line is also checked
  // for CJK text directly adjacent to an ASCII `(`/`)` — Mermaid labels
  // mixing full-width CJK with half-width parens render with awkward
  // spacing, so this is flagged as a style issue (use full-width （） instead).
  const closers = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  let balanced = true;
  const CJK_ASCII_PAREN_RE = /[一-鿿぀-ヿ][()]|[()][一-鿿぀-ヿ]/;

  for (const line of lines) {
    if (line.trim().startsWith('%%')) continue;

    const quoteCount = (line.match(/"/g) ?? []).length;
    if (quoteCount % 2 !== 0) errors.push('unterminated string');

    const dequoted = line.replace(/"[^"]*"/g, '');

    if (CJK_ASCII_PAREN_RE.test(dequoted)) {
      errors.push('mixed-width parens near CJK text (use （） )');
    }

    const strippedLine = dequoted.replace(/\S*--\S*/g, '');

    for (const ch of strippedLine) {
      if (closers[ch]) stack.push(closers[ch]);
      else if ([')', ']', '}'].includes(ch) && stack.pop() !== ch) balanced = false;
    }
  }
  if (!balanced || stack.length) errors.push('unbalanced brackets');
  return errors;
}

// ── 複雜度預算（取自 diagram-design 的 complexity budget，換算成 Mermaid 可數的單位）──
// 這是可讀性提醒，不是語法錯誤：回 warnings，不影響 exit code（除非 --strict-budget）。
// erDiagram 不設預算——db-schema 的 erDiagram 是真相來源，要完整；拆圖會讓 schema-diff 誤判。
export const BUDGET = {
  flowchart: { nodes: 12, edges: 16, subgraphs: 6 },
  sequence: { lifelines: 5, alt: 2, nesting: 1 },
  state: { states: 12, transitions: 16 },
  class: { classes: 9, relations: 12 },
  er: null,
};

function flowchartStats(lines) {
  const ids = new Set();
  let edges = 0; let subgraphs = 0;
  const idRe = /^[A-Za-z_][\w.-]*/;
  const clean = (tok) => { const m = tok.trim().match(idRe); return m ? m[0] : null; };
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/%%.*$/, '').trim();
    if (!line || /^(classDef|class|style|linkStyle|click|direction)\b/.test(line)) continue;
    if (/^subgraph\b/.test(line)) { subgraphs += 1; continue; }
    if (line === 'end') continue;
    // 邊：拆成節點片段
    const parts = line.split(/\s*(?:-{2,}>?|={2,}>?|-\.+->?|--[^-]*-->|==[^=]*==>|-\.[^.]*\.->)\s*(?:\|[^|]*\|\s*)?/);
    if (parts.length > 1) edges += parts.length - 1;
    for (const seg of parts) for (const tok of seg.split('&')) { const id = clean(tok); if (id) ids.add(id); }
  }
  return { nodes: ids.size, edges, subgraphs };
}

function sequenceStats(lines) {
  const lifelines = new Set();
  let alt = 0; let depth = 0; let maxDepth = 0;
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/%%.*$/, '').trim();
    let m = line.match(/^(?:participant|actor)\s+(\S+)/);
    if (m) { lifelines.add(m[1]); continue; }
    m = line.match(/^(\S+?)\s*(?:-{1,2}(?:>>|>|x|\))|<<?-{1,2}>?>?)\s*(\S+?)\s*:/);
    if (m) { lifelines.add(m[1].replace(/[+-]$/, '')); lifelines.add(m[2].replace(/^[+-]/, '')); }
    if (/^(alt|opt|loop|par|critical|break|rect)\b/.test(line)) { depth += 1; maxDepth = Math.max(maxDepth, depth); if (line.startsWith('alt')) alt += 1; }
    else if (/^else\b/.test(line)) alt += 1;
    else if (line === 'end') depth = Math.max(0, depth - 1);
  }
  return { lifelines: lifelines.size, alt, nesting: Math.max(0, maxDepth - 1) };
}

function stateStats(lines) {
  const states = new Set(); let transitions = 0;
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/%%.*$/, '').trim();
    const m = line.match(/^(\S+)\s*-->\s*(\S+)/);
    if (m) { transitions += 1; for (const s of [m[1], m[2]]) if (s !== '[*]') states.add(s); continue; }
    const d = line.match(/^state\s+"[^"]*"\s+as\s+(\S+)|^state\s+(\S+)/);
    if (d) states.add(d[1] || d[2]);
  }
  return { states: states.size, transitions };
}

function classStats(lines) {
  const classes = new Set(); let relations = 0;
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/%%.*$/, '').trim();
    const c = line.match(/^class\s+([\w.]+)/);
    if (c) classes.add(c[1]);
    if (/(<\|--|--\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|\.\.\|>|<\|\.\.|--)/.test(line) && !line.startsWith('class ')) {
      const m = line.match(/^([\w.]+)\s*(?:"[^"]*")?\s*\S+\s*(?:"[^"]*")?\s*([\w.]+)/);
      if (m) { relations += 1; classes.add(m[1]); classes.add(m[2]); }
    }
  }
  return { classes: classes.size, relations };
}

// 回傳 { kind, stats, warnings[] }；kind 不在預算表內（gantt、pie…）→ warnings 空。
export function checkBudget(source) {
  const lines = source.trim().split('\n');
  const typeLine = lines.find((l) => l.trim() !== '' && !l.trim().startsWith('%%')) ?? '';
  const head = typeLine.trim().split(/[\s;]/)[0];
  const body = [typeLine, ...lines.filter((l) => l !== typeLine)];
  let kind = null; let stats = {};
  if (head === 'flowchart' || head === 'graph') { kind = 'flowchart'; stats = flowchartStats(body); }
  else if (head === 'sequenceDiagram') { kind = 'sequence'; stats = sequenceStats(body); }
  else if (head.startsWith('stateDiagram')) { kind = 'state'; stats = stateStats(body); }
  else if (head === 'classDiagram') { kind = 'class'; stats = classStats(body); }
  else if (head === 'erDiagram') { kind = 'er'; }
  const warnings = [];
  const b = kind ? BUDGET[kind] : null;
  if (b) for (const [k, limit] of Object.entries(b)) if (stats[k] > limit) warnings.push(`${kind} ${k}=${stats[k]} exceeds budget ${limit} — 建議拆成總覽＋細部圖（見 playbook/diagrams.md）`);
  return { kind, stats, warnings };
}

function main(argv) {
  const strict = argv.includes('--strict-budget');
  const files = argv.filter((a) => !a.startsWith('--'));
  if (!files.length) throw new Error('usage: mermaid-check.js [--strict-budget] <file.md>...');
  const results = [];
  for (const file of files) {
    const blocks = extractMermaidBlocks(readFileSync(file, 'utf8'));
    blocks.forEach((b, i) => {
      const { kind, stats, warnings } = checkBudget(b);
      results.push({ file, block: i, kind, stats, errors: checkBlock(b), warnings });
    });
    if (!blocks.length) results.push({ file, block: null, errors: [], warnings: [], note: 'no mermaid blocks' });
  }
  process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');
  if (results.some((r) => r.errors.length) || (strict && results.some((r) => r.warnings.length))) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
