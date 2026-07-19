# Step 2.4.2 — Bootstrap, session restore and interface behavior

Date: 2026-07-19

## Outcome

Step 2.4.2 is complete without starting Step 2.5. Eidetic Player now has a
real startup barrier, a backend-owned persistent Queue/current-track session,
hierarchical Interface settings, configurable Folders/Library visibility,
automatic return to Now Playing, corrected Folders root controls, resilient
artwork loading, and a bounded visualizer snapshot for paused remounts.

## Bootstrap and splash

- `index.html` contains the immediate dark splash, so no empty or white frame
  precedes JavaScript.
- The splash contains no logo: it presents a large `Eidetic Player` title and
  an animated loading line underneath.
- `GET /api/bootstrap` waits for MPV initialization and session restore.
- The splash remains for at least 700 ms, has a 5 s safety timeout, and fades
  for at most 160 ms.
- Animations Off and `prefers-reduced-motion` remove the fade.
- The shell mounts once with bootstrap state instead of mounting disconnected
  and replacing the player state afterward.

## Persistent player session

- Added versioned `PlayerSessionRepository` and `PlayerSessionService`.
- Writes are atomic, structurally debounced (120 ms), and flushed before
  player shutdown.
- Folders items persist source ID plus logical relative path; direct-open items
  keep native paths only in the backend configuration file.
- Queue IDs, order, current item, filename, and display title are retained.
  Position, paused/playing state, metadata cache, and analysis data are not.
- Restore validates every file. Missing secondary entries are discarded.
  Missing current invalidates the whole session and never selects a fallback.
- A valid session loads the saved current item at position zero and paused.
- Corrupt/unsupported JSON is preserved as a timestamped corrupt copy and
  safely ignored.

## Interface

- Settings is hierarchical: Settings → Interface → dedicated selection
  screens for Music browsing, Visualizer, and Return to Now Playing.
- Inline segmented controls are retained only for the two-choice timeline.
- Music browsing supports Folders, Library, or Both and applies immediately to
  the side menu and Now Playing shortcuts. Sources is never hidden.
- Hiding the active Folders/Library screen redirects to the remaining section.
- Return to Now Playing supports Never, 10, 30, 60, and 120 seconds.
- Activity resets the timer. Overlays, editable fields, native dialogs, drag
  overlay, and Settings selection sub-screens suspend it. Timeout closes
  transient overlays and navigates only; playback is unchanged.

## Folders, artwork and visualizer

- Sorting and List/Grid now appear only at Folders root.
- Sorting uses a custom popup menu; directory screens keep only Back/title and
  Play.
- Breadcrumb markup is hidden when it has no useful ancestor.
- Play actions launched in Folders remain in Folders.
- Artwork loading now performs one controlled retry after a transient image
  error. Taylor Swift test files were confirmed to have valid identical
  embedded JPEG artwork, with successful metadata and artwork HTTP responses;
  the defect was therefore in transient UI loading rather than parsing.
- Visualizer samples survive route remount in a bounded module-level store
  keyed by Queue item, transition generation, and mode, while each mounted
  component still owns at most one EventSource and one `requestAnimationFrame`.

## Verification

- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed.
- `npm.cmd test`: passed, 144/144 tests.
- `npm.cmd run build`: passed.
- Real runtime started with `npm.cmd run dev`.
- Runtime bootstrap endpoint: passed.
- Real Folders open created a 14-item Queue with logical origins.
- Backend hot restart restored all 14 items, current index 2, paused, at
  approximately zero seconds; a fresh Open request then returned 200.
- Taylor artwork endpoint and metadata checks returned valid JPEG artwork for
  all 14 visible album entries.

Browser-client automation was unavailable in this environment, so no claim is
made for automated click/focus screenshots. Runtime API, native process,
compile, lint, unit/integration, and production build checks were completed.
