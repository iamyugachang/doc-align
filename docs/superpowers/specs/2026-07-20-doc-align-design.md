# doc-align 設計文件

日期：2026-07-20
狀態：已與使用者確認設計方向，待 review

## 1. 目的與問題

被問到某個功能時，只能去 trace code 才能回答商業邏輯、設計與行為。文件的目的是讓人**不看程式碼就能回答功能問題**，但文件與程式碼會逐漸脫節（drift），沒有人力持續維護。

doc-align 是一個文件對齊工具，解決兩件事：

1. **如何對齊**：偵測文件與程式碼的落差，提出文件更新建議。
2. **何時對齊**：在 PR 階段與手動觸發兩個時機執行檢查。

## 2. 需求共識（釐清階段的結論）

- 文件讀者：**工程師（含未來的自己）**。
- 文件形式：**圖為主（Mermaid），附短註**——每張圖下方幾句關鍵商業規則、邊界條件、設計原因。不維護長篇敘事。
- 文件位置：**repo 內 markdown**（`docs/`），與程式碼同 PR 進版控。
- 真相來源：**工具只報告差異，人決定**。工具永遠不預設程式碼是對的——drift 可能是文件過時，也可能是程式碼 bug。
- 觸發時機：**PR 階段（非阻塞）+ 手動觸發**。
- 執行環境：**Claude Code 與 opencode 都要能用**；CI 以 headless 模式（`claude -p` 或 `opencode run`）執行同一套邏輯。
- 支援兩種起點：repo 已有過時文件，或完全沒有文件（由 `init` 生成）。

## 3. 非目標（Non-goals）

- 不產生給 PM／非技術者的文件（未來可延伸，本版不做）。
- 不同步外部系統（Confluence／Notion）。
- 不做 API reference 自動生成（該類工具已存在，如 OpenAPI）。
- 不強制文件格式為逐條斷言（doc-as-claims）；文件仍是給人讀的圖與短註。
- PR 檢查不阻塞 merge（不 fail CI）。

## 4. 文件集

每個 repo 一套，住在 `docs/`：

| 文件 | 內容 | 驗證方式 |
|---|---|---|
| `architecture.md` | 系統架構圖（模組、外部依賴） | LLM 語意判斷，僅大型結構變動時觸發 |
| `use-cases.md` | Use case 圖 + 每個 use case 一兩句說明 | 功能入口新增／移除時檢查 |
| `flows/<use-case>.md` | 各 use case 的 sequence diagram | 沿實際 call path 逐步驗證 |
| `class-diagram.md` | 核心 domain 類別圖（不含瑣碎 utility） | Symbol 存在性與關係比對 |
| `db-schema.md` | Schema 快照 + 欄位用途註記（有 DB 才生成） | 對 migrations／ORM models 機械 diff |
| `overview.md` | 系統目的、domain 詞彙表、文件導讀順序 | LLM 語意判斷，僅結構性變動時觸發 |

2026-08 擴充七型（篩選標準：code 有可對照真相、Mermaid 或 markdown 表格寫得出來；策略／專案／圖表類不進核心）：

| 文件 | 內容 | 驗證方式 |
|---|---|---|
| `state/<machine>.md` | 狀態機（stateDiagram-v2）＋狀態語意表＋每條轉移一條規則 | 對照 enum／轉移函式 |
| `decisions/<topic>.md` | 決策／路由邏輯（flowchart）＋每分支一條規則 | 沿 if／match／策略表逐分支 |
| `pipelines/<dag>.md` | 每條 DAG 一份：task 級 flowchart＋task 表 | 對照 DAG／dbt／cron 定義 |
| `layers.md` | 分層依賴（flowchart 邊＝允許方向）＋層級表 `\| 層 \| 目錄 \| 說明 \|` | **機械**：deps-check.js 掃 import 圖 |
| `deployment.md` | 部署拓樸（subgraph＝網段／信任邊界）＋元件表 | 對照 docker-compose／k8s／terraform |
| `permissions.md` | 角色×資源矩陣表 | 對照 RBAC 定義／decorator／policy |
| `api.md` | endpoint 表（method／path／handler／auth／flow） | 對照 router 註冊 |

設計原則：**文件類型本身決定驗證方法**。圖表是結構化宣告（類別、呼叫步驟、欄位都是具體 symbol），比自然語言敘事更可機械驗證。

### 文件結構（結構化敘事）

每份文件依類型包含以下段落：

- **目的與情境**：為什麼存在、誰觸發、產出給誰；敘事段落。
- **圖**（Mermaid）。
- **行為規則**：編號的可驗證商業規則句（當 X 條件成立時系統會 Y），含邊界條件，每條附 `file:line` 證據——原「短註」的升級。
- **設計決策**：為什麼這樣設計；來源是 code／git 歷史／ADR，推測需標注。db-schema.md 此段為選用，只在有 schema 層設計脈絡（例如為何拆表、為何選這個正規化程度）時才加。
- **實作細節**：設定類事實。

`architecture.md` 的中段（原本是圖後接短註）改為**模組職責表 + 資料流敘事**；`db-schema.md` 在既有欄位證據之外增加**欄位語意表**（每個欄位的商業意義，而非只有型別）。

**分層對齊與證據粒度**：行為規則屬**可驗證層**（check 逐條驗證），每條須有 `file:line` 證據；目的、設計決策、overview 屬**意圖層**（僅結構性變動時檢查，drift 頻率低），設計決策的證據可為文件路徑、commit SHA，或 ADR／spec 檔案引用，行號非必要。任一層證據不足的宣告不寫，或標注為未驗證；無來源可查的推斷必須標注【推測】。

**行為規則 vs 欄位語意表分工**：兩者皆可能提到同一欄位，但內容不重疊——欄位的商業意義（代表什麼、為何存在）只寫進欄位語意表；約束與邊界事實（唯一性、預設值、null 時機、跨表一致性等可驗證規則）只寫進行為規則。同一事實不得兩處重複宣告。

**sequence 圖的逐字指令**：flows 的 sequence 圖步驟標籤使用逐字指令（含完整參數），不寫摘要化的指令；指令背後的補充說明（為何這樣呼叫、參數選擇的理由）不擠進圖面，移到行為規則段落，避免圖面因加註而過寬。

## 5. Manifest（`docs/.docalign.yml`）

由工具維護，人不需要手動編輯：

```yaml
docs:
  - path: flows/refund.md
    type: sequence            # architecture | use-case | sequence | class | db-schema | overview
                              # | state | decision | pipeline | layers | deployment | permissions | api
    watch:                    # 這份文件描述的程式碼範圍（glob）
      - src/billing/**
      - src/api/routes/refund.py
    last_verified: a1b2c3d    # 上次確認對齊時的 commit SHA
```

- `watch` patterns 在 `init` 時自動推導、`sync` 確認對齊後自動更新。
- `architecture` 與 `use-case` 類型的 watch 通常涵蓋整個原始碼目錄，但驗證只在**結構性變動**（新增／移除模組或目錄、進入點增減、外部依賴變更）時才進 LLM 判斷，一般實作層變動由 `changed-scope.js` 直接過濾掉。
- `last_verified` 是增量檢查的基準：`check` 只分析 `last_verified..HEAD` 的變動。

## 6. 指令

三個子命令，本地與 CI 共用同一套 playbook：

### `doc-align init`
首次使用。探索 codebase（repo 有 `.codegraph/` 索引時優先用 CodeGraph 查 symbol 與 call path，否則用 agent 一般探索），生成第 4 節的文件集與 manifest。若 repo 已有既存文件，先讀取並盡量沿用其結構與內容，只補缺與修錯。

### `doc-align check`
Drift 偵測，**只報告、不改檔**。流程：

1. `changed-scope.js` 取得變動範圍（增量：`last_verified..HEAD`；PR：`base...HEAD`；`--full` 則全量重驗）。
2. 依 manifest watch patterns 反查受影響的文件；無任何文件受影響則直接結束（零 LLM 成本）。
3. 依文件類型路由驗證（第 4 節表格），機械類先跑，LLM 只處理需要語意判斷的部分。
4. 輸出 drift 報告（第 7 節格式）。

### `doc-align sync`
在 check 結果上生成文件修改，本地情境由使用者 review 後套用；同時更新 manifest 的 `last_verified` 與 `watch`。

## 7. Drift 報告格式

每條 drift 包含：

- **文件位置**：檔案與圖中的具體元素（某條 sequence 步驟、某個類別關係）。
- **文件宣告**：文件目前說什麼。
- **程式碼現狀**：實際行為（附 `file:line` 引用）。
- **兩種解讀**：(a) 文件過時 → 附建議的文件修改；(b) 程式碼行為可疑 → 說明為何可能是 bug。由人裁決。

## 8. 觸發時機

### 手動（本地）
- `/doc-align check`：增量檢查（`last_verified` 之後的變動）。
- `/doc-align check --full`：全量重驗。
- `/doc-align sync`：套用文件更新。

### PR 階段（CI）
GitHub Action 以 headless 模式執行 check（比對 base branch），將 drift 報告以 **PR 留言**呈現：

- **非阻塞**：只留言，不 fail CI。
- 未觸及任何 watch 範圍的 PR 直接跳過，零成本。
- 若 PR 已同時附上對應的文件更新，留言確認對齊。
- 成本控制：機械驗證優先、LLM 僅在必要時介入、增量範圍限定。

## 9. 架構與可攜性

本體是 **markdown playbook（流程控制）+ Node.js scripts（機械工作）**。LLM agent 是 orchestrator，照 playbook 執行；deterministic 的步驟一律交給 script，確保結果穩定並節省 token。

```
doc-align/
  playbook/                  # 核心流程指令（純 markdown，agent 無關）
    init.md
    check.md
    sync.md
  scripts/                   # Node.js，零外部依賴優先
    changed-scope.js         #   git diff → 受影響文件清單（讀 manifest watch patterns）
    manifest.js              #   .docalign.yml 讀寫
    schema-diff.js           #   migrations / ORM models 機械比對
    mermaid-check.js         #   Mermaid 語法驗證
  adapters/
    claude-code/SKILL.md     # thin wrapper：載入 playbook 與 scripts
    opencode/command/        # opencode custom command，指向同一套 playbook
  ci/
    doc-align.yml            # GitHub Action 範本（claude -p 與 opencode run 兩種 runner）
```

**可攜性約束**：playbook 與 scripts 不得出現任何 agent 專屬的工具名稱（不寫「用 Grep tool」，寫「搜尋 xxx」）；agent 專屬內容只存在於 adapter 層。新增第三種 agent 支援時只需新增一個 adapter。

CodeGraph 為**選用加速**：有索引時用它查 symbol 與 call path（更快更準），沒有時 fallback 到 agent 自行探索，功能不受影響。

## 10. 錯誤處理

- 生成的 Mermaid 一律先過 `mermaid-check.js` 語法驗證再寫入，避免產出無法渲染的圖。
- Diff 過大（大型 refactor）時分批分析，並在報告中標注實際涵蓋範圍，不默默截斷。
- Manifest 損壞或缺失時，check 降級為提示重跑 `init`（或 `init --repair`），不產出不可信的報告。
- `schema-diff.js` 遇到不支援的 migration 格式時明確報告「無法驗證」，交由 LLM fallback 或標注跳過。

## 11. 測試策略

- **端到端**：建一個小型 fixture repo，驗證完整循環——`init` 生成文件 → 修改 code → `check` 抓到 drift → `sync` 修正文件 → 再 `check` 應為乾淨。
- **單元測試**：`schema-diff.js`、`changed-scope.js`、`manifest.js` 的機械邏輯附單元測試（Node 內建 test runner）。
- **雙 agent 驗證**：同一 fixture repo 在 Claude Code 與 opencode 各跑一次完整循環，確認 adapter 層無洩漏。

## 12. 實作階段建議

1. **Phase 1**：scripts + playbook `check`／`sync` 的核心，Claude Code adapter，先在單一 repo 手動使用。
2. **Phase 2**：`init`（含既存文件的接手邏輯）、opencode adapter。
3. **Phase 3**：GitHub Action 範本與 PR 留言整合。

每個 phase 結束都有可用的產出，不需等全部完成才受益。

## 修訂紀錄

- 2026-07-21：文件形式由「圖＋短註」升級為「圖＋結構化敘事」（使用者實際使用回饋：短註不足以重建商業邏輯）。
- 2026-08-01：實測 regeneration 回饋四點修正——意圖層（設計決策）證據粒度放寬為文件路徑／commit SHA／ADR-spec 引用（行號非必要），無來源推斷需標【推測】；db-schema 骨架的設計決策段落改為選用；sequence 逐字指令的補充說明移到行為規則；行為規則與欄位語意表分工釐清（同一事實不得兩處重複宣告）。
