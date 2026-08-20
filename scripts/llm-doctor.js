#!/usr/bin/env node
// scripts/llm-doctor.js — 封閉環境（公司內網）部署前的 gateway 相容性診斷。
//
// 用法：node llm-doctor.js（或 doc-align doctor）
//   env：DOC_ALIGN_LLM_BASE_URL／DOC_ALIGN_LLM_API_KEY／DOC_ALIGN_LLM_MODEL
//        DOC_ALIGN_LLM_TIMEOUT_MS（單次探測逾時，預設 30000）
//
// 檢查：runtime（Node／git）→ env 變數 → chat/completions 最小呼叫（direct 模式
// 的前提）→ tools 探測（agent 模式的前提）→ 目前 repo 的 manifest。
// 人類可讀報告到 stderr，JSON 摘要到 stdout；chat 探測失敗 exit 1，其餘皆過 exit 0。
// 只打你設定的 endpoint，各一次最小 token 呼叫，無其他對外連線。

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const TIMEOUT = Number(process.env.DOC_ALIGN_LLM_TIMEOUT_MS || 30_000);
const results = {};
const lines = [];

function report(key, ok, msg, hint) {
  results[key] = { ok, msg };
  lines.push(`${ok ? '✅' : '❌'} ${msg}${!ok && hint ? `\n   ↳ ${hint}` : ''}`);
}

async function probe(baseUrl, key, model, { tools = false } = {}) {
  const body = {
    model,
    messages: [{ role: 'user', content: '回覆一個字：pong' }],
    max_tokens: 8,
  };
  if (tools) {
    body.tools = [{
      type: 'function',
      function: { name: 'probe', description: '探測用', parameters: { type: 'object', properties: {} } },
    }];
    body.tool_choice = 'auto';
  }
  const started = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  return { status: res.status, ms: Date.now() - started, body: text.slice(0, 400) };
}

// 1. runtime
const nodeMajor = Number(process.versions.node.split('.')[0]);
report('node', nodeMajor >= 18, `Node ${process.versions.node}${nodeMajor >= 18 ? '' : '（需要 ≥ 18）'}`);
try {
  const v = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();
  report('git', true, v);
} catch {
  report('git', false, 'git 不可用', '安裝 git，drift check 依賴 git diff');
}

// 2. env
const baseUrl = (process.env.DOC_ALIGN_LLM_BASE_URL || '').replace(/\/$/, '');
const apiKey = process.env.DOC_ALIGN_LLM_API_KEY || '';
const model = process.env.DOC_ALIGN_LLM_MODEL || '';
report('env_base_url', !!baseUrl, baseUrl ? `DOC_ALIGN_LLM_BASE_URL = ${baseUrl}` : 'DOC_ALIGN_LLM_BASE_URL 未設定',
  '設定 OpenAI-compatible endpoint（含 /v1）；可放 ~/.config/doc-align/env');
report('env_api_key', !!apiKey, apiKey ? `DOC_ALIGN_LLM_API_KEY = ${apiKey.slice(0, 4)}…（${apiKey.length} 字元）` : 'DOC_ALIGN_LLM_API_KEY 未設定',
  '設定該 endpoint 的 key（本機 Ollama 隨便填非空字串）');
report('env_model', !!model, model ? `DOC_ALIGN_LLM_MODEL = ${model}` : 'DOC_ALIGN_LLM_MODEL 未設定',
  '照 gateway 的模型清單填 model id');
if (baseUrl && !/\/v\d+$/.test(baseUrl)) {
  lines.push(`⚠️  BASE_URL 結尾不是 /v1——多數 OpenAI-compatible gateway 需要（實際打 ${baseUrl}/chat/completions）`);
}

// 3+4. 探測
if (baseUrl && apiKey && model) {
  try {
    const r = await probe(baseUrl, apiKey, model);
    if (r.status >= 200 && r.status < 300) {
      report('chat', true, `chat/completions 可用（HTTP ${r.status}，${r.ms}ms）——direct 模式（llm-check／CI direct runner）可用`);
    } else {
      report('chat', false, `chat/completions HTTP ${r.status}（${r.ms}ms）：${r.body}`,
        r.status === 401 || r.status === 403 ? 'key 無效或無此 model 的權限' : r.status === 404 ? 'BASE_URL 路徑不對（要含 /v1）或 model id 不存在' : '看 gateway 回應內容排查');
    }
  } catch (e) {
    report('chat', false, `連不上 ${baseUrl}：${e.cause?.code || e.name} ${e.message}`,
      '內網常見原因：proxy（設 HTTPS_PROXY）、自簽憑證（設 NODE_EXTRA_CA_CERTS=/path/ca.pem）、DNS／防火牆');
  }

  if (results.chat?.ok) {
    try {
      const r = await probe(baseUrl, apiKey, model, { tools: true });
      if (r.status >= 200 && r.status < 300) {
        report('tools', true, `tools（function calling）接受（HTTP ${r.status}）——agent 模式（bin/doc-align.js init／sync）可用`);
      } else {
        report('tools', false, `tools 欄位被拒（HTTP ${r.status}）：${r.body}`,
          'gateway 不支援 OpenAI tool calling → 只能用 direct 模式：sync --dry-run --direct／CI 的 direct runner；init 需在支援 tools 的環境跑');
      }
    } catch (e) {
      report('tools', false, `tools 探測失敗：${e.message}`, '同上，視同不支援，先用 direct 模式');
    }
  }
} else {
  lines.push('⏭️  env 不完整，跳過 endpoint 探測');
}

// 5. 目前 repo
if (existsSync('docs/.docalign.yml')) {
  report('manifest', true, '目前 repo 已有 docs/.docalign.yml（可直接 sync；render 零 LLM 可先驗）');
} else {
  lines.push('ℹ️  目前目錄沒有 docs/.docalign.yml——在目標 repo 內跑 doc-align init 建立文件集');
}

process.stderr.write(`doc-align doctor\n${lines.join('\n')}\n`);
const ok = results.chat ? results.chat.ok : false;
process.stdout.write(`${JSON.stringify({ ok, results }, null, 2)}\n`);
process.exit(ok ? 0 : 1);
