import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent, trimContext } from '../scripts/lib/agent-loop.js';
import { createExecutor, toolDefinitions, GIT_READONLY, gitDeniedReason } from '../scripts/lib/agent-tools.js';
import { buildAgentSystemPrompt, buildAgentUserPrompt } from '../scripts/lib/agent-prompt.js';
import { chatTurn, loadEnvFile } from '../scripts/lib/llm-client.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BIN = join(ROOT, 'bin', 'doc-align.js');

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-cli-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.py'), 'def f():\n    return 1\n');
  writeFileSync(join(dir, 'docs', 'a.md'), '# A\n\n```mermaid\nsequenceDiagram\n  A->>B: f()\n```\n\n## 行為規則\n\n1. f 回傳 1（src/a.py:2）\n');
  writeFileSync(join(dir, 'docs', '.docalign.yml'),
    '# managed by doc-align\ndocs:\n  - path: a.md\n    type: sequence\n    watch:\n      - src/**\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('branch', 'base');
  return { dir, git };
}

// 以腳本化回覆序列起一個 mock gateway；每次請求依序吐出 replies[i]（message 物件）。
async function mockGateway(replies) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push({ url: req.url, auth: req.headers.authorization, body: parsed });
      const i = Math.min(requests.length - 1, replies.length - 1);
      const message = typeof replies[i] === 'function' ? replies[i](parsed) : replies[i];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { requests, close: () => server.close(), env: { DOC_ALIGN_LLM_BASE_URL: `http://127.0.0.1:${port}/v1`, DOC_ALIGN_LLM_API_KEY: 'test-key', DOC_ALIGN_LLM_MODEL: 'mock' } };
}

const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

function runCli(args, { cwd, env = {}, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, DOC_ALIGN_LLM_BASE_URL: '', DOC_ALIGN_LLM_API_KEY: '', DOC_ALIGN_LLM_MODEL: '', ...env } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

// ── llm-client.chatTurn ──────────────────────────────────────────────────────

test('chatTurn sends tools/tool_choice only when tools given and normalizes tool_calls', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"x"}' } }] } }] }) };
  };
  const cfg = { baseUrl: 'http://gw/v1', apiKey: 'k', model: 'm' };
  const r = await chatTurn(cfg, [{ role: 'user', content: 'hi' }], { tools: toolDefinitions(), fetchImpl });
  assert.deepEqual(r.toolCalls, [{ id: 'c1', name: 'read_file', arguments: '{"path":"x"}' }]);
  assert.equal(r.content, '');
  assert.equal(seen[0].tool_choice, 'auto');
  assert.ok(Array.isArray(seen[0].tools) && seen[0].tools.length > 0);
  await chatTurn(cfg, [{ role: 'user', content: 'hi' }], { tools: [], fetchImpl });
  assert.equal(seen[1].tools, undefined);
  assert.equal(seen[1].tool_choice, undefined);
});

test('loadEnvFile fills only missing keys, env wins, ignores comments/quotes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-env-'));
  const p = join(dir, 'env');
  writeFileSync(p, '# comment\nDOC_ALIGN_LLM_BASE_URL="http://file/v1"\nDOC_ALIGN_LLM_MODEL=file-model\nbad line\n');
  const merged = loadEnvFile({ DOC_ALIGN_LLM_MODEL: 'env-model', DOC_ALIGN_LLM_API_KEY: '' }, p);
  assert.equal(merged.DOC_ALIGN_LLM_BASE_URL, 'http://file/v1');
  assert.equal(merged.DOC_ALIGN_LLM_MODEL, 'env-model');
  assert.equal(loadEnvFile({ A: '1' }, join(dir, 'missing')).A, '1');
});

// ── agent-tools ──────────────────────────────────────────────────────────────

test('toolDefinitions: check mode is read-only; write tools only with allowWrite; shell only with allowShell', () => {
  const names = (o) => toolDefinitions(o).map((t) => t.function.name);
  const ro = names({});
  assert.ok(ro.includes('read_file') && ro.includes('grep') && ro.includes('run_script') && ro.includes('ask_user'));
  assert.ok(!ro.includes('write_file') && !ro.includes('shell'));
  assert.ok(names({ allowWrite: true }).includes('write_file') && names({ allowWrite: true }).includes('move_file'));
  assert.ok(names({ allowShell: true }).includes('shell'));
});

test('executor: read_file numbers lines, paginates, and refuses paths outside roots', async () => {
  const { dir } = initRepo();
  const exec = createExecutor({ cwd: dir, docAlignRoot: ROOT });
  const out = await exec('read_file', { path: 'src/a.py' });
  assert.match(out, /^src\/a\.py（1-2／共 \d+ 行）\n\s+1  def f\(\):\n\s+2      return 1/);
  const pb = await exec('read_file', { path: join(ROOT, 'playbook', 'check.md'), start: 1, end: 1 });
  assert.match(pb, /1  # doc-align check/);
  assert.match(await exec('read_file', { path: '/etc/hostname' }), /^ERROR: 不允許讀取/);
  assert.match(await exec('read_file', { path: 'nope.txt' }), /^ERROR: 檔案不存在/);
  writeFileSync(join(dir, 'big.txt'), Array.from({ length: 1000 }, (_, i) => `L${i + 1}`).join('\n'));
  const big = await exec('read_file', { path: 'big.txt', start: 100 });
  assert.match(big, /100-499／共 1000 行/);
  assert.match(big, /續讀/);
});

test('executor: glob, grep and list_dir respect the repo and skip .git', async () => {
  const { dir } = initRepo();
  const exec = createExecutor({ cwd: dir, docAlignRoot: ROOT });
  assert.equal(await exec('glob', { pattern: 'src/**/*.py' }), 'src/a.py');
  assert.match(await exec('grep', { pattern: 'return \\d' }), /^src\/a\.py:2: {5}return 1$/m);
  assert.match(await exec('grep', { pattern: 'return', glob: 'docs/**' }), /沒有符合/);
  assert.match(await exec('grep', { pattern: '[' }), /^ERROR: 無效的正規表示式/);
  const ls = await exec('list_dir', { path: '.', depth: 2 });
  assert.ok(ls.includes('docs/') && ls.includes('src/a.py') && !ls.includes('.git/'));
});

test('executor: git allowlist and run_script allowlist', async () => {
  const { dir } = initRepo();
  const exec = createExecutor({ cwd: dir, docAlignRoot: ROOT });
  assert.match(await exec('git', { args: ['rev-parse', '--abbrev-ref', 'HEAD'] }), /main/);
  assert.match(await exec('git', { args: ['commit', '-m', 'x'] }), /^ERROR: 只允許唯讀/);
  assert.match(await exec('git', { args: ['push'] }), /^ERROR/);
  assert.ok(GIT_READONLY.includes('diff'));
  // 唯讀子命令內的寫入／執行外部程式旗標也要擋
  assert.match(await exec('git', { args: ['remote', 'add', 'evil', 'http://x'] }), /^ERROR: git remote 只允許/);
  assert.match(await exec('git', { args: ['branch', 'oops'] }), /^ERROR: git branch 帶 positional/);
  assert.match(await exec('git', { args: ['branch', '-D', 'main'] }), /^ERROR: git branch 只允許查詢旗標/);
  assert.match(await exec('git', { args: ['grep', '-O', 'sh', 'x'] }), /^ERROR: 不允許 git 旗標 -O/);
  assert.match(await exec('git', { args: ['diff', '--output=/tmp/x'] }), /^ERROR: 不允許 git 旗標/);
  assert.match(await exec('git', { args: ['diff', '--no-index', '/etc/passwd', '/etc/hosts'] }), /^ERROR/);
  assert.match(await exec('git', { args: ['branch', '--list', 'ma*'] }), /main/);
  assert.match(await exec('git', { args: ['branch', '--show-current'] }), /main/);
  assert.match(await exec('git', { args: ['remote', '-v'] }), /無輸出|origin/);
  assert.equal(gitDeniedReason(['log', '--oneline', '-5']), null);
  assert.equal(gitDeniedReason(['remote', 'get-url', 'origin']), null);
  const cs = await exec('run_script', { script: 'changed-scope.js', args: ['--full'] });
  assert.match(cs, /^exit 0\n\[stdout\]\n/);
  assert.match(cs, /"mode": ?"full"/);
  assert.match(await exec('run_script', { script: 'rm-rf.js' }), /^ERROR: 未知 script/);
  const mc = await exec('run_script', { script: 'mermaid-check.js', args: ['docs/a.md'] });
  assert.match(mc, /^exit 0/);
});

test('executor: write_file/move_file gated by allowWrite and confined to repo or tmpdir; ask_user non-interactive', async () => {
  const { dir } = initRepo();
  const ro = createExecutor({ cwd: dir, docAlignRoot: ROOT });
  assert.match(await ro('write_file', { path: 'docs/new.md', content: 'x' }), /^ERROR: 本模式不允許寫檔/);
  assert.match(await ro('ask_user', { question: 'q?' }), /非互動環境/);
  const rw = createExecutor({ cwd: dir, docAlignRoot: ROOT, allowWrite: true, askUser: async () => '好' });
  assert.match(await rw('write_file', { path: 'docs/sub/new.md', content: '# new' }), /^已寫入/);
  assert.equal(readFileSync(join(dir, 'docs', 'sub', 'new.md'), 'utf8'), '# new');
  assert.match(await rw('write_file', { path: '/etc/passwd', content: 'x' }), /^ERROR: 只允許寫入/);
  assert.match(await rw('write_file', { path: '.git/config', content: 'x' }), /^ERROR: 不允許寫入 \.git/);
  assert.match(await rw('write_file', { path: join(ROOT, 'README.md'), content: 'x' }), /^ERROR/, 'doc-align root is readable, not writable');
  assert.match(await rw('move_file', { from: 'docs/sub/new.md', to: 'docs/moved.md' }), /^已搬移/);
  assert.ok(existsSync(join(dir, 'docs', 'moved.md')));
  assert.match(await rw('ask_user', { question: 'q?' }), /使用者回答：好/);
  assert.match(await rw('shell', { command: 'echo hi' }), /^ERROR: 未開啟 --allow-shell/);
  const sh = createExecutor({ cwd: dir, docAlignRoot: ROOT, allowShell: true });
  assert.match(await sh('shell', { command: 'echo hi' }), /exit 0\n\[stdout\]\nhi/);
  assert.match(await sh('unknown_tool', {}), /^ERROR: 未知工具/);
});

// ── agent-loop ───────────────────────────────────────────────────────────────

test('runAgent: tool call → tool result fed back with matching id → final content; usage summed', async () => {
  const bodies = [];
  const replies = [
    { content: null, tool_calls: [toolCall('c1', 'echo', { v: 'one' }), toolCall('c2', 'echo', { v: 'two' })] },
    { content: '最終報告' },
  ];
  const fetchImpl = async (_url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: replies[bodies.length - 1] }], usage: { prompt_tokens: 3, completion_tokens: 2 } }) };
  };
  const events = [];
  const r = await runAgent({
    cfg: { baseUrl: 'u', apiKey: 'k', model: 'm' }, system: 'S', user: 'U', tools: [{ type: 'function', function: { name: 'echo', parameters: {} } }],
    execute: async (name, args) => `${name}:${args.v}`, fetchImpl, onEvent: (e) => events.push(e.type),
  });
  assert.equal(r.content, '最終報告');
  assert.equal(r.turns, 2);
  assert.deepEqual(r.usage, { prompt_tokens: 6, completion_tokens: 4 });
  const second = bodies[1].messages;
  assert.equal(second[0].role, 'system');
  assert.equal(second[2].role, 'assistant');
  assert.equal(second[2].tool_calls[0].id, 'c1');
  assert.deepEqual(second.slice(3).map((m) => [m.role, m.tool_call_id, m.content]), [['tool', 'c1', 'echo:one'], ['tool', 'c2', 'echo:two']]);
  assert.ok(events.includes('tool') && events.includes('tool_result'));
});

test('runAgent: invalid JSON args become an ERROR tool result; empty replies get nudged; maxTurns → exhausted error', async () => {
  let n = 0;
  const seq = [
    { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'echo', arguments: '{bad' } }] },
    { content: '' },
    { content: 'done' },
  ];
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: seq[n++] }] }) });
  const executed = [];
  const r = await runAgent({ cfg: { baseUrl: 'u', apiKey: 'k', model: 'm' }, system: 'S', user: 'U', tools: [], execute: async (nm, a) => { executed.push([nm, a]); return 'ok'; }, fetchImpl });
  assert.equal(r.content, 'done');
  assert.equal(executed.length, 0, 'bad JSON never reaches the executor');

  const loop = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: null, tool_calls: [toolCall('a', 'echo', {})] } }] }) });
  await assert.rejects(
    () => runAgent({ cfg: { baseUrl: 'u', apiKey: 'k', model: 'm' }, system: 'S', user: 'U', tools: [], execute: async () => 'r', fetchImpl: loop, maxTurns: 3 }),
    (e) => e.exhausted === true && /超過 3 輪/.test(e.message),
  );
});

test('trimContext omits oldest tool outputs first and never touches system/user', () => {
  const msgs = [
    { role: 'system', content: 's'.repeat(100) }, { role: 'user', content: 'u'.repeat(100) },
    { role: 'assistant', content: null, tool_calls: [] },
    { role: 'tool', tool_call_id: '1', content: 'a'.repeat(1000) },
    { role: 'tool', tool_call_id: '2', content: 'b'.repeat(1000) },
  ];
  trimContext(msgs, 1500);
  assert.match(msgs[3].content, /已省略/);
  assert.equal(msgs[4].content, 'b'.repeat(1000));
  assert.equal(msgs[0].content.length, 100);
});

// ── prompt ───────────────────────────────────────────────────────────────────

test('system prompt embeds the playbook, maps <SCRIPTS> to run_script and states the write policy', () => {
  const pb = readFileSync(join(ROOT, 'playbook', 'check.md'), 'utf8');
  const s = buildAgentSystemPrompt({ subcommand: 'check', playbook: pb, root: '/r', cwd: '/w', allowWrite: false, allowShell: false });
  assert.ok(s.includes('## Drift 報告格式'));
  assert.ok(s.includes('run_script'));
  assert.ok(s.includes('沒有任何寫檔工具'));
  assert.ok(s.includes('<SCRIPTS> ＝ /r/scripts'));
  const s2 = buildAgentSystemPrompt({ subcommand: 'init', playbook: 'P', root: '/r', cwd: '/w', allowWrite: true, allowShell: true });
  assert.ok(s2.includes('write_file') && s2.includes('shell 工具已開放'));
  assert.equal(buildAgentUserPrompt('check', ['--range', 'a...b']).split('\n')[0], '執行：doc-align check --range a...b');
});

// ── CLI end-to-end ───────────────────────────────────────────────────────────

test('cli: usage/validation errors exit 1 with usage; --version prints', async () => {
  assert.equal((await runCli([])).code, 1);
  assert.match((await runCli(['--help'])).stdout, /doc-align sync \[--dry-run\]/);
  assert.equal((await runCli(['--help'])).code, 0);
  assert.match((await runCli(['bogus'])).stderr, /需要子命令/);
  assert.match((await runCli(['check', '--repair'])).stderr, /--repair 只適用於 init/);
  assert.match((await runCli(['check', '--direct'])).stderr, /--direct 需要 --range/);
  assert.match((await runCli(['sync', '--direct', '--range', 'a...b'])).stderr, /--direct 只適用於 sync --dry-run/);
  assert.match((await runCli(['sync', '--ci'])).stderr, /--ci 只適用於 init/);
  assert.match((await runCli(['init', '--dry-run'])).stderr, /--dry-run 只適用於 sync/);
  assert.match((await runCli(['--help'])).stdout, /doc-align init \[--repair\] \[--ci\]/);
  assert.match((await runCli(['--version'])).stdout, /^\d+\.\d+\.\d+/);
});

test('cli: render is zero-LLM and reports summary; missing manifest is a clear error', async () => {
  const { dir } = initRepo();
  const r = await runCli(['render', '--out', 'out/h.html'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /handbook 已輸出：out\/h\.html（1 個 section）/);
  assert.ok(existsSync(join(dir, 'out', 'h.html')));
  const bare = mkdtempSync(join(tmpdir(), 'docalign-bare-'));
  const r2 = await runCli(['render'], { cwd: bare });
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /docs\/\.docalign\.yml/);
});

test('cli: check (agent mode) drives the tool loop end-to-end and prints the final report', async () => {
  const { dir, git } = initRepo();
  writeFileSync(join(dir, 'src', 'a.py'), 'def f():\n    return 2\n');
  git('add', '-A'); git('commit', '-qm', 'change');

  const gw = await mockGateway([
    { content: null, tool_calls: [toolCall('t1', 'run_script', { script: 'changed-scope.js', args: ['--range', 'base...HEAD'] })] },
    { content: null, tool_calls: [toolCall('t2', 'read_file', { path: 'docs/a.md' }), toolCall('t3', 'git', { args: ['diff', 'base...HEAD', '--', 'src/a.py'] })] },
    { content: null, tool_calls: [toolCall('t4', 'write_file', { path: 'docs/a.md', content: 'hacked' })] },
    { content: '## docs/a.md\n\n- 文件位置：規則 1\n- 判斷：(a) 文件過時\n\n## 涵蓋範圍\n\n- docs/a.md\n\n## 未涵蓋的變動\n\n無' },
  ]);
  try {
    const r = await runCli(['check', '--range', 'base...HEAD'], { cwd: dir, env: gw.env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^## docs\/a\.md/);
    assert.match(r.stdout, /## 未涵蓋的變動/);
    assert.equal(gw.requests.length, 4);
    assert.equal(gw.requests[0].auth, 'Bearer test-key');
    const first = gw.requests[0].body;
    assert.equal(first.model, 'mock');
    assert.ok(first.tools.some((t) => t.function.name === 'run_script'));
    assert.ok(!first.tools.some((t) => t.function.name === 'write_file'), 'check has no write tool');
    assert.match(first.messages[0].content, /## Drift 報告格式/, 'playbook embedded in system prompt');
    assert.match(first.messages[1].content, /doc-align check --range base\.\.\.HEAD/);
    assert.ok(!existsSync(join(dir, 'docs', 'handbook.html')), 'dry-run never renders');
    // 第二輪：changed-scope 的 JSON 已回填
    const m2 = gw.requests[1].body.messages;
    assert.equal(m2[m2.length - 1].role, 'tool');
    assert.equal(m2[m2.length - 1].tool_call_id, 't1');
    assert.match(m2[m2.length - 1].content, /"status": ?"affected"/);
    // 第三輪：read_file 與 git diff 都回填
    const m3 = gw.requests[2].body.messages;
    const tools3 = m3.filter((m) => m.role === 'tool');
    assert.match(tools3.find((m) => m.tool_call_id === 't2').content, /f 回傳 1/);
    assert.match(tools3.find((m) => m.tool_call_id === 't3').content, /\+    return 2/);
    // 第四輪：write_file 在 check 模式被拒，且檔案未變
    const m4 = gw.requests[3].body.messages;
    assert.match(m4[m4.length - 1].content, /ERROR: (未知工具 write_file|本模式不允許寫檔)/);
    assert.equal(readFileSync(join(dir, 'docs', 'a.md'), 'utf8').includes('hacked'), false);
    assert.match(r.stderr, /agent 模式/);
    assert.match(r.stderr, /→ run_script changed-scope\.js/);
  } finally { gw.close(); }
});

test('cli: init (agent mode) exposes write tools and --out writes the final report; --yes makes ask_user non-interactive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-init-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const gw = await mockGateway([
    { content: null, tool_calls: [toolCall('a1', 'ask_user', { question: '要不要 class 文件？' })] },
    { content: null, tool_calls: [toolCall('a2', 'write_file', { path: 'docs/x.md', content: '# X' })] },
    { content: '建立了 docs/x.md' },
  ]);
  try {
    const r = await runCli(['init', '--yes', '--quiet', '--out', 'report.md'], { cwd: dir, env: gw.env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(readFileSync(join(dir, 'report.md'), 'utf8'), '建立了 docs/x.md\n');
    assert.equal(readFileSync(join(dir, 'docs', 'x.md'), 'utf8'), '# X');
    assert.ok(gw.requests[0].body.tools.some((t) => t.function.name === 'write_file'));
    const m2 = gw.requests[1].body.messages;
    assert.match(m2[m2.length - 1].content, /非互動環境/);
    assert.match(gw.requests[0].body.messages[0].content, /doc-align init — 文件集初始化程序/);
  } finally { gw.close(); }
});

test('cli: check --direct delegates to llm-check.js (single packed request, no tools)', async () => {
  const { dir, git } = initRepo();
  writeFileSync(join(dir, 'src', 'a.py'), 'def f():\n    return 2\n');
  git('add', '-A'); git('commit', '-qm', 'change');
  const gw = await mockGateway([{ content: '- 文件位置：docs/a.md\n- 判斷：(a) 文件過時' }]);
  try {
    const r = await runCli(['check', '--direct', '--range', 'base...HEAD', '--out', 'rep.md'], { cwd: dir, env: gw.env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(gw.requests.length, 1);
    assert.equal(gw.requests[0].body.tools, undefined);
    assert.match(readFileSync(join(dir, 'rep.md'), 'utf8'), /## docs\/a\.md[\s\S]*文件過時[\s\S]*## 涵蓋範圍/);
  } finally { gw.close(); }
});

test('cli: missing LLM env in agent mode → clear error, exit 1; --max-turns exhaustion → exit 2', async () => {
  const { dir } = initRepo();
  const r = await runCli(['check'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /DOC_ALIGN_LLM_BASE_URL/);
  const gw = await mockGateway([{ content: null, tool_calls: [toolCall('l', 'glob', { pattern: '**' })] }]);
  try {
    const r2 = await runCli(['check', '--max-turns', '2', '--quiet'], { cwd: dir, env: gw.env });
    assert.equal(r2.code, 2);
    assert.match(r2.stderr, /超過 2 輪/);
    assert.equal(gw.requests.length, 2);
  } finally { gw.close(); }
});

test('cli: sync --dry-run ≡ check (read-only, check playbook, no render); sync (wet) auto-renders handbook; --no-render skips', async () => {
  const { dir } = initRepo();
  const gw = await mockGateway([{ content: '無 drift，文件與程式碼對齊\n\n## 涵蓋範圍\n\n- docs/a.md\n\n## 未涵蓋的變動\n\n無' }]);
  try {
    const dry = await runCli(['sync', '--dry-run', '--quiet'], { cwd: dir, env: gw.env });
    assert.equal(dry.code, 0, dry.stderr);
    const b = gw.requests[0].body;
    assert.match(b.messages[0].content, /doc-align check — drift 偵測程序/, 'dry-run uses check playbook');
    assert.ok(!b.tools.some((t) => t.function.name === 'write_file'), 'dry-run is read-only');
    assert.ok(!existsSync(join(dir, 'docs', 'handbook.html')));

    const wet = await runCli(['sync'], { cwd: dir, env: gw.env });
    assert.equal(wet.code, 0, wet.stderr);
    const b2 = gw.requests[1].body;
    assert.match(b2.messages[0].content, /doc-align sync — 偵測並套用文件更新程序/, 'sync uses sync playbook');
    assert.ok(b2.tools.some((t) => t.function.name === 'write_file'));
    assert.ok(existsSync(join(dir, 'docs', 'handbook.html')), 'sync auto-renders');
    assert.match(wet.stderr, /handbook 已輸出/);

    const { rmSync } = await import('node:fs');
    rmSync(join(dir, 'docs', 'handbook.html'));
    const nr = await runCli(['sync', '--no-render', '--quiet'], { cwd: dir, env: gw.env });
    assert.equal(nr.code, 0, nr.stderr);
    assert.ok(!existsSync(join(dir, 'docs', 'handbook.html')), '--no-render respected');
    const b3 = gw.requests[2].body;
    assert.match(b3.messages[1].content, /--no-render/, 'flag forwarded to playbook');
  } finally { gw.close(); }
});

test('cli: init auto-renders when a manifest exists afterwards; configure alias uses configure playbook; init --ci forwards --ci', async () => {
  const { dir } = initRepo();
  const gw = await mockGateway([{ content: '完成' }]);
  try {
    const r = await runCli(['init', '--ci', '--quiet'], { cwd: dir, env: gw.env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(gw.requests[0].body.messages[0].content, /doc-align init — 文件集初始化程序/);
    assert.match(gw.requests[0].body.messages[1].content, /doc-align init --ci/);
    assert.ok(existsSync(join(dir, 'docs', 'handbook.html')), 'init auto-renders');
    const c = await runCli(['configure', '--quiet'], { cwd: dir, env: gw.env });
    assert.equal(c.code, 0, c.stderr);
    assert.match(gw.requests[1].body.messages[0].content, /doc-align configure — 初次接入設定程序/);
    assert.ok(gw.requests[1].body.tools.some((t) => t.function.name === 'write_file'), 'configure can write CI files');
  } finally { gw.close(); }
});
