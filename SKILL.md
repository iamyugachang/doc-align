---
name: doc-align
description: 讓 docs/ 文件集（Mermaid 圖＋結構化敘事）與程式碼對齊。兩個主命令：/doc-align init [--repair] [--ci]（初始化文件集＋manifest，自動生成 HTML handbook）、/doc-align sync [--dry-run] [--range <git range> | --full]（偵測 drift → 裁決 → 更新文件 → 推進 manifest → 自動 render；--dry-run 只出報告）。別名：check＝sync --dry-run、render＝只重生 handbook、configure＝init --ci 的 CI 接線段
compatibility: 需要 git 與 Node.js >= 18；適用任何實作 Agent Skills 標準的 harness（Claude Code、opencode、pi／oh-my-pi、Codex CLI…）
metadata:
  author: iamyugachang
  version: "0.2.0"
---

# doc-align

本檔是薄 adapter，流程細節一律以 playbook 為準，不在此重複。

## 定位 doc-align 目錄

本 skill 目錄**就是 doc-align repo 根**（自包含：`playbook/` 與 `scripts/` 都在本
SKILL.md 旁邊）。`DOC_ALIGN_ROOT` ＝ 本 SKILL.md 所在目錄，直接以它為基準取用：

- playbook 位於 `<DOC_ALIGN_ROOT>/playbook/`
- `<SCRIPTS>` 即 `<DOC_ALIGN_ROOT>/scripts`

若執行環境沒有告訴你本 skill 被裝在哪，依序嘗試，第一個含 `playbook/check.md` 的
即為 DOC_ALIGN_ROOT：

    $DOC_ALIGN_ROOT               # 環境變數優先
    ~/.claude/skills/doc-align    # 全域（Claude Code／opencode 預設讀這裡）
    ~/.agents/skills/doc-align    # 全域（agent 中立位置；pi／opencode 預設讀這裡）
    .claude/skills/doc-align      # 專案內
    .agents/skills/doc-align      # 專案內

（symlink 安裝也可以——相對路徑會穿透 symlink，無需解析真實路徑。）都失敗就停下來
請使用者提供 doc-align repo 路徑（或設定 `DOC_ALIGN_ROOT`），不要猜。確認方式：
`$DOC_ALIGN_ROOT/playbook/check.md` 與 `$DOC_ALIGN_ROOT/scripts/manifest.js` 必須存在。

## 執行

1. 解析使用者參數。第一個字是子命令，其餘為 flag：
   - `init [--repair] [--ci] [--style lean|rich] [--no-render]` → playbook `init.md`
   - `sync [--dry-run] [--range <range> | --full] [--no-render]` → playbook `sync.md`
     （`--dry-run` 時 sync 只做第一步＝check 程序並輸出報告）
   - 別名：`check [--range <range> | --full]` ≡ `sync --dry-run …` → 直接讀 `check.md`；
     `render [--out <path>]` → `render.md`；`configure` → `configure.md`（≡ `init --ci`
     的 CI 接線段，不做初始化）。
   flag 只在上列對應的子命令有效，出現在別處視同不認得。無子命令、子命令無法辨識，
   或出現不認得的參數時，一律視同無法辨識：向使用者說明用法（主打 init／sync）後
   結束。若同時給了 `--full` 與 `--range`，以 `--full` 為準（全量重驗），並向使用者
   說明已忽略 `--range`。
2. 讀取對應的 playbook，完全遵循其步驟執行，以目前所在的 repo 為工作對象。
   init／sync（非 dry-run）結束時 playbook 會要求執行 render-handbook.js 重生
   `docs/handbook.html`——不要省略。
