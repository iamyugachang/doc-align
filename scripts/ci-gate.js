// scripts/ci-gate.js
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadManifest } from './manifest.js';
import { changedScope } from './changed-scope.js';

function gitDiffFiles(range, cwd) {
  const out = execFileSync('git', ['diff', '--name-only', range], { cwd, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

export function ciGate({ manifest, base, cwd = '.' }) {
  const range = `${base}...HEAD`;
  const scope = changedScope({ manifest, range, cwd });
  // In explicit-range mode 'unverified' only means the range itself failed to
  // diff (bad base ref) — that's an infra error the CI run must surface, not a
  // condition to silently skip or silently spend LLM tokens on.
  const broken = scope.docs.filter((d) => d.status === 'unverified');
  if (broken.length) {
    throw new Error(`ci-gate: cannot diff range ${range}: ${broken[0].reason}`);
  }
  const affectedDocs = scope.docs.filter((d) => d.status === 'affected').map((d) => d.path);
  // Spec §8: PRs touching no watch pattern skip entirely (zero LLM cost). Coverage
  // gaps (unmatchedFiles) are surfaced by manual/full check, not per-PR noise.
  const skip = affectedDocs.length === 0;
  // Docs-only PRs (e.g. a human hand-editing a tracked diagram) skip the LLM
  // step above, but still deserve the zero-cost mechanical checks (mermaid
  // lint). Surface which .md files under docs/ actually changed so CI can
  // run those checks even when skip=true. Excludes the manifest itself
  // (docs/.docalign.yml — a .yml file, so the .md filter already excludes it).
  const allChanged = gitDiffFiles(range, cwd);
  const changedDocs = allChanged.filter((f) => f.startsWith('docs/') && f.endsWith('.md'));
  return { skip, range, affectedDocs, unmatchedFiles: scope.unmatchedFiles, changedDocs };
}

function takeValue(a, argv, i) {
  const v = argv[i];
  if (v === undefined || v.startsWith('--')) throw new Error(`${a} requires a value`);
  return v;
}

function main(argv) {
  const opts = { manifest: 'docs/.docalign.yml', cwd: '.' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') opts.base = takeValue(a, argv, ++i);
    else if (a === '--manifest') opts.manifest = takeValue(a, argv, ++i);
    else if (a === '--repo') opts.cwd = takeValue(a, argv, ++i);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!opts.base) throw new Error('ci-gate requires --base <ref> (e.g. origin/main)');
  const manifest = loadManifest(join(opts.cwd, opts.manifest));
  const result = ciGate({ manifest, base: opts.base, cwd: opts.cwd });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `skip=${result.skip}\nrange=${result.range}\nchanged_docs=${result.changedDocs.join(' ')}\n`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
