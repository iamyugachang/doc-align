#!/usr/bin/env node
// bin/doc-align.js — doc-align 獨立 CLI（情境二：不依賴任何 agent harness，直接進目標 repo 跑）。
//
//   doc-align init [--repair] [--ci] [--no-render] [--out <report>]
//   doc-align sync [--dry-run] [--range <git range> | --full] [--direct] [--no-render] [--out <report>]
//   別名：check ≡ sync --dry-run；render [--out <html>]；configure ≡ init --ci 的 CI 接線段
//
// 通用選項：-C <dir>（先 chdir）、--model <id>、--max-turns <n>、--allow-shell、--yes（非互動）、
//          --quiet、--verbose、--help、--version
// LLM 設定：env DOC_ALIGN_LLM_BASE_URL／_API_KEY／_MODEL（可放 ~/.config/doc-align/env）。
//
// 模式：
//   render                  — 零 LLM，直接呼叫 render-handbook.js；init／sync 結束時自動跑。
//   sync --dry-run --direct — 既有的單次打包模式（scripts/llm-check.js），CI 預設用這條。
//   其餘                    — 內建 agent loop：以 playbook 為 system prompt，模型透過受限工具
//                             （讀檔／grep／git 唯讀／自家 scripts／[寫檔]）自行探索。

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
const SUBCOMMANDS = ['check', 'sync', 'init', 'render', 'configure', 'doctor'];
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';

const USAGE = `doc-align ${VERSION} — 讓 docs/ 文件集與程式碼對齊

用法：
  doc-align init [--repair] [--ci] [--style lean|rich] [--no-render]
      初始化文件集＋manifest，結束自動生成 docs/handbook.html；--ci 順便接 CI；
      --style 文件密度（預設 lean：圖優先、文字只寫圖說不了的關鍵）
  doc-align sync [--dry-run] [--range <git range> | --full] [--no-render]
      偵測 drift → 裁決 → 更新文件 → 推進 manifest → 自動 render
      --dry-run 只輸出 drift 報告、不寫任何檔案（CI 用這個）；--direct 改走單次打包（需 --range）

  doc-align doctor
      驗證 DOC_ALIGN_LLM_* 與 gateway 相容性（chat＋tools 探測；封閉環境部署前先跑這個）

別名（進階）：check ≡ sync --dry-run；render [--out <html>] 只重生 handbook（零 LLM）；
            configure ≡ init --ci 的 CI 接線段（不做初始化）

通用選項：
  -C <dir>            先切換到該目錄（目標 repo 根）
  --out <path>        把最終報告寫到檔案（render 時為 HTML 輸出路徑）
  --model <id>        覆寫 DOC_ALIGN_LLM_MODEL
  --max-turns <n>     agent 迴圈上限（預設 60）
  --allow-shell       開放 shell 工具（預設關閉；需要 codegraph 等外部工具時再開）
  --yes               非互動：ask_user 一律回「非互動」（CI／管線用）
  --quiet / --verbose 進度靜音／含工具輸出預覽
  -h, --help / --version

LLM 設定（env，或寫在 ~/.config/doc-align/env 每行 KEY=VALUE）：
  DOC_ALIGN_LLM_BASE_URL   OpenAI-compatible endpoint（含 /v1）
  DOC_ALIGN_LLM_API_KEY
  DOC_ALIGN_LLM_MODEL
  DOC_ALIGN_LLM_TIMEOUT_MS（選配，單次請求逾時，預設 300000）
  DOC_ALIGN_AGENT_MAX_CONTEXT_CHARS（選配，上下文字元預算，預設 400000）
`;

function parseCli(argv) {
  const o = { sub: null, passthrough: [], out: null, direct: false, dryRun: false, ci: false, noRender: false, allowShell: false, yes: false, quiet: false, verbose: false, model: null, maxTurns: null, chdir: null };
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
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--ci') o.ci = true;
    else if (a === '--no-render') o.noRender = true;
    else if (a === '--out') o.out = take();
    else if (!o.sub && !a.startsWith('-')) o.sub = a;
    else if (a === '--full' || a === '--repair') o.passthrough.push(a);
    else if (a === '--range' || a === '--style') o.passthrough.push(a, take());
    else throw new Error(`不認得的參數：${a}`);
  }
  return o;
}

// 正規化：別名 → 主命令。回傳 { playbook, allowWrite, render }。
function validate(o) {
  if (!SUBCOMMANDS.includes(o.sub)) throw new Error(`需要子命令：init | sync（別名 check／render／configure）`);
  const has = (f) => o.passthrough.includes(f);
  if (o.sub === 'check') { o.sub = 'sync'; o.dryRun = true; }
  if (o.sub === 'configure') { o.sub = 'init'; o.ci = true; o.configureOnly = true; }
  if (has('--repair') && o.sub !== 'init') throw new Error('--repair 只適用於 init');
  if (has('--style') && o.sub !== 'init') throw new Error('--style 只適用於 init');
  if (has('--style') && !['lean', 'rich'].includes(o.passthrough[o.passthrough.indexOf('--style') + 1])) throw new Error('--style 須為 lean 或 rich');
  if (o.ci && o.sub !== 'init') throw new Error('--ci 只適用於 init');
  if ((has('--full') || has('--range')) && o.sub !== 'sync') throw new Error('--full／--range 只適用於 sync（或別名 check）');
  if (o.dryRun && o.sub !== 'sync') throw new Error('--dry-run 只適用於 sync');
  if (o.direct && !(o.sub === 'sync' && o.dryRun)) throw new Error('--direct 只適用於 sync --dry-run（或別名 check）');
  if (o.direct && !has('--range')) throw new Error('--direct 需要 --range <git range>');
  if (o.noRender && o.sub === 'render') throw new Error('--no-render 與 render 互斥');
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

async function renderHandbook({ out = null, quiet = false } = {}) {
  if (!existsSync('docs/.docalign.yml')) throw new Error('找不到 docs/.docalign.yml，請先執行 doc-align init');
  if (out) mkdirSync(dirname(out), { recursive: true });
  const args = out ? ['--out', out] : [];
  const r = await runNode('render-handbook.js', args);
  if (r.code !== 0) throw new Error(`render-handbook.js 失敗（exit ${r.code}）\n${r.stderr || r.stdout}`);
  let summary;
  try { summary = JSON.parse(r.stdout); } catch { return r.stdout; }
  const lines = [`handbook 已輸出：${summary.out}（${summary.sections} 個 section）`];
  if (summary.skipped?.length) {
    lines.push(`跳過 ${summary.skipped.length} 個 manifest 條目（檔案不存在）：${summary.skipped.join('、')}`);
    lines.push('這通常代表 manifest 與 docs/ 不同步，建議跑一次 doc-align sync --dry-run；render 本身不裁決 drift。');
  }
  if (!quiet) lines.push('提醒：handbook 是生成物，內容以 manifest 目前狀態為準；是否提交進版控由你決定。');
  return `${lines.join('\n')}\n`;
}

async function cmdRender(o) {
  process.stdout.write(await renderHandbook({ out: o.out }));
  return 0;
}

// init／sync 結束後的自動 render：失敗不影響主流程的 exit code，只在 stderr 警告。
async function autoRender(o) {
  if (o.noRender || o.dryRun) return;
  try {
    const msg = await renderHandbook({ quiet: true });
    if (!o.quiet) process.stderr.write(`\x1b[2m${msg.trim()}\x1b[0m\n`);
  } catch (e) {
    process.stderr.write(`doc-align: 自動 render 失敗（不影響本次結果）：${e.message}\n`);
  }
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
  // sync --dry-run 走 check playbook（唯讀）；configure 別名走 configure playbook。
  const playbookName = o.sub === 'sync' && o.dryRun ? 'check' : o.configureOnly ? 'configure' : o.sub;
  const allowWrite = playbookName !== 'check';
  const playbook = readFileSync(join(ROOT, 'playbook', `${playbookName}.md`), 'utf8');
  const shown = playbookName === 'check' ? 'sync --dry-run' : playbookName;
  const system = buildAgentSystemPrompt({ subcommand: shown, playbook, root: ROOT, cwd, allowWrite, allowShell: o.allowShell });
  const userArgs = [...o.passthrough];
  if (o.noRender && playbookName !== 'check') userArgs.push('--no-render');
  if (o.ci && playbookName === 'init') userArgs.push('--ci');
  const user = buildAgentUserPrompt(playbookName === 'check' ? 'check' : shown, userArgs);
  const tools = toolDefinitions({ allowWrite, allowShell: o.allowShell });
  const execute = createExecutor({ cwd, docAlignRoot: ROOT, allowWrite, allowShell: o.allowShell, askUser: makeAskUser(o) });
  const maxTurns = o.maxTurns || Number(env.DOC_ALIGN_AGENT_MAX_TURNS || 60);
  const maxContextChars = Number(env.DOC_ALIGN_AGENT_MAX_CONTEXT_CHARS || 400_000);
  const onEvent = makeReporter(o);

  if (!o.quiet) process.stderr.write(`doc-align ${shown}（agent 模式，model ${cfg.model}，${allowWrite ? '可寫檔' : '唯讀'}${o.allowShell ? '，shell 開放' : ''}）\n`);

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
  // playbook 自己也會 render（skill 模式靠它）；CLI 再機械跑一次確保 HTML 一定同步——冪等、零 LLM。
  if (playbookName === 'init' || playbookName === 'sync') await autoRender(o);
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
  // ~/.config/doc-align/env 在此統一併入 process.env（環境變數優先、檔案補缺），
  // 讓 doctor／llm-check 等子程序也吃得到——README 承諾的「啟動時自動讀取」對所有子命令成立。
  const mergedEnv = loadEnvFile(process.env);
  for (const k of Object.keys(mergedEnv)) {
    if (!(k in process.env) || process.env[k] === '') process.env[k] = mergedEnv[k];
  }
  if (o.sub === 'doctor') return (await runNode('llm-doctor.js', [], { inherit: true })).code;
  if (o.sub === 'render') return cmdRender(o);
  if (o.sub === 'sync' && o.dryRun && o.direct) return cmdCheckDirect(o);
  return cmdAgent(o);
}

main().then((code) => process.exit(code), (err) => {
  console.error(err.message.startsWith('doc-align:') ? err.message : `doc-align: ${err.message}`);
  process.exit(1);
});
