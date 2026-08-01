# doc-align sync — 套用文件更新程序

你是執行 doc-align sync 的 agent。目標：把 check 找到的 drift 落實為文件更新，
並推進 manifest 的對齊狀態。`<SCRIPTS>` 由呼叫端提供。

Manifest（`docs/.docalign.yml`）內每份文件的 `path` 都是相對於 `docs/` 的路徑
（如 `flows/refund.md` 實際檔案是 `docs/flows/refund.md`）；所有檔案操作與 script
呼叫都須組成 `docs/<path>` 這樣的完整路徑。

## 步驟

1. **取得 drift 清單**：若本次對話已有 check 結果就直接使用，但須先確認該結果
   對應的 commit 就是目前的 HEAD；不一致時須重新執行完整 check 程序
   （見 check playbook）。無 drift 時跳到步驟 5（只推進 last_verified）。
2. **裁決**：把所有 drift 彙整成一份清單，一次性請使用者裁決（不逐條個別提問）：
   對每條標示更新文件，或標記為「程式碼問題」（文件不動，留待修碼）。無法與使用者
   互動的環境（例如 CI）視為非互動情境：此時不直接寫入文件，改為輸出所有建議的
   修改內容（diff 形式）讓人事後套用。
3. **更新文件**：把修改後的 Mermaid 圖與行為規則（如有）先寫入暫存檔，執行
   `node <SCRIPTS>/mermaid-check.js <暫存檔路徑>` 驗證；失敗則修正暫存內容後重驗；
   通過後才覆寫回正式的文件路徑。驗證不過的內容不得寫入正式文件。
4. **更新 watch**：若文件描述的程式碼範圍已改變（模組搬移、新增相關檔案），
   同步更新 manifest。`set-watch` 會整批覆寫該文件的 watch 清單，而非增量合併：
   先執行 `node <SCRIPTS>/manifest.js read` 取得該文件目前的 watch 清單，
   再連同異動一次以完整的目標清單傳入：
   `node <SCRIPTS>/manifest.js set-watch --doc <path> --watch <glob> [--watch <glob>...]`
5. **推進 last_verified**：對每份「確認與程式碼對齊」的文件
   （本次更新過的、check 判定 clean 的，以及 check 中以 unverified 狀態完成全量
   驗證且確認對齊的文件）：
   `node <SCRIPTS>/manifest.js set-verified --doc <path> --commit <目前的 HEAD commit>`
   仍有未裁決 drift 的文件**不得**推進。
6. **總結**：列出更新了哪些文件、哪些 drift 被標記為程式碼問題（附程式碼位置，
   提醒使用者處理）、哪些文件推進了 last_verified。
