# Step 2.14-R3 — READY FOR CI VALIDATION

## Result

The borderless installer choice is now normalized once before dry-run and
before the real/staging split. The same normalized value drives the real
Neutralino build environment and the installed `install.conf`.

All locally executable focused and full gates pass. The Windows
Neutralino/backend/MPV smoke also passes. Linux root staging and Raspberry Pi
hardware were not run locally, so CI PASS is not claimed before the next
GitHub Actions run.

## Baseline

- Branch: `main`.
- Initial working tree: clean.
- `HEAD...origin/main`: `0 0`.
- HEAD: `93759951c32139958a45dbc8abcbbe396a0e931c`.
- Commit: `step 2.14 r2 CI Validation Fix`.
- No merge or rebase was in progress.
- `deploy/linux/install-eidetic-player.sh`: Git mode `100755`.
- `deploy/linux/test-staging.sh`: Git mode `100755`.

## Original CI failure

The R2 GitHub Actions run passed:

- executable-mode verification;
- installer contract verification;
- all 61 install-safe tests;
- platform fixtures;
- staged-release verification.

The first staging installation then failed with:

```text
deploy/linux/install-eidetic-player.sh: line 428:
EIDETIC_BORDERLESS: unbound variable
```

The baseline installer used `set -euo pipefail`. It assigned
`EIDETIC_BORDERLESS` only inside the real-system branch:

```text
if [[ "$EIDETIC_ROOT" == "/" ]]; then
  ...
  EIDETIC_BORDERLESS=$([[ "${choice[borderless]}" == yes ]] && printf 1 || printf 0)
```

The staging path uses `--root <temporary-root>`, skips that branch, and later
expanded the missing variable while generating `install.conf`:

```text
EIDETIC_BORDERLESS=$EIDETIC_BORDERLESS
```

Under `set -u`, that expansion terminated staging after release verification.
The defect was choice normalization across the real/staging split; it was not
related to the R2 source remote, release verification, MPV, Network, the CI
runner, Raspberry Pi OS detection, or Standard/Appliance defaults.

## Test RED

Before changing production logic:

- the staging fixture was updated to unset `EIDETIC_BORDERLESS` before
  installer fixtures;
- Standard staging continues to use a non-root staging root with implicit
  borderless `no`;
- the real CI failure above remains the authoritative Linux behavioral
  reproduction because Linux staging cannot run on this Windows host;
- the new static contract was run against the unchanged installer and failed
  1 of 13 tests with:

```text
AssertionError: expected one normalized borderless value
```

The remote Git configuration and `set -u` were not modified.

## Normalization

After all Standard/Appliance choices are resolved, the installer now computes
one local value:

```bash
borderless_value=$(
  [[ "${choice[borderless]}" == yes ]] && printf 1 || printf 0
)
```

This occurs before the dry-run exit and before the real/staging branch.

The real build assigns and exports:

```bash
EIDETIC_BORDERLESS="$borderless_value"
```

The generated configuration writes:

```text
EIDETIC_BORDERLESS=$borderless_value
```

There is no `EIDETIC_BORDERLESS=$EIDETIC_BORDERLESS` expansion and no
`${EIDETIC_BORDERLESS:-...}` fallback in the installer.

The resulting contract is:

- Standard: `0`;
- Appliance `--borderless no`: `0`;
- Appliance `--borderless yes`: `1`;
- real Neutralino build and `install.conf`: the same normalized value;
- a pre-existing external `EIDETIC_BORDERLESS` value cannot override the
  installer choice.

## Staging coverage

`deploy/linux/test-staging.sh` preserves the existing Raspberry Pi OS, Ubuntu
amd64, Ubuntu arm64, Standard, Appliance, full-verify dry-run, update,
rollback, restore, uninstall, and R2 remote-validation coverage.

It now also:

- unsets `EIDETIC_BORDERLESS` before installer fixtures;
- asserts Standard writes `EIDETIC_BORDERLESS=0`;
- asserts Appliance borderless yes writes `1`;
- asserts Appliance borderless no writes `0`;
- runs one Standard staging installation with an external
  `EIDETIC_BORDERLESS=1` and still expects `0`.

The complete Linux staging suite was **NOT RUN locally**. Docker and
ShellCheck are not installed, and WSL was not used. The fixture will execute
on Linux CI without a skip or bypass.

## Complete `set -u` audit

Every `EIDETIC_*` expansion in the installer was reviewed through the end of
the file:

- `EIDETIC_ROOT`: initialized unconditionally to `/` before argument parsing,
  optionally replaced by validated `--root`, exported before helper use, and
  safe in both real and staging paths.
- `EIDETIC_RUNTIME_UID`, `EIDETIC_RUNTIME_GID`,
  `EIDETIC_RUNTIME_HOME`: initialized by
  `eidetic_load_runtime_identity` before platform detection and before the
  real/staging split. UID expansion is inside the real build branch; GID and
  HOME remain initialized for conditional staging configuration paths.
- `EIDETIC_DISTRO`, `EIDETIC_ARCH`: initialized and exported by
  `eidetic_detect_platform` before choices, logging, architecture selection,
  release verification, and later distro conditionals.
- `EIDETIC_INSTALLATION_MODE`: assigned and exported only in the real build
  branch where Neutralino generation consumes it. Installed configuration
  uses the always-initialized local `mode`.
- `EIDETIC_FULLSCREEN`: assigned and exported only in the real build branch.
  Installed configuration derives fullscreen directly from the resolved
  choice.
- `EIDETIC_BORDERLESS`: assigned in the real build branch from the
  always-initialized local `borderless_value`; installed configuration also
  uses that local value and no longer expands the branch-local environment
  variable.

No second staging-reachable unbound case of the same class was found. Variables
that were already safe were not changed.

## Tests

Focused verification:

- Git Bash syntax check for installer and staging script: PASS;
- ShellCheck: **NOT AVAILABLE** and not installed;
- borderless/installer focused tests: 19/19 PASS;
- `npm.cmd run verify:linux:executables`: PASS, 33 tracked files;
- `npm.cmd run verify:linux:installer`: PASS;
- install-safe suite: 61 total, 50 pass, 11 expected
  Windows/POSIX/Linux-staging skips;
- Network deployment verification: PASS.

Final gates:

- `npm.cmd run format:check`: PASS;
- `npm.cmd run typecheck`: PASS;
- `npm.cmd run lint`: PASS;
- `npm.cmd run build`: PASS;
- `npm.cmd test`: 454 total, 446 pass, 8 expected platform skips;
- `npm.cmd run test:posix`: 5 total, 3 pass, 2 expected Windows skips;
- `npm.cmd run verify:network:deployment`: PASS;
- `npm.cmd run verify:linux:executables`: PASS;
- `npm.cmd run verify:linux:installer`: PASS;
- `npm.cmd run mpv:doctor`: PASS with the real MPV executable, headless
  startup, and JSON IPC;
- `npm.cmd run test:mpv`: 8/8 PASS;
- `git diff --check`: PASS.

## Windows real smoke

The unchanged application was run with:

```text
EIDETIC_MPV_PATH=C:\Tools\mpv\mpv.exe
npm.cmd run dev
```

Verified:

- backend listening on 4310;
- Vite listening on 5173;
- Neutralino/WebView2 opened;
- real MPV detected;
- `/health`: `status: ok`;
- `/api/readiness`: `status: ready`, `mpvAvailable: true`;
- a loaded track changed from paused to playing and back to paused through the
  real application control;
- Neutralino exited with success code 0;
- backend received SIGTERM and shut down;
- no project Neutralino, backend, Vite, Node, MPV, or FFmpeg process remained;
- no listener remained on 4310 or 5173;
- no temporary smoke log or screenshot remained.

## Files changed

Production:

- `deploy/linux/install-eidetic-player.sh`

Tests:

- `deploy/linux/test-staging.sh`
- `apps/backend/test/linux-installation.test.ts`
- `apps/backend/test/neutralino-installer.test.ts`

Report:

- `prompts/step2.14_r3_borderless_staging_output.md`

Both shell scripts retain Git mode `100755`.

No change was made to:

- `.github/workflows/ci.yml`;
- `package.json` or `package-lock.json`;
- `deploy/linux/lib/common.sh`;
- `deploy/linux/update-eidetic-player.sh`;
- `deploy/linux/runtime`;
- release or executable-mode verifiers;
- backend, MPV, readiness, Network, frontend, or Step 2.14.1.

## Limits and status

- Linux root staging: **NOT RUN locally**.
- Raspberry Pi: **NOT TESTED**.
- New GitHub Actions run: **NOT RUN**.
- CI PASS: **NOT CLAIMED**.
- No commit or push was performed.

**READY FOR CI VALIDATION**
