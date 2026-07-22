# Step 2.9 — Recently Played and keyboard Always mode

Date: 2026-07-23

## Result

Step 2.9 is complete. Most Played, Playlist, Vinyl Player, and later steps were
not started.

## Keyboard Always and Settings rule

- The persisted keyboard policy now supports Auto, Always, and Off. Auto opens
  only for touch/pen; Always also opens eligible opted-in fields from mouse or
  physical-keyboard focus; Off suppresses automatic opening. Disabled,
  readonly, hidden, and password fields remain ineligible.
- `preferNativeKeyboard=true` remains the highest-priority package policy and
  suppresses the internal overlay in every mode.
- Following visual steering, the three choices are on the standard Settings
  selection sub-screen. Interface shows one On-screen keyboard summary row,
  current value, and chevron; selection persists immediately and returns to
  Interface.
- The UI and testing guides now make the general rule explicit: booleans and
  two-choice settings may use inline pills; every setting with three or more
  choices must use a summary row and dedicated selection sub-screen.

## Schema, tracking, and retention

- Library schema v5 adds strict `play_history` storage with a cascading Track
  foreign key plus `(played_at DESC, id DESC)` and `track_id` indexes. Upgrades
  from v1, v2, v3, and v4 remain transactional.
- One tracker consumes the existing Player subscription and natural-end/seek
  hooks. It creates no poll, timer, MPV query, Queue mutation, revision tick, or
  extra EventSource.
- A stable indexed Track transition is recorded at
  `min(30 seconds, 50% duration)`; unknown/invalid duration requires 30 seconds
  of real playback. Only bounded forward playback deltas count. Pause,
  buffering/no advance, explicit seek, anomalous sleep-sized gaps, and
  non-indexed Queue entries do not count.
- The same event becomes completed at 90% or natural end. Completion and final
  played seconds update the existing event rather than creating another.
- Consecutive occurrences of the same Track update the newest event; an
  intervening recorded Track causes a new event. Each event write prunes older
  than 90 days first, then retains the newest 500.

## API and Recently Played UI

- Added typed bounded list, event Remove, confirmed collection Clear, and
  contextual Play endpoints. Responses expose opaque IDs and minimal Track
  metadata, never native paths.
- Recently Played appears immediately after Favorites and follows Library,
  Favorites, and Recently Played visibility together for Folders only, Library
  only, and Both.
- The screen has no Search or segmented control. It uses the established Track
  rows, one keyset sentinel, a 192-node cap, preserved session scroll, local
  Today/Yesterday/full-date groups, Favorite hearts, contextual actions, and a
  centered red Clear history action inside the scroll.
- Unavailable events remain visible, favoritable, and removable while Play and
  Add are disabled. Remove and Clear do not mutate Queue, current Track, or
  Favorites. The exact empty state is shown after Clear.
- Contextual Play reads the complete database history, keeps the newest
  occurrence per Track ID, excludes unavailable Tracks, and starts the selected
  index directly in one atomic Queue replacement. Add to Queue appends only one
  Track.
- Meaningful mutations increment `historyRevision` on the existing Library SSE
  snapshot. The mounted screen performs a bounded refresh without blanking its
  current content; ordinary Player ticks do not refetch it.

## Tests and real QA

Focused tests cover migrations and upgrade paths, indexes/FK, cursors,
retention, unavailable/cascade behavior, every threshold form, pause, seek,
anomalous deltas, completion, transition uniqueness, consecutive and
non-consecutive duplicates, full contextual resolution, direct selected index,
keyboard policy/persistence/eligibility, drawer visibility, grouping, bounded
UI, Add, Favorite, Remove, Clear, empty state, unavailable state, and reuse of
the existing SSE.

The real `npm.cmd run dev` Neutralino/WebView2 path used an isolated profile and
generated WAV fixtures outside the repository. It verified:

- Auto touch opening, Auto mouse suppression, Always mouse opening, Off, and
  the corrected keyboard selection sub-screen;
- 50% threshold on a 12-second Track, pause exclusion, explicit forward seek
  exclusion, rapid skip exclusion, 90%/natural completion, consecutive update,
  and a new occurrence after an intervening Track;
- complete history playback as `Delta, Epsilon, Gamma, Alpha` with Alpha
  selected directly at index 3 and no transient index-zero start;
- Today/Yesterday rendering in the real app, with older full-date grouping
  covered by the deterministic UI test;
- single-Track Add preserving current playback, Favorite synchronization,
  event Remove, confirmed Clear, exact empty state, and Queue/Favorite
  preservation;
- Source removal retaining six unavailable history rows with Play disabled and
  Favorite/Remove still enabled;
- Folders only, Library only, and Both drawer visibility;
- Default, Cassette, mini-player, Queue, Favorites, and the keyboard at exact
  1280 x 800, 1280 x 720, and 1024 x 600 viewports, with no horizontal
  overflow or visual regression.

After normal app exit, the development coordinator logged graceful backend
shutdown. Its remaining WebView2/Neutralino processes were stopped by exact PID.
Ports 4310/5173/9223, MPV, FFmpeg, Neutralino, Vite, backend, and fixture files
were all absent afterward. The isolated database reported `integrity_check=ok`,
schema version 5, and zero events after the tested Clear operation. No user
Library, configuration, or media was read or modified.

## Final checks

- `npm.cmd run format:check` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 335 tests, 333 passed and 2 platform skips.
- `git diff --check` passed.

MPV/FFmpeg doctor and integration suites were not run because their process
implementations were not changed. Linux CI remains pending. No commit, push,
merge, rebase, reset, restore, stash, or clean was performed.
