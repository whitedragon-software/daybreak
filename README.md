# Daybreak

A minimal multi-window desktop browser built on Electron's BaseWindow and
WebContentsView APIs — frameless windows with a custom tab strip and
address bar, real per-tab browsing contexts (not iframes), a small set of
internal pages (bookmarks, history, downloads, settings, apps, performance,
about) served from a genuine registered `daybreak://` protocol, and
Chrome-style private (incognito) windows.

---

## Contents

- `package.json` — app manifest, start script, Electron dependency
- `main.js` — main process: window and tab lifecycle, layout, ad blocker,
  downloads, bookmarks/history/settings persistence, all IPC handlers
- `preload.js` — context-bridge API exposed to the overlay UI (`window.api`)
- `tab-preload.js` — restricted context-bridge exposed only to internal
  `daybreak://` pages (`window.internalAPI`); regular websites never see it.
  It also relays a bare mousedown from every page so the toolbar can close
  its floating menus when you click the page (see "Why the overlay doesn't
  cover the whole window"), and carries the error-page actions (retry,
  accept certificate) back to the main process
- `pages.js` — HTML generators for the internal pages: new tab, bookmarks,
  history, downloads, settings, about, apps, performance, view source,
  error pages
- `index.html` — the overlay UI itself: tab strip, address bar, bookmarks
  bar, menus, find bar
- `2FA.html` — a self-contained bundled app (local TOTP authenticator),
  served as-is at `daybreak://2FA`; the first entry in the Apps hub
- `CHANGELOG.md` — version history

---

## How it works

### Window architecture

Every browser window — normal or private — is a fully self-contained state
object: its own `BaseWindow` (`frame: false`), its own toolbar overlay, its
own tab map and active tab. Nothing browser-related is global, so a private
window and a normal window can live side by side without ever sharing tabs,
sessions, or UI state. A window is a stack of child `WebContentsView`
instances:

- **The overlay** — one `WebContentsView` loading `index.html`, holding
  the entire custom UI (tab strip, address bar, bookmarks bar, menus). It
  is always kept on top in z-order (every tab view is inserted *below* it,
  at index 0, rather than the overlay being raised above them) and normally
  covers only the toolbar strip at the top of the window, not the full page
  area.
- **One WebContentsView per tab** — a real, independent browsing context
  with its own navigation history, not an iframe embedded inside another
  page. Only the active tab's view is given nonzero bounds; inactive tabs
  are resized to zero rather than removed, so they keep running in the
  background.

### Private (incognito) windows

"New private window" in the main menu, or `Ctrl+Shift+N` from anywhere,
opens a whole separate window whose tabs are all private by construction —
there is no per-tab privacy flag anywhere.

- Every tab in a private window uses an in-memory session partition
  (`session.fromPartition` without `persist:`): cookies, cache,
  localStorage and service workers exist only for the current app run and
  are never written to disk.
- Private tabs are never recorded in history, never enter the
  reopen-closed-tab list (`Ctrl+Shift+T` inside a private window is a
  deliberate no-op), and never take part in session restore.
- Downloads made in a private window are tracked for the current session
  (the downloads page still shows them) but are filtered out of
  `downloads.json`.
- Private windows use dark chrome in both themes and show a "Private"
  badge in the tab row, like Chrome's incognito UI.
- When the **last** private window closes, the in-memory partition is
  wiped immediately (storage data + cache), so the next private window
  starts completely clean.
- The ad blocker and the `daybreak://` protocol handler are attached to
  the private session too — internal pages work identically there.

### Bookmarks bar

The bar behaves like Chrome's:

- **Chips are capped at 200px** and the label ellipsizes — a bookmark with
  a very long name can no longer swallow the whole bar. The full URL is
  always available as the chip's tooltip.
- **Left click** navigates the current tab. **Middle click** or
  **Ctrl/Cmd+click** opens the bookmark in a new *background* tab. With no
  active tab, a plain click opens a new tab.
- **Right click** opens a chip menu: Open in new tab, Open in background
  tab, Edit bookmark…, Delete.
- **Drag to reorder** — hold a chip, move past a 5px threshold, and the
  bar reorders live under the cursor; the new order is persisted to
  `bookmarks.json` on drop.
- **Edit bookmark…** opens a small dialog anchored under the chip with
  Name and URL fields. The URL is resolved with the same rules as the
  address bar (typing `example.com` becomes `https://example.com`), an
  emptied name falls back to the URL, `Enter` saves and `Escape` cancels.
- The bar is toggled with "Show bookmarks bar" in the main menu; the
  setting applies to every open window.

### Why the overlay doesn't cover the whole window

An earlier version tried making the overlay cover the entire window with
a transparent background, using `setIgnoreMouseEvents` to pass clicks
through to the tab underneath wherever the overlay wasn't drawing actual
UI. `WebContentsView` has no such method — only `BrowserWindow` does — so
that approach is not available here. The overlay is therefore sized to
the toolbar only, and any floating UI that needs to paint below that edge
(the main dropdown menu, the context menus, the bookmark editor, the find
bar) works by temporarily growing the overlay's own bounds just enough to
fit that one element — measured with `getBoundingClientRect()`, not a
guessed constant, so it can't silently start clipping again if a menu
gains more items later.

Because clicks on the page below the grown overlay never reach the
overlay's document, every tab relays a bare `mousedown` event through
`tab-preload.js` and main.js back to its window's overlay
(`ui:click-away`), so the menus behave like Chrome's: clicking anywhere on
the page closes them. The find bar deliberately survives page clicks, and
its reserved space is kept while it is open. Menus also cap their height
to the real space below their anchor and scroll internally, so a very
flat window scrolls them instead of clipping them.

### Dragging and resizing

For the same reason, `-webkit-app-region: drag` does not reliably move a
`BaseWindow` with multiple `WebContentsView`s attached. Dragging is
implemented manually: a mousedown on empty tab-row space records the
window's starting position and the mouse's *screen* coordinates, and each
subsequent mousemove computes the delta and calls `win.setPosition()`
directly, with the window's size explicitly re-asserted on every update
so nothing external (a Snap gesture, a monitor's DPI change) can make it
drift. Resizing relies on the operating system's own resize border for a
frameless-but-resizable window, since there is no equivalent click-through
mechanism available to build a custom set of edge/corner handles.

### Internal pages

`daybreak://` is registered as a real, privileged scheme (`newtab`,
`bookmarks`, `history`, `downloads`, `settings`, `about`, `apps`,
`performance`, `view-source`, `2FA`), handled by `protocol.handle` in the
main process — the same mechanism a browser would use for its own
`chrome://`-style pages, not a special-cased string inside a tab. The
handler is attached to the default session *and* the private session, so
internal pages work inside private windows too. Each tab's
`WebContentsView` loads `tab-preload.js`, which only exposes
`window.internalAPI` when `location.protocol === 'daybreak:'` — an
ordinary website loaded in a tab never gets access to bookmarks, history,
or settings, regardless of what it tries to call.

### Error pages

A failed navigation renders a Chrome-style error page inside the tab
instead of failing silently (previously the error existed only in the
terminal and the tab stayed blank). All of these have one:

- Timeouts, dead DNS, refused/reset connections, empty responses, redirect
  loops, unreachable addresses, file errors, proxy failures — each with
  Chrome-parity wording for its error code and the numeric `net::ERR_*`
  code shown.
- "No internet" when the machine is offline, and "This page has been
  blocked" when the ad blocker stopped a main-frame navigation to a
  block-listed host.
- "Your connection is not private" for certificate problems, with a Details
  section and an explicit "Proceed to <host> (unsafe)" action. The exception
  is bound to the exact host + certificate fingerprint that was actually
  denied and lasts for the current app run only — nothing is pre-accepted,
  nothing persists to disk. TLS protocol errors get no bypass.
- "Aw, Snap!" when a tab's renderer crashes (out of memory, killed, …),
  with the reason shown and a working Reload.

The failed URL stays in the address bar and the tab strip, like Chrome; the
error page itself lives at `daybreak://error?…` and never enters history.
Reload — toolbar button, `Ctrl+R`, right-click menu, or the page's own
Reload button — retries the URL that failed, not the error page. Enter
retries and Escape goes back. Error pages work identically in private
windows (they are ordinary `daybreak://` pages, so the private session
serves them too).

"Go back" on an error page — the page's own button, the toolbar Back
button, `Alt+Left`, or the right-click menu — returns to the last page
that actually loaded. This is deliberate: Chromium keeps failed
navigations in the back/forward list, and every failure also stacks
another identical `daybreak://error` entry on top, so naive history
traversal re-runs the dead navigation (or lands on the identical error
page behind it) and the button feels dead. Daybreak instead remembers
each tab's last committed URL and goes there in one hop. The button is
hidden when nothing was loaded behind the failure (e.g. the very first
navigation of a tab failed), exactly like Chrome; certificate pages keep
"Back to safety" and fall back to the New Tab page.

### Internal pages and data loading

The generated pages (`bookmarks`, `history`, `downloads`, new tab tiles)
render their lists through inline scripts that call a shared `escapeHtml`
helper injected into every page by `shell()`. That helper exists in two
places on purpose: a main-process copy in `pages.js` for strings baked
into HTML at build time (view-source content, error-page URLs), and the
injected renderer copy for strings rendered client-side from IPC data
(bookmark titles, history rows, download names). Every page-controlled
string goes through one of them before it can touch markup — these pages
run with the privileged `internalAPI` bridge, so an unescaped page title
would be a real vulnerability, not a cosmetic bug.

### Apps

`daybreak://apps` is a small hub for self-contained bundled tools, listed
in `pages.js`'s `APPS` array — adding a new one later is just adding an
entry there plus its route in `protocol.handle`. Unlike the generated
pages, an app is typically its own complete static HTML file (like
`2FA.html`) with its own styling and its own `localStorage`-backed
persistence, served as-is rather than templated through `shell()`. The
hub is reachable from the new tab page and from the main menu.

### Tabs

Tabs can be created, switched, closed, duplicated, pinned, muted, and
dragged to reorder (pinned and unpinned tabs stay in separate groups).
When there are more tabs than fit, the tab strip scrolls horizontally with
the mouse wheel, and the active tab is scrolled into view whenever it
changes. The last 25 closed tabs are remembered and can be reopened with
`Ctrl+Shift+T`.

### State updates

Every tab reports loading state, title, and navigation changes back to
the overlay through a single `tabs:update` push. Busy pages can fire many
of these in a burst (a page with a lot of embedded content, or one that
does frequent client-side navigation), so `pushState()` coalesces bursts
into at most one update roughly every 16ms rather than sending one
message per raw event, and the overlay only rebuilds a given tab's DOM
element when that specific tab's own visible fields actually changed.
History and downloads records are saved to disk on a similar debounce,
rather than a synchronous write per event, and are capped at 5000 and 500
entries respectively. Each tab's navigation and audio state (the values
that need a call into the native `WebContents` binding) is cached and only
re-queried when a navigation, media, or mute event for that tab occurs,
rather than for every tab on every update.

### Memory Saver

Off by default; turn it on in Settings. When enabled, a background tab
that has been idle for 20 minutes is discarded: its view is destroyed to
free its process, while its title, URL, and place in the tab strip are
kept. It reloads automatically when you switch back to it. The active tab,
pinned tabs, and tabs currently playing audio are never discarded.
Private-window tabs are discarded and revived just as safely — the view
is recreated inside the same in-memory partition, so nothing touches disk.

### Performance page

`daybreak://performance` lists every Daybreak process with its memory and
CPU use, read from Electron's `app.getAppMetrics()`. Processes that belong
to a tab are labelled with that tab's title and URL. GPU rasterization and
zero-copy are enabled at startup. No benchmark numbers are claimed here;
measure on your own hardware.

### Ad blocking

Network-level blocking runs through `session.webRequest` on both the
default session and the private partition, matching request hostnames
against a curated list of ad and tracking domains, toggleable from
Settings. A request blocklist alone does not stop a page from opening a
new window via `window.open()`, which is a separate code path, so each tab
also has a `setWindowOpenHandler`: known ad hosts are denied, and any other
`window.open()` opens as a normal Daybreak tab instead of a separate
native window. A small set of CSS rules also hides common ad containers.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+T` | Reopen closed tab (no-op in private windows) |
| `Ctrl+Shift+N` | New private window |
| `Ctrl+L` | Focus the address bar |
| `Ctrl+F` | Find in page |
| `Ctrl+D` | Bookmark / unbookmark the current page |
| `Ctrl+U` | View page source |
| `Ctrl+R` | Reload |
| `Ctrl+Shift+D` | Duplicate tab |
| `Ctrl+Shift+M` | Mute / unmute tab |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Alt+←` / `Alt+→` | Back / forward |
| Middle-click a tab | Close tab |
| Middle-click a bookmark | Open in background tab |

---

## Building

```
npm install
npm start           # run from source
npm run pack        # unpacked build, for quick local testing
npm run dist        # packaged installer for the current platform
```

`dist` uses electron-builder with the config in `package.json`'s `build`
key, targeting NSIS on Windows, a DMG on macOS, and an AppImage on Linux —
it builds for whichever platform you run it on, into `dist/`.

The app icon is read from the `build/` folder. electron-builder needs a
PNG (at least 256x256, named `icon.png`) or an `icon.ico`; an SVG is not
used for the installer or executable icon.

---

## Known limitations

- Resizing depends on the operating system's native frameless-resize
  behavior rather than anything this app controls directly.
- The ad blocker is a hostname-matching request blocker with popup
  handling and a small cosmetic rule set. It is not a full filter-list
  engine, so ads served from a page's own first-party domain can still get
  through.
- Bookmarks are a flat list — there are no folders.
- Find in page on PDF documents has a known counting quirk when searching
  backward and wrapping past the first match (it can display "1 of N");
  forward search and counts are accurate.
- Authentication state is per-session only; nothing is synced anywhere.

---

## Testing checklist

Work through these in order after any change to window/tab management,
the ad blocker, the bookmarks bar, or the overlay's rendering — each
targets a specific layer, so a failure narrows down where to look.

| # | Action | What you're checking | Expected result |
|---|---|---|---|
| 1 | Launch the app | Window creation | Frameless white window, one blank/new-tab tab open, tab strip above the address bar. |
| 2 | Open several tabs, switch between them | Tab/view lifecycle | Only the active tab's content is visible; switching is instant; background tabs keep their scroll position. |
| 3 | Drag the tab row to move the window | Manual drag | Window follows the cursor smoothly with no jump or resize; releasing leaves it exactly where dropped. |
| 4 | Resize from a window edge | Native resize | Window resizes normally; tab content and toolbar reflow to the new size. |
| 5 | Open the main menu (⋮), then right-click a tab | Floating UI | Both menus render fully on-screen, never clipped at the bottom, regardless of window height. |
| 6 | With a menu open, click somewhere on the page | Click-away | The menu closes; no dead strip of the page remains unclickable. |
| 7 | Load a content-heavy page (e.g. a search results page) | State-push coalescing | Tab title/spinner update smoothly; the tab strip does not flicker or repeatedly flash during the load. |
| 8 | Bookmark a page with a very long title, show the bookmarks bar | Chip truncation | The chip caps at 200px and ellipsizes; hovering shows the URL; the rest of the bar stays usable. |
| 9 | Left-click, Ctrl+click and middle-click a chip | Chip clicks | Left navigates the current tab; Ctrl/middle open a background tab without switching. |
| 10 | Right-click a chip | Chip context menu | Open in new tab / Open in background tab / Edit bookmark… / Delete all work. |
| 11 | Drag a chip sideways and drop it | Chip reorder | Bar reorders live during the drag; order persists after a restart. |
| 12 | Edit a bookmark, set name to "example.org" and URL to `example.org/edited` | Bookmark editor | Dialog anchors under the chip; URL resolves to `https://example.org/edited`; emptied name falls back to the URL. |
| 13 | Star a page, open the bookmarks bar, visit `daybreak://bookmarks` | Bookmarks | Entry appears in both places; removing it from the manager updates the star immediately. |
| 14 | Open a private window (`Ctrl+Shift+N`), visit a few sites | Private windows | Dark chrome + Private badge; nothing appears in history or the reopen list; closing the window wipes cookies (a new private window starts logged out). |
| 15 | Open a normal window next to the private one | Window isolation | Tabs, sessions and UI state are fully separate; switching windows never mixes tabs. |
| 16 | Visit `daybreak://history`, `daybreak://downloads`, `daybreak://settings`, `daybreak://about` | Internal pages | Each opens in a new tab (not replacing the current page), renders correctly, and reflects real data. |
| 17 | Toggle dark mode in Settings | Theming | Overlay and all internal pages switch immediately; ordinary websites are unaffected. |
| 18 | Toggle the ad blocker off, then on, on a page with ads | Ad blocking | Visible difference in blocked network requests; setting persists across restart. |
| 19 | Trigger a page that opens a popup ad | Popup handling | No separate ad window appears. |
| 20 | Drag a tab left/right within its group (pinned or unpinned) | Tab reordering | Tab reorders live during the drag; order persists after dropping. |
| 21 | Open more tabs than fit in the tab strip, then scroll the wheel over it | Tab overflow | The strip scrolls horizontally, and a newly opened tab is scrolled into view. |
| 22 | Press `Ctrl+F`, type a word, then press Enter repeatedly | Find in page | Matches highlight as you type; Enter and Next move through the matches. |
| 23 | Close a tab, then press `Ctrl+Shift+T` | Reopen closed tab | The closed tab comes back at its last URL. |
| 24 | Turn on Memory Saver, leave a background tab idle for 20 minutes, then click it | Memory Saver | The tab reloads on click and keeps its title and position in the strip. |
| 25 | Open `daybreak://performance` | Process metrics | Each process lists memory and CPU use, and tab processes show the tab's title. |
| 26 | Open the Apps hub, then the Authenticator at `daybreak://2FA` | Bundled app | The hub lists the Authenticator and it opens and works offline. |
| 27 | Visit a domain that doesn't exist (e.g. `https://no-such-host-zzz.invalid`) | DNS error page | "This site can't be reached" page with `net::ERR_NAME_NOT_RESOLVED`; the address bar keeps the failed URL. |
| 28 | On that error page, press the page's Reload, then `Ctrl+R`, then Enter | Retry paths | All three retry the failed URL (it fails again → same error page, no blank flash); Escape goes back. |
| 29 | Visit `https://self-signed.badssl.com` | Certificate error page | "Your connection is not private"; Details → Proceed anyway loads the site; after an app restart the exception is gone (warning returns). |
| 30 | Visit `http://10.255.255.1` (a black-hole address) | Timeout error page | "…took too long to respond" page appears once the connection times out. |
| 31 | Navigate directly to a host on the ad block list | Blocked page | "This page has been blocked" page names the ad blocker and points at Settings. |
| 32 | Turn on Memory Saver, leave an error-page tab idle 20 minutes, then click it | Discard + error page | The tab revives, retries the failed URL, and shows the error page again if it still fails. |
| 33 | With at least one bookmark saved, open `daybreak://bookmarks`; same for `daybreak://history` and `daybreak://downloads` with data | Internal list pages | Each list renders its rows immediately (no permanent "Loading…"); empty lists still show their "No … yet" state. |
| 34 | On the New Tab page with bookmarks saved | Frequently visited tiles | Up to 9 tiles render from the newest bookmarks. |
| 35 | From any loaded page, navigate to a dead URL, then click the error page's "Go back" — repeat with the toolbar Back button and `Alt+Left` | Error page back navigation | All three land on the page you came from (not a repeat error page, not a blank tab). |
| 36 | As the very first action in a brand-new tab, type an unreachable URL | First-load failure | The error page shows with NO "Go back" button (nothing loaded behind the failure); Reload still works. |

---

## File map

```
main.js
├─ persisted data          → bookmarks.json, history.json, downloads.json,
│                             settings.json in Electron's userData folder
│                             (private-session downloads are filtered out
│                             of downloads.json)
├─ windows[]               → one state object per window: BaseWindow,
│                             overlay view, tab map, active tab, layout
│                             cache (normal and private alike)
├─ layout(st)              → overlay + active tab view bounds, per window
│                             resize; overlayExtra reserves space for
│                             floating UI
├─ createTab(st, url, o)   → tab lifecycle; opts.pinned / opts.background
├─ closeTab / duplicateTab → per-window tab operations, reopen list
├─ attachTabListeners()    → per-tab events, popup handling, favicons, audio
├─ discardTab / reviveTab  → opt-in Memory Saver (in-memory partition is
│                             preserved across discard/revive)
├─ getPrivateSes()         → the in-memory incognito partition; wiped when
│                             the last private window closes
├─ setAdBlockerActive()    → webRequest-based hostname blocking, attached
│                             to the default session AND the private one
├─ buildPageContextMenu()  → native right-click menu for page content
├─ protocol.handle()       → serves the daybreak:// internal pages
│                             (default session and private session)
└─ ipcMain handlers        → tabs, navigation, window controls, drag,
                              bookmarks (add/update/remove/reorder), history,
                              downloads, settings, find, zoom, process
                              metrics, overlay extra height, page click-away,
                              error pages (retry, certificate exceptions)

preload.js                 → window.api bridge for the overlay UI (toolbar,
                            bookmarks bar, menus, find bar)

tab-preload.js             → window.internalAPI for daybreak:// pages only;
                            plus the page mousedown relay that closes the
                            toolbar's floating menus on page clicks

index.html                 → the overlay: tab strip (drag reorder, wheel
                            scroll), address bar, bookmarks bar (200px
                            chips, click/middle/ctrl click, right-click
                            menu, editor, drag reorder), menus, find bar

pages.js                   → generators for the daybreak:// pages (incl.
                            error pages) + APPS hub
2FA.html                   → self-contained TOTP authenticator app
