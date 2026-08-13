// scripts/generate-doc-set.js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_TYPES, saveManifest } from './manifest.js';

function takeValue(a, argv, i) {
  const v = argv[i];
  if (v === undefined || v.startsWith('--')) throw new Error(`${a} requires a value`);
  return v;
}

function parseArgs(argv) {
  const opts = { repo: '.', docsDir: 'docs', force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') opts.repo = takeValue(a, argv, ++i);
    else if (a === '--docs-dir') opts.docsDir = takeValue(a, argv, ++i);
    else if (a === '--spec') opts.spec = takeValue(a, argv, ++i);
    else if (a === '--commit') opts.commit = takeValue(a, argv, ++i);
    else if (a === '--force') opts.force = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!opts.spec) throw new Error('generate-doc-set requires --spec <path|->');
  return opts;
}

function readSpec(path) {
  const text = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON spec: ${err.message}`);
  }
}

function cleanRelativePath(kind, p) {
  if (!p || typeof p !== 'string') throw new Error(`${kind} path must be a non-empty string`);
  if (isAbsolute(p)) throw new Error(`${kind} path must be relative: ${p}`);
  const n = normalize(p).replaceAll('\\', '/');
  if (n === '.' || n.startsWith('../') || n === '..') {
    throw new Error(`${kind} path must stay under its root: ${p}`);
  }
  return n;
}

function validateDoc(raw, index) {
  if (!raw || typeof raw !== 'object') throw new Error(`docs[${index}] must be an object`);
  const path = cleanRelativePath(`docs[${index}]`, raw.path);
  if (!KNOWN_TYPES.includes(raw.type)) {
    throw new Error(`docs[${index}] unknown type '${raw.type}'`);
  }
  if (!Array.isArray(raw.watch) || raw.watch.length === 0 || raw.watch.some((w) => typeof w !== 'string' || !w)) {
    throw new Error(`docs[${index}] watch must be a non-empty string array`);
  }
  if (typeof raw.content !== 'string' || !raw.content.trim()) {
    throw new Error(`docs[${index}] content must be a non-empty string`);
  }
  return {
    path,
    type: raw.type,
    watch: raw.watch,
    content: raw.content.endsWith('\n') ? raw.content : `${raw.content}\n`,
  };
}

export function generateDocSet({ repo = '.', docsDir = 'docs', spec, force = false, commit }) {
  if (!spec || !Array.isArray(spec.docs) || spec.docs.length === 0) {
    throw new Error('spec.docs must be a non-empty array');
  }
  const cleanDocsDir = cleanRelativePath('docs-dir', docsDir);
  const docs = spec.docs.map(validateDoc);
  const seen = new Set();
  for (const d of docs) {
    if (seen.has(d.path)) throw new Error(`duplicate doc path: ${d.path}`);
    seen.add(d.path);
  }

  const manifestDocs = [];
  const written = [];
  for (const d of docs) {
    const outPath = join(repo, cleanDocsDir, d.path);
    if (existsSync(outPath) && !force) {
      throw new Error(`refusing to overwrite existing file without --force: ${outPath}`);
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, d.content);
    written.push(join(cleanDocsDir, d.path).replaceAll('\\', '/'));
    const entry = { path: d.path, type: d.type, watch: d.watch };
    if (commit) entry.last_verified = commit;
    manifestDocs.push(entry);
  }

  const manifestPath = join(repo, cleanDocsDir, '.docalign.yml');
  if (existsSync(manifestPath) && !force) {
    throw new Error(`refusing to overwrite existing manifest without --force: ${manifestPath}`);
  }
  saveManifest(manifestPath, { docs: manifestDocs });
  return {
    ok: true,
    docsDir: cleanDocsDir,
    manifest: join(cleanDocsDir, '.docalign.yml').replaceAll('\\', '/'),
    files: written,
  };
}

function main(argv) {
  const opts = parseArgs(argv);
  const spec = readSpec(opts.spec);
  const result = generateDocSet({ ...opts, spec });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
