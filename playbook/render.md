# doc-align render — handbook 生成程序

你是執行 doc-align render 的 agent。目標：把 manifest 管理的文件集渲染成單頁
HTML handbook（側欄導覽、Mermaid 圖、深淺色主題），供人一站式閱讀與分享。
`<SCRIPTS>` 由呼叫端提供。

參數：`--out <path>`＝自訂輸出路徑（預設 `docs/handbook.html`）。

init 與 sync 結束時會自動執行本程序（`--no-render` 可關），使用者通常不需要單獨呼叫；
單獨呼叫 `doc-align render` 是進階用法（只想重生 HTML、零 LLM）。

## 步驟

1. **前置檢查**：確認 repo 根存在 `docs/.docalign.yml`；不存在時停止並告知使用者
   先執行 `doc-align init`。
2. **執行渲染**：`node <SCRIPTS>/render-handbook.js [--out <path>]`，讀取 stdout
   的 JSON 摘要（`{ ok, out, sections, skipped }`）。這是純機械步驟，整個 render
   流程不需要 LLM 分析文件內容。
3. **回報**：告知輸出路徑與 section 數。`skipped` 非空時列出被跳過的 manifest
   條目（檔案不存在），並提醒使用者這通常代表 manifest 與 docs/ 不同步——建議
   跑一次 `doc-align check`；render 本身不裁決 drift。
4. **提醒時效**：handbook 是生成物。若本次對話剛執行過 sync 或文件有更動，
   提醒使用者 handbook 已重新生成；反之若文件很久沒 check，提醒內容以
   manifest 目前狀態為準。是否把 handbook.html 提交進版控由使用者決定，
   render 不執行 git 操作。

## 注意

- Mermaid 圖在瀏覽器端經 CDN（jsdelivr）渲染，離線開啟時顯示原始碼與提示；
  這是刻意取捨——內嵌 mermaid.js 會讓輸出檔膨脹超過 1MB。
- 輸出為完整獨立 HTML 文件（含 doctype 與深淺色 token），除 Mermaid CDN 外
  無其他外部資源。

## 可選：精緻版單圖（diagram-design）

handbook 的 Mermaid 圖是給工程師讀的真相來源，不是簡報素材。若使用者要一張
「給 PM／主管看、放簡報或 handbook 首頁 hero」的品牌風格圖，可以在 render 之外
用外部 skill **diagram-design**（cathrynlavery/diagram-design；需使用者自行安裝，
不是 doc-align 的依賴）對**單張**圖重畫。這是手動、逐張、有 LLM 成本的步驟，
**永不自動執行、永不取代 docs/ 內的 Mermaid 原文**。

適用前提（不符就直接告知不適用，不要硬畫）：

- 目標圖是 `flowchart`／`sequenceDiagram`／`stateDiagram-v2`／`erDiagram` 之一；
  `classDiagram` 其 extractor 不支援。
- 使用者接受「重畫＝重新設計」：diagram-design 的複雜度預算是 ≤9 節點／≤12 箭頭
  （`--detail faithful` 可到 ≤24 但強制分區）。多數 architecture／sequence 文件
  會超額，它會合併群組或丟掉節點——這對簡報是優點，對「文件取代翻 code」是缺點，
  務必先講清楚。

程序：

1. 對目標文件跑 `python3 <diagram-design-dir>/scripts/mermaid_extract.py <doc.md>
   [--diagram N]`，看 `budget:` 行與 `collapsible groups` 決定 detail 檔位。
2. 依 diagram-design 的 import-mermaid 流程設定四個 dial（format／size／detail／
   audience），重畫成獨立 HTML；要 PNG/SVG 再走其 export 流程。
3. 輸出放 `docs/handbook-assets/`（或使用者指定處），**不要**覆寫或改寫 docs/ 內
   的 `.md`；不要動 manifest。
4. 把它回報的 **fidelity ledger**（哪些節點被合併／收攏／丟棄）原樣轉告使用者，
   並提醒：這張圖是衍生物，之後文件經 sync 更新時它不會跟著變，需要時重跑。

不建議在 CI 或 render 內自動化：每張都是 LLM 手繪 SVG，非確定性、需人審
fidelity，與 render「零 LLM、零依賴、機械生成」的定位相反。
