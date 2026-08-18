// scripts/lib/agent-tools.js — doc-align 內建 agent loop 的工具集（OpenAI function-calling 格式）。
//
// 設計：這是「小 harness」，工具刻意收窄——讀檔／搜尋／git 唯讀／跑 doc-align 自家 scripts；
// 寫檔只在 init／sync／configure 開放且限定 repo 內或系統暫存目錄；任意 shell 要 --allow-shell
// 明確打開。模型無法越權，錯誤以字串回給模型讓它自行修正，不拋例外中斷迴圈。

import { execFile as execFileCb, execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { matchesAny } from './glob.js';

const execFile = promisify(execFileCb);

export const KNOWN_SCRIPTS = [
  'changed-scope.js', 'ci-gate.js', 'generate-doc-set.js', 'manifest.js', 'mermaid-check.js',
  'render-handbook.js', 'schema-diff.js', 'llm-check.js',
];
export const GIT_READONLY = [
  'diff', 'log', 'show', 'rev-parse', 'ls-files', 'status', 'blame', 'grep', 'remote', 'branch',
  'describe', 'cat-file', 'name-rev', 'shortlog', 'rev-list',
];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'target']);

function fn(name, description, properties, required = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } };
}

// 依 mode 組出工具定義清單。
export function toolDefinitions({ allowWrite = false, allowShell = false } = {}) {
  const defs = [
    fn('read_file', '讀取檔案內容（附行號）。大檔請分段：用 start/end 指定行範圍（1-based，含端點）；單次最多回 400 行。',
      { path: { type: 'string', description: '相對於目前 repo 根的路徑，或絕對路徑（doc-align 目錄／暫存目錄亦可）' }, start: { type: 'integer' }, end: { type: 'integer' } }, ['path']),
    fn('list_dir', '列出目錄內容（檔案與子目錄，略過 .git／node_modules 等）。depth 預設 1，最多 3。',
      { path: { type: 'string', description: '預設 "."' }, depth: { type: 'integer' } }),
    fn('glob', '依 glob pattern 列出 repo 內檔案（尊重 .gitignore）。例：src/**/*.py、migrations/*.sql。',
      { pattern: { type: 'string' } }, ['pattern']),
    fn('grep', '在 repo 檔案內以正規表示式逐行搜尋，回傳 檔案:行號: 內容（最多 200 筆）。可用 glob 限縮檔案、path 限縮目錄。',
      { pattern: { type: 'string', description: 'JavaScript 正規表示式（不含斜線）' }, path: { type: 'string' }, glob: { type: 'string' }, ignore_case: { type: 'boolean' } }, ['pattern']),
    fn('git', `執行唯讀 git 子命令（允許：${GIT_READONLY.join('、')}）。args 為參數陣列，例：["diff","--name-only","origin/main...HEAD"]。`,
      { args: { type: 'array', items: { type: 'string' } } }, ['args']),
    fn('run_script', `執行 doc-align 自家 script（playbook 中的 node <SCRIPTS>/<name> …）。script 為檔名（${KNOWN_SCRIPTS.join('、')}），args 為其後的參數陣列。回傳 exit code、stdout、stderr。`,
      { script: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, stdin: { type: 'string', description: '選配：餵給 script 的標準輸入（generate-doc-set.js --spec - 用）' } }, ['script']),
    fn('ask_user', '向使用者提問並等待回答（playbook 要求裁決／詢問時使用）。非互動環境會回覆「非互動」——此時依 playbook 的非互動情境處理，不要重複提問。',
      { question: { type: 'string' } }, ['question']),
  ];
  if (allowWrite) {
    defs.push(fn('write_file', '寫入檔案（整檔覆寫，父目錄自動建立）。只允許 repo 內或系統暫存目錄。',
      { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']));
    defs.push(fn('move_file', '搬移／改名檔案（來源與目的都須在 repo 內或系統暫存目錄）。',
      { from: { type: 'string' }, to: { type: 'string' } }, ['from', 'to']));
  }
  if (allowShell) {
    defs.push(fn('shell', '執行任意 shell 指令（sh -c），cwd＝repo 根。只在其他工具做不到時使用（例如呼叫 codegraph 之類的程式碼索引工具）。',
      { command: { type: 'string' }, timeout_ms: { type: 'integer' } }, ['command']));
  }
  return defs;
}

function insideAny(target, roots) {
  const t = resolve(target);
  return roots.some((r) => {
    const rel = relative(resolve(r), t);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });
}

function numbered(lines, from) {
  return lines.map((l, i) => `${String(from + i).padStart(5)}  ${l}`).join('\n');
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
}

// 走訪 repo 檔案清單：git repo 用 ls-files（尊重 .gitignore，含未追蹤），否則遞迴 fs。
export function listRepoFiles(cwd) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\n').filter(Boolean).filter((f) => existsSync(join(cwd, f)));
  } catch {
    const files = [];
    const walk = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(join(dir, ent.name)); }
        else if (ent.isFile()) files.push(relative(cwd, join(dir, ent.name)).split(sep).join('/'));
      }
    };
    walk(cwd);
    return files;
  }
}

// 唯讀 git 子命令裡仍有會寫入或執行外部程式的旗標，逐一擋掉（模型可能被 repo 內容誘導）。
const GIT_DENY_FLAGS = [
  /^--output(=|$)/,            // diff/log/show/format-patch 寫檔
  /^-O/, /^--open-files-in-pager/, // grep 啟動外部程式
  /^--ext-diff$/, /^--no-index$/,  // 外部 diff 程式；讀 repo 外檔案
  /^--exec(=|$)/,               // rev-list/log 不該有；保險
];
const GIT_BRANCH_ALLOW = new Set(['-a', '-r', '-v', '-vv', '--all', '--remotes', '--list', '--show-current', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format', '--column', '--no-column', '--abbrev']);
export function gitDeniedReason(args) {
  const [sub, ...rest] = args;
  for (const a of rest) for (const re of GIT_DENY_FLAGS) if (re.test(a)) return `不允許 git 旗標 ${a}`;
  if (sub === 'remote') {
    // remote 只允許列出／查 URL；add/remove/set-url/rename/prune 都是寫入
    if (rest.length && !['-v', '--verbose', 'get-url', 'show'].includes(rest[0])) return `git remote 只允許 -v／get-url／show，不允許 ${rest[0]}`;
    if (rest[0] === 'get-url' && rest.slice(1).some((a) => a.startsWith('-') && !['--push', '--all'].includes(a))) return 'git remote get-url 不允許其他旗標';
  }
  if (sub === 'branch') {
    // 沒有 --list 等查詢旗標時，任何 positional 都會建立分支；-d/-m/-f 等一律禁止
    const listing = rest.some((a) => ['--list', '--show-current', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at'].some((f) => a === f || a.startsWith(`${f}=`)));
    for (const a of rest) {
      if (a.startsWith('-')) {
        const key = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
        if (!GIT_BRANCH_ALLOW.has(key)) return `git branch 只允許查詢旗標，不允許 ${a}`;
      } else if (!listing) return 'git branch 帶 positional 會建立分支；請加 --list';
    }
  }
  return null;
}

// 建立工具執行器：execute(name, args) → Promise<string>。
export function createExecutor({
  cwd = process.cwd(), docAlignRoot, allowWrite = false, allowShell = false,
  askUser = async () => null, maxResultChars = 30_000,
} = {}) {
  const readRoots = [cwd, docAlignRoot, tmpdir()].filter(Boolean);
  const writeRoots = [cwd, tmpdir()];
  const scriptsDir = join(docAlignRoot, 'scripts');

  const cap = (s) => (s.length > maxResultChars ? `${s.slice(0, maxResultChars)}\n…（輸出已截斷，共 ${s.length} 字元）` : s);
  const rel = (p) => (isAbsolute(p) ? p : resolve(cwd, p));

  const handlers = {
    async read_file({ path, start, end }) {
      const abs = rel(path);
      if (!insideAny(abs, readRoots)) return `ERROR: 不允許讀取 repo／doc-align／暫存目錄以外的路徑：${path}`;
      if (!existsSync(abs)) return `ERROR: 檔案不存在：${path}`;
      const st = statSync(abs);
      if (st.isDirectory()) return `ERROR: ${path} 是目錄，請用 list_dir`;
      const buf = readFileSync(abs);
      if (isBinary(buf)) return `ERROR: ${path} 是二進位檔（${st.size} bytes）`;
      const lines = buf.toString('utf8').split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      const from = Math.max(1, Number(start) || 1);
      let to = Math.min(lines.length, Number(end) || lines.length);
      let note = '';
      if (to - from + 1 > 400) { to = from + 399; note = `\n…（僅顯示 ${from}-${to}；共 ${lines.length} 行，請以 start/end 續讀）`; }
      return `${path}（${from}-${to}／共 ${lines.length} 行）\n${numbered(lines.slice(from - 1, to), from)}${note}`;
    },
    async list_dir({ path = '.', depth = 1 }) {
      const abs = rel(path);
      if (!insideAny(abs, readRoots)) return `ERROR: 不允許列出此路徑：${path}`;
      if (!existsSync(abs) || !statSync(abs).isDirectory()) return `ERROR: 目錄不存在：${path}`;
      const maxDepth = Math.min(Math.max(1, Number(depth) || 1), 3);
      const out = [];
      const walk = (dir, d) => {
        let ents;
        try { ents = readdirSync(dir, { withFileTypes: true }); } catch (e) { out.push(`${relative(cwd, dir) || '.'}/ (ERROR: ${e.message})`); return; }
        ents.sort((a, b) => a.name.localeCompare(b.name));
        for (const ent of ents) {
          if (SKIP_DIRS.has(ent.name)) continue;
          const p = join(dir, ent.name);
          const shown = relative(cwd, p).split(sep).join('/') || ent.name;
          if (ent.isDirectory()) { out.push(`${shown}/`); if (d < maxDepth) walk(p, d + 1); }
          else out.push(shown);
          if (out.length >= 2000) return;
        }
      };
      walk(abs, 1);
      return out.length ? out.join('\n') : '（空目錄）';
    },
    async glob({ pattern }) {
      const files = listRepoFiles(cwd).filter((f) => matchesAny(f, [pattern]));
      if (!files.length) return `（沒有檔案符合 ${pattern}）`;
      return files.length > 2000 ? `${files.slice(0, 2000).join('\n')}\n…（共 ${files.length} 個，已截斷）` : files.join('\n');
    },
    async grep({ pattern, path, glob, ignore_case }) {
      let re;
      try { re = new RegExp(pattern, ignore_case ? 'i' : ''); } catch (e) { return `ERROR: 無效的正規表示式：${e.message}`; }
      let files = listRepoFiles(cwd);
      if (path) { const p = path.replace(/^\.\//, '').replace(/\/+$/, ''); files = files.filter((f) => p === '.' || f === p || f.startsWith(`${p}/`)); }
      if (glob) files = files.filter((f) => matchesAny(f, [glob]));
      const hits = [];
      for (const f of files) {
        const abs = join(cwd, f);
        let st;
        try { st = statSync(abs); } catch { continue; }
        if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
        const buf = readFileSync(abs);
        if (isBinary(buf)) continue;
        const lines = buf.toString('utf8').split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          if (re.test(lines[i])) {
            hits.push(`${f}:${i + 1}: ${lines[i].length > 300 ? `${lines[i].slice(0, 300)}…` : lines[i]}`);
            if (hits.length >= 200) return `${hits.join('\n')}\n…（已達 200 筆上限，請縮小範圍）`;
          }
        }
      }
      return hits.length ? hits.join('\n') : `（沒有符合 /${pattern}/ 的內容）`;
    },
    async git({ args }) {
      if (!Array.isArray(args) || !args.length) return 'ERROR: git 需要 args 陣列';
      const sub = args[0];
      if (!GIT_READONLY.includes(sub)) return `ERROR: 只允許唯讀 git 子命令（${GIT_READONLY.join('、')}），不允許 ${sub}`;
      const denied = gitDeniedReason(args.map(String));
      if (denied) return `ERROR: ${denied}`;
      try {
        const { stdout, stderr } = await execFile('git', args.map(String), { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        return (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '') || '（無輸出）';
      } catch (e) {
        return `ERROR: git ${args.join(' ')} 失敗（exit ${e.code}）\n${e.stderr || e.message}`;
      }
    },
    async run_script({ script, args = [], stdin }) {
      const name = String(script).replace(/^.*\//, '');
      if (!KNOWN_SCRIPTS.includes(name)) return `ERROR: 未知 script ${script}；可用：${KNOWN_SCRIPTS.join('、')}`;
      const argv = [join(scriptsDir, name), ...(Array.isArray(args) ? args.map(String) : [])];
      return new Promise((resolveP) => {
        const child = execFileCb(process.execPath, argv, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
          const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
          resolveP(`exit ${code}\n[stdout]\n${stdout || ''}${stderr ? `\n[stderr]\n${stderr}` : ''}`);
        });
        if (stdin != null) child.stdin.end(String(stdin));
        else child.stdin.end();
      });
    },
    async ask_user({ question }) {
      const answer = await askUser(String(question));
      if (answer == null) return '（非互動環境，無法向使用者提問。請依 playbook 的非互動情境處理，不要重複提問。）';
      return `使用者回答：${answer}`;
    },
    async write_file({ path, content }) {
      if (!allowWrite) return 'ERROR: 本模式不允許寫檔';
      const abs = rel(path);
      if (!insideAny(abs, writeRoots)) return `ERROR: 只允許寫入 repo 內或系統暫存目錄：${path}`;
      if (insideAny(abs, [join(cwd, '.git')])) return 'ERROR: 不允許寫入 .git/';
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, String(content ?? ''));
      return `已寫入 ${path}（${Buffer.byteLength(String(content ?? ''))} bytes）`;
    },
    async move_file({ from, to }) {
      if (!allowWrite) return 'ERROR: 本模式不允許寫檔';
      const a = rel(from); const b = rel(to);
      if (!insideAny(a, writeRoots) || !insideAny(b, writeRoots)) return 'ERROR: 只允許在 repo 內或系統暫存目錄內搬移';
      if (!existsSync(a)) return `ERROR: 來源不存在：${from}`;
      mkdirSync(dirname(b), { recursive: true });
      renameSync(a, b);
      return `已搬移 ${from} → ${to}`;
    },
    async shell({ command, timeout_ms }) {
      if (!allowShell) return 'ERROR: 未開啟 --allow-shell，不允許執行 shell';
      try {
        const { stdout, stderr } = await execFile('sh', ['-c', String(command)], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: Number(timeout_ms) || 120_000 });
        return `exit 0\n[stdout]\n${stdout || ''}${stderr ? `\n[stderr]\n${stderr}` : ''}`;
      } catch (e) {
        return `exit ${e.code ?? 1}${e.killed ? '（timeout）' : ''}\n[stdout]\n${e.stdout || ''}\n[stderr]\n${e.stderr || e.message}`;
      }
    },
  };

  return async function execute(name, args) {
    const h = handlers[name];
    if (!h) return `ERROR: 未知工具 ${name}`;
    try {
      return cap(await h(args || {}));
    } catch (e) {
      return `ERROR: ${name} 執行失敗：${e.message}`;
    }
  };
}
