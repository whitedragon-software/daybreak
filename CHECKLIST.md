# Daybreak — Test Checklist

The complete, ordered list of everything that can be verified about
Daybreak, grouped by feature area. Use it three ways:

- **Before every delivery** — section 0 (automated, terminal-only) is run
  before each new version ships, and its result is recorded in the
  test-run log at the bottom. Nothing that fails pre-flight gets delivered.
- **Release testing** — work through sections 1–22 by hand on a real
  desktop after any change. Each row is one behavior plus its expected
  result, so a failure points at a layer, not just "it's broken".
- **Regression hunting** — when something breaks, quote the row ID; the
  section tells you which layer failed and the file map in README.md tells
  you where to look.

Rules that keep the results meaningful:

- Test from source (`npm start`) unless the row says otherwise;
  packaging has its own section (22).
- Rows marked **restart** only mean something after a full app restart,
  not a page reload — persistence bugs hide behind a still-running process.
- Check off rows as you go. A failed row keeps its box unchecked and gets
  a line in the test-run log with the version and the row ID.

---

## 0. Automated pre-flight (terminal only — run on every version)

No GUI needed. These checks run in a terminal before every delivery; they
catch the mechanical failure classes (syntax, missing IPC handlers,
missing bridge methods, unrenderable pages) so manual time is never spent
on a build that could not even boot.

- [ ] P1. `node --check main.js pages.js preload.js tab-preload.js` — exits clean; no syntax errors in any delivered file.
- [ ] P2. `package.json` parses as strict JSON; `version`, `author.name`, `author.url`, `organization.name`, `organization.url` are all present and non-empty.
- [ ] P3. Every internal page generator requires cleanly from `pages.js` and returns a non-empty HTML document: new tab, bookmarks, history, settings, downloads, about, apps, performance, and error pages (a sample DNS error).
- [ ] P4. The bookmarks and history pages contain the "Export JSON" / "Import JSON" buttons wired to `internalAPI.exportData` / `importData`; the new tab page contains the tiles grid and its `openInTab` wiring.
- [ ] P5. The About page contains the Developer link (`github.com/whitedragon303`) and the Organization link (`github.com/whitedragon-software`), and every credit anchor carries `data-ext` (the open-inside-Daybreak click wiring).
- [ ] P6. IPC cross-check: every `ipcRenderer.invoke(...)` / `send(...)` channel used by `preload.js` and `tab-preload.js` has a matching `ipcMain.handle(...)` or `ipcMain.on(...)` in `main.js` — the exact bug class that once left the list pages stuck on "Loading…" forever.
- [ ] P7. Bridge cross-check: every `window.internalAPI.x(...)` call inside the generated pages is exposed by `tab-preload.js`, and every `window.api.x(...)` call in `index.html` is exposed by `preload.js`.
- [ ] P8. Defaults and handlers are in place: `settings.json` defaults include the New Tab tile preferences (`hiddenTiles`, `tileOrder`), and `main.js` registers `data:export`, `data:import`, `tiles:hide`, `tiles:restore`, `tiles:order`.
- [ ] P9. Structure check: bookmarks, history, downloads, apps, performance, about, view-source and the error pages all render the shared sidebar (search box where there is a list to filter, page links, section cards); Settings renders its own section sidebar; the New Tab page and `2FA.html` contain no sidebar markup.

---

## 1. Launch and window frame (W)

- [ ] W1. Launch the app — frameless white window, one new-tab tab open, tab strip above the address bar, bookmarks bar per saved setting.
- [ ] W2. Drag empty tab-row space — window follows the cursor 1:1 with no drift or resize; release leaves it exactly where dropped.
- [ ] W3. Resize from any OS edge/corner — toolbar and page reflow, no dead strips.
- [ ] W4. Minimize and restore — views come back correctly sized (layout re-runs).
- [ ] W5. Open a second normal window — tabs, sessions and UI state fully separate; closing it leaves the first untouched.

## 2. Tabs (T)

- [ ] T1. `Ctrl+T` opens a tab that is active immediately.
- [ ] T2. Switch tabs — instant; background tabs keep scroll position and keep running.
- [ ] T3. `Ctrl+W` and middle-click both close a tab; the neighbor becomes active.
- [ ] T4. Drag a tab within its group — live reorder; order persists **restart**.
- [ ] T5. Pin a tab — joins the pinned group on the left; pinned and unpinned never mix when reordering.
- [ ] T6. `Ctrl+Shift+D` duplicates the active tab at the same URL.
- [ ] T7. `Ctrl+Shift+M` mutes a playing tab (audio stops, icon shows); again unmutes.
- [ ] T8. Open more tabs than fit and wheel-scroll the strip; a newly opened tab scrolls into view.
- [ ] T9. `Ctrl+Shift+T` reopens the last closed tab at its last URL; 25-entry memory holds several in a row.
- [ ] T10. Right-click a tab — menu items (close, close others, pin, mute, duplicate) all act on the right tab.

## 3. Address bar and navigation (NAV)

- [ ] N1. Type a URL (`example.com`) and press Enter — resolves to `https://example.com` and loads.
- [ ] N2. Type plain words — goes through the configured search engine.
- [ ] N3. `Ctrl+L` focuses the address bar with the current URL selected; typing replaces it.
- [ ] N4. Back (`Alt+Left`) and forward (`Alt+Right`) — per-tab history, never crosses into other tabs.
- [ ] N5. Toolbar Reload / `Ctrl+R` reloads the committed URL, not a pending one.
- [ ] N6. The address bar always shows the current page's URL, including after a failed load (see section 8).
- [ ] N7. Typing a `daybreak://` page name in the address bar opens that internal page.

## 4. Bookmarks bar (B)

- [ ] B1. Star a page (`Ctrl+D`) — chip appears on the bar and the star fills; unstarring removes it everywhere immediately.
- [ ] B2. Chip with a very long title caps at 200px and ellipsizes; hovering shows the full URL; the bar stays usable.
- [ ] B3. Left click navigates the current tab; middle click or `Ctrl/Cmd+click` opens a background tab (new tab if no tab is active).
- [ ] B4. Right-click a chip — Open in new tab / Open in background tab / Edit bookmark… / Delete all work.
- [ ] B5. Drag a chip sideways past the threshold — bar reorders live; order persists **restart**.
- [ ] B6. Edit bookmark… — dialog anchors under the chip; URL resolves like the address bar; emptied name falls back to the URL; `Enter` saves, `Escape` cancels.
- [ ] B7. Toggle "Show bookmarks bar" in the menu — applies to every open window at once; survives **restart**.

## 5. New Tab tiles (NT)

- [ ] M1. With bookmarks saved, the New Tab page renders up to 9 tiles from the newest bookmarks.
- [ ] M2. Left click opens the site in the current tab; middle click or `Ctrl/Cmd+click` opens a background tab without stealing focus.
- [ ] M3. Right-click a tile — Open / Open in background tab / Edit tile… / Hide from New Tab all work.
- [ ] M4. Edit tile… — same conventions as the bookmark editor; the bar chip and star state update with it (single source of truth).
- [ ] M5. Hide a tile — it leaves the grid but the bookmark stays; a "Show hidden tiles (N)" control appears and restores them all.
- [ ] M6. Drag a tile to a new position; order persists in `settings.json` **restart** and never changes bookmarks-bar order.
- [ ] M7. Delete a bookmark that owned a tile — the tile's preferences are pruned; no ghost tiles.
- [ ] M8. Edit a bookmark's URL — its tile keeps its place in the grid (preferences carried over to the new URL).

## 6. Internal pages and data (IP)

- [ ] I1. `daybreak://history`, `daybreak://downloads`, `daybreak://settings`, `daybreak://about`, `daybreak://apps` each open as a NEW tab and render real data immediately.
- [ ] I2. Bookmarks / history / downloads lists render their rows instantly (never stuck on "Loading…"); empty lists show their "No … yet" state.
- [ ] I3. Browse a few sites, reopen the history page — new rows appear newest-first with sane timestamps.
- [ ] I4. Remove a single history row and "Clear browsing data" — both update the list at once.
- [ ] I5. Security: bookmark a page whose title is `<img src=x onerror=alert(1)>` — the bookmarks page and the tiles grid render it as plain text; nothing executes (these pages run with the privileged bridge).
- [ ] I6. Dark mode re-themes every internal page instantly; ordinary websites are unaffected.
- [ ] I7. Every internal page except New Tab and the 2FA app shows the shared left sidebar — the Daybreak mark, a search box (on pages with a list to filter), one link per page with the current page highlighted — with its content as section cards, and every sidebar link navigates inside Daybreak.

## 7. Export / import JSON (EI)

- [ ] E1. On `daybreak://bookmarks`, "Export JSON" opens a native save dialog proposing `daybreak-bookmarks-<date>.json`; the saved file is pretty-printed `{ app: "daybreak", kind, version, exportedAt, count, items: [...] }`.
- [ ] E2. Import the file just exported — toast reports 0 imported, one skipped per bookmark; nothing changed.
- [ ] E3. Hand-edit the file: one item gets a new URL, one gets a `daybreak://` URL, one a search string — import appends only the new URL; internal pages and junk rows are skipped, bare domains resolve like the address bar.
- [ ] E4. A bare array file (`[ {...}, ... ]` with no wrapper) also imports.
- [ ] E5. A corrupt / non-JSON file shows an error toast instead of crashing or corrupting the store.
- [ ] E6. On `daybreak://history`, export and re-import — everything skips as duplicates; rows with a new URL+timestamp merge chronologically under the 5000-entry ceiling.
- [ ] E7. Bookmarks import dedupes by URL (no second copy of an existing bookmark).

## 8. Error pages (EP)

- [ ] R1. Dead domain (`https://no-such-host-zzz.invalid`) — "This site can't be reached" with `net::ERR_NAME_NOT_RESOLVED`; address bar keeps the failed URL.
- [ ] R2. Black-hole address (`http://10.255.255.1`) — "…took too long to respond" once the connection times out.
- [ ] R3. Refused connection (a closed local port, e.g. `http://localhost:9`) — "refused to connect" page.
- [ ] R4. Machine offline (disable networking) — "No internet connection" page.
- [ ] R5. Retry paths on an error page — page Reload, `Ctrl+R`, toolbar reload, context-menu reload and Enter all retry the failed URL (fails again → same page, no blank flash); Escape goes back.
- [ ] R6. "Go back" — the page button, toolbar Back and `Alt+Left` all land on the last page that actually loaded (never a repeat error page or a blank tab).
- [ ] R7. As the very first action in a fresh tab, load an unreachable URL — error page shows with NO "Go back" button; Reload still works.
- [ ] R8. `https://self-signed.badssl.com` — "Your connection is not private"; Details → "Proceed to … (unsafe)" loads the site; after **restart** the exception is gone (warning returns).
- [ ] R9. A TLS protocol error offers no bypass at all.
- [ ] R10. An error page in a private window renders and its retry/back paths work there too.
- [ ] R11. Error pages never enter history: after back-to-safety, Back does not step onto an error page.

## 9. Private windows (PV)

- [ ] V1. `Ctrl+Shift+N` — separate window, dark toolbar in both themes, "Private" badge in the tab row.
- [ ] V2. Visit sites, then check `daybreak://history` from a normal window — nothing recorded; reopen list unaffected.
- [ ] V3. Log into a site in a private window, close it — a new private window starts logged out (in-memory partition wiped on last close).
- [ ] V4. Download something in a private window — it shows on the downloads page for that session but never lands in `downloads.json`.
- [ ] V5. Internal pages and the ad blocker work identically inside private windows.
- [ ] V6. `Ctrl+Shift+T` inside a private window is a deliberate no-op.
- [ ] V7. Private and normal windows side by side — switching never mixes tabs or UI state.

## 10. Downloads (DL)

- [ ] D1. Download a real file — row appears with progress, then completion state.
- [ ] D2. Open and "Show in folder" both act on the right file.
- [ ] D3. Clear list — page empties; files on disk are untouched.
- [ ] D4. Downloads survive **restart** (capped at 500 entries).

## 11. Find bar (FB)

- [ ] F1. `Ctrl+F` opens the bar; typing highlights matches live with a count.
- [ ] F2. Enter / Shift+Enter / the Next and Previous buttons cycle matches.
- [ ] F3. Clicking the page does NOT close the find bar (deliberate); `Escape` closes it and clears highlights.
- [ ] F4. While open, the page is not covered by the toolbar overlay (reserved space is kept).

## 12. Zoom and view source (ZV)

- [ ] Z1. `Ctrl+=` / `Ctrl+-` / `Ctrl+0` zoom in, out, reset for the current tab.
- [ ] Z2. Zoom is per-tab: zooming one tab does not change others.
- [ ] Z3. `Ctrl+U` — view-source page shows the page's HTML escaped as plain text, with the source URL as its title.

## 13. Memory Saver (MS)

- [ ] S1. Enable in Settings; leave a background tab idle 20 minutes, then click it — it revives with its title, URL and strip position, reloading on demand.
- [ ] S2. Active tab, pinned tabs and tabs playing audio are never discarded.
- [ ] S3. A private background tab discards and revives just as safely, inside the same in-memory partition (nothing touches disk).
- [ ] S4. An error-page tab that gets discarded revives by retrying the failed URL (shows the error page again if it still fails).
- [ ] S5. Setting persists across **restart**.

## 14. Performance page (PF)

- [ ] X1. `daybreak://performance` lists every process with memory and CPU use.
- [ ] X2. Processes belonging to tabs are labelled with that tab's title and URL.

## 15. Ad blocker (AB)

- [ ] A1. Toggle off/on on a page with ads — visible difference in blocked requests; setting persists across **restart**.
- [ ] A2. Navigate straight to a block-listed host — "This page has been blocked" page names the ad blocker and points at Settings.
- [ ] A3. A popup ad's `window.open` is denied — no separate ad window appears.
- [ ] A4. A NON-ad `window.open` (e.g. a legit new tab link) opens as a normal Daybreak tab, not a native window.
- [ ] A5. Blocking is active in private windows too.

## 16. Apps hub and Authenticator (APP)

- [ ] AP1. The Apps hub (`daybreak://apps`, from the new tab or the main menu) lists the bundled tools.
- [ ] AP2. The Authenticator (`daybreak://2FA`) opens and works fully offline; codes survive **restart** (localStorage).

## 17. Settings and persistence (ST)

The page is organized as a fixed left navigation (search box on top, one
link per section) next to a scrolling column of section cards: Appearance,
Search engine, On startup, Downloads, Privacy and security, Performance,
About Daybreak.

- [ ] G1. Every setting (theme, homepage, search engine, bookmarks bar, ad blocker, Memory Saver) persists across **restart**.
- [ ] G2. Homepage change (Settings → On startup) — new tabs and new windows open on it; the Reset button returns it to `daybreak://newtab`.
- [ ] G3. Search engine change (Settings → Search engine radio list) — plain-word address-bar entries go to the new engine.
- [ ] G4. Theme change re-themes the overlay and all internal pages immediately, in every open window.
- [ ] G5. Tile preferences live in `settings.json` and survive **restart** (with M5/M6).
- [ ] G6. Settings search filters as you type: non-matching rows hide, empty sections collapse, a "No settings match your search" state appears when nothing matches; clearing the box or pressing `Escape` restores everything.
- [ ] G7. Sidebar links highlight the section currently in view while scrolling and smooth-scroll to their section on click.
- [ ] G8. There is no Save button — flipping a toggle, picking an engine or editing the homepage applies at once in every open window and survives **restart**; a failed save shows a toast instead of failing silently.
- [ ] G9. The destructive rows (Delete browsing history, Clear list under Downloads) ask for confirmation first, then update the History / Downloads pages; "Open page" opens `daybreak://downloads` as a new tab inside Daybreak.
- [ ] G10. The About Daybreak section shows the real version and Electron / Chromium / Node lines, and the developer / organization / source-code links match the size of the surrounding text and open inside Daybreak only (the source-code link is labeled "Daybreak", same URL as before).

## 18. Menus and floating UI (MENU)

- [ ] U1. Main menu (⋮) renders fully on-screen on any window height; on a very flat window it scrolls internally instead of clipping.
- [ ] U2. With any floating menu open, clicking the page closes it and leaves no dead unclickable strip.
- [ ] U3. The find bar survives page clicks (see F3) while its reserved space is kept.
- [ ] U4. Menus opened near the right window edge flip back inside instead of appearing half off-screen.
- [ ] U5. The bookmark editor and tile editor dialogs anchor under their chip/tile, not at a guessed position.
- [ ] U6. Right-clicking page content shows the native context menu (copy, link actions…).

## 19. About page and credits (ABOUT)

- [ ] C1. `daybreak://about` (menu → About Daybreak, or typed URL) shows the version line and the Electron / Chromium / Node versions it really runs on.
- [ ] C2. The page lists **Developer: WhiteDragon303** and **Organization: WhiteDragon Software**, plus the source-code row (the link is labeled "Daybreak" and points at `github.com/whitedragon-software/daybreak`).
- [ ] C3. Clicking the developer name opens `github.com/whitedragon303` as a NEW tab inside Daybreak — never the OS default browser.
- [ ] C4. Clicking the organization name opens `github.com/whitedragon-software` the same way.
- [ ] C5. Middle click or `Ctrl/Cmd+click` on either credit opens it in a background tab, matching chips and tiles.
- [ ] C6. Credit links are styled in the accent color, match the size of the surrounding text, carry the URL as a tooltip, and work in both light and dark themes.
- [ ] C7. The credits match `package.json`: the page reads `author` / `organization` from the package metadata, so renaming there updates the page.
- [ ] C8. Everything on the About page stays inside Daybreak — no link on it ever hands a URL to the OS.

## 20. Keyboard shortcuts (KB)

- [ ] K1. `Ctrl+T` / `Ctrl+W` / `Ctrl+Shift+T` / `Ctrl+Shift+N` — new tab, close, reopen, new private window.
- [ ] K2. `Ctrl+L` / `Ctrl+F` / `Ctrl+D` / `Ctrl+U` / `Ctrl+R` — address bar, find, bookmark, source, reload.
- [ ] K3. `Ctrl+Shift+D` / `Ctrl+Shift+M` — duplicate, mute.
- [ ] K4. `Ctrl+=` / `Ctrl+-` / `Ctrl+0` — zoom in / out / reset.
- [ ] K5. `Alt+Left` / `Alt+Right` — back / forward (and the error-page "go back" behavior in section 8).

## 21. Session restore (SR)

- [ ] Q1. Quit with several windows/tabs open and relaunch — normal windows and tabs come back.
- [ ] Q2. Private windows and their tabs are never part of session restore.
- [ ] Q3. Last 25 closed tabs remain reopenable after **restart** is not claimed — reopen memory is per-run; verify nothing crashes on relaunch instead.

## 22. Packaging (PKG)

- [ ] PK1. `npm run pack` — unpacked build lands in `dist/` and launches with the same behavior as source.
- [ ] PK2. `npm run dist` — installer for the current platform builds cleanly; the Windows installer's publisher metadata reads **WhiteDragon Software**.
- [ ] PK3. The packaged app keeps its userData (bookmarks, history, settings) between runs of the packaged build.

---

## Test-run log

One line per delivered version. Pre-flight = section 0; Manual = sections
1–22 (run by the user on a desktop). "Regression rows" lists any row that
failed and was fixed before delivery.

| Version | Date | Pre-flight (assistant, terminal) | Manual (desktop) | Regression rows |
|---|---|---|---|---|
| 1.2.0 | 2026-11-18 | PASS — P1–P8 all green (4 files syntax-clean; package.json identity fields OK; all 9 page generators render incl. the rebuilt settings page, About contains both credit links with `data-ext`; IPC + bridge cross-checks clean; tile prefs + export/import handlers registered). GUI rows cannot run in the sandbox — desktop pass pending. | desktop finding on the first try: About page shows "Version 1.2.0 / Electron 45.2.3" and the Developer / Organization / Source code credit rows | C2/C3: the About page rendered "Developer: [object Object]" with no Organization row because the new `package.json` was applied while `pages.js` stayed on the old copy (the old template interpolates the author object raw, and the old page has no credit click wiring). Fixed by delivering `pages.js` in full and hardening the credit script: if the tab bridge lacks the open-tab call, the credit opens in the current tab inside Daybreak instead of doing nothing. Also: an interim version bump to 1.2.1 was reverted — the credits and checklist work ships as part of 1.2.0. Settings redesign re-verified after the rebuild (P3 render + P7 bridge cross-check). |
| 1.2.0 | 2026-11-22 | PASS — P1–P9 all green (4 files syntax-clean; all 9 generators render; P9 confirms the shared sidebar on bookmarks / history / downloads / apps / performance / about / view-source / error, the section sidebar on Settings, and no sidebar on New Tab or `2FA.html`; export/import + tiles wiring intact; About credits present with 3 `data-ext` anchors; IPC + bridge cross-checks clean). Visual spot-check of the rendered pages done in a headless browser (sidebar, cards, search filtering, credit sizing). GUI rows cannot run in the sandbox — desktop pass pending. | desktop pass pending | none — this pass only moved the internal pages (except New Tab and the 2FA app) onto the shared sidebar structure, sized the About credit rows to the surrounding text, relabeled the source-code link "Daybreak", and condensed the 1.2.0 changelog; preflight was extended with the P9 structure check. |
