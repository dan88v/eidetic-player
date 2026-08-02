# Step 3.1 output — External Playback Source Arbitration Core

## Status

Implementation and final repository validation are complete locally. No
production external provider is installed or deployed.

## Baseline Git and CI

- Branch: `main`.
- Baseline HEAD and `origin/main`:
  `bccbf44d48140f04761f45c06ffa4fec6c05d90f`.
- Ahead/behind before editing: `0/0`.
- Working tree before editing: clean; no merge or rebase in progress.
- Step 2.17.14 report present.
- Exact-head Linux CI job verified green:
  <https://github.com/dan88v/eidetic-player/actions/runs/30718626997/job/91418491123>.
- No commit, push, merge, rebase, reset, restore, stash, or clean was run.

## Architecture audit

| Responsibility                                             | Existing owner                       | Step 3.1 integration                                                        |
| ---------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| Local playback and one MPV                                 | `PlayerService`                      | Narrow suspend/release/restore methods; ownership remains unchanged         |
| Current, Context, Explicit Queue, History and continuation | Player Session v3 / Playback Planner | Flushed and preserved; not copied into arbitration storage                  |
| Local command ordering                                     | command-intent coordinator           | External commands use the same request metadata and latest-intent semantics |
| Selected physical output                                   | `AudioOutputService`                 | Local adapter resolves only the selected, available physical route          |
| Fixed/Variable level and local DSP                         | `AudioProcessingService`             | Arbiter enforces global level; DSP remains MPV-only and is restored locally |
| Local state transport                                      | existing player SSE                  | One named `playback-source` event added to the same stream                  |
| Remote state transport                                     | existing multiplexed Remote SSE      | Source event added to the same connection; no second `EventSource`          |
| Display idle                                               | `DisplayIdleController`              | Receives an active-playback selector including external playing/buffering   |
| Preferences                                                | `PreferencesStore` / controller      | Schema 4 adds the end policy with atomic migration behavior                 |
| Power/update lifecycle                                     | existing preparation hooks           | Arbitration flush and bounded release participate in preparation/shutdown   |
| MPV recovery                                               | existing recovery coordinator        | Reinitializes arbitration after a recovered local core                      |

No responsibility was moved out of its existing authoritative owner.

## Shared contracts and provider interface

- Added typed source kind, phase, provider state, capabilities, external
  metadata, opaque artwork reference, active output, sanitized error, and
  `PlaybackSourceSnapshot` contracts in `packages/shared`.
- Added a narrow `ExternalPlaybackProvider` interface with probe, subscription,
  route configuration, acquire/release, transport, seek, level, snapshot, and
  shutdown methods.
- Provider events include session ID, generation, monotonic timestamp, bounded
  validated snapshot, and a closed event-kind union.
- No raw provider payload, path, URL, secret, environment, command, or stack is
  exposed through the public model.

## Local adapter and verified MPV output release

`LocalPlaybackAdapter` wraps the existing `PlayerService`, Player Session,
Audio Output, and Audio Processing services. The suspension token contains only
session/occurrence/generation/revision identity, position, prior play state,
level state, and capture time.

The audited release sequence on the installed MPV build is:

1. flush Player Session;
2. capture the minimal local token;
3. set pause and confirm `pause=true`;
4. issue `stop keep-playlist` on the existing MPV instance;
5. confirm `idle-active=true` and `current-ao` unavailable;
6. keep the same MPV process alive with no audio owner.

Restore prepares the same selected output, reloads the preserved current
occurrence, seeks to the captured position, restores level/mute, reapplies the
MPV DSP chain, and resumes only when the transaction policy permits it.

Real MPV used: `C:\Tools\mpv\mpv.exe`, version
`v0.41.0-744-g304426c39`. The real integration suite observed one persistent
MPV PID and passed the release/restore scenario.

## Arbiter, transactions, and rollback

- `PlaybackSourceArbiter` is the single source-owner authority.
- Every transition is serialized and carries a monotonic transition
  generation.
- External acquisition is ordered: capture Local, release MPV output,
  configure the canonical route, apply bounded global level, acquire provider,
  confirm session/state, publish, then atomically persist.
- Initial acquisition failure stops/releases the candidate and restores the
  exact captured local session.
- External-to-external replacement stops and releases the previous provider
  before configuring the candidate. If the candidate fails, Local is restored
  from the preserved token instead of exposing a stopped previous owner.
- A previous provider release failure blocks the candidate and leaves an
  explicit recoverable error; no second owner is activated.
- A paused provider retains ownership with no automatic timeout.
- The last valid serialized external acquisition wins; there is no overlap or
  crossfade.

## Release/end policy and local preemption

`After external playback ends` has two values:

- `Keep local playback paused` (default);
- `Resume interrupted playback`.

Resume-interrupted requires a valid token, Local having actually played before
acquisition, no newer local intent, and a successful restore. Explicit local
content Play, Queue item Play, or `Resume local playback` preempts external
ownership. Add, reorder, remove, and clear of the local Explicit Queue remain
available and do not preempt.

Provider end/disconnect follows the configured policy. Provider crash follows
the bounded release path without an automatic restart loop. A release failure
does not restore MPV onto a possibly contested output.

## Command routing

`ActivePlaybackController` routes Play, Pause, Play/Pause, Previous, Next,
Seek, Volume, and Mute to the active source. Unsupported external commands are
disabled from capabilities and rejected by the backend with
`SOURCE_ACTION_NOT_SUPPORTED`; they are never forwarded to hidden MPV.
Shuffle and Repeat remain local-only.

The existing command validation now preserves seek request metadata so
latest-intent ordering applies consistently. No second PlayerService or Queue
was created.

## Volume, mute, output route, and DSP

- Volume and mute are global and provider changes are persisted only after
  bounded validation and provider confirmation.
- Values are clamped to both 100 and `maximumSoftwareVolume`.
- Fixed output forces 100%, disables mute, and rejects ordinary external level
  commands with `FIXED_OUTPUT_LEVEL_LOCKED`.
- The captured local token is updated after a confirmed external level change,
  so return to MPV uses the same global level.
- External acquisition accepts only the explicitly selected, available
  physical output. There is no silent System-default fallback.
- EQ, Mono, Balance, Headroom, and the labelled DSP chain remain local to MPV.
  External sources do not transit MPV DSP and do not start FFmpeg.
- Signal Path and the Remote source status declare
  `DSP: Not applied to external sources`.

## Arbitration store and startup reconciliation

- Dedicated schema-1 atomic JSON store; not Player Session, Preferences, Audio
  Output, or Remote Access storage.
- POSIX directory/file modes are 0700/0600, with same-directory temporary file,
  fsync, rename, and parent-directory fsync.
- Symlink and unexpected-owner checks are enforced on POSIX.
- Malformed and future-schema files degrade read-only without overwriting the
  evidence.
- The document contains transition identity and minimal local references only;
  no metadata, artwork, paths, or credentials.
- Zero active providers normalizes to Local. One provider is safely adopted.
  Multiple providers are both stopped and released, then MPV is restored
  paused with `MULTIPLE_EXTERNAL_SOURCES`. A stale persisted external session
  normalizes to Local paused.

## Display and Settings

- Local playing/loading behavior is unchanged.
- External `playing` and `buffering` inhibit Dim and Standby.
- External `paused` retains audio ownership but does not inhibit the normal
  idle countdown indefinitely.
- Settings → Playback adds the canonical navigation row and selection page,
  using the existing preference controller, Back behavior, selection checks,
  toast, and touch scrolling.
- Preference schema 4 defaults to `keep-paused`, migrates schemas 1–3 in memory,
  preserves unknown fields, and remains backend-authoritative.

## Local Now Playing, mini-player, and Queue

- Local mode remains `Now Playing`, keeps Favorite and the existing visualizer,
  and retains the established geometry.
- External titles are exactly `Now Playing — Spotify Connect` and
  `Now Playing — AirPlay`.
- Favorite is hidden externally and replaced in the same title-row box by a
  non-interactive, white source-specific SVG with `aria-label` and `title`.
  The glyph is visually scaled without changing the reserved layout box.
- External artwork/metadata/progress are source-owned. Missing artwork uses the
  dark placeholder and never borrows local artwork. Async swaps are guarded by
  the opaque artwork revision so state ticks cannot repeatedly clear a pending
  image.
- Source, DSP, Output, and Level diagnostic rows are intentionally absent from
  the local Now Playing surface following final UI review.
- External visualizers are intentionally absent: providers bypass local
  MPV/FFmpeg analysis, so rendering one would be false data. The local
  visualizer implementation is unchanged.
- `Resume local playback` is an icon control in the lower-right transport. It
  replaces Volume in the same slot only while external playback is active and
  restores Local through the global controller.
- The mini-player reflects the active source and does not expose Favorite for
  external metadata.
- Queue remains local and mutable. Its compact banner identifies the external
  owner without consuming the drawer body; Queue Play takes Local ownership.

## Remote UI and SSE reconnect

- Remote Player, mini-player, artwork, progress, capability controls, local
  Queue, Fixed/Variable presentation, and Resume Local are source-aware.
- Remote artwork is accepted only through a validated opaque endpoint with
  bounded MIME/size/signature checks and `nosniff`.
- The single existing Remote SSE carries the source envelope. No second SSE,
  polling loop, provider configuration, or credential UI was added.
- Local UI SSE reconnect treats the first source snapshot on each connection as
  the new backend baseline. This prevents a restarted backend's lower
  process-local revision from being rejected by a still-mounted UI. Subsequent
  events retain monotonic revision protection.

## Fixture providers and security boundary

- In-process AirPlay and Spotify fixtures simulate start, playing, paused,
  buffering, metadata, artwork, progress, level, end, disconnect, crash,
  acquisition/release failures, unsupported route, and concurrent ownership.
- Fixtures create no external process and are registered only when
  `EIDETIC_EXTERNAL_PLAYBACK_FIXTURE=1` in non-production mode.
- Development control routes are loopback-only and absent when the gate is off.
- No AirPlay, Spotify Connect, Shairport Sync, librespot, Avahi, mDNS, package,
  credential, discovery, or service integration exists in this step.

## Automated and real-system verification

Focused arbitration/store/UI tests cover paused ownership, both end policies,
rollback, failed external replacement, external-to-external arbitration,
latest intent, maximum volume, startup zero/one/multiple/stale recovery,
provider crash/release failure, atomic metadata-free storage, malformed/future
storage, display selection, source-aware presentation, single Remote SSE, and
SSE revision reset after reconnect.

Real Neutralino/WebView2 QA used the mandatory Windows command
`npm.cmd run dev` with the installed MPV and fixture gate. Verified:

- Local baseline and one MPV;
- Spotify and AirPlay acquisition and exact headings;
- opaque source artwork without stale local fallback;
- white enlarged source icons in the Favorite slot;
- no external technical rows or visualizer;
- capability transport and progress;
- compact local Queue banner;
- icon-based Resume Local and restoration to one MPV;
- external-to-external handoff;
- backend hot-reload/SSE resynchronization;
- selected Realtek physical output, Fixed 100%, and mute off.

Native viewports inspected: 1280×800, 1024×768, 1024×600, and 1366×768.
The in-app Browser backend was unavailable in this session, so a true rendered
Remote mobile matrix (320×568, 360×640, 390×844, 412×915, 430×932) could not be
claimed. Remote contracts, automated tests, single-stream behavior, typecheck,
and production build are covered; visual Remote mobile QA remains a recorded
local limitation rather than a false PASS.

## Performance observations

Windows real-path spot measurements on the fixture build:

- external acquire, including MPV output release: 123 ms;
- Resume Local release/restore: 17 ms with an idle preserved local session;
- fixture Pause command: 4 ms;
- fixture Play command: 3 ms;
- active external source JSON snapshot: 873 bytes;
- Local source JSON snapshot: 609 bytes;
- arbitration store revision: exactly +1 on acquire and +1 on release;
- backend observed working set/private memory: 90.8/97.4 MiB;
- backend handles: 320; TCP endpoints/listeners: 5/2 in the full dev stack;
- MPV process count: 1; fixture provider process count: 0;
- additional external FFmpeg process count: 0.

The arbiter adds no polling, permanent interval, provider process, second
EventSource, second MPV, or per-frame work. The existing SSE keepalive remains
unchanged. The real MPV integration release/restore test completed in about
1.45 seconds with media restoration.

## Documentation and package plan

Added `docs/development/playback-source-arbitration.md` and linked it from the
development index and architecture ownership documentation. Preferences docs
now describe schema 4 and the end policy.

No dependency was added. `package.json`, `package-lock.json`, workflow files,
deploy scripts, updater, analyzer, FFmpeg modules, visualizer implementation,
and reliable touch scrolling remain unchanged.

## Final gates

PASS:

- `npm.cmd run format:check`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run build:linux`
- `npm.cmd test`
- `npm.cmd run test:posix`
- `npm.cmd run verify:network:deployment`
- `npm.cmd run verify:linux:executables`
- `npm.cmd run verify:linux:installer`
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`
- `npm.cmd run mpv:doctor`
- `npm.cmd run test:mpv` — 12/12 on the successful isolated rerun; an earlier
  pass had one non-reproduced timing failure in the pre-existing removable
  Library disconnect scenario, while the new arbitration release/restore test
  passed on both runs.
- `npm.cmd run ffmpeg:doctor`
- `npm.cmd run test:ffmpeg`
- `npm.cmd run test:remote`
- `npm.cmd run build:remote`
- `git diff --check`

## Follow-up — Fixed volume visibility and explicit clipping override

Two Audio policy regressions were corrected without changing the established
Settings geometry or introducing another state source:

- the active volume policy now composes the local authoritative
  `AudioProcessingState` with the active Local/Spotify/AirPlay presentation;
  local source updates can no longer overwrite Fixed 100% with an unlocked
  popover policy;
- Default Now Playing no longer unhides its volume trigger on every player
  state update when the central Fixed policy has disabled it;
- source transitions reapply the same composed policy to every existing main
  player volume trigger, so Default and Cassette remain consistent and their
  surrounding geometry stays reserved;
- Fixed output still rejects positive projected gain when Auto or Manual
  headroom is insufficient;
- explicitly selecting Headroom Off now acts as the user's clipping-risk
  override. Sound Processing and Parametric EQ may be enabled with positive
  projected gain, while the existing `positive-gain` signal-path warning and
  Settings warning remain visible.

The Audio copy now states that processing remains available with Headroom Off
and that positive EQ gain can clip. The Settings UI, UI/UX, and preference
contracts document the same distinction between protected Auto/Manual modes
and explicit Off.

Focused automated reproduction failed on both original regressions, then
passed 21/21 after the changes. Real Windows Neutralino/WebView2 QA used the
existing mandatory `npm.cmd run dev` instance after HMR/reload:

- Fixed 100% at 1280×800 showed no volume trigger in Default Now Playing;
- Queue retained the right-side transport slot with no layout shift;
- the real backend/MPV sequence Bypass → Headroom Off → Sound Processing On
  succeeded in Fixed with projected peak gain `+2.5 dB` and
  `warning: positive-gain`;
- the original Auto/On processing preferences were restored immediately after
  the reversible test.

No commit, push, Raspberry deployment, installer, or remote update was
performed.

This follow-up's final gates PASS:

- `npm.cmd run format:check`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`, including local UI, Remote UI, and backend
- `npm.cmd test` — 788 total, 775 passed, 13 expected skips, 0 failed
- `npm.cmd run mpv:doctor`
- `npm.cmd run test:mpv` — 12/12
- focused Audio/Settings/source regressions — 21/21
- `git diff --check`

The complete UI suite separately passed 385/385 after preserving the canonical
local MPV source patterns in Now Playing, mini-player, Display, Queue, and
Remote while keeping external overrides isolated.

## Files modified

Expected scope only: shared source/preferences/Remote contracts; backend source
arbiter/provider/local adapter/store/controller and integration wiring; local
and Remote source-aware presentation; Display/Settings/Queue/mini-player; tests;
development documentation; this report.

## Checkpoint and manual Raspberry handoff

No commit or push was performed. No SSH connection, Raspberry update, reboot,
remote updater, package install, or external system mutation was performed.

After a manual commit/push and exact-head green CI, Raspberry validation is
Local-only: Build ID/readiness, Local active source, one MPV, Context, Explicit
Queue, History, Same artist, selected Audio Output, DSP, Display, Remote UI,
updater no-op, no provider process/listener, and no additional FFmpeg.

Maximum hardware status before that user-run validation:

`RASPBERRY LOCAL-ONLY ARBITRATION SMOKE — USER VALIDATION PENDING`

Local checkpoint:

`READY FOR CI VALIDATION — EXTERNAL SOURCE ARBITRATION NOT DEPLOYED`

## Follow-up — seamless local track changes and Favorite status

The local Now Playing and mini-player follow-up fixes two presentation
regressions without changing MPV navigation, Queue policy, or external-source
ownership:

- Favorite visibility is again owned exclusively by the Favorite store. The
  source layer can suppress the indicator for Spotify/AirPlay, but it can no
  longer force a non-favorite local track's heart visible.
- A Next/Previous planner state that names the destination before MPV has
  published its matching track metadata no longer commits a filename-only
  intermediate surface. Identity, generation, position, waveform, and
  visualizer lifecycle still advance immediately, while title, artist, album,
  technical copy, and artwork remain one coherent retained snapshot until the
  destination metadata settles. A genuinely untagged destination then commits
  its filename normally.
- Artwork already decoded for the same opaque revision is retained across the
  new track generation. It is not removed, cloned, decoded, and revealed again,
  eliminating the same-album cover blink.

Focused regression coverage proves tag-to-tag transition, the legitimate
untagged fallback, same-revision artwork retention, and Favorite/source
visibility ownership on both local player surfaces.

Real Neutralino/WebView2 QA used the mandatory `npm.cmd run dev` command at
1280×800 with installed MPV and two temporary 60-second tagged MP3 files that
shared one embedded cover revision. Rapid native-window captures measured:

- Now Playing: `Tagged First` retained at 121 ms and direct commit to
  `Tagged Second` at 177 ms;
- mini-player: `Tagged First` retained at 96 ms and direct commit to
  `Tagged Second` at 155 ms;
- no filename-only title, blank artwork frame, Favorite heart, white flash,
  layout shift, or extra MPV in either capture sequence;
- backend Current and observed MPV title both settled on `Tagged Second`, with
  the identical artwork revision before and after navigation.

The temporary QA media and captures were outside the repository. Neutralino,
MPV, backend, Vite, and their listeners shut down cleanly.

Follow-up final gates PASS:

- `npm.cmd run format:check`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`, including local UI, Remote UI, and backend
- `npm.cmd test` — 787 total, 774 passed, 13 expected skips, 0 failed
- `npm.cmd run mpv:doctor`
- `npm.cmd run test:mpv` — 12/12
- `npm.cmd run ffmpeg:doctor`
- `npm.cmd run test:ffmpeg` — 3/3
- focused seamless/Favorite/source regressions — 57/57
- `git diff --check`

## Follow-up — positive-gain activation confirmation and Mono Spectrum default

Sound Processing and Parametric EQ activation are no longer a dead end when
Fixed output and Auto/Manual headroom still leave positive projected gain:

- the first authoritative backend request returns the typed
  `POSITIVE_GAIN_CONFIRMATION_REQUIRED` conflict;
- Settings reuses the canonical compact alert dialog with only `Cancel` and
  `Enable anyway`;
- confirming retries the identical patch with `confirmPositiveGain: true`;
- the accepted signal path remains explicit with `warning: positive-gain`;
- Headroom Off continues to need no confirmation;
- entering Fixed with existing positive gain, or another edit that introduces
  or increases positive gain, remains protected rather than silently applying.

Fresh profiles now default to `spectrumMono`. Preference migration and runtime
normalization continue to honor an existing explicit `meter` or any other valid
saved visualizer choice.

The focused reproduction first failed with the former definitive
`FIXED_OUTPUT_POSITIVE_GAIN` conflict and `meter` defaults. After implementation,
the focused Audio, preference, Settings, and visualizer tests passed 41/41 with
one expected platform skip.

Real Windows Neutralino/WebView2 QA used the exact mandatory
`npm.cmd run dev` command with an isolated new profile at a 1280×800 client
viewport:

- bootstrap migrated the empty profile as `not-found` with
  `visualizerMode: spectrumMono`;
- a temporary 60-second 440 Hz WAV visibly rendered the Mono Spectrum bars in
  Now Playing without scroll, overlap, flash, or layout shift;
- Fixed 100%, Manual 0 dB, and a boosted EQ produced an authoritative first
  response of HTTP 409 / `POSITIVE_GAIN_CONFIRMATION_REQUIRED`;
- the real Sound Processing `On` control opened the centered concise modal;
- `Enable anyway` activated both processing and EQ at projected gain `+6.44 dB`
  with `warning: positive-gain`.

The temporary profile, media, logs, and captures were removed. Neutralino,
MPV, FFmpeg, backend, Vite, ports 4310/5173, and the development launcher shut
down cleanly. No commit, push, Raspberry deployment, installer, or remote
update was performed.

This follow-up's completed final gates PASS:

- `npm.cmd run format:check`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`, including local UI, Remote UI, and backend
- `npm.cmd test` — 791 total, 778 passed, 13 expected skips, 0 failed
- `npm.cmd run mpv:doctor`
- `npm.cmd run test:mpv` — 12/12
- `npm.cmd run ffmpeg:doctor`
- `npm.cmd run test:ffmpeg` — 3/3
- focused Audio/preference/Settings/visualizer regressions — 41 passed,
  1 expected platform skip
- `git diff --check`

## Follow-up — implicit Context transition state recovery

The Raspberry Pi failure was reproduced and isolated without changing the
installed release. During audible implicit-Context playback, direct MPV IPC
reported the correct next file, a progressing `time-pos`, and the expected
remaining playlist. At the same instant `/api/player/state` reported
`status: playing`, a valid duration and the correct planner
`currentPlayback`, but `currentTrack: null` and `positionSeconds: 0`. This is
the exact backend state that made both the hardware UI and Remote show stale
or empty Now Playing content while audio continued.

The consumed MPV playlist prefix had already disappeared, while
`playlistItemIds` still described the previous technical playlist. The public
Current integrity guard correctly rejected that stale execution ID, but no
recovery path realigned it. `PlayerService` now repairs the complete observed
playlist suffix from the planner's Current plus future projection before
building public state. The repair is deliberately conditional: the observed
current path and every remaining MPV path must match the planned suffix in
order. A mismatching observation remains rejected, so stale metadata or
artwork cannot be attached to a different track.

Regression coverage now includes:

- a deterministic stale-ID reproduction proving Current metadata and the
  12-second position are published again and the complete execution-ID suffix
  is unique and aligned;
- a negative path-mismatch case proving the recovery does not accept an
  unrelated observed track;
- a real one-process MPV Context fixture whose first track reaches natural EOF
  and whose second track must expose matching public title and progressing
  position.

Focused backend validation passed: 30/30 playback-plan integration tests and
the real-MPV implicit Context EOF regression. Final static, full-suite, native
Windows, Remote, MPV/FFmpeg, and shutdown results are recorded below after the
completed final pass.

Real Windows Neutralino/WebView2 QA used the exact mandatory
`npm.cmd run dev` command at a 1280×800 client viewport. A generated three-
second first WAV and sixty-second second WAV were opened as one direct-folder
Context. After natural EOF, the authoritative state and visible Now Playing
both showed `02 Second`; the observed position progressed from 0.23 to 14.25
seconds while the duration remained 60 seconds. The waveform seekbar,
transport, Mono Spectrum and stable dark artwork placeholder remained visible
without `Nothing Playing`, a blank transition, layout shift or scroll. The
temporary media and capture were removed. Neutralino, backend, Vite, MPV and
ports 4310/5173 shut down cleanly; the only matching Node process was the Codex
tool runtime, not an application child.

This follow-up's completed final gates PASS:

- `npm.cmd run format:check`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`, including local UI, Remote UI and backend
- `npm.cmd test` — 793 total, 780 passed, 13 expected skips, 0 failed
- `npm.cmd run test:remote` — 30 total, 29 passed, 1 expected Windows skip
- `npm.cmd run mpv:doctor`
- `npm.cmd run test:mpv` — 13/13
- `npm.cmd run ffmpeg:doctor`
- `npm.cmd run test:ffmpeg` — 3/3
- focused playback-plan integration — 30/30
- `git diff --check`

The first complete MPV run exposed one timing-sensitive USB-disconnect fixture
assertion. That unchanged case passed immediately in isolation, and the final
complete MPV pass succeeded 13/13 with clean process teardown. No commit, push,
Raspberry deployment, installer or remote update was performed.

### Linux CI assertion correction

The first Linux CI run exposed a platform-specific assertion in the new
deterministic recovery test. Its synthetic native path uses Windows separators;
therefore Node's POSIX path implementation intentionally derived
`C:\fixture\B` as the fallback technical title instead of Windows' `B`. The
runtime recovery remained correct. Removing only the direct Current-title
assertion was insufficient because `currentPlayback.displayTitle` correctly
inherits that same authoritative technical title. The recovery fixture now
uses forward-slash native paths accepted by both Win32 and POSIX path parsers.
It therefore keeps the stronger assertions that both Current and planner
presentation resolve to `B`, together with aligned execution IDs and position
12, without changing production behavior. The focused recovery pair and the
complete local suite pass after this correction; the Linux CI rerun remains
the authoritative POSIX confirmation.

## Follow-up — definitive implicit-transition settling

The defect recurred on Raspberry Pi release `ef6c449` and was inspected live
without restarting or mutating playback. MPV was playing the expected SMB
track at approximately 130/152 seconds, exposed complete title/artist/album
metadata, and marked playlist entry zero as both `current` and `playing`.
Meanwhile the public backend state remained `playing` with the correct planner
Current and duration, but `currentTrack: null`, `positionSeconds: 0`, and the
technical current index stuck at `-1`.

This exposed a second transition race beyond the already-fixed stale execution
IDs. Multiple `path`/`playlist-pos` property events belonging to one
`start-file` transition could increment the transition generation while its
settling refresh was in flight. That refresh was then discarded and no later
event was guaranteed to clear `transitionPending`; the transient
`playlist-pos = -1` could therefore become permanent even though MPV had
settled at index zero.

The transition state machine now gives each `start-file` one generation.
Related property changes join the active generation and retain their existing
per-property version protection, while a genuinely newer `start-file` still
invalidates an older refresh. During state derivation, a unique MPV playlist
entry explicitly marked `current` and matching the observed path supplies the
effective index when the scalar position is stale. Missing, ambiguous, or
path-mismatched markers are rejected. The existing full-suffix planner/path
validation then realigns execution IDs before Current is published.

New deterministic coverage reproduces the exact Raspberry state with an
observed current playlist entry at index zero and stale scalar position `-1`.
It verifies index recovery, title, planner presentation, and position 12. A
second regression proves property changes inside one transition no longer
strand its refresh, while a newer `start-file` still invalidates an older one.
Focused playback-plan and command-responsiveness suites pass 31/31 and 14/14.

Real Windows QA used the exact mandatory `npm.cmd run dev` Neutralino path and
five generated Context tracks at a 1280×800 client viewport. All five distinct
Current titles were observed through automatic EOF transitions across 277
samples. The longest transient public interval without Current was 61.2 ms;
none persisted or froze position. The final 60-second track visibly retained
`05 Transition`, an advancing waveform seekbar at 30/60 seconds, active Mono
Spectrum, stable artwork placeholder, and responsive transport without blank
content, scroll, or layout shift. Temporary media and captures were removed,
and Neutralino, backend, Vite, MPV, FFmpeg, and ports 4310/5173 shut down
cleanly.

Because the device failure was intermittent and had also appeared after more
than five tracks, the final stress coverage is intentionally longer than the
visual smoke. A deterministic seeded test executes 128 transition refreshes
with shuffled transient `path`, empty playlist, and `playlist-pos = -1` events,
varying whether they arrive before or during the in-flight refresh. Every run
settles Current, index, path, and position. A real one-process MPV integration
then advances automatically through 24 implicit Context tracks and observes
all 24 public titles; the final Current and progress remain valid and no
missing-Current interval reaches one second.

Final validation after the extended stress coverage PASS:

- `npm.cmd run format:check`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`, including local UI, Remote UI, and backend
- `npm.cmd test` — 796 total, 783 passed, 13 expected Windows skips, 0 failed
- `npm.cmd run test:remote` — 30 total, 29 passed, 1 expected Windows skip
- playback-plan integration — 31/31
- command responsiveness — 15/15, including 128 seeded transition races
- `npm.cmd run mpv:doctor`
- `npm.cmd run test:mpv` — 14/14, including 24 automatic Context transitions
- `npm.cmd run ffmpeg:doctor`
- `npm.cmd run test:ffmpeg` — 3/3
- `git diff --check`

No commit, push, Raspberry deployment, service restart, installer, or remote
update was performed.

## Follow-up — occurrence-scoped MPV transition authority

The preceding “definitive implicit-transition settling” conclusion was not
complete. The defect recurred on the Raspberry Pi after more automatic and
manual transitions, so the earlier generation/path fixes and their stress
fixtures are superseded by the occurrence-scoped model in this follow-up.

The failure was captured live before any further playback command. The public
API reported `status: playing`, planner Current `08 Trip Switch.mp3`,
`currentTrack: null`, and `positionSeconds: 0`. At the same instant direct MPV
IPC reported the same audible path, `playlist-pos: 0`,
`playlist-playing-pos: 0`, and playlist row ID `150` marked both `current` and
`playing`. The remaining technical playlist was valid. This proved the
failure was neither Raspberry performance nor Remote rendering: the backend
had lost the execution-occurrence identity while MPV continued normally.

The repair no longer treats a positional ID array or a complete path suffix as
occurrence authority:

- `playlist-playing-pos` and the unique path-matching `playing` row identify
  the audible item; `playlist-pos/current` remain validated fallbacks because
  they may already identify the next selected row;
- every MPV playlist row's stable numeric `id` is bound to one planner
  execution ID, surviving prefix removal, reindexing, duplicate paths, and
  History/Context future differences;
- `start-file` and `end-file` retain MPV's matching `playlist_entry_id` plus a
  core/transition generation;
- a queued EOF advances only the planner Current occurrence that actually
  ended; a stale EOF after manual Next is a no-op;
- `file-loaded` only confirms the captured `start-file` token and expected
  target. It no longer performs an inferred second `advance()` or clears a
  newer navigation target;
- a planner target that differs from MPV's automatic next row is selected
  explicitly before future reconciliation.

Property refresh is now transactional. A rejected read never replaces cached
data with `undefined`; path, playlist, duration, position, idle state, audible
row, stable MPV ID, and planner Current must form one coherent observation
before `transitionPending` is cleared. Events arriving during a read request
at most one coalesced follow-up pass. Recovery remains event-driven and adds no
polling, timer, second SSE, MPV, or FFmpeg process.

The Remote client also serializes full player SSE, compact progress SSE, and
command HTTP responses. Full/progress contracts carry player session,
playback-plan revision, and track-transition identity. Old-track progress,
out-of-order envelopes, callbacks from a replaced EventSource, and an HTTP
response overtaken by newer SSE can no longer replace the current Remote
presentation with `Nothing Playing` or rewind its progress.

Focused regression coverage now includes the exact audible-vs-selected MPV
index split, stable entry IDs, a failed critical read, one coalesced dirty
refresh, 128 seeded property races, divergent technical future repair, a
queued stale EOF, a stale `file-loaded` callback, and monotonic Remote
HTTP/SSE ordering. Exact final suite counts are recorded below.

This remains internal to the Local MPV adapter and Remote transport ordering.
It does not alter external-provider ownership, output release/restore, DSP,
Queue policy, arbitration persistence, or the Step 3.1 public source contract.

Two additional real-application races were found and closed before accepting
this follow-up. First, planner Current could advance before its matching MPV
observation was ready. The previous complete public plan projection is now
held for the duration of that transition, and the new `currentPlayback`,
`currentTrack`, position, context, History, and Queue projection become visible
as one atomic frame. State derivation is fail-closed when playlist index or
execution-ID repair is not coherent; a rejected repair is transactional and
cannot mutate ID maps, origins, Queue rows, or `trackTransitionId`.

Second, adjacent metadata preload used to retain a Queue array across its
asynchronous reads. Technical future reconciliation could remove consumed MPV
prefixes in the meantime, after which the preload wrote the old array back with
the new Queue revision. The planner and observed track still described the same
song, but `state.queue[currentQueueIndex]` referred to an old occurrence, so the
public guard correctly suppressed `currentTrack`. Preload now retains only
path-scoped enrichment results across awaits and rebases them onto the live
Queue in one synchronous commit. A deterministic deferred-metadata regression
proves `[A, B, C] -> [B, C]` cannot resurrect `A`, alter transition/revision
identity, or blank public Current.

The final native Windows reproduction used the mandatory `npm.cmd run dev`
Neutralino/WebView2 path and generated media outside the repository. After the
Queue rebase fix, 347 REST samples across the 11 consecutive automatic
Currents `02` through `12` contained zero `playing` states with a missing
Current and zero playback/track identity mismatches. Eight manually triggered
Next operations, sampled while each HTTP request was in flight, added 52
transition samples with the same zero/zero result; each command settled in
112-149 ms. The fresh native application at a
1296x839 outer window (1280x800 client target) visibly showed `Manual QA 01`,
artist, format, duration, timeline, stable dark artwork placeholder, and
responsive paused transport without blank content, scroll, or layout shift.
Neutralino, backend, Vite, MPV, the Remote listener, and ports 4310/5173/8080
then shut down cleanly.

A second live Raspberry capture covered the boundary that had not previously
been represented explicitly. At `2026-08-02T15:00:54+02:00`, Same-artist
continuation had installed an `artist-radio` Context whose Current was
`09 Lover, Please Stay.mp3`. The public backend still reported `playing` and
the correct continuation Current, but exposed `currentTrack: null` and
`positionSeconds: 0`. Direct MPV IPC at the same instant reported the same
path at 44.6 seconds, `playlist-pos: 0`, `playlist-playing-pos: 0`, and stable
row ID `308` marked both `current` and `playing`, followed by seven valid
future rows. This confirms that the occurrence repair applies equally to the
album-to-radio boundary and not only to transitions inside an album.

Pausing the affected installed build immediately repaired its presentation.
That observation is diagnostic rather than a UI workaround: MPV's new `pause`
property event caused the old backend to perform another property refresh and
finally settle the stranded transition. The new coalesced recovery pass is
scheduled by the transition itself, so it no longer depends on a later Pause,
Play, or Next command.

A production-path regression now models nine artist-radio entries with MPV
IDs `307` through `315`, advances naturally from ID `307`, removes the consumed
prefix, and proves ID `308` becomes audible row zero while seven future rows
remain. Public Current, observed track, continuation source, `playing` state,
and position 44.6 remain coherent in every published frame. An additional
fail-closed regression removes an ended MPV ID from both the active playlist
and identity map before its queued EOF is handled; the obsolete EOF cannot
inherit the new Current's identity, advance the planner, or notify natural-end
consumers.

The local appliance UI also accepts the narrow recovery from an active empty
same-generation frame to its authoritative non-null Current at the same public
revision. Same-revision swaps between two non-null tracks and revival from
terminal states remain rejected. The Remote coordinator separately serializes
bootstrap attempts, full SSE, progress SSE, optimistic Queue reorder, and
command responses; obsolete attempts, stale 401 responses, and old-track
progress cannot replace a newer presentation or rewind its Queue/position.

Final validation for this occurrence-scoped follow-up PASS:

- `npm.cmd run format:check`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`, including appliance UI, Remote UI, and backend
- `npm.cmd test` — 814 total, 801 passed, 13 expected Windows skips,
  0 failed
- playback-plan integration — 44/44
- UI/Remote focused transition and ordering tests — 62/62
- `npm.cmd run test:remote` — 35 total, 34 passed, 1 expected Windows
  symlink skip, 0 failed
- `npm.cmd run mpv:doctor`
- `npm.cmd run test:mpv` — 14/14, including 24 automatic implicit Context
  transitions in one real MPV process
- `npm.cmd run ffmpeg:doctor`
- `npm.cmd run test:ffmpeg` — 3/3
- `npm.cmd run test:posix` — 3 passed, 2 Windows-only platform skips
- `npm.cmd run verify:linux:executables` — 48 tracked deployment files with
  valid Git modes
- `git diff --check`

The Windows-only `test:case-sensitive` helper cannot produce a meaningful
result because its path walker splits only POSIX separators and consequently
reports every Windows import as mismatched; Linux CI remains the authoritative
case-sensitive filesystem check. An initial full MPV run exceeded its external
six-minute wrapper timeout with one orphaned test process. That exact active
scenario passed in isolation, the verified test process and temporary fixture
were removed, and the subsequent clean full run passed 14/14 in 30.7 seconds.

The final mandatory native QA used the exact `npm.cmd run dev` command and the
real Neutralino/WebView2 window at 1296x839 outer size (1280x800 client target).
The empty-launch surface retained its dark reserved artwork, aligned timeline
and transport, and showed no white content, scroll, or layout shift. Normal
window close returned success code 0; backend received SIGTERM, and MPV,
FFmpeg, Neutralino, Node/Vite, the screenshot, temporary MPV fixtures, and
ports 4310/5173/8080 were all clean afterward.

No commit, push, Raspberry deployment, service restart, installer, or remote
update was performed.
