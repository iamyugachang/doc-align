// scripts/schema-diff.js
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { extractMermaidBlocks, parseErDiagram } from './lib/mermaid-er.js';
import { parseSqlDdl, normalizeType } from './lib/sql-ddl.js';

export function diffSchemas(docTables, dbTables) {
  const drifts = [];
  for (const [t, dbT] of Object.entries(dbTables)) {
    const docT = docTables[t];
    if (!docT) { drifts.push({ kind: 'table_missing_in_doc', table: t }); continue; }
    for (const [c, dbCol] of Object.entries(dbT.columns)) {
      const docCol = docT.columns[c];
      if (!docCol) drifts.push({ kind: 'column_missing_in_doc', table: t, column: c });
      else if (normalizeType(docCol.type) !== dbCol.type)
        drifts.push({ kind: 'type_mismatch', table: t, column: c, doc: docCol.type, db: dbCol.type });
    }
    for (const c of Object.keys(docT.columns)) {
      if (!dbT.columns[c]) drifts.push({ kind: 'column_missing_in_db', table: t, column: c });
    }
  }
  for (const t of Object.keys(docTables)) {
    if (!dbTables[t]) drifts.push({ kind: 'table_missing_in_db', table: t });
  }
  return drifts;
}

function readSql(path) {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).filter((f) => f.endsWith('.sql')).sort()
      .map((f) => readFileSync(join(path, f), 'utf8')).join('\n;\n');
  }
  return readFileSync(path, 'utf8');
}

function main(argv) {
  const opts = {};
  function takeValue(a, i) {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} requires a value`);
    return v;
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--doc') opts.doc = takeValue(a, ++i);
    else if (a === '--sql') opts.sql = takeValue(a, ++i);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!opts.doc || !opts.sql) throw new Error('usage: schema-diff.js --doc <db-schema.md> --sql <file-or-dir>');

  let docSchema;
  try {
    const erBlocks = extractMermaidBlocks(readFileSync(opts.doc, 'utf8'))
      .filter((b) => b.trim().startsWith('erDiagram'));
    if (erBlocks.length !== 1) {
      process.stdout.write(JSON.stringify({
        status: 'unsupported',
        reason: `expected exactly one erDiagram in ${opts.doc}, found ${erBlocks.length}`,
      }, null, 2) + '\n');
      return;
    }
    docSchema = parseErDiagram(erBlocks[0]);
  } catch (err) {
    process.stdout.write(JSON.stringify({
      status: 'unsupported',
      reason: `erDiagram parse error: ${err.message}`,
    }, null, 2) + '\n');
    return;
  }
  if (!existsSync(opts.sql)) {
    process.stdout.write(JSON.stringify({
      status: 'unsupported',
      reason: `sql path not found: ${opts.sql}`,
    }, null, 2) + '\n');
    return;
  }
  if (statSync(opts.sql).isDirectory()) {
    const sqlFiles = readdirSync(opts.sql).filter((f) => f.endsWith('.sql'));
    if (sqlFiles.length === 0) {
      process.stdout.write(JSON.stringify({
        status: 'unsupported',
        reason: `no .sql files found in ${opts.sql}`,
      }, null, 2) + '\n');
      return;
    }
  }

  const { tables: dbTables, unsupported } = parseSqlDdl(readSql(opts.sql));
  const drifts = diffSchemas(docSchema.tables, dbTables);
  process.stdout.write(JSON.stringify({
    status: drifts.length ? 'drift' : 'ok',
    drifts,
    unsupportedStatements: unsupported,
  }, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
