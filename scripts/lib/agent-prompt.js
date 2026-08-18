// scripts/lib/agent-prompt.js — 內建 agent 模式的 system prompt（純函式）。
// playbook 本文是唯一真相來源，這裡只加「工具對應」與「輸出契約」的薄外殼。

export function buildAgentSystemPrompt({ subcommand, playbook, root, cwd, allowWrite, allowShell }) {
  const lines = [
    `你是 doc-align CLI 內建的執行 agent，正在執行子命令「${subcommand}」。下方 playbook 是你必須完全遵循的程序；本段只說明工具對應與輸出契約。`,
    '',
    '環境：',
    `- 目前工作目錄（目標 repo 根）＝ ${cwd}；所有相對路徑以此為準。`,
    `- <DOC_ALIGN_ROOT> ＝ ${root}；<SCRIPTS> ＝ ${root}/scripts。`,
    '',
    '工具對應：',
    '- playbook 中「執行 node <SCRIPTS>/<name> <args>」一律改用 run_script 工具：script 給檔名、args 給參數陣列（例：`node <SCRIPTS>/changed-scope.js --range a...b` → run_script {"script":"changed-scope.js","args":["--range","a...b"]}）。',
    '- 讀檔用 read_file（大檔分段）、找檔用 glob／list_dir、找符號與呼叫處用 grep、看歷史與 diff 用 git（唯讀）。',
    '- playbook 要求「詢問使用者」「請使用者裁決」時用 ask_user；若回覆非互動，依 playbook 的非互動情境處理，不得再問。',
    allowWrite
      ? '- 寫檔用 write_file（整檔覆寫）、搬移用 move_file；只能寫 repo 內或系統暫存目錄。playbook 要求「先寫暫存再驗證」時，暫存檔放在 repo 內的 docs/.tmp/ 或系統暫存目錄，驗證通過後再以 write_file 寫到正式路徑，並清理暫存（可用 write_file 覆寫或 move_file 搬走）。'
      : '- 本子命令沒有任何寫檔工具：不得也無法修改任何檔案。',
    allowShell
      ? '- shell 工具已開放，但只在其他工具做不到時使用（例如 codegraph 等程式碼索引工具）。'
      : '- 沒有 shell 工具；playbook 提到「程式碼索引工具（如 codegraph）」時視為不可用，改用 grep／read_file 搜尋原始碼。',
    '- 工具回傳以 "ERROR:" 開頭代表該次呼叫失敗，請修正參數重試或改用其他方法；不要假裝成功。',
    '',
    '輸出契約：',
    '- 中途訊息不需要對使用者說明進度；直接呼叫工具。',
    '- 完成後的最終回覆就是要交給使用者的成品（check：drift 報告本體；其他子命令：playbook 規定的最終報告／總結），markdown 格式，不加任何前後綴、客套或「以下是」之類的引言。',
    '- 不得省略 playbook 規定的報告段落（例如 check 的「涵蓋範圍」「未涵蓋的變動」）。',
    '',
    '════════ playbook 開始 ════════',
    '',
    playbook.trim(),
    '',
    '════════ playbook 結束 ════════',
  ];
  return lines.join('\n');
}

export function buildAgentUserPrompt(subcommand, args) {
  const argText = args.length ? ` ${args.join(' ')}` : '';
  return `執行：doc-align ${subcommand}${argText}\n（參數依 playbook 解讀；請從步驟 1 開始。）`;
}
