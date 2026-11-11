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
    removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', id),

    getHistory: () => ipcRenderer.invoke('history:list'),
    removeHistory: (id) => ipcRenderer.invoke('history:remove', id),
    clearHistory: () => ipcRenderer.invoke('history:clear'),

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
