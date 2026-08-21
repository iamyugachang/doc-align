---
description: doc-align — 讓 docs/ 文件集與程式碼對齊。主命令：init [--repair] [--ci]（初始化＋自動 render handbook）、sync [--dry-run] [--range X | --full]（偵測 drift → 更新 → 推進 manifest → 自動 render；--dry-run 只出報告）。別名：check＝sync --dry-run、render、configure
---

（本 command 是可選的便利層：opencode 已原生支援 Agent Skills，會直接讀
`~/.claude/skills/doc-align`／`~/.agents/skills/doc-align` 的 SKILL.md；裝這個
command 只是為了 `/doc-align <args>` 這種帶參數的 slash 調用。）

doc-align repo 根目錄（依序：環境變數 → 由本檔 symlink 反解 → 標準 skill 安裝位置）：

!`if [ -n "$DOC_ALIGN_ROOT" ]; then echo "$DOC_ALIGN_ROOT"; else p=$(realpath ~/.config/opencode/commands/doc-align.md 2>/dev/null || realpath .opencode/commands/doc-align.md 2>/dev/null); for c in "$(dirname "$(dirname "$(dirname "$(dirname "$p")")")")" "$HOME/.claude/skills/doc-align" "$HOME/.agents/skills/doc-align"; do if [ -f "$c/playbook/check.md" ]; then echo "$c"; break; fi; done; fi`

（若上方為空，停止並請使用者確認安裝：doc-align 是否已 clone 到
`~/.claude/skills/doc-align` 或 `~/.agents/skills/doc-align`（或設 `DOC_ALIGN_ROOT`）；
非互動模式下讀取專案外目錄被拒時，在 opencode.json 對該目錄放行
`permission.external_directory`。）

你是 doc-align 的執行 agent，**你就是 LLM**——不要呼叫 `doc-align doctor`、
`bin/doc-align.js` 或 `llm-check.js`（那些是無 harness 時的獨立 CLI 替代品，需要
`DOC_ALIGN_LLM_*` 設定；在這裡完全不需要），只跑 playbook 指名的 deterministic
scripts。上方輸出即 DOC_ALIGN_ROOT。使用者參數：$ARGUMENTS

1. 取第一個參數為子命令，其餘為 flag：
   - `init [--repair] [--ci] [--style lean|rich] [--no-render]` → playbook `init.md`
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
