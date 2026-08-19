# doc-align 圖的設計規範 — 取自 diagram-design，落在 Mermaid 上

本檔是 init／sync 畫任何 Mermaid 圖時的**必要規範**（不是可選）。內容從 diagram-design
（cathrynlavery/diagram-design，MIT）的設計哲學、選型表、複雜度預算、語意角色與反模式蒸餾而來，
換算成 Mermaid 能做到的寫法；diagram-design 本身的 SVG 渲染引擎**不在此處**（那是之後
`present` 的事），所以不需要安裝任何東西。與 writing.md §2（C4 層級與標註）互補：
C4 管「畫哪一層」，本檔管「怎麼畫得清楚、什麼時候該拆」。

## 1. 哲學：刪到不能再刪

- **每個節點代表一個獨立概念**；永遠一起出現的兩個東西是一個節點。
- **每條邊要帶資訊**；版面已經看得出的關係不畫線。
- **焦點 1–2 個**：一張圖只有一兩個主角（這張圖是為它而畫的）；全部都強調＝沒有強調。
- 圖完成的定義不是「該加的都加了」，而是「沒有東西可以再刪」。目標密度 4/10：技術上
  完整、不需要導覽就能讀。
- 畫之前先問：**一張三欄表格能不能講同一件事？** 能就用表格。一個形狀的「圖」就寫一句話。
- 超過預算就拆成**總覽＋細部**，不是縮字體。

## 2. 選型：先問「在展示什麼」，再選圖

| 在展示什麼 | doc-align 類型 | Mermaid 圖 | diagram-design 對應 |
|---|---|---|---|
| 元件＋連線 | architecture／deployment | `flowchart` + `subgraph` | Architecture／High-Level |
| 時間順序的訊息 | sequence | `sequenceDiagram` | Sequence |
| 條件分支的決策邏輯 | decision | `flowchart`（菱形＝條件） | Flowchart／Paired policy traces |
| 狀態＋轉移＋guard | state | `stateDiagram-v2` | State machine |
| 實體＋欄位＋關係 | db-schema | `erDiagram` | ER |
| 類別與關係 | class | `classDiagram` | （diagram-design 不支援；維持 Mermaid） |
| 角色分工的資料流 | pipeline | `flowchart`（subgraph＝stage 或角色） | Data flow／Process／Swimlane |
| 堆疊的抽象層 | layers | `flowchart TD`（節點＝層） | Layer stack |
| 含容／範圍的階層 | architecture 的模組分組 | `flowchart` + 巢狀 `subgraph` | Nested |
| 角色×資源 | permissions | markdown 表格（**不畫圖**） | DP security matrix |
| endpoint 目錄 | api | markdown 表格（**不畫圖**） | （表格） |
| 時間軸、甘特、雷達、象限、文氏、漏斗、長條、折線 | **不在核心** | — | 屬簡報層（present） |

經驗法則：兩種圖都像可以時，選**主軸**（時間→sequence；條件→decision；結構→architecture）；
不要在一張圖混兩種語法。

## 3. 複雜度預算（Mermaid 版，`mermaid-check.js` 會算）

| 圖 | 上限 | 超過怎麼辦 |
|---|---|---|
| flowchart（architecture／decision／pipeline／deployment／layers） | 節點 ≤12、邊 ≤16、subgraph ≤6；**總覽圖** ≤9 節點 | 拆總覽＋細部：總覽只留模組級節點，細部各自一張（或一份文件） |
| sequenceDiagram | 生命線 ≤5、`alt` 分支 ≤2、片段巢狀 ≤1 層 | 把不重要的參與者合併（「下游服務」）；分支多＝該有一份 decision 文件 |
| stateDiagram-v2 | 狀態 ≤12、轉移 ≤16 | 子狀態拆成 composite state 或獨立文件 |
| classDiagram | 類別 ≤9、關係 ≤12 | 只畫 domain 核心；utility／DTO 不畫 |
| erDiagram | **不設預算**（db-schema 的 erDiagram 是真相來源，必須完整；拆圖會讓 schema-diff 誤判） | 大 schema 用 `%% ── 訂單域 ──` 註解分群；architecture 文件只畫核心實體 |
| 邊標籤 | ≤4 個詞；sequence 步驟標籤例外（逐字指令） | 說明移到「行為規則」 |

`node <SCRIPTS>/mermaid-check.js <file>` 會對每個區塊回 `stats` 與 `warnings`（超預算是提醒，
不是錯誤；`--strict-budget` 才 fail）。init 步驟 6 與 sync 步驟 3 看到 warning 就先想拆圖。

## 4. 語意角色 → Mermaid 寫法（主題安全，不靠顏色）

| 角色 | 寫法 |
|---|---|
| 焦點（1–2 個） | `classDef focal stroke-width:3px;` ＋ `class X focal` |
| 儲存／狀態（DB、cache、queue） | 圓柱 `db[(PostgreSQL)]`；queue 用 `q[[Kafka topic]]` |
| 外部系統／第三方 | 放進 `subgraph ext[外部]`，或 `classDef external stroke-dasharray:4 3;` |
| 使用者／輸入 | `u([使用者])`（stadium） |
| 可選／非同步 | 虛線邊 `-.->`，標 `async`／`選配` |
| 安全／信任邊界 | `subgraph` 命名為邊界（`subgraph vpc[私有網段]`），被禁止的路徑**停在邊界外**，不要畫進去 |
| 決策 | 菱形 `{條件？}`，每條出邊標 `是`／`否`或條件文字，**必有預設分支** |
| 入口／結束 | `((開始))`、`((結束))` 只在 decision 用 |

- 不同角色用**形狀**區分，不是全部矩形；用到兩種以上樣式時，圖下方一行文字當圖例。
- 顏色只能是焦點；不要用紅綠表示成功失敗（用文字 `PASS`／`FAIL`）。

## 5. 語意模式片語（看到這種行為，就這樣畫）

| 行為 | 畫法 |
|---|---|
| 多對一的匯入／瓶頸（queue、限流、人工審核） | 多個來源 → 一個 queue 節點（標容量／速率單位：`8/小時`、`3 slots`）→ 一個受限服務 → 兩個出口（通過／延後或拒絕）；來源 >5 時合併成「其他 N 個來源」 |
| 規則鏈／政策評估（同樣的規則、不同結果） | flowchart 按規則順序排，每個規則節點明寫 `PASS`／`FAIL`／`SKIPPED`／`NOT REACHED` 字樣；標出**第一個分歧點**；被拒後不要繼續畫下游規則 |
| 信任邊界與放行路徑（secure paved road） | ≤3 個 subgraph 邊界、每條允許路徑有正向標籤、禁止路徑以虛線停在邊界、一個特權閘門節點、一個稽核目的地 |
| 重試／退避 | sequence 用 `loop 最多 3 次，指數退避` 片段，標最大次數與退出條件 |
| 階段框架（每個 stage 重複同樣的欄位：輸入／治理／輸出） | **表格**，不畫圖 |
| 非結構輸入 → 結構產物 | 來源 → 轉換節點（命名）→ 產物節點，標出欄位來源；不要畫「魔法」箭頭 |
| 控制目錄（哪裡強制執行什麼） | 表格（列＝控制、欄＝強制點／執行者／時機），或 layers 型文件 |

## 6. 反模式（看到就改）

| 反模式 | 為什麼錯 | 改法 |
|---|---|---|
| 所有節點都是一樣的矩形 | 抹掉階層 | 依 §4 用形狀 |
| 沒標籤的箭頭 | 讀者不知道這條線是什麼 | `-->|動詞／協定|` |
| 一張圖同時有服務、模組、函式 | 混層級 | C4：一圖一層（writing.md §2） |
| 標籤塞滿說明文字 | 圖變寬、圖例失焦 | 說明移到行為規則；sequence 指令例外 |
| 強調 4 個以上節點 | 沒有焦點 | 決定主角，其餘用預設樣式 |
| 把圖當萬用：用圖表達列表 | 表格更清楚 | 表格 |
| 為了塞進一張圖而縮節點 | 可讀性歸零 | 拆總覽＋細部 |
| 紅綠色當唯一語意 | 色盲／深色主題看不出 | 文字＋形狀 |
| 圖例漂在圖中央 | 跟節點打架 | Mermaid 沒圖例功能：圖下方一行文字 |
| 同一件事圖和文字各講一遍 | 重述 | 留圖，刪文字（init 密度原則） |

## 7. 畫完自問（remove test）

1. 能刪掉任何一個節點嗎（讀者還看得懂）？
2. 能合併任何兩個節點嗎（它們永遠一起出現）？
3. 能刪掉任何一條邊嗎（關係從版面就看得出）？
4. 能刪掉任何一個標籤嗎（形狀已經說明了）？
5. 焦點 ≤2？在預算內？每條邊有標籤？一圖一層？
6. 這張圖如果換成三欄表格會不會更清楚？

## 來源

diagram-design v2.4（cathrynlavery/diagram-design，MIT）：§1 Philosophy、§3 Selection、
§4 Universal Anti-patterns、§5 Semantic roles、§7 Complexity budget、§9 Taste Gate、
references/semantic-patterns.md。本檔只取其**設計判準**並換算成 Mermaid；其 SVG 樣式系統
（字體、4px 網格、顏色 token、手繪 SVG）屬簡報衍生層，將由 `present` 使用，不影響 docs/。
