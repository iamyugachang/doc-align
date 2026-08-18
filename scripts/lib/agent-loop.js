// scripts/lib/agent-loop.js — 最小 tool-calling agent 迴圈（純邏輯，fetch 與工具執行器皆注入）。
//
// 流程：system＋user 起手 → chatTurn → 有 tool_calls 就逐一執行、把結果以 role:tool 回填 →
// 再 chatTurn … 直到模型不再呼叫工具，最後一則 assistant content 即為結果。
// 上下文控管：單次工具輸出上限由執行器截斷；整體超過 maxContextChars 時，從最舊的工具輸出
// 開始改成佔位字串（模型需要時可以重新呼叫），system／user 起手訊息永不裁。

import { chatTurn } from './llm-client.js';

const OMITTED = '（較早的工具輸出已省略以節省上下文；需要時請重新呼叫同一工具。）';

function messagesChars(messages) {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') n += m.content.length;
    else if (m.content) n += JSON.stringify(m.content).length;
    if (m.tool_calls) n += JSON.stringify(m.tool_calls).length;
  }
  return n;
}

export function trimContext(messages, maxContextChars) {
  let total = messagesChars(messages);
  for (let i = 2; i < messages.length && total > maxContextChars; i += 1) {
    const m = messages[i];
    if (m.role === 'tool' && m.content !== OMITTED) {
      total -= m.content.length - OMITTED.length;
      m.content = OMITTED;
    }
  }
  return total;
}

function parseArgs(raw) {
  if (!raw || !raw.trim()) return {};
  return JSON.parse(raw);
}

export async function runAgent({
  cfg, system, user, tools, execute,
  maxTurns = 60, maxContextChars = 400_000, fetchImpl, onEvent = () => {}, label = 'doc-align',
}) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  let nudges = 0;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    onEvent({ type: 'turn', turn, chars: messagesChars(messages) });
    const res = await chatTurn(cfg, messages, { tools, fetchImpl, label });
    if (res.usage) {
      usage.prompt_tokens += res.usage.prompt_tokens || 0;
      usage.completion_tokens += res.usage.completion_tokens || 0;
    }

    if (!res.toolCalls.length) {
      if (res.content.trim()) return { content: res.content, turns: turn, usage, messages };
      // 空回覆（常見於 finish_reason=length 或 reasoning-only 回覆）：最多催兩次。
      if (nudges >= 2) throw new Error(`${label}: 模型連續回覆空內容且未呼叫工具（turn ${turn}）`);
      nudges += 1;
      messages.push({ role: 'assistant', content: res.content || '' });
      messages.push({ role: 'user', content: '請繼續：若已完成，直接輸出最終結果（markdown 本體）；否則繼續呼叫工具。' });
      onEvent({ type: 'nudge', turn });
      continue;
    }

    // 回填 assistant 訊息（保留 gateway 回來的 tool_calls 原貌，讓下一輪對得上 id）。
    messages.push({
      role: 'assistant',
      content: res.content || '',
      tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    });

    for (const call of res.toolCalls) {
      let args;
      let result;
      try {
        args = parseArgs(call.arguments);
      } catch (e) {
        result = `ERROR: 工具參數不是合法 JSON：${e.message}`;
      }
      if (result === undefined) {
        onEvent({ type: 'tool', turn, name: call.name, args });
        result = await execute(call.name, args);
      }
      onEvent({ type: 'tool_result', turn, name: call.name, args, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: String(result) });
    }
    trimContext(messages, maxContextChars);
  }
  const err = new Error(`${label}: 超過 ${maxTurns} 輪仍未完成（可用 --max-turns 提高上限）`);
  err.exhausted = true;
  err.messages = messages;
  err.usage = usage;
  throw err;
}
