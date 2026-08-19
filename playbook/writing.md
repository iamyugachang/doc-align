# doc-align 寫作心法 — 文件是給人看的

本檔是 init／sync 寫文件時的**寫作規範**，從幾套業界公認的文件方法蒸餾而來（來源見末尾）。
它不是流程（流程在 init.md／sync.md），而是每一段、每一張圖、每一句話的判準。
與 init.md 步驟 5 的「密度原則」互補：密度原則管**多少**，本檔管**怎麼寫才看得懂**。

## 1. 先想讀者，再想內容（arc42 §1）

- 每份文件開頭的「目的與情境」要回答三個問題：**誰會讀**（PM／新進工程師／on-call）、
  **讀完要能做什麼**（回答商業規則？定位要改哪個模組？）、**誰觸發、產出給誰**。
- overview 的系統目的一段要點名主要讀者與他們在乎的品質目標（正確性／延遲／可維護性…，
  挑 1–3 個），後面每份文件的取捨才有依據。
- 想像讀者**沒有打開 code**。文件要能獨立回答問題；需要「去看 code 才懂」的句子重寫。

## 2. 一張圖一個層級、一個問題（C4）

- 每張圖只回答一個問題、停在一個抽象層級：Context（系統與外部世界）、Container（可部署
  單元／服務）、Component（模組）、Code（類別／函式）。不要在同一張圖同時畫「服務」
  和「函式」。architecture 通常是 Context＋Container 兩張，不是一張塞滿。
- **每個 box 三件事**：名稱、技術（語言／框架／儲存）、一句職責。Mermaid 寫法：
  `svc[訂單服務<br/>FastAPI<br/>接單與狀態推進]`；純名稱的 box 視為未完成。
- **每條箭頭要標文字**：做什麼、走什麼（`-->|HTTP POST /orders|`、`-->|讀取|`）。
  沒有標籤的箭頭讀者無法判斷方向意義。
- 圖例：用到顏色／虛線／形狀區分時，圖下方一行說明；只有一種樣式就不要圖例。
- 超過 ~12 節點就拆：總覽圖只留模組級節點，細節各自一張。

## 3. 不混象限（Diátaxis）

- doc-align 的文件屬於 **Reference**（圖、表、行為規則——精確、可查）＋ **Explanation**
  （目的與情境、設計決策——為什麼）。**不寫 Tutorial／How-to**（一步一步操作指令）：
  發現自己在寫「先執行 X 再執行 Y」，那是操作手冊，不屬於這裡，最多一句「操作見 README」。
- Reference 段落（規則、表）只陳述事實，不夾解釋；Explanation 段落（目的、決策）講理由，
  不重複事實。同一件事不在兩種段落各講一遍。

## 4. 規則句怎麼寫（Living Documentation＋minimalism）

- 行為規則＝**可驗證的陳述句**：「當 X 時系統會 Y」。一句一個事實，主動語態、現在式、
  有主詞（系統／訂單服務／排程器），每條附 `檔案:行號` 證據。
- 只寫 **evergreen** 的知識：穩定的業務規則、邊界、不變量、例外。會隨版本每週變的細節
  （timeout 數值、buffer 大小）放「實作細節」表格，或乾脆不寫讓讀者看 config。
- 寫「為什麼」比寫「是什麼」值錢：code 已經說了是什麼。規則句若只是把函式名翻成中文，
  刪掉。
- 先講結論再講條件（BLUF）：「拒絕退款——當訂單已出貨超過 30 天」優於「當訂單已出貨
  超過 30 天，系統會……」。

## 5. 設計決策＝迷你 ADR（Nygard）

- 每條決策三件事：**脈絡**（當時的限制）、**決定**、**後果**（換來什麼、放棄什麼）。
  一條 2–4 句，超過就該獨立成 ADR 檔。
- 有替代方案被否決時一句帶過「曾考慮 X，因 Y 放棄」。
- repo 已有 `docs/adr/`／`docs/decisions/` 時**不要重寫**，一句摘要＋連結即可；沒有就寫在
  文件內，標注來源（commit／PR／spec 路徑），推測要標【推測】。
- 決策可能被取代：寫明日期或 commit，讓讀者判斷是否仍有效。

## 6. 句子與用詞（Google developer documentation style guide／Good Docs）

- 一句一個想法；長句拆成兩句。段落 ≤4 句。
- 術語全文一致，且與 overview 詞彙表一致；同一概念不要一下叫「工單」一下叫「任務」。
  code 裡的識別字用反引號原文（`OrderStatus.SHIPPED`），不翻譯。
- 避免「可能」「應該」「通常」這類沒有證據的模糊詞；不確定就標【未驗證】或不寫。
- 不寫「顯然」「簡單地」「只需要」——對不知道的人不顯然。
- 中文與英數之間不需要硬加空格，但括號、冒號、頓號用全形；Mermaid 標籤內的括號一律
  全形（ASCII 括號會破壞語法）。

## 7. 寫完自問（發布前 checklist）

1. 讀者沒開 code 能回答「這個流程在什麼條件下做什麼」嗎？
2. 每張圖：一個層級？每個 box 有技術與職責？每條箭頭有標籤？≤12 節點？
3. 有沒有任何一段在重述圖或表已經講的事？有就刪。
4. 有沒有操作步驟混進來？有就移走。
5. 每條規則有證據、是陳述句、講的是穩定的事實？
6. 設計決策每條有脈絡／決定／後果？沒有決策就整段刪掉。
7. 術語與 overview 詞彙表一致？

## 來源

- arc42（Gernot Starke／Peter Hruschka）— https://arc42.org ；12 節架構文件模板，每節一個讀者問題。
- C4 model（Simon Brown）— https://c4model.com ；Context／Container／Component／Code 四層，box 與箭頭的標註規則。
- Diátaxis（Daniele Procida）— https://diataxis.fr ；Tutorial／How-to／Reference／Explanation 不混用。
- Living Documentation（Cyrille Martraire, 2019）— 知識在 code、文件盡量生成、evergreen vs. 易變內容、reconciliation。
- Architecture Decision Records（Michael Nygard, 2011）— 脈絡／決定／後果。
- Google developer documentation style guide — https://developers.google.com/style ；The Good Docs Project — https://thegooddocsproject.dev 。
- John Carroll, *The Nurnberg Funnel*（minimalism）— 少即是多、面向任務。
