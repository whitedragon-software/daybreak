# Changelog

## 1.1.0

### Added
- Performance page at `daybreak://performance`: live CPU and memory use
  for every Daybreak process, read from Electron's own process metrics.
  Processes that belong to a tab are labelled with that tab's title and URL.
- Reopen closed tab (`Ctrl+Shift+T`, also in the main menu). Remembers the
  last 25 closed tabs, including whether they were pinned.
- Tab strip scrolling: the mouse wheel scrolls the strip horizontally, and
  the active tab is scrolled into view when it changes, so newly opened tabs
  past the visible width are reachable.

### Changed
- Memory Saver is now off by default and has to be turned on in Settings.
- GPU rasterization and zero-copy are enabled at startup.
- Per-tab navigation and audio state is cached and only re-queried when a
  navigation, media, or mute event occurs, instead of for every tab on every
  state update.
- History is capped at 5000 entries and downloads at 500, so they no longer
  grow without limit.
- The Authenticator is linked as `daybreak://2FA`. Hostnames are
  case-insensitive, so `daybreak://2fa` still works, and the address bar may
  display it in lowercase.
- The Settings menu icon is now a sliders icon.

## 1.0.0

Initial release.

- Frameless window built on `BaseWindow` and `WebContentsView`, with a custom
  tab strip, address bar, and window controls.
- Tabs: create, switch, close, duplicate, pin, drag to reorder, middle-click
  to close, mute, and favicons.
- Address bar that resolves input to a URL or a search (Google, Bing, or
  DuckDuckGo). Back, forward, reload, zoom, and find in page.
- Native right-click menus for page content and for tabs.
- Bookmarks (star, bookmarks bar, manager page), history, downloads with
  progress, and settings, all served from a registered `daybreak://` protocol.
- Light and dark themes.
- Ad and tracker blocking, with popup blocking and basic cosmetic filtering.
- Memory Saver, which discards tabs left idle in the background.
- View page source (`Ctrl+U`).
- Apps hub (`daybreak://apps`) with a local two-factor authenticator.
- Keyboard shortcuts, and `npm run dist` packaging via electron-builder.
