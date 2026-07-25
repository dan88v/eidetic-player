# Step 2.14 — COMPLETE

## Result

Step 2.14 is complete. The Linux installer stability contract, Git
executable-mode guard, installer-safe verification profile, release verifier,
`--full-verify` handling, CI gates, mutation tests, and documentation are
implemented. All requested static, focused, full, MPV, and real Windows smoke
checks pass.

The earlier block was not caused by an absent MPV installation. The configured
executable remained:

```text
C:\Tools\mpv\mpv.exe
```

Its real first version line is:

```text
mpv v0.41.0-744-g304426c39 Copyright © 2000-2026 mpv/MPlayer/mplayer2 projects
```

The MPV discovery validator introduced in R4F-R1 accepted only a numeric
version followed immediately by whitespace or end-of-line, so it rejected the
valid `-744-g304426c39` build suffix and reported `invalid-version`. Step 2.14
exposed that existing parser regression; it did not create it.

R1 makes the smallest compatible correction: the version-line validator now
accepts an optional `-` or `+` build suffix while preserving the anchored
`mpv` token and numeric version requirements. Focused tests cover the exact
real banner, additional suffix forms, ordinary release banners, and malformed
or unrelated output. Candidate ordering and all installer, CI, package, and
runtime-path behavior are unchanged.

No Windows configuration or MPV path was modified. `EIDETIC_MPV_PATH` was set
only in the PowerShell processes used for verification.

## Baseline

- Branch: `main`.
- Step 2.14 continued from its current dirty working tree.
- The existing Step 2.14 changes were preserved.
- No merge or rebase was in progress.
- No commit, push, merge, rebase, reset, restore, stash, or clean was
  performed.

## Installer and verification contract

The default install path now runs:

```text
npm ci
npm run typecheck
npm run verify:linux:installer
npm run build:linux
build artifact verification
production packaging
staged release verification
atomic activation
```

Full `npm test` is not part of the default device path. `--full-verify` adds
`format:check`, `lint`, full `npm test`, `test:posix`, and
`test:case-sensitive` before build. `--dry-run` identifies the selected
verification profile and runs neither tests nor build. `--unattended` retains
the install-safe default.

No fetch, runtime-user, short-XDG-runtime, Neutralino binary selection,
backend entrypoint, readiness endpoint, MPV path, Standard/Appliance choice,
rollback, restore, or uninstall semantics were changed.

The executable-mode verifier reads the Git index, works on Windows without
depending on NTFS modes or `core.fileMode`, classifies executable and data
files, detects missing modes, wrong modes, symlinks, missing shebangs, and
POSIX world-write where available, and never mutates the worktree or index.

The install-safe profile uses an explicit test allowlist for Linux
installation, Neutralino installer, Linux platform, readiness, MPV discovery,
Network deployment, Linux verification, and the Linux-only staging suite.
The mandatory full CI suite remains authoritative for product regressions.

Update delegates `--full-verify` to the installer without persisting it.
Rollback performs no test or build. Build and staged verification finish
before activation, preserving the existing atomic activation and cleanup
behavior.

The release verifier covers compiled backend entrypoints, exact Neutralino
binary and ELF architecture, configuration, `.neu` and UI assets, production
package contents, launcher modes, ownership where available, broken links,
checkout leakage, and premature incoming-release activation.

## MPV regression correction

Reproduction before the fix:

- `C:\Tools\mpv\mpv.exe --version` returned the real banner shown above.
- With `EIDETIC_MPV_PATH` pointing to that executable, `mpv:doctor` executed
  the configured candidate but classified it as `invalid-version`.
- The fallback PATH candidate was then reported as `not-found`.

Correction:

- `apps/backend/src/player/mpv-discovery.ts` accepts an optional build suffix
  after the numeric version.
- `apps/backend/test/mpv-discovery.test.ts` covers the exact installed banner,
  hyphen and plus suffixes, standard banners, and existing invalid cases.
- Candidate discovery order was not changed.

Focused discovery tests pass: 10 total, 5 pass, 5 expected Windows skips, 0
fail.

Real MPV verification passes:

- `npm.cmd run mpv:doctor`: configured executable found; real banner accepted;
  headless startup and JSON IPC pass.
- `npm.cmd run test:mpv`: 8/8 pass against the real executable.

## Real Windows application smoke

The real `npm.cmd run dev` path was run with
`EIDETIC_MPV_PATH=C:\Tools\mpv\mpv.exe`:

- backend started on port 4310;
- Vite started on port 5173;
- Neutralino/WebView2 opened;
- `/health` returned `status: ok`;
- `/api/readiness` returned `status: ready`, `playerStatus: idle`, and
  `mpvAvailable: true`;
- a Library album and its first track were opened;
- a real MPV process was observed;
- play, pause, resume, next, and previous were exercised in the application;
- metadata changed correctly on next and previous.

Neutralino closed successfully. Final cleanup confirmed no project
Neutralino, backend, Vite, Node, or MPV process, no listener on ports 4310 or
5173, and no retained smoke logs or temporary QA images.

## Final verification

All requested gates pass:

- `npm.cmd run format:check`;
- `npm.cmd run typecheck`;
- `npm.cmd run lint`;
- `npm.cmd run build`;
- `npm.cmd test`: 454 total, 446 pass, 8 expected platform skips;
- `npm.cmd run test:posix`: 5 total, 3 pass, 2 expected Windows skips;
- `npm.cmd run verify:network:deployment`;
- `npm.cmd run verify:linux:executables`: 33 tracked deployment files valid;
- `npm.cmd run verify:linux:installer`: 61 total, 50 pass, 11 expected
  Windows/POSIX/Linux staging skips;
- `npm.cmd run mpv:doctor`;
- `npm.cmd run test:mpv`: 8/8 pass;
- `git diff --check`.

The existing working-copy warning for `deploy/linux/test-staging.sh` concerns
Git's future CRLF-to-LF conversion and is not a diff error.

## Staging

**STAGING PARTIAL.**

Completed locally:

- cross-platform contract and mutation fixtures;
- ARM64 and x64 build fixtures;
- staged-release fixture;
- real Windows-generated Linux x64 artifact and ELF verification;
- static, default, full, dry-run, update, and rollback contract checks;
- real Windows Neutralino → backend → MPV smoke.

The Linux staging script covers Standard, Appliance, `--full-verify` dry-run,
update `--full-verify`, repeated install, rollback, restore, and uninstall for
its Raspberry Pi OS/Ubuntu arm64/amd64 matrix. It was not executed locally
because the step excludes use of the real Windows/WSL installation. Linux CI
is configured to execute it.

No real Standard/Appliance host, root transaction, systemd/polkit, Raspberry
Pi, or Ubuntu hardware staging pass is claimed.

## Files changed

Step 2.14 files already present in the working tree:

- `.github/workflows/ci.yml`
- `AGENTS.md`
- `apps/backend/test/linux-installation.test.ts`
- `deploy/linux/README.md`
- `deploy/linux/install-eidetic-player.sh`
- `deploy/linux/test-staging.sh`
- `deploy/linux/update-eidetic-player.sh`
- `docs/development/linux-debian.md`
- `docs/development/testing.md`
- `package.json`
- `scripts/linux-verification.test.ts`
- `scripts/run-linux-install-safe-tests.mjs`
- `scripts/verify-linux-executable-modes.mjs`
- `scripts/verify-linux-installer-contract.ts`
- `scripts/verify-linux-release.ts`

R1 changed only:

- `apps/backend/src/player/mpv-discovery.ts`
- `apps/backend/test/mpv-discovery.test.ts`
- `prompts/step2.14_output.md`

## Limits and handoff

- Raspberry Pi real hardware: **NOT TESTED**.
- Linux root staging: **NOT TESTED locally**.
- Windows Neutralino/WebView2 smoke with real MPV: **PASS**.
- No UI code or visual layout was changed; no new visual regression surface
  was introduced.
- The working tree remains uncommitted for user review.
