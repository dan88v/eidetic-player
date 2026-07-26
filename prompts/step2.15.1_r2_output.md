# Step 2.15.1-R2 — MPV audio startup diagnostics and Linux Appliance wait

Date: 2026-07-26

## Final status

`READY FOR CI VALIDATION`

Local implementation and real Windows validation are complete. A new GitHub
Actions run has not yet occurred, so this report does not claim CI PASS.

## Baseline

- Branch: `main`.
- Local HEAD and `origin/main` before the step:
  `b602753bb9c6907bb21ee26b348161f5dbe64381`.
- Divergence before the step: `0 / 0`.
- Working tree before the step: clean.
- R1 PCM5102A system-configuration commit was present.
- Latest baseline GitHub Actions run `30210213116`: completed successfully
  before R2.
- R1 result retained: `PCM5102A ENUMERATION — PASS`. The user, acting as the
  audio technician, confirmed correct stereo output without strong distortion
  or anomalous noise.

## Baseline Windows

The real Neutralino/WebView2 → backend → persistent MPV path was exercised
before editing with `npm.cmd run dev` and
`EIDETIC_MPV_PATH=C:\Tools\mpv\mpv.exe`.

- MPV v0.41.0-744 was discovered.
- One Neutralino instance, one backend and one MPV process were present.
- The restored 12-item Queue, stable Queue IDs, current index 2, paused
  position, volume, mute, shuffle and repeat were recorded.
- The 1280×800 Audio Output page listed System default, the Realtek WASAPI
  output and OpenAL.
- A real `auto → WASAPI → auto` switch retained the same MPV PID and all
  Queue/session invariants.
- Refresh and the existing toast were exercised.
- Power, Quit confirmation, restart persistence and clean shutdown passed.
- Windows startup did not acquire the five-second Appliance delay.

## Audit and implementation

### `currentAo`

- MPV observation now includes the JSON IPC property `current-ao`.
- `PlayerService` forwards its initial value, property changes, controlled
  restart value and unavailable transition through the existing audio-output
  adapter. No second MPV process, shell, polling loop or new stream was added.
- The shared Audio Output state exposes backend-only diagnostics:
  `currentAo`, normalized device count, preferred-device availability and
  initial-enumeration status.
- `currentAo` accepts unknown future MPV driver names but trims, bounds to 128
  characters and rejects control characters. The Linux doctor applies an
  additional conservative character allowlist before JSON output.
- Duplicate semantic values do not increment the audio-output revision.
- The current Audio Output REST state naturally carries the diagnostics; no new
  public endpoint was added.
- Settings, the Output page and toast rendering do not read or display
  `currentAo`.

### Raw enumeration and startup wait

- A valid raw MPV `audio-device-list` observation is tracked separately from
  the normalized list, which always synthesizes `auto`.
- A real empty raw array is ready.
- A malformed or missing value does not complete the wait.
- Initial-enumeration states are closed to `ready`, `timed-out` and
  `unavailable`.
- The wait is event-driven and uses one exact `5000 ms` timeout.
- It is enabled only when `process.platform === "linux"` and the installation
  mode is exactly `appliance`.
- Windows, Linux Standard and development mode never acquire the wait timer.
- MPV unavailable reports `unavailable` without a timer.
- Shutdown resolves an active wait and removes its subscription/timer.
- Timeout emits one sanitized backend warning, does not publish a toast and
  does not degrade readiness.

### Bootstrap order and preference behavior

The resulting order is:

1. persistent MPV initialization;
2. Audio Output preference load and property subscriptions;
3. gated Linux Appliance initial-enumeration wait;
4. preferred output application or technical `auto` fallback;
5. player-session restore.

An available preference is applied before session restore. An unavailable
preference, malformed enumeration or timeout continues with `auto` while
retaining the saved preference. A late valid enumeration changes diagnostics
to `ready`; it does not auto-switch and does not create an unplug notice. A
reconnect while stopped remains on `auto`; the next real playback preparation
applies the retained preference.

Persistence remains Audio Output v1 and player session remains v2.

## Linux audio doctor

`deploy/linux/doctor-installation.sh` remains a conservative, non-mutating
diagnostic:

- reports user-service state for PipeWire, pipewire-pulse, WirePlumber and
  PulseAudio;
- classifies the active stack as PipeWire/Pulse, PipeWire, PulseAudio,
  ALSA-only or unknown;
- reports availability of `wpctl`, `pactl`, `aplay` and the MPV executable
  without failing installation checks for optional audio-tool absence;
- reads bounded `/proc/asound/cards`, `/proc/asound/pcm` and `/proc/modules`
  data;
- reports ALSA card count and conservative HDMI/GPIO-I²S classification;
- recognizes the R1 `sndrpirpidac` / `RPi-DAC` card and coherent PCM evidence;
- recognizes `vc4hdmi` as HDMI;
- explicitly avoids treating vc4hdmi `MAI PCM i2s-hifi-0` as a GPIO DAC;
- reads the existing app endpoints with bounded 750 ms HTTP requests and
  reports only sanitized aggregate diagnostics;
- never starts MPV or playback, plays probe audio, changes a service, invokes
  sudo, exposes raw output IDs, or changes configuration.

Doctor mode remains `100755`. Automatic PCM5102A installer integration is not
part of R2.

## Regression tests

Focused coverage includes:

- `currentAo` normalization, unknown driver names, unsafe input, semantic
  deduplication and subscription cleanup;
- valid non-empty and empty raw enumeration;
- malformed input followed by a valid event;
- event-before-timeout and timer cancellation;
- timeout-before-event, one warning, retained preference and `auto` fallback;
- late enumeration, no immediate auto-switch and next-playback application;
- MPV unavailable and shutdown during the wait;
- exact platform/mode gate and bootstrap ordering;
- unchanged shared player SSE and UI/toast contracts;
- PipeWire/PulseAudio/ALSA classification;
- HDMI, R1 GPIO-I²S DAC and module-only fixtures;
- vc4hdmi/MAI false-positive prevention;
- valid, malformed, unreachable and timed-out app-diagnostic fixtures on
  native Linux;
- static proof that the doctor contains no playback or mutating command.

Focused result before final gates: 28 PASS, 0 FAIL, 2 native-Linux HTTP doctor
fixtures skipped only on Windows because its available `bash` is WSL without
the Windows Node runtime.

## Real Windows post-change smoke

The mandatory real app command `npm.cmd run dev` was run after implementation.

- Health: OK.
- MPV available: true, v0.41.0-744.
- Initial enumeration: `ready`.
- Normalized output count: 3.
- Preferred output available: true.
- Real `currentAo`: `wasapi`.
- Real paused switch: System default → Realtek WASAPI → System default.
- MPV PID remained `9340`.
- Queue count remained 12; all Queue IDs and current index 2 remained stable.
- Volume, mute, shuffle, repeat and paused state remained stable.
- Preference was restored to the original `auto`.
- The 1280×800 Settings → Audio → Output hierarchy and output list were
  visually inspected in Neutralino/WebView2. No white flash, layout shift,
  stale content or diagnostic UI was introduced.
- The existing Power and Quit confirmation path closed the application.
- Final residual Neutralino, MPV, FFmpeg and project port listeners: zero.

## Final gates

The following results are filled from the single final run:

- `npm.cmd run format:check`: PASS
- `npm.cmd run typecheck`: PASS
- `npm.cmd run lint`: PASS
- `npm.cmd run build`: PASS
- `npm.cmd run build:linux`: PASS
- `npm.cmd test`: PASS — 508 tests, 498 passed, 0 failed, 10 expected
  platform skips.
- `npm.cmd run test:posix`: PASS — 3 passed, 0 failed, 2 expected
  Windows skips.
- `npm.cmd run verify:network:deployment`: PASS
- `npm.cmd run verify:linux:executables`: PASS — all 35 tracked deployment
  modes valid.
- `npm.cmd run verify:linux:installer`: PASS — installer contract and 63
  install-safe tests completed with 0 failures.
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`:
  PASS — compiled backend, x64 ELF, Neutralino configuration, UI and resource
  archive verified.
- `npm.cmd run mpv:doctor`: PASS — headless startup and JSON IPC.
- `npm.cmd run test:mpv`: PASS — 8 passed, 0 failed.
- `bash -n deploy/linux/doctor-installation.sh`: PASS
- ShellCheck: NOT RUN — not installed; the step explicitly forbids installing
  it.
- `git diff --check`: PASS
- Linux root staging: NOT RUN.

The first preliminary lint attempt identified eight local style violations.
They were corrected automatically, rechecked with focused ESLint and tests, and
the complete clean final matrix above then passed.

## Scope and non-regression

Modified files:

- `packages/shared/src/audio-output.ts`
- `apps/backend/src/player/mpv-controller.ts`
- `apps/backend/src/player/player-service.ts`
- `apps/backend/src/audio-output/audio-output-service.ts`
- `apps/backend/src/audio-output/audio-output-bootstrap.ts`
- `apps/backend/src/index.ts`
- `deploy/linux/doctor-installation.sh`
- `apps/backend/test/audio-output.test.ts`
- `apps/backend/test/audio-doctor.test.ts`
- `apps/ui/test/step2.15.test.ts`
- `docs/development/architecture.md`
- `docs/development/testing.md`
- `deploy/linux/README.md`
- `prompts/step2.15.1_r2_output.md`

No other source surface was modified.

- Package plan and lockfile: unchanged.
- CI workflows: unchanged.
- installer, update, rollback, restore and uninstall: unchanged.
- Power helper and Polkit rule: unchanged.
- Settings implementation, Audio Output UI, styles and toast system: unchanged.
- Queue, Library, USB, SMB and Network behavior: unchanged.
- No Raspberry SSH, update, reboot, package installation or filesystem change
  occurred.
- No commit or push was made.

## Deferred hardware validation

- PCM5102A system configuration from R1: PASS.
- Raspberry application validation: NOT TESTED.
- Raspberry `currentAo`: NOT TESTED.
- Raspberry startup wait: NOT TESTED.
- Raspberry doctor: NOT TESTED.
- Step 2.15.2 installer-owned PCM5102A integration: deferred.
- Step 2.15.3 real Raspberry application-path validation: deferred.
