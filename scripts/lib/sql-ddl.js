// scripts/lib/sql-ddl.js
const TYPE_ALIASES = {
  integer: 'int', bigint: 'int', smallint: 'int', serial: 'int', bigserial: 'int',
  varchar: 'string', text: 'string', char: 'string', uuid: 'string',
  bool: 'boolean',
  timestamp: 'datetime', timestamptz: 'datetime',
  numeric: 'number', decimal: 'number', float: 'number', double: 'number', real: 'number',
};

export function normalizeType(t) {
  const base = t.toLowerCase().replace(/\(.*\)$/, '').trim();
  return TYPE_ALIASES[base] ?? base;
}

const CONSTRAINT_HEADS = new Set(['primary', 'foreign', 'unique', 'constraint', 'check', 'key', 'index']);

function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

export function parseSqlDdl(sql) {
  const tables = {};
  const unsupported = [];
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    let m;
    if ((m = stmt.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s*\(([\s\S]*)\)$/i))) {
      const name = m[1].toLowerCase();
      tables[name] = { columns: {} };
      for (const colDef of splitTopLevel(m[2])) {
        const cm = colDef.trim().match(/^"?(\w+)"?\s+(\w+(?:\([^)]*\))?)/);
        if (!cm || CONSTRAINT_HEADS.has(cm[1].toLowerCase())) continue;
        tables[name].columns[cm[1].toLowerCase()] = { type: normalizeType(cm[2]) };
      }
    } else if ((m = stmt.match(/^alter\s+table\s+"?(\w+)"?\s+add\s+(?:column\s+)?"?(\w+)"?\s+(\w+(?:\([^)]*\))?)/i))) {
      const t = (tables[m[1].toLowerCase()] ??= { columns: {} });
      t.columns[m[2].toLowerCase()] = { type: normalizeType(m[3]) };
    } else if ((m = stmt.match(/^alter\s+table\s+"?(\w+)"?\s+drop\s+(?:column\s+)?"?(\w+)"?/i))) {
      const t = tables[m[1].toLowerCase()];
      if (t) delete t.columns[m[2].toLowerCase()];
    } else if ((m = stmt.match(/^drop\s+table\s+(?:if\s+exists\s+)?"?(\w+)"?/i))) {
      delete tables[m[1].toLowerCase()];
    } else {
      unsupported.push(stmt.slice(0, 100));
    }
  }
  return { tables, unsupported };
}
