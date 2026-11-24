// Generates the internal "daybreak://" pages. Plain strings, no build step —
// each page is a full HTML document with inline CSS/JS, talking to main
// process only through window.internalAPI (see tab-preload.js).
//
// SECURITY NOTE: every page-controlled string (titles, URLs, favicons,
// download filenames all come from web content) MUST go through escapeHtml
// before it touches an HTML string. These pages run with the privileged
// internalAPI bridge (they could wipe history, change settings), so markup
// injected through e.g. a page title would be a real vulnerability, not a
// cosmetic bug.

const pkg = require('./package.json');

// Developer identity shown on the About page. The author / organization
// fields in package.json are the source of truth — aboutPage() reads those
// first and only falls back to these constants when a field is missing,
// so the package metadata and the rendered credits cannot drift apart.
// The source-code entry deliberately displays as "Daybreak" (the tooltip
// and the href carry the real repository URL).
const DEVELOPER = { name: 'WhiteDragon303', url: 'https://github.com/whitedragon303' };
const ORGANIZATION = { name: 'WhiteDragon Software', url: 'https://github.com/whitedragon-software' };
const SOURCE_CODE = { name: 'Daybreak', url: 'https://github.com/whitedragon-software/daybreak' };

// Normalizes a package.json author-style field: npm allows it to be either
// a plain string ("Name") or an object ({ name, url }). `fallback` supplies
// whatever the field itself does not carry.
function credit(meta, fallback) {
  const m = (meta && typeof meta === 'object') ? meta : (meta ? { name: String(meta) } : {});
  return {
    name: m.name || fallback.name,
    url: m.url || fallback.url || ''
  };
}

const BASE_STYLE = `
  :root {
    --bg: #ffffff;
    --panel: #f8f9fa;
    --text: #202124;
    --text-dim: #5f6368;
    --border: #dadce0;
    --accent: #1a73e8;
    --hover: #f1f3f4;
    --danger: #d93025;
  }
  body.dark {
    --bg: #202124;
    --panel: #292a2d;
    --text: #e8eaed;
    --text-dim: #9aa0a6;
    --border: #3c4043;
    --accent: #8ab4f8;
    --hover: #3c4043;
    --danger: #f28b82;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--text);
    transition: background .15s ease, color .15s ease;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 19px; font-weight: 600; margin: 0 0 20px; letter-spacing: -.01em; }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  .row:hover { background: var(--hover); }
  .row .main { min-width: 0; flex: 1; }
  .row .title { font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .url { font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .meta { font-size: 11px; color: var(--text-dim); flex-shrink: 0; }
  .row a.title-link { color: var(--text); text-decoration: none; }
  .row a.title-link:hover { text-decoration: underline; }
  button.icon-btn {
    border: none; background: transparent; color: var(--text-dim); cursor: pointer;
    font-size: 12px; padding: 4px 10px; border-radius: 4px; flex-shrink: 0;
  }
  button.icon-btn:hover { background: var(--border); color: var(--text); }
  .empty { color: var(--text-dim); font-size: 13px; padding: 24px 0; text-align: center; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
  input[type="text"], input[type="search"] {
    flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px;
    font-size: 13px; outline: none; color: var(--text); background: var(--bg);
  }
  input[type="text"]:focus, input[type="search"]:focus { border-color: var(--accent); }
  select {
    padding: 6px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--bg); color: var(--text); font-size: 13px;
  }
  button.action {
    padding: 8px 16px; border: none; border-radius: 6px; background: var(--accent);
    color: #fff; font-size: 13px; cursor: pointer;
  }
  button.action:hover { filter: brightness(0.92); }
  button.action.danger { background: var(--danger); }
  .progress-track { height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; margin-top: 4px; width: 160px; }
  .progress-fill { height: 100%; background: var(--accent); }
  .apps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
  .app-card {
    display: block; text-decoration: none; color: var(--text);
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 18px; transition: border-color .12s ease, transform .12s ease;
  }
  .app-card:hover { border-color: var(--accent); transform: translateY(-1px); }
  .app-card-mark {
    width: 30px; height: 30px; border-radius: 8px; background: var(--accent);
    margin-bottom: 12px; display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 600; color: #fff;
  }
  .app-card-name { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
  .app-card-desc { font-size: 11px; color: var(--text-dim); line-height: 1.5; }
  button.secondary {
    padding: 8px 16px; border: 1px solid var(--border); border-radius: 6px;
    background: transparent; color: var(--text); font-size: 13px; cursor: pointer;
  }
  button.secondary:hover { background: var(--hover); }
  .ctx-menu {
    position: fixed; z-index: 60; min-width: 190px; padding: 4px 0;
    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0,0,0,.16);
  }
  .ctx-item { padding: 7px 14px; font-size: 12.5px; color: var(--text); cursor: pointer; white-space: nowrap; }
  .ctx-item:hover { background: var(--hover); }
  #toast {
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(8px);
    max-width: 80%; padding: 9px 16px; border-radius: 8px; background: var(--text); color: var(--bg);
    font-size: 12.5px; opacity: 0; pointer-events: none; z-index: 70;
    transition: opacity .18s ease, transform .18s ease; word-break: break-all;
  }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
`;

// Shared helper injected into EVERY internal page's <script> block, ahead
// of the page's own code. The page scripts are plain strings built in this
// file — they run in the RENDERER, where this module's own escapeHtml does
// not exist, so every page that renders page-controlled strings (bookmark
// titles, history rows, download names, new-tab tiles) needs its own copy.
// Forgetting this was a real bug: with data present the page's render()
// pass threw "escapeHtml is not defined" and the page hung on its
// "Loading…" state forever (empty lists skipped the helper, which made the
// breakage look random — "works with no data, Loading… forever with data").
const SCRIPT_COMMON = `
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var _toastTimer = null;
  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = String(msg == null ? '' : msg);
    t.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }
  function basename(p) { return String(p == null ? '' : p).split(/[\\\\/]/).pop(); }
`;

// Applied first in every internal page so the overlay's theme choice carries
// over into daybreak:// pages too (real websites aren't touched — that's
// standard browser behavior, not something a page shell should force).
// Guarded: a failed theme lookup must never kill the page's own script —
// everything below it in the same <script> block would never run.
const THEME_INIT = `
  if (window.internalAPI && window.internalAPI.getSettings) {
    window.internalAPI.getSettings().then(function (s) {
      document.body.classList.toggle('dark', s && s.theme === 'dark');
    }).catch(function () {});
  }
`;

function shell(title, bodyHtml, script) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title} — Daybreak</title>
<style>${BASE_STYLE}</style>
</head>
<body>
<div class="wrap">
${bodyHtml}
</div>
<div id="toast"></div>
<script>${SCRIPT_COMMON}
${THEME_INIT}
${script}</script>
</body>
</html>`;
}

// ------------------------------------------------------------------
// Shared structure for the internal pages.
//
// Every internal page except the New Tab page (which keeps its own
// centered layout) and the 2FA app (a standalone static file) is built
// on the same skeleton: a fixed left navigation — the Daybreak mark, a
// search box on top, one pill link per page with the current page
// highlighted — next to a single scrolling column of section cards.
// Settings uses the same visual language but keeps its own sidebar,
// whose links jump between its sections instead of between pages.
//
// The sidebar search live-filters the page: rows marked data-filter are
// hidden when they don't match, cards marked data-filtergroup collapse
// when none of their rows are left, and a shared "no results" line
// appears when nothing matches at all. Pages that re-render their lists
// (bookmarks, history, downloads, performance) call panelFilter() again
// after every render — it is defined in the same <script> block, ahead
// of the page's own code.
// ------------------------------------------------------------------
const PANEL_STYLE = `
  .pn-root { background: #f1f3f4; min-height: 100vh; --card: #ffffff; }
  body.dark .pn-root { background: #202124; --card: #292a2d; }
  .pn-nav {
    position: fixed; top: 0; bottom: 0; left: 0; width: 236px;
    padding: 14px 8px 20px; overflow-y: auto;
    background: var(--bg); border-right: 1px solid var(--border);
  }
  .pn-brand {
    display: flex; align-items: center; gap: 9px;
    padding: 4px 16px 14px; font-size: 13px; font-weight: 600; color: var(--text);
  }
  .pn-brand-mark {
    width: 15px; height: 15px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid var(--accent); border-bottom-color: transparent;
    transform: rotate(-45deg);
  }
  .pn-search { position: relative; margin: 0 8px 14px; }
  .pn-search input {
    width: 100%; padding: 9px 12px 9px 34px; border: 1px solid transparent;
    border-radius: 18px; background: #f1f3f4; color: var(--text);
    font-size: 13px; outline: none;
  }
  body.dark .pn-search input { background: var(--hover); }
  .pn-search input:focus { background: var(--bg); border-color: var(--accent); }
  .pn-search svg {
    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
    width: 14px; height: 14px; fill: none; stroke: var(--text-dim); stroke-width: 2;
  }
  .pn-item {
    display: block; padding: 9px 16px; margin: 1px 0;
    border-radius: 0 18px 18px 0; text-decoration: none;
    color: var(--text-dim); font-size: 13px; line-height: 1.3;
  }
  .pn-item:hover { background: var(--hover); color: var(--text); }
  .pn-item.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent); font-weight: 600;
  }
  .pn-sep { height: 1px; background: var(--border); margin: 12px 14px; }
  .pn-main { margin-left: 236px; padding: 28px 0 120px; }
  .pn-col { max-width: 672px; margin: 0 auto; padding: 0 24px; }
  .p-card { background: var(--card); border-radius: 12px; padding: 4px 0 2px; margin-bottom: 20px; }
  .p-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 14px 20px 10px;
  }
  .p-head h2 {
    font-size: 15px; font-weight: 600; margin: 0; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .p-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .p-lede { font-size: 12px; color: var(--text-dim); line-height: 1.5; padding: 0 20px 8px; }
  .p-row { display: flex; align-items: center; gap: 14px; padding: 11px 20px; border-top: 1px solid var(--border); }
  .p-row:hover { background: var(--hover); }
  .p-main { flex: 1; min-width: 0; }
  .p-title { font-size: 13.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .p-sub { font-size: 11.5px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
  .p-meta { font-size: 11px; color: var(--text-dim); flex-shrink: 0; }
  a.p-title-link {
    color: var(--text); text-decoration: none; min-width: 0; flex: 1;
    display: flex; align-items: center; gap: 10px;
  }
  a.p-title-link:hover { text-decoration: underline; }
  /* Credit / value columns are sized to match the row titles — an unstyled
     inline element here would fall back to the browser's default size and
     render visibly larger than the text around it. */
  .p-ctl { font-size: 13.5px; color: var(--text); flex-shrink: 0; }
  .p-logo {
    width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid var(--accent); border-bottom-color: transparent;
    transform: rotate(-45deg);
  }
  .p-pre {
    white-space: pre-wrap; word-break: break-word; margin: 0;
    font-family: ui-monospace, Consolas, Menlo, monospace;
    font-size: 12px; line-height: 1.5; color: var(--text);
    padding: 14px 20px 16px; border-top: 1px solid var(--border);
  }
  button.secondary.danger-text { color: var(--danger); }
  .pn-hide { display: none !important; }
  @media (max-width: 760px) {
    .pn-nav { position: static; width: auto; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
    .pn-main { margin-left: 0; }
  }
`;

const PANEL_SCRIPT = `
  // ---- sidebar search: hide non-matching rows ([data-filter]), collapse
  // cards left without visible rows ([data-filtergroup]), and show the
  // shared "no results" line when nothing matches. Escape clears.
  function panelFilter() {
    var box = document.getElementById('pnSearch');
    if (!box) return;
    var q = box.value.trim().toLowerCase();
    var any = false;
    document.querySelectorAll('[data-filter]').forEach(function (row) {
      var hit = !q || row.textContent.toLowerCase().indexOf(q) >= 0;
      row.classList.toggle('pn-hide', !hit);
      if (hit) any = true;
    });
    document.querySelectorAll('[data-filtergroup]').forEach(function (g) {
      var empty = !!q && g.querySelectorAll('[data-filter]:not(.pn-hide)').length === 0;
      g.classList.toggle('pn-hide', empty);
    });
    var nr = document.getElementById('pnNoResults');
    if (nr) nr.classList.toggle('pn-hide', !(q && !any));
  }
  (function () {
    var box = document.getElementById('pnSearch');
    if (!box) return;
    box.addEventListener('input', panelFilter);
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { box.value = ''; panelFilter(); box.blur(); }
    });
  })();

  // ---- links marked data-ext open inside Daybreak (the shared credit-link
  // contract): a plain click opens the URL as a new tab of this window,
  // middle click or Ctrl/Cmd+click opens it in the background, and if the
  // tab bridge is missing the open-tab call the link falls back to a plain
  // navigation of the current tab — still inside Daybreak either way.
  (function () {
    function openCredit(url, background) {
      if (window.internalAPI && typeof window.internalAPI.openInTab === 'function') {
        var p = window.internalAPI.openInTab(url, { background: !!background });
        if (p && typeof p.catch === 'function') {
          p.catch(function () { window.location.href = url; });
        }
        return;
      }
      window.location.href = url;
    }
    document.querySelectorAll('a[data-ext]').forEach(function (a) {
      var url = a.getAttribute('href');
      if (!url) return;
      a.addEventListener('auxclick', function (e) {
        if (e.button === 1) { e.preventDefault(); openCredit(url, true); }
      });
      a.addEventListener('click', function (e) {
        e.preventDefault();
        openCredit(url, e.ctrlKey || e.metaKey);
      });
    });
  })();
`;

// The shared page skeleton. `active` is the nav id of the current page
// (settings / bookmarks / history / downloads / apps / performance / about);
// `search` is the sidebar search placeholder — omitted on pages with
// nothing to filter (view source, error pages).
function panelShell(opts) {
  const active = String(opts.active || '');
  const NAV_ITEMS = [
    ['settings', 'Settings', 'daybreak://settings'],
    ['bookmarks', 'Bookmarks', 'daybreak://bookmarks'],
    ['history', 'History', 'daybreak://history'],
    ['downloads', 'Downloads', 'daybreak://downloads'],
    ['apps', 'Apps', 'daybreak://apps'],
    ['performance', 'Performance', 'daybreak://performance']
  ];
  const navHtml = NAV_ITEMS.map((it) =>
    '<a class="pn-item' + (it[0] === active ? ' active' : '') + '" href="' + it[2] + '">' + it[1] + '</a>'
  ).join('') +
    '<div class="pn-sep"></div>' +
    '<a class="pn-item' + (active === 'about' ? ' active' : '') + '" href="daybreak://about">About Daybreak</a>';
  const searchHtml = opts.search
    ? '<div class="pn-search">' +
      '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><line x1="16.5" y1="16.5" x2="21" y2="21"></line></svg>' +
      '<input type="search" id="pnSearch" placeholder="' + escapeHtml(opts.search) + '" autocomplete="off" aria-label="' + escapeHtml(opts.search) + '">' +
      '</div>'
    : '';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${opts.title} — Daybreak</title>
<style>${BASE_STYLE}${PANEL_STYLE}</style>
</head>
<body>
<div class="pn-root">
<aside class="pn-nav">
  <div class="pn-brand"><span class="pn-brand-mark" aria-hidden="true"></span>Daybreak</div>
  ${searchHtml}
  <nav aria-label="Daybreak pages">${navHtml}</nav>
</aside>
<main class="pn-main">
<div class="pn-col">
${opts.body || ''}
</div>
</main>
</div>
<div id="toast"></div>
<script>${SCRIPT_COMMON}
${THEME_INIT}
${PANEL_SCRIPT}
${opts.script || ''}</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function newTabPage() {
  const body = `
    <div style="display:flex;flex-direction:column;align-items:center;padding-top:11vh">
      <div style="width:40px;height:40px;border-radius:50%;border:2px solid var(--accent);
                  border-bottom-color:transparent;transform:rotate(-45deg);margin-bottom:22px"></div>
      <div id="greeting" style="font-size:26px;font-weight:600;letter-spacing:-.02em;margin-bottom:30px;color:var(--text)"></div>

      <div style="width:100%;max-width:540px;position:relative">
        <input type="search" id="q" placeholder="Search or enter address" autofocus
          style="width:100%;box-sizing:border-box;padding:14px 18px;border:1px solid var(--border);border-radius:999px;
                 font-size:14px;outline:none;color:var(--text);background:var(--panel);transition:border-color .12s ease,box-shadow .12s ease">
      </div>

      <div style="display:flex;gap:8px;margin-top:16px">
        <a href="daybreak://apps" style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-dim);text-decoration:none;
           border:1px solid var(--border);border-radius:999px;padding:6px 14px 6px 12px;transition:border-color .12s ease,color .12s ease"
           onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--text)'"
           onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-dim)'">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
            <rect x="4" y="4" width="7" height="7" rx="1.3"/><rect x="13" y="4" width="7" height="7" rx="1.3"/>
            <rect x="4" y="13" width="7" height="7" rx="1.3"/><rect x="13" y="13" width="7" height="7" rx="1.3"/>
          </svg>
          Apps
        </a>
      </div>

      <div style="width:100%;max-width:540px;margin-top:36px">
        <div id="tilesLabel" style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;
             margin:0 0 10px 2px;display:none">Frequently visited</div>
        <div id="tiles"></div>
        <div id="restoreRow" style="display:none;margin-top:10px">
          <button class="icon-btn" id="restoreBtn" style="border:1px solid var(--border);border-radius:999px;padding:4px 12px;font-size:11px"></button>
        </div>
      </div>
    </div>

    <div id="tileMenu" class="ctx-menu" style="display:none"></div>
    <div id="tileEditor" style="position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;z-index:50">
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:18px;width:340px;max-width:90vw;box-shadow:0 10px 34px rgba(0,0,0,.22)">
        <div style="font-size:13.5px;font-weight:600;margin-bottom:12px">Edit tile</div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">Name</div>
        <input type="text" id="editName" style="width:100%;margin-bottom:10px" placeholder="Falls back to the URL when empty">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">URL</div>
        <input type="text" id="editUrl" style="width:100%;margin-bottom:14px">
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button class="secondary" id="editCancel">Cancel</button>
          <button class="action" id="editSave">Save</button>
        </div>
      </div>
    </div>
  `;
  const script = `
    var engines = {
      google: 'https://www.google.com/search?q=',
      bing: 'https://www.bing.com/search?q=',
      duckduckgo: 'https://duckduckgo.com/?q='
    };
    var q = document.getElementById('q');
    q.addEventListener('focus', function () { q.style.borderColor = 'var(--accent)'; });
    q.addEventListener('blur', function () { q.style.borderColor = 'var(--border)'; });
    q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var val = q.value.trim();
      if (!val) return;
      window.internalAPI.getSettings().then(function (settings) {
        var isUrl = /^[a-z][a-z0-9+.-]*:\\/\\//i.test(val) || /^[\\w-]+(\\.[\\w-]+)+(:\\d+)?(\\/.*)?$/i.test(val);
        location.href = isUrl
          ? (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(val) ? val : 'https://' + val)
          : (engines[settings.searchEngine] || engines.google) + encodeURIComponent(val);
      });
    });

    (function () {
      var h = new Date().getHours();
      var greeting = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      document.getElementById('greeting').textContent = greeting;
    })();

    function hueFor(str) {
      var h = 0;
      for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
      return h;
    }
    function tile(url, title, favicon, id) {
      var host = '';
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { host = url; }
      var letter = (host[0] || '?').toUpperCase();
      var hue = hueFor(host);
      // Everything below is page-controlled — escape before it enters markup.
      var safeUrl = escapeHtml(url);
      var safeHost = escapeHtml(host);
      var safeTitle = escapeHtml(title || host);
      var safeLetter = escapeHtml(letter);
      var iconHtml = favicon
        ? '<img src="' + escapeHtml(favicon) + '" alt="" style="width:30px;height:30px;flex-shrink:0;border-radius:7px;object-fit:cover" onerror="this.remove()">'
        : '<div style="width:30px;height:30px;flex-shrink:0;border-radius:7px;display:flex;align-items:center;justify-content:center;' +
            'background:hsl(' + hue + ',55%,45%);color:#fff;font-size:13px;font-weight:600">' + safeLetter + '</div>';
      return '<a href="' + safeUrl + '" data-url="' + safeUrl + '" data-id="' + escapeHtml(id || '') + '" draggable="true" ' +
        'style="text-decoration:none;color:inherit;display:flex;align-items:center;gap:10px;' +
        'padding:11px 12px;border-radius:9px;border:1px solid var(--border);background:var(--panel);cursor:pointer;' +
        'transition:border-color .12s ease,transform .12s ease" ' +
        'onmouseover="this.style.borderColor=\\'var(--accent)\\';this.style.transform=\\'translateY(-1px)\\'" ' +
        'onmouseout="this.style.borderColor=\\'var(--border)\\';this.style.transform=\\'none\\'">' +
        iconHtml +
        '<div style="min-width:0"><div style="font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + safeTitle + '</div>' +
        '<div style="font-size:10px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + safeHost + '</div></div></a>';
    }
    // ---- Frequently visited tiles ----
    // The grid is a managed view of the bookmarks list: the newest 9
    // bookmarks become tiles, minus the ones the user hid, in the order the
    // user dragged them (tileOrder in settings.json). Interactions mirror
    // the bookmarks bar chips: left click opens the site in this tab,
    // middle click / Ctrl+click open a background tab, right click opens a
    // tile menu, and dragging reorders the grid. Hiding never deletes the
    // bookmark itself — "Show hidden tiles" brings everything back. Hiding
    // is non-destructive by design, exactly like the bookmarks bar chips.
    var tileData = { bookmarks: [], settings: {} };
    var dragEl = null;

    function tileList() {
      var s = tileData.settings || {};
      var hidden = {};
      (s.hiddenTiles || []).forEach(function (u) { hidden[u] = true; });
      var picked = tileData.bookmarks.filter(function (b) { return !hidden[b.url]; }).slice(-9).reverse();
      var pos = {};
      (s.tileOrder || []).forEach(function (u, i) { if (pos[u] === undefined) pos[u] = i; });
      picked.sort(function (a, b) {
        var ia = pos[a.url] === undefined ? 9999 : pos[a.url];
        var ib = pos[b.url] === undefined ? 9999 : pos[b.url];
        return ia - ib; // Array.sort is stable: equal ranks keep newest-first
      });
      return picked;
    }

    function refreshTiles() {
      return Promise.all([window.internalAPI.getBookmarks(), window.internalAPI.getSettings()]).then(function (res) {
        tileData.bookmarks = Array.isArray(res[0]) ? res[0] : [];
        tileData.settings = res[1] || {};
        renderTiles();
      });
    }

    function renderTiles() {
      var el = document.getElementById('tiles');
      var label = document.getElementById('tilesLabel');
      var restoreRow = document.getElementById('restoreRow');
      var picked = tileList();
      var hiddenCount = ((tileData.settings || {}).hiddenTiles || []).length;
      restoreRow.style.display = tileData.bookmarks.length && hiddenCount ? 'block' : 'none';
      if (hiddenCount) document.getElementById('restoreBtn').textContent = 'Show ' + hiddenCount + ' hidden tile' + (hiddenCount === 1 ? '' : 's');
      if (!tileData.bookmarks.length) { label.style.display = 'none'; el.innerHTML = ''; return; }
      label.style.display = 'block';
      if (!picked.length) {
        el.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:4px 2px">All bookmark tiles are hidden. Use "Show hidden tiles" below to bring them back.</div>';
        return;
      }
      el.innerHTML = '<div id="tilesGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">' +
        picked.map(function (b) { return tile(b.url, b.title, b.favicon, b.id); }).join('') + '</div>';
      wireTiles();
    }

    function wireTiles() {
      var grid = document.getElementById('tilesGrid');
      if (!grid) return;
      grid.querySelectorAll('a[data-url]').forEach(function (t) {
        var url = t.getAttribute('data-url');
        // Middle click and Ctrl/Cmd+click open a background tab, like the
        // bookmarks bar chips; a plain click keeps the link's own behavior.
        t.addEventListener('auxclick', function (e) {
          if (e.button === 1) { e.preventDefault(); window.internalAPI.openInTab(url, { background: true }); }
        });
        t.addEventListener('click', function (e) {
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); window.internalAPI.openInTab(url, { background: true }); }
        });
        t.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          openTileMenu(e.clientX, e.clientY, url, t.getAttribute('data-id'));
        });
        t.addEventListener('dragstart', function (e) {
          dragEl = t;
          t.style.opacity = '0.45';
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', url); } catch (err) { /* drag store can be unavailable early */ }
          }
        });
        t.addEventListener('dragend', function () {
          t.style.opacity = '';
          persistDomOrder();
        });
        t.addEventListener('dragover', function (e) {
          if (!dragEl || dragEl === t) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          var r = t.getBoundingClientRect();
          var before = (e.clientX - r.left) < r.width / 2;
          if (before && t.previousSibling !== dragEl) grid.insertBefore(dragEl, t);
          else if (!before && t.nextSibling !== dragEl) grid.insertBefore(dragEl, t.nextSibling);
        });
      });
    }

    // The drag gesture reorders the DOM live; on drop the visible order is
    // persisted (settings.tileOrder) and the grid re-renders from state, so
    // what is displayed is always exactly what was saved.
    function persistDomOrder() {
      var grid = document.getElementById('tilesGrid');
      dragEl = null;
      if (!grid) return;
      var urls = [];
      grid.querySelectorAll('a[data-url]').forEach(function (t) { urls.push(t.getAttribute('data-url')); });
      window.internalAPI.setTileOrder(urls).then(function (s) {
        tileData.settings = s || tileData.settings;
        renderTiles();
      });
    }

    // ---- Tile context menu ----
    var menuEl = document.getElementById('tileMenu');
    var menuCtx = { url: '', id: '' };
    function closeTileMenu() { menuEl.style.display = 'none'; }
    function openTileMenu(x, y, url, id) {
      menuCtx = { url: url, id: id };
      menuEl.innerHTML =
        '<div class="ctx-item" data-act="open">Open</div>' +
        '<div class="ctx-item" data-act="background">Open in background tab</div>' +
        '<div class="ctx-item" data-act="edit">Edit tile...</div>' +
        '<div class="ctx-item" data-act="hide">Hide from New Tab</div>';
      menuEl.querySelectorAll('.ctx-item').forEach(function (item) {
        item.addEventListener('click', function () {
          var act = item.getAttribute('data-act');
          closeTileMenu();
          if (act === 'open') location.href = menuCtx.url;
          else if (act === 'background') window.internalAPI.openInTab(menuCtx.url, { background: true });
          else if (act === 'edit') openTileEditor(menuCtx.id, menuCtx.url);
          else if (act === 'hide') window.internalAPI.hideTile(menuCtx.url).then(function (s) { tileData.settings = s || tileData.settings; renderTiles(); });
        });
      });
      menuEl.style.display = 'block';
      var r = menuEl.getBoundingClientRect();
      menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
      menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    }

    // ---- Tile editor ----
    // Same conventions as the bookmarks bar's editor: the URL is resolved
    // by the main process with the address-bar rules, and an emptied name
    // falls back to the URL. The change lands on the underlying bookmark,
    // so the bookmarks bar and the star state stay in sync automatically.
    var editorEl = document.getElementById('tileEditor');
    var editCtx = null;
    function closeTileEditor() { editorEl.style.display = 'none'; editCtx = null; }
    function openTileEditor(id, url) {
      var b = tileData.bookmarks.find(function (x) { return x.id === id && x.url === url; }) ||
              tileData.bookmarks.find(function (x) { return x.url === url; });
      if (!b) return;
      editCtx = b;
      document.getElementById('editName').value = b.title === b.url ? '' : (b.title || '');
      document.getElementById('editUrl').value = b.url;
      editorEl.style.display = 'flex';
      document.getElementById('editName').focus();
    }
    function saveTileEditor() {
      if (!editCtx) { closeTileEditor(); return; }
      window.internalAPI.updateBookmark(editCtx.id, {
        title: document.getElementById('editName').value,
        url: document.getElementById('editUrl').value
      }).then(function (list) {
        tileData.bookmarks = Array.isArray(list) ? list : tileData.bookmarks;
        closeTileEditor();
        renderTiles();
      });
    }

    // One-time wiring: everything below survives the re-renders above
    // (only the grid itself is rebuilt per render).
    document.addEventListener('dragover', function (e) { if (dragEl) e.preventDefault(); });
    document.addEventListener('drop', function (e) { if (dragEl) e.preventDefault(); }); // dropping a dragged tile must never navigate the page
    document.addEventListener('mousedown', function (e) {
      if (menuEl.style.display === 'block' && !menuEl.contains(e.target)) closeTileMenu();
    });
    window.addEventListener('blur', closeTileMenu);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeTileMenu(); if (editCtx) closeTileEditor(); }
    });
    document.getElementById('editCancel').addEventListener('click', closeTileEditor);
    document.getElementById('editSave').addEventListener('click', saveTileEditor);
    ['editName', 'editUrl'].forEach(function (eid) {
      document.getElementById(eid).addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveTileEditor(); }
      });
    });
    editorEl.addEventListener('mousedown', function (e) { if (e.target === editorEl) closeTileEditor(); });
    document.getElementById('restoreBtn').addEventListener('click', function () {
      window.internalAPI.restoreTiles().then(function (s) { tileData.settings = s || tileData.settings; renderTiles(); });
    });

    refreshTiles().catch(function () {});
  `;
  return shell('New Tab', body, script);
}

function bookmarksPage() {
  const body = `
    <section class="p-card" data-filtergroup>
      <div class="p-head">
        <h2>Bookmarks</h2>
        <div class="p-actions">
          <button class="secondary" id="exportBtn">Export JSON</button>
          <button class="secondary" id="importBtn">Import JSON</button>
        </div>
      </div>
      <div id="list"><div class="empty">Loading…</div></div>
    </section>
    <div class="empty pn-hide" id="pnNoResults">No matching bookmarks</div>
  `;
  const script = `
    function render(list) {
      var el = document.getElementById('list');
      if (!list.length) {
        el.innerHTML = '<div class="empty">No bookmarks yet</div>';
      } else {
        el.innerHTML = list.slice().reverse().map(function (b) {
          var icon = b.favicon
            ? '<img src="' + escapeHtml(b.favicon) + '" alt="" style="width:16px;height:16px;border-radius:3px;flex-shrink:0" onerror="this.remove()">'
            : '<span style="width:16px;height:16px;border-radius:3px;flex-shrink:0;background:var(--border);display:inline-block"></span>';
          return '<div class="p-row" data-filter>' +
            '<a class="p-title-link" href="' + escapeHtml(b.url) + '">' + icon +
            '<span style="min-width:0"><div class="p-title">' + escapeHtml(b.title || b.url) + '</div>' +
            '<div class="p-sub">' + escapeHtml(b.url) + '</div></span></a>' +
            '<button class="icon-btn" data-id="' + escapeHtml(b.id) + '">Remove</button></div>';
        }).join('');
        el.querySelectorAll('button[data-id]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            window.internalAPI.removeBookmark(btn.getAttribute('data-id')).then(render);
          });
        });
      }
      panelFilter();
    }
    window.internalAPI.getBookmarks().then(render);
    document.getElementById('exportBtn').addEventListener('click', function () {
      window.internalAPI.exportData('bookmarks').then(function (res) {
        if (res && res.ok) showToast('Exported ' + res.count + ' bookmark' + (res.count === 1 ? '' : 's') + ' to ' + basename(res.path));
        else if (res && !res.canceled) showToast(res.error || 'Export failed');
      });
    });
    document.getElementById('importBtn').addEventListener('click', function () {
      window.internalAPI.importData('bookmarks').then(function (res) {
        if (res && res.ok) {
          showToast('Imported ' + res.imported + ' bookmark' + (res.imported === 1 ? '' : 's') + (res.skipped ? ' (' + res.skipped + ' skipped)' : ''));
          window.internalAPI.getBookmarks().then(render);
        } else if (res && !res.canceled) showToast(res.error || 'Import failed');
      });
    });
  `;
  return panelShell({ title: 'Bookmarks', active: 'bookmarks', search: 'Search bookmarks', body: body, script: script });
}

function historyPage() {
  const body = `
    <section class="p-card" data-filtergroup>
      <div class="p-head">
        <h2>History</h2>
        <div class="p-actions">
          <button class="secondary" id="exportBtn">Export JSON</button>
          <button class="secondary" id="importBtn">Import JSON</button>
          <button class="secondary danger-text" id="clearBtn">Clear all</button>
        </div>
      </div>
      <div id="list"><div class="empty">Loading…</div></div>
    </section>
    <div class="empty pn-hide" id="pnNoResults">No matching history</div>
  `;
  const script = `
    var all = [];
    // The sidebar search box (panelFilter) filters these rows live by their
    // text — title, URL and timestamp.
    function render(list) {
      var el = document.getElementById('list');
      if (!list.length) {
        el.innerHTML = '<div class="empty">No history yet</div>';
      } else {
        el.innerHTML = list.slice().reverse().map(function (h) {
          var date = new Date(h.timestamp);
          return '<div class="p-row" data-filter>' +
            '<a class="p-title-link" href="' + escapeHtml(h.url) + '"><span style="min-width:0">' +
            '<div class="p-title">' + escapeHtml(h.title || h.url) + '</div>' +
            '<div class="p-sub">' + escapeHtml(h.url) + '</div></span></a>' +
            '<span class="p-meta">' + date.toLocaleString() + '</span>' +
            '<button class="icon-btn" data-id="' + escapeHtml(h.id) + '">Remove</button></div>';
        }).join('');
        el.querySelectorAll('button[data-id]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            window.internalAPI.removeHistory(btn.getAttribute('data-id')).then(function (list) { all = list; render(all); });
          });
        });
      }
      panelFilter();
    }
    window.internalAPI.getHistory().then(function (list) { all = list; render(all); });
    document.getElementById('clearBtn').addEventListener('click', function () {
      window.internalAPI.clearHistory().then(function () { all = []; render(all); });
    });
    document.getElementById('exportBtn').addEventListener('click', function () {
      window.internalAPI.exportData('history').then(function (res) {
        if (res && res.ok) showToast('Exported ' + res.count + ' history item' + (res.count === 1 ? '' : 's') + ' to ' + basename(res.path));
        else if (res && !res.canceled) showToast(res.error || 'Export failed');
      });
    });
    document.getElementById('importBtn').addEventListener('click', function () {
      window.internalAPI.importData('history').then(function (res) {
        if (res && res.ok) {
          showToast('Imported ' + res.imported + ' history item' + (res.imported === 1 ? '' : 's') + (res.skipped ? ' (' + res.skipped + ' skipped)' : ''));
          window.internalAPI.getHistory().then(function (list) { all = list; render(all); });
        } else if (res && !res.canceled) showToast(res.error || 'Import failed');
      });
    });
  `;
  return panelShell({ title: 'History', active: 'history', search: 'Search history', body: body, script: script });
}

// Settings — built like a desktop browser's settings home: a fixed left
// navigation (search box on top, one link per section) next to a single
// scrolling column of section cards. Sections: Appearance, Search engine,
// On startup, Downloads, Privacy and security, Performance, About Daybreak.
// Every other internal page (except the New Tab page and the 2FA app)
// shares the same visual language through panelShell() — sidebar with a
// search box and page links on the left, section cards on the right — but
// only Settings' sidebar links jump between its own sections.
// Every control saves the instant it changes (there is no Save button) —
// main.js re-layouts every window and re-pushes state on settings:set, so
// theme, bookmarks-bar and ad-blocker changes land everywhere at once.
// Each control maps onto an existing settings.json key, so this page adds
// no new IPC and no new persistence:
//   theme, showBookmarksBar → Appearance
//   searchEngine            → Search engine (radio list)
//   homepage                → On startup
//   adBlockEnabled          → Privacy and security
//   memorySaverEnabled      → Performance
//   (Downloads / About are actions and links, no new keys)
function settingsPage() {
  const dev = credit(pkg.author, DEVELOPER);
  const org = credit(pkg.organization, ORGANIZATION);
  const link = (c, label) => c.url
    ? `<a data-ext href="${escapeHtml(c.url)}" title="${escapeHtml(c.url)}" style="color:var(--accent);text-decoration:none;font-size:inherit">${escapeHtml(label || c.name)}</a>`
    : `<span style="color:var(--text-dim)">${escapeHtml(c.name || '—')}</span>`;
  const body = `
    <style>
      /* Page-scoped layout: reset the shared .wrap column so the fixed
         sidebar + scrolling content structure can take over. */
      .wrap { max-width: none; margin: 0; padding: 0; }
      .st-root { background: #f1f3f4; min-height: 100vh; --card: #ffffff; }
      body.dark .st-root { background: #202124; --card: #292a2d; }
      .st-nav {
        position: fixed; top: 0; bottom: 0; left: 0; width: 236px;
        padding: 14px 8px 20px; overflow-y: auto;
        background: var(--bg); border-right: 1px solid var(--border);
      }
      .st-search { position: relative; margin: 0 8px 14px; }
      .st-search input {
        width: 100%; padding: 9px 12px 9px 34px; border: 1px solid transparent;
        border-radius: 18px; background: #f1f3f4; color: var(--text);
        font-size: 13px; outline: none;
      }
      body.dark .st-search input { background: var(--hover); }
      .st-search input:focus { background: var(--bg); border-color: var(--accent); }
      .st-search svg {
        position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
        width: 14px; height: 14px; fill: none; stroke: var(--text-dim); stroke-width: 2;
      }
      .st-nav-item {
        display: block; width: 100%; text-align: left; padding: 9px 16px;
        border: none; background: transparent; color: var(--text-dim);
        font-size: 13px; line-height: 1.3; border-radius: 0 18px 18px 0;
        cursor: pointer; margin: 1px 0;
      }
      .st-nav-item:hover { background: var(--hover); color: var(--text); }
      .st-nav-item.active {
        background: color-mix(in srgb, var(--accent) 14%, transparent);
        color: var(--accent); font-weight: 600;
      }
      .st-nav-label { padding: 16px 16px 5px; font-size: 11px; color: var(--text-dim); }
      .st-nav-sep { height: 1px; background: var(--border); margin: 12px 14px; }
      .st-main { margin-left: 236px; padding: 28px 0 120px; }
      .st-col { max-width: 672px; margin: 0 auto; padding: 0 24px; }
      section { scroll-margin-top: 20px; margin-bottom: 20px; }
      .card { background: var(--card); border-radius: 12px; padding: 4px 0 2px; }
      .card h2 { font-size: 15px; font-weight: 600; margin: 0; padding: 16px 20px 6px; }
      .srow {
        display: flex; align-items: center; gap: 16px;
        padding: 12px 20px; border-top: 1px solid var(--border);
      }
      .srow .s-main { flex: 1; min-width: 0; }
      .srow .s-title { font-size: 13.5px; color: var(--text); }
      .srow .s-desc { font-size: 12px; color: var(--text-dim); margin-top: 2px; line-height: 1.5; }
      /* Sized to match .s-title: an unstyled inline element here (the credit
         links below) would fall back to the browser's default font size and
         render visibly larger than the text around it. */
      .s-ctl { flex-shrink: 0; display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
      .st-home input[type="text"] { width: 240px; }
      .se-option {
        display: flex; align-items: flex-start; gap: 14px;
        padding: 13px 20px; cursor: pointer; border-top: 1px solid var(--border);
      }
      .se-option:hover { background: var(--hover); }
      .se-option input {
        margin: 2px 0 0; width: 16px; height: 16px;
        accent-color: var(--accent); flex-shrink: 0; cursor: pointer;
      }
      .se-option .s-main { flex: 1; min-width: 0; }
      .se-option .s-title { display: block; font-size: 13.5px; color: var(--text); }
      .se-option .s-desc { display: block; font-size: 12px; color: var(--text-dim); margin-top: 2px; }
      /* Pill toggle switch (checkbox is real and focusable, only visuals are custom) */
      .switch { position: relative; display: inline-block; width: 38px; height: 20px; flex-shrink: 0; }
      .switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
      .switch .track {
        position: absolute; inset: 0; border-radius: 10px; background: var(--border);
        transition: background .14s ease; pointer-events: none;
      }
      .switch .track::after {
        content: ""; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px;
        border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25);
        transition: transform .14s ease;
      }
      .switch input:checked + .track { background: var(--accent); }
      .switch input:checked + .track::after { transform: translateX(18px); }
      .switch input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
      button.secondary.danger-text { color: var(--danger); }
      #noResults { padding: 48px 0; }
      @media (max-width: 760px) {
        .st-nav { position: static; width: auto; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
        .st-main { margin-left: 0; }
      }
    </style>
    <div class="st-root">
      <aside class="st-nav">
        <div class="st-search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><line x1="16.5" y1="16.5" x2="21" y2="21"></line></svg>
          <input type="search" id="stSearch" placeholder="Search settings" autocomplete="off" aria-label="Search settings">
        </div>
        <nav aria-label="Settings sections">
          <button class="st-nav-item active" data-goto="appearance">Appearance</button>
          <button class="st-nav-item" data-goto="search">Search engine</button>
          <button class="st-nav-item" data-goto="startup">On startup</button>
          <div class="st-nav-label">Advanced</div>
          <button class="st-nav-item" data-goto="downloads">Downloads</button>
          <button class="st-nav-item" data-goto="privacy">Privacy and security</button>
          <button class="st-nav-item" data-goto="performance">Performance</button>
          <div class="st-nav-sep"></div>
          <button class="st-nav-item" data-goto="about">About Daybreak</button>
        </nav>
      </aside>
      <main class="st-main">
        <div class="st-col">
          <section id="sec-appearance" data-section="appearance">
            <div class="card">
              <h2>Appearance</h2>
              <div class="srow">
                <div class="s-main">
                  <div class="s-title">Theme</div>
                  <div class="s-desc">Applies to the toolbar, menus and every internal page; websites keep their own look</div>
                </div>
                <div class="s-ctl">
                  <select id="theme" aria-label="Theme">
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
              </div>
              <div class="srow">
                <div class="s-main">
                  <div class="s-title">Show bookmarks bar</div>
                  <div class="s-desc">Shows your bookmarks under the address bar in every window</div>
                </div>
                <div class="s-ctl">
                  <label class="switch"><input type="checkbox" id="showBookmarksBar" aria-label="Show bookmarks bar"><span class="track"></span></label>
                </div>
              </div>
            </div>
          </section>
          <section id="sec-search" data-section="search">
            <div class="card">
              <h2>Search engine</h2>
              <div class="srow">
                <div class="s-main">
                  <div class="s-title">Search engine used in the address bar</div>
                  <div class="s-desc">Anything typed that is not a URL is sent to this engine</div>
                </div>
              </div>
              <label class="se-option"><input type="radio" name="searchEngine" value="google"><span class="s-main"><span class="s-title">Google</span><span class="s-desc">google.com</span></span></label>
              <label class="se-option"><input type="radio" name="searchEngine" value="bing"><span class="s-main"><span class="s-title">Bing</span><span class="s-desc">bing.com</span></span></label>
              <label class="se-option"><input type="radio" name="searchEngine" value="duckduckgo"><span class="s-main"><span class="s-title">DuckDuckGo</span><span class="s-desc">duckduckgo.com</span></span></label>
            </div>
          </section>
          <section id="sec-startup" data-section="startup">
            <div class="card">
              <h2>On startup</h2>
              <div class="srow">
                <div class="s-main">
                  <div class="s-title">Homepage</div>
                  <div class="s-desc">Opened when Daybreak starts and whenever a new tab is created</div>
                </div>
                <div class="s-ctl st-home">
                  <input type="text" id="homepage" placeholder="daybreak://newtab" spellcheck="false" aria-label="Homepage">
                  <button class="icon-btn" id="homepageReset" title="Reset to the New Tab page">Reset</button>
                </div>
              </div>
            </div>
          </section>
          <section id="sec-downloads" data-section="downloads">
            <div class="card">
              <h2>Downloads</h2>
              <div class="srow">
                <div class="s-main">
                  <div class="s-title">Download list</div>
                  <div class="s-desc">Live progress and past downloads, on its own page</div>
                </div>
                <div class="s-ctl"><button class="secondary" id="openDownloads">Open page</button></div>
              </div>
              <div class="srow">
                <div class="s-main">
                  <div class="s-title">Clear the download list</div>
                  <div class="s-desc">Removes the list entries; files already on disk are untouched</div>
                </div>
                <div class="s-ctl"><button class="secondary danger-text" id="clearDownloads">Clear list</button></div>
              </div>
            </div>
          </section>
          <section id="sec-privacy" data-section="privacy">
            <div class="card">
              <h2>Privacy and security</h2>
              <div class="srow">
                <div class="s-main">
                  <div class="s-title">Block ads &amp; trackers</div>
                  <div class="s-desc">Blocks known ad/tracker domains in every window, private ones included</div>
                </div>
                <div class="s-ctl">
                  <label class="switch"><input type="checkbox" id="adBlockEnabled" aria-label="Block ads and trackers"><span class="track"></span></label>
                </div>
              </div>
              <div class="srow">
                <div class="s-main">
                  <div class="s-title">Delete browsing history</div>
                  <div class="s-desc">Removes every entry from the History page; cannot be undone</div>
                </div>
                <div class="s-ctl"><button class="secondary danger-text" id="clearHistory">Delete…</button></div>
              </div>
            </div>
          </section>
          <section id="sec-performance" data-section="performance">
            <div class="card">
              <h2>Performance</h2>
              <div class="srow">
                <div class="s-main">
                  <div class="s-title">Memory Saver</div>
                  <div class="s-desc">Frees background tabs left unused for a while; they reload automatically when revisited. Active, pinned and playing tabs are never freed.</div>
                </div>
                <div class="s-ctl">
                  <label class="switch"><input type="checkbox" id="memorySaverEnabled" aria-label="Memory Saver"><span class="track"></span></label>
                </div>
              </div>
            </div>
          </section>
          <section id="sec-about" data-section="about">
            <div class="card">
              <h2>About Daybreak</h2>
              <div class="srow">
                <div class="s-main">
                  <div class="s-title">Daybreak ${escapeHtml(pkg.version)}</div>
                  <div class="s-desc">Electron ${escapeHtml(process.versions.electron || '—')} · Chromium ${escapeHtml(process.versions.chrome || '—')} · Node ${escapeHtml(process.versions.node || '—')}</div>
                </div>
              </div>
              <div class="srow"><div class="s-main"><div class="s-title">Developer</div></div><div class="s-ctl">${link(dev)}</div></div>
              <div class="srow"><div class="s-main"><div class="s-title">Organization</div></div><div class="s-ctl">${link(org)}</div></div>
              <div class="srow"><div class="s-main"><div class="s-title">Source code</div></div><div class="s-ctl">${link(SOURCE_CODE, SOURCE_CODE.name)}</div></div>
            </div>
          </section>
          <div class="empty" id="noResults" style="display:none">No settings match your search</div>
        </div>
      </main>
    </div>
  `;
  const script = `
    var API = window.internalAPI;

    // ---------- load current values ----------
    API.getSettings().then(function (s) {
      s = s || {};
      document.getElementById('theme').value = s.theme === 'dark' ? 'dark' : 'light';
      document.getElementById('showBookmarksBar').checked = !!s.showBookmarksBar;
      document.getElementById('adBlockEnabled').checked = s.adBlockEnabled !== false;
      document.getElementById('memorySaverEnabled').checked = s.memorySaverEnabled === true;
      document.getElementById('homepage').value = s.homepage || 'daybreak://newtab';
      var radio = document.querySelector('input[name="searchEngine"][value="' + (s.searchEngine || 'google') + '"]');
      if (radio) radio.checked = true;
      document.body.classList.toggle('dark', s.theme === 'dark');
    }).catch(function () {});

    // ---------- save on change (no Save button) ----------
    function save(patch, after) {
      API.setSettings(patch).then(function (s) {
        document.body.classList.toggle('dark', s.theme === 'dark');
        if (after) after(s);
      }).catch(function () { showToast('Could not save the setting'); });
    }
    document.getElementById('theme').addEventListener('change', function (e) {
      save({ theme: e.target.value });
    });
    document.getElementById('showBookmarksBar').addEventListener('change', function (e) {
      save({ showBookmarksBar: e.target.checked });
    });
    document.getElementById('adBlockEnabled').addEventListener('change', function (e) {
      save({ adBlockEnabled: e.target.checked });
    });
    document.getElementById('memorySaverEnabled').addEventListener('change', function (e) {
      save({ memorySaverEnabled: e.target.checked });
    });
    document.querySelectorAll('input[name="searchEngine"]').forEach(function (r) {
      r.addEventListener('change', function (e) { save({ searchEngine: e.target.value }); });
    });
    var homepage = document.getElementById('homepage');
    homepage.addEventListener('change', function () {
      var v = homepage.value.trim() || 'daybreak://newtab';
      homepage.value = v;
      save({ homepage: v });
    });
    document.getElementById('homepageReset').addEventListener('click', function () {
      homepage.value = 'daybreak://newtab';
      save({ homepage: 'daybreak://newtab' });
    });

    // ---------- actions (the destructive ones confirm first) ----------
    document.getElementById('openDownloads').addEventListener('click', function () {
      if (API && typeof API.openInTab === 'function') API.openInTab('daybreak://downloads');
      else window.location.href = 'daybreak://downloads';
    });
    document.getElementById('clearDownloads').addEventListener('click', function () {
      if (!window.confirm('Clear the download list? Files already on disk are not touched.')) return;
      API.clearDownloads().then(function () { showToast('Download list cleared'); });
    });
    document.getElementById('clearHistory').addEventListener('click', function () {
      if (!window.confirm('Delete all browsing history? This cannot be undone.')) return;
      API.clearHistory().then(function () { showToast('Browsing history deleted'); });
    });

    // ---------- sidebar: click-to-jump + highlight while scrolling ----------
    var navItems = document.querySelectorAll('.st-nav-item[data-goto]');
    var spySuppressed = false, suppressTimer = null;
    function setActive(id) {
      navItems.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-goto') === id);
      });
    }
    navItems.forEach(function (b) {
      b.addEventListener('click', function () {
        var sec = document.getElementById('sec-' + b.getAttribute('data-goto'));
        if (!sec || sec.style.display === 'none') return;
        setActive(b.getAttribute('data-goto'));
        // Suppress the scroll-spy while the smooth scroll is in flight:
        // the last sections can never reach the top of the viewport (the
        // document ends first), so the spy would immediately mark the
        // section above the one that was clicked.
        spySuppressed = true;
        clearTimeout(suppressTimer);
        suppressTimer = setTimeout(function () { spySuppressed = false; }, 1000);
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    window.addEventListener('scrollend', function () { spySuppressed = false; });
    var sections = document.querySelectorAll('section[data-section]');
    function spy() {
      if (spySuppressed) return;
      // At the very bottom of the document the last section (About) can
      // never cross the top threshold — highlight it directly.
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) {
        var last = sections[sections.length - 1];
        if (last) setActive(last.getAttribute('data-section'));
        return;
      }
      var y = window.scrollY + 140, current = null;
      sections.forEach(function (sec) {
        if (sec.style.display !== 'none' && sec.offsetTop <= y) current = sec.getAttribute('data-section');
      });
      if (current) setActive(current);
    }
    window.addEventListener('scroll', spy, { passive: true });
    spy();

    // ---------- settings search: hide non-matching rows, collapse empty sections ----------
    var searchBox = document.getElementById('stSearch');
    function applyFilter() {
      var q = searchBox.value.trim().toLowerCase();
      var any = false;
      sections.forEach(function (sec) {
        var rows = sec.querySelectorAll('.srow, .se-option');
        var shown = 0;
        rows.forEach(function (row) {
          var hit = !q || row.textContent.toLowerCase().indexOf(q) >= 0;
          row.style.display = hit ? '' : 'none';
          if (hit) shown++;
        });
        var visible = !q || shown > 0;
        sec.style.display = visible ? '' : 'none';
        if (visible) any = true;
      });
      document.getElementById('noResults').style.display = (q && !any) ? '' : 'none';
      spy();
    }
    searchBox.addEventListener('input', applyFilter);
    searchBox.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        searchBox.value = '';
        applyFilter();
        searchBox.blur();
      }
    });

    // ---------- credit links open inside Daybreak (same wiring as the About page) ----------
    (function () {
      function openCredit(url, background) {
        if (API && typeof API.openInTab === 'function') {
          var p = API.openInTab(url, { background: !!background });
          if (p && typeof p.catch === 'function') {
            p.catch(function () { window.location.href = url; });
          }
          return;
        }
        window.location.href = url;
      }
      document.querySelectorAll('a[data-ext]').forEach(function (a) {
        var url = a.getAttribute('href');
        if (!url) return;
        a.addEventListener('auxclick', function (e) {
          if (e.button === 1) { e.preventDefault(); openCredit(url, true); }
        });
        a.addEventListener('click', function (e) {
          e.preventDefault();
          openCredit(url, e.ctrlKey || e.metaKey);
        });
      });
    })();
  `;
  return shell('Settings', body, script);
}

function downloadsPage() {
  const body = `
    <section class="p-card" data-filtergroup>
      <div class="p-head">
        <h2>Downloads</h2>
        <div class="p-actions"><button class="secondary danger-text" id="clearBtn">Clear list</button></div>
      </div>
      <div id="list"><div class="empty">Loading…</div></div>
    </section>
    <div class="empty pn-hide" id="pnNoResults">No matching downloads</div>
  `;
  const script = `
    function fmt(n) {
      if (!n || n <= 0) return '0 B';
      var units = ['B', 'KB', 'MB', 'GB']; var i = 0;
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
      return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }
    function row(d) {
      var pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
      var size = d.total ? (fmt(d.received) + ' of ' + fmt(d.total)) : fmt(d.received);
      var status = d.state === 'completed' ? 'Completed' : d.state === 'cancelled' ? 'Cancelled' : d.state === 'interrupted' ? 'Failed' : (pct + '%');
      var actions = d.state === 'completed'
        ? '<button class="icon-btn" data-open="' + escapeHtml(d.id) + '">Open</button><button class="icon-btn" data-show="' + escapeHtml(d.id) + '">Show in folder</button>'
        : '';
      // filename/url come from the remote server (Content-Disposition, the
      // download URL) — page-controlled, so escaped.
      return '<div class="p-row" data-filter><div class="p-main"><div class="p-title">' + escapeHtml(d.filename) + '</div><div class="p-sub">' + escapeHtml(d.url) + '</div>' +
        (d.state === 'progressing' ? '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">' + size + '</div><div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' : '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">' + fmt(d.received) + '</div>') +
        '</div><span class="p-meta">' + status + '</span>' + actions + '</div>';
    }
    function render(list) {
      var el = document.getElementById('list');
      if (!list.length) {
        el.innerHTML = '<div class="empty">No downloads yet</div>';
      } else {
        el.innerHTML = list.slice().reverse().map(row).join('');
        el.querySelectorAll('[data-open]').forEach(function (b) {
          b.addEventListener('click', function () { window.internalAPI.openDownload(b.getAttribute('data-open')); });
        });
        el.querySelectorAll('[data-show]').forEach(function (b) {
          b.addEventListener('click', function () { window.internalAPI.showDownloadInFolder(b.getAttribute('data-show')); });
        });
      }
      panelFilter();
    }
    var timer = null;
    function refresh() {
      window.internalAPI.getDownloads().then(function (list) {
        render(list);
        var anyActive = list.some(function (d) { return d.state === 'progressing'; });
        if (anyActive && !timer) timer = setInterval(refresh, 800);
        if (!anyActive && timer) { clearInterval(timer); timer = null; }
      });
    }
    refresh();
    document.getElementById('clearBtn').addEventListener('click', function () {
      window.internalAPI.clearDownloads().then(render);
    });
  `;
  return panelShell({ title: 'Downloads', active: 'downloads', search: 'Search downloads', body: body, script: script });
}

function aboutPage() {
  const dev = credit(pkg.author, DEVELOPER);
  const org = credit(pkg.organization, ORGANIZATION);
  const link = (c, label) => c.url
    ? `<a data-ext href="${escapeHtml(c.url)}" title="${escapeHtml(c.url)}" style="color:var(--accent);text-decoration:none;font-size:inherit">${escapeHtml(label || c.name)}</a>`
    : `<span style="color:var(--text-dim)">${escapeHtml(c.name || '—')}</span>`;
  const body = `
    <section class="p-card" data-filtergroup>
      <div class="p-head"><h2>About Daybreak</h2></div>
      <div class="p-row" data-filter>
        <span class="p-logo" aria-hidden="true"></span>
        <div class="p-main">
          <div class="p-title">Daybreak ${escapeHtml(pkg.version)}</div>
          <div class="p-sub">Electron ${escapeHtml(process.versions.electron || '—')} · Chromium ${escapeHtml(process.versions.chrome || '—')} · Node ${escapeHtml(process.versions.node || '—')}</div>
        </div>
      </div>
      <div class="p-row" data-filter>
        <div class="p-main"><div class="p-title">Developer</div></div>
        <div class="p-ctl">${link(dev)}</div>
      </div>
      <div class="p-row" data-filter>
        <div class="p-main"><div class="p-title">Organization</div></div>
        <div class="p-ctl">${link(org)}</div>
      </div>
      <div class="p-row" data-filter>
        <div class="p-main"><div class="p-title">Source code</div></div>
        <div class="p-ctl">${link(SOURCE_CODE)}</div>
      </div>
    </section>
    <div class="empty pn-hide" id="pnNoResults">No matching rows</div>
  `;
  // The data-ext credit wiring (plain click opens a tab inside Daybreak,
  // middle click / Ctrl+click opens it in the background, graceful fallback
  // to plain navigation) ships with the shared panel script — the page has
  // no script of its own.
  return panelShell({ title: 'About', active: 'about', search: 'Search', body: body, script: '' });
}

// Main-process-side escaper for strings that are baked into page HTML HERE
// (view-source content, error-page URLs/hosts). This one never runs in a
// renderer; the renderer copies get SCRIPT_COMMON above via shell().
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function viewSourcePage(url, html) {
  const body = `
    <section class="p-card">
      <div class="p-head"><h2 style="white-space:normal">Source of ${escapeHtml(url || '')}</h2></div>
      <pre class="p-pre">${escapeHtml(html || '')}</pre>
    </section>
  `;
  return panelShell({ title: 'View Source', active: '', body: body, script: '' });
}

// Small self-contained tools bundled into Daybreak, reachable from the new
// tab page and the Apps hub. Add an entry here (and its route in main.js's
// protocol.handle) for anything added later — nothing else needs to change.
const APPS = [
  {
    id: 'authenticator',
    name: 'Authenticator',
    mark: '2F',
    description: 'Local two-factor authentication codes. Everything stays on this device.',
    url: 'daybreak://2FA'
  }
];

function appCardHtml(app) {
  return `
    <a class="app-card" data-filter href="${app.url}">
      <div class="app-card-mark">${escapeHtml(app.mark || app.name[0])}</div>
      <div class="app-card-name">${escapeHtml(app.name)}</div>
      <div class="app-card-desc">${escapeHtml(app.description)}</div>
    </a>
  `;
}

function appsPage() {
  const body = `
    <section class="p-card" data-filtergroup>
      <div class="p-head"><h2>Apps</h2></div>
      <div class="p-lede">Small self-contained tools built into Daybreak. More will show up here over time.</div>
      <div style="padding:2px 20px 18px"><div class="apps-grid">${APPS.map(appCardHtml).join('')}</div></div>
    </section>
    <div class="empty pn-hide" id="pnNoResults">No matching apps</div>
  `;
  return panelShell({ title: 'Apps', active: 'apps', search: 'Search apps', body: body, script: '' });
}

// Live process metrics straight from Electron (app.getAppMetrics), matched
// to real tab titles where a process is one of our own tab renderers. Built
// with DOM APIs / textContent rather than innerHTML on purpose: tab titles
// and URLs are page-controlled strings, so they must never be parsed as
// markup.
function performancePage() {
  const body = `
    <section class="p-card" data-filtergroup>
      <div class="p-head"><h2>Performance</h2></div>
      <div class="p-lede">Live resource use for every Daybreak process, measured by Electron itself. Updates every two seconds.</div>
      <div id="summary" class="p-lede" style="padding-top:0"></div>
      <div id="rows"></div>
    </section>
    <div class="empty pn-hide" id="pnNoResults">No matching processes</div>
  `;
  const script = `
    function labelFor(m) {
      if (m.tab) return { title: m.tab.title || m.tab.url, sub: m.tab.url };
      var names = { Browser: "Main process", GPU: "GPU process", Utility: "Utility process", Tab: "Renderer (Daybreak UI or internal page)" };
      return { title: names[m.type] || m.type, sub: "" };
    }
    function refresh() {
      window.internalAPI.getMetrics().then(function (list) {
        list.sort(function (a, b) { return b.memoryMB - a.memoryMB; });
        var total = list.reduce(function (s, m) { return s + m.memoryMB; }, 0);
        var cpuTotal = list.reduce(function (s, m) { return s + m.cpuPercent; }, 0);
        document.getElementById("summary").textContent =
          list.length + " processes  \u00b7  " + total + " MB total  \u00b7  " + cpuTotal.toFixed(1) + "% CPU";
        // Built with DOM APIs / textContent rather than innerHTML on
        // purpose: tab titles and URLs are page-controlled strings, so
        // they must never be parsed as markup.
        var el = document.getElementById("rows");
        el.textContent = "";
        list.forEach(function (m) {
          var lbl = labelFor(m);
          var row = document.createElement("div");
          row.className = "p-row";
          row.setAttribute("data-filter", "");
          var main = document.createElement("div");
          main.className = "p-main";
          var t = document.createElement("div");
          t.className = "p-title";
          t.textContent = lbl.title;
          main.appendChild(t);
          if (lbl.sub) {
            var u = document.createElement("div");
            u.className = "p-sub";
            u.textContent = lbl.sub;
            main.appendChild(u);
          }
          var meta = document.createElement("span");
          meta.className = "p-meta";
          meta.style.whiteSpace = "nowrap";
          meta.textContent = m.memoryMB + " MB  \u00b7  " + m.cpuPercent.toFixed(1) + "% CPU  \u00b7  PID " + m.pid;
          row.appendChild(main);
          row.appendChild(meta);
          el.appendChild(row);
        });
        panelFilter();
      });
    }
    refresh();
    setInterval(refresh, 2000);
  `;
  return panelShell({ title: 'Performance', active: 'performance', search: 'Search processes', body: body, script: script });
}

// ---------------- error page ----------------

// Chromium network error code → stable name, shown as the code line on the
// page ("net::ERR_NAME_NOT_RESOLVED"). Electron's errorDescription string
// varies between versions and situations; the numeric code is the reliable
// part, so the page content is driven by the code and the name is looked up
// here purely for display. Unknown codes degrade to a generic page that
// still shows the raw number.
const NET_ERROR_NAMES = {
  '-2': 'ERR_FAILED',
  '-6': 'ERR_FILE_NOT_FOUND',
  '-7': 'ERR_CONNECTION_TIMED_OUT',
  '-20': 'ERR_BLOCKED_BY_CLIENT',
  '-21': 'ERR_BLOCKED_BY_ADMINISTRATOR',
  '-100': 'ERR_CONNECTION_CLOSED',
  '-101': 'ERR_CONNECTION_RESET',
  '-102': 'ERR_CONNECTION_REFUSED',
  '-103': 'ERR_CONNECTION_ABORTED',
  '-104': 'ERR_EMPTY_RESPONSE',
  '-105': 'ERR_NAME_NOT_RESOLVED',
  '-106': 'ERR_INTERNET_DISCONNECTED',
  '-109': 'ERR_ADDRESS_UNREACHABLE',
  '-110': 'ERR_ACCESS_DENIED',
  '-118': 'ERR_CONNECTION_TIMED_OUT',
  '-130': 'ERR_PROXY_CONNECTION_FAILED',
  '-200': 'ERR_CERT_COMMON_NAME_INVALID',
  '-201': 'ERR_CERT_DATE_INVALID',
  '-202': 'ERR_CERT_AUTHORITY_INVALID',
  '-203': 'ERR_CERT_CONTAINS_ERRORS',
  '-204': 'ERR_CERT_NO_RESPONSES',
  '-205': 'ERR_CERT_UNABLE_TO_CHECK_REVOCATION',
  '-206': 'ERR_CERT_REVOKED',
  '-207': 'ERR_CERT_INVALID',
  '-208': 'ERR_CERT_WEAK_SIGNATURE_ALGORITHM',
  '-209': 'ERR_CERT_WEAK_KEY',
  '-210': 'ERR_CERT_NAME_CONSTRAINT_VIOLATION',
  '-211': 'ERR_CERT_VALIDITY_TOO_LONG',
  '-216': 'ERR_BAD_SSL_CLIENT_AUTH_CERT',
  '-310': 'ERR_TOO_MANY_REDIRECTS',
  '-325': 'ERR_SSL_PROTOCOL_ERROR',
  '-501': 'ERR_INSECURE_RESPONSE'
};
// Codes that mean "the certificate failed verification". These get the
// "Your connection is not private" treatment with a Details/proceed section.
// ERR_SSL_PROTOCOL_ERROR (-325) is NOT here: there is no certificate to
// make an exception for, so that page offers no bypass at all.
const CERT_ERROR_CODES = new Set([
  '-200', '-201', '-202', '-203', '-204', '-205', '-206', '-207', '-208',
  '-209', '-210', '-211', '-216', '-501'
]);

function errorIcon(kind) {
  const svg = (inner) =>
    '<svg style="width:64px;height:64px;color:var(--text-dim);opacity:.75" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  if (kind === 'cert') {
    return svg('<rect x="12" y="28" width="40" height="26" rx="6"/><path d="M22 28v-9a10 10 0 0 1 19.6-3"/><line x1="32" y1="37" x2="32" y2="44"/><circle cx="32" cy="48.6" r="1" fill="currentColor" stroke="none"/>');
  }
  if (kind === 'offline') {
    return svg('<path d="M20 44h25a10 10 0 0 0 3.4-19.4A14 14 0 0 0 21.5 21 11 11 0 0 0 20 44z"/><line x1="12" y1="54" x2="52" y2="10"/>');
  }
  if (kind === 'blocked') {
    return svg('<path d="M32 7l19 6.5V28c0 12.5-8 22-19 27-11-5-19-14.5-19-27V13.5z"/><line x1="25" y1="26" x2="39" y2="40"/><line x1="39" y1="26" x2="25" y2="40"/>');
  }
  if (kind === 'crash') {
    return svg('<circle cx="32" cy="32" r="23"/><circle cx="25" cy="27" r="1.6" fill="currentColor" stroke="none"/><circle cx="39" cy="27" r="1.6" fill="currentColor" stroke="none"/><path d="M24.5 41a10 10 0 0 1 15 0"/>');
  }
  return svg('<rect x="8" y="12" width="48" height="40" rx="6"/><line x1="8" y1="22" x2="56" y2="22"/><line x1="25" y1="32" x2="39" y2="46"/>');
}

// The full failure page. Everything page-controlled (the URL,
// the host) goes through escapeHtml; the headings/descriptions are static
// strings chosen by error code here in the main process, so no page data is
// ever interpolated unescaped.
function errorPage(params) {
  const url = String((params && params.url) || '');
  const type = String((params && params.type) || 'net');
  const reason = String((params && params.reason) || '');
  // The last URL that actually COMMITTED before the failure (main.js tracks
  // this per tab). "Go back" replaces onto it directly — see the script
  // comment below for why plain history.back() is the wrong tool here.
  const back = String((params && params.back) || '');
  const rawCode = params && params.code != null && !isNaN(Number(params.code)) ? String(Number(params.code)) : '';

  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, '') || url; } catch (e) { /* keep raw url */ }

  const isCrash = type === 'crash';
  const isCert = CERT_ERROR_CODES.has(rawCode);
  const isTlsProto = rawCode === '-325';

  const H = '<strong style="color:var(--text)">' + escapeHtml(host) + '</strong>';
  const hostText = escapeHtml(host);

  let kind = 'net';
  let heading;
  let desc;
  if (isCrash) {
    kind = 'crash';
    heading = 'Aw, Snap!';
    desc = 'Something went wrong while displaying this page. ' +
      (reason === 'oom' ? 'The page ran out of memory.'
        : reason === 'killed' ? 'The page was terminated by the system.'
        : 'The page\'s renderer process crashed unexpectedly.');
  } else if (isCert) {
    kind = 'cert';
    heading = 'Your connection is not private';
    desc = 'Attackers might be trying to steal your information from ' + H + ' (for example, passwords, messages, or credit cards). You should not proceed, especially if this warning looks unusual.';
  } else if (isTlsProto) {
    kind = 'cert';
    heading = "This site can't provide a secure connection";
    desc = H + ' uses an unsupported protocol or an invalid TLS configuration, so a secure channel could not be established.';
  } else {
    switch (rawCode) {
      case '-105': heading = "This site can't be reached"; desc = H + '\'s server IP address could not be found. Check that the address is spelled correctly, or try searching for it.'; break;
      case '-7': case '-118': heading = "This site can't be reached"; desc = H + ' took too long to respond.'; break;
      case '-102': heading = "This site can't be reached"; desc = H + ' refused to connect.'; break;
      case '-100': heading = "This site can't be reached"; desc = H + ' unexpectedly closed the connection.'; break;
      case '-101': heading = "This site can't be reached"; desc = 'The connection was reset while loading ' + H + '.'; break;
      case '-103': heading = "This site can't be reached"; desc = 'The connection to ' + H + ' was aborted.'; break;
      case '-104': heading = "This page didn't send any data"; desc = H + ' accepted the connection but sent an empty response.'; break;
      case '-310': heading = "This page isn't working"; desc = H + ' redirected you too many times.'; break;
      case '-109': heading = "This site can't be reached"; desc = 'The server address of ' + H + ' is unreachable.'; break;
      case '-110': case '-6': heading = "This site can't be reached"; desc = 'The file or directory could not be found, or access to it was denied.'; break;
      case '-130': heading = 'There is a problem with your proxy'; desc = 'Daybreak could not connect to the configured proxy server. Check your proxy settings, then try reloading.'; break;
      case '-106': kind = 'offline'; heading = 'No internet connection'; desc = 'Daybreak cannot reach any network right now. Check your network cables, modem and router, or reconnect to Wi-Fi.'; break;
      case '-20': kind = 'blocked'; heading = 'This page has been blocked'; desc = H + ' is on Daybreak\'s ad and tracker block list, so the request never left the browser. If this is wrong, the ad blocker can be turned off in Settings.'; break;
      case '-21': kind = 'blocked'; heading = 'This page has been blocked'; desc = 'Access to ' + H + ' was denied by your administrator.'; break;
      default: heading = "This site can't be reached"; desc = H + ' could not be loaded. The error code below may help identify the problem.';
    }
  }

  let codeLabel = '';
  if (isCrash) codeLabel = reason ? 'reason: ' + escapeHtml(reason) : '';
  else if (rawCode && NET_ERROR_NAMES[rawCode]) codeLabel = 'net::' + NET_ERROR_NAMES[rawCode];
  else if (rawCode) codeLabel = 'net::ERR_UNKNOWN (' + rawCode + ')';

  const secondaryBtn = 'padding:8px 16px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);font-size:13px;cursor:pointer';

  // "Go back" only renders when there is a real page to go back TO (it is
  // hidden on a first-load failure too). Certificate pages always keep
  // "Back to safety" — with no committed page behind the failure it falls
  // back to the New Tab page.
  const backTarget = back || (isCert ? 'daybreak://newtab' : '');
  const backBtnHtml = backTarget
    ? '<button id="backBtn" style="' + secondaryBtn + '" data-back="' + escapeHtml(backTarget) + '">' + (isCert ? 'Back to safety' : 'Go back') + '</button>'
    : '';

  const advHtml = isCert
    ? '<button id="advBtn" style="' + secondaryBtn + '">Details</button>' +
      '<div id="advBox" hidden style="margin-top:24px;max-width:560px;text-align:left;border:1px solid var(--danger);border-radius:10px;padding:14px 16px;background:var(--panel)">' +
        '<div style="font-size:12.5px;font-weight:600;margin-bottom:6px">This server could not prove it is ' + hostText + '.</div>' +
        '<div style="font-size:11.5px;color:var(--text-dim);line-height:1.6">Its security certificate is not trusted. Proceeding exposes information you send to ' + hostText + ' to whoever controls the connection instead of the real site. The exception is kept in memory only and expires when Daybreak closes.</div>' +
        '<button id="proceedBtn" class="action danger" style="margin-top:12px">Proceed to ' + hostText + ' (unsafe)</button>' +
      '</div>'
    : '';

  const body = `
    <section class="p-card" style="padding:0">
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:40px 24px 44px">
        ${errorIcon(kind)}
        <h1 style="font-size:22px;font-weight:600;letter-spacing:-.01em;margin:22px 0 12px">${heading}</h1>
        <p style="max-width:560px;font-size:13.5px;color:var(--text-dim);line-height:1.7;margin:0 0 10px">${desc}</p>
        ${codeLabel ? '<div style="font-size:11px;color:var(--text-dim);font-family:ui-monospace,Consolas,Menlo,monospace">' + codeLabel + '</div>' : ''}
        ${url ? '<div style="font-size:11px;color:var(--text-dim);font-family:ui-monospace,Consolas,Menlo,monospace;word-break:break-all;max-width:560px;margin-top:6px">' + escapeHtml(url) + '</div>' : ''}
        <div style="display:flex;gap:10px;margin-top:28px;flex-wrap:wrap;justify-content:center">
          <button id="retryBtn" class="action" data-url="${escapeHtml(url)}">Reload</button>
          ${backBtnHtml}
          ${advHtml}
        </div>
      </div>
    </section>
  `;

  const script = `
    var retryBtn = document.getElementById('retryBtn');
    var failedUrl = retryBtn ? retryBtn.getAttribute('data-url') : '';
    var backBtn = document.getElementById('backBtn');
    // Why not history.back()? Chromium keeps FAILED navigations in the
    // back/forward list, and every failure also stacked another identical
    // daybreak://error entry on top — so history.back() re-ran the dead
    // navigation (which failed again and redrew the same error page) or
    // landed on the identical error page behind it. Either way the button
    // looked dead. The main process instead passes the last URL that truly
    // committed in data-back; replacing onto it skips every dead entry in
    // one deterministic hop.
    function goBack() {
      if (backBtn) location.replace(backBtn.getAttribute('data-back'));
    }
    function retry() { window.internalAPI.errorRetry(failedUrl); }
    retryBtn.addEventListener('click', retry);
    if (backBtn) backBtn.addEventListener('click', goBack);
    var advBtn = document.getElementById('advBtn');
    if (advBtn) advBtn.addEventListener('click', function () {
      var box = document.getElementById('advBox');
      box.hidden = !box.hidden;
    });
    var proceedBtn = document.getElementById('proceedBtn');
    if (proceedBtn) proceedBtn.addEventListener('click', function () {
      window.internalAPI.errorAcceptCert(failedUrl);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); retry(); }
      else if (e.key === 'Escape' && backBtn) { e.preventDefault(); goBack(); }
    });
  `;
  // The error pages use the shared sidebar structure too (without the
  // search box — there is nothing on an error page to filter), so a failed
  // load always leaves the sidebar one click away.
  return panelShell({ title: 'Error', active: '', body: body, script: script });
}

module.exports = { newTabPage, bookmarksPage, historyPage, settingsPage, downloadsPage, aboutPage, viewSourcePage, appsPage, performancePage, errorPage, APPS };
