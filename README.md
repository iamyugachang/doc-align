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

之後在 opencode 內使用 `/doc-align check|sync|init`。
（尚未在真機驗證——安裝後請先跑一次 `/doc-align check` 確認 repo 根解析正確。）

## 用法

- `/doc-align check` — 增量 drift 偵測（各文件自 `last_verified` 起算）
- `/doc-align check --full` — 全量重驗
- `/doc-align check --range origin/main...HEAD` — 指定範圍（PR 情境）
- `/doc-align sync` — 套用文件更新並推進 manifest
- `/doc-align init` — 從零 bootstrap 文件集與 manifest
- `/doc-align init --repair` — manifest 損壞時重建
- `/doc-align render [--out <path>]` — 把文件集渲染成單頁 HTML handbook（預設 `docs/handbook.html`：側欄導覽、Mermaid 圖 CDN 渲染、深淺色主題；零 LLM 成本）
- `/doc-align configure` — 初次接入：偵測 repo 的 GitHub／GitLab remotes，安裝對應 CI 範本並列出待設定的 secrets/variables 清單

## 安裝原理

symlink 不是只裝 SKILL.md：`~/.claude/skills/doc-align` 指向 repo 內的
`adapters/claude-code/`，SKILL.md 執行時用 `realpath` 穿透 symlink 找回 repo 根，
再以絕對路徑取用 `playbook/` 與 `scripts/`。因此 **clone 下來的整個 repo 就是安裝
本體**，`git pull` 即完成更新。換機器＝`git clone` + `ln -sfn`，無需複製 scripts。

## CI（GitHub Action，PR 留言）

目標 repo 必須已完成 doc-align init（存在 docs/.docalign.yml），否則閘門會在每個 PR 上報錯。

建議直接跑 `/doc-align configure`（自動偵測平台並安裝範本）。手動安裝：

**GitHub Actions**：把 `ci/doc-align-claude.yml`（或 opencode 版）複製到目標 repo 的
`.github/workflows/doc-align.yml`，並設定：

1. Secret `ANTHROPIC_API_KEY`（LLM 步驟用）。
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

行為：PR 未觸及任何 watch 範圍時零成本跳過；有觸及時執行 check 並以單一留言
（upsert）回報 drift；**永不 fail job**——drift 是資訊，不是門檻。
變動到 docs/ 內文件的 PR 一律先跑零成本的 Mermaid 語法檢查，語法錯誤會 fail
job（這是 lint，不是 drift 報告）。
尚未在真實 PR 上 live 驗證；首次啟用請開一個測試 PR 確認留言流程。

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
