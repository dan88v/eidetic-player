# Step 2.17.10 — Screen Dim and Display Standby

Local status:

`READY FOR CI VALIDATION — RASPBERRY DISPLAY VALIDATION NOT STARTED`

System policy:

`SYSTEM BLANKING DISABLED BY APPLIANCE CONFIG — PRESERVED`

No commit or push was created automatically.

## Baseline and scope

- Branch: `main`.
- Baseline HEAD and `origin/main`:
  `158bd3d9ee5679e79f61394c93a6eed1d4b2154f`.
- Ahead/behind at baseline: `0 / 0`.
- Baseline worktree: clean; `git diff --check`: clean.
- Exact-head GitHub Actions CI: run `30549828877` (`CI #108`), completed
  successfully for the baseline push.
- Implementation is limited to display contracts, service/adapters, idle
  control, Settings, preferences schema 3, focused tests, documentation, and
  this report.
- Package plan: no dependencies, package versions, lockfile, workflow, helper,
  Polkit, installer, or updater changes.

## Appliance blanking and Raspberry read-only audit

The Raspberry was audited over SSH with read-only commands only. No update,
restart, output-power mutation, audio selection, or configuration write was
performed.

- Installed build: baseline `158bd3d`; Appliance mode, fullscreen and
  borderless enabled.
- Existing install selection:
  `EIDETIC_DISABLE_BLANKING=1` (`Disable blanking: Yes`).
- Existing managed autostart:
  `eidetic-player-display-policy.desktop` invoking the installed display-policy
  script.
- Existing policy result: `org.gnome.desktop.session idle-delay = uint32 0`.
- Session: Wayland, `rpd-labwc`, Labwc `0.9.8`, `WAYLAND_DISPLAY=wayland-0`,
  `DISPLAY=:0`.
- Physical output: one connected and enabled `HDMI-A-1`, current mode
  `1280x800`; `/usr/bin/wlr-randr` is available and exposes fixed `--off` and
  `--on` operations.
- `/sys/class/backlight`: no usable device.
- `xrandr`, `xset`, `gsettings`, and `vcgencmd` exist for diagnostics, but the
  new runtime does not use them as arbitrary control surfaces.
- Current canonical physical audio output: GPIO I2S DAC, not HDMI.
- The existing player service remained active and playback was not disturbed
  during the audit.

Capability matrix:

| Capability           | Surface                          | Result                                                                 | Required privilege |
| -------------------- | -------------------------------- | ---------------------------------------------------------------------- | ------------------ |
| Hardware dim         | sysfs backlight                  | Unavailable on audited Pi                                              | none               |
| Software dim         | UI overlay                       | Available; no power saving claimed                                     | none               |
| Standby output       | Wayland session                  | Available through one discovered `HDMI-A-1` and fixed `wlr-randr` argv | runtime user       |
| Backlight off        | sysfs backlight                  | Unavailable                                                            | none               |
| Wake output          | Wayland session                  | Available through fixed `wlr-randr --on`                               | runtime user       |
| HDMI audio detection | authoritative Audio Output state | Available through canonical physical output ID                         | none               |

No root helper or Polkit policy is required by the audited hardware/session.
The installer-managed blanking contract and `install.conf` are untouched.

## Settings UI audit and reuse

`docs/development/settings-ui.md` and the existing Settings implementation were
read before editing. The final System ordering is Software update (unchanged),
Display, then Maintenance mode (unchanged where available).

| Pattern             | Existing component/pattern                       | Display reuse                                              |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| Navigation row      | `navigationRow` / `setting-navigation`           | System row and three Display rows                          |
| Selection page      | `selectionRow` / `setting-choice`                | Dim timeout, dim level, standby timeout                    |
| Segmented control   | `createSegmentedControl`                         | Audited; not needed for multi-choice Display values        |
| Confirmation dialog | `createConfirmationDialog`                       | Test standby confirmation                                  |
| Status row          | `settings-row-base setting-row`, state pill      | Capability and availability                                |
| Action buttons      | `settings-page-actions` / `settings-page-action` | Test dim and Test standby                                  |
| Range control       | canonical Settings range pattern                 | Audited; closed discrete levels use selection rows instead |

The page uses the canonical compact header, Back behavior, touch-height rows,
native vertical scrolling, existing focus styles, and the existing dialog.
One observed residual horizontal scroll during navigation was corrected by
resetting both Settings scroll axes; the real-app recheck showed no clipping.

## Architecture and state

- `DisplayIdleController` owns local activity, the one normal monotonic timer,
  absolute deadlines, software overlay, wake shield, and local updater/audio
  inhibition.
- `DisplayPowerService` owns serialized display mutations, capability state,
  startup/shutdown Active restoration, bounded wake retry, test fail-safes,
  and sanitized errors.
- Linux, software-only, and Windows fixture adapters are narrow platform
  boundaries. No display logic was added to Player, Audio Output, Update,
  Power, MPV, visualizer, analyzer, or FFmpeg services.
- Shared snapshot states are Active, Dimmed, Standby, Inhibited,
  Transitioning, Error, and Unsupported, with method/capability, inhibition,
  test, error-code, deadline, and revision fields.
- REST surface:
  `GET /api/display/state`, plus local-only bounded JSON mutations for Dim,
  Standby, Wake, Test dim, and Test standby.
- Display state is included in bootstrap. There is no display polling, display
  EventSource, permanent display HTTP request, or additional updater
  subscription.
- Mutation bodies contain only closed numeric choices or are empty. No UI
  request can provide a path, command, environment, socket, username, raw
  brightness, or output name.

## Preferences and timing

The backend-authoritative Preferences schema is incremented from 2 to 3.
Defaults are:

- `screenDimTimeoutSeconds: 0`;
- `screenDimLevelPercent: 20`;
- `screenStandbyTimeoutSeconds: 0`.

Allowed values exactly match the requested choices. If both timeouts are on,
standby must be later than dim. Migration remains atomic, unknown fields are
preserved, future schemas remain read-only, and local storage is not
authoritative.

The normal runtime owns one `setTimeout`, never an interval. It schedules the
next absolute transition from one `performance.now()` activity epoch. Dim does
not start a new standby countdown. An inhibition release or HDMI-audio release
creates a new epoch and full countdown.

Updater queued/running/activating/restarting/verifying phases restore Active
and suspend the timer using the updater snapshot already owned by AppShell.
Maintenance and app restart/quit transitions request bounded Active
restoration first. Reboot/shutdown behavior is unchanged.

## Local activity, wake, and dim

- Active activity: local pointer down, key down, wheel, and trusted non-zero
  coalesced mouse movement. Active events are not prevented.
- No duplicate `touchstart`, global `touchmove`, polling, frame loop, or
  per-activity preference/log write was added.
- During Dimmed, Standby, or a local transition, the viewport wake shield is
  above the app and keyboard. The first pointer/key/wheel is prevented and
  stopped before underlying controls. Mouse movement wakes without clicking,
  and the related click is suppressed.
- The software overlay uses one opacity derived from the selected level, no
  filter and no animation loop. Its short opacity transition is enabled only
  with app animations.

`Software dimming — display power consumption is unchanged.`

Hardware dim is used only for a discovered writable sysfs device contained
under `/sys/devices`. Active brightness is retained in memory, dim is clamped,
standby writes zero, and wake restores the exact retained value.

## Real standby, HDMI, and fail-safe

Standby is exposed only for a real writable backlight or one safely discovered
Wayland output. Linux uses `/usr/bin/wlr-randr` with fixed argument arrays and
the validated discovered output; multiple ambiguous outputs disable the
capability. Software dim is never called standby.

The Windows development adapter intentionally reports `Simulated fixture`.
Its black fixture view is only for native Windows QA and is not reported as a
physical standby PASS.

The authoritative canonical physical Audio Output ID inhibits standby for
HDMI without pausing, rerouting, or otherwise touching audio. Dim remains
available and the UI explains the runtime suspension. Release starts a new
full standby countdown.

Test dim has a 10-second maximum. Test standby requires confirmation and has an
independent backend maximum of 15 seconds. Local input wakes immediately.
Concurrent tests and tests during updater/Maintenance inhibition are rejected.
Wake uses bounded retry; ordered shutdown and startup both request Active.

## Automated verification

Focused development tests cover:

- defaults, timeout ordering, dim-only/standby progression, monotonic absolute
  deadlines, disabled policy, and HDMI standby removal;
- Active input passthrough, Dimmed pointer consumption, Standby key/wheel
  consumption, and normal second input;
- service probe/dim/standby/wake, unsupported standby, HDMI rejection,
  output-off failure, startup retry, one-output Wayland discovery, ambiguous
  output rejection, hardware clamp, zero/off, and exact brightness restore;
- schema 3 defaults/migration, invalid ordering, future schema, unknown-field
  preservation, and authoritative persistence;
- System ordering, canonical UI reuse, confirmation copy, capability copy,
  wake-shield geometry, no polling, and no display EventSource.

Full local gates:

| Gate                                                                    | Result |
| ----------------------------------------------------------------------- | ------ |
| `npm.cmd run format:check`                                              | PASS   |
| `npm.cmd run typecheck`                                                 | PASS   |
| `npm.cmd run lint`                                                      | PASS   |
| `npm.cmd run build`                                                     | PASS   |
| `npm.cmd run build:linux`                                               | PASS   |
| `npm.cmd test`                                                          | PASS   |
| `npm.cmd run test:posix`                                                | PASS   |
| `npm.cmd run verify:network:deployment`                                 | PASS   |
| `npm.cmd run verify:linux:executables`                                  | PASS   |
| `npm.cmd run verify:linux:installer`                                    | PASS   |
| `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build` | PASS   |
| `npm.cmd run mpv:doctor`                                                | PASS   |
| `npm.cmd run test:mpv`                                                  | PASS   |
| `npm.cmd run ffmpeg:doctor`                                             | PASS   |
| `npm.cmd run test:ffmpeg`                                               | PASS   |
| `git diff --check`                                                      | PASS   |

## Windows Neutralino QA

The real Neutralino/WebView2 application was launched from the repository root
with:

```powershell
$env:EIDETIC_MPV_PATH="C:\Tools\mpv\mpv.exe"; npm.cmd run dev
```

This was not browser fallback QA.

| Viewport | Result                                                           |
| -------- | ---------------------------------------------------------------- |
| 1280x800 | PASS                                                             |
| 1024x768 | PASS                                                             |
| 1024x600 | PASS; native vertical scroll exposes capability and both actions |
| 1366x768 | PASS                                                             |

Observed in the native app:

- Settings root and System hierarchy remain visually coherent.
- Display rows, selection checkmarks, capability pill, action buttons, and
  confirmation dialog use canonical geometry.
- Test dim produced software Dimmed at 20%; first input restored Active.
- The first click aimed at Test standby after dim was consumed and did not open
  the dialog; the next click behaved normally.
- Test standby confirmation copy and Cancel/Start test actions were visible.
- Windows fixture reached Standby and local input restored Active.
- A wake click aimed at the mini-player Play control left player pause state
  unchanged (`true → true`), proving no click-through on that path.
- Queue/mini-player, Audio/Network indicators, updater indicator surface,
  scrolling, Back, and the shared top bar remained stable.
- No white flash, blank intermediate page, layout shift, horizontal overflow,
  stale artwork swap, or full AppShell reconstruction was observed.

HDMI route switching was not performed on the development workstation to
avoid altering the operator’s audio route; HDMI policy is covered by service
and timer tests. Hardware dim and physical output-off cannot be validated by
the Windows fixture.

Performance/connection observations:

- one normal display timer by construction and test;
- no interval, render loop, display SSE, or retained display request;
- existing player SSE is reused for Audio Output;
- playback remained paused/unchanged through wake-consumption checks;
- precise idle CPU, hardware latency, Raspberry wake latency, analyzer count,
  and physical standby latency remain hardware-validation items.

The app was returned to Active with display preferences Off/20%/Off, then
closed normally. Neutralino exited with code 0; backend received SIGTERM.
There were no remaining Neutralino, MPV, or FFmpeg QA processes and no listeners
on ports 4310/5173 (only normal `TIME_WAIT` entries).

## Installer/updater regression proof

Diff review is empty for:

- `package.json`, `package-lock.json`, `.github/workflows`;
- installer blanking/runtime helper and updater runner;
- backend software-update, player, audio-output, audio-processing, SMB,
  network, library, analyzer, and FFmpeg trees;
- UI software-update client/components, reliable touch scroller, and
  visualizer.

Therefore `EIDETIC_DISABLE_BLANKING=1`, the installed desktop blanking policy,
update runner/journal/progress/branch/SSE contracts, and current/previous
release behavior are preserved.

## Files changed

- Shared: `packages/shared/src/display.ts`,
  `packages/shared/src/preferences.ts`.
- Backend: `apps/backend/src/display/*`, `apps/backend/src/index.ts`,
  `apps/backend/src/preferences/preferences-store.ts`.
- UI: display API/client/controller, bootstrap and AppShell integration,
  Settings screen/context/component contract, and scoped wake/dim styles.
- Tests: display service/platform, timer/input, Preferences, Settings UI, and
  the existing local touch-ownership count updated for the wake shield.
- Docs: Preferences, development index, display-power contract, and this
  report.

## Checkpoint and deferred physical validation

Pre-CI checkpoint: implementation, automated checks, Windows native QA,
restoration, cleanup, protected-diff review, and report are complete locally.
The user will create the commit.

Not started and not claimed:

- commit and exact-head CI for this change;
- in-app Raspberry update;
- physical Raspberry dim result;
- physical Raspberry standby/wake result;
- Raspberry touch/key/wheel consumption;
- HDMI-audio physical inhibition/release;
- Raspberry service-restart recovery;
- final Raspberry restoration and cleanup.

The status must remain
`READY FOR CI VALIDATION — RASPBERRY DISPLAY VALIDATION NOT STARTED` until
those later checkpoints are executed. The final status
`RASPBERRY SCREEN DIM AND DISPLAY STANDBY — PASS` is intentionally not claimed.
