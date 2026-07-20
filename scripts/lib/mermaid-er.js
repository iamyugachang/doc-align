// scripts/lib/mermaid-er.js
export function extractMermaidBlocks(markdown) {
  const blocks = [];
  const re = /```mermaid\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(markdown))) blocks.push(m[1]);
  return blocks;
}

export function parseErDiagram(source) {
  const lines = source.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('%%'));
  if (lines[0] !== 'erDiagram') throw new Error('not an erDiagram');
  const tables = {};
  const relations = [];
  let current = null;
  for (const line of lines.slice(1)) {
    let m;
    if ((m = line.match(/^(\w+)\s*\{$/))) {
      current = m[1].toLowerCase();
      tables[current] = { columns: {} };
    } else if (line === '}') {
      current = null;
    } else if (current && (m = line.match(/^(\w+)\s+(\w+)(?:\s+(PK|FK|UK))?(?:\s+"[^"]*")?$/))) {
      tables[current].columns[m[2].toLowerCase()] = { type: m[1].toLowerCase(), key: m[3] ?? null };
    } else if (!current && (m = line.match(/^(\w+)\s+\S+\s+(\w+)\s*:\s*\S+$/))) {
      relations.push({ from: m[1].toLowerCase(), to: m[2].toLowerCase() });
    } else {
      throw new Error(`unrecognized erDiagram line: ${line}`);
    }
  }
  return { tables, relations };
}
