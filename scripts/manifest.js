// scripts/manifest.js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from './lib/yaml-lite.js';

const KNOWN_TYPES = new Set(['architecture', 'use-case', 'sequence', 'class', 'db-schema']);

export function loadManifest(path) {
  const { docs } = parse(readFileSync(path, 'utf8'));
  for (const d of docs) {
    if (!d.path || !d.type) {
      throw new Error(`docalign manifest: entry missing path/type: ${JSON.stringify(d)}`);
    }
    if (!KNOWN_TYPES.has(d.type)) {
      throw new Error(`docalign manifest: unknown type '${d.type}' for ${d.path}`);
    }
  }
  return { docs };
}

export function saveManifest(path, manifest) {
  writeFileSync(path, serialize(manifest));
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opts = { manifest: 'docs/.docalign.yml', watch: [] };
  function takeValue(a, i) {
    const v = rest[i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} requires a value`);
    return v;
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--manifest') opts.manifest = takeValue(a, ++i);
    else if (a === '--doc') opts.doc = takeValue(a, ++i);
    else if (a === '--commit') opts.commit = takeValue(a, ++i);
    else if (a === '--watch') opts.watch.push(takeValue(a, ++i));
    else throw new Error(`unknown arg: ${a}`);
  }
  if (cmd === 'read') {
    process.stdout.write(JSON.stringify(loadManifest(opts.manifest), null, 2) + '\n');
    return;
  }
  if (cmd === 'set-verified' || cmd === 'set-watch') {
    const manifest = loadManifest(opts.manifest);
    const doc = manifest.docs.find((d) => d.path === opts.doc);
    if (!doc) throw new Error(`doc not in manifest: ${opts.doc}`);
    if (cmd === 'set-verified') {
      if (!opts.commit) throw new Error('set-verified requires --commit');
      doc.last_verified = opts.commit;
    } else {
      if (!opts.watch.length) throw new Error('set-watch requires at least one --watch');
      doc.watch = opts.watch;
    }
    saveManifest(opts.manifest, manifest);
    process.stdout.write(JSON.stringify({ ok: true, doc }, null, 2) + '\n');
    return;
  }
  throw new Error('usage: manifest.js read|set-verified|set-watch [--manifest p] [--doc p] [--commit sha] [--watch glob]...');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
