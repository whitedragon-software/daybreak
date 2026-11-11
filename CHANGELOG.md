# Changelog

## 1.2.0 (in development)

### Added
- Private (incognito) browsing as separate windows, Chrome-style. "New private window" in the main menu and `Ctrl+Shift+N` from anywhere open a whole second browser window whose tabs are all private by construction.
  - Every tab in a private window runs in an in-memory session partition: cookies, cache, localStorage and service workers exist only for the current app run and are never written to disk.
  - Private tabs are never recorded in history, never enter the reopen-closed-tab list, and never take part in session restore.
  - Downloads made in a private window stay out of `downloads.json` (they exist only for the current session, on the downloads page).
  - Private windows use dark chrome in both themes and show a "Private" badge in the tab row, like Chrome's incognito UI.
  - When the last private window closes, the in-memory partition is wiped immediately, so a new private window starts completely clean.
- Multi-window support: main.js was refactored from single-window globals to per-window state objects (own tab map, own toolbar overlay, own layout), so normal and private windows can be open side by side and share nothing.
- Floating menus, the tab right-click menu and the find bar cap their height to the real space below their anchor and scroll internally on flat windows; the window's real content height is now reported to the toolbar for this.
- Chrome-style bookmarks bar interactions:
  - Bookmark chips are capped at 200px and the label ellipsizes, so one bookmark with a very long name can no longer swallow the whole bar.
  - Left click navigates the current tab; middle click or Ctrl/Cmd+click opens the bookmark in a new background tab.
  - Right-click menu on every chip: Open in new tab, Open in background tab, Edit bookmark…, Delete.
  - Drag a chip to reorder the bar; the new order persists to `bookmarks.json`.
  - Edit bookmark… opens a small dialog anchored under the chip (Name + URL); the URL is resolved with the same rules as the address bar and an emptied name falls back to the URL.
- Chrome-style error pages instead of silent failures. A navigation that times out, can't be resolved, is refused, gets blocked, or whose renderer crashes now renders a full error page inside the tab — previously the failure existed only in the terminal and the tab just stayed blank.
  - Every main-frame network failure has Chrome-parity wording for its error code ("took too long to respond", "server IP address could not be found", "refused to connect", "No internet connection", "This page has been blocked" for ad-blocker blocks, …), plus the `net::ERR_*` code and the failed URL.
  - The failed URL stays in the address bar and the tab strip, like Chrome; error pages never enter history.
  - Reload — toolbar button, Ctrl+R, the page context menu, or the page's own Reload button — retries the URL that failed instead of redrawing the error page. Enter retries and Escape goes back.
  - Go back on an error page — the page's own button, the toolbar Back button, Alt+Left, or the context menu — returns to the last page that actually loaded. Chromium keeps failed navigations in the back/forward list and each failure stacks another identical error entry on top, so naive history traversal would re-run the dead navigation and the button would feel dead; Daybreak instead remembers each tab's last committed URL and goes there in one hop. The button is hidden when nothing loaded behind the failure (like Chrome), and certificate pages keep "Back to safety" with a New-Tab fallback.
  - Certificate failures get a "Your connection is not private" page with a Details section and an explicit "Proceed to … (unsafe)" action. Exceptions are bound to the exact host + certificate fingerprint that was actually denied, kept in memory for the current run only, and never granted for sub-frames. TLS protocol errors offer no bypass, like Chrome.
  - A crashed renderer shows an "Aw, Snap!" page (with the crash reason) and a working Reload; loading the page relaunches the renderer.
- Dropdown menus now close when you click the page, like Chrome: every tab relays a bare mousedown through `tab-preload.js` and main.js back to its window's toolbar, so clicking away no longer leaves a menu open with a dead strip of overlay over the page.
- Export and import for Bookmarks and History as plain, versioned `.json` files. "Export JSON" / "Import JSON" on `daybreak://bookmarks` and `daybreak://history` open native save/open dialogs; imports are merges (duplicates are skipped, nothing is deleted or overwritten), rows without a usable http(s) URL are skipped rather than imported as dead entries, and the renderer never names file paths — the main process owns the dialogs and all disk access.
- The New Tab page's "Frequently visited" tiles are now managed like the bookmarks bar:
  - Left click opens the site in the current tab; middle click or Ctrl/Cmd+click opens it in a new background tab.
  - Right-click menu on every tile: Open, Open in background tab, Edit tile…, Hide from New Tab.
  - Edit tile… follows the same conventions as the bookmark editor (address-bar URL resolution, an emptied name falls back to the URL) and updates the underlying bookmark, so the bar and star state stay in sync.
  - Hiding a tile is reversible and non-destructive: the bookmark is kept, and a "Show hidden tiles (N)" control on the New Tab page restores them.
  - Tiles can be dragged to reorder the grid; the order persists in `settings.json` and never affects bookmarks-bar order. Tile preferences are keyed by URL, pruned when the bookmark is removed, and carried over when its URL is edited.

### Changed
- Private browsing was first built per-tab during development, then replaced by the window-level model above: a per-tab privacy flag was found to leak state between private and normal tabs, and window-level privacy removes the leak by construction.

### Fixed
- Find in page on PDF documents. Chromium's built-in PDF viewer silently dropped the first fresh search of a session, inflated the reported match total by +1 on every reply, and reported "past the last match" as an empty result instead of wrapping. Match counts now stay accurate, fresh searches always run forward, and an empty report after known matches restarts the search. Known limitation: on PDFs, searching backward and wrapping past the first match can display "1 of N".
- Dropdown menus were cut off at the bottom edge on very short windows, with no way to reach the hidden items; they now scroll internally instead.
- Restoring a minimized window now re-runs layout and repushes window state, so views come back correctly sized.
- A tab or context menu opened near the right window edge no longer appears half off-screen; it flips back inside.
- Hardened HTML escaping in the internal pages (`pages.js`): every page-controlled string (titles, URLs, favicons, download filenames — all of which come from web content) now goes through `escapeHtml()` before it enters markup on the new tab, bookmarks, history and downloads pages. These pages run with the privileged `internalAPI` bridge, so markup injected through e.g. a page title would have been a real vulnerability, not a cosmetic bug.
- Bookmarks, History and Downloads pages hung on "Loading…" forever whenever data existed (and the New Tab page's "Frequently visited" tiles silently rendered nothing). The escaping hardening above had added `escapeHtml()` calls to the pages' client-side scripts but shipped the helper itself only to the main process — with data present the render pass threw "escapeHtml is not defined" and the page kept its loading state (empty lists skipped the helper, which made the breakage look random). The helper is now injected into every internal page's `<script>` block by `shell()`, and a failed theme lookup can no longer take a page's own script down with it.
- The error page's "Go back" button (and the toolbar Back button, Alt+Left, and the context-menu Back while an error page was showing) could do nothing, return to the identical error page, or re-run the failed navigation: Chromium keeps failed navigations in the back/forward list, so `history.back()` never reliably reached the page the user came from. Back now goes to the tab's last committed URL, skipping every dead entry in one deterministic hop; it is disabled/hidden when nothing was committed behind the failure.
- Reload on an error page was a silent no-op when the failed or crashed page was one of Daybreak's own internal pages (e.g. a crashed New Tab page): the retry guard rejected all `daybreak://` targets. It now only rejects `daybreak://error` itself, which is the one target that would loop the error page into itself.

### Delivered alongside (documents, not code)
- A debugging checklist for reproducing and diagnosing reported issues.

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
- Menu icons are monochrome line icons instead of coloured letter badges.
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
- Chromium's console logging is turned down.

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
