# Changelog

## 1.2.0

### Added
- Private (incognito) windows (`Ctrl+Shift+N`): every tab in them runs in an in-memory session — cookies, cache and site data never touch disk; private tabs stay out of history, the reopen list and session restore; downloads made there stay out of `downloads.json`; closing the last private window wipes the partition at once.
- Bookmarks bar interactions: 200px chips with ellipsis, middle click / Ctrl+click opens background tabs, a right-click menu (open, open in background, edit, delete), drag to reorder, and an edit dialog with the address-bar URL rules.
- Full error pages instead of silent failures: plain wording per error code, the `net::ERR_*` line and the failed URL, a Reload that retries the failed URL, and a "Go back" that jumps to the last page that actually loaded. Certificate failures get a "Your connection is not private" page with Details and an explicit in-memory "proceed" exception; crashed renderers get an "Aw, Snap!" page.
- Export and import for Bookmarks and History as versioned `.json` files through native dialogs. Imports are merges: duplicates are skipped, rows without a usable http(s) URL are filtered, and the renderer never touches file paths.
- New Tab tiles managed like the bookmarks bar: click / middle click / Ctrl+click, a right-click menu, an edit action that updates the underlying bookmark, reversible hiding with a "Show hidden tiles" restore, and drag-to-order persisted in `settings.json`.
- Developer and organization credits — Developer: WhiteDragon303, Organization: WhiteDragon Software, plus the source-code link — on the About page and in Settings. Clicking a credit opens it as a tab inside Daybreak (background on middle click / Ctrl+click); if the tab bridge is unavailable it degrades to a plain navigation, still inside Daybreak.
- `CHECKLIST.md`: the full functional test checklist with an automated pre-flight section and a test-run log per version.

### Changed
- All internal pages except the New Tab page and the 2FA app now share one structure: a fixed left navigation (the Daybreak mark, a search box on top, one link per page with the current page highlighted) next to a scrolling column of section cards. Settings keeps its own section links in the sidebar, where search filters rows and collapses empty sections; on every other page the search filters that page's list. No new settings keys — every control maps onto existing `settings.json` fields and handlers.
- The credit rows now match the size of the surrounding text, and the source-code link is labeled "Daybreak" (same URL as before).
- `package.json` names the developer (`author`: WhiteDragon303) and the organization (WhiteDragon Software, also the Windows installer publisher); the About page reads its credits from these fields, so page and metadata cannot drift apart.

### Fixed
- Find in page on PDF documents: the first fresh search is no longer dropped and match counts stay accurate (backward search can still display "1 of N" when wrapping).
- Floating menus cap their height to the real space below their anchor and scroll internally on flat windows; clicking the page closes every open menu.
- Hardened HTML escaping across the internal pages, which also fixes the list pages hanging on "Loading…" whenever data existed.
- Error-page back and reload edge cases: Back could re-run the dead navigation or land on the same error page again, and Reload refused to retry a crashed internal page.

## 1.1.0

### Added
- Added the Daybreak logo.
- Performance page at `daybreak://performance`: live CPU and memory use for
  every Daybreak process, read from Electron's own process metrics. Processes
  that belong to a tab are labelled with that tab's title and URL.
- Reopen closed tab (`Ctrl+Shift+T`, also in the main menu). Remembers the
  last 25 closed tabs, including whether they were pinned.
- Tab strip scrolling: the mouse wheel scrolls the strip horizontally, and the
  active tab is scrolled into view when it changes.

### Changed
- Memory Saver is now off by default and has to be turned on in Settings.
- GPU rasterization and zero-copy are enabled at startup.
- Per-tab navigation and audio state is cached and only re-queried when a
  navigation, media, or mute event occurs, instead of for every tab on every
  state update.
- History is capped at 5000 entries and downloads at 500.
- The Authenticator is linked as `daybreak://2FA`. Hostnames are
  case-insensitive, so `daybreak://2fa` still works, and the address bar may
  show it in lowercase.
- The Settings menu icon is now a sliders icon.

### Fixed
- Tabs opened beyond the visible width of the tab strip could not be reached.

## 1.0.0

First public release. Same feature set as 0.9.2.

## 0.9.2

### Added
- Favicons on tabs, the bookmarks bar, the bookmarks page, and home page tiles.
  Pinned tabs show the site icon instead of a letter.

### Changed
- Menu icons are plain line icons instead of coloured letter badges.
- New tab page redesigned: time-of-day greeting, pill-shaped search box,
  bordered bookmark cards under "Frequently visited".
- The Authenticator file is now `2FA.html`.

## 0.9.1

### Added
- Apps hub at `daybreak://apps`, with an entry on the new tab page and in the
  main menu.
- Authenticator (local two-factor codes) at `daybreak://2fa`.

### Changed
- Main menu redesigned: inset rounded hover, icons, more spacing.

## 0.9.0

### Added
- Memory Saver: background tabs left idle are discarded and reloaded when
  revisited.
- View page source (`Ctrl+U`).
- Tab audio indicator and mute (`Ctrl+Shift+M`).

### Fixed
- Find in page: it now searches as you type, and Enter, Next and Previous
  move through the matches instead of restarting the search.

## 0.8.0

### Added
- Popup blocking. Known ad hosts are denied; other `window.open` calls open
  as a normal tab instead of a separate native window.
- Cosmetic hiding of common ad containers.
- README and `npm run dist` packaging via electron-builder.

### Changed
- Ad blocklist expanded with ad and sync hosts seen in real traffic.
- The rendering engine's console logging is turned down.

## 0.7.0

### Added
- Drag a tab to reorder it. Pinned and unpinned tabs stay in their own groups.

### Fixed
- Tab strip flashing during page loads: state updates are batched, a tab is
  only redrawn when its own data changed, iframe in-page navigations no longer
  trigger updates, and tab elements are built once and updated in place.
- The loading spinner no longer appears for loads that finish almost instantly.
- History and downloads are saved on a debounce instead of on every event.
- Removed the tab entrance animation.

## 0.6.2

### Fixed
- Dropdown menus were clipped at the bottom; the overlay now grows to the
  measured height of the menu.
- The window was blank and unclickable after minimizing and restoring.
- The window grew in width while being dragged; its size is now held fixed
  for the duration of a drag.

## 0.6.1

### Fixed
- Crash in the main process caused by calling `setIgnoreMouseEvents` on a
  `WebContentsView`, which does not have it. The full-window overlay and
  custom resize handles were removed; resizing uses the OS border.

## 0.6.0

### Added
- Ad and tracker blocking with a toggle in Settings.
- Zoom in, out and reset. Find in page.
- Window dragging from the tab row, double-click to maximize.
- Middle-click a tab to close it.
- Loading bar under the address bar.

### Changed
- Bookmarks, history, downloads, settings and about open in a new tab instead
  of replacing the current page.

### Fixed
- "Object has been destroyed" error when the window closed during a layout
  update.

## 0.5.0

### Added
- Native right-click menus for page content: copy, search for selection, open
  and copy links, save and copy images, back, forward, reload, print, inspect.
- Cut, copy and paste menu on the address bar.

### Changed
- Tab strip moved above the address bar, with the window controls on the tab
  row.

## 0.4.0

### Added
- Renamed to Daybreak. Internal pages moved to the `daybreak://` protocol.
- Downloads page with progress, and an About page.
- Tab right-click menu: duplicate, pin, close other tabs. Pinned tabs.
- Redesigned new tab page.

### Fixed
- Dark theme setting was saved but never applied.

## 0.3.1

### Fixed
- The dropdown menu was hidden behind the page. Tab views are now stacked
  below the overlay, and the overlay background is transparent.

## 0.3.0

### Added
- Minimize, maximize and close buttons, and a solid white window background.
- Bookmarks (star button, optional bookmarks bar), history, and settings,
  stored as JSON in the user data folder.
- Address bar that treats non-URL text as a search.
- New tab page and keyboard shortcuts.
- Internal pages served from a registered custom protocol, with a separate
  preload that only exposes its API to those pages.

## 0.2.0

### Changed
- Rewritten as an Electron app using `BaseWindow` and one `WebContentsView`
  per tab, so sites load as real pages instead of in an iframe.

### Added
- Tabs, address bar, back, forward and reload, with the UI in an overlay view
  and IPC through a context-bridge preload.

## 0.1.0

### Added
- Initial release: A minimal multi-tab desktop browser built on Electron's BaseWindow and WebContentsView APIs
