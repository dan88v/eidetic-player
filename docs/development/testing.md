# Testing guidelines

## Testing layers

Use the smallest sufficient test first, but do not stop before the layer that
can expose the reported problem.

1. **Static checks** — formatting, TypeScript strictness, lint, and build.
2. **Unit tests** — pure parsing, validation, ordering, state transitions,
   geometry, cache behavior, FFT/waveform math, and stale-result protection.
3. **Integration tests** — backend routes, JSON IPC, MPV, FFmpeg, SSE, artwork,
   ETag, and process cleanup.
4. **Native application tests** — Neutralino file dialog/drop, real WebView,
   focus, resize, shutdown, and native bridge selection.
5. **Real-media tests** — actual FLAC and MP3 folders for Queue, metadata,
   artwork, seek, track changes, and visualizer performance.
6. **Target-device tests** — Raspberry Pi 3B CPU, memory, touch, display, boot,
   output device, and sustained smoothness.

Browser headless checks cannot replace Neutralino or real-media verification
when native integration, playback, artwork, or realtime rendering is involved.

## Mandatory Windows visual QA command

Every Windows UI or visual regression check must start the real application
from the repository root with exactly:

```text
npm.cmd run dev
```

The QA target is the Neutralino/WebView2 window opened by that command,
including its real backend and platform bridge. Opening the Vite URL in a
browser, using browser automation/headless rendering, inspecting static HTML,
or relying only on screenshots/tests is not an acceptable substitute. Browser
tools may provide additional diagnostics, but they never satisfy the native
visual QA gate.

Resize and inspect the Neutralino window at every viewport required by the
current step. Record each viewport and interaction as PASS, FAIL, or NOT TESTED
in the step output. Merely launching `npm.cmd run dev` is not a visual PASS:
the required surfaces and flows must be exercised in that window. Shut down
the command cleanly afterward and verify that Neutralino, backend, Vite, MPV,
FFmpeg/helpers, and ports 4310/5173 are gone.

## Standard commands

Run the relevant commands from the repository root:

```text
npm run format:check
npm run typecheck
npm run lint
npm run build
npm test
npm run mpv:doctor
npm run test:mpv
npm run ffmpeg:doctor
npm run test:ffmpeg
```

On systems that block the PowerShell npm shim, use `npm.cmd` with the same
arguments. Do not change machine execution policy as part of the project.

Linux adds `doctor:linux`, `doctor:network:linux`,
`verify:network:deployment`, `test:linux`, `test:posix`,
`test:case-sensitive`, `build:linux`, `smoke:linux`, and `verify:arm`. Run them
from a native case-sensitive filesystem. The network doctor is read-only: it
must not scan, connect, change radio/IP, or edit files. Deployment tests use
`--root` with a temporary staging tree and never install host policy. Static
ARM inspection and WSL staging are not Raspberry Pi runtime evidence.

## GitHub Actions Linux CI

The `Eidetic Player CI` workflow runs on `ubuntu-latest` for pushes to `main`,
pull requests targeting `main`, and manual dispatches. Node is read from
`.nvmrc`; `actions/setup-node` uses its standard npm cache with
`package-lock.json`. After one `npm ci`, separate fail-fast steps run
`npm audit`, format, typecheck, lint, build, the standard test suite,
`test:posix`, and `test:case-sensitive`. The granular steps intentionally avoid
running the standard suite twice through `test:linux`.

The hosted job is a core Linux gate, not native runtime certification. It does
not run Neutralino/WebView2 or WebKitGTK, MPV, FFmpeg, native dialogs, audio
hardware, `doctor:linux`, `build:linux`, `smoke:linux`, or `verify:arm`.
Continue to use `npm.cmd run dev` for real Windows QA, a native
case-sensitive WSL/Debian clone for Linux diagnosis and platform-sensitive
checks, and Raspberry Pi hardware for touch, audio, performance, and shutdown
validation.

## Real media

Real-media tests use user-provided local folders read-only.

- Never rename, move, edit, retag, or delete media.
- Never copy media into the repository or temporary fixtures unnecessarily.
- Never commit personal absolute paths.
- Treat local test paths as environment/test-run input.
- Test at least one lossless and one lossy collection.
- Include files with embedded artwork, folder artwork, missing artwork,
  incomplete metadata, long titles, and Unicode paths when available.

For Sources/Folders, also verify the real Neutralino folder dialog, restart
persistence, display-only Rename, non-destructive Remove, unavailable/Retry,
logical breadcrumb/Back, session scroll restoration, lazy enrichment, and an
exact non-first Queue index. Confirm no Source/browse response contains a native
absolute path.

For USB Quick Browse, verify Windows physical detection separately from fixture
coverage. Cover zero/one/multiple mounted volumes, opaque identity across a
drive-letter or mount-point change, read-only/unreadable state, natural
one-level browsing, direct selected-index playback, Add Track/Folder,
disconnect Stop with unchanged Queue IDs/order/revision, reconnect without
autoplay, and manual rematerialization. Inspect Sources, Default, Cassette,
picker, USB browser, Queue, and Back at 1280x800, 1280x720, and 1024x600.
Never count a fixture pass as physical USB detection.

For SMB Quick Browse, exercise Add/Edit/Remove, explicit Account or Guest,
top-bar states/popover, Sources actions, a non-first direct track, natural
Queue order, Add Track/Folder, disconnect Stop with unchanged Queue
IDs/order/revision, and reconnect without autoplay. Inspect the canonical
Folders UI at 1280x800, 1280x720, and 1024x600. Use a safe read-only NAS share
when available. Otherwise use `EIDETIC_SMB_FIXTURE=1`, state clearly that real
Windows SMB/Credential Manager and Linux CIFS runtime are NOT TESTED, and never
turn fixture coverage into a native SMB PASS.

For USB Library integration, add both a volume root and a nested folder,
confirm segment-aware same/parent/child overlap rejection, and verify that only
the new Source receives its first scan. Disconnect during scanning must end as
source-unavailable without mark-missing; reconnect must restore the catalog
without rescan or autoplay. Exercise indexed Albums, Artists, Tracks, Search,
Favorites, Playlists, History, and a mixed local/USB Queue. Confirm existing
Quick Browse Queue IDs, origins, order, and revision are unchanged. Remove the
QA Source afterward and verify that the live device and its media were not
modified. Record physical unplug/reconnect as NOT TESTED unless it was actually
performed.

For USB mount/safe-removal controls, cover capability-driven actions,
single-volume Mount, whole-device multi-partition removal order, duplicate
requests, busy/veto, permission, timeout, partial failure, and shutdown
cancellation with platform fixtures. In the real Windows app verify the shared
conditional confirmation, Stop with unchanged Queue IDs/order/revision/current,
persistent Safe to remove, physical eject, and reconnect without autoplay or
rescan. Verify Sources and the USB Browser header menu at 1280x800, 1280x720,
and 1024x600; Main Player and Queue must gain no removal action. Do not label
physical unplug/reconnect or Linux hardware as passed unless actually exercised.

For Step 2.4.1 also verify sidecar-over-embedded preview priority, no recursive
sampling, the 8-file/4-cover bounds, List/Grid persistence without requests or
scroll loss, direct-folder Play ordering, and Add to Queue in both playing and
empty states. Empty-state append must remain paused with no current track,
unchanged `trackTransitionId`, stable keyed IDs, and one `queueRevision`.

Filesystem tests exercise `path.win32` and `path.posix` independently of the
host: drive/UNC/POSIX roots, slash forms, case rules, Unicode/spaces, prefix
collisions, traversal/null/mixed separators, canonical containment,
symlink/junction exclusion, XDG/APPDATA configuration, atomic persistence,
corruption recovery, and remove-without-delete.

For a folder Queue test:

1. capture the natural order;
2. open a non-first track;
3. confirm the full non-recursive folder appears;
4. confirm the selected track starts directly;
5. verify Previous and Next in both directions;
6. verify active row, metadata, and artwork;
7. repeat enough track changes to reveal races, flashes, and scroll jumps.

For seamless-transition regressions, observe both the authoritative state and
the real WebView. Run at least 20 Previous/Next transitions, five rapid Next
commands, alternating rapid commands, and an automatic end-of-file transition.
Assert that generation and Queue identity agree for metadata, artwork,
waveform, visualizer, position, and duration. Count layout shifts, child-node
replacement, Queue structural reconciliation, active EventSource/rAF loops,
and MPV/FFmpeg processes. Repeat with animations off and emulated reduced
motion. An aborted stale request is expected cleanup, not a failed playback
transition.

## Visual and touch verification

Always inspect 1280 × 800 after UI changes. Also check 1366 × 768 and
1600 × 900 where relevant, plus emergency behavior at 1280 × 720 and
1024 × 600.

Verify:

- no horizontal overflow;
- stable artwork and panel dimensions;
- no white flashes;
- no layout shifts or row movement;
- persistent scroll and focus;
- touch target dimensions;
- tap/drag/keyboard behavior;
- overlays are mutually exclusive;
- Escape and focus restoration;
- reduced motion and animations-off behavior.

Screenshots are useful evidence but do not prove drag, playback, focus, or
smoothness. Exercise those behaviors.

## Performance verification

Reproduce and measure before optimizing. Use a stable interval, typically 30–60
seconds per visualizer mode, and record:

- actual frame rate and jitter;
- received versus rendered frames;
- duplicate connections/loops;
- Queue rebuild count;
- analyzer process count and restart count;
- CPU/memory where practical.

Test `none` separately and verify it becomes idle.

## Shutdown and resource cleanup

Test closure while idle and while actively playing. After closure confirm:

- no `mpv` process;
- no `ffmpeg` process;
- no Neutralino process;
- no project Node, Vite, or backend process;
- no stale IPC socket;
- no generated artwork directory/file;
- no outstanding test fixture.

Unexpected failure or skipped integration must be stated precisely in the step
report. Do not report an unexecuted manual test as passed.

## Step 2.4.2 startup/session checks

Verify a clean launch and a restored launch separately. For restore, save a
Queue, terminate through the normal shutdown path, restart with
`npm.cmd run dev`, and assert the same current identity, Queue order, paused
state, and position zero. Also cover a missing secondary item, a missing
current item (no fallback), corrupt JSON recovery, and logical Folders origins.

For interface preferences, verify immediate Folders/Library visibility,
redirect when the active section becomes hidden, Sources remaining visible,
and inactivity reset/suspension for overlays, fields, selection sub-screens,
and native dialogs. Treat an inline Settings pill group with three or more
options as a regression: only booleans/two-choice settings may stay inline;
larger sets must use the standard summary row and selection sub-screen.

## Step 2.4.3 corrective checks

Treat Settings as one route group: the sole inactivity timer must be absent on
root, Interface, every selection screen, and Settings-owned dialogs, then start
a complete timeout after exit. Verify selection commit order, immediate
checkmark/back navigation, segmented controls for every boolean, and
store/storage rollback with the shared toast on failure.

For Queue row playback, cover both staged and materialized paths at a non-zero
index. Assert autoplay, stable Queue IDs/origins, one transition generation,
in-place `aria-current`, and no propagation from Remove.

For Folders row playback, rapidly request different tracks through the main row
target. The last request must win even when directory/metadata resolution
finishes out of order, current-row state must follow only that request, and
every clicked control must be enabled again. The main target and menu Play now
must exercise the same UI action path.

Re-enter a directory whose browse response initially marks a row current, then
change tracks. Only the filename from the current player store may retain
`folders-audio--current` and `aria-current`; the initial browse flag must not
keep a second row highlighted.

Audit mounted screens for transient inline feedback containers. Operation
progress, success, warning, and error results must reach the shared
`showToast`; there must be exactly one application toast surface. Do not count
persistent empty states, availability labels, validation help, or dialog
explanations as transient feedback.

Folders navigation, loading, and playback must not invoke a toast because their
result is visible. Queue additions, no-result outcomes, and errors must still
use the shared toast.

For the stereo meter, assert exact −60 dB and 0 dB endpoints, known mappings
for linear peaks (0.1 → −20 dB and 0.01 → −40 dB), bounded geometry, and the
compact scale above the bars. Audit section headers for description-only left
content, no decorative eyebrow/icon/visible heading, and preserved actions.

For visualizer synchronization, compare each analyzer timestamp to current MPV
position for real MP3 and FLAC playback. Cover pause/resume, forward/back seek,
Next/Previous, Queue selection, end-of-file, and paused restore. Confirm the
24-frame bound, non-future selection, stale-frame discard, and exactly one
analyzer, EventSource, and rAF handle.

Artwork regression runs must distinguish cold and warm caches, scroll/remount,
List/Grid, and restart. Exercise embedded JPEG/PNG, FLAC, missing artwork, and
transient parse/load/decode failure. Verify retries are entry-scoped, positive
caches remain intact, and no artist/path-specific condition exists.

## Step 2.4.4 meter and visual QA checks

Assert the enhanced meter's exact segment endpoints, monotonicity, continuity,
and clamping. Test attack/release by elapsed time rather than frame count,
900 ms hold, 12 dB/s decay, pause freeze, and reset on seek/track identity.

Validate LUFS-S at 44.1 and 48 kHz with a deterministic three-second window,
K-weighting filter state, startup/silence behavior, stereo summation, ring
wrap, bounded memory, and no allocation in the per-sample hot path. Compare a
real-file window with FFmpeg `ebur128`; document the position and difference.
Do not label sample peak as true peak and do not add integrated loudness, LRA,
gating history, or normalization.

Run the real Neutralino/WebView at 1280×800, 1366×768, 1600×900, 1280×720,
and 1024×600. Inspect populated and neutral Technical states, all four meter
modes plus None, pause/resume/seek, MP3 and FLAC, List/Grid, toast layering,
scroll/remount, warm reload, and at least 20 rapid track-change commands.
For the Taylor 14-track fixture, verify every metadata result, artwork ref,
HTTP image response, and visible row thumbnail, including the bottom of the
scrolled list.

## Step 2.6 Library browsing checks

In addition to the scanner cases:

1. verify stable Album, Artist, and Track ordering across keyset page
   boundaries, including duplicate visible names and missing metadata;
2. verify album disc/track ordering and artist ordering with compilations,
   album-artist ownership, duplicate joins, and an album-less tail;
3. verify available, partially available, and unavailable entities without
   exposing a native path in any browse response;
4. tap a non-first Track and confirm the complete ordered context is created
   with that exact Track current immediately;
5. confirm Album/Artist Play filters unavailable files and fails before queue
   mutation when no playable file remains;
6. confirm Add appends without interrupting the current Track and that rapid
   Play commands remain latest-request-wins;
7. switch persistent Library segments and the independent Album Grid/List
   preference, open nested Artist -> Album details, and verify Back restores
   the prior list position;
8. inspect lazy artwork placeholders, sibling menu semantics, reduced motion,
   touch target sizes, and the 192-item DOM cap;
9. complete a scan while browsing and confirm only Library pages invalidate:
   there is still one Library SSE connection and no progress-driven refetch;
10. measure browse/detail/context latency on at least a generated 1,000-Track
    catalog and label desktop figures as desktop-only.

Repeat populated visual inspection at 1280x800, 1366x768, 1600x900,
1280x720, and 1024x600.

## Step 2.7 Library Search and compact-toolbar checks

1. verify on-demand header Search, focus, two-character minimum, 250 ms
   debounce, immediate Enter, Clear, Escape, retry, and stale-request abort;
2. verify grouped Artists/Albums/Tracks ordering, totals, unavailable state,
   Album/Artist detail Back, all three paged View all routes, one sentinel,
   192-row bound, and grouped/category/detail scroll restoration;
3. verify case/space/accent matching and exact, prefix, word-prefix, contains,
   alphabetical, and stable-ID ordering across opaque cursor boundaries;
4. play a non-first grouped and View all Track and confirm its full available
   Album context (or one album-less Track), direct selected index, one queue
   transition, current-catalog rebuild, and unchanged Queue on an unavailable
   or changed selection;
5. verify Track/Album/Artist Add remains secondary and does not interrupt the
   current item, while unavailable actions are disabled;
6. confirm Library root has no Rescan/Cancel, Manage is beside Grid/List in the
   single toolbar row, Grid/List exists only for Albums, Search hides that
   toolbar, and Manage alone retains Rescan/Cancel;
7. complete/cancel a scan and confirm one controlled Search refetch only after
   completion, the unchanged passive toast, one Library SSE, and no polling;
8. run `npm.cmd run benchmark:library-search`, retain EXPLAIN evidence, and
   inspect Search, compact toolbar, mini-player, and Queue at 1280x800,
   1366x768, 1600x900, 1280x720, and 1024x600.

## Step 2.7.1 Sources, Search playback, and Queue refinements

1. verify Sources orders Rescan Library before Add Folder and swaps only the
   first action to Cancel Scan for queued/scanning/cancelling state;
2. add a temporary Source while idle and while another scan is active; confirm
   only its persistent ID is queued once in the existing scheduler, removal
   drops pending work, and failure preserves the Source;
3. verify Albums keeps Albums/Artists/Tracks left and Search, Manage, Grid/List
   right on one row; Artists/Tracks omit Grid/List; Search hides the toolbar;
4. compare the scoped Search input and toolbar controls at 56 px, including
   centered Clear, unclipped focus, and the suppressed native cancel control;
5. exercise grouped and View all Track tap/menu Play, Album Play album, Artist
   Play all, all Add variants, current-catalog changes, unavailable state, and
   direct selected index without a transient first Track;
6. confirm the Queue drawer has no Add Files label/listener/focus target while
   row play, remove, clear, keyed reconciliation, scrolling, native Open Files,
   folder opening, and drop handling remain unchanged.

## Step 2.6.1 Manage Library and scan-notification checks

1. confirm Library root contains no summary or scan panel, exposes Search and
   the single compact segmented/Grid/List/Manage toolbar, and keeps
   Rescan/Cancel exclusively in Manage Library;
2. open Manage Library and verify Back restores the exact segment, Album
   Grid/List mode, loaded pages, prior detail route where applicable, and
   scroll position;
3. verify Summary, detailed scan statistics, empty/error states, the compact
   Source overview, Source Rescan/Retry, and Open Sources without duplicated
   Add/Rename/Remove controls;
4. start scans from Library, Manage Library, and Sources and confirm one keyed
   toast updates in place across queued, scanning, cancelling, completed,
   cancelled, failed, interrupted, and Source-unavailable states;
5. verify determinate progress only with a reliable total, otherwise an
   accessible indeterminate progress state, and no invented percentage;
6. measure no more than four visual toast updates per second, immediate
   terminal rendering, 2.5-second completed/cancelled dismissal, persistent
   failure, and cancellation of pending callbacks on teardown;
7. navigate while scanning and confirm the passive toast persists without
   buttons, page-level Manage navigation does not stop the scan, progress
   updates do not reset inactivity, and exactly one Library EventSource and one
   toast host exist;
8. inspect Library, Manage, progress/normal toast stacking, mini-player, and
   scrolling at 1280x800, 1366x768, 1600x900, 1280x720, and 1024x600.

## Step 2.7.2 Technical and toast checks

1. verify Crest attack at 125 ms, release at 1.8 s, frame-rate independence,
   invalid/missing sample handling, bounded long gaps, and identity reset;
2. verify LUFS-S remains unsmoothed and the Technical labels, tabular digits,
   compact meter, and visualizer cycle are unchanged;
3. inspect responsive 48–58 px Crest/LUFS-S values without clipping at
   1280×800, 1280×720, and 1024×600;
4. verify one accessible 40×40 px dismiss button on transient and progress
   toasts, independent closure, visible focus, and cancellation of pending
   callbacks;
5. dismiss an active Library run and confirm later updates and terminal state
   for the same `scanId/sourceId/generation` remain hidden, while the next run
   appears; retain one toast host, one Library SSE, and no toast management
   actions.

## Step 2.8 Favorite Tracks checks

1. migrate v1 and v2 databases to v3; verify idempotent add/remove, FK cascade,
   timestamp order, stable tie-breaker, opaque keyset cursor, and the indexed
   query plan;
2. verify one bounded batch-status request for visible Track IDs and synchronized
   optimistic state across Library Tracks, Album/Artist detail, grouped/View all
   Search, Favorites, and indexed Queue rows, including rollback on failure;
3. confirm the heart never plays or creates a success toast, while the menu uses
   the shared success toast and updates every mounted copy;
4. tap a non-first Favorite and Play all beyond the mounted page; assert direct
   selected index, one atomic Queue replacement, unavailable filtering, and no
   Queue/current mutation on failure or Favorite removal;
5. inspect empty/populated/unavailable states, one sentinel, preserved scroll,
   44 px heart hit areas, menu focus, and Folders-only/Library-only/Both at
   1280x800, 1280x720, and 1024x600 in the real Neutralino/WebView2 app.

## Step 2.8.2 Favorite Albums and Artists checks

1. migrate v1, v2, and v3 databases to v4; verify dedicated tables, real
   cascading foreign keys, idempotency, timestamps, indexed newest-first
   keyset pages, tie-breakers, and retained offline/removed entities;
2. verify the persistent Tracks/Albums/Artists segmented control, unchanged
   Track behavior, independent Grid-default Album Grid/List, Artist touch list,
   bounded pages, preserved scroll, approved empty states, and no Search;
3. exercise Album/Artist hearts on Library root, details, grouped/View-all
   Search, and Favorites; confirm 44 px sibling targets, dynamic labels,
   synchronized optimistic state, rollback/error toast, and no success toast;
4. exercise each contextual menu and confirm single-entity Play/Add-to-Queue,
   Add/Remove wording, shared success toast, unavailable disabling, detail tap,
   focus restoration, and no nested buttons;
5. verify Album Play all ordering and Artist context ordering across
   collaborations/compilations, global Track-ID deduplication, unavailable
   filtering, atomic Queue replacement, and unchanged Queue on resolution
   failure;
6. inspect Tracks, Album Grid/List, Artists, Library/Search/detail hearts,
   empty/unavailable states, Default/Cassette/mini-player, Queue, and toast at
   1280x800, 1280x720, and 1024x600 in the real Neutralino/WebView2 app.

## Step 2.5 indexed Library checks

Verify the indexed Library separately from on-demand Folders:

1. first launch automatically scans every configured Source once;
2. restart with a populated database starts no automatic rescan;
3. a manual all-Source scan and Source-menu scan use the same single scheduler;
4. unchanged files perform no metadata parse;
5. new, modified, missing, reappearing, invalid-metadata, Unicode, and
   same-relative-path/different-Source cases retain correct identity;
6. hidden/system entries and symlink/junction escapes are excluded;
7. cancellation and partial traversal mark no unseen Track unavailable;
8. removal changes no media and preserves catalog identity;
9. corrupt database recovery preserves a timestamped backup and exposes no
   path to the UI;
10. shutdown during a scan leaves no process and restart shows no non-terminal
    scan.

Use a generated temporary fixture for long cancellation/progress tests. Keep
it outside the repository and user media directories, and delete it after the
run. Inspect Library at 1280×800, 1366×768, 1600×900, 1280×720, and
1024×600 with empty, scanning, cancelled, completed, and populated states.

## Cassette frame checks

The Step 2.6.3 regression suite parses PNG headers with Node standard APIs to
guard the approved frame identity, 1070×710 RGBA format, runtime URL, and
single-raster boundary. It also guards the master as a non-runtime PNG,
decode-before-commit behavior, finite premium → prototype → Default fallback,
shared scene geometry, layer order, CSS scoping, bounded SVG content,
area-based tape physics, and the single 30 fps animation controller.

The Step 2.6.3-R regression suite additionally fixes the physical contract:
right source, left destination, negative/counterclockwise rotation for both
reels, empty-reel speed greater than full-reel speed, equal speed at equal
radii, exactly two radius-driven tape masses clipped to a static,
semi-transparent centre window, one-pixel windings without extra circles, and
full radii bounded by the cassette sides. Its
60/180/360-second Queue cases verify duration-weighted progress, natural track
boundaries, seek, partial metadata, append/remove/replace, and invalid inputs.

The Step 2.6.3-P polish suite guards the two official local TTF assets and OFL
licenses, documented SHA-256 identities, absence of remote/base64 font loading,
Cassette-only font scoping, the lower-label safe rectangle, normalized missing
metadata states, the single `Artist - Album` line, bounded fitting and
final-resort ellipsis. It also verifies all
three Music browsing visibility modes, Default callback plumbing for Library,
Folders, Volume, and Queue, shared time formatting, total/remaining semantics,
duration edge cases, seek preview, static metadata layer order, and absence of
a second slider, timer, observer, or animation-loop update.

For Windows release QA, run the real `npm.cmd run dev` path and inspect Default
and Cassette at 1280×800, 1366×768, 1600×900, 1280×720, and 1024×600.
Verify the decoded premium swap, reel centres, counterclockwise markers,
radius-relative speed, static semi-transparent centre window, visible tape
packs at Queue start/middle/end, play/pause/seek,
Nothing You Could Do artist/album fitting (including missing, late, long, and
accented metadata), Bitcount Single elapsed and total/remaining display,
Library/Folders visibility modes, the existing Volume popover and Queue drawer,
unchanged mini-player controls, return to Default without playback mutation,
absence of remote font requests and FFmpeg in Cassette, and clean shutdown.
Test asset failure with the prototype still mounted; do not weaken or bypass
production loading logic.

## On-screen keyboard checks

Run the package editing/layout suite and the Eidetic adapter regression suite,
then exercise the real Neutralino/WebView2 path:

1. confirm touch and pen open opted-in fields while mouse and physical-keyboard
   focus do not, and that Auto/Off persists immediately;
2. verify caret insertion, selection replacement, Backspace, Clear,
   `maxlength`, one-shot Shift, double-tap Caps Lock, symbols, Hide, Escape,
   Search's single Enter, and Done;
3. cover text, numeric, and IPv4 fixtures, plus disabled, readonly, password,
   removed, and unregistered fields;
4. verify navigation, field removal, animations Off, reduced motion, and shell
   teardown leave no visible keyboard or duplicate listener/controller;
5. inspect the alphabetic and `123` grids at exact client viewports 1280 x 800,
   1280 x 720, and 1024 x 600. Confirm full-width rows, the alphabetic stagger,
   symmetric symbol controls, 64/56 px key heights, safe-area behavior, input
   visibility, mini-player layering, and no horizontal overflow;
6. inspect Default, Cassette, and mini-player surfaces to confirm that none has
   become an opt-in field and their geometry is unchanged.

## Step 2.9 Recently Played checks

1. migrate every earlier Library schema to v5; verify the two history indexes,
   Track cascade, offline retention, keyset boundaries, 90-day cleanup, and
   newest-500 cap;
2. verify 30-second/50-percent/unknown-duration thresholds using real playback
   deltas, with pause, buffering, seek, sleep-sized gaps, unindexed Tracks, and
   duplicate transition events excluded;
3. verify 90-percent and natural completion update the same event, consecutive
   duplicate Tracks replace the newest event, and a Track after an intervening
   event creates a new row;
4. exercise Today/Yesterday/full-date groups, one sentinel, the 192-row bound,
   unavailable rows, Favorite, single-Track Add, event Remove, confirmed footer
   Clear, exact empty state, and absence of Search;
5. play a non-first event beyond the mounted page and confirm the full available
   history is deduplicated newest-first, the selected index is direct, and no
   transient first Track starts;
6. verify Auto, Always, and Off live on the standard selection sub-screen,
   persist immediately, and return to Interface after selection; mouse and
   keyboard focus open in Always, touch/pen alone opens in Auto, ineligible
   fields stay closed, and host native-keyboard preference wins;
7. inspect drawer visibility, Default, Cassette, mini-player, Queue, and the
   keyboard at 1280 x 800, 1280 x 720, and 1024 x 600, then confirm clean
   Neutralino/backend/Vite/MPV/FFmpeg shutdown and no temporary fixture remains.

## Step 2.9.1 History and statistics checks

1. migrate v1 through v5 to schema v6; verify strict stats storage, ranking
   index, zero history backfill, offline retention, Track cascade, and reset;
2. verify each qualified transition increments once, consecutive plays count
   separately, completion increments once, and bounded real seconds exclude
   pause, seek, buffering and anomalous gaps;
3. verify Most Played count/last/ID keyset ordering, unavailable rows, full
   backend playback context, direct selected index, single-Track Add, Favorite,
   one sentinel and 192-row bound;
4. verify the six empty and populated Stats values, separate confirmed resets,
   and that Recent clear and Stats reset never affect each other;
5. inspect the simplified Queue drawer and the single toast host on Default,
   Cassette, Library, Favorites and History. Confirm bottom anchoring with and
   without mini-player, upward stacking, progress/dismiss behavior, and keyboard
   overlay priority;
6. inspect 1280 x 800, 1280 x 720 and 1024 x 600, then confirm clean shutdown
   and no project listeners or temporary QA artifacts remain.

## Step 2.10 Playlist and Queue reorder checks

1. migrate v1 through v6 to schema v7 and verify strict Playlist tables,
   cascade behavior, normalized unique names, duplicate item IDs, keyset order,
   unavailable retention, and absence of native paths in API data;
2. verify picker add, create-and-add, duplicate confirmation, Play all, direct
   selected-item playback, duplicate preservation, and available-only Queue
   building;
3. drag Playlist and Queue handles with mouse and touch Pointer Events; verify
   one persistence operation, rollback, auto-scroll, stable item/current IDs,
   unchanged playback/session/transition, and one Queue revision;
4. inspect the Queue footer Add to Playlist action beside Clear Queue, including
   mixed/unindexed Queue disabling and whole-Queue ordering;
5. inspect list, detail, dialogs, on-screen keyboard and all three player
   surfaces at 1280 x 800, 1280 x 720, and 1024 x 600, then verify clean
   shutdown and no residual listeners, captures, dialogs, or fixtures.
