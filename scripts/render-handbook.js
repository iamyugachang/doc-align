#!/usr/bin/env node
// scripts/render-handbook.js — 把 manifest 管理的文件集渲染成單頁 HTML handbook。
//
// 用法：node render-handbook.js [--out <path>] [--branch <name>] [--drift-report <md path>]
//   於 repo 根執行（需存在 docs/.docalign.yml）。預設輸出 docs/handbook.html。
//   --branch：provenance 標示用的 branch 名（預設 git rev-parse --abbrev-ref HEAD；
//             CI detached HEAD 時請顯式傳入，如 $CI_COMMIT_REF_NAME／$GITHUB_REF_NAME）。
//   --drift-report：把 check 產出的 drift 報告（markdown）一併渲染進 handbook，
//             側欄出現狀態 chip（無 drift＝綠／有 drift 待裁決＝橘）＋「Drift 報告」節。
// 輸出 JSON 摘要到 stdout：{ ok, out, sections, skipped, branch, drift }。
//
// 純機械步驟：讀 manifest → 讀各文件 md → markdown-html.js 轉換 → 寫檔。
// manifest 中列出但檔案不存在的文件會被跳過並記入 skipped（不視為錯誤——
// 缺檔屬 check 的 drift 範疇，render 不重複裁決）。

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadManifest } from './manifest.js';
import { convertMarkdown, renderHandbook } from './lib/markdown-html.js';

function parseArgs(argv) {
  const opts = {
    manifest: 'docs/.docalign.yml', out: 'docs/handbook.html', branch: null, driftReport: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) {
      opts.out = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--branch' && argv[i + 1]) {
      opts.branch = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--drift-report' && argv[i + 1]) {
      opts.driftReport = argv[i + 1];
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
let branch = opts.branch;
try {
  headSha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
  if (!branch) {
    const b = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (b !== 'HEAD') branch = b; // detached HEAD（CI）不猜，靠 --branch 顯式傳入
  }
} catch {
  // 非 git repo 或 git 不可用：meta 省略 commit，功能不受影響
}

let drift = null;
if (opts.driftReport) {
  if (!existsSync(opts.driftReport)) {
    console.error(`drift report not found: ${opts.driftReport}`);
    process.exit(1);
  }
  const md = readFileSync(opts.driftReport, 'utf8');
  const ok = /無 drift/.test(md.slice(0, 500));
  const checkedAt = statSync(opts.driftReport).mtime.toISOString().slice(0, 16).replace('T', ' ');
  drift = {
    ok,
    statusText: ok ? `✓ 無 drift（${checkedAt}）` : `⚠ 有 drift 待裁決（${checkedAt}）`,
    checkedAt,
    html: convertMarkdown(md.replace(/^#\s+.*$/m, '')),
  };
}

const html = renderHandbook(docs, {
  repoName: basename(resolve('.')),
  generatedAt: `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  headSha,
  branch,
  drift,
});

writeFileSync(opts.out, html);
console.log(JSON.stringify({
  ok: true,
  out: opts.out,
  sections: docs.length,
  skipped,
  branch,
  drift: drift ? { ok: drift.ok } : null,
}, null, 2));
