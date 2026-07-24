# Step 2.13.2-R3 — Short runtime, keyboard option and read-only checkout

## Result

Implemented. The three Raspberry Pi installation defects were addressed without
changing the Player UI, Library, Queue, SMB/USB/Network behavior, internal
Eidetic keyboard, supported platforms or APT package plan.

The MPV failure was caused by the long Unicode build workspace being reused as
the XDG runtime fallback. The installer now deliberately keeps that workspace
for `TMPDIR`, but creates a separate private `/tmp/ep-r.XXXXXX` runtime for
`XDG_RUNTIME_DIR`.

The original source checkout is now bootstrap-only and read-only. Production
installation no longer fetches, archives or builds in it. Git fetch and detached
checkout happen in an isolated repository owned by the non-root runtime user.

## Build runtime and socket budget

- `eidetic_prepare_build_runtime` creates an absolute, unique directory through
  `mktemp`, outside the home and long workspace.
- The runtime has mode 0700 and the runtime user's UID and primary GID.
- `eidetic_run_as_runtime_user` receives the long workspace, short runtime,
  managed Node directory and command argv explicitly.
- `TMPDIR` remains `<long-workspace>/.tmp`; `XDG_RUNTIME_DIR` is the short
  runtime. npm cache also remains in the long workspace.
- The controlled `env -i` retains explicit HOME/USER/LOGNAME/PATH/C.UTF-8 and
  disables npm user configuration, Git prompts and global/system Git config.
- Before npm starts, a representative
  `<runtime>/eidetic-player/mpv-9999999999-<uuid>.sock` is measured and must be
  below the existing 100-byte portable limit.
- Success and failure traps remove the long workspace, short runtime, Unix
  sockets, npm cache, temporary Git repository and incomplete incoming release.
  Existing `current`, `previous`, releases and XDG application data are
  preserved.

## Read-only checkout and isolated Git

The checkout preflight runs before APT or other administrative changes. It
validates the absolute Git checkout, required bootstrap files, traversal and
runtime-user read/execute access, HEAD, official origin, dangerous symlinks and
world-writable top-level permissions. A root-owned checkout is accepted when
the runtime user can safely read it; `.git` and the working tree do not need to
be writable.

The production source flow now:

1. creates a runtime-owned source directory in the temporary workspace;
2. initializes an isolated repository;
3. adds the fixed official origin
   `https://github.com/dan88v/eidetic-player.git`;
4. performs a shallow, no-tags fetch of the validated ref;
5. checks out `FETCH_HEAD` detached;
6. runs npm lifecycle commands in that isolated source.

The original HEAD, refs, index, `FETCH_HEAD`, status, ownership, modes, file
inventory and hashes remain unchanged in the read-only fixture. No
`node_modules`, `dist`, cache or temporary files are created there. Permission
diagnostics recommend a targeted owner/private-mode repair only when required;
the installer neither requires nor recommends `chmod 777`.

`update-eidetic-player.sh` delegates to the installer and therefore inherits
the same short runtime, isolated fetch, transaction and keyboard choice.

## Raspberry Pi OS on-screen keyboard

The installer accepts:

`--rpi-onscreen-keyboard keep|disable`

The default is `keep`. On Raspberry Pi OS, interactive Standard and Appliance
installs ask once, before APT:

`Disable the Raspberry Pi OS on-screen keyboard and use Eidetic Player's keyboard instead? [y/N]`

Unattended installs keep the OS keyboard unless `disable` is explicit. Dry-run
prints the selected policy without changing it. Ubuntu accepts `keep` and
rejects `disable`.

The implementation uses the supported non-interactive Raspberry Pi
`raspi-config` functions `get_squeekboard` and `do_squeekboard`, mapping S1,
S2 and S3 to Always On, Autodetect and Always Off. Before disabling, the exact
original state is saved once in a root-only versioned deployment file. Repeated
install/update does not overwrite that original backup.

Restore and uninstall reapply and verify the exact saved state, support dry-run
and staging roots, and remain idempotent across repeated calls. Unsupported
`raspi-config`, unreadable state or apply failure aborts before release
activation; a change made during the failed attempt is rolled back. No keyboard
package is removed, no generic display reset is performed and the internal
Eidetic keyboard is unchanged.

## Transaction

All choices and platform checks precede dependency work. Node preparation,
isolated fetch, non-root npm lifecycle, artifact validation, incoming release
and managed administrative files complete before the keyboard policy is
applied and verified. Only then is the release activated atomically.

Failure cleanup preserves `current` and `previous`, removes incoming and both
temporary roots, and allows a direct retry without reinstalling Raspberry Pi OS,
Node or application data.

## Verification

- Baseline: `main`, clean, no merge/rebase, `HEAD == origin/main`,
  `f15b2f7`.
- `bash -n` on modified Linux scripts: PASS.
- ShellCheck: unavailable in the configured Ubuntu WSL environment.
- Non-root runtime/socket/read-only checkout/isolated Git/failure-retry
  fixture: PASS.
- Raspberry Pi keyboard keep/disable/all three restore states/repeat/dry-run/
  Ubuntu rejection/failure rollback/update/double restore and uninstall
  fixture: PASS.
- Raspberry Pi OS and Ubuntu staging install/update/rollback/doctor/restore/
  uninstall and failure-retry scenarios: PASS.
- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd test`: PASS, 426 passed and 3 platform skips.
- `npm.cmd run mpv:doctor`: PASS.
- MPV integration rerun: PASS, 8/8. The first run had two transient MPV
  `property unavailable` failures; they were not reproducible on the immediate
  isolated rerun.
- `npm.cmd run dev`: PASS smoke test. Vite, backend and Neutralino started;
  Neutralino exited with code 0 and the backend handled SIGTERM.
- Final cleanup: no development listeners, test-started project processes,
  build workspaces, short runtimes, temporary Git repositories, MPV sockets,
  incoming releases or staging fixtures remained.
- `git diff --check`: PASS.
- Real Raspberry Pi 3 installation: **NOT TESTED**.

## Files changed

- `deploy/linux/lib/common.sh`
- `deploy/linux/install-eidetic-player.sh`
- `deploy/linux/update-eidetic-player.sh`
- `deploy/linux/restore-system-ui.sh`
- `deploy/linux/test-unprivileged-build.sh`
- `deploy/linux/test-rpi-keyboard.sh`
- `deploy/linux/test-staging.sh`
- `apps/backend/test/linux-installation.test.ts`
- `deploy/linux/README.md`
- `prompts/step2.13.2_r3_short_runtime_keyboard_checkout_output.md`

No commit or push was performed.
