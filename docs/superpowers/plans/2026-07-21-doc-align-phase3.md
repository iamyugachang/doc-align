# doc-align Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Action PR 留言整合——LLM 之前的 changed-scope 廉價閘門、非阻塞 drift 報告留言（upsert）、claude 與 opencode 兩種 runner 範本。

**Architecture:** 閘門邏輯抽成可測的 `scripts/ci-gate.js`（包 changedScope，輸出 skip 判定與 GITHUB_OUTPUT）；workflow 範本是目標 repo 複製用的靜態檔，LLM 步驟以 headless 模式讀 check playbook。spec §8：未觸及 watch 範圍的 PR 直接跳過（零 LLM 成本）；報告永不 fail job。

**Tech Stack:** 同前（Node ≥18 零依賴）。基準：main @ 77 tests。執行於 `feature/phase-3` branch。

**無法本機驗證的部分:** workflow 在真實 GitHub PR 上的 live 執行（需 repo + secrets）——結構測試 + 閘門整合測試涵蓋可測部分，live 驗證列為使用者後續步驟（README 註記）。

---

### Task 1: CI 廉價閘門（`scripts/ci-gate.js`）

**Files:**
- Create: `scripts/ci-gate.js`
- Test: `tests/ci-gate.test.js`

- [ ] **Step 1: 寫失敗測試**

```js
// tests/ci-gate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = new URL('../scripts/ci-gate.js', import.meta.url).pathname;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function makePr({ verified = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-ci-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@test');
  git(dir, 'config', 'user.name', 'test');
  mkdirSync(join(dir, 'src/billing'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'src/billing/refund.py'), 'def refund(): pass\n');
  writeFileSync(join(dir, 'README.md'), 'hi\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'docs/.docalign.yml'), `docs:
  - path: flows/refund.md
    type: sequence
    watch:
      - src/billing/**
${verified ? `    last_verified: ${base}\n` : ''}`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'manifest');
  git(dir, 'checkout', '-b', 'feature');
  return dir;
}

function run(dir, extraEnv = {}) {
  const out = execFileSync('node', [SCRIPT, '--base', 'main', '--repo', dir],
    { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  return JSON.parse(out);
}

test('watched change → skip=false with affected doc listed', () => {
  const dir = makePr();
  writeFileSync(join(dir, 'src/billing/refund.py'), 'def refund(x): return x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'change');
  const out = run(dir);
  assert.equal(out.skip, false);
  assert.deepEqual(out.affectedDocs, ['flows/refund.md']);
});

test('unwatched change → skip=true (zero-cost per spec §8), unmatched still reported', () => {
  const dir = makePr();
  writeFileSync(join(dir, 'README.md'), 'changed\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'readme only');
  const out = run(dir);
  assert.equal(out.skip, true);
  assert.deepEqual(out.unmatchedFiles, ['README.md']);
});

test('doc without last_verified is judged by the PR range like any other (CI cares about the diff, not repo hygiene)', () => {
  const dir = makePr({ verified: false });
  writeFileSync(join(dir, 'README.md'), 'changed\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'readme only');
  const out = run(dir);
  assert.equal(out.skip, true);
});

test('bad base ref is a loud error, not a silent skip', () => {
  const dir = makePr();
  assert.throws(() => execFileSync('node', [SCRIPT, '--base', 'no-such-ref', '--repo', dir], { stdio: 'pipe' }),
    /cannot diff range/);
});

test('writes GITHUB_OUTPUT when env var set', () => {
  const dir = makePr();
  writeFileSync(join(dir, 'src/billing/refund.py'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'change');
  const ghOut = join(mkdtempSync(join(tmpdir(), 'gho-')), 'out');
  writeFileSync(ghOut, '');
  run(dir, { GITHUB_OUTPUT: ghOut });
  const content = readFileSync(ghOut, 'utf8');
  assert.match(content, /^skip=false$/m);
  assert.match(content, /^range=main\.\.\.HEAD$/m);
});

test('missing --base is a loud error', () => {
  const dir = makePr();
  assert.throws(() => execFileSync('node', [SCRIPT, '--repo', dir], { stdio: 'pipe' }));
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL（Cannot find module .../scripts/ci-gate.js）

- [ ] **Step 3: 實作**

```js
// scripts/ci-gate.js
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadManifest } from './manifest.js';
import { changedScope } from './changed-scope.js';

export function ciGate({ manifest, base, cwd = '.' }) {
  const range = `${base}...HEAD`;
  const scope = changedScope({ manifest, range, cwd });
  // In explicit-range mode 'unverified' only means the range itself failed to
  // diff (bad base ref) — that's an infra error the CI run must surface, not a
  // condition to silently skip or silently spend LLM tokens on.
  const broken = scope.docs.filter((d) => d.status === 'unverified');
  if (broken.length) {
    throw new Error(`ci-gate: cannot diff range ${range}: ${broken[0].reason}`);
  }
  const affectedDocs = scope.docs.filter((d) => d.status === 'affected').map((d) => d.path);
  // Spec §8: PRs touching no watch pattern skip entirely (zero LLM cost). Coverage
  // gaps (unmatchedFiles) are surfaced by manual/full check, not per-PR noise.
  const skip = affectedDocs.length === 0;
  return { skip, range, affectedDocs, unmatchedFiles: scope.unmatchedFiles };
}

function takeValue(a, argv, i) {
  const v = argv[i];
  if (v === undefined || v.startsWith('--')) throw new Error(`${a} requires a value`);
  return v;
}

function main(argv) {
  const opts = { manifest: 'docs/.docalign.yml', cwd: '.' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') opts.base = takeValue(a, argv, ++i);
    else if (a === '--manifest') opts.manifest = takeValue(a, argv, ++i);
    else if (a === '--repo') opts.cwd = takeValue(a, argv, ++i);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!opts.base) throw new Error('ci-gate requires --base <ref> (e.g. origin/main)');
  const manifest = loadManifest(join(opts.cwd, opts.manifest));
  const result = ciGate({ manifest, base: opts.base, cwd: opts.cwd });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `skip=${result.skip}\nrange=${result.range}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS（83 tests）

- [ ] **Step 5: Commit**

```bash
git add scripts/ci-gate.js tests/ci-gate.test.js
git commit -m "feat: ci-gate cheap pre-LLM skip decision"
```

---

### Task 2: Workflow 範本 + 結構測試 + 文件

**Files:**
- Create: `ci/doc-align-claude.yml`
- Create: `ci/doc-align-opencode.yml`
- Test: `tests/ci.test.js`
- Modify: `README.md`
- Modify: `docs/phase2-init-notes.md`

- [ ] **Step 1: 寫失敗測試**

```js
// tests/ci.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = ['ci/doc-align-claude.yml', 'ci/doc-align-opencode.yml'];

test('workflow templates exist with PR trigger and comment permission', () => {
  for (const f of FILES) {
    const y = readFileSync(ROOT + f, 'utf8');
    assert.match(y, /^name:/m, `${f} has a name`);
    assert.match(y, /pull_request/, `${f} triggers on PR`);
    assert.match(y, /pull-requests:\s*write/, `${f} can comment`);
  }
});

test('cheap gate runs before the LLM step and gates it', () => {
  for (const f of FILES) {
    const y = readFileSync(ROOT + f, 'utf8');
    const gateIdx = y.indexOf('ci-gate.js');
    const llmIdx = f.includes('claude') ? y.indexOf('claude -p') : y.indexOf('opencode run');
    assert.ok(gateIdx > -1 && llmIdx > -1, `${f} has both steps`);
    assert.ok(gateIdx < llmIdx, `${f}: gate precedes LLM`);
    assert.match(y, /steps\.gate\.outputs\.skip != 'true'/, `${f}: LLM conditioned on gate`);
  }
});

test('report comment is upserted via marker and job never fails on drift', () => {
  for (const f of FILES) {
    const y = readFileSync(ROOT + f, 'utf8');
    assert.match(y, /<!-- doc-align-report -->/, `${f} has upsert marker`);
    assert.ok(!/exit 1/.test(y), `${f} never fails the job on drift`);
    assert.match(y, /playbook\/check\.md/, `${f} points the agent at the check playbook`);
  }
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL（ci/doc-align-claude.yml 不存在）

- [ ] **Step 3: 建立 `ci/doc-align-claude.yml`**

```yaml
# doc-align drift check — 複製到目標 repo 的 .github/workflows/doc-align.yml
# 需求：secrets.ANTHROPIC_API_KEY；doc-align repo 若為 private 另需 secrets.DOC_ALIGN_TOKEN
# 非阻塞設計：drift 只留言，不 fail job。
name: doc-align
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

env:
  DOC_ALIGN_REPO: iamyugachang/doc-align

jobs:
  doc-align:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Fetch doc-align
        run: |
          # private repo 時把 URL 換成 https://x-access-token:${{ secrets.DOC_ALIGN_TOKEN }}@github.com/${DOC_ALIGN_REPO}
          git clone --depth 1 "https://github.com/${DOC_ALIGN_REPO}" "$RUNNER_TEMP/doc-align"
      - name: Cheap gate (no LLM)
        id: gate
        run: node "$RUNNER_TEMP/doc-align/scripts/ci-gate.js" --base "origin/${{ github.base_ref }}"
      - name: Drift check (LLM)
        if: steps.gate.outputs.skip != 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npm install -g @anthropic-ai/claude-code
          claude -p --dangerously-skip-permissions \
            "你是 doc-align 的執行 agent。讀取 $RUNNER_TEMP/doc-align/playbook/check.md 並完全遵循其步驟；<SCRIPTS> 為 $RUNNER_TEMP/doc-align/scripts；以 --range ${{ steps.gate.outputs.range }} 執行。輸出只包含 drift 報告本體（markdown），不要任何前後綴。" \
            > "$RUNNER_TEMP/report.md"
      - name: Upsert PR comment
        if: steps.gate.outputs.skip != 'true'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          MARKER="<!-- doc-align-report -->"
          { echo "$MARKER"; echo; cat "$RUNNER_TEMP/report.md"; } > "$RUNNER_TEMP/comment.md"
          CID=$(gh api "repos/${{ github.repository }}/issues/${{ github.event.pull_request.number }}/comments" \
            --jq ".[] | select(.body | startswith(\"$MARKER\")) | .id" | head -1)
          if [ -n "$CID" ]; then
            gh api -X PATCH "repos/${{ github.repository }}/issues/comments/$CID" -F body=@"$RUNNER_TEMP/comment.md"
          else
            gh api "repos/${{ github.repository }}/issues/${{ github.event.pull_request.number }}/comments" -F body=@"$RUNNER_TEMP/comment.md"
          fi
```

- [ ] **Step 4: 建立 `ci/doc-align-opencode.yml`**

與 claude 版相同結構，僅 LLM 步驟不同（其餘逐字相同——name、on、permissions、env、checkout、setup-node、Fetch doc-align、Cheap gate、Upsert PR comment 步驟照抄上方檔案）：

```yaml
      - name: Drift check (LLM)
        if: steps.gate.outputs.skip != 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          curl -fsSL https://opencode.ai/install | bash
          export PATH="$HOME/.opencode/bin:$PATH"
          opencode run \
            "你是 doc-align 的執行 agent。讀取 $RUNNER_TEMP/doc-align/playbook/check.md 並完全遵循其步驟；<SCRIPTS> 為 $RUNNER_TEMP/doc-align/scripts；以 --range ${{ steps.gate.outputs.range }} 執行。輸出只包含 drift 報告本體（markdown），不要任何前後綴。" \
            > "$RUNNER_TEMP/report.md"
```

（檔案開頭註解改註明「需求：secrets.ANTHROPIC_API_KEY 或 opencode 支援的其他 provider key——依 opencode 設定調整 env」。）

- [ ] **Step 5: 執行確認通過**

Run: `npm test`
Expected: PASS（86 tests）

- [ ] **Step 6: README 新增 CI 一節（放在 安裝原理 之後）**

```markdown
## CI（GitHub Action，PR 留言）

把 `ci/doc-align-claude.yml`（或 opencode 版）複製到目標 repo 的
`.github/workflows/doc-align.yml`，並設定：

1. Secret `ANTHROPIC_API_KEY`（LLM 步驟用）。
2. doc-align repo 若為 private：Secret `DOC_ALIGN_TOKEN`（read 權限 PAT），
   並依範本內註解調整 clone URL。

行為：PR 未觸及任何 watch 範圍時零成本跳過；有觸及時執行 check 並以單一留言
（upsert）回報 drift；**永不 fail job**——drift 是資訊，不是門檻。
尚未在真實 PR 上 live 驗證；首次啟用請開一個測試 PR 確認留言流程。
```

- [ ] **Step 7: 關閉 phase2-init-notes 的遞延項**

`docs/phase2-init-notes.md` 開放問題一條的「遞延：Phase 3 討論」後補上決議：

```
決議（Phase 3）：維持 LLM 判斷，不引入結構化步驟——兩輪 live E2E 未出現可重現性問題，過早結構化違反 YAGNI；若日後出現誤判案例再重啟。
```

- [ ] **Step 8: Commit**

```bash
git add ci/ tests/ci.test.js README.md docs/phase2-init-notes.md
git commit -m "feat: github action templates with cheap gate and upsert comment"
```

---

### Task 3: 最終審查與合併

- [ ] **Step 1**：派最終審查（spec §8 覆蓋、workflow 與 scripts/playbook 的引用一致性、`npm test` 86/86、README 準確性）。
- [ ] **Step 2**：READY 後 merge `--no-ff` 回 main。
- [ ] **Step 3**：controller 收尾：data-playground docs 本地 commit、GitHub push 交接指令、memory 更新。
