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

Linux adds `doctor:linux`, `test:linux`, `test:posix`,
`test:case-sensitive`, `build:linux`, `smoke:linux`, and `verify:arm`.
Run them from a native case-sensitive filesystem. Static ARM inspection is not
runtime evidence.

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
and native dialogs.

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
