# Step 2.9.1 — History, Most Played and listening statistics

## Result

- The navigation entry is now **History**, in its existing position after
  Favorites, with session-preserved **Recent / Most Played / Stats** segments.
- Recent keeps the Step 2.9 retention, grouping, duplicate aggregation,
  unavailable state, contextual playback, removal and separate confirmed
  Clear behavior.
- The Queue drawer is intentionally less cluttered: Track Favorite hearts and
  overflow menus were removed only from this drawer, while Play, Remove,
  artwork, stable rows and touch geometry remain. Drawer-only text is slightly
  smaller.

## Schema and tracking

- Library schema v6 adds strict `track_play_stats`, keyed by the Track foreign
  key with definitive-delete cascade and a deterministic
  `(play_count DESC, last_played_at DESC, track_id ASC)` ranking index.
- Migrations v1/v2/v3/v4/v5 through v6 are transactional. History is not
  backfilled, so all-time statistics begin at zero.
- The existing single tracker records one play per qualified transition at
  `min(30 seconds, 50% duration)`, or 30 real seconds for unknown duration.
  Consecutive transitions count separately even when Recent aggregates them.
- Real listened seconds already accumulated before qualification are included;
  bounded writes occur at qualification, completion and finalization. Pause,
  seek and anomalous deltas remain excluded. Completion is counted once at 90%
  or natural end.

## Most Played, Stats and API

- Most Played uses bounded keyset pagination, a 192-row UI bound, full backend
  ranking context, direct selected index, single-Track Add, shared Favorite
  state, and visible but non-playable unavailable rows.
- Stats aggregates Listening time, Qualified plays, Completed plays, Unique
  tracks, Tracking since and Last listened without materializing Track rows in
  the UI. Its confirmed red reset deletes only statistics; Recent Clear deletes
  only Recent.
- Added typed endpoints:
  - `GET /api/library/history/most-played`
  - `POST /api/library/history/most-played/play`
  - `GET /api/library/history/stats`
  - `DELETE /api/library/history/stats`
- `statsRevision` extends the existing Library snapshot/SSE. It changes only on
  bounded meaningful stats writes or reset; no polling, timer or second stream
  was added.

## Toast correction

- Reproduction showed two independent causes: hidden normal/progress toast
  nodes still occupied 170 px in the host, and the mini-player offset was
  applied even on Default Now Playing where no mini-player exists.
- Hidden toasts now use `display: none`. An explicit root class applies the
  mini-player offset only while it is mounted; otherwise the host uses the
  normal bottom gap. The single fixed viewport host grows upward.
- Progress, normal dismissal, coalescing and the single Library SSE remain.
  The keyboard remains above notifications (`z-index` 80 versus 60).

## Automated verification

- Focused coverage includes v1–v6 migration, zero backfill, ranking/ties,
  keyset pagination, aggregate dates/counts/time, reset idempotence, Track
  cascade, tracker thresholds, consecutive transitions, completion and full
  Most Played context/direct index.
- UI regression coverage checks History segments/revisions, Queue drawer
  cleanup, one bottom toast host, explicit mini-player state and hidden-toast
  layout removal.
- Final suite passed: `format:check`, `typecheck`, `lint`, production `build`,
  `git diff --check`, and 340 tests (338 passed, 2 platform skips, 0 failed).

## Real Neutralino/WebView2 QA

- Ran `npm.cmd run dev` with an isolated config/data profile and a read-only
  existing media source. No user media or normal Eidetic state was changed.
- At 1280×800, 1280×720 and 1024×600: History showed all three segments,
  defaulted to Recent, retained the chosen segment, and had no horizontal
  overflow. Empty Most Played and all six zero Stats values rendered correctly.
- Two consecutive qualified plays of Bittersweet Symphony produced
  `play_count = 2`, one aggregated Recent row, one completion and bounded real
  listening seconds. A non-first Most Played row started directly at index 1;
  full context and single-Track Add were verified.
- Stats reset preserved two Recent rows; a later Recent Clear preserved the new
  qualified statistic. Source removal retained Stats and the Most Played row,
  with Play/Add disabled and Favorite still available.
- Normal toast: bottom 680 at 1280×800 with the 120 px mini-player offset.
  Default Now Playing progress toast: bottom 788 with a 12 px app-bottom gap.
  Cassette: mini-player present and toast bottom 680. Dismiss worked.
- With the on-screen keyboard open, the toast stayed bottom-anchored while the
  keyboard remained the interactive overlay at z-index 80 above toast z-index 60. The simplified Queue drawer contained only Play and Remove row buttons.

## Cleanup and scope

- Isolated QA profile removed; ports 4310/5173/9224 closed; zero residual MPV,
  FFmpeg or Neutralino processes.
- Linux CI remains pending.
- No commit or push was made. No Playlists, Vinyl Player, advanced charts or
  other step was started.
