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
