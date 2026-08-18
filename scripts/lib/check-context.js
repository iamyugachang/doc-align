// scripts/lib/check-context.js — direct LLM check 的證據打包（純函式，無 I/O）。
//
// direct 模式沒有 agent 可以自己去翻 code，所以由 script 事先把「這份文件要驗什麼」
// 全部打包進單次 prompt：文件全文、本次 range 內與 watch 範圍相關的 diff、以及
// 文件內 file:line 證據引用所指的目前程式碼片段。超出字元預算時按優先序截斷並
// 在報告的「涵蓋範圍」明講，不默默丟。

export const CITE_RE = /（([\w/.\-]+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?）/g;

// 從文件文字抽出所有 file:line 引用 → [{ file, start, end }]，同一 (file,start,end) 去重。
export function extractCitations(md) {
  const seen = new Set();
  const out = [];
  for (const m of md.matchAll(CITE_RE)) {
    const file = m[1];
    const start = Number(m[2]);
    const end = m[3] ? Number(m[3]) : start;
    const key = `${file}:${start}-${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file, start, end });
  }
  return out;
}

// 取檔案內 [start-radius, end+radius] 的行，附行號；單片段最多 maxLines 行。
export function sliceLines(text, start, end, { radius = 8, maxLines = 80 } = {}) {
  const lines = text.split('\n');
  const from = Math.max(1, start - radius);
  const to = Math.min(lines.length, end + radius, from + maxLines - 1);
  const body = [];
  for (let n = from; n <= to; n += 1) body.push(`${String(n).padStart(5)}  ${lines[n - 1]}`);
  return { from, to, total: lines.length, text: body.join('\n') };
}

function fence(lang, body) {
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

// 依預算組裝 user prompt。優先序：文件全文 > diff > 證據片段（片段逐一塞到超出為止）。
// 回傳 { prompt, truncated: string[] }。
export function buildCheckPrompt({ docPath, docText, range, matchedFiles, diff, snippets, maxChars = 60_000 }) {
  const truncated = [];
  const parts = [];

  parts.push(`# 待驗證文件：docs/${docPath}\n\n${fence('markdown', docText)}`);

  const head = `# 本次變動範圍：${range}\n\n觸及本文件 watch 範圍的檔案：\n${matchedFiles.map((f) => `- ${f}`).join('\n') || '- （無）'}`;
  parts.push(head);

  let used = parts.join('\n\n').length;

  let diffText = diff || '（無 diff）';
  const diffHeader = '# 這些檔案在此 range 的 git diff\n\n';
  const diffBudget = maxChars - used - 2_000; // 保留一點給片段區標題與尾註
  if (diffText.length > diffBudget) {
    diffText = `${diffText.slice(0, Math.max(0, diffBudget))}\n\n…（diff 已截斷，超出預算）`;
    truncated.push(`diff（原長 ${(diff || '').length} 字元）`);
  }
  parts.push(diffHeader + fence('diff', diffText));
  used = parts.join('\n\n').length;

  const snippetParts = ['# 文件引用的證據片段（目前工作樹）'];
  for (const s of snippets) {
    const block = s.missing
      ? `## ${s.file}:${s.start}-${s.end}\n（檔案不存在於目前工作樹）`
      : `## ${s.file}:${s.start}-${s.end}（顯示 ${s.from}-${s.to}／共 ${s.total} 行）\n${fence('', s.text)}`;
    if (used + block.length + 2 > maxChars) {
      truncated.push(`證據片段 ${s.file}:${s.start}-${s.end} 起（含之後全部）`);
      break;
    }
    snippetParts.push(block);
    used += block.length + 2;
  }
  parts.push(snippetParts.join('\n\n'));

  return { prompt: parts.join('\n\n'), truncated };
}

// system prompt：把 check playbook 的驗證原則與報告格式帶給模型；formatSection 由呼叫端
// 從 playbook/check.md 抽出（單一真相來源，避免格式在兩處漂移）。
export function buildSystemPrompt(formatSection) {
  return [
    '你是 doc-align 的 drift 偵測器。任務：判斷一份 docs/ 文件是否仍與程式碼一致，只報告、不改檔。',
    '',
    '判準：',
    '- 逐條檢查文件「行為規則」段落的宣告（當 X 時系統會 Y）是否仍被 diff 後的程式碼與證據片段支持。',
    '- 檢查 Mermaid 圖中的具體元素（sequence 步驟的呼叫者／被呼叫者／順序／條件、class 的類別／屬性／方法／關係、erDiagram 的表／欄位）是否仍存在且正確。',
    '- 「目的與情境」「設計決策」等敘事段落只在 diff 顯示結構性變動（模組新增／刪除、進入點增減、外部依賴變更）時才檢查。',
    '- 工具不預設程式碼是對的：每條 drift 都要給「文件過時」與「程式碼行為可疑」兩種解讀，由人裁決。',
    '- 證據不足以判定時明確標記為無法驗證，不得寫成有信心的 drift。',
    '- 你只能依據下方打包的文件、diff 與證據片段判斷；片段沒涵蓋到的部分若無法判定，列入無法驗證。',
    '',
    '輸出：只輸出 markdown 報告本體，不要任何前後綴或客套。報告格式如下：',
    '',
    formatSection.trim(),
  ].join('\n');
}

// 從 playbook/check.md 抽出「Drift 報告格式」一節（到檔尾）。
export function extractReportFormat(checkPlaybook) {
  const idx = checkPlaybook.indexOf('## Drift 報告格式');
  return idx === -1 ? '' : checkPlaybook.slice(idx);
}
