// scripts/manifest.js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parse, serialize } from './lib/yaml-lite.js';

export const KNOWN_TYPES = ['architecture', 'use-case', 'sequence', 'class', 'db-schema', 'overview'];

export function loadManifest(path) {
  const { docs } = parse(readFileSync(path, 'utf8'));
  for (const d of docs) {
    if (!d.path || !d.type) {
      throw new Error(`docalign manifest: entry missing path/type: ${JSON.stringify(d)}`);
    }
    if (!KNOWN_TYPES.includes(d.type)) {
      throw new Error(`docalign manifest: unknown type '${d.type}' for ${d.path}`);
    }
  }
  return { docs };
}

export function saveManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
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
    else if (a === '--type') opts.type = takeValue(a, ++i);
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
  if (cmd === 'add-doc') {
    if (!opts.doc) throw new Error('add-doc requires --doc');
    if (!opts.type) throw new Error('add-doc requires --type');
    if (!KNOWN_TYPES.includes(opts.type)) {
      throw new Error(`add-doc: unknown type '${opts.type}' (expected one of ${KNOWN_TYPES.join(', ')})`);
    }
    if (!opts.watch.length) throw new Error('add-doc requires at least one --watch');
    if (opts.commit === '') throw new Error('--commit requires a non-empty value');
    let manifest;
    try {
      manifest = loadManifest(opts.manifest);
    } catch (e) {
      if (e.code === 'ENOENT') manifest = { docs: [] };
      else throw e;
    }
    if (manifest.docs.some((d) => d.path === opts.doc)) {
      throw new Error(`doc already in manifest: ${opts.doc}`);
    }
    const doc = { path: opts.doc, type: opts.type, watch: opts.watch };
    if (opts.commit) doc.last_verified = opts.commit;
    manifest.docs.push(doc);
    saveManifest(opts.manifest, manifest);
    process.stdout.write(JSON.stringify({ ok: true, doc }, null, 2) + '\n');
    return;
  }
  throw new Error('usage: manifest.js read|set-verified|set-watch|add-doc [--manifest p] [--doc p] [--type t] [--commit sha] [--watch glob]...');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
