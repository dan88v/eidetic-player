# Step 2.17.14 output — Playback Context, Explicit Queue and Playback Settings

Date: 2026-08-01

## Status

`READY FOR CI VALIDATION — PLAYBACK CONTEXT NOT DEPLOYED`

## Fifth post-handoff correction — terminal Next guard

The reported empty-track transition was reproduced at the playback-plan
boundary. Manual `Next` and natural MPV EOF both called the same mutating
planner transition. When Current had no forward History, Explicit `Up Next`,
remaining Context, or repeat target, that transition correctly stopped natural
playback but incorrectly cleared Current for a user-initiated `Next` command.

The planner now exposes an authoritative, path-free `canAdvance()` capability.
`PlayerService` caches it only when the structural playback plan changes, so
position SSE ticks do not rescan a large Context. Manual `Next` returns without
touching MPV or Current when the capability is false. A Same-artist boundary
remains available when it has a stable Library identity; if its asynchronous
candidate resolution produces no usable track, the manual command restores
Current instead of entering an empty state. Natural EOF deliberately retains
the existing terminal stop behavior.

The capability is included in the structural local SSE signature and sanitized
Remote player state. The main Now Playing transport, shared mini-player, and
Remote Player all disable their Next button when the backend reports the
terminal boundary. The Remote connection-state updater preserves that command
availability instead of re-enabling Next merely because the connection is
online.

Focused planner and PlayerService regressions cover Context/Explicit capability
changes, the zero-successor manual no-op, empty Same-artist resolution, and the
distinct natural-EOF stop. Local SSE, local transport, Remote projection, and
Remote transport tests cover propagation and presentation.

The exact `npm.cmd run dev` path was exercised with an isolated copy of the
current Windows session. After removing Context, the real state had zero
Explicit entries, no Context, and `canGoNext: false`. Sending the real
`POST /api/player/next` command preserved the playback occurrence ID, title
`Mirror, Mirror`, paused status, and position. The Neutralino/WebView2 client
was visually inspected at its 1280×800 client viewport (1296×839 outer window):
artwork, waveform, metadata, transport geometry, and top bar remained stable,
and Next was visibly disabled. The Remote gateway and Remote UI contract tests
pass; a Remote mobile screenshot could not be captured because no controllable
browser binding was available in this Codex session.

No commit, push, release installation, or Raspberry update was performed.

Fifth post-handoff correction focused checks:

- playback planner and PlayerService integration suites: PASS;
- local SSE and local UI transition suites: PASS;
- Remote gateway and Remote UI isolation suites: PASS;
- `npm run format:check`: PASS;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS, including local UI, Remote UI, backend, production
  Neutralino configuration, and build provenance;
- `npm test`: 766 tests, 754 passed, 12 expected platform/capability skips,
  0 failed;
- `npm run mpv:doctor`: PASS with MPV v0.41.0 headless startup and JSON IPC;
- `npm run test:mpv`: 11/11 PASS;
- `git diff --check`: PASS.

The isolated visual-QA profile and its screenshot were removed. Ports 4310,
5173, and 8080 were clear, and no Neutralino, app Node, MPV, or FFmpeg process
remained. The copied profile kept the real user session and media untouched.

## Fourth post-handoff correction — Queue context action refinement

The local Queue drawer no longer presents an icon-only close cross inside the
`Then continues from` card. The context action is now an explicit `Remove`
button placed to the right of the `Next:` and `tracks remaining` summary. Those
two lines are grouped in one left column with a controlled 4 px internal gap
and use a larger 13 px font. The button retains the required 56 px touch target
while using a restrained red border, tint, and label to communicate removal
without competing with the primary red `Clear Queue` action.

The actual Neutralino/WebView2 application was inspected at the required
1280×800 client viewport. Title/kind, Next, remaining count, and Remove stayed
aligned inside the bounded card without wrapping, clipping, or changing drawer
width. The button was exercised through the real local UI: the playback context
was removed and Current remained unchanged. The existing callback/API behavior
was not modified. Focus semantics remain a native button with the descriptive
`Remove playback context` accessible label.

Focused Queue tests cover the absence of the close icon, the visible action,
left-summary grouping, increased type size, colored treatment, bounded grid,
and retained touch target. No Remote UI, backend, player-session, MPV, FFmpeg,
API, deployment, dependency, or package contract changed. No commit or push
was performed.

Fourth post-handoff correction gates:

- focused Queue drawer suite: 7/7 PASS;
- `npm run format:check`: PASS;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS, including local UI, unchanged Remote UI, backend,
  production Neutralino configuration, and build provenance;
- `npm test`: 763 tests, 751 passed, 12 expected platform/capability skips,
  0 failed;
- `git diff --check`: PASS.

The isolated visual-QA profile was removed. Ports 4310, 5173, and 8080 were
clear, and no Neutralino, app Node, MPV, or FFmpeg process remained. No live
user session or media file was modified.

## Third post-handoff correction — restored Windows timeline bootstrap

A Windows cold-start regression was reproduced with an isolated copy of the
current real playback session. The backend restored the paused Current at
116.594515 seconds over a 1388.722699-second track and the waveform endpoint
returned `ready` with 512 points, while the actual Neutralino UI still rendered
the deterministic empty rail with no visual playhead/progress. Loading another
track made the waveform appear, matching the reported behavior.

The cause was a bootstrap race between the authoritative playback occurrence
and MPV's observed track. Now Playing keyed waveform work only by playback ID.
During restore, `trackTransitionId` advanced from the provisional bootstrap
generation to the observed-track generation without changing that playback ID.
The first asynchronous waveform result was therefore correctly rejected as
stale, but no replacement request was started.

Now Playing keys waveform work by the complete `(playback ID, track generation)`
identity. A generation advance for the same restored playback invalidates the
empty rail, aborts obsolete work, and immediately loads or reuses the correct
waveform. The completion callback validates the same identity before committing
points, retaining stale-result protection. A pure identity helper keeps this
bootstrap rule independently testable without importing Vite runtime state.

The focused regression simulates the exact same-playback-ID generation advance
and confirms that it is a new waveform request while identical snapshots remain
deduplicated. The focused 41-test transition suite passes.

The exact required `npm.cmd run dev` path was then cold-started again against
the isolated copied session. In the real 1280×800 WebView2 client (1296×839
outer window), the first Now Playing surface showed `1:56`, the restored blue
waveform progress, its playhead, and the complete waveform without loading a
new track. Backend state remained paused at 116.594515 seconds with generation

1. No layout, transport, artwork, top-bar, Queue, toast, or mini-player geometry
   changed.

No backend, MPV, FFmpeg, player-session, API, Remote UI, Raspberry, deployment,
installer, updater, dependency, or package contract changed in this correction.
No commit or push was performed.

Third post-handoff correction gates:

- `npm run format:check`: PASS after Prettier formatted this report;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS, including local UI, unchanged Remote UI, backend,
  production Neutralino configuration, and build provenance;
- `npm test`: 763 tests, 751 passed, 12 expected platform/capability skips,
  0 failed. The first diagnostic pass exposed one historical source-contract
  assertion for the former direct generation comparison; it was updated to the
  stronger waveform request-identity contract before the successful full pass;
- `npm run mpv:doctor`: PASS with MPV v0.41.0 headless startup and JSON IPC;
- `npm run test:mpv`: 11/11 PASS;
- `npm run ffmpeg:doctor`: PASS with the real FFmpeg executable;
- `npm run test:ffmpeg`: 3/3 PASS, including real waveform generation and the
  single realtime analyzer invariant;
- final `npm run format:check`, `npm run typecheck`, `npm run lint`, and
  `git diff --check`: PASS after the completed report as the final invalidation
  pass.

The two isolated Windows QA profiles and generated probe audio were removed.
Ports 4310, 5173, and 8080 were clear, and no Neutralino, app Node, MPV, or
FFmpeg process remained. No user media or live user session file was modified.

The post-handoff Queue corrections are implemented, verified in the real
Windows application and Remote gateway, and green through their final gates. No
commit, push, release installation, or Raspberry update was performed.

The Raspberry-only statuses are deliberately not claimed. They remain a
post-commit, post-push, exact-head-CI, single-update acceptance activity.

## Post-handoff correction — Queue artwork and removable Context

The user reported two issues after the initial Step 2.17.14 handoff:

1. every Up Next row could initially display the Now Playing artwork and would
   correct itself only after that row was played;
2. the implicit `Then continues from` Context could be inspected but not
   removed independently.

The supplied 1280 × 800 screenshot established the visible artwork defect. A
focused backend reproduction then identified the causal boundary: when MPV's
technical playlist was reconstructed, `PlayerService.createQueue()` first
looked for the previous row by execution ID but fell back unconditionally to
the old row at the same array index. If the execution ID and path had changed,
that positional fallback still copied the old duration and artwork. A plan
reconciliation could therefore attach Current's artwork to unrelated Explicit
occurrences until their own lazy enrichment ran.

The fallback now retains enrichment only when either the stable execution ID
matches or the normalized native path at that position matches. A different
path starts with the permanent dark placeholder and resolves its own artwork;
it can no longer inherit another occurrence's image. No delay, forced refresh,
poll, additional observer, or eager unbounded metadata pass was introduced.
The existing Queue artwork loader remains bounded to two concurrent requests.

`PlaybackPlanner.clearContext()` and
`PlayerService.clearPlaybackContext()` now remove only the implicit future
Context. Current keeps playing or remains paused, Explicit Up Next entries and
History are preserved, artist-radio state/pending continuation for the removed
Context are cleared, and the existing bounded MPV execution plan is reconciled
without starting a second player. Continue Playback remains a separate user
preference and may create a future Same-artist Context at a later natural
boundary if that policy is still enabled.

The local Queue card now has a semantic 44 × 44 remove button with the accessible
name `Remove playback context`. The action uses the central player API at
`POST /api/player/context/clear`. The Remote Queue exposes the same independent
action at `POST /api/context/clear`, retaining its existing authentication,
CSRF, mutation-rate, single-SSE, and sanitized-state boundaries.

Correction files are limited to the planner and PlayerService, local/Remote
route adapters, local/Remote Queue presentation and scoped styles, English
copy, and focused tests. No dependency, package, workflow, deployment,
installer, updater, audio-processing, display, or visualizer change was made.

## Second post-handoff correction — new Context versus Up Next

The reported Album `Play all` behavior was reproduced at the planner boundary.
The priority order is Current, forward History, Explicit Queue, then the
remaining Playback Context. Starting a new album therefore played its selected
first track immediately, but an already populated Explicit `Up Next` correctly
won over the rest of the album at the next boundary. That ordering remains the
right rule for an intentional `Add to Queue`, but it is ambiguous when the user
explicitly starts a new Context.

Every local and Remote action that starts a new Context now makes the same
minimal choice only when Explicit `Up Next` is non-empty:

- `Keep Up Next` retains the previous priority and starts the new selection;
- `Clear & Play` removes the current Explicit future and starts the new
  selection continuously;
- the close control, Escape, or the backdrop cancels the Play action without
  changing Current, Context, History, or Explicit Queue.

The dialog deliberately contains only one title, one short question, the two
actions, and a 44 × 44 close control. It is not shown when Explicit Queue is
empty and it is never used for an `Add` action. The same wording, decision
semantics, focus containment, cancel paths, and touch target are present in the
local 1280 × 800 application and the portrait Remote UI.

The Queue decision is not implemented as a separate clear request. The client
sends `explicitQueuePolicy` and `expectedQueueRevision` with the Play request;
`PlayerService.openResolvedQueue()` validates and applies the clear inside the
same serialized planner attempt that installs the new Context. A changed Queue
revision rejects `Clear & Play` with HTTP 409 before playback mutation, avoiding
a race that could delete an item added after the dialog opened. If MPV cannot
load the replacement Context, the normal bounded rollback restores the prior
Current, Context, History, and Explicit Queue. `preserve` remains the backwards-
compatible default for internal callers and older clients.

Coverage includes file dialog/drop, indexed Library Album/Artist/Tracks,
Search, Favorites, Recently Played, Most Played, Playlists, configured folders,
raw USB, raw SMB, Remote Library, and Remote Browse. Shared request contracts
remain path-free on public state; the Remote keeps its existing authentication,
CSRF, rate limiting, allowlist, and single-SSE boundaries.

The supplied Windows removable-storage error was investigated separately. It
was a provider enumeration process that exited with code 1 without stdout or
stderr; the service correctly retained its previous snapshot and scheduled its
bounded retry. Re-running the exact `WindowsRemovableStorageProvider` path
returned an empty device list successfully. This is consistent with a transient
Windows Storage/CIM enumeration failure, not the playback-order defect, and no
removable-storage behavior was changed on the basis of one non-reproducible
event.

Focused validation completed before the final pass:

- command validation accepts only complete `preserve`/`clear` decisions with a
  non-negative safe Queue revision;
- matching `Clear & Play` removes Explicit and leaves only the replacement
  Context future;
- a stale revision performs no planner or MPV mutation;
- a failed replacement load restores the cleared Explicit occurrences;
- local and Remote source contracts cover every Context producer, both actions,
  cancellation, the 44 × 44 close target, and the authenticated gateway path;
- focused backend/local/Remote suites: PASS, 0 failures.

Real application and Remote acceptance for this correction:

- mandatory `npm.cmd run dev`: PASS with an isolated Windows profile, the real
  Neutralino/WebView2 shell at a 1280 × 800 client area, the backend, and one
  persistent MPV;
- two generated eight-second MP3 fixtures were indexed as one two-track album;
  no personal media was used;
- the real Album detail Play action opened a compact centered dialog with no
  clipping, scroll, layout shift, or overlap; both action labels remained on one
  line and the close target retained its reserved 44 × 44 geometry;
- closing the dialog retained Explicit count 1 and playback-plan revision 4;
  `Clear & Play` changed Explicit count 1 → 0 and started the album Context;
  `Keep Up Next` restarted the album Context while retaining Explicit count 1;
- an authenticated, CSRF-protected production Remote gateway request changed
  Explicit count 1 → 0 for `clear`; a separate authenticated `preserve` request
  retained Explicit count 1 and started the selected album;
- `npm run build:remote`: PASS with non-empty HTML, CSS, and JavaScript assets;
- the Remote browser controller reported no available browser instances, so no
  false portrait visual PASS is claimed. The Remote modal is instead covered by
  its real authenticated gateway acceptance, production build, and automated
  320–430 px responsive/source contract checks;
- the application window closed normally and Neutralino, MPV, backend, Vite,
  Remote listener, and ports 4310/5173/8080 were clear afterward.

Focused correction validation before final gates:

- planner regression: clearing Context preserves Current and Explicit Queue;
- technical Queue regression: a new execution/path at the same index does not
  inherit the previous row's artwork;
- local and Remote route/UI source contracts cover the remove action and touch
  target;
- authenticated Remote gateway request: PASS after the already-running
  development application released its fixed port 8080;
- focused suites: 56 tests passed, 0 failed;
- `npm run typecheck`: PASS;
- mandatory real `npm.cmd run dev`: PASS with the actual
  Neutralino/WebView2 → backend → MPV path and three generated 30-second MP3
  fixtures carrying solid red, green, and blue embedded covers;
- at 1280 × 800, Now Playing showed red while both Up Next rows immediately
  showed distinct green and blue artwork without being played;
- activating the Context remove button kept red Current paused, retained both
  Explicit rows, changed `playbackContext` to `null` through the real API/SSE,
  and removed the card without a flash, scroll jump, or drawer reconstruction;
- the application closed normally; Neutralino, backend, Vite, MPV, FFmpeg, and
  ports 4310/5173/8080 were clear before the final gate sequence.

## Git and CI baseline

- Branch: `main`.
- HEAD and `origin/main`:
  `810f074dd843d04846b86e5db6c88988cd3b1282`.
- Ahead/behind: `0/0`; no merge, rebase, reset, restore, stash, or clean was
  performed.
- The initial worktree was clean and `git diff --check` passed.
- The exact-head GitHub Actions run was green:
  <https://github.com/dan88v/eidetic-player/actions/runs/30691673207>.
- Development Build ID: `810f074-dev`.
- Step 2.17.11–2.17.13 sources and their corrections were present in the
  baseline.

## Baseline Windows audit

The pre-change application was exercised through the real Windows
Neutralino/WebView2 application with `C:\Tools\mpv\mpv.exe`.

The old model was confirmed to be one public `PlayerState.queue`, one
`currentQueueIndex`, and one MPV playlist. Context and manual additions were
indistinguishable in the visible Queue; path-based maps participated in
identity/origin recovery; duplicate native paths were deduplicated; Shuffle and
Repeat operated on the technical playlist; and the v2 session persisted that
single Queue. Album play, Add, duplicate Add, navigation, reorder, clear, and a
service restart were checked. The old session could restore its queue/current
shape, but the UI Preferences bootstrap remained the runtime owner of
volume/mute/shuffle/repeat, which made a raw API-only mismatch unsuitable as a
restore acceptance fixture.

Baseline and final QA used generated 30-second FLAC fixtures in an isolated
temporary profile outside the repository. No personal media or personal path
is recorded in this report.

## Producer and consumer matrix

Before this step, every Play surface eventually replaced the same technical
Queue and every Add surface appended to it. The new behavior is:

| Surface           | Previous Play / Queue model                                              | New Play result                                                                                                    | New Add to Queue result                                                        |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Album             | One album list in `PlayerState.queue`; Add appended to the same list     | Snapshot `album` Context with album ID, stable album-artist identity, disc/track order, and selected track         | Whole album or selected track becomes distinct Explicit occurrences            |
| Artist            | One resolved artist list                                                 | Snapshot `artist` Context with stable artist ID and current product ordering                                       | Whole artist or selected track becomes Explicit occurrences                    |
| Tracks            | Selected/opened list became the Queue                                    | Snapshot `tracks` Context, selected by stable Library track ID; single-track fallback remains typed                | Selected track only becomes Explicit                                           |
| Playlist          | Playlist was flattened into the Queue                                    | Snapshot `playlist` Context with playlist ID; `playlist-item-*` selects the occurrence and duplicates are retained | Whole playlist or one row becomes Explicit with new occurrence IDs             |
| Favorites         | Aggregate replaced the Queue                                             | Typed `favorites` Context for Play All; single album/artist uses its normal Context                                | Existing single-track, album, or artist menu Add paths append Explicit entries |
| Recently Played   | Resolved tracks replaced the Queue                                       | Deduplicated, ordered `recently-played` snapshot selected by `history-*`                                           | Selected track becomes Explicit                                                |
| Most Played       | Resolved tracks replaced the Queue                                       | Ordered `most-played` snapshot selected by Library track ID                                                        | Selected track becomes Explicit                                                |
| Search            | A result opened a generic Queue                                          | Track Play creates a query-titled `search` snapshot; album/artist results reuse normal resolvers                   | Track, album, or artist actions append through the authoritative Explicit path |
| Configured Folder | Parent/directory files became the Queue                                  | `folder` Context keyed by source UUID, with source ID and relative paths                                           | Entry or immediate directory contents append as Explicit occurrences           |
| Raw USB           | Device entries became the Queue                                          | `folder` Context keyed by `usb-*`, retaining device, entry, and relative-path origin                               | Entry or directory route appends Explicit occurrences                          |
| Raw SMB           | Connection entries became the Queue                                      | `folder` Context keyed by `smb-*`, retaining connection, entry, and relative-path origin                           | Entry or directory route appends Explicit occurrences                          |
| File dialog       | One file expanded its parent; multiple files used the explicit selection | The same natural ordering and exact selection now form `direct-folder`                                             | No new Add UI was introduced; the existing backend append endpoint remains     |
| Drag and drop     | Same open path as the file dialog                                        | One file expands its parent; multiple validated files form `direct-folder`                                         | No new drop-to-Add behavior was introduced                                     |
| Remote Library    | Remote routes independently drove the old Queue                          | Reuses the exact local Album, Artist, Tracks, Search, Favorites, Recently, Most, and Playlist resolvers            | Reuses the same authoritative `player.append()` path                           |
| Remote Browse     | Configured sources opened the old Queue                                  | Reuses configured-source Folder resolution, including indexed USB/SMB sources                                      | Reuses the same browse action and `player.append()` path                       |

Important bounded presentation details:

- `playlist-item-*` is used to select a playlist occurrence; the Context then
  retains the Library track identity and newly generated occurrence IDs.
- Recently Played uses its database history ID to select, then stores a
  deduplicated resolved Context rather than navigation-history IDs.
- Search keeps the query in the Context title; folders identify the stable
  source/device/connection rather than manufacturing a directory entity ID.
- Dialog and drop still intentionally have no Add UI.
- Remote Favorites currently presents Favorite Tracks; the gateway remains
  capable of the existing album/artist aggregate actions.

## Authoritative architecture

A new `apps/backend/src/playback-plan/` module owns the pure playback model.
`PlayerService` remains the single MPV/IPC, metadata, command-intent, and
technical-playlist owner. Library resolvers create bounded Context seeds; the
local and Remote UIs consume the same sanitized public contract and never own a
parallel Queue.

The six separate concepts are now explicit:

1. **Current** — exactly one playback occurrence, outside both future lists.
2. **Playback Context** — an immutable resolved snapshot plus cursor/order and
   availability revisions.
3. **Explicit Queue** — only future manual additions.
4. **Navigation History** — browser-like back/forward history, capped at 100
   actual starts.
5. **Execution Plan** — a backend-only Current plus at most 128 projected future
   entries for the one persistent MPV.
6. **Continue Playback** — `off` or Library-only `same-artist`.

Public SSE and Remote state contain Current, Explicit Queue, Context summary,
History capabilities, continuation summary, and independent revisions. Native
paths, MPV execution details, buffers, and base64 artwork remain private.

## Identity and duplicate support

The implementation distinguishes Library track ID, playback instance ID,
Explicit entry ID, Context item ID, History entry ID, and MPV execution entry
ID. Every Explicit occurrence receives independent `explicit-*`,
`playback-item-*`, and `execution-*` IDs. Duplicate native paths and duplicate
Library tracks therefore remain separately reorderable, removable, selectable,
persisted, and availability-aware.

The compatibility `queue` is derived from Explicit entries only and uses
logical `queue-entry://` identifiers. It is not the authoritative model.
Occurrence origin lookups use execution IDs and the planner Current; a
path-based map remains only as a compatibility aid where occurrence identity is
not required.

## Priority, navigation, and mutations

The planner order is Current completion, forward History, Explicit FIFO,
remaining Context, Repeat, and then Continue Playback. A new manual Context
replaces the old Context, starts the selected item immediately, truncates
forward History, and preserves the existing Explicit Queue.

- Selecting a future Explicit entry starts it immediately, discards preceding
  skipped Explicit entries without adding them to History, and retains only its
  successors.
- Clear affects future Explicit entries only; Current and Context remain.
- Remove and reorder address stable Explicit IDs, with stale index/revision
  rejection.
- Previous after more than three seconds seeks to zero. A subsequent Previous
  moves backward through actual History; Next first traverses forward History.
- Natural end while back in History advances through forward History before
  consuming the future plan.
- Unavailable History, Explicit, and Context occurrences are skipped with
  bounded progress and without loops.

## Shuffle, Repeat, and Same artist

Shuffle changes only the unconsumed Context order. It never changes Explicit
FIFO and never invokes MPV whole-playlist shuffle.

Repeat One restarts Current. Repeat All regenerates only the Context cycle and
does not replay consumed Explicit entries. MPV `loop-playlist` stays disabled;
`loop-file` is used only for Repeat One. Repeat takes precedence over
continuation.

`Same artist` is available under Settings → Playback and defaults to Off. It
runs only after forward History, Explicit Queue, Context, and Repeat are
exhausted. Identity priority is stable Artist Context ID, stable Album
album-artist ID, then the indexed Current track's primary artist ID. File tag
string comparison is never authoritative.

Candidates come from one indexed Library query and only available indexed
tracks are admitted. No runtime filesystem scan, SMB crawl, folder fallback, or
network search was added. Artist radio is an implicit `artist-radio` Context,
uses a cyclic random bag, excludes the current item, avoids immediate/recent
items where possible, and yields to every later Explicit Add. With no candidate
it stops normally. Switching to Off preserves Current and Explicit entries but
drops the radio future.

The stable artist ID and display name are kept as one identity pair. In
particular, an Album Context never labels its stable album-artist ID with an
unrelated track-artist tag.

## Settings and Preferences

The canonical Settings components are reused. Root order is Interface, Audio,
Playback, Network, Remote access, System; the existing Remote access row was not
moved. Playback contains the described `Continue playback` selection page with
Off and Same artist.

Preferences schema 3 adds `continuePlaybackMode` additively with a safe Off
default. The existing backend Preferences controller remains authoritative;
there is no new localStorage owner. Revision conflicts, atomic persistence,
legacy import, backup recovery, and future-schema read-only behavior remain
covered.

## Session v3 and migration

The canonical session is now v3, with Current, Context, Explicit Queue,
History/cursor, Artist Radio, pending continuation, plan revisions, position,
volume, mute, Shuffle, Repeat, and Continue Playback persisted independently.
Atomic writes are retained. A bounded v2 projection is refreshed alongside v3
for rollback/current-previous compatibility; the old session is not deleted.

Legacy v1/v2 Queue state migrates to one `legacy-session` Context while
preserving current item, ordering, position, volume, mute, Shuffle, Repeat, and
logical origins. Malformed sections are repaired independently rather than
discarding the whole session. Future schemas remain byte-for-byte read-only.
Temporary source outages defer restore without rewriting saved state; once MPV
and sources recover, the same instance restores with stable Explicit IDs and
order. An Explicit-only stopped session remains staged until Play.

## Public API, local UI, and Remote UI

Local command validation and API routes now carry stable Explicit IDs and
expected revisions. All Play routes create typed Context snapshots; all Queue
routes append Explicit occurrences. Local player SSE sends a bounded full model
only when its revisions change and small progress events for time updates.

The local Queue drawer remains mounted and keyed. It displays Now Playing,
Explicit-only Up Next, an empty-Explicit message, Then continues from, and a
Same artist summary. Current is neither draggable nor removable. The badge,
clear confirmation, tap-to-play, remove, and reorder operate only on future
Explicit IDs. Existing header, handle, focus, mini-player, autoscroll,
pointer-cancel, and reliable touch-scroll behavior remain intact.

The isolated Remote module mirrors the same sections and mutations. The gateway
sanitizes Current, Explicit, Context, History, progress, track, and artwork
objects field by field; native paths cannot cross the boundary. It continues to
use one multiplexed SSE and introduces no EventSource, polling loop,
visualizer, administrative Playback Settings, or second backend/player.

## MPV reconciliation, recovery, and races

There is still one persistent MPV. Add/remove/reorder/clear reconcile the
technical future from the longest common prefix and do not reload Current.
Natural EOF reuses a matching projected item and removes only consumed
technical entries.

Unexpected MPV exit starts one replacement controller, rebuilds the bounded
plan, and restores position, volume, mute, pause/play state, and loop policy.
Explicit-only state remains staged. No second player or second session was
introduced.

The final audit added transaction-aware rollback around planner decisions:

- a failed MPV command restores Current, Context, History, continuation, and
  consumed Explicit occurrences while preserving completed concurrent Adds,
  removals/reorders/clears, policy changes, and availability updates;
- nested Same-artist decisions update the same attempt snapshot;
- rollback capacity is reserved, so a concurrent Add cannot exploit a
  temporarily consumed slot to exceed the 10,000-entry bound;
- planner and MPV are reconciled or rebuilt after rollback;
- pending navigation IDs and flags are cleared;
- generation checks prevent stale Context opens and stale continuation results
  from winning.

Source availability is updated per occurrence through execution IDs. Current,
History, Context, and duplicate Explicit entries therefore cannot acquire the
wrong origin merely because they share a native path. Removable/SMB loss stops
only an affected Current and reconnect can restore unconsumed availability.

## Automated validation before final gates

- Focused/affected TypeScript suite: 242 tests, 241 passed, 1 expected Windows
  symlink-capability skip, 0 failed.
- Planner coverage includes Context-only, Explicit-only staged, duplicates,
  selection, clear/remove/reorder, History branching, unavailable skips,
  Shuffle/Repeat, Same artist, random bags, 100-entry History, 2,000-item
  Context, 10,000-item radio, and generation races.
- Rollback regressions cover concurrent Add, hard-cap reservation, staged Play
  failure, failed Context reload, nested Same-artist failure, Add during
  candidate resolution, concurrent Same-artist Off, pending flags, and
  planner/MPV convergence.
- Session tests cover v1/v2 migration, v3 round-trip, partial repair, future
  read-only state, source outage deferral, same-instance recovery, v2
  projection, origin richness, duplicates, and atomic writes.
- Local/Remote API and UI tests cover all producer routes, sanitized public
  models, a single SSE, fixed/mobile geometry, stable keyed rows, touch reorder,
  no path leakage, and no visualizer/Settings exposure in Remote.
- Real `mpv:doctor`: MPV v0.41.0 headless startup and JSON IPC PASS.
- Real `test:mpv`: 11/11 PASS, including one persistent MPV, duplicate Explicit
  occurrences, Context reconciliation without Current reload, selection,
  shuffle identity/position, removable source loss, and rapid commands.

## Performance

The large-session stress run recorded:

| Measurement                                                 |          Result |
| ----------------------------------------------------------- | --------------: |
| Snapshot (2k Context + 2k duplicate Explicit + 100 History) |       26.195 ms |
| Compact v3 payload                                          | 1,981,514 bytes |
| Initial formatted v3 file                                   | 2,727,491 bytes |
| Atomic write                                                |       89.395 ms |
| Read                                                        |       74.682 ms |
| Restore                                                     |      326.099 ms |
| Verification                                                |       83.039 ms |
| Preparation                                                 |       12.023 ms |
| Repaired v3 file                                            | 2,697,106 bytes |
| Compatibility v2 file                                       | 1,300,812 bytes |

Additional affected-suite measurements were approximately 57.6 ms for the
2,000-item planner projection, 438 ms for a 10,000-item artist-radio bag,
133.7 ms for one local SSE with 2,000 Explicit entries, and 24.9 ms for the
bounded Remote position/read model. Time-position updates do not serialize the
full Context or write the session, and the UI never renders implicit Context as
2,000 rows.

## Real Windows QA

The exact required `npm.cmd run dev` command opened the real
Neutralino/WebView2 application. Six generated FLAC fixtures represented a
four-track Context and two additional tracks. Results:

- selected album track became Current and the remaining album became implicit
  Context;
- duplicate Explicit occurrences retained different IDs and FIFO/reorder
  behavior without Current reload or a second MPV;
- selecting a later duplicate skipped preceding entries without false History;
- clear preserved an Explicit Current and resumed the Context;
- Previous at four seconds restarted Current, then History back/forward worked;
- Repeat One preserved future state; Repeat All cycled only Context;
- Shuffle changed only Context while Explicit FIFO stayed fixed;
- Same artist created a Library-ID-backed radio Context, yielded to an Add,
  resumed radio, and stopped after switching Off and exhausting Explicit;
- Album, Artist, Folder, Search, and direct-source Context paths were exercised;
- a new Context while back in History truncated the forward branch and retained
  Explicit entries;
- no native path appeared in public state.

Local Queue visuals were inspected in the actual application at 1280×800,
1024×768, 1024×600, and 1366×768. Settings root, Playback navigation page,
Off/Same artist selection, focus/return behavior, and persisted selection were
also inspected. The actual Power menu and confirmation were exercised and Quit
closed the full process tree.

After the audit fixes, the same isolated profile was restarted twice. The final
restart reported readiness `ready`, restore `restored`, 51 restored / 0
discarded items, Current plus Album Context, four independently identified
Explicit entries, 42 History entries at cursor 41, position 4.999999 s, paused,
volume 63, muted, Shuffle on, Repeat All, Same artist, and one MPV. The public
track path was a logical `library-source://` URL. Both v3 and the v2 projection
were present. Session and Preferences were intentionally aligned through their
normal APIs before the final restart, matching the normal UI ownership model.

No real SMB server or raw USB device was attached to the isolated Windows
fixture; those resolvers, identities, loss/reconnect behavior, and API contracts
are covered by focused tests. The post-change Remote portrait surface could not
be visually inspected because the in-app Browser controller had no available
browser instance. Its skill contract forbids substituting headless browser QA;
therefore automated 320–430 px geometry/isolation tests and the real gateway
contract are recorded, but no false visual PASS is claimed.

## Scope and files

The implementation is grouped in:

- new authoritative planner files under `apps/backend/src/playback-plan/`;
- shared Library, player, Preferences, and Remote contracts;
- PlayerService, command validation, local SSE, backend route wiring, Library
  resolvers/query, and player-session v3 repository/service/types;
- local API/state/Queue/Settings/Library integration and scoped CSS/i18n;
- Remote gateway/read models/Queue UI and scoped CSS;
- focused backend, MPV, local UI, Remote UI, session, performance, and public
  contract tests;
- this report.

The analysis diff is limited to choosing the playback occurrence ID for the
existing analyzer; no FFmpeg spawn, lifecycle, frame, visualizer, or waveform
behavior changed. The Remote access diff is limited to the explicitly required
Remote gateway/player/Queue contract; pairing, store startup, listener
lifecycle, and security boundary are unchanged.

Diffs are empty for `package.json`, `package-lock.json`, `.github/workflows`,
`deploy`, audio output, audio processing, display, update, FFmpeg,
`apps/ui/src/components/visualizer`, reliable touch scroll, the Linux update
script, and update runner. No dependency, package-plan, installer, updater,
uninstaller, executable-mode, or workflow change was introduced.

## Final gates

The report draft was saved before the final sequence. Every executable gate is
now green:

- `npm run format:check`: PASS. The first diagnostic pass identified four files
  requiring Prettier; they were formatted and the gate passed on rerun.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS. One unused variable in a new public-contract test was
  removed after the first diagnostic pass, then the full gate passed.
- `npm run build`: PASS.
- `npm run build:linux`: PASS.
- `npm test`: 758 tests, 746 passed, 12 expected platform/capability skips,
  0 failed. Two historical Step 2.7 search assertions and one historical SMB
  public-path source assertion were updated to the new typed Context contract;
  the focused tests and full suite then passed.
- `npm run test:posix`: 5 tests, 3 passed, 2 expected Windows skips, 0 failed.
- `npm run verify:network:deployment`: PASS.
- `npm run verify:linux:executables`: PASS for all 46 tracked deployment files.
- `npm run verify:linux:installer`: PASS, including 72 install-safe tests,
  61 passed and 11 expected Windows/POSIX skips.
- `npm run verify:linux:release -- --root . --arch x64 --phase build`: PASS,
  including the backend, Neutralino ELF/config/resources, local UI, and non-empty
  Remote UI HTML/CSS/JavaScript assets.
- `npm run mpv:doctor`: PASS with MPV v0.41.0 headless startup and JSON IPC.
- `npm run test:mpv`: 11/11 PASS.
- `npm run ffmpeg:doctor`: PASS with the real FFmpeg executable.
- `npm run test:ffmpeg`: 3/3 PASS.
- `npm run test:remote`: 29 tests, 28 passed, 1 expected Windows symlink skip,
  0 failed.
- `npm run build:remote`: PASS; production HTML, CSS, and JavaScript assets were
  emitted.
- `git diff --check`: PASS.

After the report and late test-only corrections, formatting, typecheck, lint,
and diff checks were rerun as the final invalidation pass.

Post-handoff correction rerun:

- `npm run format:check`: PASS.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS after replacing one unnecessary optional chain in the
  new regression with an explicit assertion/narrowing.
- `npm run build`: PASS after the same test-only narrowing also satisfied the
  backend build configuration.
- `npm test`: 758 tests, 746 passed, 12 expected platform/capability skips,
  0 failed.
- `npm run mpv:doctor`: PASS with MPV v0.41.0 headless startup and JSON IPC.
- `npm run test:mpv`: 11/11 PASS.
- `npm run test:remote`: 29 tests, 28 passed, 1 expected Windows symlink skip,
  0 failed.
- `npm run build:remote`: PASS; correction build sizes are 13.30 kB CSS and
  30.37 kB JavaScript before gzip.
- final `npm run format:check`, `npm run typecheck`, `npm run lint`, and
  `git diff --check`: PASS after this report update.

Second post-handoff correction rerun:

- `npm run format:check`: PASS after formatting the affected code/test files
  and this report;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS after one accidental test-fixture destructuring was
  corrected and callback bodies were made explicit;
- `npm run build`: PASS, including the local UI, Remote UI, backend, production
  Neutralino configuration, and build provenance;
- `npm test`: 762 tests, 750 passed, 12 expected platform/capability skips,
  0 failed. The first two diagnostic passes exposed only historical source-
  contract assertions for the old zero-argument `LibraryApiClient` constructor
  and one single-line `PlayerService.open()` signature marker; both assertions
  were updated to the new decision-provider contract before the successful full
  pass;
- `npm run mpv:doctor`: PASS with MPV v0.41.0 headless startup and JSON IPC;
- `npm run test:mpv`: 11/11 PASS;
- `npm run test:remote`: 30 tests, 29 passed, 1 expected Windows symlink skip,
  0 failed;
- `npm run build:remote`: PASS; production assets are 13.58 kB CSS and 31.98 kB
  JavaScript before gzip;
- final `npm run format:check`, `npm run typecheck`, `npm run lint`, and
  `git diff --check`: PASS after the report and historical test-contract updates.

The Linux build/installer/release gates were not rerun for this correction:
their complete successful results remain recorded immediately above, and this
follow-up changed no deployment, package, executable, installer, updater, or
Linux-specific file. Raspberry hardware validation remains deliberately
deferred until the user's commit/push and green exact-head CI.

## Checkpoint, Raspberry, and cleanup

- No automatic commit or push.
- No CI run was triggered from this worktree.
- No in-app Raspberry update, live Raspberry session migration, Raspberry
  Context/duplicate/History/Shuffle/Repeat/Same-artist/local-Remote-sync test,
  or updater no-op was performed.
- Those checks require the user's manual commit/push, green exact-head CI, and
  one subsequent Raspberry update dedicated to Step 2.17.14.
- No application, MPV, FFmpeg, Neutralino, Vite, backend, Remote listener, or
  Eidetic-related Node process remained after Windows QA; ports 4310, 5173, and
  8080 were clear.
- The isolated QA profile, generated fixtures, and temporary app state were
  removed after the final evidence was recorded.

Local handoff status after successful gates:

`READY FOR CI VALIDATION — PLAYBACK CONTEXT NOT DEPLOYED`
