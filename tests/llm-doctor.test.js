import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../scripts/llm-doctor.js', import.meta.url).pathname;

function mockGateway({ rejectTools = false } = {}) {
  const server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const p = JSON.parse(b);
      if (p.tools && rejectTools) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'tools not supported' } }));
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function runDoctor(env) {
  return new Promise((resolve) => {
    execFile('node', [SCRIPT], { env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, json: JSON.parse(stdout), stderr });
    });
  });
}

test('doctor: full-support gateway → chat + tools ok, exit 0', async () => {
  const server = await mockGateway();
  try {
    const { code, json } = await runDoctor({
      DOC_ALIGN_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
      DOC_ALIGN_LLM_API_KEY: 'k',
      DOC_ALIGN_LLM_MODEL: 'm',
    });
    assert.equal(code, 0);
    assert.equal(json.ok, true);
    assert.equal(json.results.chat.ok, true);
    assert.equal(json.results.tools.ok, true);
  } finally { server.close(); }
});

test('doctor: gateway rejects tools → chat ok (direct mode), tools flagged, still exit 0', async () => {
  const server = await mockGateway({ rejectTools: true });
  try {
    const { code, json, stderr } = await runDoctor({
      DOC_ALIGN_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
      DOC_ALIGN_LLM_API_KEY: 'k',
      DOC_ALIGN_LLM_MODEL: 'm',
    });
    assert.equal(code, 0, 'direct 模式仍可用，不算失敗');
    assert.equal(json.results.chat.ok, true);
    assert.equal(json.results.tools.ok, false);
    assert.match(stderr, /direct 模式/);
  } finally { server.close(); }
});

test('doctor: reads ~/.config/doc-align/env when shell vars are absent, and labels the source', async () => {
  const server = await mockGateway();
  const fakeHome = mkdtempSync(join(tmpdir(), 'docalign-doctor-'));
  mkdirSync(join(fakeHome, '.config', 'doc-align'), { recursive: true });
  writeFileSync(join(fakeHome, '.config', 'doc-align', 'env'),
    `DOC_ALIGN_LLM_BASE_URL=http://127.0.0.1:${server.address().port}/v1\n` +
    'DOC_ALIGN_LLM_API_KEY=file-key\nDOC_ALIGN_LLM_MODEL=file-model\n');
  try {
    const { code, json, stderr } = await runDoctor({
      HOME: fakeHome,
      DOC_ALIGN_LLM_BASE_URL: '', DOC_ALIGN_LLM_API_KEY: '', DOC_ALIGN_LLM_MODEL: '',
    });
    assert.equal(code, 0, stderr);
    assert.equal(json.results.chat.ok, true);
    assert.match(stderr, /設定檔/);
  } finally { server.close(); }
});

test('doctor: missing env → probes skipped, exit 1 with hints', async () => {
  const { code, json, stderr } = await runDoctor({
    DOC_ALIGN_LLM_BASE_URL: '', DOC_ALIGN_LLM_API_KEY: '', DOC_ALIGN_LLM_MODEL: '',
  });
  assert.equal(code, 1);
  assert.equal(json.ok, false);
  assert.equal(json.results.env_base_url.ok, false);
  assert.match(stderr, /env 不完整，跳過 endpoint 探測/);
});

test('doctor: unreachable endpoint → connection failure reported with intranet hints, exit 1', async () => {
  const { code, json, stderr } = await runDoctor({
    DOC_ALIGN_LLM_BASE_URL: 'http://127.0.0.1:1/v1',
    DOC_ALIGN_LLM_API_KEY: 'k',
    DOC_ALIGN_LLM_MODEL: 'm',
    DOC_ALIGN_LLM_TIMEOUT_MS: '3000',
  });
  assert.equal(code, 1);
  assert.equal(json.results.chat.ok, false);
  assert.match(stderr, /proxy|NODE_EXTRA_CA_CERTS/);
});
