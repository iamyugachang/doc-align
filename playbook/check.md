# doc-align check — drift 偵測程序（＝ `sync --dry-run`）

本程序是 sync 的第一步；單獨執行時（`doc-align sync --dry-run`，別名 `doc-align check`）
只輸出報告、不寫任何檔案。

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
   停止並告知使用者需先建立 manifest（執行 `doc-align init`；manifest 損壞而文件存在時用
   `doc-align init --repair`），不要憑空產生報告。
2. **取得受影響範圍**：執行
   `node <SCRIPTS>/changed-scope.js [--range <range>] [--full]`，讀取 JSON 輸出。
3. **早退**：若所有 docs 的 status 皆為 `clean` 且 `unmatchedFiles` 為空，
   回報「無 drift，文件與程式碼對齊」並結束。
4. **逐文件驗證**：對每份 status 為 `affected` 的文件，依 `type` 選擇方法。
   `unverified` 的文件視同全量：對整份文件做同樣驗證，並在報告註明原因
   （缺少或失效的 last_verified）。若 repo 有程式碼索引工具（如 codegraph）優先用它
   查 symbol 與呼叫路徑；否則搜尋原始碼。行為規則段落逐條驗證（見步驟 5）；
   目的與情境／設計決策等敘事段落、以及 overview 的詞彙表與導讀順序，屬**意圖層**，
   僅在觸發結構性變動判準（同下方 architecture／use-case 的判準）時才檢查，drift
   頻率低。
   - **db-schema**：`--sql` 路徑從 manifest 的 watch patterns 演算推導：取 pattern 中
     第一個萬用字元（`*`／`?`）之前的目錄前綴（如 `migrations/**` → `migrations/`；
     `db/migrations/*.sql` → `db/migrations/`）。watch 有多個 pattern 時依序嘗試，
     用推導出的路徑執行
     `node <SCRIPTS>/schema-diff.js --doc <文件路徑> --sql <推導出的路徑>`；
     所有 pattern 都推導不出任何 `.sql` 檔時，比照下述 `unsupported` 流程處理。
     `status: unsupported` 或 `unsupportedStatements` 非空時，改以語意分析補驗：
     閱讀 ORM models 或 migration 原始碼，對照文件的 erDiagram 與欄位語意表。
   - **class**：讀取文件中的 classDiagram，逐一確認圖中的類別、屬性、方法、關係
     在程式碼中存在且正確。改名、刪除、關係改變都是 drift。
   - **sequence**：讀取 sequence diagram，沿實際呼叫鏈逐步確認：每一步的呼叫者、
     被呼叫者、順序、條件分支是否仍成立。只驗證 matchedFiles 相關的流程段落即可，
     但發現上下游明顯不一致時應一併回報。
   - **architecture / use-case / overview**：只在 matchedFiles 含**結構性變動**
     （新增／刪除模組或目錄、進入點增減、外部依賴變更）時，判斷圖與敘事段落是否仍正確；
     overview 額外檢查詞彙表與文件導讀順序是否仍對應目前的文件集。純實作層變動直接
     標記為無影響。`--full` 模式或文件為 `unverified` 時，changed-scope 不提供
     matchedFiles，結構性變動門檻不適用，改為直接對照 repo 目前的整體結構驗證內容
     是否仍正確。
   - **state**：讀 stateDiagram-v2，確認每個狀態仍存在於 code 的狀態集合（enum／常數），
     每條轉移仍有對應的轉移邏輯且 guard 條件一致；code 新增的狀態或轉移而文件沒有也是
     drift。狀態語意表與行為規則逐條對照。
   - **decision**：讀 flowchart，沿 code 的條件分支（if／match／switch／策略表）逐一
     確認每個菱形條件與分支結果仍成立、預設分支正確、分支順序（先判誰）未變。
   - **pipeline**：讀 flowchart 與 task 表，對照管線定義（Airflow／Prefect／Dagster DAG
     檔、dbt models、cron、批次腳本）確認每個 task 存在、上下游依賴方向、operator／
     輸出位置、排程與重試規則；task 新增／移除／依賴改向是 drift。
   - **layers**：執行 `node <SCRIPTS>/deps-check.js --doc <文件路徑>`（Python 的 src
     根若非 `.`／`src` 可加 `--py-root <dir>`）。`status: drift` 時每條 violation 都是
     drift（「程式碼行為可疑」解讀＝反向依賴，「文件過時」解讀＝分層宣告已變），
     `unassigned` 非空時提示層級表 glob 未涵蓋；`unsupported` 則改語意分析並在涵蓋範圍
     記錄。機械結果之外，行為規則的例外條款仍逐條對照。
   - **deployment**：對照部署定義檔（docker-compose／k8s／terraform／CI deploy job）
     確認服務／容器清單、網段與信任邊界、對外 port、image／來源、依賴與啟動順序、
     secret 來源；元件表逐列對照。
   - **permissions**：對照 RBAC 定義／decorator／middleware／policy 表，逐格確認
     角色×資源矩陣；新增角色或資源而文件沒有也是 drift。
   - **api**：對照 router／handler 註冊處，逐列確認 method、path、handler 位置、auth
     要求；endpoint 新增／移除／改路徑是 drift。共通規則（版本、錯誤格式、分頁）
     只在 matchedFiles 觸及共通層時檢查。
   - **script 失敗的通用處理**：任何機械驗證 script 當機或以非零狀態退出（非上述已定義
     的 `unsupported` 回報）時，視該文件為無法機械驗證，改用語意分析補驗，並在報告的
     「涵蓋範圍」一節記錄此次 script 失敗。
5. **行為規則與敘事段落驗證**：驗證圖的同時，逐條檢查該文件「行為規則」段落裡的行為
   宣告（「當 X 條件成立時系統會 Y」）是否仍與程式碼一致；「目的與情境」「設計決策」
   等敘事段落依步驟 4 的意圖層原則，僅在觸發結構性變動判準時一併檢查。
6. **產出報告**（格式見下）。報告本身輸出給使用者，不寫入檔案。

## Drift 報告格式

若本次驗證的文件全部確認與程式碼一致（含 PR 已同步更新文件的情況），報告開頭明確寫出
「無 drift，文件與程式碼對齊」。

每條 drift 必須包含四項：

1. **文件位置**：檔案路徑＋圖中的具體元素（哪條 sequence 步驟、哪個類別、哪個欄位）。
2. **文件宣告**：文件目前怎麼說。
3. **程式碼現狀**：實際行為，附 `檔案:行號` 引用。
4. **判斷**：(a) 文件過時 → 附具體的建議修改；(b) 程式碼行為可疑 → 說明為何
   可能是 bug；(c) 無法驗證 → 當程式碼是 stub／尚未實作，或現有證據不足以支持
   (a)(b) 任一方時，明確標記為無法驗證並說明原因，不得強行寫成有信心的 drift。
   (a)(b) 都要寫，由人裁決；(c) 的項目在報告中與已確認的 drift 分開列出。

報告末尾固定兩節：

- **涵蓋範圍**：本次驗證了哪些文件、哪些範圍；若因 diff 過大而分批或未完成，
  明確標注已涵蓋與未涵蓋的部分，不默默截斷。
- **未涵蓋的變動**：`unmatchedFiles` 非空時列出，提示這些變動不在任何文件的
  watch 範圍內（可能需要新文件或擴充 watch）。
