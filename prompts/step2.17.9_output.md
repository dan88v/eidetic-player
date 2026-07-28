# Step 2.17.9 — In-App Updater and Branch Selection

Status: READY FOR CI VALIDATION — IN-APP UPDATER NOT DEPLOYED

## Baseline Git and CI

- Branch: `main`
- Baseline commit: `e76cbe7ed215cb3f898842267378910485e52e9a`
- Baseline Build ID: `e76cbe7`
- `HEAD` matched `origin/main` before development.
- Exact-head GitHub Actions run `30379506632` completed successfully for the
  baseline commit.
- The baseline worktree was clean.
- No commit, push, Raspberry update, or deployment was performed by this step.

## Existing updater audit

The existing Linux updater remains the owner of source fetch, the isolated
non-root build, release verification, atomic `current`/`previous` switching,
Build ID health verification, the MPV soft-readiness warning, automatic
rollback, no-op behavior, configuration/data preservation, and GPIO/I2S
preservation. The in-app path delegates to it with an exact 40-character SHA;
it does not duplicate or weaken that transaction.

The updater already carried the real versioned runtime progress protocol over
an inherited descriptor. Step 2.17.9 adds only the minimum structured events
needed at activation, restart, health verification, readiness warning, and
rollback boundaries. Human stdout, stderr, and logs are never parsed.

## Privilege architecture and runner lifecycle

The UI and backend do not own the privileged update process:

1. The local backend performs explicit branch discovery and creates an
   in-memory immutable plan.
2. The backend invokes one fixed helper with `pkexec
--disable-internal-agent` and an argument array.
3. The root helper revalidates action, runtime user, branch, plan ID, exact
   SHAs, expiry, installed build, selected config, and canonical remote.
4. The helper writes a mode-0600 root-owned request atomically.
5. It starts `eidetic-player-update.service` without waiting for the job.
6. The system runner rereads and revalidates the request, takes a non-blocking
   `flock`, and invokes the installed updater with `--ref <exact-SHA>
--unattended --no-color`.

The root system oneshot is external to `eidetic-player.service`, so backend,
GUI, user-service, and release replacement do not terminate it. It uses a
private FIFO and two dedicated inherited descriptors for structured progress.
There is no update queue and no UI cancel action.

### systemd unit

`eidetic-player-update.service` is a root `Type=oneshot` unit with:

- a fixed `ExecStart`;
- `ConditionPathExists` on the private request;
- `UMask=0077`;
- `NoNewPrivileges`;
- private temporary storage;
- personality/realtime restrictions;
- no start timeout.

`ProtectHome` and `ProtectSystem` remain disabled because the existing
transaction must legitimately update `/opt`, `/etc`, packages, and the runtime
user's managed desktop files. Restricting those paths would break updater
correctness.

### Helper and Polkit

- Helper: `/usr/libexec/eidetic-player-update-helper`, root-owned mode `0755`.
- Runner: `/usr/libexec/eidetic-player-update-runner`, root-owned mode `0755`.
- Journal writer:
  `/usr/libexec/eidetic-player-update-journal.mjs`, root-owned mode `0755`.
- Unit: `/etc/systemd/system/eidetic-player-update.service`, root-owned mode
  `0644`.
- Policy: `/etc/polkit-1/rules.d/49-eidetic-player-update.rules`, root-owned
  mode `0644`.

The generated rule exact-matches the helper program, configured runtime user,
active local session, and Polkit exec action. There is no wildcard
administrative action, arbitrary executable, remote URL, shell string, or unit
name.

### State paths and ownership

- Config: `/etc/eidetic-player/update.conf`, root-owned mode `0644`.
- State: `/var/lib/eidetic-player/update`, root/runtime-user group mode `2750`.
- Request: `request.json`, root-owned mode `0600`.
- Current journal: `current.json`, mode `0640`.
- History: `history/`, bounded to the latest ten synthetic results.
- Existing protected updater logs remain mode `0600` under
  `/var/log/eidetic-player`.

Symlinks, unexpected owners/modes, path traversal, malformed fields, stale
current builds, and expired requests are rejected. The FIFO uses a private
root-created directory rather than a predictable path.

## Dedicated update configuration

`update.conf` contains only:

- schema version;
- canonical installed source;
- selected validated branch.

It contains no target SHA, job state, output, credentials, or generic UI
preferences. Creation and branch changes use same-directory atomic rename.
An existing valid selection survives reinstall and update. A normal uninstall
preserves it while removing runner state and integration; purge removes it.
The default is the installed source branch when branch provenance is proven,
otherwise `main`.

The privileged integration is installed only in Appliance mode. The harmless
dedicated branch config may also exist in Standard mode, but the API reports
the feature unavailable and Settings does not render it.

## Branch discovery and validation

`Refresh branches` is the only branch-discovery trigger. There is no network
check at boot, Settings open, on a timer, or in the background.

- Source is fixed to `https://github.com/dan88v/eidetic-player.git`.
- Discovery uses bounded `git ls-remote --heads`.
- Timeout is 15 seconds.
- Captured output is bounded to 256 KiB and 512 lines.
- Names and 40-character SHAs are validated and deduplicated.
- `main` sorts first and is labelled Stable.
- Every other valid branch is labelled Development.
- Selection is accepted only from the most recently refreshed set.
- Git option injection, controls, malformed refs, unknown JSON fields, free
  refs, free remotes, and command fields are rejected.
- Invalid or non-local Origin and non-loopback clients are rejected for the
  update API.

## Check and immutable exact-SHA plan

`Check for updates` resolves only the configured branch and records:

- random 128-bit plan ID;
- branch;
- current full and short SHA;
- target full and short SHA;
- `updateAvailable`;
- `checkedAt`;
- `expiresAt`.

The plan expires after exactly 30 minutes. A new Check or branch selection
replaces/invalidates it. Refresh alone does not alter it. Start accepts only
the plan ID and matching expected target SHA, verifies that the current build
has not changed, and passes the pinned SHA to the runner. A branch advancing
after Check does not change the target; reaching its new HEAD requires another
Check.

An already-installed target is a no-op: Start stays unavailable and the
service rejects a direct Start request without creating a job.

## Structured progress and atomic journal

Only `EIDETIC_PROGRESS_V1` records are accepted. Labels have control characters
removed and fixed length bounds. Runtime start/done/skipped/failed events,
activation, restart, verification, warning, and rollback events map to the
versioned journal.

The journal includes:

- schema and monotonic revision;
- job ID, branch, exact current/target SHAs;
- state and real phase index/total;
- bounded label and optional substep;
- start/update/completion times and elapsed milliseconds;
- synthetic result and rollback result;
- warning count and verified service state.

Every current-journal write performs temporary-file creation, file `fsync`,
atomic rename, and parent-directory `fsync`. It stores no raw log, command
line, environment, repository path, password, or credential.

The backend reads at a fixed two-second cadence on Linux but emits SSE only
when revision/time actually change. Missing idle state no longer creates
synthetic periodic revisions. The app owns exactly one update EventSource. The
header's one-second elapsed display timer exists only while its status popover
is open.

If the journal says active but the system unit is absent after a crash or
reboot, the backend derives `interrupted`; it never starts another update
automatically. A systemd unit, non-blocking `flock`, root request, and journal
state jointly enforce the singleton.

## Priority and activation boundary

The runner starts preparation with `nice -n 10` and best-effort
`ionice -c 2 -n 7`. Immediately before atomic release activation, the embedded
installer restores normal CPU priority and a normal best-effort I/O priority
for installer, updater, restart, and verification. Priority reduction never
changes build, verification, activation, or rollback semantics.

The application remains mounted during preparation. On
`activation-imminent`, it closes overlays, flushes preferences, blocks power
actions, and displays only:

`Applying update…`

`Eidetic Player will restart in a moment.`

The state accepts a new backend generation even when the backend revision
counter restarts. A recent terminal journal result is reported after the GUI
reconnects; old completed jobs remain visible in Settings without producing a
toast on every later launch.

## API and SSE

Shared contracts define the closed states, reason codes, branch records, plan,
phase, job, snapshot, and request bodies. The loopback REST surface provides:

- state;
- explicit branch refresh;
- branch selection;
- Check;
- Start.

One separate SSE endpoint owns low-frequency update state. Bodies require JSON,
have tight size bounds, and reject unknown fields. No update state enters the
player SSE or high-frequency visualizer path.

## Settings and result UX

`Settings > System` uses the canonical Settings contract and places `Software
update` before Maintenance. The page exposes:

- Update branch;
- Current build;
- Target build;
- Check for updates;
- Start update;
- current/last job status.

The branch page begins unloaded, exposes explicit Refresh, uses Stable and
Development pills, and shows a right-side check for selection. Branch controls,
Check, Start, and Maintenance are disabled where an active job would conflict.

The canonical confirmation dialog shows branch, current Build ID, target Build
ID, expected brief restart, Cancel, and Start update. Success, preparation
failure, interruption, verified rollback, and unverified rollback use concise
toasts plus the persistent Settings result.

The top bar permanently reserves one icon slot, preventing Wi-Fi, audio, SMB,
and clock movement when the spinner appears or disappears. Tap toggles the
status panel; mouse hover and keyboard focus open it. The panel shows branch,
target Build ID, phase, substep, live elapsed time, warnings, and state.
Animation Off and `prefers-reduced-motion` disable rotation without hiding the
status.

## Installer, update, doctor, and uninstall

- Production releases now retain the trusted Linux deployment scripts required
  by the external runner; generated Python bytecode is pruned.
- Appliance install deploys the helper, runner, journal writer, unit, policy,
  state directories, and config idempotently.
- Traditional update preserves the branch config and reinstalls integration
  through the same verified installer.
- The doctor verifies config, modes, rendered policy, state directory, and
  root ownership in Appliance mode.
- `restore-system-ui.sh` preserves the updater's non-UI integration; the
  uninstaller remains its explicit lifecycle owner. A Linux staging regression
  test caught and proves this boundary.
- Uninstall stops/removes the system runner and deletes runtime job state.
- Uninstall dry-run changes none of those paths.
- Normal uninstall preserves branch config.
- Purge removes branch config.
- Automatic rollback continues to restore and verify `previous`; its result is
  now represented in the journal.

## Automated tests and staging

Focused tests cover:

- branch/ref/body validation and option injection;
- explicit discovery and Stable/Development classification;
- undiscovered-branch rejection;
- exact-SHA pinning when the fixture branch advances;
- exact 30-minute expiry;
- active-job singleton;
- active branch-change rejection;
- running, activating, restarting, and succeeded lifecycle;
- up-to-date no-op;
- non-Appliance unavailability;
- systemd/helper/runner/progress/rollback deployment contracts;
- System hierarchy, unloaded branch page, explicit Refresh, disabled states,
  confirmation, one SSE stream, restart-generation handling, status slot,
  elapsed timer, hover/focus, and reduced motion.

Linux isolated staging covers installation modes, integration modes, valid config,
branch preservation across reinstall/update, traditional exact-release update,
rollback, doctor, non-destructive uninstall dry-run, normal uninstall cleanup,
config preservation, purge, and repeated uninstall. The final gate result is
recorded below.

## Windows real-application QA

The real Neutralino/WebView2 application was launched with the mandatory
`npm.cmd run dev`, MPV `0.41.0`, Appliance fixture, and deterministic 30-second
update fixture. No browser fallback or real Windows update was used.

Verified with physical pointer input:

- System and Software Update hierarchy;
- unloaded and refreshed branch pages;
- Stable/Development pills and selected check;
- Check, current/target builds, confirmation, and Start;
- spinner during preparation on Now Playing, Sources, and Audio;
- mouse-hover status panel with live elapsed time;
- Queue overlay and empty state while preparation continued;
- transport, mini-player, Sources, Settings, and Audio remained usable;
- activation surface;
- simulated backend restart-generation recovery and terminal result;
- canonical Power surface;
- clean native window close.

The session was empty/paused, so audible playback continuity was not claimed.
Transport and playback surfaces remained interactive, but the required real
Raspberry playback-during-build result remains deferred.

Viewport results:

- `1280 × 800`: PASS
- `1024 × 768`: PASS
- `1024 × 600`: PASS; vertical Settings scrolling retained full touch targets
- `1366 × 768`: PASS

No white flash, horizontal overflow, scroll jump, mini-player regression, or
update-icon layout shift was observed. The activation surface intentionally
replaces all other content.

Clean shutdown evidence after QA:

- zero Neutralino processes;
- zero MPV processes;
- no listeners on ports 4310 or 5173.

## Performance

- One update SSE connection per app.
- One 2-second read-only journal poll on deployed Linux.
- SSE emits only on journal change.
- One elapsed timer only while the update popover is visible.
- No player-store update, visualizer connection, `requestAnimationFrame`, or
  playback timer was added.
- Progress writes occur per real phase event, never per log character/frame.
- Branch discovery is bounded and validates remote-returned refs without
  spawning one Git process per branch.
- Heavy preparation uses reduced CPU/I/O priority; activation does not.

Windows pointer/SSE feedback was visually immediate at the 30-second fixture
scale. Real Raspberry CPU, memory, I/O, MPV dropout, command latency, and
playback continuity measurements are deferred until the runner is deployed
after exact-head CI.

## Full local gates

Final gate execution:

- `npm run format:check`: PASS
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run build:linux`: PASS
- `npm test`: PASS — 599 tests, 588 passed, 11 skipped, 0 failed
- `npm run test:posix`: PASS — 3 passed, 2 platform skips
- `npm run verify:linux:installer`: PASS — deployment contracts, executable
  modes, install-safe suite, and network integration
- WSL `bash deploy/linux/test-staging.sh`: PASS — complete isolated Linux
  lifecycle, including the restore/updater ownership regression
- `npm run verify:network:deployment`: PASS (also included by installer gate)
- `npm run verify:linux:executables`: PASS
- `npm run verify:linux:release -- --root . --arch arm64 --phase build`: PASS
- `npm run mpv:doctor`: PASS
- `npm run test:mpv`: PASS — 10 passed
- `npm run ffmpeg:doctor`: PASS
- `npm run test:ffmpeg`: PASS — 3 passed
- `bash -n` on every changed/new shell executable: PASS
- `git diff --check`: PASS

Post-checkpoint CI corrections:

- the helper, runner, and journal Git modes were corrected to `100755`;
- the Node journal source was moved from `deploy/linux/runtime/` to
  `deploy/linux/lib/`, because the CI contract intentionally parses every
  deployment `runtime/` entrypoint as Bash;
- the installed journal path remains
  `/usr/libexec/eidetic-player-update-journal.mjs`;
- the exact CI `find ... | xargs bash -n` command, executable-mode verifier,
  full test suite, and Linux installer gate pass after the correction.

ShellCheck was not installed in Windows or the existing WSL Debian environment
and was not installed for this step. `bash -n` covers every modified shell
file.

## Diff and package review

The change is limited to shared update contracts, backend update API/state,
external Linux runner integration, minimal structured updater events, System
Settings UI, header status, tests, documentation, and this report.

Protected-path diffs are empty for:

- `package.json`, `package-lock.json`, `.github/workflows`;
- player, audio-output, audio-processing, SMB, network, and library backend
  directories;
- Now Playing, reliable touch scroll, visualizer, preferences contract, and SMB
  helper.

Dependency graph and package plan are unchanged.

Modified/new implementation areas:

- `packages/shared/src/update.ts`
- `apps/backend/src/update/*`
- backend route integration and tests
- update API client, app shell, top bar, Settings, styles, and UI tests
- Linux helper, runner, journal, systemd/Polkit templates
- installer, updater, doctor, staging, uninstall, and Linux guide
- development architecture/index/Software Update guide
- this step report

## Pre-CI checkpoint and deferred Raspberry validation

No automatic commit or push was performed. The first Raspberry transition to
this build must still use the existing verified
`scripts/remote-rpi-update.ps1` after a manual commit/push and successful
exact-head CI. That bootstrap installs the system runner.

After bootstrap, the next device pass must verify installed paths/modes/owners,
branch config, journal, unit, helper, policy, readiness, MPV, first local Check,
shown exact SHA, a later real in-app target update, player usability during the
build, restart/reconnect, target Build ID, singleton, and updater no-op.

First real in-app update: DEFERRED — no build containing this runner has been
committed, passed exact-head CI, or been deployed.

Playback during a real build: DEFERRED — Windows surfaces remained responsive,
but an audible Raspberry session is required.

Restart result: Windows fixture PASS; real systemd/user-service restart
DEFERRED.

Updater no-op: automated Windows/service and traditional staging PASS; real
in-app Raspberry no-op DEFERRED.

`RASPBERRY SETTINGS PERSISTENCE ACROSS UPDATE — HOLD`

The full Step 2.17.6 before/after preference comparison remains intentionally
reserved for the bootstrap/next update.

`RASPBERRY AUDIO OUTPUT AND DSP VALIDATION — HOLD`

Earlier physical UI/listening observations are valuable but do not constitute
the complete Step 2.17.8 route, Fixed/Variable, maximum, Mono, Balance, EQ,
headroom, signal-path, external-FFmpeg, and visualizer certification.

Cleanup: local app/process/socket cleanup PASS; Raspberry update artifacts are
not applicable because nothing was deployed.

READY FOR CI VALIDATION — IN-APP UPDATER NOT DEPLOYED
