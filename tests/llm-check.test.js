import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatComplete, llmConfigFromEnv } from '../scripts/lib/llm-client.js';
import {
  buildCheckPrompt, buildSystemPrompt, extractCitations, extractReportFormat, sliceLines,
} from '../scripts/lib/check-context.js';

const SCRIPT = new URL('../scripts/llm-check.js', import.meta.url).pathname;

// ── check-context ────────────────────────────────────────────────────────────

test('extractCitations parses single lines, ranges, and dedups', () => {
  const md = '規則（app/x.py:12）與（app/x.py:12）與（lib/y.sql:3-9）';
  assert.deepEqual(extractCitations(md), [
    { file: 'app/x.py', start: 12, end: 12 },
    { file: 'lib/y.sql', start: 3, end: 9 },
  ]);
});

test('sliceLines returns numbered lines with radius, clamped to file bounds', () => {
  const text = Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join('\n');
  const s = sliceLines(text, 2, 3, { radius: 1 });
  assert.equal(s.from, 1);
  assert.equal(s.to, 4);
  assert.equal(s.total, 10);
  assert.match(s.text, /^\s+1  L1\n\s+2  L2\n\s+3  L3\n\s+4  L4$/);
});

test('buildCheckPrompt keeps doc, truncates diff and snippets under budget and reports it', () => {
  const { prompt, truncated } = buildCheckPrompt({
    docPath: 'a.md',
    docText: '# A\n\n規則',
    range: 'main...HEAD',
    matchedFiles: ['src/x.py'],
    diff: 'x'.repeat(5_000),
    snippets: [
      { file: 'src/x.py', start: 1, end: 2, from: 1, to: 3, total: 3, text: 'y'.repeat(2_000) },
      { file: 'src/z.py', start: 1, end: 1, missing: true },
    ],
    maxChars: 4_000,
  });
  assert.ok(prompt.includes('docs/a.md'));
  assert.ok(prompt.includes('src/x.py'));
  assert.ok(prompt.length <= 4_500, `prompt length ${prompt.length}`);
  assert.ok(truncated.some((t) => t.startsWith('diff')));
  assert.ok(truncated.some((t) => t.includes('證據片段')));
});

test('buildCheckPrompt with small inputs truncates nothing and includes missing-file marker', () => {
  const { prompt, truncated } = buildCheckPrompt({
    docPath: 'a.md', docText: '# A', range: 'r', matchedFiles: [], diff: '',
    snippets: [{ file: 'gone.py', start: 1, end: 1, missing: true }],
  });
  assert.deepEqual(truncated, []);
  assert.ok(prompt.includes('檔案不存在於目前工作樹'));
});

test('extractReportFormat pulls the section from check.md and system prompt embeds it', () => {
  const pb = '# check\n\n步驟\n\n## Drift 報告格式\n\n每條 drift 必須包含四項';
  const fmt = extractReportFormat(pb);
  assert.ok(fmt.startsWith('## Drift 報告格式'));
  const sys = buildSystemPrompt(fmt);
  assert.ok(sys.includes('每條 drift 必須包含四項'));
  assert.ok(sys.includes('只報告、不改檔'));
  assert.equal(extractReportFormat('no section'), '');
});

// ── llm-client ───────────────────────────────────────────────────────────────

test('llmConfigFromEnv requires the three neutral vars and strips trailing slash', () => {
  assert.throws(() => llmConfigFromEnv({}), /DOC_ALIGN_LLM_BASE_URL, DOC_ALIGN_LLM_API_KEY, DOC_ALIGN_LLM_MODEL/);
  const cfg = llmConfigFromEnv({ DOC_ALIGN_LLM_BASE_URL: 'https://gw/v1/', DOC_ALIGN_LLM_API_KEY: 'k', DOC_ALIGN_LLM_MODEL: 'm' });
  assert.equal(cfg.baseUrl, 'https://gw/v1');
});

test('chatComplete posts OpenAI-shaped body with bearer auth and returns content', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '報告本體' } }] }) };
  };
  const out = await chatComplete({ baseUrl: 'https://gw/v1', apiKey: 'sk', model: 'm1' }, [{ role: 'user', content: 'hi' }], fetchImpl);
  assert.equal(out, '報告本體');
  assert.equal(captured.url, 'https://gw/v1/chat/completions');
  assert.equal(captured.init.headers.Authorization, 'Bearer sk');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, 'm1');
  assert.equal(body.stream, false);
});

test('chatComplete flattens array content and surfaces HTTP errors', async () => {
  const arr = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] }) });
  assert.equal(await chatComplete({ baseUrl: 'u', apiKey: 'k', model: 'm' }, [], arr), 'ab');
  const bad = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  await assert.rejects(() => chatComplete({ baseUrl: 'u', apiKey: 'k', model: 'm' }, [], bad), /HTTP 401/);
});

// ── CLI end-to-end against a mock gateway ────────────────────────────────────

test('chatComplete retries on 5xx when cfg.retries set; 4xx fails immediately', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls += 1;
    if (calls === 1) { res.statusCode = 503; res.end('busy'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const text = await chatComplete({ baseUrl: base, apiKey: 'k', model: 'm', timeoutMs: 5000, retries: 1 }, [{ role: 'user', content: 'x' }]);
    assert.equal(text, 'ok');
    assert.equal(calls, 2, 'one retry after the 503');
  } finally { server.close(); }

  let authCalls = 0;
  const authServer = createServer((req, res) => { authCalls += 1; res.statusCode = 401; res.end('no'); });
  await new Promise((r) => authServer.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(
      () => chatComplete({ baseUrl: `http://127.0.0.1:${authServer.address().port}/v1`, apiKey: 'k', model: 'm', timeoutMs: 5000, retries: 3 }, [{ role: 'user', content: 'x' }]),
      /HTTP 401/,
    );
    assert.equal(authCalls, 1, '4xx is not retried');
  } finally { authServer.close(); }
});

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'docalign-llm-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.py'), 'def f():\n    return 1\n');
  writeFileSync(join(dir, 'docs', 'a.md'), '# A\n\n## 行為規則\n\n1. f 回傳 1（src/a.py:2）\n');
  writeFileSync(join(dir, 'docs', '.docalign.yml'),
    '# managed by doc-align\ndocs:\n  - path: a.md\n    type: sequence\n    watch:\n      - src/**\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('branch', 'base');
  return { dir, git };
}

test('llm-check: untouched watch scope → no LLM call, "無 drift" report', () => {
  const { dir, git } = initRepo();
  writeFileSync(join(dir, 'README.md'), 'x');
  git('add', '-A'); git('commit', '-qm', 'readme');
  const out = execFileSync('node', [SCRIPT, '--range', 'base...HEAD'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, DOC_ALIGN_LLM_BASE_URL: '', DOC_ALIGN_LLM_API_KEY: '', DOC_ALIGN_LLM_MODEL: '' },
  });
  assert.match(out, /無 drift/);
  assert.match(out, /未涵蓋的變動[\s\S]*README\.md/);
});

test('llm-check: affected doc → one chat/completions call with doc+diff+snippet, report written', async () => {
  const { dir, git } = initRepo();
  writeFileSync(join(dir, 'src', 'a.py'), 'def f():\n    return 2\n');
  git('add', '-A'); git('commit', '-qm', 'change');

  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '- 文件位置：docs/a.md 規則 1\n- 判斷：(a) 文件過時' } }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const outPath = join(dir, 'report.md');
    // 必須用非同步 execFile：同步版會卡住本 process 的 event loop，同 process 的 mock
    // server 永遠回不了子程序的請求 → 死鎖。
    await new Promise((resolve, reject) => execFile('node', [SCRIPT, '--range', 'base...HEAD', '--out', outPath], {
      cwd: dir,
      env: { ...process.env, DOC_ALIGN_LLM_BASE_URL: `http://127.0.0.1:${port}/v1`, DOC_ALIGN_LLM_API_KEY: 'test-key', DOC_ALIGN_LLM_MODEL: 'mock' },
    }, (err, _stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve())));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/chat/completions');
    assert.equal(requests[0].auth, 'Bearer test-key');
    const user = requests[0].body.messages.find((m) => m.role === 'user').content;
    assert.ok(user.includes('f 回傳 1'), 'doc text packed');
    assert.ok(user.includes('-    return 1') && user.includes('+    return 2'), 'diff packed');
    assert.ok(user.includes('src/a.py:2-2'), 'citation snippet packed');
    const { readFileSync } = await import('node:fs');
    const report = readFileSync(outPath, 'utf8');
    assert.match(report, /## docs\/a\.md/);
    assert.match(report, /文件過時/);
    assert.match(report, /## 涵蓋範圍[\s\S]*mock/);
  } finally {
    server.close();
  }
});

test('llm-check --incremental: per-doc last_verified range; unverified doc listed, not fatal', async () => {
  const { dir, git } = initRepo();
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  writeFileSync(join(dir, 'docs', 'b.md'), '# B\n\n1. g 回傳 1（src/b.py:1）\n');
  writeFileSync(join(dir, 'docs', '.docalign.yml'),
    '# managed by doc-align\ndocs:\n' +
    `  - path: a.md\n    type: sequence\n    watch:\n      - src/**\n    last_verified: ${baseSha}\n` +
    '  - path: b.md\n    type: sequence\n    watch:\n      - src/b.py\n');
  writeFileSync(join(dir, 'src', 'a.py'), 'def f():\n    return 2\n');
  git('add', '-A'); git('commit', '-qm', 'change');

  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ body: JSON.parse(body) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '- 判斷：(a) 文件過時' } }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const outPath = join(dir, 'report.md');
    await new Promise((resolve, reject) => execFile('node', [SCRIPT, '--incremental', '--out', outPath], {
      cwd: dir,
      env: { ...process.env, DOC_ALIGN_LLM_BASE_URL: `http://127.0.0.1:${port}/v1`, DOC_ALIGN_LLM_API_KEY: 'k', DOC_ALIGN_LLM_MODEL: 'mock' },
    }, (err, _stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve())));
    assert.equal(requests.length, 1, 'only the verified+affected doc hits the LLM');
    const user = requests[0].body.messages.find((m) => m.role === 'user').content;
    assert.ok(user.includes('-    return 1') && user.includes('+    return 2'), 'per-doc last_verified..HEAD diff packed');
    const { readFileSync } = await import('node:fs');
    const report = readFileSync(outPath, 'utf8');
    assert.match(report, /## docs\/a\.md/);
    assert.match(report, /尚未驗證的文件[\s\S]*docs\/b\.md/);
  } finally {
    server.close();
  }
});

test('llm-check --incremental: everything verified at HEAD → 無 drift, zero LLM', () => {
  const { dir, git } = initRepo();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  writeFileSync(join(dir, 'docs', '.docalign.yml'),
    '# managed by doc-align\ndocs:\n' +
    `  - path: a.md\n    type: sequence\n    watch:\n      - src/**\n    last_verified: ${head}\n`);
  git('add', '-A'); git('commit', '-qm', 'manifest');
  // manifest commit 本身不在 src/** watch 內 → 零 LLM
  const out = execFileSync('node', [SCRIPT, '--incremental'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, DOC_ALIGN_LLM_BASE_URL: '', DOC_ALIGN_LLM_API_KEY: '', DOC_ALIGN_LLM_MODEL: '' },
  });
  assert.match(out, /無 drift/);
  assert.match(out, /last_verified/);
});

test('llm-check: affected doc but missing LLM env → clear error, exit 1', () => {
  const { dir, git } = initRepo();
  writeFileSync(join(dir, 'src', 'a.py'), 'def f():\n    return 3\n');
  git('add', '-A'); git('commit', '-qm', 'change');
  assert.throws(
    () => execFileSync('node', [SCRIPT, '--range', 'base...HEAD'], {
      cwd: dir, stdio: 'pipe', env: { ...process.env, DOC_ALIGN_LLM_BASE_URL: '', DOC_ALIGN_LLM_API_KEY: '', DOC_ALIGN_LLM_MODEL: '' },
    }),
    /DOC_ALIGN_LLM_BASE_URL/,
  );
});
