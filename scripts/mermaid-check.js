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

function main(files) {
  if (!files.length) throw new Error('usage: mermaid-check.js <file.md>...');
  const results = [];
  for (const file of files) {
    const blocks = extractMermaidBlocks(readFileSync(file, 'utf8'));
    blocks.forEach((b, i) => results.push({ file, block: i, errors: checkBlock(b) }));
    if (!blocks.length) results.push({ file, block: null, errors: [], note: 'no mermaid blocks' });
  }
  process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');
  if (results.some((r) => r.errors.length)) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
