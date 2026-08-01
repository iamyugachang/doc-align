# doc-align init — 文件集初始化程序

你是執行 doc-align init 的 agent。目標：為目前 repo 建立（或修復）docs/ 文件集與
manifest，完成後的狀態必須能直接通過 check。`<SCRIPTS>` 由呼叫端提供。
manifest 的 `path` 一律相對於 `docs/`；檔案操作使用 `docs/<path>`。

參數：無參數＝完整初始化；`--repair`＝docs/ 內容存在但 manifest 缺失或損壞時，
只重建 manifest（不重寫文件）。

## 步驟

1. **盤點現況**：先確認目前目錄是 git repo 且至少有一個 commit（`git rev-parse HEAD`
   成功）；否則停止並說明 doc-align 依賴 git 歷史，請先建立初始 commit。接著檢查
   docs/ 與 docs/.docalign.yml 是否已存在。
   - manifest 已存在且可解析（`node <SCRIPTS>/manifest.js read` 成功）→ 停止並告知
     使用者應改用 check/sync；init 不覆蓋既有的有效狀態。
   - 非 `--repair` 模式下，manifest 存在但無法解析（`manifest.js read` 失敗且非
     檔案不存在）→ 停止並建議使用者改用 `doc-align init --repair`；不得逕行探索
     與寫文件。
   - `--repair` 模式且 manifest 存在但無法解析（`manifest.js read` 失敗且非檔案
     不存在）→ 先把它改名為 `docs/.docalign.yml.bak` 再進行重建，並在最終報告
     記錄備份位置。
   - `--repair` 模式下，若 docs/ 不存在或沒有任何文件 → `--repair` 無可重建，停止
     並說明應執行完整 init（不帶 `--repair`）。
   - `--repair` 模式 → 跳到步驟 7。
2. **探索 repo**：理解實際行為——進入點、模組結構、資料流、外部依賴、DB schema
   來源（migrations／init SQL／ORM models）。若 repo 有程式碼索引工具可用則優先使
   用，否則搜尋與閱讀原始碼。README 等既有敘述僅供參考：**敘述與程式碼不符時以
   程式碼為準**，並把不符處記入最終報告。
3. **決定文件集**：對五種類型逐一判斷「本 repo 適不適用」，決策與理由記入報告；
   overview 一律適用，作為第六份文件：
   - architecture：幾乎總是適用。
   - use-case：判斷依據不是 repo 大小，而是功能入口是否存在與變動（git 歷史／
     ADR／spec 紀錄顯示入口增減者，適用）。
   - sequence（flows/）：每個值得描述的流程一份；機制相同僅參數不同的流程合併
     為一份圖＋敘事說明差異。
   - class：只在 repo 有自定義 domain class 時適用；SQL/config 為主的 repo 可跳過，
     但必須在報告記明理由。
   - db-schema：有 DB 就適用。一份文件只放**一個** erDiagram（真相來源的實體
     schema）；衍生關聯（如 dbt models、views）用 markdown 表格記
     name/location/materialization/producer，欄位級細節由對應 flow 文件的 watch 涵蓋。
   - overview：一律適用。內容為系統目的一段、domain 詞彙表（每個核心概念一行
     定義）、文件導讀順序。因為要總結其他文件的內容，生成順序放在最後（其他文件
     都完成後才寫 overview）。
4. **接手既存文件**（docs/ 已有內容但無 manifest 時）：先讀既有文件，盡量保留其
   結構與敘述——只修正與程式碼不符處、補缺漏、調整為本文件集的格式；接手中發現
   的錯誤記入報告。
5. **撰寫文件**，遵守以下寫作規則（來自實測教訓，違反任一條都算未完成）：
   - 每份文件依類型使用第 4 節定義的段落骨架：flows 用完整五段（目的與情境／
     圖／行為規則／設計決策／實作細節）；architecture 用 目的與情境／圖／
     模組職責表／資料流敘事／設計決策／實作細節；use-cases 用 目的與情境／圖／
     各 use case 一段敘事；db-schema 用 目的與情境／erDiagram／欄位語意表／
     行為規則／實作細節，並可選用**設計決策**段落（有 schema 層設計脈絡——例如
     為何拆表、為何選這個正規化程度——時才加）。
   - 證據粒度依段落分工不同：**行為規則**（可驗證層）每條在**寫下當下**就必須
     有對應的程式碼證據（`檔案:行號`）；**設計決策**（意圖層）的證據可為文件
     路徑、commit SHA，或 ADR／spec 檔案引用，行號非必要。任一段落中證據不足
     的宣告不寫，或標注為未驗證；無來源可查的推斷必須標注【推測】。
     行為規則寫可驗證的具體行為句（「當 X 時系統會 Y」），不寫空泛描述。
   - Mermaid 圖內含中日韓文字的標籤一律使用全形括號（），不與 ASCII 括號混用。
   - sequence 步驟標籤使用逐字指令（含完整參數），不寫摘要化的指令；指令背後
     的補充說明（為何這樣呼叫、參數選擇的理由等）不擠進圖面，寫進行為規則段落，
     避免圖面因加註而過寬。
   - db-schema 的**欄位語意表**與**行為規則**分工不重疊：欄位的商業意義（這欄
     位代表什麼、為何存在）寫進語意表；約束與邊界事實（唯一性、預設值、何時
     為 null、跨表一致性等可驗證規則）寫進行為規則。同一事實只在其中一處宣告，
     不得兩段重複。
6. **驗證後寫入**：每份文件寫入前先在暫存位置通過
   `node <SCRIPTS>/mermaid-check.js <暫存檔>`；db-schema 文件另須
   `node <SCRIPTS>/schema-diff.js --doc <暫存檔> --sql <DDL 路徑>` 回報 `ok`
   （`unsupported` 時修文件或在報告說明原因，不得默默留下 drift；回報 `drift` 時
   代表文件剛寫就錯——以程式碼為準修文件，重驗直到 `ok`）。
7. **建立 manifest**：逐份文件執行
   `node <SCRIPTS>/manifest.js add-doc --doc <path> --type <type> --watch <glob> [--watch ...]`
   （不附 `--commit`：entries 一律先建立為未驗證狀態，是否標記已驗證留給步驟 8）。
   - watch 選擇該文件實際描述的程式碼範圍；db-schema 的 watch 必須把 DDL 目錄
     放在**第一個**（check 從第一個 pattern 推導 --sql 路徑）。
   - `--repair` 模式：從既有文件內容推導 type 與 watch。
8. **自檢**：依 check playbook 以全量模式驗證每份剛完成的文件；發現自己寫錯的
   立即修正並重驗。全量自檢通過的文件逐一執行
   `node <SCRIPTS>/manifest.js set-verified --doc <path> --commit <目前 HEAD>`
   標記為已驗證。完整初始化模式下自檢不通過不得結束；`--repair` 模式不得重寫
   文件內容，自檢不通過的文件維持不標 last_verified，在最終報告列為「待 sync
   修正」，run 正常結束。
9. **最終報告**：列出建立的檔案、各類型的採用／跳過決策與理由、驗證輸出摘要、
   既有敘述（README 等）與程式碼的不符清單、尚未被任何文件涵蓋的重要範圍。
   `--repair` 模式省略「既有敘述與程式碼不符清單」一項（該模式不做探索）。
   init 不執行 git commit；是否提交由使用者決定。
