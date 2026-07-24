# Step 2.13.2-R2 — Unprivileged Linux build

## Result

Implemented. The real Raspberry Pi failure was caused by the installer running
the repository test suite as UID 0. Root can read a mode-000 directory, so the
unchanged POSIX permission assertion correctly failed.

The installer still requires root for APT and managed system paths, but the
source fetch/archive and every npm lifecycle now run through argument-safe
`runuser` as the existing non-root runtime user. The root-to-runtime fixture
used `daniele` UID 1000; the previous lifecycle UID was 0.

## Execution model

- The runtime account is resolved through the passwd database and UID 0 is
  rejected.
- The build workspace is created outside the release, mode 0700, owned by the
  runtime UID and its primary GID, and removed by the installer trap.
- `env -i --chdir` supplies explicit working directory, runtime `HOME`, `USER`,
  `LOGNAME`, managed-Node `PATH`, `C.UTF-8`, workspace `TMPDIR`, and a
  workspace-local npm cache. sudo variables and unrelated inherited variables
  are absent; npm user configuration is disabled for the build.
- Git arguments, refs, usernames and paths are passed as argv. There is no
  `su -c`, `eval`, internal sudo or constructed command string.
- Root extracts the archived source, restores runtime ownership, validates the
  completed artifacts and copies them into a private incoming release.

## Transaction and update

`npm ci`, typecheck, the unchanged complete test suite, `build:linux`, and
artifact verification all finish before an incoming release is created.
Administrative installation finishes before the validated incoming release is
moved to its final immutable name and `current`/`previous` are switched.

On lifecycle failure the phase is named, the workspace is removed, no
incomplete release remains, and `current` and `previous` are unchanged. A
subsequent successful attempt works and existing managed Node/package state is
reused. Release IDs handle same-second retries without overwriting a valid
release.

The update command continues to delegate to the installer, so it uses the same
non-root lifecycle and transactional activation. Rollback and XDG data
handling are unchanged.

## Permission and safety fixtures

The root-to-runtime Linux fixture verifies:

- administrative UID 0 and lifecycle UID 1000/non-zero;
- correct `HOME`, `USER`, `LOGNAME`, PWD, UTF-8 environment and workspace npm
  cache ownership;
- private workspace UID/GID/mode;
- a real mode-000 directory is denied to the lifecycle user;
- the resulting artifact is readable by root;
- failed lifecycle leaves both release links unchanged, creates no incoming or
  incomplete release, and cleans its workspace;
- retry after failure succeeds and activates atomically;
- spaces, Unicode and an injection-shaped argument remain literal.

The application POSIX test was not changed or weakened. During a real install,
the full `npm test` containing that assertion now runs as the runtime user.
Windows `npm.cmd test` skips POSIX-only cases by design; the Linux fixture
exercised the permission denial as a real non-root user.

## Verification

- Baseline: `main`, clean, `HEAD == origin/main`, `326cbe3`.
- `bash -n` on all modified Linux scripts: PASS.
- ShellCheck: unavailable in the configured Ubuntu WSL environment.
- Root → `daniele` unprivileged fixture: PASS.
- Raspberry Pi OS and Ubuntu staging, repeated install, real staging update,
  rollback, doctor, restore and uninstall: PASS.
- Staging lifecycle failure, cleanup and successful retry: PASS.
- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd test`: PASS, 424 passed and 3 platform skips.
- `npm.cmd run dev`: PASS; Vite, backend and Neutralino started, Neutralino
  closed with success code 0, backend received SIGTERM, and no test-started
  Node, Neutralino, MPV, FFmpeg or listening development port remained.
- `git diff --check`: PASS.
- Real Raspberry Pi 3 installation: **NOT TESTED**.

## Files changed

- `deploy/linux/install-eidetic-player.sh`
- `deploy/linux/lib/common.sh`
- `deploy/linux/test-unprivileged-build.sh`
- `deploy/linux/test-staging.sh`
- `deploy/linux/README.md`
- `apps/backend/test/linux-installation.test.ts`
- `prompts/step2.13.2_r2_unprivileged_build_output.md`

No commit or push was performed.
