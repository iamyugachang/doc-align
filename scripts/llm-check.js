#!/usr/bin/env node
// scripts/llm-check.js — direct 模式的 drift check：不經 agent，直接呼叫
// OpenAI-compatible chat/completions（任何 gateway 皆可）。
//
// 用法：node llm-check.js (--range <git range> | --incremental) [--out <path>] [--manifest <path>]
//   --incremental：不給全域 range，各文件自 manifest 的 last_verified 起算
//   （nightly 用這個：drift 未經 sync 裁決前每晚都會再出現，不會被「今天沒 commit」蓋掉）
//   env：DOC_ALIGN_LLM_BASE_URL（含 /v1）、DOC_ALIGN_LLM_API_KEY、DOC_ALIGN_LLM_MODEL
//        DOC_ALIGN_LLM_MAX_CHARS（每份文件的 prompt 字元預算，預設 60000）
//        DOC_ALIGN_LLM_TIMEOUT_MS（單次請求逾時，預設 300000）
//
// 流程：changed-scope 找受影響文件 → 每份文件打包（全文＋range 內相關 diff＋證據片段）
// → 一次 chat/completions → 串接成單一 drift 報告（末尾附涵蓋範圍與未涵蓋變動）。
// 未受影響 → 直接輸出「無 drift」報告，零 LLM 呼叫。
//
// 取捨：這是「單次打包」而非 agent 迴圈——模型只能看 script 事先塞進去的內容，
// 不能自己再去翻 code。CI 的 range 有界，這通常足夠；需要自由探索的情境（init、
// 手動 --full 全量重驗）仍用 agent 版 playbook。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedScope } from './changed-scope.js';
import { loadManifest } from './manifest.js';
import { chatComplete, llmConfigFromEnv } from './lib/llm-client.js';
import {
  buildCheckPrompt, buildSystemPrompt, extractCitations, extractReportFormat, sliceLines,
} from './lib/check-context.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { manifest: 'docs/.docalign.yml', out: null, range: null, incremental: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const take = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} requires a value`);
      i += 1;
      return v;
    };
    if (a === '--range') opts.range = take();
    else if (a === '--incremental') opts.incremental = true;
    else if (a === '--out') opts.out = take();
    else if (a === '--manifest') opts.manifest = take();
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!opts.range && !opts.incremental) {
    throw new Error('llm-check requires --range <git range> (e.g. origin/main...HEAD) or --incremental');
  }
  return opts;
}

function gitDiff(range, files) {
  if (!files.length) return '';
  return execFileSync('git', ['diff', range, '--', ...files], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function gatherSnippets(docText) {
  return extractCitations(docText).map((c) => {
    if (!existsSync(c.file)) return { ...c, missing: true };
    const s = sliceLines(readFileSync(c.file, 'utf8'), c.start, c.end);
    return { ...c, ...s };
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  const manifest = loadManifest(opts.manifest);
  const scope = changedScope({ manifest, range: opts.range });

  const broken = scope.docs.filter((d) => d.status === 'unverified');
  if (broken.length && !opts.incremental) {
    throw new Error(`llm-check: cannot diff range ${opts.range}: ${broken[0].reason}`);
  }

  const affected = scope.docs.filter((d) => d.status === 'affected');
  const report = [];

  if (affected.length === 0) {
    if (!broken.length) {
      report.push(opts.incremental
        ? '無 drift，文件與程式碼對齊（各文件自 last_verified 以來的變動未觸及其 watch 範圍，未呼叫 LLM）。'
        : '無 drift，文件與程式碼對齊（本次變動未觸及任何文件的 watch 範圍，未呼叫 LLM）。');
    }
  } else {
    const cfg = llmConfigFromEnv();
    const formatSection = extractReportFormat(readFileSync(join(HERE, '..', 'playbook', 'check.md'), 'utf8'));
    const system = buildSystemPrompt(formatSection);
    const maxChars = Number(process.env.DOC_ALIGN_LLM_MAX_CHARS || 60_000);
    const coverage = [];

    for (const d of affected) {
      const docPath = `docs/${d.path}`;
      const docText = readFileSync(docPath, 'utf8');
      const docRange = opts.range ?? d.range; // incremental 模式各文件自帶 last_verified..HEAD
      const { prompt, truncated } = buildCheckPrompt({
        docPath: d.path,
        docText,
        range: docRange,
        matchedFiles: d.matchedFiles,
        diff: gitDiff(docRange, d.matchedFiles),
        snippets: gatherSnippets(docText),
        maxChars,
      });
      const answer = await chatComplete(cfg, [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ]);
      report.push(`## docs/${d.path}\n\n${answer.trim()}`);
      coverage.push(
        `- docs/${d.path}（type ${d.type}；觸及 ${d.matchedFiles.length} 個檔案）` +
        (truncated.length ? `——**部分證據因預算截斷**：${truncated.join('；')}` : ''),
      );
    }

    report.push(`## 涵蓋範圍\n\n本次以 direct 模式（單次打包、model \`${cfg.model}\`）驗證：\n${coverage.join('\n')}`);
  }

  if (opts.incremental && broken.length) {
    report.push(
      '## 尚未驗證的文件\n\n以下文件沒有可用的 last_verified（新文件或 manifest 異常），增量模式無法驗證，' +
      `請跑一次 \`sync --full\` 或 \`init --repair\`：\n${broken.map((d) => `- docs/${d.path}（${d.reason}）`).join('\n')}`,
    );
  }

  if (scope.unmatchedFiles.length) {
    report.push(`## 未涵蓋的變動\n\n以下變動不在任何文件的 watch 範圍內（可能需要新文件或擴充 watch）：\n${scope.unmatchedFiles.map((f) => `- ${f}`).join('\n')}`);
  }

  const out = report.join('\n\n') + '\n';
  if (opts.out) writeFileSync(opts.out, out);
  else process.stdout.write(out);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
