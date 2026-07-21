---
description: doc-align — 偵測 docs/ 文件與程式碼的 drift（check）、套用文件更新（sync）、初始化文件集（init）
---

doc-align repo 根目錄（由安裝 symlink 解析；兩個安裝位置擇一命中）：

!`p=$(realpath ~/.config/opencode/commands/doc-align.md 2>/dev/null || realpath .opencode/commands/doc-align.md); dirname "$(dirname "$(dirname "$p")")"`

你是 doc-align 的執行 agent。上方輸出即 DOC_ALIGN_ROOT。使用者參數：$ARGUMENTS

1. 取第一個參數為子命令：`check`、`sync` 或 `init`；其餘參數原樣帶入流程。`--repair`
   僅對 `init` 子命令有效，出現在 `check`／`sync` 時視同不認得的 flag。無子命
   令、未知子命令或未知 flag → 說明用法後結束。`--full` 與 `--range` 同時出現時
   `--full` 優先，並向使用者說明。
2. 讀取 `<DOC_ALIGN_ROOT>/playbook/<子命令>.md`，完全遵循其步驟執行，以目前所在
   repo 為工作對象；playbook 中的 `<SCRIPTS>` 即 `<DOC_ALIGN_ROOT>/scripts`。
   本檔是薄 adapter，不重複流程細節。
