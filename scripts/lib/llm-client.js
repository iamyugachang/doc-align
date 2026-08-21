// scripts/lib/llm-client.js — 直接呼叫 OpenAI-compatible chat/completions 的最小 client。
// 零依賴（Node 18+ 全域 fetch）；fetchImpl 可注入供測試。
//
// 兩個入口：
//   chatComplete(cfg, messages)            → 純文字回覆（direct 單次打包用）
//   chatTurn(cfg, messages, { tools })     → 完整 assistant message（含 tool_calls；agent loop 用）

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// 可選的本機設定檔（給 CLI 日常使用，免每次 export）：~/.config/doc-align/env，
// 每行 KEY=VALUE（# 開頭為註解）。只補「env 沒設」的 key，環境變數永遠優先。
export function loadEnvFile(env = process.env, path = join(homedir(), '.config', 'doc-align', 'env')) {
  if (!existsSync(path)) return env;
  const merged = { ...env };
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in merged) || merged[k] === '') merged[k] = v;
  }
  return merged;
}

export function llmConfigFromEnv(env = process.env, { label = 'llm-check' } = {}) {
  const baseUrl = (env.DOC_ALIGN_LLM_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = env.DOC_ALIGN_LLM_API_KEY || '';
  const model = env.DOC_ALIGN_LLM_MODEL || '';
  const missing = [];
  if (!baseUrl) missing.push('DOC_ALIGN_LLM_BASE_URL');
  if (!apiKey) missing.push('DOC_ALIGN_LLM_API_KEY');
  if (!model) missing.push('DOC_ALIGN_LLM_MODEL');
  if (missing.length) throw new Error(`${label}: missing env ${missing.join(', ')}`);
  const timeoutMs = Number(env.DOC_ALIGN_LLM_TIMEOUT_MS || 300_000);
  const retries = Math.max(0, Number(env.DOC_ALIGN_LLM_RETRIES || 0));
  return { baseUrl, apiKey, model, timeoutMs, retries };
}

// 部分 gateway 把 content 回成 [{type:'text', text}] 陣列；統一攤成字串。
export function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  return '';
}

async function postChatOnce({ baseUrl, apiKey, model, timeoutMs = 300_000 }, body, fetchImpl, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0, stream: false, ...body }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const e = new Error(`${label}: request failed: ${err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message}`);
    e.retryable = true; // timeout 與網路層錯誤都值得重試
    throw e;
  }
  clearTimeout(timer);
  const raw = await resp.text();
  if (!resp.ok) {
    const e = new Error(`${label}: HTTP ${resp.status} from ${baseUrl}/chat/completions: ${raw.slice(0, 500)}`);
    e.retryable = resp.status === 429 || resp.status >= 500; // 4xx（憑證／參數錯）重試無意義
    throw e;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${label}: non-JSON response: ${raw.slice(0, 300)}`);
  }
  const msg = data?.choices?.[0]?.message;
  if (!msg) throw new Error(`${label}: response has no choices[0].message: ${raw.slice(0, 300)}`);
  return { message: msg, usage: data.usage || null, finishReason: data.choices[0].finish_reason || null };
}

// 重試包裝：DOC_ALIGN_LLM_RETRIES（預設 0＝關閉）。只重試 timeout／網路錯誤／429／5xx，
// 憑證與參數錯（其他 4xx）立即失敗。每次重試前退避 2s×次數，進度印到 stderr。
async function postChat(cfg, body, fetchImpl, label) {
  const retries = cfg.retries ?? 0;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      process.stderr.write(`${label}: 重試 ${attempt}/${retries}（${String(lastErr.message).slice(0, 160)}）\n`);
      await new Promise((r) => { setTimeout(r, 2_000 * attempt); });
    }
    try {
      return await postChatOnce(cfg, body, fetchImpl, label);
    } catch (err) {
      lastErr = err;
      if (!err.retryable || attempt === retries) throw err;
    }
  }
  throw lastErr;
}

export async function chatComplete(cfg, messages, fetchImpl = globalThis.fetch) {
  const { message } = await postChat(cfg, { messages }, fetchImpl, 'llm-check');
  const text = contentToText(message.content) || contentToText(message.reasoning_content) || '';
  if (!text.trim()) throw new Error('llm-check: empty completion');
  return text;
}

// 一輪 tool-calling 對話：回傳 { content, toolCalls: [{id, name, arguments(string)}], raw, usage }。
// tools 為 OpenAI function-calling 格式的陣列；空陣列時不帶 tools 欄位（相容不支援的 gateway）。
export async function chatTurn(cfg, messages, { tools = [], fetchImpl = globalThis.fetch, label = 'doc-align' } = {}) {
  const body = { messages };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const { message, usage, finishReason } = await postChat(cfg, body, fetchImpl, label);
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
      .filter((c) => c && (c.type === 'function' || c.function))
      .map((c, i) => ({
        id: c.id || `call_${i}`,
        name: c.function?.name || '',
        arguments: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}),
      }))
    : [];
  return { content: contentToText(message.content), toolCalls, raw: message, usage, finishReason };
}
