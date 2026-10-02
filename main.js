const { app, BaseWindow, WebContentsView, ipcMain, protocol, session, shell, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const pages = require('./pages.js');

// A fully self-contained static page (its own theme system, its own
// localStorage-backed persistence) — unlike the other internal pages, it
// doesn't need generating per request, just loading once.
const TWOFA_HTML = fs.readFileSync(path.join(__dirname, '2FA.html'), 'utf8');

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

protocol.registerSchemesAsPrivileged([
  { scheme: 'daybreak', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let win = null;
let overlayView = null;
let windowDragging = false;
let dragFixedSize = null; // {width, height} captured at drag start, re-asserted on every move

function winAlive() {
  return !!(win && !win.isDestroyed());
}
function overlayAlive() {
  return !!(overlayView && !overlayView.webContents.isDestroyed());
}

/** @type {Map<string, { view: import('electron').WebContentsView, title: string, url: string, loading: boolean, pinned: boolean, lastHistoryId: string|null }>} */
const tabs = new Map();
let activeId = null;

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
    fs.writeFileSync(dataFile(name), JSON.stringify(data, null, 2));
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
let settings = Object.assign(
  { theme: 'light', homepage: 'daybreak://newtab', searchEngine: 'google', showBookmarksBar: true, adBlockEnabled: true, memorySaverEnabled: false },
  loadJSON('settings.json', {})
);

// Bookmarks/settings changes are rare and user-initiated, so those save
// immediately. History and downloads can update many times in a burst (a
// busy page firing several navigations within milliseconds, or a
// downloads's progress ticking) — those are debounced so we don't do a
// synchronous disk write on every single event.
function saveBookmarks() { saveJSON('bookmarks.json', bookmarks); }
function saveHistory() { saveJSONDebounced('history.json', () => history); }
function saveDownloads() { saveJSONDebounced('downloads.json', () => downloads); }
function saveSettings() { saveJSON('settings.json', settings); }

// ---------------- layout ----------------

// Extra height temporarily reserved so the overlay can paint a floating
// menu/find-bar without it being clipped at the toolbar's normal bottom
// edge. WebContentsView has no setIgnoreMouseEvents/click-through support,
// so the overlay can only ever safely cover the toolbar strip — not the
// full window — which means this is the mechanism for floating UI instead
// of making the overlay full-window.
let overlayExtra = 0;

function chromeHeight() {
  return TAB_ROW_HEIGHT + NAV_ROW_HEIGHT + (settings.showBookmarksBar ? BOOKMARKS_BAR_HEIGHT : 0);
}

function layout() {
  if (!winAlive() || !overlayAlive()) return;
  const [width, height] = win.getContentSize();
  const tabTop = chromeHeight();

  // The overlay covers the toolbar (+ any temporarily reserved extra for an
  // open menu/find-bar) and stays on top in z-order; the tab view always
  // starts at the fixed toolbar height regardless of overlayExtra, so
  // opening a menu never resizes or reflows the page underneath.
  overlayView.setBounds({ x: 0, y: 0, width, height: Math.min(height, tabTop + overlayExtra) });

  for (const [id, tab] of tabs) {
    if (!tab.view) continue; // discarded by Memory Saver — nothing to lay out until revived
    if (id === activeId) {
      tab.view.setBounds({ x: 0, y: tabTop, width, height: Math.max(0, height - tabTop) });
    } else {
      tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }
}

// ---------------- state push ----------------

function serializeState() {
  return {
    activeId,
    settings,
    bookmarks,
    tabs: [...tabs.entries()].map(([id, tab]) => {
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
        bookmarked: bookmarks.some((b) => b.url === tab.url),
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

let pushStateTimer = null;
function pushState() {
  if (!overlayAlive()) return;
  if (pushStateTimer) return; // an update is already scheduled — this burst will be covered by it
  pushStateTimer = setTimeout(() => {
    pushStateTimer = null;
    if (!overlayAlive()) return;
    overlayView.webContents.send('tabs:update', serializeState());
  }, 16);
}

function pushWinState() {
  if (!overlayAlive() || !winAlive()) return;
  overlayView.webContents.send('win:state', { maximized: win.isMaximized() });
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

function buildPageContextMenu(wc, params, id) {
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
      { label: 'Search for \u201c' + short + '\u201d', click: () => createTab(resolveInput(selection)) }
    );
  }

  if (hasLink) {
    if (template.length) template.push({ type: 'separator' });
    template.push(
      { label: 'Open link in new tab', click: () => createTab(params.linkURL) },
      { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) }
    );
  }

  if (isImage) {
    if (template.length) template.push({ type: 'separator' });
    template.push(
      { label: 'Open image in new tab', click: () => createTab(params.srcURL) },
      { label: 'Save image as\u2026', click: () => wc.downloadURL(params.srcURL) },
      { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) }
    );
  }

  if (!editable && !hasSelection && !hasLink && !isImage) {
    template.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
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
        const t = tabs.get(id);
        if (t) t.statsDirty = true;
        pushState();
      }
    },
    { label: 'View page source', click: () => viewPageSource(wc) },
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

async function viewPageSource(wc) {
  try {
    const html = await wc.executeJavaScript('document.documentElement.outerHTML');
    lastViewSource = { url: wc.getURL(), html };
    createTab('daybreak://view-source');
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

let adBlockHandlerAttached = false;

function hostMatchesBlockList(hostname) {
  if (!hostname) return false;
  return AD_BLOCK_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
}

function setupAdBlocker() {
  if (adBlockHandlerAttached) return;
  adBlockHandlerAttached = true;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (!settings.adBlockEnabled) { callback({ cancel: false }); return; }
    let hostname = '';
    try { hostname = new URL(details.url).hostname; } catch (e) { /* ignore */ }
    callback({ cancel: hostMatchesBlockList(hostname) });
  });
}

// ---------------- tabs ----------------

function createTabView() {
  return new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'tab-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
}

// Wires up everything a tab's WebContentsView needs. Used both when a tab
// is first created and when Memory Saver's discard/revive cycle gives a
// tab a brand new view later — the two need to end up identically wired,
// so this is the one place that logic lives.
function attachTabListeners(id, tab) {
  const wc = tab.view.webContents;

  wc.on('did-start-loading', () => {
    if (tab.loadingTimer) clearTimeout(tab.loadingTimer);
    tab.loadingTimer = setTimeout(() => {
      tab.loadingTimer = null;
      tab.loading = true;
      pushState();
    }, 150);
  });
  wc.on('did-stop-loading', () => {
    if (tab.loadingTimer) {
      clearTimeout(tab.loadingTimer);
      tab.loadingTimer = null;
      // The load finished before the spinner was ever due to appear —
      // nothing was shown, so there's nothing to push to hide again.
      if (!tab.loading) return;
    }
    tab.loading = false;
    pushState();
  });

  wc.on('did-navigate', (_e, navUrl) => {
    tab.url = navUrl;
    tab.favicon = null;
    tab.statsDirty = true; // canGoBack/canGoForward change on every navigation
    if (/^https?:\/\//i.test(navUrl)) {
      const entry = { id: randomUUID(), url: navUrl, title: '', timestamp: Date.now() };
      history.push(entry);
      if (history.length > HISTORY_MAX) history = history.slice(history.length - HISTORY_MAX);
      tab.lastHistoryId = entry.id;
      saveHistory();
    } else {
      tab.lastHistoryId = null;
    }
    pushState();
  });

  wc.on('did-navigate-in-page', (_e, navUrl, isMainFrame) => {
    if (!isMainFrame) return; // ads/widgets/trackers embedded as iframes fire this too — ignore those
    tab.url = navUrl;
    tab.statsDirty = true;
    pushState();
  });

  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    if (tab.lastHistoryId) {
      const entry = history.find((h) => h.id === tab.lastHistoryId);
      if (entry) { entry.title = title; saveHistory(); }
    }
    pushState();
  });

  // Drives the tab-strip mute/speaker indicator.
  wc.on('media-started-playing', () => { tab.statsDirty = true; pushState(); });
  wc.on('media-paused', () => { tab.statsDirty = true; pushState(); });
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = (favicons && favicons[0]) || null;
    pushState();
  });

  wc.on('before-input-event', (_e, input) => handleShortcut(input, id));
  wc.on('context-menu', (_e, params) => { buildPageContextMenu(wc, params, id).popup({ window: win }); });
  wc.on('found-in-page', (_e, result) => {
    if (overlayAlive()) overlayView.webContents.send('find:result', { tabId: id, matches: result.matches, activeMatch: result.activeMatchOrdinal });
  });

  // This — not the request-blocklist above — is what actually stops popup
  // ads. window.open() is a completely separate code path from the
  // sub-resource requests webRequest sees: without a handler here,
  // Electron's default behavior lets a page spawn a real, uncontrolled
  // native window for any window.open() call, which the request blocker
  // can only ever partially clean out from the inside (hence ad images
  // disappearing while the popup itself still opened). A known ad host is
  // denied outright; anything else is opened as a normal Daybreak tab
  // instead of a separate native window, which also covers legitimate
  // cases like an OAuth login popup without leaving an ungoverned window
  // outside the tab system.
  wc.setWindowOpenHandler(({ url }) => {
    if (!settings.adBlockEnabled) { createTab(url); return { action: 'deny' }; }
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch (e) { /* ignore */ }
    if (hostMatchesBlockList(hostname)) return { action: 'deny' };
    createTab(url);
    return { action: 'deny' };
  });

  // Blocked/cancelled sub-resource loads (exactly what the ad blocker
  // produces constantly) trigger Electron's own noisy default warning
  // ("electron: Failed to load URL ... with error: ...") on every single
  // one unless something is listening for this event. The failures
  // themselves are expected and harmless; only the console spam is not.
  wc.on('did-fail-load', () => {});

  wc.on('dom-ready', () => {
    if (settings.adBlockEnabled) wc.insertCSS(AD_COSMETIC_CSS).catch(() => {});
  });
}

function createTab(url, opts) {
  if (!winAlive()) return null;
  const id = randomUUID();
  const view = createTabView();

  const initialUrl = url || settings.homepage;
  const tab = {
    view,
    title: 'New Tab',
    url: initialUrl,
    loading: false,
    pinned: !!(opts && opts.pinned),
    lastHistoryId: null,
    lastActiveAt: Date.now()
  };
  tabs.set(id, tab);

  // Insert at the bottom of the z-order: the overlay (added once, in
  // createWindow) must always stay visually on top so its menus can paint
  // over the tab area instead of being covered by it.
  win.contentView.addChildView(view, 0);

  attachTabListeners(id, tab);
  view.webContents.loadURL(normalizeUrl(initialUrl));

  setActiveTab(id);
  return id;
}

// Memory Saver: frees a background tab's actual browsing process/view while
// keeping its title, URL, and position in the tab strip — Chrome calls this
// tab discarding. Never touches the active tab, a pinned tab, or one that's
// currently playing audio.
function discardTab(id) {
  const tab = tabs.get(id);
  if (!tab || !tab.view || tab.pinned || id === activeId) return;
  if (safeCall(() => tab.view.webContents.isCurrentlyAudible(), false)) return;

  if (tab.loadingTimer) { clearTimeout(tab.loadingTimer); tab.loadingTimer = null; }
  if (winAlive()) win.contentView.removeChildView(tab.view);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  tab.view = null;
  tab.loading = false;
  pushState();
}

// Gives a discarded tab a fresh view and reloads it. Called automatically
// the moment the tab becomes active again — from the user's side this is
// meant to be invisible other than a brief reload.
function reviveTab(id) {
  const tab = tabs.get(id);
  if (!tab || tab.view || !winAlive()) return;
  tab.view = createTabView();
  tab.statsDirty = true;
  win.contentView.addChildView(tab.view, 0);
  attachTabListeners(id, tab);
  tab.view.webContents.loadURL(normalizeUrl(tab.url));
}

function setActiveTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (!tab.view) reviveTab(id);
  tab.lastActiveAt = Date.now();
  activeId = id;
  layout();
  pushState();
}

// Chrome calls this "Memory Saver": free the actual browsing process/view
// behind any tab that's been sitting in the background long enough,
// without closing the tab itself. Never touches the active tab (checked
// inside discardTab), a pinned tab, or one currently playing audio.
function startMemorySaver() {
  setInterval(() => {
    if (!settings.memorySaverEnabled) return;
    const cutoff = Date.now() - MEMORY_SAVER_IDLE_MS;
    for (const [id, tab] of tabs) {
      if (id === activeId || tab.pinned || !tab.view) continue;
      if ((tab.lastActiveAt || 0) > cutoff) continue;
      discardTab(id);
    }
  }, MEMORY_SAVER_SWEEP_MS);
}

const closedTabs = []; // most recently closed last; capped so it can't grow forever

function reopenClosedTab() {
  const last = closedTabs.pop();
  if (last) createTab(last.url, { pinned: last.pinned });
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  if (tab.url && tab.url !== 'daybreak://newtab') {
    closedTabs.push({ url: tab.url, pinned: !!tab.pinned });
    if (closedTabs.length > 25) closedTabs.shift();
  }
  if (tab.loadingTimer) clearTimeout(tab.loadingTimer);
  if (tab.view) {
    if (winAlive()) win.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }
  tabs.delete(id);

  if (activeId === id) {
    const remaining = [...tabs.keys()];
    if (remaining.length > 0) setActiveTab(remaining[remaining.length - 1]);
    else if (winAlive()) createTab(settings.homepage);
  } else {
    layout();
    pushState();
  }
}

function closeOtherTabs(keepId) {
  [...tabs.keys()].forEach((id) => { if (id !== keepId) closeTab(id); });
}

function duplicateTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  createTab(tab.url, { pinned: tab.pinned });
}

function togglePinTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  pushState();
}

function reorderTabs(orderedIds) {
  // The UI always groups pinned tabs before unpinned ones, so enforce that
  // here regardless of what order the renderer's drag gesture produced —
  // this is the source of truth, not a mirror of it.
  const pinnedIds = orderedIds.filter((id) => tabs.has(id) && tabs.get(id).pinned);
  const unpinnedIds = orderedIds.filter((id) => tabs.has(id) && !tabs.get(id).pinned);
  const finalOrder = [...pinnedIds, ...unpinnedIds];
  const missing = [...tabs.keys()].filter((id) => !finalOrder.includes(id));

  const newMap = new Map();
  [...finalOrder, ...missing].forEach((id) => { if (tabs.has(id)) newMap.set(id, tabs.get(id)); });
  tabs.clear();
  newMap.forEach((v, k) => tabs.set(k, v));
}

// ---------------- keyboard shortcuts ----------------

function handleShortcut(input, sourceTabId) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;

  if (ctrl && input.shift && input.key.toLowerCase() === 't') { reopenClosedTab(); }
  else if (ctrl && input.key.toLowerCase() === 't') { createTab(settings.homepage); }
  else if (ctrl && input.key.toLowerCase() === 'w') { closeTab(sourceTabId || activeId); }
  else if (ctrl && input.key.toLowerCase() === 'r') { const t = tabs.get(activeId); if (t && t.view) t.view.webContents.reload(); }
  else if (ctrl && input.key.toLowerCase() === 'l') { if (overlayAlive()) overlayView.webContents.send('focus-urlbar'); }
  else if (ctrl && input.key.toLowerCase() === 'f') { if (overlayAlive()) overlayView.webContents.send('find:open'); }
  else if (ctrl && input.key.toLowerCase() === 'u') { const t = tabs.get(activeId); if (t && t.view) viewPageSource(t.view.webContents); }
  else if (ctrl && input.key.toLowerCase() === 'd') { const t = tabs.get(activeId); if (t && overlayAlive()) overlayView.webContents.send('bookmark:toggle-request'); }
  else if (ctrl && (input.key === '=' || input.key === '+')) { const t = tabs.get(activeId); if (t && t.view) t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() + 0.5); }
  else if (ctrl && input.key === '-') { const t = tabs.get(activeId); if (t && t.view) t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() - 0.5); }
  else if (ctrl && input.key === '0') { const t = tabs.get(activeId); if (t && t.view) t.view.webContents.setZoomLevel(0); }
  else if (ctrl && input.shift && input.key.toLowerCase() === 'd') { if (activeId) duplicateTab(activeId); }
  else if (ctrl && input.shift && input.key.toLowerCase() === 'm') {
    const t = tabs.get(activeId);
    if (t && t.view) { t.view.webContents.setAudioMuted(!safeCall(() => t.view.webContents.isAudioMuted(), false)); t.statsDirty = true; pushState(); }
  }
  else if (input.alt && input.key === 'ArrowLeft') { const t = tabs.get(activeId); if (t && t.view && t.view.webContents.navigationHistory.canGoBack()) t.view.webContents.navigationHistory.goBack(); }
  else if (input.alt && input.key === 'ArrowRight') { const t = tabs.get(activeId); if (t && t.view && t.view.webContents.navigationHistory.canGoForward()) t.view.webContents.navigationHistory.goForward(); }
  else return;
}

// ---------------- window ----------------

function createWindow() {
  win = new BaseWindow({
    width: 1200,
    height: 800,
    frame: false,
    transparent: false,
    resizable: true,
    backgroundColor: '#ffffff',
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT
  });
  win.setTitle('Daybreak');
  win.on('closed', () => {
    win = null;
    overlayView = null;
    tabs.clear();
    activeId = null;
  });

  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.contentView.addChildView(overlayView);
  // Transparent by default: only the toolbar/bookmarks-bar/dropdown elements
  // draw their own opaque backgrounds (see index.html). Anything else in the
  // overlay's bounds — including the extra space reserved while a menu is
  // open — stays see-through so it doesn't blank out the tab view beneath it.
  overlayView.setBackgroundColor('#00000000');
  overlayView.webContents.loadFile(path.join(__dirname, 'index.html'));
  overlayView.webContents.on('before-input-event', (_e, input) => handleShortcut(input, null));
  overlayView.webContents.on('context-menu', (_e, params) => {
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
      ]).popup({ window: win });
    } else if ((params.selectionText || '').trim()) {
      Menu.buildFromTemplate([{ label: 'Copy', role: 'copy' }]).popup({ window: win });
    }
  });

  // On Windows in particular, minimizing can fire a 'resize' event reporting
  // a bogus near-zero content size; applying that to the tab/overlay bounds
  // leaves everything zero-sized, which is why restoring showed a blank,
  // unclickable window. Skip layout while actually minimized, and force a
  // fresh layout pass when the window comes back.
  win.on('resize', () => { if (!win.isMinimized() && !windowDragging) layout(); });
  win.on('restore', () => { layout(); });
  win.on('maximize', pushWinState);
  win.on('unmaximize', pushWinState);

  overlayView.webContents.once('did-finish-load', () => {
    createTab(settings.homepage);
    pushWinState();
  });
}

function setupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const id = randomUUID();
    const entry = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      total: item.getTotalBytes(),
      received: 0,
      state: 'progressing',
      savePath: null,
      timestamp: Date.now()
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

app.whenReady().then(() => {
  protocol.handle('daybreak', (request) => {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    let html;
    if (host === 'newtab' || host === 'home' || host === '') html = pages.newTabPage();
    else if (host === 'bookmarks') html = pages.bookmarksPage();
    else if (host === 'history') html = pages.historyPage();
    else if (host === 'settings') html = pages.settingsPage();
    else if (host === 'downloads') html = pages.downloadsPage();
    else if (host === 'about') html = pages.aboutPage();
    else if (host === 'view-source') html = pages.viewSourcePage(lastViewSource.url, lastViewSource.html);
    else if (host === 'apps') html = pages.appsPage();
    else if (host === 'performance') html = pages.performancePage();
    else if (host === '2fa') html = TWOFA_HTML;
    else return new Response('Not found', { status: 404 });

    return new Response(html, { headers: { 'content-type': 'text/html' } });
  });

  setupDownloads();
  setupAdBlocker();
  createWindow();
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
  saveJSON('downloads.json', downloads);
});

app.on('activate', () => {
  if (!win) createWindow();
});

// ---------------- IPC: tabs & navigation ----------------

ipcMain.handle('tabs:create', (_e, url) => createTab(url || settings.homepage));
ipcMain.handle('tabs:switch', (_e, id) => { setActiveTab(id); });
ipcMain.handle('tabs:close', (_e, id) => { closeTab(id); });
ipcMain.handle('tabs:closeOthers', (_e, id) => { closeOtherTabs(id); });
ipcMain.handle('tabs:duplicate', (_e, id) => { duplicateTab(id); });
ipcMain.handle('tabs:togglePin', (_e, id) => { togglePinTab(id); });
ipcMain.handle('tabs:toggleMute', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view) { tab.view.webContents.setAudioMuted(!safeCall(() => tab.view.webContents.isAudioMuted(), false)); tab.statsDirty = true; pushState(); }
});
ipcMain.handle('tabs:reopenClosed', () => { reopenClosedTab(); });
ipcMain.handle('tabs:viewSource', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view) viewPageSource(tab.view.webContents);
});

// Real data from Electron's own process metrics, not a synthetic
// indicator — matched against actual tab titles/URLs where the PID
// corresponds to one of our own tab renderers, so this reads like
// something a person can actually act on (which tab is expensive right
// now) rather than an opaque PID list.
ipcMain.handle('perf:getMetrics', () => {
  const pidToTab = new Map();
  for (const [, tab] of tabs) {
    if (!tab.view || tab.view.webContents.isDestroyed()) continue;
    const pid = safeCall(() => tab.view.webContents.getOSProcessId(), null);
    if (pid) pidToTab.set(pid, { title: tab.title || tab.url, url: tab.url });
  }
  return app.getAppMetrics().map((m) => ({
    pid: m.pid,
    type: m.type,
    cpuPercent: m.cpu ? m.cpu.percentCPUUsage : 0,
    memoryMB: m.memory ? Math.round(m.memory.workingSetSize / 1024) : 0,
    tab: pidToTab.get(m.pid) || null
  }));
});

ipcMain.on('tabs:reorder', (_e, orderedIds) => {
  if (!Array.isArray(orderedIds)) return;
  reorderTabs(orderedIds);
  pushState();
});

ipcMain.handle('nav:go', (_e, { id, url }) => {
  const tab = tabs.get(id);
  if (tab && tab.view) tab.view.webContents.loadURL(resolveInput(url));
});

ipcMain.handle('nav:back', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
});

ipcMain.handle('nav:forward', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
});

ipcMain.handle('nav:reload', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view) tab.view.webContents.reload();
});

// ---------------- IPC: window controls ----------------

ipcMain.handle('win:minimize', () => { if (winAlive()) win.minimize(); });
ipcMain.handle('win:maximize', () => {
  if (!winAlive()) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.handle('win:close', () => { if (winAlive()) win.close(); });
ipcMain.handle('win:isMaximized', () => (winAlive() ? win.isMaximized() : false));

// Reserve extra overlay height for a floating menu/find-bar so it isn't
// clipped at the toolbar's normal bottom edge (see the overlayExtra note
// above layout()).
ipcMain.on('ui:setOverlayExtra', (_e, extra) => {
  overlayExtra = Math.max(0, Number(extra) || 0);
  layout();
});

// Manual window dragging (BaseWindow + multiple WebContentsViews doesn't
// reliably honor -webkit-app-region: drag, so the tab row implements this
// itself using real screen coordinates from mouse events). This only needs
// mousedown/mousemove within the toolbar's own bounds, so — unlike resize —
// it doesn't need the overlay to cover the full window.
ipcMain.handle('win:getPosition', () => (winAlive() ? win.getPosition() : [0, 0]));
ipcMain.on('win:setPosition', (_e, { x, y }) => {
  if (!winAlive()) return;
  if (dragFixedSize) {
    // Explicitly re-assert the size we started the drag with on every
    // single move. Something during a drag — crossing monitors with
    // different DPI scaling, or Windows silently restoring a previous
    // pre-snap size — was letting the window grow, even though nothing in
    // this app ever asks for that. Pinning width/height on every update
    // corrects it within one frame instead of trying to prevent whatever
    // is causing it.
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: dragFixedSize.width, height: dragFixedSize.height });
  } else {
    win.setPosition(Math.round(x), Math.round(y), false);
  }
});
ipcMain.on('win:dragStart', () => {
  windowDragging = true;
  if (winAlive()) {
    // Also turn off resizing for the duration — belt-and-suspenders against
    // Windows Snap Assist, which targets resizable windows moved near a
    // screen edge, on top of the explicit size-pinning above.
    win.setResizable(false);
    const b = win.getBounds();
    dragFixedSize = { width: b.width, height: b.height };
  }
});
ipcMain.on('win:dragEnd', () => {
  windowDragging = false;
  dragFixedSize = null;
  if (winAlive()) win.setResizable(true);
  layout(); // catch up on anything a suppressed resize event would have applied
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
  const tab = tabs.get(id);
  if (tab && tab.view && text) tab.view.webContents.findInPage(text, { forward: forward !== false, findNext: false });
});
ipcMain.handle('find:next', (_e, { id, text, forward }) => {
  const tab = tabs.get(id);
  if (tab && tab.view && text) tab.view.webContents.findInPage(text, { forward: forward !== false, findNext: true });
});
ipcMain.handle('find:stop', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view) tab.view.webContents.stopFindInPage('clearSelection');
});

// ---------------- IPC: zoom ----------------

ipcMain.handle('zoom:in', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view) tab.view.webContents.setZoomLevel(tab.view.webContents.getZoomLevel() + 0.5);
});
ipcMain.handle('zoom:out', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view) tab.view.webContents.setZoomLevel(tab.view.webContents.getZoomLevel() - 0.5);
});
ipcMain.handle('zoom:reset', (_e, id) => {
  const tab = tabs.get(id);
  if (tab && tab.view) tab.view.webContents.setZoomLevel(0);
});

// ---------------- IPC: bookmarks ----------------

ipcMain.handle('bookmarks:list', () => bookmarks);
ipcMain.handle('bookmarks:add', (_e, { url, title, favicon }) => {
  if (!bookmarks.some((b) => b.url === url)) {
    bookmarks.push({ id: randomUUID(), url, title: title || url, favicon: favicon || null, timestamp: Date.now() });
    saveBookmarks();
    pushState();
  }
  return bookmarks;
});
ipcMain.handle('bookmarks:remove', (_e, id) => {
  bookmarks = bookmarks.filter((b) => b.id !== id);
  saveBookmarks();
  pushState();
  return bookmarks;
});
ipcMain.handle('bookmarks:removeByUrl', (_e, url) => {
  bookmarks = bookmarks.filter((b) => b.url !== url);
  saveBookmarks();
  pushState();
  return bookmarks;
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
  settings = Object.assign({}, settings, partial);
  saveSettings();
  layout();
  pushState();
  return settings;
});
