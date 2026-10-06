# Daybreak

A minimal multi-tab desktop browser built on Electron's BaseWindow and
WebContentsView APIs — a frameless window with a custom tab strip and
address bar, real per-tab browsing contexts (not iframes), and a small set
of internal pages (bookmarks, history, downloads, settings, about) served
from a genuine registered `daybreak://` protocol.

---

## Contents

- `package.json` — app manifest, start script, Electron dependency
- `main.js` — main process: window and tab lifecycle, layout, ad blocker,
  downloads, bookmarks/history/settings persistence, all IPC handlers
- `preload.js` — context-bridge API exposed to the overlay UI (`window.api`)
- `tab-preload.js` — restricted context-bridge exposed only to internal
  `daybreak://` pages (`window.internalAPI`); regular websites never see it
- `pages.js` — HTML generators for the internal pages: new tab, bookmarks,
  history, downloads, settings, about, apps
- `index.html` — the overlay UI itself: tab strip, address bar, menus,
  find bar
- `2FA.html` — a self-contained bundled app (local TOTP authenticator),
  served as-is at `daybreak://2fa`; the first entry in the Apps hub

---

## How it works

### Window architecture

The window is a `BaseWindow` (`frame: false`), not a `BrowserWindow` — it
has no web content of its own, only a stack of child `WebContentsView`
instances:

- **The overlay** — one `WebContentsView` loading `index.html`, holding
  the entire custom UI (tab strip, address bar, menus). It is always kept
  on top in z-order (every tab view is inserted *below* it, at index 0,
  rather than the overlay being raised above them) and normally covers
  only the toolbar strip at the top of the window, not the full page area.
- **One WebContentsView per tab** — a real, independent browsing context
  with its own navigation history, not an iframe embedded inside another
  page. Only the active tab's view is given nonzero bounds; inactive tabs
  are resized to zero rather than removed, so they keep running in the
  background.

### Why the overlay doesn't cover the whole window

An earlier version tried making the overlay cover the entire window with
a transparent background, using `setIgnoreMouseEvents` to pass clicks
through to the tab underneath wherever the overlay wasn't drawing actual
UI. `WebContentsView` has no such method — only `BrowserWindow` does — so
that approach is not available here. The overlay is therefore sized to
the toolbar only, and any floating UI that needs to paint below that edge
(the main dropdown menu, the tab right-click menu, the find bar) works by
temporarily growing the overlay's own bounds just enough to fit that one
element — measured with `getBoundingClientRect()`, not a guessed constant,
so it can't silently start clipping again if a menu gains more items later.

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
`bookmarks`, `history`, `downloads`, `settings`, `about`, `apps`), handled
by `protocol.handle` in the main process — the same mechanism a browser
would use for its own `chrome://`-style pages, not a special-cased string
inside a tab. Each tab's `WebContentsView` loads `tab-preload.js`, which
only exposes `window.internalAPI` when `location.protocol === 'daybreak:'`
— an ordinary website loaded in a tab never gets access to bookmarks,
history, or settings, regardless of what it tries to call.

### Apps

`daybreak://apps` is a small hub for self-contained bundled tools, listed
in `pages.js`'s `APPS` array — adding a new one later is just adding an
entry there plus its route in `protocol.handle`. Unlike the generated
pages, an app is typically its own complete static HTML file (like
`2FA.html`) with its own styling and its own `localStorage`-backed
persistence, served as-is rather than templated through `shell()`. The
hub is reachable from the new tab page and from the main menu.

### State updates

Every tab reports loading state, title, and navigation changes back to
the overlay through a single `tabs:update` push. Busy pages can fire many
of these in a burst (a page with a lot of embedded content, or one that
does frequent client-side navigation), so `pushState()` coalesces bursts
into at most one update roughly every 16ms rather than sending one
message per raw event, and the overlay only rebuilds a given tab's DOM
element when that specific tab's own visible fields actually changed.
History and downloads records are saved to disk on a similar debounce,
rather than a synchronous write per event.

### Ad blocking

Network-level blocking runs through `session.defaultSession.webRequest`,
matching request hostnames against a curated list of ad and tracking
domains, toggleable from Settings. This covers most third-party ad and
tracking *requests* — but a request-blocklist alone does not stop a page
from opening an entirely new, uncontrolled window via `window.open()`,
which is a separate code path.

---

---

## Building

```
npm install
npm start          # run from source
npm run pack        # unpacked build, for quick local testing
npm run dist         # packaged installer for the current platform
```

`dist` uses electron-builder with the config in `package.json`'s `build`
key, targeting NSIS on Windows, a DMG on macOS, and an AppImage on Linux —
it builds for whichever platform you run it on, into `dist/`.

---

## Known limitations

- Resizing depends on the operating system's native frameless-resize
  behavior rather than anything this app controls directly.
- The ad blocker is a hostname-matching request blocker plus (as of the
  next revision) a popup/new-window filter — it does not do full-page
  cosmetic filtering the way a dedicated extension would, so ad content
  served from a page's own first-party domain, rather than a separate
  blockable host, can still get through.
- No multi-window support — a tab cannot currently be dragged out into
  its own separate window.
- No separate browsing profiles or incognito mode.
- Authentication state is per-session only; nothing is synced anywhere.

---

## Testing checklist

Work through these in order after any change to window/tab management,
the ad blocker, or the overlay's rendering — each targets a specific
layer, so a failure narrows down where to look.

| # | Action | What you're checking | Expected result |
|---|---|---|---|
| 1 | Launch the app | Window creation | Frameless white window, one blank/new-tab tab open, tab strip above the address bar. |
| 2 | Open several tabs, switch between them | Tab/view lifecycle | Only the active tab's content is visible; switching is instant; background tabs keep their scroll position. |
| 3 | Drag the tab row to move the window | Manual drag | Window follows the cursor smoothly with no jump or resize; releasing leaves it exactly where dropped. |
| 4 | Resize from a window edge | Native resize | Window resizes normally; tab content and toolbar reflow to the new size. |
| 5 | Open the main menu (⋮), then right-click a tab | Floating UI | Both menus render fully on-screen, never clipped at the bottom, regardless of window height. |
| 6 | Load a content-heavy page (e.g. a search results page) | State-push coalescing | Tab title/spinner update smoothly; the tab strip does not flicker or repeatedly flash during the load. |
| 7 | Star a page, open the bookmarks bar, visit `daybreak://bookmarks` | Bookmarks | Entry appears in both places; removing it from the manager updates the star immediately. |
| 8 | Visit `daybreak://history`, `daybreak://downloads`, `daybreak://settings`, `daybreak://about` | Internal pages | Each opens in a new tab (not replacing the current page), renders correctly, and reflects real data. |
| 9 | Toggle dark mode in Settings | Theming | Overlay and all internal pages switch immediately; ordinary websites are unaffected. |
| 10 | Toggle the ad blocker off, then on, on a page with ads | Ad blocking | Visible difference in blocked network requests; setting persists across restart. |
| 11 | Trigger a page that opens a popup ad | Popup handling | No separate ad window appears. |
| 12 | Drag a tab left/right within its group (pinned or unpinned) | Tab reordering | Tab reorders live during the drag; order persists after dropping. |

---

## File map

```
main.js
├─ persisted data          → bookmarks.json, history.json, downloads.json,
│                             settings.json in Electron's userData folder
├─ layout()                 → overlay + active tab view bounds, per window resize
├─ createTab / closeTab     → tab lifecycle, pinning, duplication, reordering
├─ setupAdBlocker()         → webRequest-based hostname blocking
├─ buildPageContextMenu()   → native right-click menu for page content
├─ protocol.handle()        → serves the daybreak:// internal pages
└─ ipcMain handlers         → tabs, navigation, window controls, drag,
                              bookmarks, history, downloads, settings
