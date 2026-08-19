// scripts/lib/repo-files.js — 列出 repo 檔案：git repo 用 ls-files（尊重 .gitignore，含未追蹤），
// 否則遞迴 fs（略過 .git／node_modules 等）。agent 工具與 deps-check 共用。

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'target']);

export function listRepoFiles(cwd) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
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
