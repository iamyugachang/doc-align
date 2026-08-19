// scripts/lib/markdown-html.js — 零依賴 markdown → 單頁 HTML handbook 轉換。
//
// 支援的 markdown 子集刻意對齊 doc-align 文件集的寫作慣例：
// 標題（#–####，# 由 section header 呈現故跳過）、fenced code（```mermaid 特別
// 處理為 <pre class="mermaid">）、管線表格、有序／無序清單、段落、**粗體**、
// `行內碼`、（path:line）證據引用、以及文件之間以 manifest path 互相引用時的
// 頁內錨點連結。不在此子集內的語法按原樣輸出（escape 後），不猜測。

const TYPE_ORDER = [
  'overview', 'use-case', 'architecture', 'layers', 'deployment', 'class', 'state', 'sequence', 'decision',
  'pipeline', 'api', 'permissions', 'db-schema',
];
const TYPE_GROUP_LABEL = {
  overview: '導讀',
  'use-case': '使用情境',
  architecture: '架構',
  layers: '分層依賴',
  deployment: '部署',
  class: '類別',
  state: '狀態機',
  sequence: '流程',
  decision: '決策',
  pipeline: '資料管線',
  api: 'API',
  permissions: '權限',
  'db-schema': '資料',
};

const CITE_RE = /（([\w/.\-]+\.(?:py|sql|md|js|ts|go|java|rb|rs|c|h|cpp)):([\d\-、,]+)）/g;

export function anchorFor(docPath) {
  return docPath.replace(/\.md$/, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderInline(s, linkMap = new Map()) {
  let out = escapeHtml(s);
  // 先把 code span 抽成 placeholder：span 內容不參與粗體／引用／連結轉換，
  // 也避免粗體 regex 跨越兩個 code span 誤配（如 \`src/**\` 與 \`lib/**\`）。
  const codeSpans = [];
  out = out.replace(/`([^`]+)`/g, (_, c) => {
    codeSpans.push(c);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(CITE_RE, (_, f, ln) => `<code class="cite">${f}:${ln}</code>`);
  for (const [path, anchor] of linkMap) {
    out = out.split(path).join(`<a href="#${anchor}">${path}</a>`);
  }
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codeSpans[Number(i)]}</code>`);
  return out;
}

export function convertMarkdown(md, linkMap = new Map()) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const para = [];
  let i = 0;

  const flush = () => {
    if (para.length) {
      out.push(`<p>${renderInline(para.join(' '), linkMap)}</p>`);
      para.length = 0;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      flush();
      const lang = line.slice(3).trim();
      const block = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        block.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      const body = escapeHtml(block.join('\n'));
      if (lang === 'mermaid') {
        out.push(`<div class="diagram"><pre class="mermaid">${body}</pre></div>`);
      } else {
        out.push(`<div class="codewrap"><pre><code>${body}</code></pre></div>`);
      }
      continue;
    }

    if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i + 1] ?? '')) {
      flush();
      const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      const t = ['<div class="tablewrap"><table><thead><tr>'];
      for (const c of header) t.push(`<th>${renderInline(c, linkMap)}</th>`);
      t.push('</tr></thead><tbody>');
      for (const r of rows) {
        t.push(`<tr>${r.map((c) => `<td>${renderInline(c, linkMap)}</td>`).join('')}</tr>`);
      }
      t.push('</tbody></table></div>');
      out.push(t.join(''));
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const lvl = heading[1].length;
      if (lvl > 1) {
        // 文件內 ## 降一級為 h3 起跳，讓 section 的 h2 保持唯一
        out.push(`<h${lvl + 1}>${renderInline(heading[2], linkMap)}</h${lvl + 1}>`);
      }
      i += 1;
      continue;
    }

    const ordered = line.match(/^(\d+)\.\s+(.*)$/);
    if (ordered) {
      flush();
      const items = [];
      const start = Number(ordered[1]);
      while (i < lines.length) {
        const m = lines[i].match(/^(\d+)\.\s+(.*)$/);
        if (!m) break;
        items.push(`<li>${renderInline(m[2], linkMap)}</li>`);
        i += 1;
      }
      out.push(`<ol class="rules" start="${start}">${items.join('')}</ol>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^[-*]\s+/, ''), linkMap)}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (!line.trim()) {
      flush();
      i += 1;
      continue;
    }

    para.push(line.trim());
    i += 1;
  }
  flush();
  return out.join('\n');
}

export function docTitle(md, fallback) {
  const m = md.match(/^#\s+(.*)$/m);
  return m ? m[1].trim() : fallback;
}

function sortDocs(docs) {
  return [...docs].sort((a, b) => {
    const ta = TYPE_ORDER.indexOf(a.type);
    const tb = TYPE_ORDER.indexOf(b.type);
    if (ta !== tb) return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb);
    return docs.indexOf(a) - docs.indexOf(b); // stable：同型別依 manifest 順序
  });
}

const CSS = `
:root {
  --paper:#F6F8F9; --panel:#FFFFFF; --ink:#1C2733; --muted:#5C6B78;
  --accent:#0E7C86; --accent-ink:#0A5E66; --line:#DCE4E9; --code-bg:#ECF1F4;
  --cite-bg:#E2F0F1; --badge-ink:#FFFFFF; --shadow:0 1px 2px rgba(28,39,51,.06);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper:#12161C; --panel:#181E26; --ink:#D9E0E7; --muted:#8A97A3;
    --accent:#4FC3CE; --accent-ink:#7BD4DD; --line:#2A333D; --code-bg:#1F2731;
    --cite-bg:#173238; --badge-ink:#0E1418; --shadow:0 1px 2px rgba(0,0,0,.4);
  }
}
:root[data-theme="dark"] {
  --paper:#12161C; --panel:#181E26; --ink:#D9E0E7; --muted:#8A97A3;
  --accent:#4FC3CE; --accent-ink:#7BD4DD; --line:#2A333D; --code-bg:#1F2731;
  --cite-bg:#173238; --badge-ink:#0E1418; --shadow:0 1px 2px rgba(0,0,0,.4);
}
* { box-sizing:border-box; }
body {
  margin:0; background:var(--paper); color:var(--ink);
  font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;
  font-size:16px; line-height:1.75;
}
code, pre, .src { font-family:ui-monospace,"Cascadia Code",Consolas,Menlo,monospace; }
.layout { display:flex; min-height:100vh; }
nav {
  width:248px; flex:none; border-right:1px solid var(--line);
  padding:28px 20px 40px; position:sticky; top:0; height:100vh; overflow-y:auto;
  background:var(--panel);
}
.brand .g { color:var(--accent); font-weight:700; letter-spacing:.02em; font-size:19px; }
.brand .sub { color:var(--muted); font-size:12.5px; margin-top:2px; line-height:1.5; }
.meta { font-size:11.5px; color:var(--muted); border-top:1px solid var(--line);
  margin-top:10px; padding-top:10px; line-height:1.7; }
.meta code { font-size:10.5px; background:var(--code-bg); padding:1px 4px; border-radius:3px; }
.nav-group { margin-top:18px; display:flex; flex-direction:column; gap:2px; }
.nav-label { font-size:11px; letter-spacing:.14em; color:var(--muted);
  text-transform:uppercase; margin-bottom:4px; }
nav a { color:var(--ink); text-decoration:none; font-size:14px; padding:4px 8px;
  border-radius:5px; }
nav a:hover { background:var(--code-bg); }
nav a:focus-visible, main a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
main { flex:1; min-width:0; padding:44px clamp(20px,5vw,72px) 96px; }
main .inner { max-width:78ch; }
section { margin-bottom:72px; scroll-margin-top:24px; }
.sec-head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap;
  border-bottom:2px solid var(--line); padding-bottom:10px; margin-bottom:18px; }
.sec-head h2 { margin:0; font-size:26px; line-height:1.3; text-wrap:balance; }
.src { color:var(--muted); font-size:11.5px; margin-left:auto; }
.badge { font-size:10.5px; letter-spacing:.1em; text-transform:uppercase;
  padding:2px 8px; border-radius:99px; background:var(--accent); color:var(--badge-ink);
  font-weight:600; flex:none; position:relative; top:-3px; }
h3 { font-size:19px; margin:34px 0 10px; }
h4 { font-size:16px; margin:26px 0 8px; }
h3::before { content:"§ "; color:var(--accent); }
p { margin:0 0 14px; }
code { background:var(--code-bg); padding:1.5px 5px; border-radius:4px; font-size:13.2px; }
code.cite { background:var(--cite-bg); color:var(--accent-ink); font-size:12px; white-space:nowrap; }
a { color:var(--accent-ink); }
ol.rules { padding-left:0; margin:0 0 16px; list-style:none; counter-reset:rule; }
ol.rules li { counter-increment:rule; position:relative; padding:8px 12px 8px 46px;
  border-left:3px solid var(--line); margin-bottom:8px; background:var(--panel);
  border-radius:0 6px 6px 0; box-shadow:var(--shadow); }
ol.rules li::before { content:counter(rule); position:absolute; left:12px; top:9px;
  color:var(--accent); font-weight:700; font-variant-numeric:tabular-nums; font-size:14px; }
ul { padding-left:22px; margin:0 0 14px; }
ul li { margin-bottom:6px; }
.diagram { overflow-x:auto; background:var(--panel); border:1px solid var(--line);
  border-radius:8px; padding:18px 16px; margin:0 0 18px; }
.diagram pre.mermaid { margin:0; background:transparent; display:flex; justify-content:center; }
.codewrap { overflow-x:auto; margin:0 0 16px; }
.codewrap pre { margin:0; background:var(--code-bg); border:1px solid var(--line);
  border-radius:8px; padding:14px 16px; font-size:13px; line-height:1.6; }
.codewrap code { background:transparent; padding:0; }
.tablewrap { overflow-x:auto; margin:0 0 18px; border:1px solid var(--line); border-radius:8px; }
table { border-collapse:collapse; width:100%; font-size:14px; background:var(--panel); }
th { text-align:left; font-size:12px; letter-spacing:.06em; text-transform:uppercase;
  color:var(--muted); border-bottom:2px solid var(--line); padding:9px 14px; white-space:nowrap; }
td { border-bottom:1px solid var(--line); padding:9px 14px; vertical-align:top; }
tr:last-child td { border-bottom:none; }
@media (max-width: 880px) {
  .layout { flex-direction:column; }
  nav { width:100%; height:auto; position:static; border-right:none;
    border-bottom:1px solid var(--line); }
  .src { margin-left:0; }
}
@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior:smooth; }
}
`;

const MERMAID_BOOT = `
  const dark = document.documentElement.dataset.theme === "dark" ||
    (document.documentElement.dataset.theme !== "light" &&
     window.matchMedia("(prefers-color-scheme: dark)").matches);
  try {
    const { default: mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    mermaid.initialize({ startOnLoad: true, theme: dark ? "dark" : "default" });
  } catch (e) {
    document.querySelectorAll("pre.mermaid").forEach((el) => {
      el.style.whiteSpace = "pre";
      el.insertAdjacentHTML("beforebegin",
        "<p style='color:var(--muted);font-size:12.5px;margin:0 0 6px'>（離線模式：Mermaid 圖以原始碼顯示；連網後重新整理即可渲染）</p>");
    });
  }
`;

// docs: [{ path, type, md }]；meta: { repoName, generatedAt, headSha }
export function renderHandbook(docs, meta) {
  const ordered = sortDocs(docs);
  const linkMap = new Map(ordered.map((d) => [d.path, anchorFor(d.path)]));

  const sections = ordered.map((d) => {
    const anchor = anchorFor(d.path);
    const title = docTitle(d.md, d.path);
    const body = convertMarkdown(d.md.replace(/^#\s+.*$/m, ''), linkMap);
    return (
      `<section id="${anchor}">` +
      `<header class="sec-head"><span class="badge">${d.type}</span>` +
      `<h2>${escapeHtml(title)}</h2>` +
      `<code class="src">docs/${d.path}</code></header>` +
      `${body}</section>`
    );
  });

  const navParts = [];
  let currentGroup = null;
  for (const d of ordered) {
    const group = TYPE_GROUP_LABEL[d.type] ?? d.type;
    if (group !== currentGroup) {
      if (currentGroup !== null) navParts.push('</div>');
      navParts.push(`<div class="nav-group"><div class="nav-label">${group}</div>`);
      currentGroup = group;
    }
    navParts.push(`<a href="#${anchorFor(d.path)}">${escapeHtml(docTitle(d.md, d.path))}</a>`);
  }
  if (currentGroup !== null) navParts.push('</div>');

  const metaLines = [
    '由 doc-align render 生成',
    meta.headSha ? `對齊 commit <code>${escapeHtml(meta.headSha)}</code>` : '',
    escapeHtml(meta.generatedAt ?? ''),
  ].filter(Boolean).join('<br>');

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.repoName)} Handbook</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${CSS}</style>
</head>
<body>
<div class="layout">
<nav>
  <div class="brand"><div class="g">${escapeHtml(meta.repoName)} Handbook</div>
  <div class="sub">doc-align 文件集單頁閱讀版</div></div>
  ${navParts.join('\n  ')}
  <div class="meta">${metaLines}</div>
</nav>
<main><div class="inner">
${sections.join('\n')}
</div></main>
</div>
<script type="module">${MERMAID_BOOT}</script>
</body>
</html>
`;
}
