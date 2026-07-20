// scripts/changed-scope.js
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadManifest } from './manifest.js';
import { matchesAny } from './lib/glob.js';

function gitDiffFiles(range, cwd) {
  const out = execFileSync('git', ['diff', '--name-only', range], { cwd, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

export function changedScope({ manifest, range, full, cwd = '.' }) {
  const docs = [];
  const allChanged = new Set();
  for (const d of manifest.docs) {
    if (full) {
      docs.push({ path: d.path, type: d.type, status: 'affected', range: null, reason: 'full scan', matchedFiles: [] });
      continue;
    }
    const r = range ?? (d.last_verified ? `${d.last_verified}..HEAD` : null);
    if (!r) {
      docs.push({ path: d.path, type: d.type, status: 'unverified', range: null, reason: 'no last_verified', matchedFiles: [] });
      continue;
    }
    let changed;
    try {
      changed = gitDiffFiles(r, cwd);
    } catch {
      docs.push({ path: d.path, type: d.type, status: 'unverified', range: null, reason: `bad last_verified or range: ${r}`, matchedFiles: [] });
      continue;
    }
    changed.forEach((f) => allChanged.add(f));
    const matched = changed.filter((f) => matchesAny(f, d.watch ?? []));
    docs.push({ path: d.path, type: d.type, status: matched.length ? 'affected' : 'clean', range: r, reason: null, matchedFiles: matched });
  }
  const watchAll = manifest.docs.flatMap((d) => d.watch ?? []);
  // the doc set and manifest live under docs/ by design; doc edits are not code-coverage gaps
  const unmatchedFiles = [...allChanged].filter((f) => !matchesAny(f, watchAll) && !f.startsWith('docs/'));
  return { mode: full ? 'full' : range ? 'range' : 'per-doc', docs, unmatchedFiles };
}

function main(argv) {
  const opts = { manifest: 'docs/.docalign.yml', cwd: '.' };
  function takeValue(a, i) {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} requires a value`);
    return v;
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') opts.manifest = takeValue(a, ++i);
    else if (a === '--range') opts.range = takeValue(a, ++i);
    else if (a === '--full') opts.full = true;
    else if (a === '--repo') opts.cwd = takeValue(a, ++i);
    else throw new Error(`unknown arg: ${a}`);
  }
  const manifest = loadManifest(join(opts.cwd, opts.manifest));
  const result = changedScope({ manifest, range: opts.range, full: opts.full, cwd: opts.cwd });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
