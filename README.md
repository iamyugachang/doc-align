# doc-align

讓 repo 內的文件集（Mermaid 圖 + 結構化敘事：目的、行為規則、設計決策、overview 導讀）與程式碼保持對齊的工具。
工具只報告差異，由人決定文件過時還是程式碼有問題。

設計文件：docs/superpowers/specs/2026-07-20-doc-align-design.md

## 結構

- `playbook/` — 核心流程指令（agent 無關的 markdown；init／sync，以及 check＝sync 的偵測段、render、configure）；`writing.md`＝寫作心法（arc42／C4／Diátaxis／ADR／Google style 蒸餾版）、`diagrams.md`＝圖的設計規範（diagram-design 的哲學／選型／複雜度預算／語意角色／反模式換算成 Mermaid），init／sync 寫文件時都必須遵守；`optional-skills.md`＝可選外部 skill 的偵測與使用規則（不 vendor）
- `scripts/` — deterministic Node.js scripts（零依賴）
- `bin/doc-align.js` — 獨立 CLI：內建最小 agent loop（tool calling）直打 OpenAI-compatible API，不需任何外部 agent
- `SKILL.md`（repo 根）— [Agent Skills 標準](https://agentskills.io/specification)的 skill 本體：repo 根就是自包含的 skill 目錄，Claude Code／opencode／pi 等直接讀
- `adapters/opencode/` — opencode 可選 command 薄殼（`/doc-align <args>` 帶參數 slash 調用用；skill 本體 opencode 已原生支援）
- `.claude-plugin/` — Claude Code plugin／marketplace manifests（`/plugin` 安裝通道）
- `tests/` — 單元與整合測試（`npm test`）

兩種使用情境，同一套 playbook／scripts：

**手動 lane（有人在場裁決）**——在 feature branch 上改文件：偵測 drift、由人裁決
「文件過時還是程式碼可疑」、更新文件，產出跟著 branch 一起 merge。本地 render 出來的
`docs/handbook.html` 就是**這條 branch 的架構視圖**（handbook 上有 branch＋commit
provenance 標示）。跑在哪隨你：

| 方式 | 適合 | LLM 從哪來 |
|---|---|---|
| **當 skill 用**（Claude Code／opencode／pi／oh-my-pi…） | 平常就開著 agent 的人 | 該 agent 自己的 |
| **獨立 CLI**（`doc-align sync --dry-run`） | 不想開 agent、或公司電腦只有內部 gateway | 內建 agent loop 直打 OpenAI-compatible endpoint |

**自動 lane（無人值守，監測＋公示）**——CI 驗證並發佈，沒有人在場所以只報告、不裁決：

| 方式 | 做什麼 |
|---|---|
| **MR／PR check**（`ci/doc-align-direct.yml` 等） | 零成本閘門＋Mermaid lint＋（觸及 watch 時）drift 報告留言；永不 fail |
| **Nightly＋Pages**（`ci/doc-align-nightly-*.yml`） | 每天台灣午夜驗 default branch，把 handbook＋drift 報告發佈到 GitHub／GitLab Pages——**隨時要根據文件討論專案，打開 Pages 就是 single source of truth**，且附「此刻可不可信」的 drift 狀態 |

兩條 lane 形成閉環：手動 lane 在 branch 裡更新文件 → merge → nightly 驗證 main →
Pages 更新 → 出現 drift → 回到手動 lane 裁決。

## 可選加分 skill（建議在你的 agent 裡裝，repo 不內含）

doc-align 零依賴就能跑完整流程；下面這些第三方 skill **裝了會更好、沒裝照常**——playbook 會偵測
（`$DOC_ALIGN_SKILLS_DIR` → `~/.claude/skills` → `~/.hermes/skills` → 專案 `.claude/skills`），找到才用，
找不到只在報告末尾提醒一行。我們刻意不把它們複製進 repo（授權／過時／綁 harness／兩套真相，見
`playbook/optional-skills.md`）。

| skill | 裝了強化什麼 | 安裝（Claude Code／oh-my-pi 讀 `~/.claude/skills`；opencode／Hermes 讀 `~/.hermes/skills` 或各自設定） |
|---|---|---|
| **diagram-design**（MIT） | 它的設計判準已是**必要規範**（`playbook/diagrams.md`，不用裝）；裝了才多的是之後 `present` 把 Mermaid 重畫成品牌風 SVG 給簡報 | `git clone https://github.com/cathrynlavery/diagram-design ~/.claude/skills/diagram-design` |
| **developer-docs-framework** | init 寫句子時多一層 style 規則（Diátaxis＋27 條規則＋Google／Good Docs 等 6 套 style guide） | `git clone https://github.com/anivar/developer-docs-framework ~/.claude/skills/developer-docs-framework` |
| **documentation-and-adrs**（addy-agent-skills） | 設計決策要升級成獨立 ADR 檔時的模板與既有慣例偵測 | Claude Code：`/plugin` 市集 `addy-agent-skills` → `documentation-and-adrs` |
| **arc42-toolkit** | repo 被要求交完整 arc42（12 節）時的補充產物，不取代 docs/ | `git clone https://github.com/MSiccDev/arc42-toolkit ~/.claude/skills/arc42-toolkit` |

安裝指令以各 repo README 為準（有些 skill 需要額外 Python 依賴）。寫作心法本身（arc42／C4／Diátaxis／
ADR／Google style）已蒸餾在 `playbook/writing.md`，**不裝任何 skill 也會生效**。

## 安裝（獨立 CLI）

    git clone https://github.com/iamyugachang/doc-align && cd doc-align
    npm link            # 或 ln -s "$(pwd)/bin/doc-align.js" ~/.local/bin/doc-align

### 設定 `DOC_ALIGN_LLM_*`

三個變數，兩種放法。**放檔案**（推薦，設一次就好；CLI 啟動時自動讀取）：

    mkdir -p ~/.config/doc-align
    cat > ~/.config/doc-align/env <<'EOF'
    DOC_ALIGN_LLM_BASE_URL=https://你的gateway/v1
    DOC_ALIGN_LLM_API_KEY=sk-xxx
    DOC_ALIGN_LLM_MODEL=模型id
    EOF
    chmod 600 ~/.config/doc-align/env

或**直接 export**（臨時／CI）：

    export DOC_ALIGN_LLM_BASE_URL=... DOC_ALIGN_LLM_API_KEY=... DOC_ALIGN_LLM_MODEL=...

檔案格式每行 `KEY=VALUE`（`#` 註解、可加引號）；環境變數已有值時以環境變數優先，檔案只補缺的。

| 變數 | 意義 | 範例 |
|---|---|---|
| `DOC_ALIGN_LLM_BASE_URL` | OpenAI-compatible endpoint，**含 `/v1`** | 公司內部 gateway `https://llm.internal/v1`；OpenAI `https://api.openai.com/v1`；Anthropic（OpenAI 相容層）`https://api.anthropic.com/v1`；OpenRouter `https://openrouter.ai/api/v1`；本機 Ollama `http://localhost:11434/v1` |
| `DOC_ALIGN_LLM_API_KEY` | 該 endpoint 的 key（唯一 secret，中立命名） | Ollama 隨便填非空字串 |
| `DOC_ALIGN_LLM_MODEL` | model id | `gpt-4o`／`claude-sonnet-4-5`／`anthropic/claude-sonnet-4.5`／`qwen2.5-coder` |
| `DOC_ALIGN_LLM_TIMEOUT_MS` | 選配：單次請求逾時，預設 300000 | |
| `DOC_ALIGN_AGENT_MAX_CONTEXT_CHARS` | 選配：agent 模式上下文字元預算，預設 400000（超過時從最舊的工具輸出開始省略） | |
| `DOC_ALIGN_AGENT_MAX_TURNS` | 選配：agent 迴圈上限，預設 60（`--max-turns` 可覆寫） | |

CI 用同一組名字：GitLab 放 CI/CD Variables（KEY 勾 Masked）；GitHub 放 Secret `DOC_ALIGN_LLM_API_KEY`＋Variables `DOC_ALIGN_LLM_BASE_URL`／`DOC_ALIGN_LLM_MODEL`。

設好後 `cd` 到目標 repo，依序驗證：

    doc-align doctor                                   # 驗 env＋gateway：chat（direct 模式）與 tools（agent 模式）各探測一次
    doc-align render                                   # 零 LLM，先確認 CLI 本身通
    doc-align sync --dry-run --range HEAD~3...HEAD --verbose   # agent 模式，確認 gateway 的 tool calling 通
    doc-align sync --dry-run                           # 增量 drift 報告（不寫檔）
    doc-align sync --dry-run --range origin/main...HEAD --direct   # 單次打包（CI 預設走這條，便宜、有界）
    doc-align sync                                     # 偵測 → 裁決 → 更新 → 推進 manifest → 自動 render
    doc-align init                                     # 從零 bootstrap 文件集＋handbook（預設 lean：圖優先、少文字；--style rich 放寬）
    doc-align init --ci                                # 初始化並順便接 CI

CLI 的 agent 模式怎麼運作：把對應的 playbook 當 system prompt，模型透過**受限工具**自行執行——
`read_file`／`list_dir`／`glob`／`grep`／`git`（唯讀子命令）／`run_script`（只能跑 doc-align 自家
scripts）／`ask_user`；`init`／`sync` 額外開 `write_file`／`move_file`（只能寫 repo 內或系統
暫存目錄），`sync --dry-run` 完全唯讀。init／sync 結束後 CLI 會再機械跑一次 render（冪等），
確保 `docs/handbook.html` 永遠跟文件同步。任意 shell 預設關閉，需要 codegraph 之類外部工具時加 `--allow-shell`。
進度印到 stderr（`--verbose` 含工具輸出預覽、`--quiet` 靜音），最終報告印到 stdout 或 `--out <path>`。
其他選項：`-C <dir>`、`--model`、`--max-turns`（預設 60；超過 exit 2）、`--yes`（非互動：ask_user
一律回「非互動」，agent 依 playbook 的非互動情境處理）。gateway 必須支援 OpenAI tool calling；不支援時
（通常是 `tools` 欄位被回 HTTP 4xx）改用 `sync --dry-run --direct`（純文字單次呼叫）。

## 安裝（當 skill 用：Claude Code／opencode／pi…）

repo 根就是 [Agent Skills 標準](https://agentskills.io/specification)的 skill 目錄
（SKILL.md＋playbook/＋scripts/ 自包含），**clone 進 skills 目錄就是安裝**，
不需要 symlink。skill 模式的 LLM 就是 harness 自己——**不需要設定任何
`DOC_ALIGN_LLM_*`，也不需要跑 `doctor`**（那些只屬於獨立 CLI／CI 情境）：

    git clone https://github.com/iamyugachang/doc-align ~/.claude/skills/doc-align

一份 clone 各 harness 通用：

| harness | 讀 `~/.claude/skills`？ | 備註 |
|---|---|---|
| **Claude Code** | ✅ 原生 | `/doc-align init`、`/doc-align sync [--dry-run]` |
| **opencode** | ✅ 原生（[skills 文件](https://opencode.ai/docs/skills/)） | agent 依 description 自動載入；帶參數 slash 調用見下方可選 command |
| **pi／oh-my-pi** | 設定加一行 | `~/.pi/agent/settings.json` 加 `"skills": ["~/.claude/skills"]`；或改 clone 到 pi 預設會讀的 `~/.agents/skills/doc-align`（opencode 也讀這裡，但 Claude Code 不讀） |
| **Codex CLI／Cursor／VS Code…** | 依各家 Agent Skills 支援 | 已採用該標準的 harness 都能直接載入這個目錄 |

更新＝`cd ~/.claude/skills/doc-align && git pull`。換機器＝重新 clone。

**Claude Code 也可走 plugin marketplace**（官方第三方發佈通道）：

    /plugin marketplace add iamyugachang/doc-align
    /plugin install doc-align@doc-align

兩種裝法擇一即可，直接 clone 是主路徑。

### opencode 補充

skill 本體 opencode 原生載入，無需任何設定。可選加裝 command 薄殼，
獲得 `/doc-align <args>` 帶參數的 slash 調用：

    mkdir -p ~/.config/opencode/commands
    ln -sfn ~/.claude/skills/doc-align/adapters/opencode/commands/doc-align.md ~/.config/opencode/commands/doc-align.md

非互動：`opencode run --command doc-align "sync --dry-run --range origin/main...HEAD"`
（參數整段加引號，否則 `--range` 會被 opencode 自己吃掉）。`opencode run` 偶爾會在
讀完 playbook 後停住，`opencode run --continue "繼續"` 即可接續。

疑難排解：非互動模式讀取專案外目錄被自動拒絕時，在 `~/.config/opencode/opencode.json`
放行 skill 目錄：

    {
      "$schema": "https://opencode.ai/config.json",
      "permission": {
        "external_directory": { "~/.claude/skills/doc-align/**": "allow" }
      }
    }

公司內部 OpenAI-compatible gateway 的 provider 設定寫在同一個檔即可（與 CI 範本相同）：

    "provider": {
      "internal": {
        "npm": "@ai-sdk/openai-compatible", "name": "Internal LLM",
        "options": { "baseURL": "https://llm.internal/v1", "apiKey": "{env:DOC_ALIGN_LLM_API_KEY}" },
        "models": { "your-model-id": { "name": "your-model-id" } }
      }
    }

然後 `opencode -m internal/your-model-id`。

### 不支援 Agent Skills 的 agent

clone 到固定位置，`export DOC_ALIGN_ROOT=/abs/path/doc-align`，
然後直接給它一句 prompt：

    讀取 $DOC_ALIGN_ROOT/playbook/check.md 並完全遵循其步驟；<SCRIPTS> 為
    $DOC_ALIGN_ROOT/scripts；以目前 repo 為對象執行 check --range origin/main...HEAD。

這也就是 CI 範本裡餵給 opencode／claude 的那句話。子命令換 playbook 檔名即可。
若該 agent 有專案目錄外讀取的權限沙箱（opencode 有、Claude Code 的 `-p` 要
`--dangerously-skip-permissions`），要先對 doc-align 目錄放行，否則第一步讀
playbook 就會被擋。

**公司電腦**：完整流程見下方「[公司內網部署（step by step）](#公司內網部署step-by-step)」。

## 公司內網部署（step by step）

從零到 GitLab Pages 的完整順序。前提：內網機器有 Node ≥ 18＋git。

**STEP 0｜把東西帶進內網**（在能連公網的機器準備；內網本來就 clone 得到 GitHub 就跳過）

    git clone https://github.com/iamyugachang/doc-align        # 之後推到內部 GitLab 當鏡像
    curl -L -o mermaid.min.js https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js
    # mermaid 也可在內網從內部 npm registry 取：npm pack mermaid → 解開拿 dist/mermaid.min.js

**STEP 1｜裝工具**（內網）

    git clone <內部鏡像>/doc-align && cd doc-align && npm link
    doc-align --help          # 出現用法說明就裝好了

    # 想在 Claude Code／opencode／pi 裡當 skill 用（可跟 CLI 並存）：
    git clone <內部鏡像>/doc-align ~/.claude/skills/doc-align

**STEP 2｜設 LLM 並體檢**——**只有獨立 CLI／CI 需要這步**。在 harness 裡當 skill 用
（Claude Code／opencode／pi 的 `/doc-align …`）時 **LLM 就是 harness 自己**，不需要
`DOC_ALIGN_LLM_*`、不需要 doctor，整步跳過。（還沒有 key → 也先跳到 STEP 3，走零憑證路線）

    mkdir -p ~/.config/doc-align
    cat > ~/.config/doc-align/env <<'EOF'
    DOC_ALIGN_LLM_BASE_URL=https://你的內部gateway/v1
    DOC_ALIGN_LLM_API_KEY=xxx
    DOC_ALIGN_LLM_MODEL=模型id
    EOF
    chmod 600 ~/.config/doc-align/env
    doc-align doctor          # 逐項體檢；哪裡❌就照後面附的提示排查（proxy／憑證／路徑）
                              # 「tools 被拒」＝agent 模式不可用，check 改跑 --direct，其他照常

**STEP 3｜目標 repo：手動 lane 跑起來**

    cd <目標 repo>
    cp <STEP 0 的 mermaid.min.js> docs/mermaid.min.js   # 圖離線渲染的關鍵，放一次就好
    doc-align render          # repo 已有文件集時：零 LLM，先驗整條路通
    # 瀏覽器開 docs/handbook.html：圖有畫出來、側欄有 branch＋commit 就對了

    doc-align init            # repo 還沒有文件集才跑（需 STEP 2 的 LLM；或在有 LLM 的
                              # 環境如 Claude Code 裡跑 /doc-align init 再帶進來）
    doc-align sync --dry-run  # 日常：看 drift 報告 → 裁決 → doc-align sync 更新文件

**STEP 4｜接 GitLab Pages（零憑證即可）**

前提：instance 有開 Pages——專案側欄看得到 **Deploy → Pages** 即可；沒有就請 admin
開 `pages_external_url`，開通前可先用 job artifact（下載 `public/` 本地開）過渡。

    cp <doc-align>/ci/doc-align-nightly-gitlab.yml <目標 repo>/.gitlab/doc-align-nightly.yml
    # .gitlab-ci.yml 加上（沒有這個檔就建一個只含這段的）：
    #   include:
    #     - local: '.gitlab/doc-align-nightly.yml'

GitLab UI → Settings → CI/CD → Variables：

| Variable | 值 |
|---|---|
| `DOC_ALIGN_REPO_URL` | 內部鏡像的 clone URL |
| `DOC_ALIGN_PAGES_REFS` | 要發佈的 branch 白名單（空白分隔；不設＝default branch） |
| `DOC_ALIGN_PAGES_ON_PUSH` | `true`——docs/ 有變動的 push 自動重新發佈 |

commit＋push 後 UI 手動 **Build → Pipelines → Run pipeline** 跑一次，成功後
**Deploy → Pages** 頁面就有網址。此時 drift 狀態顯示「未設定」＝正常，handbook
照常可看；本地 sync → push → Pages 自動更新，手動 lane 閉環完成。

**STEP 5｜拿到 key 後升級 nightly**（yml 不用改）

    # Variables 再加三個（與 STEP 2 同值）：
    #   DOC_ALIGN_LLM_BASE_URL／DOC_ALIGN_LLM_API_KEY（勾 Masked）／DOC_ALIGN_LLM_MODEL
    # UI → Build → Pipeline schedules → New：cron `0 0 * * *`、Timezone Asia/Taipei、
    #   target branch＝default branch
    # 手動 Run pipeline 驗證一次：Pages 的 drift 狀態出現真的 ✅ 綠／⚠ 橘

卡住時把 `doc-align doctor` 的輸出或 CI job log 整段貼出來排查即可。

## 用法

兩個主命令（skill 模式前面加 `/`，CLI 模式直接打）：

| 命令 | 做什麼 |
|---|---|
| `doc-align init [--repair] [--ci] [--style lean\|rich]` | 探索 repo → 決定文件集 → 寫文件＋manifest → 自檢 → **自動生成 `docs/handbook.html`**。`--repair`＝只重建損壞的 manifest；`--ci`＝順便偵測 GitHub／GitLab remotes 裝 CI 範本並列出待設的 secrets／variables；`--style`＝文件密度，預設 `lean`（圖優先，文字只寫圖說不了的條件／邊界／例外，段落有行數與條數上限），`rich` 放寬 |
| `doc-align sync [--dry-run] [--range <git range> \| --full]` | 偵測 drift → 請你裁決（文件過時 vs 程式碼可疑）→ 更新文件 → 推進 manifest → **自動 render**。`--dry-run`＝只輸出 drift 報告、不寫任何檔案（CI 用這個）；不帶 range＝增量（各文件自 `last_verified` 起算）；`--range origin/main...HEAD`＝PR 範圍；`--full`＝全量重驗 |

`--no-render` 可關掉結尾的自動 render。

別名（進階、舊名，仍可用）：`check` ≡ `sync --dry-run`；`render [--out <path>]` 只重生 handbook（零 LLM；側欄導覽、Mermaid CDN 渲染、深淺色主題）；`configure` ≡ `init --ci` 的 CI 接線段（事後補接用）。想把個別圖重畫成簡報用的品牌風 HTML/PNG，見 `playbook/render.md` 末尾「可選：精緻版單圖」（外部 skill diagram-design，手動、逐張）。

## 文件類型（13 種）

類型決定驗證方法。init 逐型判斷「code 裡有沒有可對照的真相」，沒有就跳過並在報告記明理由——**不硬寫**。

| type | 描述什麼 | 圖／主體 | check 怎麼驗 |
|---|---|---|---|
| `overview` | 系統目的、詞彙表、文件導讀 | 敘事 | 結構性變動時 LLM |
| `architecture` | 模組與外部依賴 | flowchart | 結構性變動時 LLM |
| `use-case` | 功能入口與角色 | use case 圖 | 入口增減時 LLM |
| `sequence` | 一條流程誰呼叫誰（`flows/`） | sequenceDiagram | 沿 call path 逐步 |
| `class` | domain 類別與關係 | classDiagram | symbol 存在性與關係 |
| `db-schema` | 實體 schema＋欄位語意 | erDiagram＋表 | **機械** `schema-diff.js` 對 migrations |
| `state` | 狀態機（訂單／job／連線） | stateDiagram-v2＋狀態表 | 對照 enum／轉移函式 |
| `decision` | 決策／路由邏輯（config 優先序、fallback） | flowchart | 沿 if／match 逐分支 |
| `pipeline` | 每條 DAG 一份：task 級依賴（`pipelines/`） | flowchart＋task 表 | 對照 Airflow／dbt／cron 定義 |
| `layers` | 分層依賴方向 | flowchart＋層級表 | **機械** `deps-check.js` 掃 import 圖 |
| `deployment` | 部署拓樸、信任邊界、對外入口 | flowchart subgraph＋元件表 | 對照 docker-compose／k8s／terraform |
| `permissions` | 角色×資源矩陣 | 表格 | 對照 RBAC／decorator／policy |
| `api` | endpoint 目錄 | 表格 | 對照 router 註冊 |

後七種為 2026-08 擴充；篩選標準是「能對照 code 驗證＋Mermaid／表格寫得出來」，策略／專案／圖表類（timeline、gantt、radar…）不是 code 真相，不進核心。

## 安裝原理

repo 根即 skill：SKILL.md 與 `playbook/`、`scripts/` 同層，符合 Agent Skills 標準的
自包含佈局（skill 內附帶資源以相對路徑引用）。因此 **clone 下來的整個 repo 就是安裝
本體**，clone 進 skills 目錄即完成安裝，`git pull` 即完成更新——無 symlink、無
realpath 反查、無複製 scripts。舊版（≤0.2.0 初期）的
`ln -sfn adapters/claude-code ~/.claude/skills/doc-align` 裝法已淘汰；
既有安裝改成 `rm ~/.claude/skills/doc-align && git clone … ~/.claude/skills/doc-align`
（或把 symlink 改指 repo 根——SKILL.md 相對路徑會穿透 symlink，仍可用）。

## CI（GitHub Actions／GitLab CI，PR／MR 留言）

目標 repo 必須已完成 doc-align init（存在 docs/.docalign.yml），否則閘門會在每個 PR 上報錯。

建議直接跑 `/doc-align configure`（自動偵測平台並安裝範本）。手動安裝：

三種 LLM runner 範本，依環境選一：

| 範本 | runner | 特性 |
|---|---|---|
| `ci/doc-align-direct.yml` | 無（script 直接打 OpenAI-compatible `chat/completions`） | 零 agent 依賴、只需 BASE_URL／API_KEY／MODEL、任何 gateway 皆可；LLM 只看 script 打包的內容（文件＋range 內相關 diff＋證據片段）。設 Variable `DOC_ALIGN_LLM_RUNNER=agent` 改走內建 agent loop（`bin/doc-align.js`，同一組憑證，模型可自行讀檔／grep／看 diff；需 gateway 支援 tool calling） |
| `ci/doc-align-opencode.yml` | opencode（agent） | 可自由探索 code；PROVIDER 選公開 provider 或 BASE_URL 接自建 gateway |
| `ci/doc-align-claude.yml` | claude CLI（agent） | 固定 Anthropic |

`ci/doc-align-gitlab.yml` 同時內建 direct（預設）／agent／opencode／custom 四種 runner，以 `DOC_ALIGN_LLM_RUNNER` 切換；`ci/doc-align-direct.yml` 設了 Variable `DOC_ALIGN_LLM_CUSTOM_CMD` 也會改跑 custom。custom＝你自己的 harness，見下方「自帶 harness」。

**GitHub Actions**：把上表其一複製到目標 repo 的
`.github/workflows/doc-align.yml`，並設定：

1. Secret `DOC_ALIGN_LLM_API_KEY`（中立命名——claude 範本固定 Anthropic key；opencode 範本配 Variables `DOC_ALIGN_LLM_PROVIDER`／`DOC_ALIGN_LLM_MODEL`［／`DOC_ALIGN_LLM_BASE_URL`］可自由用各家 token）。
2. doc-align repo 若為 private：Secret `DOC_ALIGN_TOKEN`（read 權限 PAT），
   並依範本內註解調整 clone URL。

**GitLab CI（公司內部／OpenAI-compatible LLM）**：把 `ci/doc-align-gitlab.yml` 複製到
目標 repo 的 `.gitlab/doc-align.yml`，`.gitlab-ci.yml` 以 `include: - local:
'.gitlab/doc-align.yml'` 引用，並在 CI/CD Variables 設定
`DOC_ALIGN_LLM_BASE_URL`／`DOC_ALIGN_LLM_API_KEY`／`DOC_ALIGN_LLM_MODEL`（內部
OpenAI-compatible gateway）與 `DOC_ALIGN_GITLAB_TOKEN`（api scope，發 MR note）；
內網連不到 GitHub 時另設 `DOC_ALIGN_REPO_URL` 指向 doc-align 內部鏡像。

### Nightly＋Pages（single source of truth）

MR check 擋在 merge 前但要快，nightly 驗證並公示——兩者互補，
也可以只用 nightly（MR 上保留零 LLM 的機械層，LLM check 全部移到夜裡）。

一個 repo 一個 Pages 站，但**站內以子路徑分 branch**——要發佈哪些 branch 由
Variable `DOC_ALIGN_PAGES_REFS`（空白分隔白名單，未設＝只發 default branch）決定，
文件集不必 merge 進 main（main 只需要 workflow 檔本身）：

    https://<user>.github.io/<repo>/                ← 索引頁（各 branch＋drift 狀態）
    https://<user>.github.io/<repo>/<branch-slug>/  ← 該 branch 的 handbook
    https://<user>.github.io/<repo>/<branch-slug>/drift.json  ← badge endpoint

| 範本 | 平台 | 安裝 |
|---|---|---|
| `ci/doc-align-nightly-github.yml` | GitHub Actions＋GitHub Pages | 複製到 `.github/workflows/doc-align-nightly.yml`；repo Settings → Pages → Source 選 "GitHub Actions"。cron 已設 16:00 UTC＝台灣午夜 |
| `ci/doc-align-nightly-gitlab.yml` | GitLab CI＋GitLab Pages | 複製到 `.gitlab/doc-align-nightly.yml` 並 include；**另需在 UI 建 schedule**（CI/CD → Schedules，cron `0 0 * * *`、Timezone Asia/Taipei）——GitLab 的排程只能在 UI／API 建 |

憑證與 MR 版同一組 `DOC_ALIGN_LLM_*`；沒設憑證也能跑（只發佈 handbook，drift
狀態顯示「未設定」）。每晚產出：

- **Pages 首頁**＝handbook（provenance 標示 branch＋commit＋時間）＋側欄 drift
  狀態 chip（綠＝無 drift／橘＝待裁決）＋「Drift 報告」節全文
- `/drift-report.md` 原始報告、`/drift.json` badge——README 可貼
  `https://img.shields.io/endpoint?url=<pages URL>/drift.json`

drift check 走 `--incremental`：各文件自 manifest 的 `last_verified` 起算，所以
**drift 在有人跑 sync 裁決前每晚都會再出現**，不會被「今天沒 commit」蓋掉；裁決後
manifest 推進，隔天自然轉綠。手動觸發可選 full 模式（agent loop 全量重驗，需
gateway 支援 tool calling）。

**分階段採用（LLM 憑證可以晚點再給）**：階段 1 零憑證——裝好範本後手動觸發（GitLab
另可設 `DOC_ALIGN_PAGES_ON_PUSH=true` 讓 docs/ 有變動的 push 自動發佈），CI 只做零
LLM 的 render（確定性，跟本地 skill 生的 handbook 相同）；手動 lane 在本地 sync、
push 後 Pages 即更新。階段 2 拿到憑證後設 `DOC_ALIGN_LLM_*`＋建 schedule，yml 不用改。

**自建 GitLab**：instance 需由 admin 啟用 Pages（`pages_external_url`）——專案側欄
有 Deploy → Pages 即可用，網址也在那頁；沒開就先用 job artifact 過渡。

**離線 Mermaid（內網建議直接 vendor）**：handbook 預設從 jsdelivr CDN 載 mermaid，
內網連不到時圖會以原始碼顯示。把單檔 UMD 版放進目標 repo 一次即可完全離線：

    curl -L -o docs/mermaid.min.js https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js
    # 內網改從內部 npm registry 取：npm pack mermaid 解開後拿 dist/mermaid.min.js

`docs/mermaid.min.js` 存在時 render **自動偵測改用它**（本地、CI、Pages 皆同；輸出
到別處時會一併複製到 handbook 旁），完全不碰 CDN、零設定。不想 vendor 也可設
`DOC_ALIGN_MERMAID_URL`／`render --mermaid-url` 指向內部鏡像 URL（`.mjs`＝ESM
import、其他＝classic script 載入）。

同一 repo 同時推 GitHub 與內部 GitLab 時，兩份 CI 檔一起進版控即可——
GitHub 只讀 `.github/workflows/`、GitLab 只讀 `.gitlab-ci.yml`，互不干擾。

### 自帶 harness（`DOC_ALIGN_LLM_RUNNER=custom`）

不想用內建的 direct 單次打包，也不想裝 opencode／claude，而是自己寫 LLM 流程
（純 Python script、LangGraph、Pydantic AI、內部 agent 平台……）時，把中段換掉即可。
範本仍負責前段（clone 工具、`ci-gate.js` 閘門、`mermaid-check.js` lint）與後段
（PR／MR 留言 upsert），中段執行你給的一行指令。

設定：GitLab 設 `DOC_ALIGN_LLM_RUNNER=custom`＋`DOC_ALIGN_LLM_CUSTOM_CMD`；
GitHub direct 範本只需 Variable `DOC_ALIGN_LLM_CUSTOM_CMD`（非空即切換）。指令以
`sh -c` 執行，cwd＝目標 repo 根，環境為 `node:20`／`ubuntu-latest`＋node 20——需要
其他 runtime（如 python）請在指令內自行安裝或改 image，例如
`pip install -q -r tools/requirements.txt && python3 tools/doc_drift.py`。

契約——你的指令可讀到這些 env，且必須寫出報告：

| env | 意義 |
|---|---|
| `DOC_ALIGN_DIR` | doc-align 工具目錄（`scripts/`、`scripts/lib/`、`playbook/`） |
| `DOC_ALIGN_RANGE` | 本 PR／MR 的 git range（`origin/<target>...HEAD`） |
| `DOC_ALIGN_GATE` | `ci-gate.js` 的 JSON 輸出檔（`affectedDocs`／`changedDocs`／`range`） |
| `DOC_ALIGN_REPORT` | **必須寫出**的 markdown 報告路徑；空檔或指令非零結束 → fail job（設定錯誤，不是 drift） |
| `DOC_ALIGN_LLM_BASE_URL`／`_API_KEY`／`_MODEL` | 原樣透傳，要不要用隨你 |

可重用的零件（都是零依賴、純函數或 CLI，見上方 scripts 表）：
`changed-scope.js --range $DOC_ALIGN_RANGE`／`manifest.js read` 拿受影響文件與 watch；
`scripts/lib/check-context.js` 的 `extractCitations`／`sliceLines`／`buildCheckPrompt`
／`buildSystemPrompt`＋`extractReportFormat`（從 `playbook/check.md` 抽報告格式，
讓 MR 上的報告與 direct 版長得一樣）；`scripts/lib/llm-client.js` 的
`llmConfigFromEnv`／`chatComplete`。Python 端最省事是 `subprocess` 呼叫上述 CLI 拿
JSON，prompt 打包邏輯照 `check-context.js` 移植。

什麼時候值得自己包：要 agent 迴圈讓模型自己再去讀相關檔／找 callers（direct 只看
事先打包的內容）、要多步驟（先分類 diff → 只深查相關段 → 彙整）、gateway 不是
OpenAI-compatible、或要接自家 tracing／eval。

行為：PR 未觸及任何 watch 範圍時零成本跳過；有觸及時執行 check 並以單一留言
（upsert）回報 drift；**永不 fail job**——drift 是資訊，不是門檻。
變動到 docs/ 內文件的 PR 一律先跑零成本的 Mermaid 語法檢查，語法錯誤會 fail
job（這是 lint，不是 drift 報告）。
尚未在真實 PR 上 live 驗證；首次啟用請開一個測試 PR 確認留言流程。

## 進階：直接呼叫 scripts（不經 agent）

`scripts/` 全是零依賴 Node.js（ESM），可在 repo 根直接執行；CI 範本內部就是串這些。
輸出一律 JSON 到 stdout，方便自己接 pre-commit、cron 或其他 agent。

| script | 用途 | 用法 |
|---|---|---|
| `mermaid-check.js` | Mermaid 區塊啟發式 lint（括號平衡、未閉合字串、CJK 混寬括號）＋**複雜度預算**（節點／邊／生命線／狀態數，超過出 warning；取自 diagram-design） | `node scripts/mermaid-check.js [--strict-budget] <file.md>...`；語法錯 exit 1，預算只警告（`--strict-budget` 才 fail） |
| `schema-diff.js` | erDiagram 對 SQL migrations 的表／欄位差異 | `node scripts/schema-diff.js --doc docs/db-schema.md --sql <file-or-dir>` |
| `deps-check.js` | layers 文件的分層依賴機械驗證：掃 Python／JS/TS import 圖，對照層級表＋flowchart 允許邊，列反向依賴 | `node scripts/deps-check.js --doc docs/layers.md [--py-root <dir>]` |
| `changed-scope.js` | 依 manifest watch 算出受影響文件（增量／`--range`／`--full`） | `node scripts/changed-scope.js [--range <git range>] [--full]` |
| `ci-gate.js` | PR 廉價閘門：`skip`、`affectedDocs`、`changedDocs`（docs 內變動的 .md） | `node scripts/ci-gate.js --base <ref>` |
| `llm-check.js` | direct 模式 drift check：打包文件＋diff＋證據片段直打 OpenAI-compatible API | `node scripts/llm-check.js (--range <git range> \| --incremental) [--out <path>]`；`--incremental`＝各文件自 `last_verified` 起算（nightly 用）；env `DOC_ALIGN_LLM_BASE_URL`／`_API_KEY`／`_MODEL`［／`_MAX_CHARS`／`_TIMEOUT_MS`］ |
| `../bin/doc-align.js` | 獨立 CLI（agent loop；見上方「安裝（獨立 CLI）」） | `node bin/doc-align.js init\|sync [--dry-run] …`（別名 check／render／configure）；agent 零件在 `scripts/lib/agent-{loop,tools,prompt}.js`，可被自帶 harness 重用 |
| `llm-doctor.js` | 封閉環境部署前診斷：Node／git／env／gateway 的 chat 與 tools 相容性，附排查提示 | `node scripts/llm-doctor.js`（＝`doc-align doctor`）；chat 探測失敗 exit 1 |
| `manifest.js` | 讀寫 `docs/.docalign.yml` | `read`／`add-doc --doc <p> --type <t> --watch <glob>...`／`set-watch`／`set-verified --doc <p> --commit <sha>` |
| `render-handbook.js` | 單頁 HTML handbook（含 branch＋commit＋時間 provenance；可嵌 drift 報告與狀態 chip） | `node scripts/render-handbook.js [--out <path>] [--branch <name>] [--drift-report <md>]` |
| `generate-doc-set.js` | 依 JSON spec 一次寫出文件集＋manifest（init 內部使用） | `node scripts/generate-doc-set.js --spec <path\|-> [--docs-dir docs] [--force] [--commit <sha>]` |

pre-commit 範例（只跑機械層、零 LLM）：

    #!/bin/sh
    files=$(git diff --cached --name-only --diff-filter=d -- 'docs/**/*.md' 'docs/*.md')
    [ -z "$files" ] || node /path/to/doc-align/scripts/mermaid-check.js $files

## 安全性與供應鏈審查（拉進公司 repo 前）

- **零 runtime 依賴**：`package.json` 沒有 `dependencies`／`devDependencies`，只用 Node 內建模組；
  `package-lock.json` 只含 root package，`npm audit` 恆為 0 vulnerabilities（自身 CI 每次 push 跑
  `npm test` ＋ `npm audit --audit-level=low`，Node 18／20／22）。沒有 npm 套件就沒有 npm CVE 面。
- **不用 `eval`／`new Function`**；唯一的動態執行點是 (a) CLI 的 `shell` 工具——預設關閉，需
  `--allow-shell` 明確打開；(b) CI 的 `custom` runner——執行的是**你自己**設在 CI Variable 的指令。
- **agent 模式的工具沙箱**（`scripts/lib/agent-tools.js`）：`sync --dry-run`（check）完全唯讀；寫檔只在
  init／sync／configure 開放且限 repo 內或系統暫存目錄（`.git/` 也擋）；`git` 只放行唯讀子命令
  白名單，且再擋 `--output`／`-O`／`--ext-diff`／`--no-index`、`remote add…`、`branch <name>`
  等會寫入或執行外部程式的旗標；`run_script` 只能跑 doc-align 自家 scripts。設計前提是
  **repo 內容可能夾帶 prompt injection**，模型即使被誘導也無法越權。
- **對外連線**只有你設定的 `DOC_ALIGN_LLM_BASE_URL`（LLM）與 CI 內的 GitHub／GitLab API
  （貼留言）。無遙測、無自動更新。
- 兩個可選的外部來源，公司政策不允許就避開：(1) CI 的 `opencode`／`claude` runner 會
  `curl | bash` 或 `npm install -g` 安裝 agent CLI——用 `direct`／`agent` runner 就完全不需要；
  (2) `render` 產出的 handbook 在瀏覽器端從 jsdelivr CDN 載入 mermaid.js 畫圖（離線時顯示原始碼），
  不影響 CLI／CI 本身；內網把 UMD 單檔放進目標 repo 的 `docs/mermaid.min.js` 即自動改用（零 CDN），
  或設 `DOC_ALIGN_MERMAID_URL` 指內部鏡像。
- 內網拉不到 GitHub：clone 一份到內部 GitLab 當鏡像，CI 設 `DOC_ALIGN_REPO_URL`，CLI 直接 clone
  鏡像後 `npm link`；整個工具就是這個 repo，沒有其他下載步驟。

## 已知限制

- manifest 格式（工具維護，一般不需手動編輯）。格式是嚴格子集（縮排固定、`path` 必須是每個 entry 的第一個 key）：

      docs:
        - path: flows/refund.md
          type: sequence
          watch:
            - src/billing/**
          last_verified: a1b2c3d
        - path: db-schema.md
          type: db-schema
          watch:
            - migrations/**

  `type` 必須是 `architecture`、`use-case`、`sequence`、`class`、`db-schema`、`overview`、`state`、`decision`、`pipeline`、`layers`、`deployment`、`permissions`、`api` 之一；`watch` 與 `last_verified` 可省略（新文件尚未驗證過時）。
- schema-diff 只支援 SQL migrations（CREATE TABLE / ALTER ADD·DROP COLUMN / DROP TABLE），其他格式由 agent 語意分析 fallback
- mermaid-check 是啟發式結構檢查，非完整語法驗證
