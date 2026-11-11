const { contextBridge, ipcRenderer } = require('electron');

// A bare mousedown relay for the page itself. The toolbar overlay only
// covers the strip at the top of the window, so clicks on the page never
// reach the overlay document — without this relay, an open dropdown menu
// stayed open (and kept its reserved, unclickable strip over the page)
// after the user had clearly clicked somewhere else. Runs in every page
// (web sites and internal pages alike); it exposes nothing, it only sends.
window.addEventListener('mousedown', () => {
  try { ipcRenderer.send('page:click'); } catch (e) { /* must never break a page */ }
}, true);

// This preload is attached to every tab's WebContentsView, including tabs
// showing arbitrary websites — so the bridge is only exposed when the
// document being loaded is one of our own internal "daybreak://" pages.
// Regular http/https pages never see window.internalAPI.
if (window.location.protocol === 'daybreak:') {
  contextBridge.exposeInMainWorld('internalAPI', {
    getBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
    addBookmark: (url, title) => ipcRenderer.invoke('bookmarks:add', { url, title }),
    updateBookmark: (id, patch) => ipcRenderer.invoke('bookmarks:update', { id, patch }),
    removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', id),

    getHistory: () => ipcRenderer.invoke('history:list'),
    removeHistory: (id) => ipcRenderer.invoke('history:remove', id),
    clearHistory: () => ipcRenderer.invoke('history:clear'),

    // Export/import for bookmarks and history (.json). The file path is
    // NEVER passed here from the page — the main process owns the native
    // save/open dialogs; the page only picks the data kind.
    exportData: (kind) => ipcRenderer.invoke('data:export', kind),
    importData: (kind) => ipcRenderer.invoke('data:import', kind),

    // New Tab "Frequently visited" tile preferences (see the tiles IPC
    // section in main.js): hide/restore tiles on the grid, persist a drag
    // order, and open a URL as a tab of the sender's own window — the
    // tiles' middle-click / Ctrl+click behavior, same as the bookmark chips.
    hideTile: (url) => ipcRenderer.invoke('tiles:hide', url),
    restoreTiles: () => ipcRenderer.invoke('tiles:restore'),
    setTileOrder: (urls) => ipcRenderer.invoke('tiles:order', urls),
    openInTab: (url, opts) => ipcRenderer.invoke('tabs:create', url, opts || {}),

    getSettings: () => ipcRenderer.invoke('settings:get'),
    setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),

    getDownloads: () => ipcRenderer.invoke('downloads:list'),
    openDownload: (id) => ipcRenderer.invoke('downloads:open', id),
    showDownloadInFolder: (id) => ipcRenderer.invoke('downloads:showInFolder', id),
    clearDownloads: () => ipcRenderer.invoke('downloads:clear'),

    getMetrics: () => ipcRenderer.invoke('perf:getMetrics'),

    // Error pages (daybreak://error): retry the failed URL, or — only after
    // the user explicitly clicked through the certificate warning — accept
    // the certificate for that host and load again. The main process
    // resolves the tab from the sender; the page itself never learns its
    // tab id, and both sends are validated there before anything happens.
    errorRetry: (url) => ipcRenderer.send('error:retry', url),
    errorAcceptCert: (url) => ipcRenderer.send('error:accept-cert', url)
  });
}
