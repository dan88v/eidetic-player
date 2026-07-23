# Step 2.10.1 — UI consistency and visual regression audit

## Result

Completed a real Neutralino/WebView2 visual and interaction audit without
adding features. Two concrete visual regressions were found and corrected.

## Surfaces inspected

- Default Player and Cassette Player.
- Library Albums Grid/List, Artists, Tracks, Album/Artist detail, grouped
  Search, View all, and Manage Library.
- Favorites Tracks/Albums/Artists.
- History Recent/Most Played/Stats.
- Playlists overview, detail, row and header menus, picker, Create dialog, and
  Rename dialog.
- Queue drawer rows, current state, scrolling, and footer actions.
- Folders, Sources, Settings, and the Settings selection subpages.
- Shared top bar and Back headers, dialogs, picker, normal/progress toast,
  mini-player, and on-screen keyboard.

## Real defects and corrections

1. `Add Playlist to Queue` had a square outline unlike the canonical secondary
   actions. It now uses the shared `--radius-md` button geometry while retaining
   its approved gray treatment.
2. At 1280 x 720, the open keyboard covered the bottom 16 px of the playlist
   Create/Rename actions. The existing keyboard-aware dialog placement now
   starts at a 45 rem height breakpoint. Cancel/Create end at 358 px while the
   keyboard begins at 460 px. The approved centered 1280 x 800 layout remains
   unchanged.

Canonical comparisons used Sources for introductory rows, Library List/Grid for
collections, Settings for multi-choice subpages, and the shared dialog, Queue,
toast, keyboard, and top-bar primitives for overlays and navigation.

## Files changed

- `AGENTS.md`
- `apps/ui/src/styles/screens.css`
- `apps/ui/test/step2.10.1.test.ts`
- `prompts/step2.10.1_output.md`

`AGENTS.md` now briefly requires every new page to identify its canonical
surface, receive real visual QA, and document intentional visual differences.

## Regression coverage

Added focused, non-pixel contracts for:

- canonical secondary button radius in Playlist detail;
- keyboard-safe playlist dialog placement at reduced heights;
- the permanent canonical-surface and real-QA working agreement.

Final checks:

- `npm.cmd run format:check` — PASS
- `npm.cmd run typecheck` — PASS
- `npm.cmd run lint` — PASS
- `npm.cmd run build` — PASS
- `npm.cmd test` — PASS, 354 tests: 352 passed, 2 expected skips
- `git diff --check` — PASS

No MPV/FFmpeg doctor or audio benchmark command was run because playback and
audio processes were outside this step.

## Real QA and responsive result

The application was started with `npm.cmd run dev` and inspected in the real
Neutralino window before and after the corrections.

- 1280 x 800: all listed main screens and detailed surfaces checked.
- 1280 x 720: critical screens, Playlist detail, Queue, picker, dialog,
  keyboard/toast stacking, Default Player, and Cassette Player checked.
- 1024 x 600: critical screens, Queue, dialog/keyboard, Default Player, and
  Cassette Player checked.

There is no horizontal overflow, essential button wrapping, off-viewport
content, mini-player collision, or unstable overlay width in the checked
states. Keyboard z-index remains above dialog/picker and toast, and the dialog
actions remain usable.

## Non-regressions and cleanup

Playback, Queue/Playlist persistence and reorder logic, Favorites, History,
Search, Sources/scanner, player modes, mini-player, keyboard behavior, toast
dismissal, and visualizer behavior were not changed. Existing functional
contracts passed in the full test suite. Temporary player-mode changes used for
QA were restored to Default, and no Queue, Playlist, Favorite, History, source,
or library data was mutated.

Neutralino was closed through the window shutdown path. Final verification
found zero listeners on ports 4310, 5173, and 9222 and no residual Eidetic
Neutralino, backend, Vite, MPV, FFmpeg, overlay, Pointer Capture, autoscroll RAF,
fixture, or screenshot process/state. All temporary Step 2.10.1 screenshots and
logs were removed.

Linux CI remains pending. No commit, push, merge, rebase, reset, restore, stash,
or clean was performed.
