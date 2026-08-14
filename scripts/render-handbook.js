#!/usr/bin/env node
// scripts/render-handbook.js — 把 manifest 管理的文件集渲染成單頁 HTML handbook。
//
// 用法：node render-handbook.js [--out <path>]
//   於 repo 根執行（需存在 docs/.docalign.yml）。預設輸出 docs/handbook.html。
// 輸出 JSON 摘要到 stdout：{ ok, out, sections, skipped }。
//
// 純機械步驟：讀 manifest → 讀各文件 md → markdown-html.js 轉換 → 寫檔。
// manifest 中列出但檔案不存在的文件會被跳過並記入 skipped（不視為錯誤——
// 缺檔屬 check 的 drift 範疇，render 不重複裁決）。

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadManifest } from './manifest.js';
import { renderHandbook } from './lib/markdown-html.js';

function parseArgs(argv) {
  const opts = { manifest: 'docs/.docalign.yml', out: 'docs/handbook.html' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) {
      opts.out = argv[i + 1];
      i += 1;
    } else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv);

if (!existsSync(opts.manifest)) {
  console.error(`manifest not found: ${opts.manifest} — run doc-align init first`);
  process.exit(1);
}

const manifest = loadManifest(opts.manifest);

const docs = [];
const skipped = [];
for (const entry of manifest.docs) {
  const filePath = `docs/${entry.path}`;
  if (!existsSync(filePath)) {
    skipped.push(entry.path);
    continue;
  }
  docs.push({ path: entry.path, type: entry.type, md: readFileSync(filePath, 'utf8') });
}

let headSha = '';
try {
  headSha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
} catch {
  // 非 git repo 或 git 不可用：meta 省略 commit，功能不受影響
}

const html = renderHandbook(docs, {
  repoName: basename(resolve('.')),
  generatedAt: new Date().toISOString().slice(0, 10),
  headSha,
});

writeFileSync(opts.out, html);
console.log(JSON.stringify({ ok: true, out: opts.out, sections: docs.length, skipped }, null, 2));
