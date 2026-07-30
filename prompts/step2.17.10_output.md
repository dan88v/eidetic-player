# Step 2.17.10 — Screen Dim and Display Standby

Post-CI status:

`RASPBERRY UPDATE TO 8aff5ea — PASS; PLAYBACK/LOW-DIM FOLLOW-UP READY FOR CI; PHYSICAL DISPLAY VALIDATION PENDING`

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

Dim level values are 5%, 10%, 20%, 30%, 40%, and 50%; timeout choices remain
unchanged. If both timeouts are on, standby must be later than dim. Migration
remains atomic, unknown fields are preserved, future schemas remain read-only,
and local storage is not authoritative.

The normal runtime owns one `setTimeout`, never an interval. It schedules the
next absolute transition from one `performance.now()` activity epoch. Dim does
not start a new standby countdown. An inhibition release or HDMI-audio release
creates a new epoch and full countdown.

Loading or playing clears that timer and keeps the display Active. Pause or
stop creates a new epoch and starts the complete configured countdown. This
observes the existing player store without changing MPV or PlayerService.

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
  above the app and keyboard. The first pointer/key/wheel or click-only
  WebKitGTK touch fallback is prevented and stopped before underlying controls.
  Mouse movement wakes without clicking, and the related compatibility click
  is suppressed without a duplicate wake.
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

## Post-CI Raspberry update and deferred physical validation

The user committed and pushed the reviewed step as
`8aff5ea9e13387b87666c6340c3bcdd1f92ff56d` on `main`. The local checkout was
clean, `HEAD` equalled `origin/main`, and GitHub Actions exact-head run
`30562305165` completed successfully before the Raspberry was changed.

The pre-update Raspberry audit found:

- installed Build ID `158bd3d`;
- backend readiness `ready`, MPV available and playing;
- `eidetic-player.service` active and the system updater unit inactive;
- selected physical output `gpio-i2s-dac`;
- Library 1,224 tracks / 68 albums / 79 artists and the SMB source available;
- Preferences schema 2, revision 31;
- `EIDETIC_DISABLE_BLANKING=1`;
- clean remote checkout and no active update process.

Because the operation was performed remotely and physical touch access was not
available, the user-authorized fallback controller called the application's
loopback-only Software Update API. It followed the same immutable application
flow as Settings: Refresh branches, Check for updates, and Start update. The
CLI updater script was not used to start the installation.

The checked plan paired current commit
`158bd3d9ee5679e79f61394c93a6eed1d4b2154f` with exact target
`8aff5ea9e13387b87666c6340c3bcdd1f92ff56d`. Job
`df5529cd4002a8076f1cab53c2306db6` completed all 12 structured preparation
steps, activation, restart, and health verification in 1,170,302 ms:

- terminal state `succeeded`;
- warning count 0;
- rollback `not-required`;
- no reboot;
- installed Build ID `8aff5ea`;
- backend readiness returned to `ready`;
- MPV remained available.

Post-update checks passed:

- `eidetic-player.service` active and update system unit inactive;
- Preferences migrated in place to schema 3 at the same revision 31, with all
  previous values preserved and display defaults Off / 20% / Off;
- display state Active, software dim capability, real Wayland-output standby
  capability, no inhibition, test, or display error;
- GPIO/I2S audio selection preserved;
- Library counts and SMB availability unchanged;
- `EIDETIC_DISABLE_BLANKING=1` preserved;
- no residual npm, build, updater, installer, or FFmpeg process;
- a second Refresh/Check resolved current and target to the same exact commit,
  returned `updateAvailable=false` and `already-up-to-date`, with the completed
  job still showing no rollback.

### Raspberry touch wake follow-up

Physical use after the update exposed a Raspberry-only wake defect after
selecting Dim after 1 minute and running dim tests. The dim mechanism worked,
but touch commands stopped reaching System/Display.

Read-only remote diagnosis captured:

- backend display state `dimmed`, revision 34, with `testActive=null`, no next
  transition, no inhibition, and no display error;
- persisted Dim 60 seconds / Level 20% / Standby Off at Preferences schema 3,
  revision 32;
- backend readiness `ready`, MPV available, and the user service active;
- two real Wayland screenshots showing the software dim overlay and global wake
  shield still covering System while the visible clock advanced from 19:24 to
  19:26;
- a live WebKit process, proving the UI event loop had not frozen;
- no backend wake call or display failure in the service journal.

The controller listened for `pointerdown`, key, wheel, and mouse movement, but
its capture-phase `click` handler only suppressed the compatibility click that
normally follows a Pointer Event. WebKitGTK/touch can supply the usable tap as
a click without a matching wake Pointer Event, leaving that click targeted at
the transparent shield and the display permanently Dimmed.

The click capture path now:

- first consumes a pending compatibility click without issuing a duplicate
  wake;
- otherwise treats a click received in Dimmed/Standby/transition state as the
  required fallback wake input;
- prevents and stops that first click so the underlying control is not
  activated;
- leaves clicks untouched while Active.

Focused regression coverage proves both click-only wake and one wake for the
`pointerdown + compatibility click` pair. Validation after the correction:

- focused display-idle tests: PASS, 9/9;
- `npm.cmd run format:check`: PASS;
- `npm.cmd run typecheck`: PASS;
- `npm.cmd run lint`: PASS;
- full `npm.cmd test`: PASS, 621 passed / 11 platform skips / 0 failed;
- `git diff --check`: PASS.

The installed Raspberry remains on reviewed build `8aff5ea`; this follow-up is
local and intentionally was not hot-patched or deployed without a new manual
commit, exact-head CI, and normal update. The service was not restarted because
the paused live session still contained 175 Queue items.

The user subsequently committed and pushed this correction as
`f561f193bdde9611486995e93e19b085b71c8d44`. The checkout was clean and
equal to `origin/main`; exact-head GitHub Actions run `30566783396` completed
successfully. The Raspberry was intentionally not updated.

### Playback inhibition and low-dim follow-up

The user explicitly superseded the earlier requirement that automatic display
idle continue during playback:

- automatic Dim and Standby are now suspended while the player is loading or
  playing;
- starting playback clears the single display timer and restores Active if the
  display was already Dimmed or in Standby;
- pause or stop creates a new monotonic activity epoch and starts the full
  configured countdown;
- saved timeout preferences are not modified;
- explicit display tests retain their bounded fail-safe behavior.

The Dim level selection now exposes exactly 5%, 10%, 20%, 30%, 40%, and 50%.
The default remains 20%; schema 3 remains current because the preference field
and persisted representation did not change. The existing field validator now
accepts 5%.

The UI controller observes the existing player store and owns only this timer
inhibition. No playback command, MPV behavior, backend PlayerService,
Audio Output route, SSE, interval, or polling path was added or changed.
Display copy explains that automatic inactivity applies outside playback.

A second read-only Raspberry diagnosis after the reported restart confirmed
that the whole System page had not developed a separate freeze:

- the installed build was still `8aff5ea`, which predates the click-wake fix;
- the service had restarted successfully and remained active;
- after the persisted one-minute timeout, backend state was again `dimmed`
  with `testActive=null`, no error, and no next transition;
- the global wake shield therefore covered System again and touch-only click
  fallback remained unavailable in the installed build.

Focused regression coverage passes for:

- the complete 5/10/20/30/40/50 level vector and persisted 5% selection;
- no automatic timer while loading/playing;
- wake to Active when playback starts from Dimmed;
- a fresh full countdown after pause;
- the existing click-only wake and no-duplicate compatibility click contract;
- unchanged System hierarchy and no new display polling or EventSource.

Final follow-up validation:

- focused display, Preferences, and Settings tests: PASS, 26 passed / 1
  platform skip / 0 failed;
- `npm.cmd run format:check`: PASS after correcting the reported mechanical
  wrapping in `app-shell.ts`;
- `npm.cmd run typecheck`: PASS;
- `npm.cmd run lint`: PASS;
- `npm.cmd run build`: PASS;
- `npm.cmd run build:linux`: PASS;
- full `npm.cmd test`: PASS, 624 passed / 11 platform skips / 0 failed;
- `npm.cmd run test:posix`: PASS, 3 passed / 2 platform skips / 0 failed;
- `git diff --check`: PASS.

Real Neutralino/WebView2 follow-up QA used the required
`npm.cmd run dev` path:

- 1280x800 Display page: PASS, with stable playback-policy copy, canonical
  rows/actions, and no wrapping or overflow regression;
- 1280x800 Dim level page: PASS, all six 5/10/20/30/40/50 rows visible with
  the selected check and stable mini-player;
- 1024x600 Dim level page: PASS, canonical row height preserved and native
  vertical scrolling exposes the remaining choices without horizontal
  overflow;
- with Dim temporarily set to 1 minute, 70 seconds of real playback remained
  Active and published no display deadline;
- after Pause, display remained Active at 45 seconds and became Dimmed only
  after the new full minute;
- the first input over the Dim row woke and was consumed without navigating;
- the development preference was restored to Dim Off, output was restored
  Active, Neutralino closed normally, and ports 4310/5173 were clear.

The follow-up remains local and uncommitted. It requires the user's next manual
commit and exact-head CI but does not require an immediate Raspberry update.

`SYSTEM BLANKING DISABLED BY APPLIANCE CONFIG — PRESERVED`

Still requiring direct physical observation and therefore not claimed:

- physical Raspberry software-dim appearance and wake;
- real display output-off and 15-second fail-safe;
- touch, mouse, keyboard, and wheel first-input consumption over real controls;
- no automatic Dim/Standby while playing, followed by a full pause/stop
  countdown to Active -> Dimmed -> Standby;
- HDMI-audio physical inhibition/release;
- service-restart display recovery;
- final physical preference, output, and interaction restoration.

The pre-CI status
`READY FOR CI VALIDATION — RASPBERRY DISPLAY VALIDATION NOT STARTED` has been
superseded by a successful exact-head CI and remote in-app update. The final
status `RASPBERRY SCREEN DIM AND DISPLAY STANDBY — PASS` is intentionally not
claimed until the remaining physical checks are observed.
