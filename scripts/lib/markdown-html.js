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
main .inner { max-width:82ch; margin:0 auto; }
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
.nav-toggle { display:none; }
@media (max-width: 880px) {
  .layout { flex-direction:column; }
  nav { width:100%; height:auto; position:sticky; top:0; z-index:20; border-right:none;
    border-bottom:1px solid var(--line); padding:10px 16px; }
  nav .brand { display:flex; align-items:center; justify-content:space-between; margin:0; }
  nav .brand .sub { display:none; }
  .nav-toggle { display:inline-block; background:var(--code-bg); color:var(--ink);
    border:1px solid var(--line); border-radius:8px; padding:6px 12px; font-size:14px; cursor:pointer; }
  .nav-body { display:none; max-height:calc(100vh - 120px); overflow-y:auto; margin-top:10px; }
  nav.open .nav-body { display:block; }
  main .inner { padding:20px 16px 60px; }
  .sec-head { flex-wrap:wrap; row-gap:4px; }
  .src { margin-left:0; word-break:break-all; }
  .dz-bar button { min-width:42px; padding:8px 12px; font-size:16px; }
}
@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior:smooth; }
}
`;

// 內網連不到公網 CDN 時，以 meta.mermaidUrl（CLI --mermaid-url／env DOC_ALIGN_MERMAID_URL）
// 指向內部鏡像（npm registry proxy 或自架靜態檔）；載入失敗時圖以原始碼顯示，不影響其他內容。
const DEFAULT_MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

const MERMAID_BOOT = `
  const dark = document.documentElement.dataset.theme === "dark" ||
    (document.documentElement.dataset.theme !== "light" &&
     window.matchMedia("(prefers-color-scheme: dark)").matches);
  try {
    // .mjs → ESM 動態 import（CDN／鏡像）；其他 → classic <script>（vendored IIFE 單檔
    // mermaid.min.js 只在非 module 作用域才會掛上 globalThis，不能用 import() 載）。
    const url = __MERMAID_URL__;
    let mermaid;
    if (url.endsWith(".mjs")) {
      ({ default: mermaid } = await import(url));
    } else {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = url; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      mermaid = window.mermaid;
    }
    if (!mermaid) throw new Error("mermaid unavailable");
    // 顯式 run()：本 script 是 module，執行時 DOMContentLoaded 可能已過，
    // startOnLoad 不可靠（CDN 動態 import 下圖會默默不畫）。
    mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default" });
    await mermaid.run({ querySelector: "pre.mermaid" });
    setupDiagramZoom();
  } catch (e) {
    document.querySelectorAll("pre.mermaid").forEach((el) => {
      el.style.whiteSpace = "pre";
      el.insertAdjacentHTML("beforebegin",
        "<p style='color:var(--muted);font-size:12.5px;margin:0 0 6px'>（離線模式：Mermaid 圖以原始碼顯示；連網後重新整理即可渲染）</p>");
    });
  }

  // 圖表 lightbox：點圖全螢幕，滾輪縮放（以游標為中心）、拖曳平移、+／−／重置、Esc 關閉。
  function setupDiagramZoom() {
    for (const pre of document.querySelectorAll("pre.mermaid")) {
      const svg = pre.querySelector("svg");
      if (!svg) continue;
      pre.classList.add("dz-ready");
      pre.title = "點擊放大（滾輪縮放、拖曳平移）";
      pre.addEventListener("click", () => openZoom(svg));
    }
  }

  function openZoom(srcSvg) {
    const overlay = document.createElement("div");
    overlay.className = "dz-overlay";
    overlay.innerHTML = '<div class="dz-bar"><span class="dz-pct">100%</span>' +
      '<button class="dz-out" title="縮小">−</button>' +
      '<button class="dz-in" title="放大">＋</button>' +
      '<button class="dz-reset" title="重置">100%</button>' +
      '<button class="dz-close" title="關閉（Esc）">✕</button></div>' +
      '<div class="dz-stage"><div class="dz-inner"></div></div>';
    const stage = overlay.querySelector(".dz-stage");
    const inner = overlay.querySelector(".dz-inner");
    const pct = overlay.querySelector(".dz-pct");
    const svg = srcSvg.cloneNode(true);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.maxWidth = "none";
    const vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width > 0) {
      svg.style.width = vb.width + "px";
      svg.style.height = vb.height + "px";
    }
    inner.appendChild(svg);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    let s = 1; let tx = 0; let ty = 0;
    const apply = () => {
      inner.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + s + ")";
      pct.textContent = Math.round(s * 100) + "%";
    };
    const fit = () => {
      const sr = stage.getBoundingClientRect();
      const w = svg.getBoundingClientRect().width / s || sr.width;
      const h = svg.getBoundingClientRect().height / s || sr.height;
      s = Math.min((sr.width - 48) / w, (sr.height - 48) / h, 1.5);
      if (!isFinite(s) || s <= 0) s = 1;
      tx = (sr.width - w * s) / 2; ty = (sr.height - h * s) / 2;
      apply();
    };
    const zoomAt = (px, py, factor) => {
      const next = Math.min(20, Math.max(0.15, s * factor));
      tx = px - ((px - tx) * next) / s;
      ty = py - ((py - ty) * next) / s;
      s = next; apply();
    };
    const center = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };

    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    }, { passive: false });

    // 拖曳平移＋雙指 pinch 縮放（觸控）
    const pointers = new Map();
    let drag = null; let pinchDist = 0;
    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    };
    stage.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      stage.setPointerCapture(e.pointerId);
      if (pointers.size === 1) {
        drag = { x: e.clientX - tx, y: e.clientY - ty };
        stage.classList.add("dragging");
      } else if (pointers.size === 2) {
        drag = null; pinchDist = dist();
      }
    });
    stage.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2 && pinchDist > 0) {
        const d = dist();
        const [a, b] = [...pointers.values()];
        const r = stage.getBoundingClientRect();
        zoomAt((a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, d / pinchDist);
        pinchDist = d;
      } else if (drag) {
        tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply();
      }
    });
    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) { drag = null; stage.classList.remove("dragging"); }
    };
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);
    stage.addEventListener("dblclick", (e) => {
      const r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, 1.6);
    });

    const close = () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      overlay.remove();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
      else if (e.key === "+" || e.key === "=") zoomAt(...center(), 1.2);
      else if (e.key === "-") zoomAt(...center(), 1 / 1.2);
    };
    document.addEventListener("keydown", onKey);
    overlay.querySelector(".dz-close").addEventListener("click", close);
    overlay.querySelector(".dz-in").addEventListener("click", () => zoomAt(...center(), 1.2));
    overlay.querySelector(".dz-out").addEventListener("click", () => zoomAt(...center(), 1 / 1.2));
    overlay.querySelector(".dz-reset").addEventListener("click", fit);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    fit();
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
    // 驗證基準：manifest 的 last_verified——行號引用的信任邊界，讓讀者知道
    // 「這份文件對齊到哪個 commit」，而不是把生成當下的行號當永遠有效。
    const verified = d.lastVerified
      ? `<code class="src ver">驗證於 ${escapeHtml(d.lastVerified)}</code>`
      : '<code class="src ver">尚未驗證</code>';
    return (
      `<section id="${anchor}">` +
      `<header class="sec-head"><span class="badge">${d.type}</span>` +
      `<h2>${escapeHtml(title)}</h2>` +
      `<code class="src">docs/${d.path}</code>${verified}</header>` +
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

  // drift 報告（選配）：nightly／CI 把 check 報告一併渲染進 handbook，
  // 讓打開 Pages 的人同時看到「文件」與「文件此刻可不可信」。
  let driftSection = '';
  if (meta.drift) {
    navParts.unshift(
      '<div class="nav-group"><div class="nav-label">狀態</div>' +
      '<a href="#drift-report">Drift 報告</a></div>',
    );
    driftSection =
      '<section id="drift-report">' +
      '<header class="sec-head"><span class="badge">drift</span>' +
      '<h2>Drift 報告</h2>' +
      `<code class="src">${escapeHtml(meta.drift.checkedAt ?? '')}</code></header>` +
      `${meta.drift.html}</section>`;
  }

  // provenance：Pages 上的是 main 的 truth、本地 render 的是 branch 的 truth，
  // 標明 branch＋commit＋時間讓讀者一眼分辨自己看的是哪個世界。
  const provenance = [
    meta.branch ? `branch <code>${escapeHtml(meta.branch)}</code>` : '',
    meta.headSha ? `commit <code>${escapeHtml(meta.headSha)}</code>` : '',
  ].filter(Boolean).join(' · ');

  const metaLines = [
    '由 doc-align render 生成',
    provenance,
    escapeHtml(meta.generatedAt ?? ''),
    meta.drift
      ? `<a class="chip chip-${meta.drift.ok ? 'ok' : 'warn'}" href="#drift-report">${escapeHtml(meta.drift.statusText)}</a>`
      : '',
  ].filter(Boolean).join('<br>');

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.repoName)} Handbook</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${CSS}
.sec-head .ver{opacity:.65;margin-left:6px}
.diagram pre.mermaid.dz-ready{cursor:zoom-in}
.dz-overlay{position:fixed;inset:0;background:rgba(8,10,14,.93);z-index:99;display:flex;flex-direction:column;touch-action:none}
.dz-bar{display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:10px 14px;color:#cfd6e4;font-size:13px}
.dz-bar button{background:#2a3242;color:#e6ebf4;border:1px solid #3c4658;border-radius:6px;min-width:34px;padding:4px 10px;font-size:14px;cursor:pointer}
.dz-bar button:hover{background:#39445a}
.dz-stage{flex:1;overflow:hidden;position:relative;cursor:grab}
.dz-stage.dragging{cursor:grabbing}
.dz-inner{position:absolute;left:0;top:0;transform-origin:0 0}
.dz-inner svg{display:block;max-width:none!important;background:#fff;border-radius:8px;padding:14px;user-select:none}
.chip{display:inline-block;margin-top:4px;padding:1px 8px;border-radius:10px;font-size:11px;text-decoration:none}
.chip-ok{background:#1a7f37;color:#fff}
.chip-warn{background:#b35900;color:#fff}</style>
</head>
<body>
<div class="layout">
<nav>
  <div class="brand"><div class="g">${escapeHtml(meta.repoName)} Handbook</div>
  <button class="nav-toggle" aria-expanded="false" aria-controls="nav-body">☰ 目錄</button>
  <div class="sub">doc-align 文件集單頁閱讀版</div></div>
  <div class="nav-body" id="nav-body">
  ${navParts.join('\n  ')}
  <div class="meta">${metaLines}</div>
  </div>
</nav>
<main><div class="inner">
${driftSection}${sections.join('\n')}
</div></main>
</div>
<script>
(function () {
  var t = document.querySelector(".nav-toggle"); var n = document.querySelector("nav");
  if (!t || !n) return;
  t.addEventListener("click", function () {
    var open = n.classList.toggle("open");
    t.setAttribute("aria-expanded", open ? "true" : "false");
  });
  n.addEventListener("click", function (e) {
    if (e.target.closest("a")) { n.classList.remove("open"); t.setAttribute("aria-expanded", "false"); }
  });
})();
</script>
<script type="module">${MERMAID_BOOT.replace('__MERMAID_URL__', JSON.stringify(meta.mermaidUrl || DEFAULT_MERMAID_URL))}</script>
</body>
</html>
`;
}
