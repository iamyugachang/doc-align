# doc-align check — drift 偵測程序

你是執行 doc-align check 的 agent。目標：找出 repo 內 docs/ 文件與程式碼的落差，
產出 drift 報告。**check 絕不修改任何檔案。**

參數：無參數＝增量模式；`--range <git range>`＝指定比對範圍（PR 情境如
`origin/main...HEAD`）；`--full`＝全量重驗。
`<SCRIPTS>` 是 doc-align scripts 目錄的絕對路徑，由呼叫端（adapter）提供。

Manifest（`docs/.docalign.yml`）內每份文件的 `path` 都是相對於 `docs/` 的路徑
（如 `flows/refund.md` 實際檔案是 `docs/flows/refund.md`）；所有檔案操作與 script
呼叫都須組成 `docs/<path>` 這樣的完整路徑。

## 步驟

1. **前置檢查**：確認 repo 根目錄存在 `docs/.docalign.yml`。不存在或下一步解析失敗時，
   停止並告知使用者需先建立 manifest（`doc-align init`，Phase 2 提供），不要憑空產生報告。
2. **取得受影響範圍**：執行
   `node <SCRIPTS>/changed-scope.js [--range <range>] [--full]`，讀取 JSON 輸出。
3. **早退**：若所有 docs 的 status 皆為 `clean` 且 `unmatchedFiles` 為空，
   回報「無 drift，文件與程式碼對齊」並結束。
4. **逐文件驗證**：對每份 status 為 `affected` 的文件，依 `type` 選擇方法。
   `unverified` 的文件視同全量：對整份文件做同樣驗證，並在報告註明原因
   （缺少或失效的 last_verified）。
   - **db-schema**：先執行
     `node <SCRIPTS>/schema-diff.js --doc <文件路徑> --sql <migrations 路徑>`。
     migrations 路徑從 manifest 的 watch patterns 推斷（如 `migrations/**` → `migrations/`）。
     `status: unsupported` 或 `unsupportedStatements` 非空時，改以語意分析補驗：
     閱讀 ORM models 或 migration 原始碼，對照文件的 erDiagram 與欄位短註。
   - **class**：讀取文件中的 classDiagram，逐一確認圖中的類別、屬性、方法、關係
     在程式碼中存在且正確。若 repo 有程式碼索引工具（如 codegraph）優先用它查
     symbol；否則搜尋原始碼。改名、刪除、關係改變都是 drift。
   - **sequence**：讀取 sequence diagram，沿實際呼叫鏈逐步確認：每一步的呼叫者、
     被呼叫者、順序、條件分支是否仍成立。只驗證 matchedFiles 相關的流程段落即可，
     但發現上下游明顯不一致時應一併回報。
   - **architecture / use-case**：只在 matchedFiles 含**結構性變動**
     （新增／刪除模組或目錄、進入點增減、外部依賴變更）時，判斷圖與短註是否仍正確；
     純實作層變動直接標記為無影響。`--full` 模式或文件為 `unverified` 時，
     changed-scope 不提供 matchedFiles，結構性變動門檻不適用，改為直接對照 repo
     目前的整體結構驗證圖是否仍正確。
   - **script 失敗的通用處理**：任何機械驗證 script 當機或以非零狀態退出（非上述已定義
     的 `unsupported` 回報）時，視該文件為無法機械驗證，改用語意分析補驗，並在報告的
     「涵蓋範圍」一節記錄此次 script 失敗。
5. **短註驗證**：驗證圖的同時，檢查該文件短註裡的行為宣告
   （「當 X 條件成立時系統會 Y」）是否仍與程式碼一致。
6. **產出報告**（格式見下）。報告本身輸出給使用者，不寫入檔案。

## Drift 報告格式

每條 drift 必須包含四項：

1. **文件位置**：檔案路徑＋圖中的具體元素（哪條 sequence 步驟、哪個類別、哪個欄位）。
2. **文件宣告**：文件目前怎麼說。
3. **程式碼現狀**：實際行為，附 `檔案:行號` 引用。
4. **兩種解讀**：(a) 文件過時 → 附具體的建議修改；(b) 程式碼行為可疑 → 說明為何
   可能是 bug。兩者都要寫，由人裁決；無法判斷哪邊對時明說。

報告末尾固定兩節：

- **涵蓋範圍**：本次驗證了哪些文件、哪些範圍；若因 diff 過大而分批或未完成，
  明確標注已涵蓋與未涵蓋的部分，不默默截斷。
- **未涵蓋的變動**：`unmatchedFiles` 非空時列出，提示這些變動不在任何文件的
  watch 範圍內（可能需要新文件或擴充 watch）。
