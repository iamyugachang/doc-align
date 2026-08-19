---
description: doc-align — 讓 docs/ 文件集與程式碼對齊。主命令：init [--repair] [--ci]（初始化＋自動 render handbook）、sync [--dry-run] [--range X | --full]（偵測 drift → 更新 → 推進 manifest → 自動 render；--dry-run 只出報告）。別名：check＝sync --dry-run、render、configure
---

doc-align repo 根目錄（由安裝 symlink 解析；兩個安裝位置擇一命中）：

!`if [ -n "$DOC_ALIGN_ROOT" ]; then echo "$DOC_ALIGN_ROOT"; else p=$(realpath ~/.config/opencode/commands/doc-align.md 2>/dev/null || realpath .opencode/commands/doc-align.md); dirname "$(dirname "$(dirname "$(dirname "$p")")")"; fi`

（若上方為空或該目錄下沒有 `playbook/`，停止並請使用者確認安裝：symlink 是否存在、
opencode.json 是否已對該目錄放行 `permission.external_directory`——非互動模式下未放行會被自動拒絕。）

你是 doc-align 的執行 agent。上方輸出即 DOC_ALIGN_ROOT。使用者參數：$ARGUMENTS

1. 取第一個參數為子命令，其餘為 flag：
   - `init [--repair] [--ci] [--no-render]` → playbook `init.md`
   - `sync [--dry-run] [--range <range> | --full] [--no-render]` → playbook `sync.md`
     （`--dry-run` 時只做第一步＝check 程序並輸出報告）
   - 別名：`check [--range <range> | --full]` ≡ `sync --dry-run` → 直接讀 `check.md`；
     `render [--out <path>]` → `render.md`；`configure` → `configure.md`（≡ `init --ci`
     的 CI 接線段）。
   flag 只在對應子命令有效，出現在別處視同不認得。無子命令、未知子命令或未知 flag
   → 說明用法（主打 init／sync）後結束。`--full` 與 `--range` 同時出現時 `--full` 優先，
   並向使用者說明。
2. 讀取 `<DOC_ALIGN_ROOT>/playbook/<對應>.md`，完全遵循其步驟執行，以目前所在
   repo 為工作對象；playbook 中的 `<SCRIPTS>` 即 `<DOC_ALIGN_ROOT>/scripts`。
   init／sync（非 dry-run）結束時 playbook 會要求執行 render-handbook.js——不要省略。
   本檔是薄 adapter，不重複流程細節。
