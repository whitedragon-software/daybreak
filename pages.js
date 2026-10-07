// Generates the internal "daybreak://" pages. Plain strings, no build step —
// each page is a full HTML document with inline CSS/JS, talking to main
// process only through window.internalAPI (see tab-preload.js).

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

// Applied first in every internal page so the overlay's theme choice carries
// over into daybreak:// pages too (real websites aren't touched — that's
// standard browser behavior, not something a page shell should force).
const THEME_INIT = `
  window.internalAPI.getSettings().then(function (s) {
    document.body.classList.toggle('dark', s.theme === 'dark');
  });
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
<script>${THEME_INIT}
${script}</script>
</body>
</html>`;
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
      var iconHtml = favicon
        ? '<img src="' + favicon + '" alt="" style="width:30px;height:30px;flex-shrink:0;border-radius:7px;object-fit:cover" onerror="this.remove()">'
        : '<div style="width:30px;height:30px;flex-shrink:0;border-radius:7px;display:flex;align-items:center;justify-content:center;' +
            'background:hsl(' + hue + ',55%,45%);color:#fff;font-size:13px;font-weight:600">' + letter + '</div>';
      return '<a href="' + url + '" style="text-decoration:none;color:inherit;display:flex;align-items:center;gap:10px;' +
        'padding:11px 12px;border-radius:9px;border:1px solid var(--border);background:var(--panel);' +
        'transition:border-color .12s ease,transform .12s ease" ' +
        'onmouseover="this.style.borderColor=\\'var(--accent)\\';this.style.transform=\\'translateY(-1px)\\'" ' +
        'onmouseout="this.style.borderColor=\\'var(--border)\\';this.style.transform=\\'none\\'">' +
        iconHtml +
        '<div style="min-width:0"><div style="font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (title || host) + '</div>' +
        '<div style="font-size:10px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + host + '</div></div></a>';
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
          ? '<img src="' + b.favicon + '" alt="" style="width:16px;height:16px;border-radius:3px;flex-shrink:0" onerror="this.remove()">'
          : '<span style="width:16px;height:16px;border-radius:3px;flex-shrink:0;background:var(--border);display:inline-block"></span>';
        return '<div class="row"><div class="main" style="display:flex;align-items:center;gap:10px"><a class="title-link" style="display:flex;align-items:center;gap:10px;min-width:0;flex:1" href="' + b.url + '">' + icon + '<span style="min-width:0"><div class="title">' + (b.title || b.url) + '</div><div class="url">' + b.url + '</div></span></a></div>' +
          '<button class="icon-btn" data-id="' + b.id + '">Remove</button></div>';
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
        return '<div class="row"><div class="main"><a class="title-link" href="' + h.url + '"><div class="title">' + (h.title || h.url) + '</div><div class="url">' + h.url + '</div></a></div>' +
          '<span class="meta">' + date.toLocaleString() + '</span>' +
          '<button class="icon-btn" data-id="' + h.id + '">Remove</button></div>';
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
        ? '<button class="icon-btn" data-open="' + d.id + '">Open</button><button class="icon-btn" data-show="' + d.id + '">Show in folder</button>'
        : '';
      return '<div class="row"><div class="main"><div class="title">' + d.filename + '</div><div class="url">' + d.url + '</div>' +
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

module.exports = { newTabPage, bookmarksPage, historyPage, settingsPage, downloadsPage, aboutPage, viewSourcePage, appsPage, performancePage, APPS };
