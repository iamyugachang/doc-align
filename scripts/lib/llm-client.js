// scripts/lib/llm-client.js — 直接呼叫 OpenAI-compatible chat/completions 的最小 client。
// 零依賴（Node 18+ 全域 fetch）；fetchImpl 可注入供測試。

export function llmConfigFromEnv(env = process.env) {
  const baseUrl = (env.DOC_ALIGN_LLM_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = env.DOC_ALIGN_LLM_API_KEY || '';
  const model = env.DOC_ALIGN_LLM_MODEL || '';
  const missing = [];
  if (!baseUrl) missing.push('DOC_ALIGN_LLM_BASE_URL');
  if (!apiKey) missing.push('DOC_ALIGN_LLM_API_KEY');
  if (!model) missing.push('DOC_ALIGN_LLM_MODEL');
  if (missing.length) throw new Error(`llm-check: missing env ${missing.join(', ')}`);
  const timeoutMs = Number(env.DOC_ALIGN_LLM_TIMEOUT_MS || 300_000);
  return { baseUrl, apiKey, model, timeoutMs };
}

// 部分 gateway 把 content 回成 [{type:'text', text}] 陣列；統一攤成字串。
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  return '';
}

export async function chatComplete({ baseUrl, apiKey, model, timeoutMs = 300_000 }, messages, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0, stream: false }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`llm-check: request failed: ${err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message}`);
  }
  clearTimeout(timer);
  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`llm-check: HTTP ${resp.status} from ${baseUrl}/chat/completions: ${raw.slice(0, 500)}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`llm-check: non-JSON response: ${raw.slice(0, 300)}`);
  }
  const msg = data?.choices?.[0]?.message;
  const text = contentToText(msg?.content) || contentToText(msg?.reasoning_content) || '';
  if (!text.trim()) throw new Error('llm-check: empty completion');
  return text;
}
