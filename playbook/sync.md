# doc-align sync — 偵測並套用文件更新程序

你是執行 doc-align sync 的 agent。目標：偵測 docs/ 與程式碼的 drift，把裁決後的
drift 落實為文件更新，推進 manifest 的對齊狀態，最後重新生成 handbook。
`<SCRIPTS>` 由呼叫端提供。

參數：
- `--dry-run`：只做步驟 1 的 drift 偵測並輸出報告，**不寫任何檔案、不推進 manifest、
  不 render**；CI 與「先看看」都用這個。`doc-align check` 是它的別名。
- `--range <git range>`／`--full`：原樣傳給步驟 1 的 check 程序（分別為指定比對範圍與
  全量重驗；兩者同時出現以 `--full` 為準）。
- `--no-render`：略過步驟 7 的 handbook 生成。

Manifest（`docs/.docalign.yml`）內每份文件的 `path` 都是相對於 `docs/` 的路徑
（如 `flows/refund.md` 實際檔案是 `docs/flows/refund.md`）；所有檔案操作與 script
呼叫都須組成 `docs/<path>` 這樣的完整路徑。

## 步驟

1. **取得 drift 清單**：執行完整 check 程序（見 check playbook，帶入 `--range`／
   `--full`）；若本次對話已有 check 結果且對應的 commit 就是目前的 HEAD，可直接
   沿用。**`--dry-run` 在此結束**：輸出 check 報告本體即為最終結果，後續步驟一律
   不做。無 drift 時跳到步驟 5（只推進 last_verified）。
2. **裁決**：把所有 drift 彙整成一份清單，一次性請使用者裁決（不逐條個別提問）：
   對每條標示更新文件，或標記為「程式碼問題」（文件不動，留待修碼）。無法與使用者
   互動的環境（例如 CI）視為非互動情境：此時不直接寫入文件，改為輸出所有建議的
   修改內容（diff 形式）讓人事後套用。
3. **更新文件**：遵守 `<SCRIPTS>/../playbook/writing.md` 的寫作心法與 init playbook
   步驟 5 的寫作規則與**密度原則**（圖優先、不重述圖、只寫圖說不了的關鍵；維持該
   文件既有的密度，不因更新而膨脹）；順手修正被改到的段落中違反 writing.md 的句子
   （無標籤箭頭、重述圖的段落、模糊詞），但不重寫沒被 drift 觸及的段落。把修改後的
   Mermaid 圖與行為規則（如有）先寫入暫存檔，執行
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
7. **重新生成 handbook**（除非 `--no-render`）：執行
   `node <SCRIPTS>/render-handbook.js`（輸出 `docs/handbook.html`），把輸出路徑與
   section 數附在總結末尾；`skipped` 非空時一併列出。這是零 LLM 的機械步驟，
   目的是讓 HTML 永遠跟文件同步，不需要使用者另外記得跑 render。
