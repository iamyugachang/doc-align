#!/usr/bin/env node
// bin/doc-align.js — doc-align 獨立 CLI（情境二：不依賴任何 agent harness，直接進目標 repo 跑）。
//
//   doc-align check [--full | --range <git range>] [--direct] [--out <path>]
//   doc-align sync
//   doc-align init [--repair]
//   doc-align render [--out <path>]
//   doc-align configure
//
// 通用選項：-C <dir>（先 chdir）、--model <id>、--max-turns <n>、--allow-shell、--yes（非互動）、
//          --quiet、--verbose、--help、--version
// LLM 設定：env DOC_ALIGN_LLM_BASE_URL／_API_KEY／_MODEL（可放 ~/.config/doc-align/env）。
//
// 模式：
//   render                  — 零 LLM，直接呼叫 render-handbook.js。
//   check --direct          — 既有的單次打包模式（scripts/llm-check.js），CI 預設用這條。
//   check／sync／init／configure — 內建 agent loop：以 playbook 為 system prompt，模型透過
//                             受限工具（讀檔／grep／git 唯讀／自家 scripts／[寫檔]）自行探索。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../scripts/lib/agent-loop.js';
import { buildAgentSystemPrompt, buildAgentUserPrompt } from '../scripts/lib/agent-prompt.js';
import { createExecutor, toolDefinitions } from '../scripts/lib/agent-tools.js';
import { llmConfigFromEnv, loadEnvFile } from '../scripts/lib/llm-client.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUBCOMMANDS = ['check', 'sync', 'init', 'render', 'configure'];
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';

const USAGE = `doc-align ${VERSION} — 讓 docs/ 文件集與程式碼對齊

用法：
  doc-align check [--full | --range <git range>] [--direct] [--out <path>]
  doc-align sync
  doc-align init [--repair]
  doc-align render [--out <path>]
  doc-align configure

通用選項：
  -C <dir>            先切換到該目錄（目標 repo 根）
  --model <id>        覆寫 DOC_ALIGN_LLM_MODEL
  --max-turns <n>     agent 迴圈上限（預設 60）
  --allow-shell       開放 shell 工具（預設關閉；需要 codegraph 等外部工具時再開）
  --yes               非互動：ask_user 一律回「非互動」（CI／管線用）
  --quiet             不印進度到 stderr
  --verbose           進度含工具輸出預覽
  -h, --help / --version

LLM 設定（env，或寫在 ~/.config/doc-align/env 每行 KEY=VALUE）：
  DOC_ALIGN_LLM_BASE_URL   OpenAI-compatible endpoint（含 /v1）
  DOC_ALIGN_LLM_API_KEY
  DOC_ALIGN_LLM_MODEL
  DOC_ALIGN_LLM_TIMEOUT_MS（選配，單次請求逾時，預設 300000）
  DOC_ALIGN_AGENT_MAX_CONTEXT_CHARS（選配，上下文字元預算，預設 400000）
`;

function parseCli(argv) {
  const o = { sub: null, passthrough: [], out: null, direct: false, allowShell: false, yes: false, quiet: false, verbose: false, model: null, maxTurns: null, chdir: null };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    const take = () => { if (!rest.length || rest[0].startsWith('-')) throw new Error(`${a} 需要一個值`); return rest.shift(); };
    if (a === '-h' || a === '--help') { o.help = true; }
    else if (a === '--version') { o.version = true; }
    else if (a === '-C') o.chdir = take();
    else if (a === '--model') o.model = take();
    else if (a === '--max-turns') o.maxTurns = Number(take());
    else if (a === '--allow-shell') o.allowShell = true;
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--quiet' || a === '-q') o.quiet = true;
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--direct') o.direct = true;
    else if (a === '--out') o.out = take();
    else if (!o.sub && !a.startsWith('-')) o.sub = a;
    else if (a === '--full' || a === '--repair') o.passthrough.push(a);
    else if (a === '--range') o.passthrough.push(a, take());
    else throw new Error(`不認得的參數：${a}`);
  }
  return o;
}

function validate(o) {
  if (!SUBCOMMANDS.includes(o.sub)) throw new Error(`需要子命令：${SUBCOMMANDS.join(' | ')}`);
  const has = (f) => o.passthrough.includes(f);
  if (has('--repair') && o.sub !== 'init') throw new Error('--repair 只適用於 init');
  if ((has('--full') || has('--range')) && o.sub !== 'check') throw new Error('--full／--range 只適用於 check');
  if (o.direct && o.sub !== 'check') throw new Error('--direct 只適用於 check');
  if (o.direct && !has('--range')) throw new Error('--direct 需要 --range <git range>');
  if (o.out && !['check', 'render', 'sync', 'init', 'configure'].includes(o.sub)) throw new Error('--out 不適用於此子命令');
  if (has('--full') && has('--range')) {
    console.error('doc-align: 同時給了 --full 與 --range，以 --full 為準（忽略 --range）');
    const i = o.passthrough.indexOf('--range');
    o.passthrough.splice(i, 2);
  }
}

function runNode(script, args, { inherit = false } = {}) {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', script), ...args], { stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    if (!inherit) { child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; }); }
    child.on('close', (code) => resolveP({ code, stdout, stderr }));
  });
}

async function cmdRender(o) {
  if (!existsSync('docs/.docalign.yml')) throw new Error('找不到 docs/.docalign.yml，請先執行 doc-align init');
  if (o.out) mkdirSync(dirname(o.out), { recursive: true });
  const args = o.out ? ['--out', o.out] : [];
  const r = await runNode('render-handbook.js', args);
  if (r.code !== 0) throw new Error(`render-handbook.js 失敗（exit ${r.code}）\n${r.stderr || r.stdout}`);
  let summary;
  try { summary = JSON.parse(r.stdout); } catch { process.stdout.write(r.stdout); return 0; }
  const lines = [`handbook 已輸出：${summary.out}（${summary.sections} 個 section）`];
  if (summary.skipped?.length) {
    lines.push(`跳過 ${summary.skipped.length} 個 manifest 條目（檔案不存在）：${summary.skipped.join('、')}`);
    lines.push('這通常代表 manifest 與 docs/ 不同步，建議跑一次 doc-align check；render 本身不裁決 drift。');
  }
  lines.push('提醒：handbook 是生成物，內容以 manifest 目前狀態為準；是否提交進版控由你決定。');
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

async function cmdCheckDirect(o) {
  const args = [...o.passthrough];
  if (o.out) args.push('--out', o.out);
  const r = await runNode('llm-check.js', args, { inherit: true });
  return r.code;
}

function makeAskUser(o) {
  if (o.yes || !process.stdin.isTTY) return async () => null;
  return (question) => new Promise((resolveP) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(`\n┌─ doc-align 需要你裁決 ──────────────\n${question}\n└─ 輸入回答後按 Enter（空行＝交由 agent 依預設處理）：\n`);
    rl.question('> ', (ans) => { rl.close(); resolveP(ans.trim() === '' ? '（使用者未提供回答，請依 playbook 預設處理）' : ans); });
  });
}

function makeReporter(o) {
  if (o.quiet) return () => {};
  const err = (s) => process.stderr.write(s);
  return (ev) => {
    if (ev.type === 'turn') err(`\x1b[2m[turn ${ev.turn}] ctx≈${Math.round(ev.chars / 1000)}k chars\x1b[0m\n`);
    else if (ev.type === 'tool') {
      const a = ev.args || {};
      const brief = a.script ? `${a.script} ${(a.args || []).join(' ')}` : (a.path || a.pattern || (a.args && a.args.join(' ')) || a.question || a.command || a.from || '');
      err(`  → ${ev.name} ${String(brief).slice(0, 120)}\n`);
    } else if (ev.type === 'tool_result' && o.verbose) {
      err(`\x1b[2m${String(ev.result).split('\n').slice(0, 8).map((l) => `      ${l.slice(0, 160)}`).join('\n')}\x1b[0m\n`);
    } else if (ev.type === 'nudge') err('  → （模型空回覆，催促續行）\n');
  };
}

async function cmdAgent(o) {
  const env = loadEnvFile(process.env);
  if (o.model) env.DOC_ALIGN_LLM_MODEL = o.model;
  const cfg = llmConfigFromEnv(env, { label: 'doc-align' });
  const cwd = process.cwd();
  const allowWrite = ['init', 'sync', 'configure'].includes(o.sub);
  const playbook = readFileSync(join(ROOT, 'playbook', `${o.sub}.md`), 'utf8');
  const system = buildAgentSystemPrompt({ subcommand: o.sub, playbook, root: ROOT, cwd, allowWrite, allowShell: o.allowShell });
  const user = buildAgentUserPrompt(o.sub, o.passthrough);
  const tools = toolDefinitions({ allowWrite, allowShell: o.allowShell });
  const execute = createExecutor({ cwd, docAlignRoot: ROOT, allowWrite, allowShell: o.allowShell, askUser: makeAskUser(o) });
  const maxTurns = o.maxTurns || Number(env.DOC_ALIGN_AGENT_MAX_TURNS || 60);
  const maxContextChars = Number(env.DOC_ALIGN_AGENT_MAX_CONTEXT_CHARS || 400_000);
  const onEvent = makeReporter(o);

  if (!o.quiet) process.stderr.write(`doc-align ${o.sub}（agent 模式，model ${cfg.model}，${allowWrite ? '可寫檔' : '唯讀'}${o.allowShell ? '，shell 開放' : ''}）\n`);

  let result;
  try {
    result = await runAgent({ cfg, system, user, tools, execute, maxTurns, maxContextChars, onEvent, label: 'doc-align' });
  } catch (e) {
    if (e.exhausted) {
      console.error(`doc-align: ${e.message}`);
      return 2;
    }
    throw e;
  }
  const out = `${result.content.trim()}\n`;
  if (o.out) { writeFileSync(o.out, out); if (!o.quiet) process.stderr.write(`已寫出 ${o.out}\n`); }
  else process.stdout.write(out);
  if (!o.quiet) process.stderr.write(`\x1b[2m完成：${result.turns} 輪，tokens in/out ≈ ${result.usage.prompt_tokens}/${result.usage.completion_tokens}\x1b[0m\n`);
  return 0;
}

async function main() {
  let o;
  try {
    o = parseCli(process.argv.slice(2));
    if (o.help || (!o.sub && !o.version)) { process.stdout.write(USAGE); return o.help ? 0 : 1; }
    if (o.version) { process.stdout.write(`${VERSION}\n`); return 0; }
    validate(o);
  } catch (e) {
    console.error(`doc-align: ${e.message}\n`);
    process.stderr.write(USAGE);
    return 1;
  }
  if (o.chdir) process.chdir(o.chdir);
  if (o.sub === 'render') return cmdRender(o);
  if (o.sub === 'check' && o.direct) return cmdCheckDirect(o);
  return cmdAgent(o);
}

main().then((code) => process.exit(code), (err) => {
  console.error(err.message.startsWith('doc-align:') ? err.message : `doc-align: ${err.message}`);
  process.exit(1);
});
