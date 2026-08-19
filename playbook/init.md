# doc-align init — 文件集初始化程序

你是執行 doc-align init 的 agent。目標：為目前 repo 建立（或修復）docs/ 文件集與
manifest，完成後的狀態必須能直接通過 check。`<SCRIPTS>` 由呼叫端提供。
manifest 的 `path` 一律相對於 `docs/`；檔案操作使用 `docs/<path>`。

參數：無參數＝完整初始化；`--repair`＝docs/ 內容存在但 manifest 缺失或損壞時，
只重建 manifest（不重寫文件）；`--ci`＝完成後接著執行 configure playbook 把 CI
接線裝進 repo（`doc-align configure` 是單獨跑那一段的別名）；`--no-render`＝略過
最後的 handbook 生成；`--style lean|rich`＝文件密度（預設 lean，見步驟 5 密度原則）。

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
   - class：只要 repo 有自定義 domain class（彼此有繼承／組合／關聯的類別，通常
     ≥3 個）就適用，不得以「類別不多」為由跳過；純 script／SQL／config 為主、沒有
     domain class 的 repo 才跳過，且必須在報告記明理由。
   - db-schema：有 DB 就適用。一份文件只放**一個** erDiagram（真相來源的實體
     schema）；衍生關聯（如 dbt models、views）用 markdown 表格記
     name/location/materialization/producer，欄位級細節由對應 flow 文件的 watch 涵蓋。
   - overview：一律適用。內容為系統目的一段、domain 詞彙表（每個核心概念一行
     定義）、文件導讀順序。因為要總結其他文件的內容，生成順序放在最後（其他文件
     都完成後才寫 overview）。

   以下七種為**擴充類型**，同樣逐一判斷並把決策記入報告；判準是「code 裡有沒有
   可對照的真相」，沒有就跳過、不硬寫：
   - state：code 有明確的狀態集合與轉移（enum／常數集 + 轉移函式或 switch，例如
     訂單狀態、job 生命週期、連線狀態機）時適用，每個狀態機一份。
   - decision：存在多分支的決策／路由邏輯且業務上重要（config 優先序、request
     路由、驗證規則鏈、fallback 順序）時適用。與 sequence 的分工：sequence 描述
     「誰呼叫誰、順序為何」，decision 描述「條件怎麼分、各分支結果」；同一流程兩者
     都需要時各寫一份並互相引用。
   - pipeline：repo 有資料管線／ETL／排程 DAG（Airflow／Prefect／Dagster DAG、dbt
     models、cron job、批次腳本鏈）時適用。**每條 DAG／pipeline 各一份文件**（不得
     把多條 DAG 合併成一張總圖了事），圖內每個 task／model 一個節點、邊＝上下游
     依賴，節點標籤用 task_id／model 名逐字；stage 表逐 task 列 operator／producer／
     consumer／輸出位置／排程／重試。與 db-schema 的分工：schema 的真相在
     db-schema，pipeline 只講資料怎麼流。多條 DAG 之間若有觸發關係，另以一份總覽
     pipeline 文件描述 DAG 級依賴。
   - layers：code 有分層慣例（app→domain→infra、handler→service→repository、
     目錄明確對應層級）時適用；**可完全機械驗證**（deps-check.js）。單層或扁平小
     repo 不適用，記明理由。
   - deployment：repo 內有部署定義（docker-compose、k8s manifests、terraform、
     Procfile、CI deploy job）時適用；描述服務／容器、網段與信任邊界、對外入口、
     外部依賴。沒有部署定義的函式庫型 repo 不適用。
   - permissions：code 有角色／權限模型（RBAC 定義、permission decorator／
     middleware、policy 表）時適用；以表格呈現角色×資源×動作。
   - api：repo 對外提供 HTTP／RPC／CLI 介面且 endpoint 數量值得列目錄（≥5）時
     適用；以表格列 method／path／handler／auth／對應 flow 文件。

   **不適用就不寫**（實測教訓）：沒有 DB／migrations／ORM model 的 repo 不得硬寫
   db-schema（把 config dict 或 DataFrame 欄位畫成 erDiagram 是錯的）；沒有自定義
   domain class 的 repo 不寫 class；判斷結果與理由一律進最終報告的「採用／跳過
   決策」，讓人看得到為什麼沒有某種文件。
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
     擴充類型的骨架：state 用 目的與情境／stateDiagram-v2／狀態語意表（狀態、
     意義、進入條件）／行為規則（每條轉移一條：「在 S1 當 X 時轉到 S2」）／
     實作細節；decision 用 目的與情境／flowchart（菱形＝條件、矩形＝結果）／
     行為規則（每個分支一條，含預設分支）／設計決策／實作細節；pipeline 用
     目的與情境／flowchart（每個 task 一個節點、邊＝依賴；有多個 stage 時以
     subgraph 分組，邊可標資料）／task 表（task_id、operator／類型、producer、
     consumer、輸出位置／materialization、排程、重試）／行為規則（失敗重試、
     冪等、順序依賴、觸發條件）／實作細節；layers 用 目的與情境／flowchart
     （節點＝層、邊＝允許依賴方向 A --> B 表示 A 可依賴 B）／**層級表**（固定欄位
     `| 層 | 目錄 | 說明 |`，目錄欄為 glob，多個以 `、` 分隔，節點 id 必須與層名
     一致——deps-check.js 靠這兩樣機械驗證）／行為規則（例外與禁止事項）／設計
     決策；deployment 用 目的與情境／flowchart＋subgraph（subgraph＝網段或信任
     邊界，節點＝服務／容器／外部系統，邊標 protocol 或 port）／元件表（服務、
     image／來源、對外 port、依賴）／行為規則（啟動順序、健康檢查、secret 來源）／
     實作細節；permissions 用 目的與情境／角色×資源矩陣表（列＝角色、欄＝資源或
     動作，格內 ✓／✗／條件）／行為規則（每條授權規則一條，附 decorator／policy
     證據）／實作細節；api 用 目的與情境／endpoint 表（method、path、handler
     `檔案:行號`、auth、對應 flow 文件）／行為規則（共通規則：版本、錯誤格式、
     分頁、rate limit）／實作細節。permissions 與 api 以表格為主體、可不含
     Mermaid 圖；其餘類型每份至少一張圖。
   - **密度原則（預設 lean；`--style rich` 才放寬）**——骨架要齊，但每段只寫圖說不了
     的東西，實測回饋是「文字太多、圖已經講的又用文字講一遍」：
     - 能用圖就不用表格，能用表格就不用段落，一句能說就不寫三句；圖或表已表達的
       事實**不得**再用文字重述；code 自明的事（函式名已說明用途）不寫。
     - 目的與情境 ≤3 句（為何存在／誰觸發／產出給誰）。
     - 行為規則只寫**看圖看不出來的**：條件、邊界、例外、不變量；每條一句＋證據；
       每份文件 5–10 條為常態，超過代表該拆文件或該把資訊畫進圖。
     - 設計決策只寫非顯而易見且有來源的，≤3 條；沒有就**整段省略**，不硬湊。
     - 實作細節一律表格（設定鍵／預設值／位置），不寫段落；模組職責表、語意表每列
       一句。
     - overview：系統目的 ≤5 句、詞彙表每詞一行、導讀一張表。
     - 軟上限：flow／state／decision 文件 ≤100 行（含圖）、architecture／pipeline／
       deployment ≤150 行；超過先想拆圖或拆文件，不是刪證據。
     `--style rich` 時放寬行數與條數上限、允許設計決策與敘事更完整，但「不重述圖」
     仍然適用。
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
   代表文件剛寫就錯——以程式碼為準修文件，重驗直到 `ok`）；layers 文件另須
   `node <SCRIPTS>/deps-check.js --doc <暫存檔>` 回報 `ok`——回報 `drift` 代表
   code 裡真的有反向依賴：**不要為了過驗證而把反向邊加進允許集合**，保留文件宣告
   的理想分層，把違規條目寫進該文件「行為規則」段的「已知例外」並記入最終報告，
   讓人裁決是修碼還是改宣告；`unsupported` 時依其 reason 修層級表或邊。
7. **建立 manifest**：逐份文件執行
   `node <SCRIPTS>/manifest.js add-doc --doc <path> --type <type> --watch <glob> [--watch ...]`
   （不附 `--commit`：entries 一律先建立為未驗證狀態，是否標記已驗證留給步驟 8）。
   - watch 選擇該文件實際描述的程式碼範圍；db-schema 的 watch 必須把 DDL 目錄
     放在**第一個**（check 從第一個 pattern 推導 --sql 路徑）；layers 的 watch 應
     涵蓋層級表內所有目錄；pipeline 的 watch 指向該 DAG 檔與其 task 實作；
     deployment 的 watch 指向部署定義檔；permissions／api 的 watch 指向 RBAC
     定義／router 所在。
   - `--repair` 模式：從既有文件內容推導 type 與 watch。
8. **自檢**：依 check playbook 以全量模式驗證每份剛完成的文件；發現自己寫錯的
   立即修正並重驗。全量自檢通過的文件逐一執行
   `node <SCRIPTS>/manifest.js set-verified --doc <path> --commit <目前 HEAD>`
   標記為已驗證。完整初始化模式下自檢不通過不得結束；`--repair` 模式不得重寫
   文件內容，自檢不通過的文件維持不標 last_verified，在最終報告列為「待 sync
   修正」，run 正常結束。
9. **生成 handbook**（除非 `--no-render`）：執行 `node <SCRIPTS>/render-handbook.js`
   （輸出 `docs/handbook.html`），零 LLM；輸出路徑與 section 數記入最終報告。
10. **接 CI**（僅 `--ci`）：讀取 `<DOC_ALIGN_ROOT>/playbook/configure.md`（呼叫端未給
    `<DOC_ALIGN_ROOT>` 時為 `<SCRIPTS>` 的上一層）並依其步驟執行，把其輸出的待設定
    secrets／variables 清單併入最終報告。
11. **最終報告**：列出建立的檔案、各類型的採用／跳過決策與理由、驗證輸出摘要、
    既有敘述（README 等）與程式碼的不符清單、尚未被任何文件涵蓋的重要範圍、
    handbook 路徑。`--repair` 模式省略「既有敘述與程式碼不符清單」一項（該模式
    不做探索）。init 不執行 git commit；是否提交由使用者決定。
