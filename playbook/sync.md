# doc-align sync — 套用文件更新程序

你是執行 doc-align sync 的 agent。目標：把 check 找到的 drift 落實為文件更新，
並推進 manifest 的對齊狀態。`<SCRIPTS>` 由呼叫端提供。

## 步驟

1. **取得 drift 清單**：若本次對話已有 check 結果就直接使用；否則先完整執行
   check 程序（見 check playbook）。無 drift 時跳到步驟 5（只推進 last_verified）。
2. **逐條裁決**：對每條 drift 向使用者確認：更新文件，或標記為「程式碼問題」
   （文件不動，留待修碼）。在無法互動的環境中，不直接寫入文件，改為輸出
   建議的修改內容（diff 形式）讓人套用。
3. **更新文件**：修改 Mermaid 圖與短註後，執行
   `node <SCRIPTS>/mermaid-check.js <文件路徑>` 驗證；失敗則修正後重驗，
   驗證不過的內容不得寫入。
4. **更新 watch**：若文件描述的程式碼範圍已改變（模組搬移、新增相關檔案），
   同步更新 manifest：
   `node <SCRIPTS>/manifest.js set-watch --doc <path> --watch <glob> [--watch <glob>...]`
5. **推進 last_verified**：對每份「確認與程式碼對齊」的文件
   （本次更新過的，以及 check 判定 clean 的）：
   `node <SCRIPTS>/manifest.js set-verified --doc <path> --commit <目前的 HEAD commit>`
   仍有未裁決 drift 的文件**不得**推進。
6. **總結**：列出更新了哪些文件、哪些 drift 被標記為程式碼問題（附程式碼位置，
   提醒使用者處理）、哪些文件推進了 last_verified。
