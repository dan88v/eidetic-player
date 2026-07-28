# Step 2.17.8 — Audio Output Canonicalization and Advanced DSP

Status: READY FOR CI VALIDATION — RASPBERRY AUDIO/SETTINGS VALIDATION NOT STARTED

## Baseline

- Branch: `main`
- Baseline commit: `76dcd91b64c036342d2bf1ca64796b358ed4408e`
- Baseline Build ID: `76dcd91-dev`
- Baseline CI: successful exact-head run `30341531453`
- No commit or push was performed for this step.
- No Raspberry installation, update, preference, mixer, or playback mutation was
  performed after development started.

### Windows real-application baseline

The mandatory Windows baseline used the real Neutralino/WebView2 application
through `npm.cmd run dev`, not a browser fallback:

- MPV `0.41.0`
- FFmpeg build dated `2026-07-16`
- System-default WASAPI output
- volume `100`, mute `false`
- the existing session, Queue, preferences, and Build ID were present

Hashes of the protected analyzer and visualizer implementation were captured
before development. The final protected-path diff is empty.

### Raspberry read-only audit

The reusable audit is saved as `scripts/remote-rpi-audio-audit.ps1`. It was run
against the Raspberry Pi before development and performed no installation or
configuration changes.

- Raspberry Pi 3 Model B, arm64, Debian 13/Trixie
- installed Build ID `0828396`
- MPV `0.40.0`
- one persistent MPV process and zero FFmpeg processes at rest
- GPIO/I2S DAC identified as `sndrpirpidac`
- PipeWire/Pulse and direct ALSA routes exposed by MPV
- ALSA PCM mixer reported `100%`, `+3.99 dB`
- required MPV filters were available: `lavfi`, `equalizer`, `pan`, `volume`
- CPU: Cortex-A53

The user subsequently supplied physical listening evidence: the DAC is
substantially quieter through
`pipewire/alsa_output.platform-soc_sound.stereo-fallback` than through
`alsa/sysdefault:CARD=sndrpirpidac`; `alsa/dmix:CARD=sndrpirpidac,DEV=0` is also
louder than the PipeWire route. This is recorded as route-specific evidence,
not as a controlled level measurement. The implementation keeps every route
explicit and makes no automatic selection or recommendation. A likely cause is
the different PipeWire sink/software-mixer gain path versus direct ALSA, but
that inference requires post-CI Raspberry validation.

## Implemented

### Canonical outputs and explicit routes

- Added a shared canonical physical-output model.
- `System default` is always first.
- Routes for the same evidenced physical device are grouped without collapsing
  unrelated devices.
- A physical output with multiple routes opens a route-selection subpage.
- Raw MPV routes remain available under `Advanced outputs`.
- Generic backend entries without physical-device evidence are not presented as
  separate physical devices.
- No route is selected, preferred, or labelled recommended automatically.

### Settings hierarchy

`Settings > Audio` now owns:

- Output Device
- Software Volume, with inline `Variable / Fixed 100%` pills
- Maximum Software Volume, only while it is effective
- Channels
- Balance
- Sound Processing, with inline `On / Bypass` pills
- Parametric EQ, with inline `On / Bypass` pills
- Parametric EQ Bands
- Headroom
- Advanced

`Interface` is now the documented canonical Settings surface. The reusable
contract is saved in `docs/development/settings-ui.md`, linked from the
development index, and required by `AGENTS.md` before every future Settings
change.

Selection pages use right-side checks, while runtime state uses pills and
success/error feedback uses the existing toast host. Output Device separates
physical `Devices` from `Advanced Outputs`. Fixed-output confirmation and the
existing maintenance confirmation now reuse one canonical, focus-trapped
source-dialog surface instead of a one-off native dialog.

### Audio UI corrective

- Fixed Software Volume now hides the volume trigger from both Default and
  Cassette main-player surfaces; the Queue control and transport geometry
  remain present.
- Sound Processing bypass is communicated once by its `On / Bypass` control.
  Balance, Channels, Parametric EQ Bands, Gain Compensation, and Headroom stay
  editable and may be visually subdued, but no longer repeat `Bypassed` pills.
- The EQ response curve now has a restrained accent fill to the neutral axis.
- Every graph node is directly draggable with mouse or touch. Horizontal
  movement changes logarithmic frequency, vertical movement changes gain in
  `0.5 dB` steps, Q remains unchanged, Pointer Capture owns the gesture, and
  one settings write is committed on release.
- The graph header reports the authoritative `Auto compensation`, `Manual
preamp`, `Compensation off`, or inactive state as plain text.
- Audio now exposes `Gain Compensation — On / Off`. On selects automatic
  headroom; Off selects Headroom Off. The Headroom page still exposes Auto,
  Manual, and Off. Existing Fixed-output positive-gain protection remains
  authoritative.

### Header status corrective

- The Ethernet indicator is now rendered only while a wired adapter is
  connected.
- Wi-Fi remains visible and muted while disconnected. Its touch popover reports
  the connected SSID, IPv4 address, and signal percentage.
- The existing DAC/audio icon is now an always-white semantic button. Its
  popover reports the effective physical output and active MPV interface.
- Wi-Fi, audio, and SMB share one popover, one interaction lifecycle, uniform
  44 px touch targets, identical icon geometry, and consistent spacing.
- SMB retains its green/error/connecting state colors and zero-connection
  hiding behavior.
- The header consumes the existing global Network, audio-output, and SMB state
  streams. No polling, timer, observer, EventSource, or backend endpoint was
  added.

### Output-level policy

- Added `Variable` and explicitly confirmed `Fixed` modes.
- Entering Fixed pauses playback, sets MPV volume to `100`, unmutes, leaves
  playback paused, and disables volume/mute controls.
- Volume and mute API writes return typed HTTP `409` while Fixed is active.
- Returning to Variable restores the last valid variable volume, clamped by the
  configured maximum, without restoring a hidden mute state.
- Added maximum software-volume choices `60`, `70`, `80`, `90`, `95`, and
  `100`; lowering the maximum clamps immediately, while raising it never raises
  the current volume.

### Channels and DSP

- Added Stereo, normalized Mono, Left to both, Right to both, and channel Swap.
- Stereo balance is now a top-level centered slider with `Center`, `L +n`, and
  `R +n` labels, one-step snapping, and attenuation-only DSP.
- Added an Eidetic DSP master bypass; new/reset profiles default to Bypass.
- Added six configurable parametric-EQ bands; new/reset profiles default the EQ
  to Bypass while keeping its controls editable.
- Bands 1 and 6 default to low-shelf and high-shelf and expose a touch-sized
  `Shelving / Bell` field. Bands 2–5 remain bell filters. Existing schema-v2
  bands without a stored filter type resolve safely to those new outer-band
  defaults.
- Parametric EQ Bands uses a sticky Canvas 2D response graph, six large band
  selectors, and touch-sized Frequency, Gain, and Q controls. It redraws only
  on input or resize and creates no analyzer, timer, or animation loop.
- Added Automatic, Manual, and Off headroom modes.
- Automatic headroom evaluates the combined six-band response over a dense
  logarithmic frequency grid and applies only the attenuation required by the
  projected boost.
- Fixed mode rejects configurations with positive projected DSP gain.
- DSP is applied inside the existing persistent MPV as one labelled
  `@eidetic-dsp` chain.
- Foreign MPV filters are preserved.
- Filter application is serialized, generation-aware, coalesced, and restores
  the previous Eidetic chain on failure.
- Output changes reapply the current Eidetic chain without creating a second
  MPV process.

### Persistence and API

- Preferences schema advanced from v1 to v2 with ten audio fields.
- The previous 18 preferences and unknown fields remain preserved.
- Schema v0/v1 is migrated in memory and committed only on the next legitimate
  write.
- Future schemas remain read-only and preserved.
- Added typed audio-processing state and patch endpoints.
- Generic preference writes cannot bypass audio policy.

### MPV replacement hardening

The real MPV gate exposed a transient `get_property: property unavailable`
during exact Queue replacement. `MpvController.loadPlaylist()` now treats the
brief absence of `path` as part of its existing bounded two-second readiness
wait. The previously failing replacement cases pass without adding polling or
changing Queue semantics.

## Real-system proof

### Windows MPV/API path

The real Neutralino backend and persistent MPV were exercised through the API:

- channel Swap plus a `+4 dB` EQ band produced automatic preamp `-4 dB`
- simultaneous `+3 dB` low- and high-shelf bands were accepted through the
  real API → labelled MPV filter path, produced automatic preamp `-3.23 dB`,
  kept projected peak gain at `0`, and left the same MPV process alive
- direct MPV IPC inspection showed exactly one labelled `eidetic-dsp` lavfi
  chain containing channel mapping, EQ, and headroom
- Fixed confirmation paused playback and kept it paused
- a volume write in Fixed returned HTTP `409` with
  `FIXED_OUTPUT_LEVEL_LOCKED`
- the original processing preferences were restored after the proof

### Real Neutralino visual QA

The actual app was inspected with mouse input at:

- `1280 × 800`: Settings, Audio, Output Device, canonical Fixed confirmation,
  the complete hierarchy, and the sticky Parametric EQ editor
- `1024 × 800`: responsive Audio hierarchy and Parametric EQ editor

Bands 1 and 6 visibly selected `Shelving` by default, with the low/high shelf
identity reflected by their selected band and frequency. The response graph
remained sticky while the filter-type pill and continuous controls scrolled
under it.

The corrective was also exercised in the real app:

- Fixed hid the volume icon in both Default and Cassette at `1280 × 800`.
- Sound Processing bypass showed no repeated pill on Balance or the EQ rows.
- dragging band 4 moved it from `1.0 kHz / 0 dB` to `1.5 kHz / +9 dB` without
  changing `Q 1`; the filled response updated continuously and the
  authoritative header reported `Auto compensation: -9 dB`
- Gain Compensation changed Headroom `auto → off → auto` through the real API
  path
- the Audio root and new control remained aligned and overflow-free at
  `1024 × 800`

The final header corrective was exercised with native mouse input in the same
real application:

- at `1280 × 800`, Ethernet was absent because no wired adapter was connected;
  Wi-Fi and audio were solid white, SMB was green, and all three icons used the
  same target, glyph geometry, and spacing
- the Wi-Fi popover reported the real development snapshot:
  `AlogyFi`, `10.0.0.109`, and `Signal 100%`
- the audio popover reported the real effective physical output,
  `Altoparlanti (Realtek(R) Audio)`, and the active `WASAPI` interface
- the SMB popover reported `1 connected`
- tapping directly between Wi-Fi, audio, and SMB replaced the content in the
  single popover; Escape closed it and returned focus to its trigger
- at `1024 × 800`, all indicators, clock, and popover remained within the
  viewport without horizontal overflow or header collision
- the first visual pass exposed the generic route-kind label `OTHER`; the
  formatter now derives the concrete `WASAPI` label from the effective route,
  while Raspberry ALSA routes remain labelled `ALSA`

All preferences changed only for these QA proofs were restored afterward.

The canonical surfaces remained dark and stable, with no observed white flash,
layout jump, stale artwork, or shared-control regression. On Windows, the
canonical Output page showed System default and the evidenced Realtek physical
device; backend-only routes remained under Advanced.

### Visualizer lifecycle

Using the real application while playing:

- Meter: one FFmpeg analyzer
- Mono spectrum: one FFmpeg analyzer
- Stereo spectrum: one FFmpeg analyzer
- Technical: one FFmpeg analyzer
- None: zero FFmpeg analyzers
- after restoring Mono spectrum and pausing: zero residual FFmpeg processes

EXTERNAL FFMPEG VISUALIZER LIFECYCLE — UNCHANGED

No protected analyzer/visualizer source file changed.

## Validation

Passed:

- `npm.cmd run format:check`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run build:linux`
- `npm.cmd test` — 581 passed, 11 platform skips, 0 failed
- `npm.cmd run test:posix` — 3 passed, 2 Windows platform skips
- `npm.cmd run mpv:doctor`
- `npm.cmd run test:mpv` — 10 passed
- `npm.cmd run ffmpeg:doctor`
- `npm.cmd run test:ffmpeg` — 3 passed
- `npm.cmd run verify:network:deployment`
- `npm.cmd run verify:linux:executables`
- `npm.cmd run verify:linux:installer`
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`
- `git diff --check`
- protected analyzer/visualizer diff check
- dependency-manifest diff check

The first full-suite run exposed one obsolete static assertion that still
expected the retired native `showModal()` call inside `settings.ts`. The test
was corrected to verify the canonical shared confirmation component, including
its source-dialog surface and Escape handling; the focused test and complete
suite then passed.

The EQ touch corrective also intentionally added the seventh local
`touch-action: none` owner. Its existing closed gesture-ownership guard was
updated to name only the EQ Canvas, require Pointer Cancel handling, and retain
the prohibition on global touch-move listeners. The focused guard and complete
suite passed afterward.

The header corrective added focused coverage for connected/disconnected
visibility, Wi-Fi detail formatting, effective audio-interface formatting,
shared popover ownership, existing stream reuse, and SMB geometry. The focused
header/Network/SMB group passed 60 of 60 tests.

The unparameterized release-verifier invocation correctly rejected missing
`--root`; the required parameterized build verification then passed.

Clean shutdown was verified with zero residual MPV, FFmpeg, Neutralino, Vite,
or Eidetic application processes. Generated Python cache files from the Linux
fixture tests were removed.

## Deferred Raspberry validation

Post-implementation Raspberry audio and Settings validation has not started.
After manual review, commit, push, and green CI, the next Raspberry session
should explicitly compare the PipeWire and ALSA DAC routes, verify Variable and
Fixed behavior, confirm persistence across the update/restart boundary, inspect
the canonical route hierarchy at `1280 × 800`, and repeat the one-MPV/zero-idle-
FFmpeg lifecycle checks.

Status: READY FOR CI VALIDATION — RASPBERRY AUDIO/SETTINGS VALIDATION NOT STARTED
