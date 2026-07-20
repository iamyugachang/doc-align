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
