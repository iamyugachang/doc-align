# doc-align Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 `init` 指令（含既存文件接手與 `--repair`）與 opencode adapter，讓 doc-align 能從零 bootstrap 文件集、並在第二種 agent 上使用。

**Architecture:** init 是 LLM-driven 的 playbook（吸收 docs/phase2-init-notes.md 的 7 條實測教訓），機械部分下沉到 scripts：`manifest.js` 新增 `add-doc` 子命令（避免 agent 手寫嚴格 YAML）、`sql-ddl.js` 忽略 seed 型語句。opencode adapter 是一個 command markdown（`.opencode/commands/` 格式，2026-07 官方文件確認），用 `` !`shell` `` 注入重現 realpath 解析。

**Tech Stack:** 同 Phase 1（Node ≥18 ESM、零依賴、`node --test`）。基準：main @ 64 tests。執行前建立 `feature/phase-2` branch。

**Not in this plan:** GitHub Action / PR 留言（Phase 3）；opencode 的 live 驗證（本機未安裝 opencode，結構驗證入自動測試，live 驗證列為使用者在另一台機器的手動步驟）。

---

### Task 1: seed 型 SQL 語句忽略（`scripts/lib/sql-ddl.js`）

來源：phase2-init-notes「script 層待辦」。`INSERT`、`CREATE DATABASE`、psql meta-command（`\c` 等）不可能造成 schema drift，應直接忽略而非列入 `unsupportedStatements`，讓 `ok` 能代表純機械通過。

**Files:**
- Modify: `scripts/lib/sql-ddl.js`（`parseSqlDdl` 的 else 分支前）
- Test: `tests/sql-ddl.test.js`

- [ ] **Step 1: 寫失敗測試（附加到 tests/sql-ddl.test.js 末尾）**

```js
test('seed-style statements are ignored, not reported unsupported', () => {
  const { tables, unsupported } = parseSqlDdl(`
    CREATE DATABASE shop;
    \\c shop
    CREATE TABLE users (id INT);
    INSERT INTO users (id) VALUES (1), (2);
  `);
  assert.deepEqual(Object.keys(tables), ['users']);
  assert.deepEqual(unsupported, []);
});

test('genuinely unsupported statements are still reported', () => {
  const { unsupported } = parseSqlDdl('CREATE INDEX idx ON users (email);');
  assert.equal(unsupported.length, 1);
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: 第一個新測試 FAIL（`\c shop` 與 INSERT 目前落在 unsupported），第二個本來就綠。

- [ ] **Step 3: 實作**

在 `parseSqlDdl` 的最後一個 `else`（`unsupported.push(...)`）之前加入：

```js
    } else if (isIgnorable(stmt)) {
      // seed-style statements can never cause schema drift — skip silently
```

並在模組層新增（放在 `CONSTRAINT_HEADS` 附近）：

```js
const IGNORABLE_STATEMENTS = [
  /^insert\s+into\s/i,     // seed data
  /^create\s+database\s/i, // database-level, not table-level
  /^\\/,                   // psql meta-commands (\c, \connect, ...)
];

function isIgnorable(stmt) {
  return IGNORABLE_STATEMENTS.some((re) => re.test(stmt));
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS（66 tests）

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sql-ddl.js tests/sql-ddl.test.js
git commit -m "feat: ignore seed-style SQL statements in schema parsing"
```

---

### Task 2: `manifest.js add-doc` 子命令

init 的機械核心：由 script 產生嚴格格式的 manifest entry，agent 不手寫 YAML（data-playground 實測教訓：格式嚴格，交給工具最穩）。同時把 type 枚舉抽成共用常數。

**Files:**
- Modify: `scripts/manifest.js`
- Test: `tests/manifest.test.js`

- [ ] **Step 1: 寫失敗測試（附加到 tests/manifest.test.js 末尾）**

```js
test('add-doc creates the manifest file when missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-'));
  const p = join(dir, '.docalign.yml');
  execFileSync('node', [SCRIPT, 'add-doc', '--manifest', p, '--doc', 'architecture.md',
    '--type', 'architecture', '--watch', 'src/**', '--commit', 'abc1234']);
  const { docs } = loadManifest(p);
  assert.deepEqual(docs, [{ path: 'architecture.md', type: 'architecture', watch: ['src/**'], last_verified: 'abc1234' }]);
});

test('add-doc appends to an existing manifest and preserves entries', () => {
  const p = tmpManifest(VALID);
  execFileSync('node', [SCRIPT, 'add-doc', '--manifest', p, '--doc', 'db-schema.md',
    '--type', 'db-schema', '--watch', 'migrations/**']);
  const { docs } = loadManifest(p);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].path, 'flows/refund.md');
  assert.equal(docs[1].last_verified, undefined);
});

test('add-doc rejects duplicate path and unknown type', () => {
  const p = tmpManifest(VALID);
  assert.throws(() => execFileSync('node', [SCRIPT, 'add-doc', '--manifest', p,
    '--doc', 'flows/refund.md', '--type', 'sequence', '--watch', 'x/**'], { stdio: 'pipe' }));
  assert.throws(() => execFileSync('node', [SCRIPT, 'add-doc', '--manifest', p,
    '--doc', 'new.md', '--type', 'bogus', '--watch', 'x/**'], { stdio: 'pipe' }));
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: 三個新測試 FAIL（unknown command: add-doc）。

- [ ] **Step 3: 實作**

`scripts/manifest.js` 修改：

1. 把現有 `loadManifest` 內的 type 枚舉（fe1dbfe 加入）抽成模組層常數並 export：

```js
export const KNOWN_TYPES = ['architecture', 'use-case', 'sequence', 'class', 'db-schema'];
```

`loadManifest` 改為引用 `KNOWN_TYPES`（錯誤訊息不變）。

2. 在 `main()` 的 `set-verified`/`set-watch` 區塊後新增：

```js
  if (cmd === 'add-doc') {
    if (!opts.doc) throw new Error('add-doc requires --doc');
    if (!KNOWN_TYPES.includes(opts.type)) {
      throw new Error(`add-doc: unknown type '${opts.type}' (expected one of ${KNOWN_TYPES.join(', ')})`);
    }
    if (!opts.watch.length) throw new Error('add-doc requires at least one --watch');
    let manifest;
    try {
      manifest = loadManifest(opts.manifest);
    } catch (e) {
      if (e.code === 'ENOENT') manifest = { docs: [] };
      else throw e;
    }
    if (manifest.docs.some((d) => d.path === opts.doc)) {
      throw new Error(`doc already in manifest: ${opts.doc}`);
    }
    const doc = { path: opts.doc, type: opts.type, watch: opts.watch };
    if (opts.commit) doc.last_verified = opts.commit;
    manifest.docs.push(doc);
    saveManifest(opts.manifest, manifest);
    process.stdout.write(JSON.stringify({ ok: true, doc }, null, 2) + '\n');
    return;
  }
```

3. 參數迴圈新增 `--type`（含 takeValue 防護，同既有 pattern）：`else if (a === '--type') opts.type = takeValue(a, i++);`（依現有 takeValue 實作的簽名調整——以檔案內既有寫法為準，保持一致）。

4. usage 字串更新為 `read|set-verified|set-watch|add-doc`。

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS（69 tests）

- [ ] **Step 5: Commit**

```bash
git add scripts/manifest.js tests/manifest.test.js
git commit -m "feat: manifest add-doc subcommand for init"
```

---

### Task 3: init playbook（`playbook/init.md`）

**Files:**
- Create: `playbook/init.md`

- [ ] **Step 1: 寫入內容**

```markdown
# doc-align init — 文件集初始化程序

你是執行 doc-align init 的 agent。目標：為目前 repo 建立（或修復）docs/ 文件集與
manifest，完成後的狀態必須能直接通過 check。`<SCRIPTS>` 由呼叫端提供。
manifest 的 `path` 一律相對於 `docs/`；檔案操作使用 `docs/<path>`。

參數：無參數＝完整初始化；`--repair`＝docs/ 內容存在但 manifest 缺失或損壞時，
只重建 manifest（不重寫文件）。

## 步驟

1. **盤點現況**：檢查 docs/ 與 docs/.docalign.yml 是否已存在。
   - manifest 已存在且可解析（`node <SCRIPTS>/manifest.js read` 成功）→ 停止並告知
     使用者應改用 check/sync；init 不覆蓋既有的有效狀態。
   - `--repair` 模式 → 跳到步驟 7。
2. **探索 repo**：理解實際行為——進入點、模組結構、資料流、外部依賴、DB schema
   來源（migrations／init SQL／ORM models）。若 repo 有程式碼索引工具可用則優先使
   用，否則搜尋與閱讀原始碼。README 等既有敘述僅供參考：**敘述與程式碼不符時以
   程式碼為準**，並把不符處記入最終報告。
3. **決定文件集**：對五種類型逐一判斷「本 repo 適不適用」，決策與理由記入報告：
   - architecture：幾乎總是適用。
   - use-case：判斷依據不是 repo 大小，而是功能入口是否存在與變動（git 歷史／
     ADR／spec 紀錄顯示入口增減者，適用）。
   - sequence（flows/）：每個值得描述的流程一份；機制相同僅參數不同的流程合併
     為一份圖＋短註說明差異。
   - class：只在 repo 有自定義 domain class 時適用；SQL/config 為主的 repo 可跳過，
     但必須在報告記明理由。
   - db-schema：有 DB 就適用。一份文件只放**一個** erDiagram（真相來源的實體
     schema）；衍生關聯（如 dbt models、views）用 markdown 表格記
     name/location/materialization/producer，欄位級細節由對應 flow 文件的 watch 涵蓋。
4. **接手既存文件**（docs/ 已有內容但無 manifest 時）：先讀既有文件，盡量保留其
   結構與敘述——只修正與程式碼不符處、補缺漏、調整為本文件集的格式；接手中發現
   的錯誤記入報告。
5. **撰寫文件**，遵守以下寫作規則（來自實測教訓，違反任一條都算未完成）：
   - 每條短註在**寫下當下**就必須有對應的程式碼證據（`檔案:行號`）；證據不足的
     宣告不寫，或明確標注為未驗證。鼓勵在短註內附上檔案引用。
   - 短註寫可驗證的具體行為句（「當 X 時系統會 Y」），不寫空泛描述。
   - Mermaid 圖內含中日韓文字的標籤一律使用全形括號（），不與 ASCII 括號混用。
   - sequence 步驟標籤使用逐字指令（含完整參數），不寫摘要化的指令。
6. **驗證後寫入**：每份文件寫入前先在暫存位置通過
   `node <SCRIPTS>/mermaid-check.js <暫存檔>`；db-schema 文件另須
   `node <SCRIPTS>/schema-diff.js --doc <暫存檔> --sql <DDL 路徑>` 回報 `ok`
   （`unsupported` 時修文件或在報告說明原因，不得默默留下 drift）。
7. **建立 manifest**：逐份文件執行
   `node <SCRIPTS>/manifest.js add-doc --doc <path> --type <type> --watch <glob> [--watch ...] --commit <目前 HEAD>`
   - watch 選擇該文件實際描述的程式碼範圍；db-schema 的 watch 必須把 DDL 目錄
     放在**第一個**（check 從第一個 pattern 推導 --sql 路徑）。
   - `--repair` 模式：從既有文件內容推導 type 與 watch；重建後不直接標記已驗證
     ——先執行步驟 8 的全量自檢，通過的文件才用 add-doc 附上 `--commit`。
8. **自檢**：依 check playbook 以全量模式驗證每份剛完成的文件；發現自己寫錯的
   立即修正並重驗。自檢不通過不得結束。
9. **最終報告**：列出建立的檔案、各類型的採用／跳過決策與理由、驗證輸出摘要、
   既有敘述（README 等）與程式碼的不符清單、尚未被任何文件涵蓋的重要範圍。
   init 不執行 git commit；是否提交由使用者決定。
```

- [ ] **Step 2: 對照檢查**

逐條對照 spec §6（init）、§10（`init --repair`）與 docs/phase2-init-notes.md 的 7 條規則，確認全數落入步驟；grep 確認無 agent 專屬工具名稱。

- [ ] **Step 3: Commit**

```bash
git add playbook/init.md
git commit -m "feat: init playbook"
```

---

### Task 4: SKILL.md 與 check.md 的 init 接線 + README 更新

**Files:**
- Modify: `adapters/claude-code/SKILL.md`
- Modify: `playbook/check.md`
- Modify: `README.md`

- [ ] **Step 1: SKILL.md**

frontmatter `description` 改為：

```
偵測 docs/ 文件（Mermaid 圖＋短註）與程式碼的 drift 並提出更新建議。用法：/doc-align check [--full | --range <git range>]、/doc-align sync、/doc-align init [--repair]
```

執行段第 1 點的子命令清單由「`check` 或 `sync`」改為「`check`、`sync` 或 `init`」；對應 playbook 一句補上 `init.md`。

- [ ] **Step 2: check.md**

步驟 1 的「（`doc-align init`，Phase 2 提供）」改為「（執行 `doc-align init`；manifest 損壞而文件存在時用 `doc-align init --repair`）」。

- [ ] **Step 3: README.md**

1. 用法清單加上：`/doc-align init`（從零 bootstrap 文件集與 manifest）、`/doc-align init --repair`（manifest 損壞時重建）。
2. 已知限制刪除「manifest 需手動建立（init 指令在 Phase 2）」一條；保留手寫格式範例但改標題為「manifest 格式（工具維護，一般不需手動編輯）」。
3. 新增「安裝原理」小節（回應使用者提問）：

```markdown
## 安裝原理

symlink 不是只裝 SKILL.md：`~/.claude/skills/doc-align` 指向 repo 內的
`adapters/claude-code/`，SKILL.md 執行時用 `realpath` 穿透 symlink 找回 repo 根，
再以絕對路徑取用 `playbook/` 與 `scripts/`。因此 **clone 下來的整個 repo 就是安裝
本體**，`git pull` 即完成更新。換機器＝`git clone` + `ln -sfn`，無需複製 scripts。
```

- [ ] **Step 4: 驗證與 Commit**

Run: `npm test`（維持 69）；grep 三個檔案確認無 agent 專屬工具名稱。

```bash
git add adapters/claude-code/SKILL.md playbook/check.md README.md
git commit -m "feat: wire init into skill, check playbook, and README"
```

---

### Task 5: opencode adapter（`adapters/opencode/commands/doc-align.md`）

格式依 2026-07 官方文件：command 檔放 `~/.config/opencode/commands/<name>.md`（全域）或 `.opencode/commands/`（專案）；frontmatter 支援 `description`；body 是 prompt 模板，支援 `$ARGUMENTS` 與 `` !`shell` `` 注入。注意：spec §9 的目錄草圖寫 `command/`，實際為 `commands/`——以官方文件為準，於 commit message 註記。

**Files:**
- Create: `adapters/opencode/commands/doc-align.md`
- Modify: `README.md`
- Test: `tests/adapters.test.js`

- [ ] **Step 1: 寫失敗測試（結構一致性鎖定，不需安裝 opencode）**

```js
// tests/adapters.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'has frontmatter');
  return m[1];
}

test('both adapters exist and reference every playbook subcommand', () => {
  for (const p of ['adapters/claude-code/SKILL.md', 'adapters/opencode/commands/doc-align.md']) {
    const md = readFileSync(ROOT + p, 'utf8');
    for (const sub of ['check', 'sync', 'init']) {
      assert.ok(md.includes(sub), `${p} mentions ${sub}`);
      assert.ok(existsSync(`${ROOT}playbook/${sub}.md`), `playbook/${sub}.md exists`);
    }
  }
});

test('opencode command has description frontmatter and resolves repo root', () => {
  const md = readFileSync(ROOT + 'adapters/opencode/commands/doc-align.md', 'utf8');
  assert.match(frontmatter(md), /^description:\s+\S/m);
  assert.ok(md.includes('$ARGUMENTS'), 'passes user arguments');
  assert.ok(md.includes('realpath'), 'resolves symlink to repo root');
});

test('adapters contain no agent-specific tool names', () => {
  for (const p of ['adapters/claude-code/SKILL.md', 'adapters/opencode/commands/doc-align.md']) {
    const md = readFileSync(ROOT + p, 'utf8');
    assert.ok(!/Grep tool|Read tool|Task tool|Bash tool|TodoWrite|WebFetch/.test(md), `${p} is agent-agnostic`);
  }
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL（adapters/opencode/commands/doc-align.md 不存在）。

- [ ] **Step 3: 建立 command 檔**

````markdown
---
description: doc-align — 偵測 docs/ 文件與程式碼的 drift（check）、套用文件更新（sync）、初始化文件集（init）
---

doc-align repo 根目錄（由安裝 symlink 解析；兩個安裝位置擇一命中）：

!`p=$(realpath ~/.config/opencode/commands/doc-align.md 2>/dev/null || realpath .opencode/commands/doc-align.md); dirname "$(dirname "$(dirname "$p")")"`

你是 doc-align 的執行 agent。上方輸出即 DOC_ALIGN_ROOT。使用者參數：$ARGUMENTS

1. 取第一個參數為子命令：`check`、`sync` 或 `init`；其餘參數原樣帶入流程。無子命
   令、未知子命令或未知 flag → 說明用法後結束。`--full` 與 `--range` 同時出現時
   `--full` 優先，並向使用者說明。
2. 讀取 `<DOC_ALIGN_ROOT>/playbook/<子命令>.md`，完全遵循其步驟執行，以目前所在
   repo 為工作對象；playbook 中的 `<SCRIPTS>` 即 `<DOC_ALIGN_ROOT>/scripts`。
   本檔是薄 adapter，不重複流程細節。
````

- [ ] **Step 4: README 安裝一節加 opencode**

在「安裝（Claude Code）」之後新增：

```markdown
## 安裝（opencode）

    mkdir -p ~/.config/opencode/commands
    ln -sfn "$(pwd)/adapters/opencode/commands/doc-align.md" ~/.config/opencode/commands/doc-align.md

之後在 opencode 內使用 `/doc-align check|sync|init`。
（尚未在真機驗證——安裝後請先跑一次 `/doc-align check` 確認 repo 根解析正確。）
```

- [ ] **Step 5: 執行確認通過 + Commit**

Run: `npm test`
Expected: PASS（72 tests）

```bash
git add adapters/opencode/commands/doc-align.md tests/adapters.test.js README.md
git commit -m "feat: opencode command adapter (spec layout adjusted: commands/ per official docs)"
```

---

### Task 6: init 的 live E2E（兩個情境）

LLM-driven 的 init 無法單元測試，比照 Phase 1 由 controller 派 agent 實測。

**Files:** 無（驗證任務；發現的問題回修對應 task 的檔案）

- [ ] **Step 1: 情境 A——從零初始化**

建 fixture repo（無 docs/）：

````bash
FIXTURE=$(mktemp -d) && cd "$FIXTURE"
git init -b main && git config user.email test@test && git config user.name test
mkdir -p src/billing src/api migrations
cat > src/billing/refund.py <<'EOF'
from src.api.notify import send_notice

def refund(order_id, days_since_order):
    if days_since_order > 30:
        raise ValueError("refund window closed")
    send_notice(order_id, "refunded")

def cancel(order_id):
    send_notice(order_id, "cancelled")
EOF
mkdir -p src/api
printf 'def send_notice(order_id, kind):\n    pass\n' > src/api/notify.py
echo 'CREATE TABLE refunds (id SERIAL, order_id INT, reason VARCHAR(255));' > migrations/001.sql
echo 'INSERT INTO refunds (order_id, reason) VALUES (1, '"'"'test'"'"');' >> migrations/001.sql
git add -A && git commit -m base
echo "fixture ready: $FIXTURE"
````

派 agent 依 SKILL.md 執行 `/doc-align init`，驗證清單：

- [ ] 產出的每份文件通過 mermaid-check；db-schema 通過 schema-diff `ok` 且 `unsupportedStatements` 為空（Task 1 的 seed 忽略生效）。
- [ ] manifest 由 add-doc 產生、`manifest.js read` 可解析、db-schema watch 第一個 pattern 是 `migrations/**`。
- [ ] class 類型被跳過且報告附理由；30 天退款窗口出現在 flows 短註且附 `refund.py` 行號引用。
- [ ] init 後立刻 `/doc-align check` → 全 clean 早退。
- [ ] repo 內無任何 git commit 由 agent 產生。

- [ ] **Step 2: 情境 B——接手既存文件 + `--repair`**

在情境 A 的 fixture 上：刪除 `docs/.docalign.yml`、把 db-schema.md 的某個欄位改錯（模擬 stale 文件）、再派 agent 執行 `/doc-align init --repair`。驗證：

- [ ] 既有文件的結構與敘述被保留（非整份重寫），僅錯誤欄位被修正。
- [ ] manifest 重建且所有文件通過全量自檢後才標記 last_verified。
- [ ] 報告記載接手中發現並修正的錯誤。

- [ ] **Step 3: 回修**

任何一項不符 → 修正 playbook/init.md（或相關 script），重測該項後才繼續。

---

### Task 7: 最終總審查與合併

- [ ] **Step 1**：派最終審查（整條 `feature/phase-2` diff 對 spec §6/§9/§10 Phase-2 範圍 + phase2-init-notes 全數消化確認 + 跨單元一致性 + `npm test` 72/72）。
- [ ] **Step 2**：READY 後合併回 main（`--no-ff`），跑最終 `npm test`。
- [ ] **Step 3**：更新 memory 中的專案狀態（Phase 2 完成、Phase 3 待做、opencode live 驗證待使用者）。
