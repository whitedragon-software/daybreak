const { app, BaseWindow, WebContentsView, ipcMain, protocol, session, shell, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const pages = require('./pages.js');

// A fully self-contained static page (its own theme system, its own
// localStorage-backed persistence) — unlike the other internal pages, it
// doesn't need generating per request. It's also by far the largest asset
// in the app, so it's read from disk on first visit rather than at startup:
// the cold-start path no longer pays for a page most sessions never open.
let twoFaHtml = null;
function getTwoFaHtml() {
  if (twoFaHtml === null) twoFaHtml = fs.readFileSync(path.join(__dirname, '2FA.html'), 'utf8');
  return twoFaHtml;
}

// Most of what shows up in the terminal when running via `npm start` is
// Chromium's own low-level network-stack logging (STUN lookups failing for
// ad-network hosts that are now blocked, SSL handshake noise from those
// same hosts, internal debug markers) — normally invisible in a packaged
// app because nothing is attached to stdout/stderr to display it. It's
// expected side-effect noise from blocking those hosts, not an error in
// this app, but there's no reason to leave it this verbose in a dev
// console. Must be set before the app is ready.
app.commandLine.appendSwitch('log-level', '3'); // fatal only
app.commandLine.appendSwitch('disable-logging');

// Real compositor-level performance work, not app-side workarounds. Both
// are well-established, broadly-shipped Chromium flags (used by e.g.
// VS Code and Slack's Electron builds): GPU rasterization moves paint
// work off the CPU onto the GPU, and zero-copy avoids an extra memory
// copy when handing rasterized tiles to the GPU. Left off is Chromium's
// own conservative default for compatibility with unusual GPU drivers;
// on typical hardware this is a genuine rendering-throughput win, not a
// placebo flag.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

const TAB_ROW_HEIGHT = 36;
const NAV_ROW_HEIGHT = 40;
const BOOKMARKS_BAR_HEIGHT = 32;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;
const MEMORY_SAVER_IDLE_MS = 20 * 60 * 1000; // discard a background tab after this long unused
const MEMORY_SAVER_SWEEP_MS = 60 * 1000; // how often to check
const HISTORY_MAX = 5000; // real ceiling on long-session memory/disk growth, not unbounded accumulation
const DOWNLOADS_MAX = 500;
// Spinner hard cap. A page can keep a hung sub-resource (a black-holed ad
// request, most commonly) alive indefinitely, which keeps the session's
// loading state true forever; without a cap the tab spinner would never
// turn off even though the page itself is usable.
const SPINNER_MAX_MS = 15 * 1000;
// Cap on how much of a page's source is kept in memory for view-source.
const VIEW_SOURCE_MAX_CHARS = 5 * 1024 * 1024;

// Private (incognito) browsing is a WINDOW-level thing here, exactly like
// Chrome: a private window runs in its own session partition, and every
// tab inside it is private by construction — there is no per-tab privacy
// flag left anywhere. A partition name WITHOUT the "persist:" prefix is
// purely in-memory: cookies, cache, localStorage and service workers
// exist only for the current app run and are never written to disk.
// Created lazily — every caller runs after the app is ready.
const PRIVATE_PARTITION = 'daybreak-private';
let privateSes = null;
function getPrivateSes() {
  if (!privateSes) privateSes = session.fromPartition(PRIVATE_PARTITION);
  return privateSes;
}

// Chrome wipes an incognito profile the moment its LAST window closes —
// the data shouldn't outlive the browsing that created it, even though
// the app itself keeps running. Same deal here: when no private window is
// left, drop everything the in-memory partition accumulated (cookies,
// storage, service workers, cache). If a new private window opens right
// after, it simply starts clean.
function maybeWipePrivateSession() {
  if (privateSes && !windows.some((st) => st.priv)) {
    privateSes.clearStorageData().catch(() => {});
    privateSes.clearCache().catch(() => {});
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'daybreak', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

// User-accepted certificate exceptions (the "Proceed to … (unsafe)" button
// on a certificate error page). host → Set of certificate fingerprints the
// user explicitly accepted for that host. Kept in memory only: nothing is
// pre-accepted, nothing survives a restart, and only an exact host+
// fingerprint pair observed in a REAL prior denial (lastDeniedCert below)
// can ever be added. lastDeniedCert remembers the fingerprint of the most
// recent main-frame denial per host so the error page's accept button binds
// to something that was actually seen, not to whatever a page claims.
const allowedCerts = new Map();
const lastDeniedCert = new Map();

// Without this handler Chromium just denies (and logs) every certificate
// error uniformly; with it, denied errors still flow into did-fail-load and
// produce the "Your connection is not private" error page, while an
// explicitly accepted exception re-runs verification as successful.
// Sub-frame certificate errors are never accepted.
app.on('certificate-error', (event, _webContents, url, _error, certificate, callback, isMainFrame) => {
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { /* unparseable — deny below */ }
  const fingerprint = certificate && certificate.fingerprint;
  if (isMainFrame && host && fingerprint) {
    const accepted = allowedCerts.get(host);
    if (accepted && accepted.has(fingerprint)) {
      event.preventDefault();
      callback(true);
      return;
    }
    lastDeniedCert.set(host, fingerprint);
  }
  callback(false);
});

// ---------------- windows (multi-window state) ----------------

// Every browser window — normal or private — is a fully self-contained
// state object: its own BaseWindow, its own overlay (toolbar) view, its
// own tab map and active tab. Nothing browser-related is global anymore,
// so a private window and a normal window can live side by side without
// ever sharing tabs, sessions or UI state.
const windows = []; // every live browser window state, in creation order

function createBrowserState(priv) {
  return {
    priv: !!priv,
    win: null,
    overlay: null,
    /** @type {Map<string, { view: import('electron').WebContentsView, title: string, url: string, loading: boolean, pinned: boolean, lastHistoryId: string|null }>} */
    tabs: new Map(),
    activeId: null,
    overlayExtra: 0,
    lastLayoutKey: '',
    dragging: false,
    dragFixedSize: null, // {width, height} captured at drag start, re-asserted on every move
    pushTimer: null
  };
}

function winAlive(st) {
  return !!(st.win && !st.win.isDestroyed());
}
function overlayAlive(st) {
  return !!(st.overlay && !st.overlay.webContents.isDestroyed());
}

// Which window does an IPC sender belong to? Both the overlay (toolbar)
// and every tab view of a window route back to that window's state — IPC
// handlers never guess "the one window" anymore.
function stateFromSender(sender) {
  if (!sender) return null;
  for (const st of windows) {
    if (overlayAlive(st) && st.overlay.webContents === sender) return st;
    for (const [, tab] of st.tabs) {
      if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents === sender) return st;
    }
  }
  return null;
}

// Tab ids are UUIDs, unique across all windows — resolve the owning window
// from the id alone.
function stateFromTabId(id) {
  for (const st of windows) {
    if (st.tabs.has(id)) return st;
  }
  return null;
}

function findTab(id) {
  for (const st of windows) {
    const tab = st.tabs.get(id);
    if (tab) return { st, tab };
  }
  return null;
}

// ---------------- persisted data ----------------

function dataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function loadJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function saveJSON(name, data) {
  try {
    // Compact output: these files are only ever read back by loadJSON, so
    // pretty-printing only made them ~30-40% larger and slower to write —
    // history alone can be 5000 entries.
    fs.writeFileSync(dataFile(name), JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save', name, e);
  }
}

const saveTimers = {};
function saveJSONDebounced(name, getData) {
  if (saveTimers[name]) clearTimeout(saveTimers[name]);
  saveTimers[name] = setTimeout(() => {
    delete saveTimers[name];
    saveJSON(name, getData());
  }, 300);
}

let bookmarks = loadJSON('bookmarks.json', []);
let history = loadJSON('history.json', []);
let downloads = loadJSON('downloads.json', []);
// Memory Saver now defaults ON: an idle background tab holds a whole
// renderer process (~100 MB baseline each) hostage for as long as the tab
// exists, which is exactly the RAM cost users feel but can't see in the
// process list. Discarding frees the entire process; the tab keeps its
// title/URL/position and reloads briefly when revisited. A saved
// settings.json still overrides this default, so existing installs keep
// whatever was last chosen there.
let settings = Object.assign(
  { theme: 'light', homepage: 'daybreak://newtab', searchEngine: 'google', showBookmarksBar: true, adBlockEnabled: true, memorySaverEnabled: true },
  loadJSON('settings.json', {})
);

// Bookmarks/settings changes are rare and user-initiated, so those save
// immediately. History and downloads can update many times in a burst (a
// busy page firing several navigations within milliseconds, or a
// downloads's progress ticking) — those are debounced so we don't do a
// synchronous disk write on every single event.
function saveBookmarks() { saveJSON('bookmarks.json', bookmarks); }
function saveHistory() { saveJSONDebounced('history.json', () => history); }
function saveDownloads() {
  // Private-window downloads stay in the in-memory list for the current
  // session but must never reach downloads.json — that's the whole point
  // of a private window.
  saveJSONDebounced('downloads.json', () => downloads.filter((d) => !d.priv));
}
function saveSettings() { saveJSON('settings.json', settings); }

// ---------------- layout ----------------

// Extra height temporarily reserved so the overlay can paint a floating
// menu/find-bar without it being clipped at the toolbar's normal bottom
// edge. WebContentsView has no setIgnoreMouseEvents/click-through support,
// so the overlay can only ever safely cover the toolbar strip — not the
// full window — which means this is the mechanism for floating UI instead
// of making the overlay full-window. Per window.
//
// layout() is driven by exactly five inputs (window size, toolbar height,
// overlayExtra, active tab). Window resize fires in a continuous stream
// while an edge is dragged, and each event redid a full setBounds pass over
// every tab; skipping no-op passes removes that churn.

function chromeHeight() {
  return TAB_ROW_HEIGHT + NAV_ROW_HEIGHT + (settings.showBookmarksBar ? BOOKMARKS_BAR_HEIGHT : 0);
}

function layout(st) {
  if (!winAlive(st) || !overlayAlive(st)) return;
  const [width, height] = st.win.getContentSize();
  const key = width + '|' + height + '|' + chromeHeight() + '|' + st.overlayExtra + '|' + st.activeId;
  if (key === st.lastLayoutKey) return;
  st.lastLayoutKey = key;

  const tabTop = chromeHeight();

  // The overlay covers the toolbar (+ any temporarily reserved extra for an
  // open menu/find-bar) and stays on top in z-order; the tab view always
  // starts at the fixed toolbar height regardless of overlayExtra, so
  // opening a menu never resizes or reflows the page underneath.
  st.overlay.setBounds({ x: 0, y: 0, width, height: Math.min(height, tabTop + st.overlayExtra) });

  for (const [id, tab] of st.tabs) {
    if (!tab.view) continue; // discarded by Memory Saver — nothing to lay out until revived
    if (id === st.activeId) {
      tab.view.setBounds({ x: 0, y: tabTop, width, height: Math.max(0, height - tabTop) });
    } else {
      tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }
}

// ---------------- state push ----------------

function serializeState(st) {
  // One Set per push instead of a bookmarks.some() scan per tab per push —
  // with many tabs and bookmarks the old form was O(tabs × bookmarks).
  const bookmarkUrls = new Set(bookmarks.map((b) => b.url));
  return {
    // Window-level privacy: the overlay uses this to go dark-chrome and
    // show the Private badge (index.html body.private).
    priv: st.priv,
    activeId: st.activeId,
    settings,
    bookmarks,
    tabs: [...st.tabs.entries()].map(([id, tab]) => {
      const wc = tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;

      // canGoBack/canGoForward/isCurrentlyAudible/isAudioMuted are each a
      // real call into the tab's native WebContents binding, not a free
      // property read. With many tabs open, re-querying all four for
      // every tab on every single push — most of which only one tab
      // actually changed anything in — is real, avoidable work. Each of
      // these only changes in response to an event this file already
      // handles (navigation, media start/stop, mute toggle), so those
      // handlers set tab.statsDirty and this only recomputes then;
      // otherwise it reuses the last computed values.
      if (wc && tab.statsDirty !== false) {
        tab._statsCache = {
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          audible: safeCall(() => wc.isCurrentlyAudible(), false),
          muted: safeCall(() => wc.isAudioMuted(), false)
        };
        tab.statsDirty = false;
      }
      const stats = tab._statsCache || { canGoBack: false, canGoForward: false, audible: false, muted: false };

      return {
        id,
        title: tab.title || tab.url || 'New Tab',
        url: tab.url,
        loading: tab.loading,
        pinned: !!tab.pinned,
        discarded: !tab.view,
        canGoBack: wc ? stats.canGoBack : false,
        canGoForward: wc ? stats.canGoForward : false,
        bookmarked: bookmarkUrls.has(tab.url),
        audible: wc ? stats.audible : false,
        muted: wc ? stats.muted : false,
        favicon: tab.favicon || null
      };
    })
  };
}

function safeCall(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

// Each window's overlay is pushed to independently: a spinner stopping in
// window A has no reason to re-serialize window B.
function pushState(st) {
  if (!overlayAlive(st)) return;
  if (st.pushTimer) return; // an update is already scheduled — this burst will be covered by it
  st.pushTimer = setTimeout(() => {
    st.pushTimer = null;
    if (!overlayAlive(st)) return;
    st.overlay.webContents.send('tabs:update', serializeState(st));
  }, 16);
}

function pushStateAll() {
  windows.forEach((st) => pushState(st));
}

function pushWinState(st) {
  if (!overlayAlive(st) || !winAlive(st)) return;
  // The payload carries the window's real content height: the overlay's
  // own viewport is only the toolbar strip, so floating menus can't
  // measure the space below them from inside — they cap themselves
  // against this height instead (index.html capMenuHeight).
  st.overlay.webContents.send('win:state', { maximized: st.win.isMaximized(), height: st.win.getContentSize()[1] });
}

// ---------------- url helpers ----------------

function normalizeUrl(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return settings.homepage;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(trimmed)) return 'http://' + trimmed;
  return 'https://' + trimmed;
}

function looksLikeUrl(str) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(str)) return true;
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(str)) return true;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(str) && !/\s/.test(str)) return true;
  return false;
}

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q='
};

function resolveInput(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return settings.homepage;
  if (looksLikeUrl(trimmed)) return normalizeUrl(trimmed);
  const base = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google;
  return base + encodeURIComponent(trimmed);
}

// ---------------- context menu (page content) ----------------

function buildPageContextMenu(st, wc, params, id) {
  const template = [];
  const editable = params.isEditable;
  const selection = (params.selectionText || '').trim();
  const hasSelection = !!selection;
  const hasLink = !!params.linkURL;
  const isImage = params.mediaType === 'image';

  if (editable) {
    template.push(
      { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { label: 'Select all', role: 'selectAll' }
    );
  } else if (hasSelection) {
    const short = selection.length > 40 ? selection.slice(0, 40) + '\u2026' : selection;
    template.push(
      { label: 'Copy', role: 'copy' },
      { label: 'Search for \u201c' + short + '\u201d', click: () => createTab(st, resolveInput(selection)) }
    );
  }

  if (hasLink) {
    if (template.length) template.push({ type: 'separator' });
    template.push(
      { label: 'Open link in new tab', click: () => createTab(st, params.linkURL) },
      { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) }
    );
  }

  if (isImage) {
    if (template.length) template.push({ type: 'separator' });
    template.push(
      { label: 'Open image in new tab', click: () => createTab(st, params.srcURL) },
      { label: 'Save image as\u2026', click: () => wc.downloadURL(params.srcURL) },
      { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) }
    );
  }

  if (!editable && !hasSelection && !hasLink && !isImage) {
    // While an error page is up, Back is only enabled when there is a real
    // committed page behind the failure — goBackInTab decides where it goes.
    const tab = st.tabs.get(id);
    const backEnabled = tab && tab.pendingError ? !!tab.pendingError.backTo : wc.navigationHistory.canGoBack();
    template.push(
      { label: 'Back', enabled: backEnabled, click: () => goBackInTab(st, id) },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => reloadTab(st.tabs.get(id)) },
      { type: 'separator' },
      { label: 'Save page as\u2026', click: () => wc.downloadURL(wc.getURL()) },
      { label: 'Print\u2026', click: () => wc.print() }
    );
  }

  template.push(
    { type: 'separator' },
    {
      label: safeCall(() => wc.isAudioMuted(), false) ? 'Unmute tab' : 'Mute tab',
      click: () => {
        wc.setAudioMuted(!safeCall(() => wc.isAudioMuted(), false));
        const t = st.tabs.get(id);
        if (t) t.statsDirty = true;
        pushState(st);
      }
    },
    { label: 'View page source', click: () => viewPageSource(wc, st) },
    {
      label: 'Inspect',
      click: () => {
        wc.inspectElement(params.x, params.y);
        if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
      }
    }
  );

  return Menu.buildFromTemplate(template);
}

let lastViewSource = { url: '', html: '' };

// View-source opens as a tab in the SAME window the source came from — a
// private window's page source must not leak into a normal window.
async function viewPageSource(wc, st) {
  try {
    const html = await wc.executeJavaScript('document.documentElement.outerHTML');
    lastViewSource = { url: wc.getURL(), html: html && html.length <= VIEW_SOURCE_MAX_CHARS ? html : '' };
    createTab(st, 'daybreak://view-source');
  } catch (e) { /* page refused script execution (e.g. a PDF); nothing to show */ }
}

// ---------------- ad blocker ----------------

// A compact, curated list of common ad/tracker hostnames. Matched by exact
// host or subdomain suffix, not a substring — so 'ads.example.com' matches
// the 'example.com' rule only if 'example.com' is actually in this list
// (it isn't here), avoiding accidental over-blocking of unrelated sites.
const AD_BLOCK_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'adservice.google.com', 'adnxs.com', 'advertising.com', 'adsrvr.org',
  'taboola.com', 'outbrain.com', 'criteo.com', 'criteo.net', 'pubmatic.com',
  'rubiconproject.com', 'openx.net', 'moatads.com', 'scorecardresearch.com',
  'quantserve.com', 'amazon-adsystem.com', 'facebook.net', 'connect.facebook.net',
  'analytics.twitter.com', 'ads.linkedin.com', 'bat.bing.com', 'hotjar.com',
  'mixpanel.com', 'segment.com', 'segment.io', 'branch.io', 'appsflyer.com',
  'adform.net', 'adroll.com', 'yieldmo.com', 'sharethrough.com', 'media.net',
  'smartadserver.com', 'casalemedia.com', 'contextweb.com', 'bidswitch.net',
  // added after reviewing real ad-exchange/sync traffic from a live session
  'lijit.com', '360yield.com', 'fwmrm.net', 'e-planning.net', 'indexww.com',
  'eskimi.com', 'gumgum.com', 'everesttech.net', 'programmaticx.ai',
  'richaudience.com', 'cootlogix.com', '33across.com', 'connectad.io',
  'vidazoo.com', 'loopme.me', 'minutemedia-prebid.com', 'technoratimedia.com',
  'adkernel.com', 'sparteo.com', 'admatic.de', 'yellowblue.io', 'bricks-co.com',
  'pixad.com.tr', 'rbstsystems.live', 'omnitagjs.com', 'dv.tech',
  'servenobid.com', 'nextmillmedia.com', 'ingage.tech', 'ssp.disqus.com',
  'adsafeprotected.com', 'doubleverify.com', 'serving-sys.com',
  'flashtalking.com', '3lift.com', 'sonobi.com', 'spotxchange.com', 'springserve.com'
];

const AD_BLOCK_HOST_SET = new Set(AD_BLOCK_HOSTS);

// Set + suffix recursion instead of a some()/endsWith() sweep over the
// whole list per request: this runs on every network request of every tab,
// making it the app's hottest loop. O(labels in the hostname) hash lookups
// replaces O(hosts) string comparisons, with identical match semantics
// (exact host, or any subdomain of a listed host).
function hostMatchesBlockList(hostname) {
  if (!hostname) return false;
  if (AD_BLOCK_HOST_SET.has(hostname)) return true;
  const dot = hostname.indexOf('.');
  if (dot === -1) return false;
  return hostMatchesBlockList(hostname.slice(dot + 1));
}

function adBlockBeforeRequest(details, callback) {
  // Only http(s) requests can ever match the list — skip the URL parse
  // entirely for daybreak://, data:, blob:, devtools:, etc.
  if (!details.url.startsWith('http')) { callback({ cancel: false }); return; }
  let hostname = '';
  try { hostname = new URL(details.url).hostname; } catch (e) { /* ignore */ }
  callback({ cancel: hostMatchesBlockList(hostname) });
}

// Attached only while blocking is enabled. With no listener registered,
// Electron never marshals per-request details over to the main process at
// all — so "ad blocker off" costs nothing, instead of paying the IPC toll
// on every request of every tab just to answer { cancel: false }.
// onBeforeRequest(null) is the documented way to detach; re-attaching
// later works. Both sessions are wired: a private window must be blocked
// just as hard as a normal one. Detaching (blocker off) stays per-session.
function setAdBlockerActive(active) {
  session.defaultSession.webRequest.onBeforeRequest(active ? adBlockBeforeRequest : null);
  getPrivateSes().webRequest.onBeforeRequest(active ? adBlockBeforeRequest : null);
}

// A hostname blocklist only ever catches ads served from a separately
// blockable domain — it cannot do anything about ad containers rendered
// from the page's own first-party markup (a common pattern for native/
// in-feed ads). This is a conservative, well-known set of ad-specific
// selectors — narrow enough that it shouldn't hide unrelated content —
// injected as CSS rather than removed from the DOM, so it can't break a
// page's own script logic that expects the element to still exist.
const AD_COSMETIC_CSS = `
  .adsbygoogle, ins.adsbygoogle,
  div[id^="google_ads_iframe"], iframe[id^="google_ads_iframe"],
  div[id^="div-gpt-ad"], div[id*="dfp-ad"],
  [id^="taboola-"], [class*="taboola"],
  [id^="outbrain"], .OUTBRAIN,
  [class*="ad-slot"], [class*="ad-container"], [class*="ad-banner"],
  [class^="sponsored-content"], [data-ad-slot], [data-ad-unit]
  { display: none !important; }
`;

// ---------------- tabs ----------------

function createTabView(st) {
  return new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'tab-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Private-window tabs get the in-memory partition; normal tabs stay
      // on the default (persistent) session. undefined = default session.
      partition: st.priv ? PRIVATE_PARTITION : undefined
    }
  });
}

// Wires up everything a tab's WebContentsView needs. Used both when a tab
// is first created and when Memory Saver's discard/revive cycle gives a
// tab a brand new view later — the two need to end up identically wired,
// so this is the one place that logic lives.
function attachTabListeners(st, id, tab) {
  const wc = tab.view.webContents;

  // The tab spinner tracks MAIN-FRAME document loads only. Chromium fires
  // loading events for sub-frame load cycles too, so iframe-heavy pages
  // (exactly what you get with the ad blocker off) must not be able to
  // start it. did-start-navigation carries isInPlace/isMainFrame, so the
  // spinner only starts for real top-level loads; same-document
  // navigations (pushState, hash links) never spin.
  wc.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    // Loading the error page must not spin the tab — it's instant plumbing,
    // not content the user is waiting for.
    if (url && /^daybreak:\/\/error/i.test(url)) return;
    // Navigating to the URL the tab already shows is a reload. The common
    // non-user kind is page-driven ad auto-refresh (meta refresh or
    // location.reload from ad scripts), which pumped the spinner forever
    // on ad-heavy pages with the blocker off — the page visibly redraws
    // anyway, so same-URL reloads stay silent. The very first load of a
    // tab still spins (hasLoadedOnce guards that).
    if (url && tab.hasLoadedOnce && url === tab.url) return;
    if (tab.loadingTimer) clearTimeout(tab.loadingTimer);
    tab.loadingTimer = setTimeout(() => {
      tab.loadingTimer = null;
      tab.loading = true;
      // Hard cap (see SPINNER_MAX_MS): a hung sub-resource keeps the
      // session's loading state true indefinitely, so the spinner is
      // force-cleared instead of being left on.
      if (tab.loadingCapTimer) clearTimeout(tab.loadingCapTimer);
      tab.loadingCapTimer = setTimeout(() => {
        tab.loadingCapTimer = null;
        if (tab.loading) { tab.loading = false; pushState(st); }
      }, SPINNER_MAX_MS);
      pushState(st);
    }, 150);
  });
  wc.on('did-stop-loading', () => {
    // A sub-frame cycle ending fires this too; ignore it while any load
    // (including the main frame's) is still in flight. Whether Electron
    // delivers this once per cycle or once per webContents, this check
    // makes both behave identically: clear only when truly done.
    if (safeCall(() => wc.isLoading(), false)) return;
    tab.hasLoadedOnce = true;
    if (tab.loadingCapTimer) { clearTimeout(tab.loadingCapTimer); tab.loadingCapTimer = null; }
    if (tab.loadingTimer) {
      clearTimeout(tab.loadingTimer);
      tab.loadingTimer = null;
      // The load finished before the spinner was ever due to appear —
      // nothing was shown, so there's nothing to push to hide again.
      if (!tab.loading) return;
    }
    tab.loading = false;
    pushState(st);
  });

  wc.on('did-navigate', (_e, navUrl) => {
    // The error page lives at daybreak://error?…, but the ADDRESS BAR and
    // the tab strip must keep showing the URL that failed (Chrome does the
    // same). Navigation events that carry the error page's own URL are
    // translated back to the failed one, and pendingError is re-derived
    // from the query so the page also behaves correctly when the user
    // returns to it via Back/Forward after a successful retry. Any real
    // navigation to a non-error URL clears the pending error.
    if (/^daybreak:\/\/error/i.test(navUrl)) {
      const err = parseErrorUrl(navUrl);
      if (err) tab.pendingError = err;
      tab.url = (tab.pendingError && tab.pendingError.url) || tab.url;
      tab.statsDirty = true;
      pushState(st);
      return;
    }
    tab.pendingError = null;
    tab.url = navUrl;
    // A real committed navigation is a legitimate "Go back" target for any
    // LATER error page (the error-page branch above returns early, so error
    // pages themselves never become lastGoodUrl).
    tab.lastGoodUrl = navUrl;
    tab.favicon = null;
    tab.statsDirty = true; // canGoBack/canGoForward change on every navigation
    // Private-window tabs never touch history: no entry is recorded, and
    // lastHistoryId stays null so a later title update can't backfill one.
    if (!st.priv && /^https?:\/\//i.test(navUrl)) {
      const entry = { id: randomUUID(), url: navUrl, title: '', timestamp: Date.now() };
      history.push(entry);
      if (history.length > HISTORY_MAX) history = history.slice(history.length - HISTORY_MAX);
      tab.lastHistoryId = entry.id;
      saveHistory();
    } else {
      tab.lastHistoryId = null;
    }
    pushState(st);
  });

  wc.on('did-navigate-in-page', (_e, navUrl, isMainFrame) => {
    if (!isMainFrame) return; // ads/widgets/trackers embedded as iframes fire this too — ignore those
    tab.url = navUrl;
    // An in-page navigation (SPA route change) is as committed as a full
    // one — it's an equally valid Go-back target for a later crash page.
    tab.lastGoodUrl = navUrl;
    tab.statsDirty = true;
    pushState(st);
  });

  wc.on('page-title-updated', (_e, title) => {
    // While an error page is up, the tab keeps the title the error handler
    // chose (the failed host / crash label) — the error page's own <title>
    // must not overwrite it. Chrome behaves the same.
    if (tab.pendingError) return;
    tab.title = title;
    if (tab.lastHistoryId) {
      const entry = history.find((h) => h.id === tab.lastHistoryId);
      if (entry) { entry.title = title; saveHistory(); }
    }
    pushState(st);
  });

  // Drives the tab-strip mute/speaker indicator.
  wc.on('media-started-playing', () => { tab.statsDirty = true; pushState(st); });
  wc.on('media-paused', () => { tab.statsDirty = true; pushState(st); });
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = (favicons && favicons[0]) || null;
    pushState(st);
  });

  wc.on('before-input-event', (_e, input) => handleShortcut(st, input, id));
  wc.on('context-menu', (_e, params) => { buildPageContextMenu(st, wc, params, id).popup({ window: st.win }); });
  wc.on('found-in-page', (_e, result) => {
    if (overlayAlive(st)) st.overlay.webContents.send('find:result', { tabId: id, matches: result.matches, activeMatch: result.activeMatchOrdinal });
  });

  // This — not the request-blocklist above — is what actually stops popup
  // ads. window.open() is a completely separate code path from the
  // sub-resource requests webRequest sees: without a handler here,
  // Electron's default behavior lets a page spawn a real, uncontrolled
  // native window for any window.open() call, which the request blocker
  // can only ever partially clean out from the inside (hence ad images
  // disappearing while the popup itself still opened). A known ad host is
  // denied outright; anything else is opened as a normal Daybreak tab in
  // the SAME window the opener lives in, which also covers legitimate
  // cases like an OAuth login popup without leaving an ungoverned window
  // outside the tab system — and keeps a private window's popups private
  // (and a normal window's popups normal) with zero per-tab logic.
  wc.setWindowOpenHandler(({ url }) => {
    if (!settings.adBlockEnabled) { createTab(st, url); return { action: 'deny' }; }
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch (e) { /* ignore */ }
    if (hostMatchesBlockList(hostname)) return { action: 'deny' };
    createTab(st, url);
    return { action: 'deny' };
  });

  // Navigation failures. Two very different things arrive here:
  //   - sub-frame/sub-resource failures (exactly what the ad blocker
  //     produces constantly, plus every site's own failed requests).
  //     Listening at all is what silences Electron's noisy default
  //     "Failed to load URL ..." warning for them; they stay invisible to
  //     the user, like in any real browser.
  //   - main-frame failures (timeout, dead DNS, refused connection, bad
  //     certificate, blocked host, ...) — those now render a Chrome-style
  //     error page IN the tab instead of a silent blank page (previously
  //     the failure existed only in the terminal).
  wc.on('did-fail-load', (_e, errorCode, errorDesc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    // ERR_ABORTED (-3) is not a user-facing failure: it fires for every
    // intentional interruption — navigating away mid-load, a download
    // starting, loadURL replacing a slow load. Error-paging it would flash
    // garbage over perfectly healthy navigation.
    if (errorCode === -3) return;
    const target = failedUrl || tab.url || '';
    // Never error-page our own internal pages: if daybreak:// itself ever
    // failed, loading another daybreak:// page on top could loop forever.
    if (/^daybreak:/i.test(target)) return;
    // backTo = the last page that actually committed before this failure.
    // Chromium keeps the FAILED navigation in the back/forward list, so the
    // error page must never trust history.back() to reach it — see
    // goBackInTab below for the full story.
    showTabError(st, id, tab, { url: target, code: errorCode, type: 'net', backTo: tab.lastGoodUrl || null });
  });

  // A crashed renderer (Chrome's "Aw, Snap!") gets the same treatment: the
  // WebContents survives, so loading the error page into it relaunches the
  // renderer and gives the user a working Reload button.
  wc.on('render-process-gone', (_e, details) => {
    if (!details || details.reason === 'clean-exit') return;
    // A crash page's Go back is only meaningful if the user came from a
    // DIFFERENT page — going "back" to the page that just crashed would be
    // indistinguishable from Reload, so that case gets no button.
    const backTo = tab.lastGoodUrl && tab.lastGoodUrl !== tab.url ? tab.lastGoodUrl : null;
    showTabError(st, id, tab, { url: tab.url || '', code: null, type: 'crash', reason: (details && details.reason) || '', backTo });
  });

  wc.on('dom-ready', () => {
    if (settings.adBlockEnabled) wc.insertCSS(AD_COSMETIC_CSS).catch(() => {});
  });
}

// ---------------- error pages ----------------

// Renders a Chrome-style error page INTO the failed tab: keeps the failed
// URL as the tab's visible URL (address bar + tab strip, like Chrome — the
// page itself lives at daybreak://error?…), remembers enough state for
// Reload to retry the real URL, and pushes state so the overlay catches up.
function showTabError(st, id, tab, info) {
  if (!tab.view || tab.view.webContents.isDestroyed()) return;
  tab.pendingError = info;
  if (info.url) tab.url = info.url;
  if (info.type === 'crash') {
    tab.title = 'Aw, Snap!';
  } else {
    let host = info.url || '';
    try { host = new URL(info.url).hostname.replace(/^www\./, '') || info.url; } catch (e) { /* keep raw */ }
    tab.title = host || 'Error';
  }
  tab.favicon = null;
  tab.statsDirty = true;
  const q = new URLSearchParams();
  q.set('url', info.url || '');
  if (info.code != null && !isNaN(Number(info.code))) q.set('code', String(info.code));
  q.set('type', info.type || 'net');
  if (info.reason) q.set('reason', String(info.reason));
  // The Go-back target rides along in the query; the page renders its back
  // button from it (and Back-to-safety pages fall back to New Tab when it's
  // empty). Never offer going "back" to the URL that just failed.
  if (info.backTo && info.backTo !== info.url) q.set('back', info.backTo);
  // loadURL's promise rejects with ERR_ABORTED when the load is replaced
  // (e.g. the user navigating away immediately) — never let that surface.
  tab.view.webContents.loadURL('daybreak://error?' + q.toString()).catch(() => {});
  pushState(st);
}

// Back/Forward can land on the error page's own history entry after a
// successful retry — rebuild pendingError from the error URL's query so the
// page behaves exactly like a fresh error (Retry works, the address bar
// shows the failed URL).
function parseErrorUrl(errorUrl) {
  try {
    const u = new URL(errorUrl);
    if (u.hostname.toLowerCase() !== 'error') return null;
    const target = u.searchParams.get('url');
    if (!target) return null;
    const code = u.searchParams.get('code');
    return {
      url: target,
      code: code === null || code === '' || isNaN(Number(code)) ? null : Number(code),
      type: u.searchParams.get('type') || 'net',
      reason: u.searchParams.get('reason') || '',
      // Survives Back/Forward revisits too, so the toolbar's Back keeps
      // behaving like the error page's own Go back button.
      backTo: u.searchParams.get('back') || ''
    };
  } catch (e) {
    return null;
  }
}

// Back on a tab that is showing an error page must not use the native
// history traversal: Chromium keeps FAILED navigations in the back/forward
// list, and every failure also stacked another daybreak://error entry on
// top. A native goBack() therefore re-ran the dead navigation (which failed
// again and redrew the same error page) or landed on the identical error
// page behind it — the user experiences either as a dead Back button.
// While an error page is up, Back goes to the last URL that actually
// COMMITTED (pendingError.backTo); with nothing committed behind the
// failure, Back does nothing (and the UI that offers it shows disabled).
// Shared by the toolbar button, Alt+Left and the page context menu so all
// three entry points behave identically.
function goBackInTab(st, id) {
  const tab = st.tabs.get(id);
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;
  if (tab.pendingError) {
    if (tab.pendingError.backTo) tab.view.webContents.loadURL(tab.pendingError.backTo).catch(() => {});
    return;
  }
  const wc = tab.view.webContents;
  if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
}

// Reload on a tab that is showing an error page must retry the URL that
// failed — reloading daybreak://error would just redraw the same page.
// Used by Ctrl+R, the toolbar's nav:reload IPC and the page context menu
// alike, so all three entry points behave identically.
function reloadTab(tab) {
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;
  const wc = tab.view.webContents;
  if (tab.pendingError && tab.pendingError.url) {
    wc.loadURL(tab.pendingError.url).catch(() => {});
    return;
  }
  wc.reload();
}

function createTab(st, url, opts) {
  if (!winAlive(st)) return null;
  const id = randomUUID();
  const view = createTabView(st);

  const initialUrl = url || settings.homepage;
  const tab = {
    view,
    title: 'New Tab',
    url: initialUrl,
    loading: false,
    pinned: !!(opts && opts.pinned),
    lastHistoryId: null,
    // Last URL that actually COMMITTED in this tab (error pages and failed
    // navigations never set it). Error pages use it as their "Go back"
    // target — see goBackInTab / showTabError.
    lastGoodUrl: null,
    lastActiveAt: Date.now()
  };
  st.tabs.set(id, tab);

  // Insert at the bottom of the z-order: the overlay (added once, in
  // createBrowserWindow) must always stay visually on top so its menus can
  // paint over the tab area instead of being covered by it.
  st.win.contentView.addChildView(view, 0);

  attachTabListeners(st, id, tab);
  view.webContents.loadURL(normalizeUrl(initialUrl));

  if (opts && opts.background) {
    // Background open (middle-click / Ctrl+click on a bookmark chip): the
    // tab joins the strip, but the page the user was reading stays exactly
    // where it is. Its view must be parked at zero bounds explicitly —
    // layout() no-ops here because the layout key (which includes
    // activeId) hasn't changed, and an unset view could otherwise paint
    // over the active tab.
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    pushState(st);
  } else {
    setActiveTab(st, id);
  }
  return id;
}

// Memory Saver: frees a background tab's actual browsing process/view while
// keeping its title, URL, and position in the tab strip — Chrome calls this
// tab discarding. Never touches the active tab, a pinned tab, or one that's
// currently playing audio.
function discardTab(st, id) {
  const tab = st.tabs.get(id);
  if (!tab || !tab.view || tab.pinned || id === st.activeId) return;
  if (safeCall(() => tab.view.webContents.isCurrentlyAudible(), false)) return;

  if (tab.loadingTimer) { clearTimeout(tab.loadingTimer); tab.loadingTimer = null; }
  if (tab.loadingCapTimer) { clearTimeout(tab.loadingCapTimer); tab.loadingCapTimer = null; }
  if (winAlive(st)) st.win.contentView.removeChildView(tab.view);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  tab.view = null;
  tab.loading = false;
  pushState(st);
}

// Gives a discarded tab a fresh view and reloads it. Called automatically
// the moment the tab becomes active again — from the user's side this is
// meant to be invisible other than a brief reload.
function reviveTab(st, id) {
  const tab = st.tabs.get(id);
  if (!tab || tab.view || !winAlive(st)) return;
  // The view must be recreated in the tab's OWN window with the tab's own
  // session — a revived private tab rejoining the default session would
  // silently lose the in-memory login state and, worse, start persisting
  // cookies for a window meant to leave no trace.
  tab.view = createTabView(st);
  tab.statsDirty = true;
  st.win.contentView.addChildView(tab.view, 0);
  attachTabListeners(st, id, tab);
  tab.view.webContents.loadURL(normalizeUrl(tab.url));
}

function setActiveTab(st, id) {
  const tab = st.tabs.get(id);
  if (!tab) return;
  if (!tab.view) reviveTab(st, id);
  tab.lastActiveAt = Date.now();
  st.activeId = id;
  layout(st);
  pushState(st);
}

// Chrome calls this "Memory Saver": free the actual browsing process/view
// behind any tab that's been sitting in the background long enough,
// without closing the tab itself. Never touches the active tab (checked
// inside discardTab), a pinned tab, or one currently playing audio.
// Sweeps every live window — private tabs can be discarded/revived just
// as safely, since the in-memory partition outlives any single view.
function startMemorySaver() {
  setInterval(() => {
    if (!settings.memorySaverEnabled) return;
    const cutoff = Date.now() - MEMORY_SAVER_IDLE_MS;
    for (const st of windows) {
      for (const [id, tab] of st.tabs) {
        if (id === st.activeId || tab.pinned || !tab.view) continue;
        if ((tab.lastActiveAt || 0) > cutoff) continue;
        discardTab(st, id);
      }
    }
  }, MEMORY_SAVER_SWEEP_MS);
}

const closedTabs = []; // most recently closed last; capped so it can't grow forever

function reopenClosedTab(st) {
  // The reopen list only ever contains normal-window tabs (closeTab skips
  // private ones), so Ctrl+Shift+T inside a private window is a no-op —
  // it must not resurrect anything into a private window.
  if (st.priv) return;
  const last = closedTabs.pop();
  if (last) createTab(st, last.url, { pinned: last.pinned });
}

function closeTab(st, id) {
  const tab = st.tabs.get(id);
  if (!tab) return;

  // Private-window tabs never enter the reopen list — Ctrl+Shift+T must
  // not resurrect a private browsing session after it was closed.
  if (!st.priv && tab.url && tab.url !== 'daybreak://newtab') {
    closedTabs.push({ url: tab.url, pinned: !!tab.pinned });
    if (closedTabs.length > 25) closedTabs.shift();
  }
  if (tab.loadingTimer) clearTimeout(tab.loadingTimer);
  if (tab.loadingCapTimer) clearTimeout(tab.loadingCapTimer);
  if (tab.view) {
    if (winAlive(st)) st.win.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }
  st.tabs.delete(id);

  if (st.activeId === id) {
    const remaining = [...st.tabs.keys()];
    if (remaining.length > 0) setActiveTab(st, remaining[remaining.length - 1]);
    else if (winAlive(st)) createTab(st, settings.homepage);
  } else {
    layout(st);
    pushState(st);
  }
}

function closeOtherTabs(st, keepId) {
  [...st.tabs.keys()].forEach((id) => { if (id !== keepId) closeTab(st, id); });
}

function duplicateTab(st, id) {
  const tab = st.tabs.get(id);
  if (!tab) return;
  createTab(st, tab.url, { pinned: tab.pinned });
}

function togglePinTab(st, id) {
  const tab = st.tabs.get(id);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  pushState(st);
}

function reorderTabs(st, orderedIds) {
  // The UI always groups pinned tabs before unpinned ones, so enforce that
  // here regardless of what order the renderer's drag gesture produced —
  // this is the source of truth, not a mirror of it.
  const pinnedIds = orderedIds.filter((id) => st.tabs.has(id) && st.tabs.get(id).pinned);
  const unpinnedIds = orderedIds.filter((id) => st.tabs.has(id) && !st.tabs.get(id).pinned);
  const finalOrder = [...pinnedIds, ...unpinnedIds];
  const missing = [...st.tabs.keys()].filter((id) => !finalOrder.includes(id));

  const newMap = new Map();
  [...finalOrder, ...missing].forEach((id) => { if (st.tabs.has(id)) newMap.set(id, st.tabs.get(id)); });
  st.tabs.clear();
  newMap.forEach((v, k) => st.tabs.set(k, v));
}

// ---------------- keyboard shortcuts ----------------

function handleShortcut(st, input, sourceTabId) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;

  if (ctrl && input.shift && input.key.toLowerCase() === 't') { reopenClosedTab(st); }
  // Ctrl+Shift+N opens a whole private WINDOW from anywhere — normal or
  // private window alike (Chrome does the same). No per-tab inheritance:
  // which tabs are private is decided by which window they belong to.
  else if (ctrl && input.shift && input.key.toLowerCase() === 'n') { createBrowserWindow(true); }
  else if (ctrl && input.key.toLowerCase() === 't') { createTab(st, settings.homepage); }
  else if (ctrl && input.key.toLowerCase() === 'w') { closeTab(st, sourceTabId || st.activeId); }
  else if (ctrl && input.key.toLowerCase() === 'r') { reloadTab(st.tabs.get(st.activeId)); }
  else if (ctrl && input.key.toLowerCase() === 'l') { if (overlayAlive(st)) st.overlay.webContents.send('focus-urlbar'); }
  else if (ctrl && input.key.toLowerCase() === 'f') { if (overlayAlive(st)) st.overlay.webContents.send('find:open'); }
  else if (ctrl && input.key.toLowerCase() === 'u') { const t = st.tabs.get(st.activeId); if (t && t.view) viewPageSource(t.view.webContents, st); }
  else if (ctrl && input.key.toLowerCase() === 'd') { const t = st.tabs.get(st.activeId); if (t && overlayAlive(st)) st.overlay.webContents.send('bookmark:toggle-request'); }
  else if (ctrl && (input.key === '=' || input.key === '+')) { const t = st.tabs.get(st.activeId); if (t && t.view) t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() + 0.5); }
  else if (ctrl && input.key === '-') { const t = st.tabs.get(st.activeId); if (t && t.view) t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() - 0.5); }
  else if (ctrl && input.key === '0') { const t = st.tabs.get(st.activeId); if (t && t.view) t.view.webContents.setZoomLevel(0); }
  else if (ctrl && input.shift && input.key.toLowerCase() === 'd') { if (st.activeId) duplicateTab(st, st.activeId); }
  else if (ctrl && input.shift && input.key.toLowerCase() === 'm') {
    const t = st.tabs.get(st.activeId);
    if (t && t.view) { t.view.webContents.setAudioMuted(!safeCall(() => t.view.webContents.isAudioMuted(), false)); t.statsDirty = true; pushState(st); }
  }
  else if (input.alt && input.key === 'ArrowLeft') { goBackInTab(st, st.activeId); }
  else if (input.alt && input.key === 'ArrowRight') { const t = st.tabs.get(st.activeId); if (t && t.view && t.view.webContents.navigationHistory.canGoForward()) t.view.webContents.navigationHistory.goForward(); }
  else return;
}

// ---------------- window ----------------

// Creates one complete browser window: BaseWindow + overlay view + first
// tab, all wired to a single per-window state object. priv=true builds a
// private (incognito) window: every tab it will ever contain uses the
// in-memory session partition, it never records history or closed-tab
// entries, and its chrome is dark (index.html body.private).
function createBrowserWindow(priv) {
  const st = createBrowserState(priv);
  windows.push(st);

  st.win = new BaseWindow({
    width: 1200,
    height: 800,
    frame: false,
    transparent: false,
    resizable: true,
    // A private window starts dark, like Chrome's incognito — no white
    // flash before the dark toolbar paints.
    backgroundColor: priv ? '#202124' : '#ffffff',
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT
  });
  // The window title (taskbar / alt-tab) carries the privacy mode the way
  // Chrome's does; it's static per window now, not per active tab.
  st.win.setTitle(priv ? 'Daybreak (Private)' : 'Daybreak');
  st.win.on('closed', () => {
    const i = windows.indexOf(st);
    if (i !== -1) windows.splice(i, 1);
    st.tabs.clear();
    // If this was the last private window, its in-memory data dies now —
    // see maybeWipePrivateSession.
    maybeWipePrivateSession();
  });

  // First tab starts loading here, in parallel with the overlay's own load,
  // instead of waiting for the overlay's did-finish-load — the two loads
  // overlap, so the new tab page is typically already rendered by the time
  // the toolbar paints. createTab's layout()/pushState() calls no-op safely
  // while the overlay isn't alive yet.
  createTab(st, settings.homepage);

  st.overlay = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  st.win.contentView.addChildView(st.overlay);
  // Transparent by default: only the toolbar/bookmarks-bar/dropdown elements
  // draw their own opaque backgrounds (see index.html). Anything else in the
  // overlay's bounds — including the extra space reserved while a menu is
  // open — stays see-through so it doesn't blank out the tab view beneath it.
  st.overlay.setBackgroundColor('#00000000');
  st.overlay.webContents.loadFile(path.join(__dirname, 'index.html'));
  st.overlay.webContents.on('before-input-event', (_e, input) => handleShortcut(st, input, null));
  st.overlay.webContents.on('context-menu', (_e, params) => {
    // The tab-strip's own right-click menu is custom HTML and already calls
    // preventDefault() in the renderer, so this never fires for tabs — only
    // for genuinely editable/selectable overlay elements like the address bar.
    if (params.isEditable) {
      Menu.buildFromTemplate([
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Select all', role: 'selectAll' }
      ]).popup({ window: st.win });
    } else if ((params.selectionText || '').trim()) {
      Menu.buildFromTemplate([{ label: 'Copy', role: 'copy' }]).popup({ window: st.win });
    }
  });

  // On Windows in particular, minimizing can fire a 'resize' event reporting
  // a bogus near-zero content size; applying that to the tab/overlay bounds
  // leaves everything zero-sized, which is why restoring showed a blank,
  // unclickable window. Skip layout while actually minimized, and force a
  // fresh layout pass when the window comes back. pushWinState also rides
  // along on every real resize: floating menus re-cap themselves against
  // the reported height, so a menu opened in a flat window scrolls instead
  // of clipping.
  st.win.on('resize', () => {
    if (st.win.isMinimized() || st.dragging) return;
    layout(st);
    pushWinState(st);
  });
  st.win.on('restore', () => { layout(st); pushWinState(st); });
  st.win.on('maximize', () => pushWinState(st));
  st.win.on('unmaximize', () => pushWinState(st));

  st.overlay.webContents.once('did-finish-load', () => {
    // The first tab is usually already loading (started above, in parallel
    // with the overlay). This is a safety net, plus the deferred work —
    // bounds and initial state push — that createTab skipped while the
    // overlay wasn't alive yet.
    if (!st.activeId) createTab(st, settings.homepage);
    layout(st);
    pushWinState(st);
    pushState(st);
  });
}

// Downloads are tracked per session: entries from the private window stay
// in the in-memory list (the downloads page still shows them for this
// session) but are filtered out of everything written to disk.
function setupDownloadsFor(ses, priv) {
  ses.on('will-download', (_event, item) => {
    const id = randomUUID();
    const entry = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      total: item.getTotalBytes(),
      received: 0,
      state: 'progressing',
      savePath: null,
      timestamp: Date.now(),
      priv: !!priv
    };
    downloads.push(entry);
    if (downloads.length > DOWNLOADS_MAX) downloads = downloads.slice(downloads.length - DOWNLOADS_MAX);
    saveDownloads();

    item.on('updated', (_e2, state) => {
      entry.received = item.getReceivedBytes();
      entry.state = state;
      saveDownloads();
    });
    item.once('done', (_e2, state) => {
      entry.state = state;
      entry.savePath = item.getSavePath();
      entry.received = item.getReceivedBytes();
      saveDownloads();
    });
  });
}

// Internal page HTML is pure/static — the generated strings never depend on
// request data (only view-source does) — so each page is built once and
// reused. Tens of KB of strings total; repeat opens skip string-building
// entirely.
const internalPageCache = new Map();
function serveInternalPage(key, build) {
  let html = internalPageCache.get(key);
  if (html === undefined) {
    html = build();
    internalPageCache.set(key, html);
  }
  return new Response(html, { headers: { 'content-type': 'text/html' } });
}

// The internal-page handler is registered on BOTH sessions — tabs live in
// either the default (persistent) session or the private in-memory one, and
// daybreak:// pages must behave identically in both.
function handleDaybreakRequest(request) {
  const host = new URL(request.url).hostname.toLowerCase();
  switch (host) {
    case 'newtab':
    case 'home':
    case '':
      return serveInternalPage('newtab', pages.newTabPage);
    case 'bookmarks': return serveInternalPage('bookmarks', pages.bookmarksPage);
    case 'history': return serveInternalPage('history', pages.historyPage);
    case 'settings': return serveInternalPage('settings', pages.settingsPage);
    case 'downloads': return serveInternalPage('downloads', pages.downloadsPage);
    case 'about': return serveInternalPage('about', pages.aboutPage);
    case 'apps': return serveInternalPage('apps', pages.appsPage);
    case 'performance': return serveInternalPage('performance', pages.performancePage);
    // Error pages are built per request from their query (failed URL, error
    // code, crash reason, go-back target) — every failure carries different
    // data, so unlike the pages above these are never cached. `back` is the
    // tab's last committed URL (see showTabError); dropping it here would
    // silently strip the error page's Go back button.
    case 'error': {
      const errUrl = new URL(request.url);
      const rawCode = parseInt(errUrl.searchParams.get('code') || '', 10);
      return new Response(pages.errorPage({
        url: errUrl.searchParams.get('url') || '',
        code: isNaN(rawCode) ? null : rawCode,
        type: errUrl.searchParams.get('type') || 'net',
        reason: errUrl.searchParams.get('reason') || '',
        back: errUrl.searchParams.get('back') || ''
      }), { headers: { 'content-type': 'text/html' } });
    }
    // Dynamic: depends on which page view-source was invoked from.
    case 'view-source':
      return new Response(pages.viewSourcePage(lastViewSource.url, lastViewSource.html), { headers: { 'content-type': 'text/html' } });
    // Large static file, read from disk once on first use (see getTwoFaHtml).
    case '2fa':
      return new Response(getTwoFaHtml(), { headers: { 'content-type': 'text/html' } });
    default: return new Response('Not found', { status: 404 });
  }
}

app.whenReady().then(() => {
  protocol.handle('daybreak', handleDaybreakRequest);
  getPrivateSes().protocol.handle('daybreak', handleDaybreakRequest);

  setAdBlockerActive(settings.adBlockEnabled);
  setupDownloadsFor(session.defaultSession, false);
  setupDownloadsFor(getPrivateSes(), true);
  createBrowserWindow(false);
  startMemorySaver();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Flush any debounced history/downloads writes so a quit right after a
  // burst of navigation doesn't lose the last few entries.
  Object.keys(saveTimers).forEach((name) => {
    clearTimeout(saveTimers[name]);
    delete saveTimers[name];
  });
  saveJSON('history.json', history);
  saveJSON('downloads.json', downloads.filter((d) => !d.priv));
});

app.on('activate', () => {
  if (!windows.length) createBrowserWindow(false);
});

// ---------------- IPC: tabs & navigation ----------------

ipcMain.handle('tabs:create', (e, url, opts) => {
  const st = stateFromSender(e.sender);
  if (!st) return null;
  // Only window-agnostic options are honored here — a tab's privacy comes
  // solely from the window it's created in, never from an option or from
  // the "current tab" (that inheritance is exactly what made every tab
  // after one private tab private too).
  const norm = opts && typeof opts === 'object' ? { pinned: !!opts.pinned, background: !!opts.background } : undefined;
  return createTab(st, url || settings.homepage, norm);
});
ipcMain.handle('win:newPrivateWindow', () => { createBrowserWindow(true); });
ipcMain.handle('tabs:switch', (e, id) => { const st = stateFromTabId(id); if (st) setActiveTab(st, id); });
ipcMain.handle('tabs:close', (e, id) => { const st = stateFromTabId(id); if (st) closeTab(st, id); });
ipcMain.handle('tabs:closeOthers', (e, id) => { const st = stateFromTabId(id); if (st) closeOtherTabs(st, id); });
ipcMain.handle('tabs:duplicate', (e, id) => { const st = stateFromTabId(id); if (st) duplicateTab(st, id); });
ipcMain.handle('tabs:togglePin', (e, id) => { const st = stateFromTabId(id); if (st) togglePinTab(st, id); });
ipcMain.handle('tabs:toggleMute', (e, id) => {
  const hit = findTab(id);
  if (hit && hit.tab.view) {
    hit.tab.view.webContents.setAudioMuted(!safeCall(() => hit.tab.view.webContents.isAudioMuted(), false));
    hit.tab.statsDirty = true;
    pushState(hit.st);
  }
});
ipcMain.handle('tabs:reopenClosed', (e) => {
  const st = stateFromSender(e.sender);
  if (st) reopenClosedTab(st);
});
ipcMain.handle('tabs:viewSource', (e, id) => {
  const hit = findTab(id);
  if (hit && hit.tab.view) viewPageSource(hit.tab.view.webContents, hit.st);
});

// Real data from Electron's own process metrics, not a synthetic
// indicator — matched against actual tab titles/URLs where the PID
// corresponds to one of our own tab renderers, so this reads like
// something a person can actually act on (which tab is expensive right
// now) rather than an opaque PID list.
//
// Renderer processes will (and should) outnumber tabs: the toolbar is
// its own renderer, and every out-of-process frame a page embeds — with
// the ad blocker off that's each ad/tracker iframe, plus Chromium's
// built-in PDF viewer frame — runs in its own renderer process too.
// Those all used to show up as identical anonymous "Renderer" rows,
// which read like duplicated processes. Walking each tab's frame tree
// (WebFrameMain.osProcessId) names them after the tab and frame URL
// they actually belong to, so the list explains itself.
function mapTabProcesses(tab, pidToTab) {
  const wc = tab.view.webContents;
  const label = tab.title || tab.url;
  const mainPid = safeCall(() => wc.getOSProcessId(), null);
  if (mainPid) pidToTab.set(mainPid, { title: label, url: tab.url });
  try {
    if (!wc.mainFrame) return;
    for (const frame of wc.mainFrame.framesInSubtree) {
      let pid = 0, frameUrl = '';
      try { pid = frame.osProcessId; frameUrl = frame.url; } catch (e) { continue; } // frame torn down mid-walk
      // The main frame and any same-process iframe are already covered by
      // the tab's own PID; only frames in a genuinely separate renderer
      // process get their own labeled row.
      if (!pid || pidToTab.has(pid)) continue;
      pidToTab.set(pid, { title: 'frame of ' + label, url: frameUrl || '(frame)' });
    }
  } catch (e) { /* frame tree can be torn down mid-walk — harmless */ }
}

ipcMain.handle('perf:getMetrics', () => {
  const pidToTab = new Map();
  for (const st of windows) {
    for (const [, tab] of st.tabs) {
      if (!tab.view || tab.view.webContents.isDestroyed()) continue;
      mapTabProcesses(tab, pidToTab);
    }
    // Every window's overlay (toolbar / bookmarks bar / menus — index.html)
    // is a WebContentsView that lives outside the tab map, so without this
    // each was permanently one of the anonymous "Renderer" rows.
    if (overlayAlive(st)) {
      const pid = safeCall(() => st.overlay.webContents.getOSProcessId(), null);
      if (pid) {
        pidToTab.set(pid, {
          title: st.priv ? 'Daybreak toolbar (private window)' : 'Daybreak toolbar UI',
          url: safeCall(() => st.overlay.webContents.getURL(), '') || 'index.html'
        });
      }
    }
  }
  return app.getAppMetrics().map((m) => ({
    pid: m.pid,
    type: m.type,
    cpuPercent: m.cpu ? m.cpu.percentCPUUsage : 0,
    memoryMB: m.memory ? Math.round(m.memory.workingSetSize / 1024) : 0,
    tab: pidToTab.get(m.pid) || null
  }));
});

ipcMain.on('tabs:reorder', (e, orderedIds) => {
  if (!Array.isArray(orderedIds)) return;
  const st = stateFromSender(e.sender);
  if (!st) return;
  reorderTabs(st, orderedIds);
  pushState(st);
});

ipcMain.handle('nav:go', (_e, { id, url }) => {
  const hit = findTab(id);
  if (hit && hit.tab.view) hit.tab.view.webContents.loadURL(resolveInput(url));
});

ipcMain.handle('nav:back', (_e, id) => {
  const hit = findTab(id);
  if (hit) goBackInTab(hit.st, id);
});

ipcMain.handle('nav:forward', (_e, id) => {
  const hit = findTab(id);
  if (hit && hit.tab.view && hit.tab.view.webContents.navigationHistory.canGoForward()) hit.tab.view.webContents.navigationHistory.goForward();
});

ipcMain.handle('nav:reload', (_e, id) => {
  const hit = findTab(id);
  if (hit) reloadTab(hit.tab);
});

// ---------------- IPC: error page actions ----------------

// The error page doesn't know its own tab id — the sending webContents IS
// the identity (same lookup pattern as the click-away relay below, but
// restricted to tab views only: the overlay must never match).
function tabFromSender(sender) {
  for (const st of windows) {
    for (const [, tab] of st.tabs) {
      if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents === sender) return { st, tab };
    }
  }
  return null;
}

// "Reload" on an error page: retry the URL that failed. Guarded against
// retrying daybreak://error itself, which would just redraw the same page
// in a loop.
ipcMain.on('error:retry', (e, url) => {
  const hit = tabFromSender(e.sender);
  if (!hit) return;
  const target = (typeof url === 'string' && url) ? url : (hit.tab.pendingError && hit.tab.pendingError.url) || '';
  // Only daybreak://error itself is forbidden here (retrying it would loop
  // the error page into itself). A crashed INTERNAL page (daybreak://newtab
  // and friends) is a legitimate retry target — the old blanket daybreak:
  // check made Reload a silent no-op on those.
  if (!target || /^daybreak:\/\/error(\?|$)/i.test(target)) return;
  hit.tab.view.webContents.loadURL(target).catch(() => {});
});

// "Proceed anyway (unsafe)" on a certificate error page: bind the exception
// to the exact host+fingerprint pair that was actually denied, then load
// again — the certificate-error handler above will now accept it.
ipcMain.on('error:accept-cert', (e, url) => {
  const hit = tabFromSender(e.sender);
  if (!hit) return;
  let host = '';
  try { host = new URL(String(url || '')).hostname; } catch (err) { /* deny below */ }
  const fingerprint = host && lastDeniedCert.get(host);
  if (!host || !fingerprint) return; // no real denial ever recorded — refuse to invent one
  if (!allowedCerts.has(host)) allowedCerts.set(host, new Set());
  allowedCerts.get(host).add(fingerprint);
  hit.tab.view.webContents.loadURL(String(url)).catch(() => {});
});

// ---------------- IPC: window controls ----------------

// Window-control IPC is addressed to the sender's own window — with two
// windows open, each overlay's buttons must drive its own BaseWindow.
ipcMain.handle('win:minimize', (e) => { const st = stateFromSender(e.sender); if (st && winAlive(st)) st.win.minimize(); });
ipcMain.handle('win:maximize', (e) => {
  const st = stateFromSender(e.sender);
  if (!st || !winAlive(st)) return;
  if (st.win.isMaximized()) st.win.unmaximize(); else st.win.maximize();
});
ipcMain.handle('win:close', (e) => { const st = stateFromSender(e.sender); if (st && winAlive(st)) st.win.close(); });
ipcMain.handle('win:isMaximized', (e) => {
  const st = stateFromSender(e.sender);
  return st && winAlive(st) ? st.win.isMaximized() : false;
});

// Reserve extra overlay height for a floating menu/find-bar so it isn't
// clipped at the toolbar's normal bottom edge (see the overlayExtra note
// above layout()).
ipcMain.on('ui:setOverlayExtra', (e, extra) => {
  const st = stateFromSender(e.sender);
  if (!st) return;
  st.overlayExtra = Math.max(0, Number(extra) || 0);
  layout(st);
});

// The overlay only covers the toolbar strip, so a click on the PAGE below
// it never reaches the overlay document — which is how an open dropdown
// used to stay open (and keep reserving a dead strip of overlay over the
// page) after the user had clearly clicked somewhere else. Every tab
// relays a bare mousedown here (tab-preload.js); the window's overlay is
// told to close its floating UI. The overlay itself decides whether that
// also shrinks its bounds — it must not while the find bar is open, since
// the find bar lives in that reserved space.
ipcMain.on('page:click', (e) => {
  const st = stateFromSender(e.sender);
  if (st && overlayAlive(st)) st.overlay.webContents.send('ui:click-away');
});

// Manual window dragging (BaseWindow + multiple WebContentsViews doesn't
// reliably honor -webkit-app-region: drag, so the tab row implements this
// itself using real screen coordinates from mouse events). This only needs
// mousedown/mousemove within the toolbar's own bounds, so — unlike resize —
// it doesn't need the overlay to cover the full window.
ipcMain.handle('win:getPosition', (e) => {
  const st = stateFromSender(e.sender);
  return st && winAlive(st) ? st.win.getPosition() : [0, 0];
});
ipcMain.on('win:setPosition', (e, { x, y }) => {
  const st = stateFromSender(e.sender);
  if (!st || !winAlive(st)) return;
  if (st.dragFixedSize) {
    // Explicitly re-assert the size we started the drag with on every
    // single move. Something during a drag — crossing monitors with
    // different DPI scaling, or Windows silently restoring a previous
    // pre-snap size — was letting the window grow, even though nothing in
    // this app ever asks for that. Pinning width/height on every update
    // corrects it within one frame instead of trying to prevent whatever
    // is causing it.
    st.win.setBounds({ x: Math.round(x), y: Math.round(y), width: st.dragFixedSize.width, height: st.dragFixedSize.height });
  } else {
    st.win.setPosition(Math.round(x), Math.round(y), false);
  }
});
ipcMain.on('win:dragStart', (e) => {
  const st = stateFromSender(e.sender);
  if (!st) return;
  st.dragging = true;
  if (winAlive(st)) {
    // Also turn off resizing for the duration — belt-and-suspenders against
    // Windows Snap Assist, which targets resizable windows moved near a
    // screen edge, on top of the explicit size-pinning below.
    st.win.setResizable(false);
    const b = st.win.getBounds();
    st.dragFixedSize = { width: b.width, height: b.height };
  }
});
ipcMain.on('win:dragEnd', (e) => {
  const st = stateFromSender(e.sender);
  if (!st) return;
  st.dragging = false;
  st.dragFixedSize = null;
  if (winAlive(st)) st.win.setResizable(true);
  layout(st); // catch up on anything a suppressed resize event would have applied
});

// Note on resizing: a custom in-page resize-handle scheme would need the
// overlay to cover the whole window with click-through for everywhere else,
// but WebContentsView has no setIgnoreMouseEvents/click-through mechanism
// to make that safe (that's what crashed here). So resizing relies on the
// native OS resize border instead — BaseWindow is still constructed with
// resizable: true, and Electron keeps a frameless window's edges
// grab-able for resize even with no visible frame.

// ---------------- IPC: find in page ----------------

ipcMain.handle('find:start', (_e, { id, text, forward }) => {
  const hit = findTab(id);
  if (hit && hit.tab.view && text) hit.tab.view.webContents.findInPage(text, { forward: forward !== false, findNext: false });
});
ipcMain.handle('find:next', (_e, { id, text, forward }) => {
  const hit = findTab(id);
  if (hit && hit.tab.view && text) hit.tab.view.webContents.findInPage(text, { forward: forward !== false, findNext: true });
});
ipcMain.handle('find:stop', (_e, id) => {
  const hit = findTab(id);
  if (hit && hit.tab.view) hit.tab.view.webContents.stopFindInPage('clearSelection');
});

// ---------------- IPC: zoom ----------------

ipcMain.handle('zoom:in', (_e, id) => {
  const hit = findTab(id);
  if (hit && hit.tab.view) hit.tab.view.webContents.setZoomLevel(hit.tab.view.webContents.getZoomLevel() + 0.5);
});
ipcMain.handle('zoom:out', (_e, id) => {
  const hit = findTab(id);
  if (hit && hit.tab.view) hit.tab.view.webContents.setZoomLevel(hit.tab.view.webContents.getZoomLevel() - 0.5);
});
ipcMain.handle('zoom:reset', (_e, id) => {
  const hit = findTab(id);
  if (hit && hit.tab.view) hit.tab.view.webContents.setZoomLevel(0);
});

// ---------------- IPC: bookmarks ----------------

ipcMain.handle('bookmarks:list', () => bookmarks);
ipcMain.handle('bookmarks:add', (_e, { url, title, favicon }) => {
  if (!bookmarks.some((b) => b.url === url)) {
    bookmarks.push({ id: randomUUID(), url, title: title || url, favicon: favicon || null, timestamp: Date.now() });
    saveBookmarks();
    // Bookmarks are global data; every open window's bar and star states
    // resync, not just the one the change came from.
    pushStateAll();
  }
  return bookmarks;
});
ipcMain.handle('bookmarks:remove', (_e, id) => {
  bookmarks = bookmarks.filter((b) => b.id !== id);
  saveBookmarks();
  pushStateAll();
  return bookmarks;
});
ipcMain.handle('bookmarks:removeByUrl', (_e, url) => {
  bookmarks = bookmarks.filter((b) => b.url !== url);
  saveBookmarks();
  pushStateAll();
  return bookmarks;
});

// Rename / re-URL an existing bookmark (bookmark chip right-click → Edit).
ipcMain.handle('bookmarks:update', (_e, { id, patch }) => {
  const b = bookmarks.find((x) => x.id === id);
  if (!b || !patch || typeof patch !== 'object') return bookmarks;
  if (typeof patch.url === 'string' && patch.url.trim()) {
    // Same resolution rules as the address bar (resolveInput), so typing
    // "example.com" in the editor produces a real URL instead of a dead
    // bookmark, and pasted text is treated like a search only if it
    // genuinely doesn't look like a URL.
    b.url = resolveInput(patch.url);
  }
  if (typeof patch.title === 'string') {
    const t = patch.title.trim();
    b.title = t || b.url; // an emptied name falls back to the URL, like Chrome
  }
  saveBookmarks();
  // Bookmarks are global data; every open window's bar and star states resync.
  pushStateAll();
  return bookmarks;
});

// Drag-to-reorder on the bookmarks bar sends the full new id order. The
// renderer's DOM order describes the gesture, but this array stays the
// source of truth: unknown ids are dropped, and bookmarks the renderer
// didn't mention keep their relative order at the end.
ipcMain.on('bookmarks:reorder', (_e, orderedIds) => {
  if (!Array.isArray(orderedIds)) return;
  const byId = new Map(bookmarks.map((b) => [b.id, b]));
  const next = [];
  for (const id of orderedIds) {
    const b = byId.get(id);
    if (b) { next.push(b); byId.delete(id); }
  }
  for (const b of byId.values()) next.push(b);
  bookmarks = next;
  saveBookmarks();
  pushStateAll();
});

// ---------------- IPC: history ----------------

ipcMain.handle('history:list', () => history);
ipcMain.handle('history:remove', (_e, id) => {
  history = history.filter((h) => h.id !== id);
  saveHistory();
  return history;
});
ipcMain.handle('history:clear', () => {
  history = [];
  saveHistory();
  return history;
});

// ---------------- IPC: downloads ----------------

ipcMain.handle('downloads:list', () => downloads);
ipcMain.handle('downloads:open', (_e, id) => {
  const d = downloads.find((x) => x.id === id);
  if (d && d.savePath) shell.openPath(d.savePath);
});
ipcMain.handle('downloads:showInFolder', (_e, id) => {
  const d = downloads.find((x) => x.id === id);
  if (d && d.savePath) shell.showItemInFolder(d.savePath);
});
ipcMain.handle('downloads:clear', () => {
  downloads = [];
  saveDownloads();
  return downloads;
});

// ---------------- IPC: settings ----------------

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, partial) => {
  // adBlockEnabled lives in here too — when it flips, attach/detach the
  // webRequest listener to match (see setAdBlockerActive).
  const adBlockWas = settings.adBlockEnabled;
  settings = Object.assign({}, settings, partial);
  saveSettings();
  if (settings.adBlockEnabled !== adBlockWas) setAdBlockerActive(settings.adBlockEnabled);
  // showBookmarksBar changes every window's toolbar height, and every
  // window renders settings/bookmarks from its state push — so all
  // windows relayout and resync, not just the sender's.
  windows.forEach((st) => { layout(st); pushState(st); });
  return settings;
});
