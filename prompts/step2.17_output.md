# Step 2.17 — Guided Linux Installer/Uninstaller UX

Date: 2026-07-27

## Result

`READY FOR CI VALIDATION`

Installer and uninstaller now default to a guided terminal flow while all
technical and unattended contracts remain available. This report does not
claim a new GitHub Actions PASS.

## Baseline Git and CI

- Branch: `main`.
- Initial working tree: clean.
- Initial divergence from `origin/main`: `0 0`.
- Exact baseline:
  `70e843f3c40369c66ee683ea283f5bda1a9f2a80`.
- Step 2.15, Step 2.15.1-R1/R2, Step 2.16, Step 2.16.1, and Step 2.15.2
  were present.
- The GitHub `Linux checks` job for the exact Step 2.15.2 commit was
  successful. Its development-dependency annotation was non-blocking.
- No merge, rebase, reset, restore, stash, clean, commit, or push was run.

## Installer/uninstaller audit

- The installer retained one transactional release activation path, the
  existing system manifest, exact runtime-user execution, install-safe/full
  verification profiles, and GPIO/I²S session rollback.
- Standard still forces the seven Appliance choices to No.
- Appliance still controls autostart, fullscreen, borderless, blanking,
  pointer hiding, splash, and autologin independently.
- Runtime user still comes from `SUDO_USER` or explicit `--user`.
- Root is required for a real target; help and version return before root
  validation.
- Updater already delegated with `--unattended`; it now optionally propagates
  explicit verbose/no-color choices.
- The updater preserves its administrative `PATH` after reading
  `install.conf`. This fixes the discovered case where the service PATH could
  hide `/usr/sbin/runuser`; installed PATH and package plan are unchanged.
- Restore now records the current managed-file hash and restores only when
  ownership and current integrity remain provable. Legacy, missing, or
  externally changed targets are preserved for manual review.

## Preserved flags

Installer:

- `--user`
- `--ref`
- `--mode standard|appliance`
- `--dry-run`
- `--unattended`
- `--full-verify`
- `--root`
- `--autostart`
- `--fullscreen`
- `--borderless`
- `--disable-blanking`
- `--hide-pointer`
- `--splash`
- `--autologin`
- `--rpi-onscreen-keyboard`
- `--gpio-i2s-dac`

Uninstaller:

- `--root`
- `--dry-run`
- `--purge-data`
- `--yes-really-purge-data`
- `--remove-gpio-i2s-dac`

Updater, rollback, restore, doctor, release verifier, Network, Power, and GPIO
technical contracts remain unchanged.

## Common terminal arguments

Installer and uninstaller support:

- `-v` and `--verbose`;
- `--no-color`;
- `-h` and `--help`;
- `--version`.

Help and version are read-only, require no root, and create no system log.
Version is read from the authoritative project package manifest and is emitted
as `eidetic-player-linux-(un)installer <version>`.

## No-argument behavior

- TTY: guided procedure.
- Non-TTY: exit 64 with a clear explanation and concise usage.
- The non-TTY path never guesses Standard/Appliance and never waits for input.
- Explicit unattended paths never prompt, animate, or emit color.
- Internal staging callers now pass `--unattended` explicitly.

## Console UI

- Shared source-only library: `deploy/linux/lib/console-ui.sh`.
- Git mode: `100644`; it is not advertised as directly executable.
- Compact 52-column ASCII header distinguishes Linux Installer and Linux
  Uninstaller.
- Colors are enabled only for a compatible stdout TTY.
- Defining `NO_COLOR`, `--no-color`, `TERM=dumb`, or non-TTY output disables
  ANSI completely.
- Text labels remain explicit: `DONE`, `WARNING`, `FAILED`, and `SKIPPED`.
- Prompt helpers validate yes/no and numbered choices iteratively, display the
  default, and safely handle invalid input and EOF.

## Progress, spinner, and output

- A normal install has nine real phases:
  1. Preflight;
  2. System detection;
  3. System dependencies;
  4. Application runtime;
  5. Release staging and verification;
  6. System integration;
  7. Optional configuration;
  8. Release activation;
  9. Finalization.
- Percentage is completed phases divided by total phases.
- A dry-run has two read-only phases and reaches 100% without fake work.
- Optional phases advance deterministically.
- The ASCII `| / - \` spinner reports `MM:SS` elapsed time only.
- Normal TTY output hides raw child output.
- Verbose output shows sanitized previews and live child output.
- Non-TTY output is line-oriented:
  `STEP n/total START|DONE|SKIPPED <label>`.
- No `eval`, global `set -x`, fake apt/npm/systemctl percentage, or output
  pipeline that replaces a command exit code was introduced.

## Logging

- A complete technical log is created for every install/uninstall operation.
- Preferred directory: `/var/log/eidetic-player`.
- Before that is writable, a collision-safe `mktemp -d` private fallback is
  used and reported.
- Directory mode: `0700`.
- File mode: `0600`.
- Names include category, UTC timestamp, Bash PID, and collision counter.
- Rotation retains the newest ten install logs and newest ten uninstall logs
  independently.
- Rotation follows no symlink and removes no foreign-category file.
- Rotation failure is recorded as a warning.
- Logs include provenance, phases, sanitized commands, child output, errors,
  rollback, and final status.
- ANSI is stripped before finalization.
- Password/token/secret/credential/passphrase arguments are redacted.
- Prompt responses, including the data-deletion response, are not logged.

## Guided Standard and Appliance flows

- System and platform are detected before mode selection.
- Standard/Appliance descriptions are concise and numbered.
- Existing Raspberry keyboard and GPIO/I²S questions are retained.
- GPIO/I²S is not shown on unsupported hardware.
- The pre-install summary includes system, architecture, runtime user, mode,
  install path, autostart, fullscreen, GPIO status, preserved data, and reboot
  policy.
- Final confirmation is exactly `Proceed with installation? [Y/n]`.
- No confirms before any change and exits successfully.
- Final success includes mode, runtime user, service/autostart state, install
  path, GPIO status, preserved data, log, and doctor command.
- The only final reboot question defaults to No; unattended runs never reboot.

## Failure, warning, signal, and rollback behavior

- Blocking errors show a dedicated panel with failed phase, readable reason,
  original exit code, rollback result, log, doctor command, and a bounded
  sanitized diagnostic excerpt.
- Warning state is separate from failure and is summarized without changing
  the success exit code.
- `INT` exits 130; `TERM` exits 143.
- Spinner and captured descriptors are always stopped/restored.
- The active foreground child receives the terminal signal. Isolated SIGINT
  coverage also proves the simulated long-running child and spinner do not
  survive.
- The existing keyboard and GPIO session rollback paths run once from the
  installer cleanup trap and report success or manual-review failure.
- Fault staging proved no false `DONE`, no false success summary, and no
  activated release after managed optional-configuration failure.

## Guided uninstall

- Inventory and summary happen before service stop or removal.
- Application data is preserved by default.
- Data removal is a separate default-No question.
- A Yes explains the affected application-data categories and requires exact
  `DELETE`.
- Any other response preserves data, warns, and allows binary uninstall to
  continue.
- Existing unattended purge still requires both
  `--purge-data --yes-really-purge-data`; `--yes` was not added.
- Library, Favorites, settings, Audio Output preference, session, SMB
  configuration, and application data are preserved unless strongly
  authorized.
- Media, NAS/USB content, shared packages, users, groups, and unrelated
  NetworkManager profiles are never removed.

## Managed restore and GPIO/I²S

- Managed files now record both original and currently installed hashes.
- Restore/uninstall act only when current managed integrity still matches.
- Externally changed or externally removed files and legacy unproven records
  are preserved with warnings.
- Useful backups remain in the existing state directory.
- Pre-existing and managed-unowned GPIO/I²S configuration remains preserved.
- Proven managed GPIO/I²S removal has a separate default-No question.
- Data removal never implies GPIO/I²S removal.
- Explicit removal still uses the atomic Step 2.15.2 lifecycle and requires a
  later reboot without automatic restart.

## Tests and staging

Focused automated coverage includes:

- TTY header, color, progress, spinner, elapsed time, and prompts;
- `NO_COLOR`, `--no-color`, `TERM=dumb`, and non-TTY ANSI absence;
- normal hidden output plus complete log;
- verbose live output and sanitized command preview;
- preserved nonzero command status;
- log modes, secure fallback, rotation, category isolation, and symlink
  rejection;
- secret redaction;
- SIGINT 130, child termination, spinner termination, and no zombie;
- guided Standard and Appliance through a pseudoterminal;
- invalid/default input and cancel-before-change;
- guided uninstall default preservation;
- exact DELETE removal and failed DELETE preservation;
- external managed-file preservation;
- no-argument non-TTY failure;
- help/version without root;
- GPIO/I²S ownership and atomic lifecycle;
- update invocation, restore, rollback, repeated install/uninstall, and
  idempotency.

Root WSL staging was executed as root against temporary trees and passed.
Because WSL has no Linux Node binary, the staging harness used the already
installed Windows Node only for read-only release-contract verification,
mirroring the temporary artifact into a private Windows temp directory. No
package was installed and every real install/restore/remove mutation stayed
inside the Linux fixture roots.

Shell syntax passed for every modified shell script. ShellCheck was not
available and was not installed.

## Windows real smoke

`EIDETIC_MPV_PATH=C:\Tools\mpv\mpv.exe` with `npm.cmd run dev`:

- Neutralino/WebView2: PASS;
- Vite/backend readiness: PASS;
- MPV 0.41 discovery and runtime: PASS;
- FFmpeg discovery: PASS;
- Now Playing: PASS;
- Favorites: PASS, contents unchanged;
- Settings and Audio Output summary: PASS, preference unchanged;
- Network: PASS, no apply/connect/rescan action;
- Queue: PASS, rows unchanged;
- Power dialog: PASS, no device action;
- Quit: Neutralino reported success code 0 and backend received SIGTERM;
- final app processes and listeners: zero.

An initial timed launch left a second development instance and produced
transient proxy `ECONNREFUSED`; it was discarded and fully cleaned before the
single-instance smoke above. No media selection, Queue edit, Favorite edit,
network mutation, or audio-output mutation was made.

## CI follow-up

The first GitHub Actions run after the implementation failed in ShellCheck.
The preceding Debian 12 rejection was the expected result of the
`unsupported` staging fixture and was not the failing assertion.

The static-analysis failures were corrected by:

- declaring the source-only console library's Bash dialect without adding a
  shebang or changing its required `100644` Git mode;
- making the `common.sh` source hint resolvable by the CI `-P` search path;
- marking values intentionally shared across sourced files and subprocesses as
  exported;
- replacing ambiguous empty local declarations and spinner frame syntax;
- documenting the test-only trap callback and deliberately isolated fixture
  subshells;
- normalizing the final CRLF line in `test-staging.sh` to LF.

The exact CI ShellCheck invocation now passes without diagnostics using the
official ShellCheck 0.10.0 binary extracted temporarily; no system package or
repository dependency was installed. The complete root WSL staging suite also
passes with that ShellCheck binary present in `PATH`. A new GitHub Actions run
is still required, so this report does not claim CI PASS.

## Final gates

- `npm.cmd run format:check`: PASS
- `npm.cmd run typecheck`: PASS
- `npm.cmd run lint`: PASS
- `npm.cmd run build`: PASS
- `npm.cmd run build:linux`: PASS
- `npm.cmd test`: PASS, 502 passed and 10 skipped
- `npm.cmd run test:posix`: PASS, 3 passed and 2 skipped
- `npm.cmd run verify:network:deployment`: PASS
- `npm.cmd run verify:linux:executables`: PASS, 41 deployment files
- `npm.cmd run verify:linux:installer`: PASS; installer contract PASS and
  install-safe suite 54 passed, 11 skipped
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`: PASS
- `npm.cmd run mpv:doctor`: PASS, MPV 0.41 headless startup and JSON IPC
- `npm.cmd run test:mpv`: PASS, 8 passed
- `git diff --check`: PASS

The complete root WSL staging suite also passed, including the focused console
UI and guided installer/uninstaller PTY fixtures. After the CI follow-up, it
was repeated with ShellCheck available and passed without diagnostics.

## Package and regression firewall

- Application release code: unchanged.
- UI/backend/shared contracts: unchanged.
- Package plan: unchanged.
- npm dependencies: unchanged.
- `package.json`: unchanged.
- `package-lock.json`: unchanged.
- GitHub workflows: unchanged.
- Power helper/policy: unchanged.
- Network templates/integration: unchanged.
- GPIO/I²S Python helper: unchanged.
- The implementation phase did not touch a Raspberry, real `/boot`, or real
  Linux `/etc`; the separately authorized post-CI validation below did.
- Windows network and audio configuration were not touched.

## Files modified

- `apps/backend/test/linux-installation.test.ts`
- `apps/backend/test/neutralino-installer.test.ts`
- `deploy/linux/README.md`
- `deploy/linux/install-eidetic-player.sh`
- `deploy/linux/lib/common.sh`
- `deploy/linux/lib/console-ui.sh`
- `deploy/linux/restore-system-ui.sh`
- `deploy/linux/test-console-ui.sh`
- `deploy/linux/test-gpio-i2s-dac-staging.sh`
- `deploy/linux/test-guided-installer-staging.sh`
- `deploy/linux/test-rpi-keyboard.sh`
- `deploy/linux/test-staging.sh`
- `deploy/linux/uninstall-eidetic-player.sh`
- `deploy/linux/update-eidetic-player.sh`
- `docs/development/README.md`
- `docs/development/linux-debian.md`
- `docs/development/raspberry-remote-operations.md`
- `scripts/linux-verification.test.ts`
- `scripts/remote-rpi-reinstall.ps1`
- `scripts/remote-rpi-verify.ps1`
- `scripts/verify-linux-executable-modes.mjs`
- `scripts/verify-linux-installer-contract.ts`
- `prompts/step2.17_output.md`

Temporary fixture roots, Windows Node mirrors, fallback logs, screenshots,
development logs, and app processes are removed during final cleanup.

## Raspberry status

After the user confirmed the CI run was green, an explicitly authorized visible
SSH session connected to `daniele@10.0.0.112` and performed the real workflow:

1. stopped the running Eidetic Player service;
2. completed the guided uninstaller;
3. validated and removed only `/home/daniele/eidetic-player`;
4. cloned GitHub `main` at commit `4054bf5`;
5. completed the guided Appliance installation;
6. preserved application data and the pre-existing GPIO/I²S configuration;
7. rebooted from the final installer prompt.

The reboot intentionally reset SSH, producing client exit code `255`. After the
device returned, the user service was active and the installation doctor passed
every installation check. ALSA reported three cards with HDMI and the GPIO/I²S
DAC detected.

The first readiness request, only 36 seconds after boot, transiently reported
MPV unavailable while the backend was still cycling. Installed MPV path,
environment and permissions were correct; the user then tested the device
physically and confirmed MPV playback worked. Future verification uses a
bounded readiness wait instead of treating that early state as final.

`RASPBERRY GUIDED INSTALLER VALIDATION — PASS`

`RASPBERRY GUIDED UNINSTALLER VALIDATION — PASS`

`RASPBERRY REINSTALLATION — PASS`

`PCM5102A SYSTEM CONFIGURATION — PASS; PRE-EXISTING CONFIGURATION PRESERVED`

`RASPBERRY UPDATED-BUILD VALIDATION — PASS FOR INSTALLATION, BOOT, SERVICE, DOCTOR, AND PHYSICAL MPV PLAYBACK; BROADER UI CHECKLIST NOT RUN`

## Future Step 2.15.3 checklist

Prepared but not executed:

1. explicit user confirmation of update/reinstallation;
2. no-argument installer header, mode choice, prompts, summary, progress,
   spinner, and log;
3. pre-existing GPIO/I²S preservation;
4. install success and reboot prompt;
5. boot, Audio Output, PCM5102A, HDMI, Network, Favorites, Power, touch, OSK,
   Queue, Library, USB, SMB, doctor, and update;
6. uninstaller review, with real uninstall only after new authorization.

No commit or push was performed.
