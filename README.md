# doc-align

讓 repo 內的文件集（Mermaid 圖 + 結構化敘事：目的、行為規則、設計決策、overview 導讀）與程式碼保持對齊的工具。
工具只報告差異，由人決定文件過時還是程式碼有問題。

設計文件：docs/superpowers/specs/2026-07-20-doc-align-design.md

## 結構

- `playbook/` — 核心流程指令（agent 無關的 markdown；check／sync／init／render）
- `scripts/` — deterministic Node.js scripts（零依賴）
- `adapters/claude-code/` — Claude Code skill 薄殼
- `adapters/opencode/` — opencode command 薄殼
- `tests/` — 單元與整合測試（`npm test`）

## 安裝（Claude Code）

    ln -sfn "$(pwd)/adapters/claude-code" ~/.claude/skills/doc-align

之後在任一 repo 內使用 `/doc-align check|sync|init`。

## 安裝（opencode）

    mkdir -p ~/.config/opencode/commands
    ln -sfn "$(pwd)/adapters/opencode/commands/doc-align.md" ~/.config/opencode/commands/doc-align.md

再到 `~/.config/opencode/opencode.json`（或 `.jsonc`）放行 doc-align 目錄——opencode
會把專案目錄以外的讀取視為 `external_directory`，互動模式每次都問、`opencode run`
非互動模式則**直接自動拒絕**，adapter 讀不到 playbook 就會停在第一步：

    {
      "$schema": "https://opencode.ai/config.json",
      "permission": {
        "external_directory": { "/abs/path/to/doc-align/**": "allow" }
      }
    }

之後在 opencode 內使用 `/doc-align check|sync|init|render|configure`；非互動：
`opencode run --command doc-align "check --range origin/main...HEAD"`（參數整段加引號，
否則 `--range` 會被 opencode 自己吃掉）。已在真機驗證（1.18.x，`render` 全程跑通）；
`opencode run` 偶爾會在讀完 playbook 後停住，`opencode run --continue "繼續"` 即可接續。

公司內部 OpenAI-compatible gateway 的 provider 設定寫在同一個檔即可（與 CI 範本相同）：

    "provider": {
      "internal": {
        "npm": "@ai-sdk/openai-compatible", "name": "Internal LLM",
        "options": { "baseURL": "https://llm.internal/v1", "apiKey": "{env:DOC_ALIGN_LLM_API_KEY}" },
        "models": { "your-model-id": { "name": "your-model-id" } }
      }
    }

然後 `opencode -m internal/your-model-id`。

## 安裝（其他 agent：oh-my-pi、Codex、Cursor…）

doc-align 本體是 markdown playbook＋Node scripts，任何能讀檔、跑 shell 的 agent 都能用；
差別只在「怎麼讓 agent 找到 repo 根」：

- **會匯入 `.claude/skills` 的 agent**（oh-my-pi／omp 會，見其 docs/skills.md）：照
  Claude Code 的方式 symlink 到 `~/.claude/skills/doc-align`（或專案內
  `.claude/skills/doc-align`）即可，通常會出現 `/skill:doc-align`。SKILL.md 內建
  fallback：不知道自己被裝在哪時，依序試 `$DOC_ALIGN_ROOT` 環境變數 →
  `~/.claude/skills/doc-align` → `.claude/skills/doc-align`。
- **其他任何 agent**：clone 到固定位置，`export DOC_ALIGN_ROOT=/abs/path/doc-align`，
  然後直接給它一句 prompt：

      讀取 $DOC_ALIGN_ROOT/playbook/check.md 並完全遵循其步驟；<SCRIPTS> 為
      $DOC_ALIGN_ROOT/scripts；以目前 repo 為對象執行 check --range origin/main...HEAD。

  這也就是 CI 範本裡餵給 opencode／claude 的那句話。子命令換 playbook 檔名即可。
- 若該 agent 有專案目錄外讀取的權限沙箱（opencode 有、Claude Code 的 `-p` 要
  `--dangerously-skip-permissions`），要先對 doc-align 目錄放行，否則第一步讀
  playbook 就會被擋。

**公司電腦 checklist**：(1) Node ≥ 18＋git；(2) 能 clone doc-align——內網連不到 GitHub
就先建內部鏡像（CI 的 `DOC_ALIGN_REPO_URL` 同一個）；(3) 上面對應 agent 的 symlink／
`DOC_ALIGN_ROOT`；(4) agent 的專案外讀取權限放行；(5) LLM 走內部 gateway 的 provider
設定；(6) 在目標 repo 跑一次 `/doc-align render`（零 LLM）確認整條路通，再跑 `check`。

## 用法

- `/doc-align check` — 增量 drift 偵測（各文件自 `last_verified` 起算）
- `/doc-align check --full` — 全量重驗
- `/doc-align check --range origin/main...HEAD` — 指定範圍（PR 情境）
- `/doc-align sync` — 套用文件更新並推進 manifest
- `/doc-align init` — 從零 bootstrap 文件集與 manifest
- `/doc-align init --repair` — manifest 損壞時重建
- `/doc-align render [--out <path>]` — 把文件集渲染成單頁 HTML handbook（預設 `docs/handbook.html`：側欄導覽、Mermaid 圖 CDN 渲染、深淺色主題；零 LLM 成本）。想把個別圖重畫成簡報用的品牌風 HTML/PNG，見 `playbook/render.md` 末尾「可選：精緻版單圖」——走外部 skill diagram-design，手動、逐張、非 doc-align 依賴
- `/doc-align configure` — 初次接入：偵測 repo 的 GitHub／GitLab remotes，安裝對應 CI 範本並列出待設定的 secrets/variables 清單

## 安裝原理

symlink 不是只裝 SKILL.md：`~/.claude/skills/doc-align` 指向 repo 內的
`adapters/claude-code/`，SKILL.md 執行時用 `realpath` 穿透 symlink 找回 repo 根，
再以絕對路徑取用 `playbook/` 與 `scripts/`。因此 **clone 下來的整個 repo 就是安裝
本體**，`git pull` 即完成更新。換機器＝`git clone` + `ln -sfn`，無需複製 scripts。

## CI（GitHub Actions／GitLab CI，PR／MR 留言）

目標 repo 必須已完成 doc-align init（存在 docs/.docalign.yml），否則閘門會在每個 PR 上報錯。

建議直接跑 `/doc-align configure`（自動偵測平台並安裝範本）。手動安裝：

三種 LLM runner 範本，依環境選一：

| 範本 | runner | 特性 |
|---|---|---|
| `ci/doc-align-direct.yml` | 無（script 直接打 OpenAI-compatible `chat/completions`） | 零 agent 依賴、只需 BASE_URL／API_KEY／MODEL、任何 gateway 皆可；LLM 只看 script 打包的內容（文件＋range 內相關 diff＋證據片段） |
| `ci/doc-align-opencode.yml` | opencode（agent） | 可自由探索 code；PROVIDER 選公開 provider 或 BASE_URL 接自建 gateway |
| `ci/doc-align-claude.yml` | claude CLI（agent） | 固定 Anthropic |

`ci/doc-align-gitlab.yml` 同時內建 direct（預設）／opencode／custom 三種 runner，以 `DOC_ALIGN_LLM_RUNNER` 切換；`ci/doc-align-direct.yml` 設了 Variable `DOC_ALIGN_LLM_CUSTOM_CMD` 也會改跑 custom。custom＝你自己的 harness，見下方「自帶 harness」。

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
| `mermaid-check.js` | Mermaid 區塊啟發式 lint（括號平衡、未閉合字串、CJK 混寬括號） | `node scripts/mermaid-check.js <file.md>...`；有錯 exit 1 |
| `schema-diff.js` | erDiagram 對 SQL migrations 的表／欄位差異 | `node scripts/schema-diff.js --doc docs/db-schema.md --sql <file-or-dir>` |
| `changed-scope.js` | 依 manifest watch 算出受影響文件（增量／`--range`／`--full`） | `node scripts/changed-scope.js [--range <git range>] [--full]` |
| `ci-gate.js` | PR 廉價閘門：`skip`、`affectedDocs`、`changedDocs`（docs 內變動的 .md） | `node scripts/ci-gate.js --base <ref>`（或 `--range`） |
| `llm-check.js` | direct 模式 drift check：打包文件＋diff＋證據片段直打 OpenAI-compatible API | `node scripts/llm-check.js --range <git range> [--out <path>]`；env `DOC_ALIGN_LLM_BASE_URL`／`_API_KEY`／`_MODEL`［／`_MAX_CHARS`／`_TIMEOUT_MS`］ |
| `manifest.js` | 讀寫 `docs/.docalign.yml` | `read`／`add-doc --doc <p> --type <t> --watch <glob>...`／`set-watch`／`set-verified --doc <p> --commit <sha>` |
| `render-handbook.js` | 單頁 HTML handbook | `node scripts/render-handbook.js [--out <path>]` |
| `generate-doc-set.js` | 依 JSON spec 一次寫出文件集＋manifest（init 內部使用） | `node scripts/generate-doc-set.js --spec <path\|-> [--docs-dir docs] [--force] [--commit <sha>]` |

pre-commit 範例（只跑機械層、零 LLM）：

    #!/bin/sh
    files=$(git diff --cached --name-only --diff-filter=d -- 'docs/**/*.md' 'docs/*.md')
    [ -z "$files" ] || node /path/to/doc-align/scripts/mermaid-check.js $files

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

  `type` 必須是 `architecture`、`use-case`、`sequence`、`class`、`db-schema`、`overview` 之一；`watch` 與 `last_verified` 可省略（新文件尚未驗證過時）。
- schema-diff 只支援 SQL migrations（CREATE TABLE / ALTER ADD·DROP COLUMN / DROP TABLE），其他格式由 agent 語意分析 fallback
- mermaid-check 是啟發式結構檢查，非完整語法驗證
