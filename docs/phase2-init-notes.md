# Phase 2 `init` playbook 設計素材

來源：2026-07-21 在 data-playground 的手動 bootstrap 實測（init dry-run）＋ fixture repo live E2E。
撰寫 Phase 2 計畫時逐條消化。

## init playbook 應納入的規則

1. **CJK 標點規則**：mermaid-check 的括號啟發式只認 ASCII 括號。圖內含中文標籤時，一律使用全形 `（）`（或嚴格配對的 ASCII 括號），禁止混用——這是實測撞到的第一個 trap。
2. **短註生成時即引用**：每條行為短註在「生成當下」就必須對應到 `file:line` 證據，不能先寫再驗。實測中唯一的事實錯誤就是先寫了「container 裝有 requests/boto3」才回頭讀 Dockerfile。
3. **watch 順序是有語義的**：check playbook 從第一個 watch pattern 的萬用字元前綴推導 `--sql` 路徑，init 產生 db-schema 的 watch 清單時必須把 DDL 目錄放第一個。
4. **衍生 schema 的表示慣例**：一份 db-schema.md 只能有一個 erDiagram（schema-diff 限制）。ELT repo 的衍生關聯（dbt models 等）用 markdown 表格記 name/location/materialization/producer，欄位級細節留給 flow 文件的 watch 涵蓋。
5. **Sequence 步驟寫逐字指令**：`dbt seed` vs `dbt seed --target dev --select iceberg` 的差異就是 drift 藏身處，步驟標籤傾向 verbatim 指令。
6. **Demo／小型 repo 也可能需要 use-cases.md**：判斷依據不是 repo 大小，而是 git 歷史／ADR／openspec 是否顯示「功能入口」有增減紀錄。
7. **doc-type 取捨要留紀錄**：class-diagram 對 SQL/config-heavy repo 可正當跳過（零自定義 domain class），但 init 必須把「為何跳過」寫進報告。

## script 層待辦（Phase 2 或順手修）

- **schema-diff 白名單**：`INSERT`、`CREATE DATABASE`、psql meta-command（`\c` 等）不可能造成 schema drift，應忽略而非列入 `unsupportedStatements`——否則 seed 型 SQL 永遠觸發語意補驗，`ok` 無法代表純機械通過。

## check playbook 既知的開放問題（E2E 回報，未阻塞）

- sequence／architecture 驗證方法完全開放（「沿呼叫鏈確認」），可重現性依賴執行 agent 的判斷；Phase 2 可評估是否給出更結構化的步驟。
