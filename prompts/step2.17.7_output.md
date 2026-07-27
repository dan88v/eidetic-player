# Step 2.17.7 — Playback Command Responsiveness Corrective

## Status

`READY FOR CI VALIDATION — RASPBERRY COMMAND/SETTINGS VALIDATION NOT STARTED`

No commit, push, merge, rebase, reset, restore, stash, clean, Raspberry update,
or Raspberry mutation was performed.

## Git and CI baseline

- Branch: `main`.
- Local HEAD and `origin/main`:
  `7ca41aef70f1f393fe717a820cb962f279a660ab`.
- Ahead/behind: `0/0`.
- Worktree before the step: clean.
- Step 2.17.6: present.
- Exact-head GitHub Actions run: `30301018493`, green.
- Initial `git diff --check`: PASS.

## Windows baseline

The baseline used the mandatory real Windows command `npm.cmd run dev`, the
Neutralino/WebView2 application, its backend, and the configured real MPV
executable.

- Build ID: `7ca41ae-dev`.
- MPV: available.
- Queue count: 16.
- Current index: 0.
- Position: approximately 6.23 seconds.
- Playback: paused.
- Volume: approximately 97.99.
- Mute: off.
- Shuffle: off.
- Repeat: off.
- Audio Output preference: automatic/default selection.
- Favorites and Settings were read without mutation; no value relevant to this
  step changed.

The controlled SMB baseline exposed delayed state confirmation. A rapid Queue
selection took approximately 572 ms to reach its final item on Windows.
Baseline Play/Pause, Volume popover, Queue, Mute/Unmute, and Power → Quit were
exercised with real mouse input. The initial playback values were restored
before implementation.

## Audited command pipeline

| Command    | API                           | `PlayerService`  | MPV operation                          | Confirmation                                  |
| ---------- | ----------------------------- | ---------------- | -------------------------------------- | --------------------------------------------- |
| Volume     | `POST /api/player/volume`     | `setVolume`      | `set_property volume`                  | matching `volume` property or focused read    |
| Mute       | `POST /api/player/mute`       | `setMuted`       | `set_property mute`                    | matching `mute` property or focused read      |
| Play       | `POST /api/player/play`       | `play`           | `set_property pause false`             | matching `pause=false`                        |
| Pause      | `POST /api/player/pause`      | `pause`          | `set_property pause true`              | matching `pause=true`                         |
| Play/Pause | `POST /api/player/play-pause` | `playPause`      | explicit `set_property pause <target>` | matching `pause` target                       |
| Next       | `POST /api/player/next`       | `next`           | `set_property playlist-pos`            | IPC acceptance; media load tracked separately |
| Previous   | `POST /api/player/previous`   | `previous`       | exact seek or `playlist-pos`           | IPC acceptance; media load tracked separately |
| Queue row  | `POST /api/player/queue/play` | `playQueueIndex` | stable-ID-resolved `playlist-pos`      | IPC acceptance; media load tracked separately |

The complete path remains:

`control → PlayerApiClient → REST → PlayerService → MpvController → one
MpvTransport/JSON IPC connection → observed MPV property → PlayerState/SSE →
PlayerStore → component → intent-only preferences`

## Root-cause matrix

Classification: **I — MULTIPLE**.

| Cause                         | Finding                                                                                             | Corrective                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A — transition suppression    | Volume, mute, and pause publication was suppressed during `transitionPending`/playlist preparation. | Interactive properties now reconcile and publish during transitions.                             |
| B — refresh race              | An older multi-property refresh could apply after a newer transition or command.                    | Refresh, transition, and per-property generations reject stale results.                          |
| C — IPC head-of-line blocking | A large read refresh could occupy the request path ahead of controls.                               | Interactive requests bypass a bounded two-read background lane on the same IPC connection.       |
| D — UI snapshot override      | `VolumePopover.setState()` could move the active drag preview.                                      | Pointer capture owns the preview; snapshots update only the confirmed baseline.                  |
| E — toggle race               | `cycle pause` depended on an already stale state.                                                   | Play/Pause uses the pending target, otherwise the confirmed target, and sends an explicit value. |
| F — audio initialization wait | Playback/navigation awaited `beforePlayback`.                                                       | Audio preparation starts without blocking command dispatch.                                      |
| G — preference reapply        | Every MPV snapshot was offered to persistence.                                                      | Only confirmed user intents are persisted.                                                       |
| H — event-loop blocking       | No independent blocking metadata/artwork/Queue loop was demonstrated.                               | No speculative worker, timer, dependency, or redesign was added.                                 |

The final Windows rapid-navigation check also exposed a UI-side ordering detail:
concurrent HTTP requests can arrive in a different order. Next/Previous now
carry the stable pending Queue target as well as the monotonic client intent.
The backend discards any older arrival before it can own IPC state.

## Command intent coordinator

- One random UI client-session UUID.
- One monotonically increasing UI intent ID.
- One monotonically increasing backend service generation.
- Separate Volume, Mute, Transport, and Navigation state.
- Phases: pending, acknowledged, confirmed, failed, superseded.
- Latest intent wins within a client session, including reordered HTTP
  arrival.
- Public state carries only opaque command identity and targets.
- Development/test diagnostic rings are bounded to 96 UI and 192 backend
  entries.
- Diagnostics contain no path, filename, title, artist, credentials, username,
  device identity, or media metadata.
- No public diagnostic endpoint, polling, permanent timer, or production log
  stream was added.

## Volume and Mute

- Volume remains validated within 0–100.
- The target is public immediately and is not suppressed by track loading.
- A new target supersedes the previous target without waiting for timeout.
- A stale zero or other materially different property cannot move state or
  preferences while a newer target is pending.
- Confirmation tolerance is 0.55, so harmless MPV rounding does not oscillate.
- Mute uses the same latest-intent and rollback rules.
- A pending level command is reapplied at most once after `audio-device` or
  `current-ao` changes in the same MPV instance.

## Play/Pause and navigation

- `cycle pause` was removed from the interactive path.
- Play, Pause, and Play/Pause send an explicit `pause` target.
- Controls remain available during loading when MPV and a valid Queue exist.
- Repeated Next uses the pending stable target as its base.
- Previous preserves the >3-second restart rule when no navigation is pending,
  then uses the pending target during a transition.
- Queue selection carries a stable Queue item ID and resolves it after reorder.
- Navigation IPC acceptance is separate from a slow `file-loaded`.
- No MPV restart, second MPV, Queue rebuild, fixed sleep, or arbitrary
  event-ignore window was introduced.

## IPC priority and transition generations

- `MpvTransport` retains one IPC connection.
- Interactive requests are written immediately.
- Background `get_property` work is bounded to two active reads.
- Queued background reads cannot precede a newly arrived interactive command.
- Refresh work captures refresh and transition generations.
- Each observed property has a version; a read begun before that version
  cannot overwrite it.
- Obsolete transition callbacks and refresh results are discarded and recorded
  as stale.
- Continuously observed volume, mute, audio device/list, and current AO are no
  longer redundantly included in the broad transition refresh.

## Slider, persistence, timeout, and failure

- Pointer drag updates local geometry immediately.
- Active pointer capture prevents snapshot bounce.
- Live commands remain bounded to the existing 100 ms drag cadence.
- Pointer release sends the final target and flushes preferences.
- Pointer cancel or closing during capture returns to the last confirmed
  value.
- Arrow, Page, Home, and End keys send an immediate final target.
- Confirmed Volume/Mute user intents are persisted.
- Shuffle/Repeat are persisted after their user API action succeeds.
- Ordinary MPV telemetry snapshots are not persisted.
- Property confirmation timeout is bounded to two seconds.
- Timeout/failure rolls Level and Transport UI back to last confirmed state,
  preserves the valid preference, and increments one warning revision.
- No retry loop or automatic inverse command exists.
- If shutdown occurs after IPC acknowledgement but before property
  confirmation, the runtime may retain MPV's accepted state; durable UI
  preferences retain the last property-confirmed user value.

## Timing diagnostics

Real Windows Neutralino → backend → persistent MPV evidence:

- Corrective Play/Pause was received and property-confirmed by the 100 ms
  sample; the immediate sample preceded event dispatch and still showed the
  prior state.
- A temporary four-track WAV folder outside the repository and user media was
  used for deterministic final IPC checks.
- Measured HTTP-to-IPC acknowledgements:

| Command                              | Acknowledgement |
| ------------------------------------ | --------------: |
| First Next during initial transition |        210.0 ms |
| Volume 63                            |          6.9 ms |
| Pause                                |         45.5 ms |
| Play                                 |         13.4 ms |
| Second Next                          |          3.9 ms |
| Previous                             |          5.0 ms |
| Mute                                 |          6.4 ms |
| Unmute                               |          4.5 ms |

The final state was Queue index 1 as requested, Volume 63, unmuted, playing,
with all four command classes confirmed. Queue count remained 4 and Queue
revision remained 2. No media path or title is included in this report.

## Automated tests

Focused corrective suite: 31/31 PASS.

Coverage includes:

- loading/start-file command acceptance;
- stale zero and refresh rejection;
- rapid levels, rounding, acknowledgement without property confirmation,
  timeout, and rollback;
- Mute and Transport stale events;
- property confirmation before IPC acknowledgement;
- audio-output reapply;
- explicit pause targets;
- Next–Next with a blocked audio-preparation hook;
- Previous restart/no-op semantics;
- stable Queue ID after reorder;
- reordered HTTP arrival and latest target;
- UI optimistic rollback and old API failure rejection;
- drag/keyboard/pointer-cancel source contract;
- intent-only persistence;
- controls enabled during loading;
- one persistent MPV rapid mixed-command sequence;
- bounded background IPC priority.

## Real MPV integration

The real integration suite was expanded to use one persistent MPV process for:

1. playback;
2. Next + immediate Volume + Pause + Play;
3. a following Next + Previous;
4. Mute + Unmute;
5. final Volume 63;
6. final playing/unmuted state;
7. expected Queue index, stable Queue IDs, and unchanged Queue revision;
8. expected sanitized diagnostic lifecycle stages.

No second MPV process is started by the corrective.

## Windows real QA

The real application was started with exactly `npm.cmd run dev`.

| Check                                        | Result                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| SMB Windows baseline and regression control  | PASS                                                                    |
| Deterministic local temporary WAV playback   | PASS                                                                    |
| Real mouse Play/Pause post-corrective        | PASS, confirmed by 100 ms                                               |
| Real backend/MPV mixed rapid commands        | PASS                                                                    |
| Multiple Next + Previous stable final target | PASS                                                                    |
| Volume/Mute final confirmation               | PASS                                                                    |
| Queue stable identity                        | PASS                                                                    |
| Volume drag preview/pointer cancel/keyboard  | PASS by focused DOM/controller tests; baseline mouse geometry inspected |
| Settings and Audio Output non-regression     | PASS; values unchanged                                                  |
| Touch scrolling                              | unchanged protected implementation; no corrective diff                  |
| Power → Quit                                 | PASS in baseline real application                                       |

Actual Neutralino/WebView2 visual inspection:

| Client viewport | Result |
| --------------- | ------ |
| 1280 × 800      | PASS   |
| 1024 × 600      | PASS   |
| 1024 × 768      | PASS   |
| 1366 × 768      | PASS   |

Controls remained visible and aligned, artwork/placeholder geometry stayed
reserved, and no white flash, overflow, layout shift, stale artwork, or
full-screen reconstruction was observed. The final desktop session later
stopped accepting foreground input (`GetForegroundWindow=0`); this is recorded
instead of misrepresenting later injected clicks as physical evidence.

## Full local gates

Final gate result: PASS.

| Gate                                                                    | Result      |
| ----------------------------------------------------------------------- | ----------- |
| `npm.cmd run format:check`                                              | PASS        |
| `npm.cmd run typecheck`                                                 | PASS        |
| `npm.cmd run lint`                                                      | PASS        |
| `npm.cmd run build`                                                     | PASS        |
| `npm.cmd run build:linux`                                               | PASS        |
| `npm.cmd test`                                                          | PASS        |
| `npm.cmd run test:posix`                                                | PASS        |
| `npm.cmd run verify:network:deployment`                                 | PASS        |
| `npm.cmd run verify:linux:executables`                                  | PASS        |
| `npm.cmd run verify:linux:installer`                                    | PASS        |
| `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build` | PASS        |
| `npm.cmd run mpv:doctor`                                                | PASS        |
| `npm.cmd run test:mpv`                                                  | PASS, 10/10 |
| `npm.cmd run ffmpeg:doctor`                                             | PASS        |
| `npm.cmd run test:ffmpeg`                                               | PASS, 3/3   |
| `git diff --check`                                                      | PASS        |

The first complete attempt correctly stopped at lint after format and
typecheck passed. ESLint identified 17 new-file style/type-policy violations;
all were corrected automatically or directly, then focused lint, typecheck,
and corrective tests passed. The complete gate sequence was rerun from the
start and passed without exclusions or configuration changes.

## Files modified

Implementation is limited to:

- shared Player command state/metadata;
- command body validation and routes;
- `PlayerService`, `MpvController`, and `MpvTransport`;
- UI Player API, store/coordinator, AppShell, Queue, Volume, and loading control
  state;
- intent-specific persistence wrappers and one warning string;
- focused backend, UI, and real MPV tests;
- development diagnostics enablement;
- development documentation and this report.

`apps/ui/src/screens/now-playing.ts` and `mini-player.ts` each have the
strictly necessary one-line loading-control correction required by the step:
they no longer disable transport merely because a valid Queue is loading.

Protected diff review is empty for:

- `package.json`;
- `package-lock.json`;
- `.github/workflows`;
- `deploy`;
- backend SMB, Network, and Library;
- `reliable-touch-scroll.ts`;
- `packages/shared/src/preferences.ts`.

Package plan and dependency graph are unchanged. Installer/updater, Audio
Output device selection, PipeWire/WirePlumber/ALSA configuration, GPIO/I²S,
PCM5102A, HDMI, and Raspberry files are unchanged.

## Cleanup and original state

- The original Windows values were restored after the baseline.
- Final deterministic QA used generated temporary WAVs outside the repository
  and user media; they are removed during final cleanup.
- The development session is shut down through the application/development
  lifecycle and checked for residual Neutralino, backend, Node/Vite, MPV,
  FFmpeg, IPC, and ports 4310/5173.
- The repository contains no media fixture, screenshot, credential, personal
  path, cache, or generated build artifact from QA.

## Pre-CI checkpoint

- Commit: not created.
- Push: not performed.
- Exact-head CI for these changes: not started.
- Raspberry update: not started.
- Combined Step 2.17.6 Settings migration/restart/updater no-op: not started.
- Raspberry command responsiveness: not started.
- Original Raspberry Settings/Audio Output/Queue state: not touched.

`READY FOR CI VALIDATION — RASPBERRY COMMAND/SETTINGS VALIDATION NOT STARTED`

## Post-CI Raspberry matrices

These are intentionally pending and must use one update only after manual
commit/push and exact-head CI green.

### Settings persistence

| Check                         | Result      |
| ----------------------------- | ----------- |
| Migration result              | NOT STARTED |
| Full Settings test vector     | NOT STARTED |
| Service restart               | NOT STARTED |
| Updater no-op                 | NOT STARTED |
| Original Settings restoration | NOT STARTED |

### Audio paths

| Path        | Responsiveness | Stability   | Distortion at 100% | Notes                          |
| ----------- | -------------- | ----------- | ------------------ | ------------------------------ |
| PipeWire    | NOT STARTED    | NOT STARTED | NOT STARTED        | Device not selected or changed |
| ALSA/dmix   | NOT STARTED    | NOT STARTED | NOT STARTED        | Device not selected or changed |
| ALSA direct | NOT STARTED    | NOT STARTED | NOT STARTED        | Device not selected or changed |

### Playback commands and restoration

| Check                                        | Result      |
| -------------------------------------------- | ----------- |
| Volume after Next at 0–100/250/500 ms        | NOT STARTED |
| Pause/Play after Next                        | NOT STARTED |
| Multiple Next                                | NOT STARTED |
| Previous restart/previous/loading            | NOT STARTED |
| Queue latest selection                       | NOT STARTED |
| Mute/Unmute during transition                | NOT STARTED |
| Slow/fast slider and release                 | NOT STARTED |
| Volume persistence after restart             | NOT STARTED |
| DAC 80/95/100% user observation              | NOT STARTED |
| Original Audio Output restoration            | NOT STARTED |
| Original Settings/playback state restoration | NOT STARTED |
| Raspberry cleanup                            | NOT STARTED |

Do not declare either Raspberry PASS state until these matrices are completed:

- `RASPBERRY PLAYBACK COMMAND RESPONSIVENESS — PASS`
- `RASPBERRY SETTINGS PERSISTENCE ACROSS UPDATE — PASS`
