# doc-align

讓 repo 內的輕量文件集（Mermaid 圖 + 短註）與程式碼保持對齊的工具。
工具只報告差異，由人決定文件過時還是程式碼有問題。

設計文件：docs/superpowers/specs/2026-07-20-doc-align-design.md

## 結構

- `playbook/` — 核心流程指令（agent 無關的 markdown）
- `scripts/` — deterministic Node.js scripts（零依賴）
- `adapters/claude-code/` — Claude Code skill 薄殼
- `tests/` — 單元與整合測試（`npm test`）

## 安裝（Claude Code）

    ln -sfn "$(pwd)/adapters/claude-code" ~/.claude/skills/doc-align

之後在任一 repo 內使用 `/doc-align check` 或 `/doc-align sync`。

## 用法

- `/doc-align check` — 增量 drift 偵測（各文件自 `last_verified` 起算）
- `/doc-align check --full` — 全量重驗
- `/doc-align check --range origin/main...HEAD` — 指定範圍（PR 情境）
- `/doc-align sync` — 套用文件更新並推進 manifest

## 已知限制（Phase 1）

- manifest 需手動建立（`init` 指令在 Phase 2）。格式是嚴格子集（縮排固定、`path` 必須是每個 entry 的第一個 key）：

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

  `type` 必須是 `architecture`、`use-case`、`sequence`、`class`、`db-schema` 之一；`watch` 與 `last_verified` 可省略（新文件尚未驗證過時）。
- schema-diff 只支援 SQL migrations（CREATE TABLE / ALTER ADD·DROP COLUMN / DROP TABLE），其他格式由 agent 語意分析 fallback
- mermaid-check 是啟發式結構檢查，非完整語法驗證
- 尚未支援 opencode（Phase 2）與 CI／PR 留言（Phase 3）
