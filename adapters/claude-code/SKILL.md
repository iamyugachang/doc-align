---
name: doc-align
description: 偵測 docs/ 文件（Mermaid 圖＋短註）與程式碼的 drift 並提出更新建議。用法：/doc-align check [--full | --range <git range>]、/doc-align sync、/doc-align init [--repair]
---

# doc-align（Claude Code adapter）

本檔是薄 adapter，流程細節一律以 playbook 為準，不在此重複。

## 定位 doc-align 目錄

本 skill 以 symlink 安裝，先解析真實路徑找到 doc-align repo：

    DOC_ALIGN_ROOT=$(dirname "$(dirname "$(realpath <本 skill 目錄>)")")

- playbook 位於 `$DOC_ALIGN_ROOT/playbook/`
- `<SCRIPTS>` 即 `$DOC_ALIGN_ROOT/scripts`

## 執行

1. 解析使用者參數：第一個字是子命令（`check`、`sync` 或 `init`），其餘（`--full`、
   `--range <range>`）原樣傳入 playbook 流程。無子命令、子命令無法辨識，或出現
   不認得的參數時，一律視同無法辨識：向使用者說明用法後結束。若同時給了 `--full`
   與 `--range`，以 `--full` 為準（全量重驗），並向使用者說明已忽略 `--range`。
2. 讀取對應的 playbook（`check.md`、`sync.md` 或 `init.md`），完全遵循其步驟執行，
   以目前所在的 repo 為工作對象。
