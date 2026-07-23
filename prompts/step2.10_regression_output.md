# Step 2.10-R — Playlist UI and drag reorder corrections

## Scope and baseline

- Continued on the intentional uncommitted Step 2.10 working tree on `main`.
- Baseline checks completed: branch, status, diff check/stat, Node
  `v24.18.0`, and npm `11.16.0`.
- No database migration, Queue model, `PlayerService`, MPV, player surface,
  toast, or on-screen keyboard package was changed.

## Reproduced problems and causes

Real Neutralino/WebView2 screenshots reproduced:

- New Playlist icon and text split across two lines because the action had no
  explicit inline row layout.
- Playlist detail used only the Playlist name as the global title, kept its
  actions on the left, and used the ambiguous `Add to Queue` label.
- Track metadata was pushed toward the row center by competing flex and grid
  rules.
- The picker grew to every Playlist row.
- Create/Rename reused the source-dialog classes visually but lacked a complete
  shared focus/Escape implementation.
- Playlist reorder activated without a threshold, had no placeholder, tried to
  scroll the non-scrollable `ol`, and rebuilt the detail after persistence.

## Corrections

- The Playlist page keeps the global `Playlists` title only. Its content header
  follows Sources: description left and inline `+ New Playlist` action right.
  The action cannot shrink or wrap.
- Added one canonical i18n key for `Add to Playlist` and applied it to Library,
  Search/detail rows, Favorites, History, Playlist detail, Queue drawer, and
  the picker.
- Detail title is `Playlists / <name>`. The existing top-bar ellipsis remains
  single-line and its `title` attribute exposes the complete name.
- Detail summary (Track count and available duration) stays left. Non-wrapping
  `Play all` and `Add Playlist to Queue` actions stay right and retain touch
  targets at all supported viewports.
- The picker sorts by `updatedAt DESC`, then Playlist ID. It has a natural
  height for 1–3 rows and an internal 190 px/three-row touch-scroll region
  beyond that. Create New Playlist remains in the fixed footer.
- Create and Rename now use one shared component built from the approved
  `source-dialog` primitive, including backdrop, geometry, inline error, focus
  trap/restoration, Escape, and the existing keyboard contract. At 1024×600
  the keyboard-open dialog stays below the global top bar with title and
  actions visible.
- Playlist Track rows reserve stable handle, artwork, metadata, duration,
  Favorite, and menu geometry. Title/artist/album share a left axis, artwork
  cannot compress, and long text ellipsizes. Favorite button/icon centers match
  the row center exactly (measured delta: 0 px).

## Drag diagnosis and fix

- Drag starts only from the labelled handle after an 8 px movement threshold.
- Pointer Capture remains on the handle.
- Activation creates a same-height placeholder and a fixed, clearly identified
  dragged row.
- Drop position is calculated from visible row midpoints in viewport
  coordinates and recalculated while scrolling.
- A single requestAnimationFrame autoscroll loop moves the real
  `.screen-region` near its top/bottom edges.
- No backend request occurs during pointer movement or a rapid handle tap.
- Drop sends one reorder request only when order changed.
- Success keeps the keyed DOM and current scroll instead of rerendering.
- Error/cancel restores the original nodes and scroll. Cleanup releases Pointer
  Capture, listeners, placeholder, and RAF.
- The initial Playlist-only correction left Queue reorder unchanged; the
  follow-up regression pass below brings Queue reorder to the same robust
  pointer contract.

## Real QA

Neutralino/WebView2 was inspected at:

- 1280×800;
- 1280×720;
- 1024×600.

Verified:

- Playlist list and populated detail layout;
- long-title ellipsis plus complete accessible title;
- picker with 7 Playlist rows and internal three-row scrollbar;
- picker with one Playlist row and no scrollbar;
- Create and Rename dialog geometry;
- duplicate-name inline error;
- Create New Playlist from the picker, including adding the selected Track;
- keyboard-open dialog at 1280×800 and 1024×600;
- first Track to middle;
- middle Track to bottom with downward autoscroll;
- last Track to first with upward autoscroll;
- drag while scrolled;
- cancel rollback;
- rapid handle tap with zero persistence;
- order persisted after closing and reopening detail;
- one reorder request per successful drop at all three viewports;
- stable Playlist item IDs.

The player session remained unchanged throughout reorder QA:
`playerSessionId`, Queue revision `1`, current Queue index `4`, Queue length
`10`, paused state, and current Track `Take a Bow` were preserved.

## Tests and non-regressions

- Focused Step 2.10 tests cover labels, title/ellipsis contract, toolbar,
  three-row picker, shared dialog, row geometry, centered Favorite, threshold,
  midpoint placement, real scroll container, autoscroll, one-drop persistence,
  rollback, stable DOM, and unchanged Queue reorder contract.
- Final commands:
  - `npm.cmd run format:check`
  - `npm.cmd run typecheck`
  - `npm.cmd run lint`
  - `npm.cmd run build`
  - `npm.cmd test`
  - `git diff --check`
- Full suite result: 349 tests, 347 passed, 2 platform-specific tests skipped,
  0 failed.
- Real application shutdown was checked for residual project processes and
  listeners.

## Cleanup and remaining platform gate

- All temporary QA Playlists and Track membership were removed. The original
  `Test` Playlist remains unchanged.
- Temporary before/after screenshots were removed.
- User database, Queue, current item, and playback session were preserved.
- Linux CI remains pending because no commit or push was requested.
- No commit or push was performed.

## Follow-up regression corrections

The additional Step 2.10 regressions reported after the first pass were
reproduced and corrected:

- Playlist list: added the missing vertical separation below the page header,
  so `New Playlist` no longer overlaps the first Playlist row.
- Playlists now uses the same centered 76 rem screen boundary as Settings.
  Within it, `New Playlist`, the Playlist rows, and Playlist detail use the
  complete available width and terminate on the same right edge.
- Playlist overview and detail rows now reuse the Library list visual
  language for borders, backgrounds, and spacing: one continuous list with
  horizontal outer borders, zero inter-row gap, divider-only rows, square
  corners, transparent row backgrounds, and Library-aligned internal padding.
  Playlist content, typography, artwork, controls, and drag behavior were not
  changed. Favorites and History were intentionally left unchanged.
- Playlist overview rows now use the Library list's `5.5rem` minimum row
  height. Track rows inside a Playlist retain their existing compact height.
- Playlist detail: `Add Playlist to Queue` is now an explicit grey secondary
  action. A successful request shows the shared success toast with the actual
  appended Track count, for example `2 tracks added to Queue.` Errors still
  use the existing shared failure path.
- History: `Recent`, `Most Played`, and `Stats` now share the header row with
  `Your listening history and statistics.` and are right-aligned. At
  1280 x 800 the description and segmented control centers measured exactly
  136 px, a 0 px vertical delta.
- Favorites: the segmented pills moved into the header immediately to the
  left of `Play all`. Their measured gap is 12 px and both controls share the
  same 136 px vertical center.
- Library Albums: the Favorite heart is hidden only in Album grid mode; Album
  list mode and the Favorites surfaces retain their existing heart actions.
  The grid card text padding was reclaimed for the remaining overflow action.
- Queue drawer: reduced row padding and gaps, reserved only 1.5 rem for the
  Track number, and reduced drawer-only title/filename typography. Artwork,
  remove action, and minimum touch target behavior remain unchanged.

### Queue reorder follow-up

- Replaced the former immediate DOM swap with the robust Playlist pointer
  method: 8 px activation threshold, Pointer Capture, same-height
  placeholder, fixed dragged row, midpoint drop calculation, and one
  requestAnimationFrame autoscroll loop on the real `.queue-list`.
- A tap on the handle performs no reorder request.
- Drop persists once only when the index changes.
- Cancel, drawer close, structural state update, destroy, and request failure
  all clean up listeners, Pointer Capture, RAF, placeholder, styles, and
  restore the original DOM order and scroll where applicable.
- Keyed Queue rows remain intact; playback-position and visualizer ticks still
  do not rebuild the Queue.

### Follow-up real QA

Using `npm.cmd run dev`, Neutralino/WebView2 was inspected at 1280 x 800.
Verified the Playlist list spacing, grey detail action, success toast,
History/Favorites alignment, Library Album grid, and compact Queue layout.
The later Playlist visual-uniformity pass inspected both overview and populated
detail: computed styles matched the Library list contract (`gap: 0`, 1 px
outer horizontal borders, divider-only rows, `border-radius: 0`, and
transparent row backgrounds).

The real Queue path was exercised by dragging the first item to index 2:
Queue revision advanced exactly once and the visible/backend order became
`02. Like a Pastime`, `03. Another Celebration...`, `01. Right_`. A second
real drag restored the original order and preserved the paused current Track
and current Queue index. The Playlist-to-Queue toast test appended two Tracks;
both generated Queue items were then removed, restoring the original
12-item Queue.

Focused Step 2.10 tests now also cover the header geometry, grey Queue action,
success-toast contract, Library Album grid heart removal, compact Queue
columns/type, Queue drag threshold, midpoint placement, autoscroll direction,
single-drop persistence, and rollback cleanup.

Final follow-up validation passed:

- `npm.cmd run format:check`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd test`
- `git diff --check`

Full suite result: 351 tests, 349 passed, 2 platform-specific tests skipped,
0 failed.
