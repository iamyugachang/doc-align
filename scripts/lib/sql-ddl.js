// scripts/lib/sql-ddl.js
const TYPE_ALIASES = {
  integer: 'int', bigint: 'int', smallint: 'int', serial: 'int', bigserial: 'int',
  varchar: 'string', text: 'string', char: 'string', uuid: 'string',
  bool: 'boolean',
  timestamp: 'datetime', timestamptz: 'datetime',
  numeric: 'number', decimal: 'number', float: 'number', double: 'number', real: 'number',
};

// Multi-word SQL type spellings that don't fit the single-token TYPE_ALIASES
// lookup. Matched as a longest-prefix against the (whitespace-normalized,
// paren-stripped) type text before falling back to the single-word path.
const MULTI_WORD_ALIASES = {
  'character varying': 'string',
  'double precision': 'number',
  'timestamp with time zone': 'datetime',
  'timestamp without time zone': 'datetime',
};
const MULTI_WORD_KEYS = Object.keys(MULTI_WORD_ALIASES).sort((a, b) => b.length - a.length);

export function normalizeType(t) {
  const cleaned = t.toLowerCase().replace(/\s+/g, ' ').trim();
  const withoutParens = cleaned.replace(/\(.*\)$/, '').trim();
  for (const key of MULTI_WORD_KEYS) {
    if (withoutParens === key) return MULTI_WORD_ALIASES[key];
  }
  const base = withoutParens.split(' ')[0];
  return TYPE_ALIASES[base] ?? base;
}

// Multi-word type *spellings* as they'd appear in raw SQL (lowercase, single
// spaces), used to decide how many words to pull out of a column definition
// before falling back to a single token. Longest first so e.g. "timestamp
// without time zone" is preferred over a false-positive on "timestamp with...".
const MULTI_WORD_TYPES = [...MULTI_WORD_KEYS];

function extractTypeToken(rest) {
  const trimmed = rest.trimStart();
  const lower = trimmed.toLowerCase();
  for (const alias of MULTI_WORD_TYPES) {
    if (lower.startsWith(alias)) {
      let end = alias.length;
      const parenMatch = trimmed.slice(end).match(/^\([^)]*\)/);
      if (parenMatch) end += parenMatch[0].length;
      return trimmed.slice(0, end);
    }
  }
  const m = trimmed.match(/^\w+(?:\([^)]*\))?/);
  return m ? m[0] : null;
}

const CONSTRAINT_HEADS = new Set(['primary', 'foreign', 'unique', 'constraint', 'check', 'key', 'index']);

// Schema-qualified name prefix (e.g. `shop.customers`), always discarded:
// tables are keyed by their bare, lowercased name because Mermaid docs use
// bare names. Two tables with the same name in different schemas are treated
// as one — out of scope for this parser.
const SCHEMA_PREFIX = '(?:"?\\w+"?\\.)?';

function findMatchingParen(str, openIdx) {
  let depth = 0;
  let inString = false;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (ch === "'" && str[i + 1] === "'") { i++; continue; }
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Quote-aware: commas and parens inside a '...' string literal (with ''
// escaping) don't affect top-level splitting.
function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      cur += ch;
      if (ch === "'") {
        if (s[i + 1] === "'") { cur += s[i + 1]; i++; }
        else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// String/comment-aware: strips `--` line comments and `/* */` block comments
// only outside '...' string literals (with '' escaping), and splits on `;`
// only outside strings too — so a semicolon, `--`, or `/*` inside a string
// literal is just data, not syntax.
function splitStatements(sql) {
  const statements = [];
  let cur = '';
  let inString = false;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'" && sql[i + 1] === "'") { cur += "''"; i += 2; continue; }
      if (ch === "'") { inString = false; cur += ch; i++; continue; }
      cur += ch; i++; continue;
    }
    if (ch === "'") { inString = true; cur += ch; i++; continue; }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === ';') { statements.push(cur); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) statements.push(cur);
  return statements.map((s) => s.trim()).filter(Boolean);
}

export function parseSqlDdl(sql) {
  const tables = {};
  const unsupported = [];
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    let m;
    if ((m = stmt.match(new RegExp(`^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${SCHEMA_PREFIX}"?(\\w+)"?\\s*\\(`, 'i')))) {
      const name = m[1].toLowerCase();
      const openIdx = m[0].length - 1;
      const closeIdx = findMatchingParen(stmt, openIdx);
      const body = stmt.slice(openIdx + 1, closeIdx === -1 ? undefined : closeIdx);
      tables[name] = { columns: {} };
      for (const colDef of splitTopLevel(body)) {
        const cm = colDef.trim().match(/^"?(\w+)"?\s+([\s\S]*)$/);
        if (!cm || CONSTRAINT_HEADS.has(cm[1].toLowerCase())) continue;
        const typeToken = extractTypeToken(cm[2]);
        if (!typeToken) continue;
        tables[name].columns[cm[1].toLowerCase()] = { type: normalizeType(typeToken) };
      }
    } else if ((m = stmt.match(new RegExp(`^alter\\s+table\\s+${SCHEMA_PREFIX}"?(\\w+)"?\\s+add\\s+(?:column\\s+)?"?(\\w+)"?\\s+([\\s\\S]*)$`, 'i')))) {
      const typeToken = extractTypeToken(m[3]);
      if (typeToken) {
        const t = (tables[m[1].toLowerCase()] ??= { columns: {} });
        t.columns[m[2].toLowerCase()] = { type: normalizeType(typeToken) };
      }
    } else if ((m = stmt.match(new RegExp(`^alter\\s+table\\s+${SCHEMA_PREFIX}"?(\\w+)"?\\s+drop\\s+(?:column\\s+)?"?(\\w+)"?`, 'i')))) {
      const t = tables[m[1].toLowerCase()];
      if (t) delete t.columns[m[2].toLowerCase()];
    } else if ((m = stmt.match(new RegExp(`^drop\\s+table\\s+(?:if\\s+exists\\s+)?${SCHEMA_PREFIX}"?(\\w+)"?`, 'i')))) {
      delete tables[m[1].toLowerCase()];
    } else {
      unsupported.push(stmt.slice(0, 100));
    }
  }
  return { tables, unsupported };
}
