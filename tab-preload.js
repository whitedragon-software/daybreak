const { contextBridge, ipcRenderer } = require('electron');

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

    getMetrics: () => ipcRenderer.invoke('perf:getMetrics')
  });
}
