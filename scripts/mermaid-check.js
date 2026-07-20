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
  const head = (lines[0] ?? '').trim().split(/[\s;]/)[0];
  if (!TYPES.includes(head)) errors.push(`unknown diagram type: ${head}`);
  if (lines.length < 2) errors.push('empty diagram body');

  // Heuristic bracket balance: strip relation-operator chunks (e.g. ||--o{)
  // whose cardinality markers are legitimately asymmetric, and ignore
  // characters inside double-quoted strings.
  const stripped = source.replace(/\S*--\S*/g, '');
  const closers = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  let inString = false;
  let balanced = true;
  for (const ch of stripped) {
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (closers[ch]) stack.push(closers[ch]);
    else if ([')', ']', '}'].includes(ch) && stack.pop() !== ch) { balanced = false; break; }
  }
  if (!balanced || stack.length) errors.push('unbalanced brackets');
  if (inString) errors.push('unterminated string');
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
