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
<script>${SCRIPT_COMMON}
${THEME_INIT}
${script}</script>
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
    function tile(url, title, favicon) {
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
      return '<a href="' + safeUrl + '" style="text-decoration:none;color:inherit;display:flex;align-items:center;gap:10px;' +
        'padding:11px 12px;border-radius:9px;border:1px solid var(--border);background:var(--panel);' +
        'transition:border-color .12s ease,transform .12s ease" ' +
        'onmouseover="this.style.borderColor=\\'var(--accent)\\';this.style.transform=\\'translateY(-1px)\\'" ' +
        'onmouseout="this.style.borderColor=\\'var(--border)\\';this.style.transform=\\'none\\'">' +
        iconHtml +
        '<div style="min-width:0"><div style="font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + safeTitle + '</div>' +
        '<div style="font-size:10px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + safeHost + '</div></div></a>';
    }
    window.internalAPI.getBookmarks().then(function (list) {
      var el = document.getElementById('tiles');
      if (!list.length) return;
      document.getElementById('tilesLabel').style.display = 'block';
      el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">' +
        list.slice(-9).reverse().map(function (b) { return tile(b.url, b.title, b.favicon); }).join('') + '</div>';
    });
  `;
  return shell('New Tab', body, script);
}

function bookmarksPage() {
  const body = `
    <h1>Bookmarks</h1>
    <div id="list"><div class="empty">Loading…</div></div>
  `;
  const script = `
    function render(list) {
      var el = document.getElementById('list');
      if (!list.length) { el.innerHTML = '<div class="empty">No bookmarks yet</div>'; return; }
      el.innerHTML = list.slice().reverse().map(function (b) {
        var icon = b.favicon
          ? '<img src="' + escapeHtml(b.favicon) + '" alt="" style="width:16px;height:16px;border-radius:3px;flex-shrink:0" onerror="this.remove()">'
          : '<span style="width:16px;height:16px;border-radius:3px;flex-shrink:0;background:var(--border);display:inline-block"></span>';
        return '<div class="row"><div class="main" style="display:flex;align-items:center;gap:10px"><a class="title-link" style="display:flex;align-items:center;gap:10px;min-width:0;flex:1" href="' + escapeHtml(b.url) + '">' + icon + '<span style="min-width:0"><div class="title">' + escapeHtml(b.title || b.url) + '</div><div class="url">' + escapeHtml(b.url) + '</div></span></a></div>' +
          '<button class="icon-btn" data-id="' + escapeHtml(b.id) + '">Remove</button></div>';
      }).join('');
      el.querySelectorAll('button[data-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          window.internalAPI.removeBookmark(btn.getAttribute('data-id')).then(render);
        });
      });
    }
    window.internalAPI.getBookmarks().then(render);
  `;
  return shell('Bookmarks', body, script);
}

function historyPage() {
  const body = `
    <h1>History</h1>
    <div class="toolbar">
      <input type="search" id="filter" placeholder="Search history">
      <button class="action danger" id="clearBtn">Clear all</button>
    </div>
    <div id="list"><div class="empty">Loading…</div></div>
  `;
  const script = `
    var all = [];
    function render(list) {
      var el = document.getElementById('list');
      if (!list.length) { el.innerHTML = '<div class="empty">No history yet</div>'; return; }
      el.innerHTML = list.slice().reverse().map(function (h) {
        var date = new Date(h.timestamp);
        return '<div class="row"><div class="main"><a class="title-link" href="' + escapeHtml(h.url) + '"><div class="title">' + escapeHtml(h.title || h.url) + '</div><div class="url">' + escapeHtml(h.url) + '</div></a></div>' +
          '<span class="meta">' + date.toLocaleString() + '</span>' +
          '<button class="icon-btn" data-id="' + escapeHtml(h.id) + '">Remove</button></div>';
      }).join('');
      el.querySelectorAll('button[data-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          window.internalAPI.removeHistory(btn.getAttribute('data-id')).then(function (list) { all = list; render(all); });
        });
      });
    }
    window.internalAPI.getHistory().then(function (list) { all = list; render(all); });
    document.getElementById('filter').addEventListener('input', function (e) {
      var q = e.target.value.toLowerCase();
      render(all.filter(function (h) { return (h.title || '').toLowerCase().indexOf(q) >= 0 || h.url.toLowerCase().indexOf(q) >= 0; }));
    });
    document.getElementById('clearBtn').addEventListener('click', function () {
      window.internalAPI.clearHistory().then(function () { all = []; render(all); });
    });
  `;
  return shell('History', body, script);
}

function settingsPage() {
  const body = `
    <h1>Settings</h1>
    <div class="row"><div class="main"><div class="title">Block ads &amp; trackers</div><div class="url">Blocks known ad/tracker domains across all tabs</div></div>
      <input type="checkbox" id="adBlockEnabled"></div>
    <div class="row"><div class="main"><div class="title">Memory Saver</div><div class="url">Frees background tabs left unused for a while; they reload automatically when revisited</div></div>
      <input type="checkbox" id="memorySaverEnabled"></div>
    <div class="row"><div class="main"><div class="title">Homepage / new tab</div></div>
      <input type="text" id="homepage" style="max-width:280px" placeholder="daybreak://newtab"></div>
    <div class="row"><div class="main"><div class="title">Default search engine</div></div>
      <select id="searchEngine">
        <option value="google">Google</option>
        <option value="bing">Bing</option>
        <option value="duckduckgo">DuckDuckGo</option>
      </select></div>
    <div class="row"><div class="main"><div class="title">Show bookmarks bar</div></div>
      <input type="checkbox" id="showBookmarksBar"></div>
    <div class="row"><div class="main"><div class="title">Theme</div></div>
      <select id="theme">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select></div>
    <div style="margin-top:16px">
      <button class="action" id="saveBtn">Save</button>
      <span id="savedMsg" style="font-size:12px;color:#188038;margin-left:8px;display:none">Saved</span>
    </div>
  `;
  const script = `
    function load() {
      window.internalAPI.getSettings().then(function (s) {
        document.getElementById('adBlockEnabled').checked = s.adBlockEnabled !== false;
        document.getElementById('memorySaverEnabled').checked = s.memorySaverEnabled === true;
        document.getElementById('homepage').value = s.homepage || 'daybreak://newtab';
        document.getElementById('searchEngine').value = s.searchEngine || 'google';
        document.getElementById('showBookmarksBar').checked = !!s.showBookmarksBar;
        document.getElementById('theme').value = s.theme || 'light';
      });
    }
    load();
    document.getElementById('saveBtn').addEventListener('click', function () {
      window.internalAPI.setSettings({
        adBlockEnabled: document.getElementById('adBlockEnabled').checked,
        memorySaverEnabled: document.getElementById('memorySaverEnabled').checked,
        homepage: document.getElementById('homepage').value.trim() || 'daybreak://newtab',
        searchEngine: document.getElementById('searchEngine').value,
        showBookmarksBar: document.getElementById('showBookmarksBar').checked,
        theme: document.getElementById('theme').value
      }).then(function (s) {
        document.body.classList.toggle('dark', s.theme === 'dark');
        var msg = document.getElementById('savedMsg');
        msg.style.display = 'inline';
        setTimeout(function () { msg.style.display = 'none'; }, 1500);
      });
    });
  `;
  return shell('Settings', body, script);
}

function downloadsPage() {
  const body = `
    <h1>Downloads</h1>
    <div class="toolbar"><button class="action danger" id="clearBtn">Clear list</button></div>
    <div id="list"><div class="empty">Loading…</div></div>
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
      return '<div class="row"><div class="main"><div class="title">' + escapeHtml(d.filename) + '</div><div class="url">' + escapeHtml(d.url) + '</div>' +
        (d.state === 'progressing' ? '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">' + size + '</div><div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' : '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">' + fmt(d.received) + '</div>') +
        '</div><span class="meta">' + status + '</span>' + actions + '</div>';
    }
    function render(list) {
      var el = document.getElementById('list');
      if (!list.length) { el.innerHTML = '<div class="empty">No downloads yet</div>'; return; }
      el.innerHTML = list.slice().reverse().map(row).join('');
      el.querySelectorAll('[data-open]').forEach(function (b) {
        b.addEventListener('click', function () { window.internalAPI.openDownload(b.getAttribute('data-open')); });
      });
      el.querySelectorAll('[data-show]').forEach(function (b) {
        b.addEventListener('click', function () { window.internalAPI.showDownloadInFolder(b.getAttribute('data-show')); });
      });
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
  return shell('Downloads', body, script);
}

function aboutPage() {
  const body = `
    <div style="text-align:center;padding-top:8vh">
      <div style="width:40px;height:40px;border-radius:50%;border:2px solid var(--accent);
                  border-bottom-color:transparent;transform:rotate(-45deg);margin:0 auto 16px"></div>
      <div style="font-size:20px;font-weight:600;margin-bottom:4px">Daybreak</div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:24px">Version ${pkg.version}</div>
      <div style="font-size:12px;color:var(--text-dim);line-height:1.9">
        Electron ${process.versions.electron || '—'}<br>
        Chromium ${process.versions.chrome || '—'}<br>
        Node ${process.versions.node || '—'}
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:24px">
        Developer: <a href="https://github.com/whitedragon-software" target="_blank" style="color:var(--accent);text-decoration:none">${pkg.author || '—'}</a>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:6px">
        <a href="https://whitedragon.software" target="_blank" style="color:var(--accent);text-decoration:none">whitedragon.software</a>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:6px">
        Source code: <a href="https://github.com/whitedragon-software/daybreak" target="_blank" style="color:var(--accent);text-decoration:none">github.com/whitedragon-software/daybreak</a>
      </div>
    </div>
  `;
  return shell('About', body, '');
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
    <h1 style="word-break:break-all">Source of ${escapeHtml(url || '')}</h1>
    <pre style="white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,Menlo,monospace;
                font-size:12px;line-height:1.5;background:var(--panel);border:1px solid var(--border);
                border-radius:8px;padding:16px;margin:0">${escapeHtml(html || '')}</pre>
  `;
  return shell('View Source', body, '');
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
    <a class="app-card" href="${app.url}">
      <div class="app-card-mark">${escapeHtml(app.mark || app.name[0])}</div>
      <div class="app-card-name">${escapeHtml(app.name)}</div>
      <div class="app-card-desc">${escapeHtml(app.description)}</div>
    </a>
  `;
}

function appsPage() {
  const body = `
    <h1>Apps</h1>
    <p style="color:var(--text-dim);font-size:12px;margin:-10px 0 20px">
      Small self-contained tools built into Daybreak. More will show up here over time.
    </p>
    <div class="apps-grid">${APPS.map(appCardHtml).join('')}</div>
  `;
  return shell('Apps', body, '');
}

// Live process metrics straight from Electron (app.getAppMetrics), matched
// to real tab titles where a process is one of our own tab renderers. Built
// with DOM APIs / textContent rather than innerHTML on purpose: tab titles
// and URLs are page-controlled strings, so they must never be parsed as
// markup.
function performancePage() {
  const body = `
    <h1>Performance</h1>
    <p style="color:var(--text-dim);font-size:12px;margin:-10px 0 16px">
      Live resource use for every Daybreak process, measured by Electron itself. Updates every two seconds.
    </p>
    <div id="summary" style="font-size:12px;color:var(--text-dim);margin-bottom:12px"></div>
    <div id="rows"></div>
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
          list.length + " processes  \\u00b7  " + total + " MB total  \\u00b7  " + cpuTotal.toFixed(1) + "% CPU";
        var el = document.getElementById("rows");
        el.textContent = "";
        list.forEach(function (m) {
          var lbl = labelFor(m);
          var row = document.createElement("div");
          row.className = "row";
          var main = document.createElement("div");
          main.className = "main";
          var t = document.createElement("div");
          t.className = "title";
          t.textContent = lbl.title;
          main.appendChild(t);
          if (lbl.sub) {
            var u = document.createElement("div");
            u.className = "url";
            u.textContent = lbl.sub;
            main.appendChild(u);
          }
          var meta = document.createElement("span");
          meta.className = "meta";
          meta.style.whiteSpace = "nowrap";
          meta.textContent = m.memoryMB + " MB  \\u00b7  " + m.cpuPercent.toFixed(1) + "% CPU  \\u00b7  PID " + m.pid;
          row.appendChild(main);
          row.appendChild(meta);
          el.appendChild(row);
        });
      });
    }
    refresh();
    setInterval(refresh, 2000);
  `;
  return shell('Performance', body, script);
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
// make an exception for, so that page offers no bypass, like Chrome.
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

// The full Chrome-style failure page. Everything page-controlled (the URL,
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

  // "Go back" only renders when there is a real page to go back TO (Chrome
  // hides it on a first-load failure too). Certificate pages always keep
  // "Back to safety" — with no committed page behind the failure it falls
  // back to the New Tab page, which is Chrome's own fallback as well.
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
    <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:9vh">
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
    // one deterministic hop, exactly what Chrome's own error-page Back does.
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
  return shell('Error', body, script);
}

module.exports = { newTabPage, bookmarksPage, historyPage, settingsPage, downloadsPage, aboutPage, viewSourcePage, appsPage, performancePage, errorPage, APPS };
