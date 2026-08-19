# 可選外部 skill — 找到就用、沒有就照常

doc-align 本體零依賴、agent 無關；以下第三方 skill **不複製進本 repo**（授權／過時／
綁定特定 harness／會變成第二套真相），只在使用者的 agent 已安裝時作為加分項。
playbook 提到「若有 <skill>」的步驟一律遵守：

1. **偵測**：依序找 `$DOC_ALIGN_SKILLS_DIR/<name>` → `~/.claude/skills/<name>` →
   `~/.hermes/skills/<name>` → 專案內 `.claude/skills/<name>`；都沒有＝不可用。
2. **不可用時**：跳過該加分步驟，照 playbook 主線繼續；在最終報告末尾加一行
   「可選：安裝 <name> 可 <效果>（<安裝指令>）」，不要反覆提醒、不要停下來等。
3. **可用時**：只在 playbook 指定的步驟使用，輸出仍須符合 doc-align 的格式與密度原則；
   它們的建議與 playbook 衝突時以 playbook 為準（尤其：Mermaid 為真相、不混象限、
   不重述圖）。

| skill | 強化哪一步 | 來源 |
|---|---|---|
| diagram-design | （規劃中的 `present`）把 Mermaid 重畫成品牌風 SVG 給簡報；以及 `mermaid_extract.py` 算節點預算提醒拆圖 | https://github.com/cathrynlavery/diagram-design（MIT） |
| developer-docs-framework | init 步驟 5 寫句子時的額外 style 規則（Diátaxis＋27 條規則＋6 套 style guide） | https://github.com/anivar/developer-docs-framework |
| documentation-and-adrs（addy-agent-skills） | 設計決策段要升級成獨立 ADR 檔時的模板與慣例偵測 | addy-agent-skills marketplace |
| arc42-toolkit／clarc arc42-c4 | repo 要求完整 arc42 文件（12 節）時，作為 doc-align 文件集之外的補充產物；不取代 docs/ | https://github.com/MSiccDev/arc42-toolkit ／ https://github.com/marvinrichter/clarc |

心法本身（arc42／C4／Diátaxis／ADR／Google style）已蒸餾在 `playbook/writing.md`，
不需要任何 skill 就會生效。

什麼時候才會把外部東西 vendor 進 repo：MIT／Apache 授權、且是我們要直接呼叫的
**確定性 script**（不是 prompt 文字）、且是核心功能必要——三者同時成立才考慮。
