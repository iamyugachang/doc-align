// Parses ONLY the manifest subset produced by serialize():
//   docs:
//     - path: <string>        <- must be the first key of each entry
//       type: <string>
//       watch:
//         - <string>
//       last_verified: <string>
export function parse(text) {
  const docs = [];
  let current = null;
  let inWatch = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^docs:\s*$/.test(line)) continue;
    let m;
    if ((m = line.match(/^  - path:\s*(.+)$/))) {
      current = { path: m[1].trim(), watch: [] };
      docs.push(current);
      inWatch = false;
    } else if (current && /^    watch:\s*$/.test(line)) {
      inWatch = true;
    } else if (current && inWatch && (m = line.match(/^      - (.+)$/))) {
      current.watch.push(m[1].trim());
    } else if (current && (m = line.match(/^    (\w+):\s*(.+)$/))) {
      current[m[1]] = m[2].trim();
      inWatch = false;
    } else {
      throw new Error(`docalign manifest: unrecognized line: ${JSON.stringify(raw)}`);
    }
  }
  return { docs };
}

export function serialize({ docs }) {
  const lines = ['# managed by doc-align — edit via scripts/manifest.js', 'docs:'];
  for (const d of docs) {
    lines.push(`  - path: ${d.path}`);
    lines.push(`    type: ${d.type}`);
    if (d.watch?.length) {
      lines.push('    watch:');
      for (const w of d.watch) lines.push(`      - ${w}`);
    }
    if (d.last_verified) lines.push(`    last_verified: ${d.last_verified}`);
    lines.push('');
  }
  return lines.join('\n');
}
