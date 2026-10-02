const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // tabs
  createTab: (url) => ipcRenderer.invoke('tabs:create', url),
  switchTab: (id) => ipcRenderer.invoke('tabs:switch', id),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  closeOtherTabs: (id) => ipcRenderer.invoke('tabs:closeOthers', id),
  duplicateTab: (id) => ipcRenderer.invoke('tabs:duplicate', id),
  togglePinTab: (id) => ipcRenderer.invoke('tabs:togglePin', id),
  toggleMuteTab: (id) => ipcRenderer.invoke('tabs:toggleMute', id),
  viewSource: (id) => ipcRenderer.invoke('tabs:viewSource', id),
  reopenClosedTab: () => ipcRenderer.invoke('tabs:reopenClosed'),
  reorderTabs: (orderedIds) => ipcRenderer.send('tabs:reorder', orderedIds),

  // navigation
  navigate: (id, url) => ipcRenderer.invoke('nav:go', { id, url }),
  goBack: (id) => ipcRenderer.invoke('nav:back', id),
  goForward: (id) => ipcRenderer.invoke('nav:forward', id),
  reload: (id) => ipcRenderer.invoke('nav:reload', id),

  // window controls
  minimizeWindow: () => ipcRenderer.invoke('win:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('win:maximize'),
  closeWindow: () => ipcRenderer.invoke('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),

  // reserve extra overlay height for a floating menu/find-bar (see main.js)
  setOverlayExtra: (px) => ipcRenderer.send('ui:setOverlayExtra', px),

  // manual window drag (fire-and-forget for smooth tracking)
  getWindowPosition: () => ipcRenderer.invoke('win:getPosition'),
  setWindowPosition: (x, y) => ipcRenderer.send('win:setPosition', { x, y }),
  windowDragStart: () => ipcRenderer.send('win:dragStart'),
  windowDragEnd: () => ipcRenderer.send('win:dragEnd'),

  // find in page
  findStart: (id, text, forward) => ipcRenderer.invoke('find:start', { id, text, forward }),
  findNext: (id, text, forward) => ipcRenderer.invoke('find:next', { id, text, forward }),
  findStop: (id) => ipcRenderer.invoke('find:stop', id),

  // zoom
  zoomIn: (id) => ipcRenderer.invoke('zoom:in', id),
  zoomOut: (id) => ipcRenderer.invoke('zoom:out', id),
  zoomReset: (id) => ipcRenderer.invoke('zoom:reset', id),

  // bookmarks
  getBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
  addBookmark: (url, title, favicon) => ipcRenderer.invoke('bookmarks:add', { url, title, favicon }),
  removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', id),
  removeBookmarkByUrl: (url) => ipcRenderer.invoke('bookmarks:removeByUrl', url),

  // settings (adBlockEnabled lives in here too — see settings:get/set in main.js)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),

  // push events from main
  onUpdate: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('tabs:update', listener);
    return () => ipcRenderer.removeListener('tabs:update', listener);
  },
  onWinState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('win:state', listener);
    return () => ipcRenderer.removeListener('win:state', listener);
  },
  onFocusUrlbar: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('focus-urlbar', listener);
    return () => ipcRenderer.removeListener('focus-urlbar', listener);
  },
  onFindOpen: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('find:open', listener);
    return () => ipcRenderer.removeListener('find:open', listener);
  },
  onFindResult: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('find:result', listener);
    return () => ipcRenderer.removeListener('find:result', listener);
  },
  onBookmarkToggleRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('bookmark:toggle-request', listener);
    return () => ipcRenderer.removeListener('bookmark:toggle-request', listener);
  }
});
