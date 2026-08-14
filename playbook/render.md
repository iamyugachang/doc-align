# doc-align render — handbook 生成程序

你是執行 doc-align render 的 agent。目標：把 manifest 管理的文件集渲染成單頁
HTML handbook（側欄導覽、Mermaid 圖、深淺色主題），供人一站式閱讀與分享。
`<SCRIPTS>` 由呼叫端提供。

參數：`--out <path>`＝自訂輸出路徑（預設 `docs/handbook.html`）。

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
