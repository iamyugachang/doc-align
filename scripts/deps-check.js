#!/usr/bin/env node
// scripts/deps-check.js — layers 文件的機械驗證：掃 repo 原始碼的 import 圖，對照文件宣告的
// 層級表（| 層 | 目錄 | 說明 |）與 flowchart 允許邊（A --> B ＝ A 可依賴 B），列出反向／未宣告依賴。
//
// 用法：node deps-check.js --doc docs/layers.md [--root .] [--py-root src --py-root .]
// 輸出 JSON：{ status: ok|drift|unsupported, violations:[{from,line,import,to,fromLayer,toLayer}],
//             unassigned:[…被 import 但不屬任何層的檔案], edges:[{edge,count,allowed}], stats }
// exit 0（含 drift——drift 是資訊，由 check 報告）；unsupported／參數錯誤 exit 1。
//
// 解析範圍：Python（絕對／相對 import）、JS/TS（相對路徑 import/require）。外部套件、path alias、
// 動態字串一律略過不猜；「層級表 glob 內的檔案」才會被掃。

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLayers, parseLayerTable } from './lib/deps-graph.js';
import { listRepoFiles } from './lib/repo-files.js';
import { matchesAny } from './lib/glob.js';

const SRC_RE = /\.(py|m?js|cjs|jsx|ts|tsx|mts|cts)$/;

export function depsCheck({ doc, root = '.', pyRoots }) {
  const docText = readFileSync(doc, 'utf8');
  const table = parseLayerTable(docText);
  const globs = table.flatMap((t) => t.globs);
  const files = [];
  for (const rel of listRepoFiles(root)) {
    if (!SRC_RE.test(rel) || !matchesAny(rel, globs)) continue;
    const abs = join(root, rel);
    try {
      if (statSync(abs).size > 2 * 1024 * 1024) continue;
      files.push({ path: rel, text: readFileSync(abs, 'utf8') });
    } catch { /* skip unreadable */ }
  }
  return checkLayers({ docText, files, pyRoots });
}

function main(argv) {
  const opts = { doc: null, root: '.', pyRoots: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const take = () => { const v = argv[i + 1]; if (v === undefined) throw new Error(`${a} requires a value`); i += 1; return v; };
    if (a === '--doc') opts.doc = take();
    else if (a === '--root') opts.root = take();
    else if (a === '--py-root') opts.pyRoots.push(take());
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!opts.doc) throw new Error('usage: deps-check.js --doc <layers.md> [--root .] [--py-root <dir>]...');
  if (!existsSync(opts.doc)) throw new Error(`doc not found: ${opts.doc}`);
  const result = depsCheck({ doc: opts.doc, root: opts.root, pyRoots: opts.pyRoots.length ? opts.pyRoots : undefined });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'unsupported' ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
