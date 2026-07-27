# Step 2.17.1 output — Guided update, Build ID and verified rollback

## Status

`RASPBERRY GUIDED UPDATE VALIDATION — PASS`

The user committed and pushed `b448c44ec5f4383d51e22dd5461f3643be47d411`
and confirmed its exact CI run green before separately authorizing SSH to the
Raspberry Pi. The guided update and same-commit no-op validation completed
without reboot. No destructive forced-failure rollback was performed.

## Baseline

- Branch: `main`; worktree initially clean.
- Local HEAD and `origin/main`:
  `39af42f89cc5b01b1044cccb5759625c6199b338`; divergence `0 0`.
- The public GitHub check page for that exact baseline commit showed
  `Linux checks` successful. This is baseline evidence only, not evidence for
  the uncommitted Step 2.17.1 changes.
- Windows MPV baseline passed with `C:\Tools\mpv\mpv.exe`.
- The real Neutralino/WebView2 application was inspected before editing at a
  1296 × 839 outer window (1280 × 800 content). Now Playing, drawer,
  Favorites, Settings, Audio, Network, Queue, Power, playback and clean Quit
  were checked. Queue/session, position, volume, mute, shuffle, repeat, audio
  output and browsing state were recorded and restored.
- A pre-existing session-restore seek warning was observed once; playback and
  the persistent MPV process subsequently worked. It was not expanded into
  this step.

## Build and release audit

The existing release transaction remains:

1. isolated non-root source fetch;
2. one unchanged `Application runtime` build/verification phase;
3. release staging under `.incoming-*`;
4. staged release verification;
5. atomic `current`/`previous` symlink activation.

No runtime Git, shell, or network lookup was added to the backend. No
Application Runtime split was introduced. Package installation choices and
production dependencies are unchanged.

## Build provenance

- Added the versioned `build-info.json` schema:
  - `schemaVersion: 1`;
  - exact 40-character lowercase `commitSha`;
  - derived exact seven-character `shortCommitSha`;
  - bounded sanitized `ref`;
  - package version;
  - ISO UTC build timestamp;
  - closed source: `ci`, `git`, or `explicit`;
  - optional boolean `dirty`.
- The dependency-free Node generator validates inputs and writes through a
  temporary file followed by rename. `SOURCE_DATE_EPOCH`, explicit fixture
  inputs, GitHub CI provenance, and local Git provenance are supported.
- `npm run build` generates metadata exactly once after `clean`.
- The installer passes the saved target ref as build provenance and can pin an
  already resolved full commit without changing the configured ref.
- The manifest is copied to the root of every release. Build-output and staged
  release verification reject missing, malformed, mismatched, or unsafe
  provenance before activation.
- Each `current` and `previous` release therefore owns its distinct immutable
  manifest.

## Backend, API and UI

- Added shared typed `BuildInfo`, closed provenance sources,
  `Build <short>-dev` for the normal development launcher, and safe `Build dev`
  / `Build unknown` fallbacks when development or production provenance is
  unavailable.
- Production Linux now explicitly sets `NODE_ENV=production`.
- The backend reads and validates the release manifest once at process start.
  The development launcher injects the validated current seven-character
  commit ID, producing `Build <short>-dev`; direct development starts safely
  fall back to `Build dev`. Invalid/missing production metadata returns
  `Build unknown`.
- Existing `/api/bootstrap` and `/api/readiness` responses carry typed build
  provenance. Readiness remains available after recoverable MPV degradation,
  allowing hard backend Build-ID verification independently from MPV.
- The drawer replaces `MODERN HI-FI` with only
  `Build <shortCommitSha>`. The full SHA is never rendered or embedded in UI
  assets.
- Real post-change Windows Neutralino QA at 1280 × 800 showed the development
  Build ID with the exact `<seven-character-sha>-dev` suffix, stable drawer
  geometry, unchanged navigation and Power controls, and no flash, shift,
  stale artwork, or overlay regression.

## Doctor

The read-only installation doctor now:

- validates the installed manifest;
- reports full sanitized commit, Build ID, ref, package, timestamp, source and
  dirty state;
- compares the installed full commit with the readiness API when reachable;
- reports `match`, `mismatch`, `unavailable`, or staging
  `not-applicable`;
- remains read-only and never starts playback or mutates services.

## Guided updater

- No arguments starts a guided TTY workflow; no-argument non-TTY use exits 64.
- Existing `--ref`, `--dry-run`, `--root`, `--no-restart`, `--rollback`,
  `--full-verify`, `--verbose`, `--no-color`, `--help`, and `--version` remain,
  with explicit `--unattended`.
- Branch/tag resolution is bounded and converted to an exact full SHA. Exact
  40-character SHA input is accepted directly. Remote lookup has an explicit
  15-second timeout and reuses the single official-source constant shared with
  the installer. The installer is pinned to the resolved commit while the
  configured target ref remains saved.
- A current or previous legacy release without a manifest is identified from
  its sanitized release ID when possible and clearly shown as legacy/unknown.
  It is never declared up to date from a short SHA. Rollback to such a release
  verifies service and backend health while explicitly recording that exact
  Build-ID verification is unavailable.
- Current and target seven-character Build IDs, release/ref, preservation
  policy, restart policy and no-reboot policy are shown before a default-Yes
  interactive confirmation.
- Exact full-SHA equality prints `Already up to date.`, exits 0, and performs
  no installer call, build, release creation, activation or restart.
- Update logs use their own protected `update-*` category and retain the newest
  ten independently.
- Existing Standard/Appliance, autostart, fullscreen, borderless, blanking,
  pointer, splash, autologin, on-screen keyboard, GPIO/I²S DAC, backend and
  runtime-user choices are passed explicitly to the unattended installer.
  XDG application data is preserved.
- The updater shows real phases for installed release, target resolution,
  build/stage/activation, service restart, hard health and player readiness.
- After activation it restarts the user service and never reboots.
- Hard verification is bounded to 60 seconds and requires:
  - user service active;
  - backend readiness HTTP 200;
  - readiness full commit equal to the resolved target.
- A hard service or health failure switches `current`/`previous` once,
  restarts, and verifies the former full commit for at most 60 seconds.
  Successful and unverified/manual-recovery rollback outcomes are distinct.
- MPV gets a separate 120-second soft readiness window. Its timeout emits a
  warning and keeps the new release when hard backend/Build-ID checks remain
  healthy.
- `--no-restart` intentionally skips restart, runtime health and automatic
  rollback. Explicit rollback performs no installer/build and is restarted and
  verified unless `--no-restart` is selected.

## Verification performed before final gates

- Focused BuildInfo generator/parser/backend fallback tests: PASS.
- Readiness response regression tests: PASS.
- Drawer/Power regression tests: PASS.
- Doctor parser/read-only regression tests: PASS.
- `npm run verify:linux:installer`: PASS.
- Direct `bash deploy/linux/test-staging.sh`: PASS, including repeated
  install/update/rollback/restore/uninstall, preserved installer choices,
  staged doctor, and same-commit no-op with unchanged release count.
- Shell syntax (`bash -n`) for modified installer, updater and doctor: PASS.
- Git executable modes for modified deployment scripts: preserved as `100755`.
- ShellCheck was not installed locally; CI remains authoritative for it.
- Production fixture smoke:
  - full SHA `1234567890abcdef1234567890abcdef12345678`;
  - API Build ID `1234567` from readiness and bootstrap;
  - no full fixture SHA in `dist/ui`;
  - backend/MPV/listener cleanup completed.
- Real Windows smoke:
  - exact `npm.cmd run dev`;
  - MPV and FFmpeg available;
  - Now Playing and drawer visually inspected at 1280 × 800;
  - `Build 39af42f-dev` exact;
  - Power → Quit exercised through the real UI;
  - Neutralino, Node, Vite, MPV and ports 4310/5173 clean afterward.

## Final local gates

The required one-shot final gate sequence is run after saving this report:

- `npm.cmd run format:check`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run build:linux`
- `npm.cmd test`
- `npm.cmd run test:posix`
- `npm.cmd run verify:network:deployment`
- `npm.cmd run verify:linux:executables`
- `npm.cmd run verify:linux:installer`
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`
- `npm.cmd run mpv:doctor`
- `npm.cmd run test:mpv`
- `git diff --check`

Final result: **PASS**. The full successful restart of the sequence completed
all listed gates. After the development Build ID follow-up, `npm test` passed
517 tests (507 pass, 10 platform skips);
`test:posix` passed its three executable tests with two Windows platform skips;
the Linux release verifier accepted the manifest and x64 artifact; MPV doctor
passed; and all eight real MPV integration tests passed.

The follow-up also passed focused BuildInfo/drawer tests, format checking,
typecheck, lint and a production build. A second real Neutralino smoke verified
`Build 39af42f-dev` in the drawer and clean Power → Quit shutdown.

The subsequent Linux CI staging run reached its intentional unsupported-Debian
fixture, then failed only because ShellCheck promotes warnings to a non-zero
exit. The four reported findings were corrected without changing deployment
behavior:

- doctor fallback literals are explicitly quoted as `"unset"`;
- the updater's unused `update_committed` assignments were removed;
- the shared official-source constant has a narrowly scoped `SC2034`
  annotation because it is consumed only by scripts sourcing `common.sh`;
- the Linux installer contract test now protects all three corrections.

Post-fix format checking, typecheck, lint, the focused 16-test Linux deployment
suite and the complete `verify:linux:installer` profile passed. ShellCheck is
not installed in the Windows/WSL environment, so the exact ShellCheck rerun
remains for CI; the corrected lines correspond directly to all four reported
diagnostics.

The first final attempt stopped at lint before build because ESLint tried to
apply a typed rule to an added `.d.mts` shim. The shim was removed, the sole
JavaScript CLI test import was explicitly documented for TypeScript, and the
complete gate sequence was restarted from format checking.
That restart stopped at typecheck because the suppression preceded a multiline
import rather than its reported module-specifier line. The annotation was
moved to the exact diagnostic line before restarting the sequence again.
Focused lint then correctly rejected the unresolved JavaScript import as
unsafe. The test was changed to exercise the dependency-free generator through
its real Node CLI and validate the resulting JSON through the typed backend
parser, eliminating the declaration shim and unsafe import entirely.

## Scope and files

Changed scope is limited to:

- build metadata generator and tests;
- shared BuildInfo/readiness contracts;
- backend build reader, bootstrap and readiness;
- drawer wiring, scoped footer style and regression test;
- Linux installer metadata pinning/packaging;
- updater, doctor, common build environment and staging fixture;
- release verifier and deployment contract tests;
- Linux deployment/testing documentation;
- this report.

`package-lock.json`, GitHub workflows, uninstall, GPIO/I²S helper, power helper,
Network, Audio Output, Library and unrelated app modules are unchanged.
No dependency or APT package was added, and the package plan is unchanged.

## Post-CI Raspberry phase

Completed against `daniele@10.0.0.112` after the user confirmed the exact CI
run green:

- installed provenance before update: legacy/unknown;
- target commit: `b448c44ec5f4383d51e22dd5461f3643be47d411`;
- target and installed Build ID: `b448c44`;
- activated release: `releases/20260727T090427Z-b448c44`;
- update log:
  `/var/log/eidetic-player/update-20260727-085455-225541-0.log`;
- user service: `active`;
- readiness: `ready`, player paused, MPV available;
- readiness full commit: exact target match;
- installation doctor: PASS, including manifest, BuildInfo and API coherence;
- Raspberry Pi 3 Model B and Raspberry Pi OS Trixie detection: PASS;
- HDMI and GPIO/I2S DAC detection: PASS;
- no reboot requested or performed;
- immediate updater rerun: `Already up to date.`;
- final reusable-controller rerun: unchanged `b448c44`, doctor PASS and
  `Already up to date.` again.

The installed manifest records `source/dirty` as `git/true`. The exact commit,
Build ID and API coherence all match and the remote source checkout passed the
clean-worktree guard; the flag is retained here as observed provenance rather
than hidden.

Added reusable `scripts/remote-rpi-update.ps1` and documented it in
`docs/development/raspberry-remote-operations.md`. It keeps SSH, sudo and guided
prompts visible, validates the exact checkout/origin/branch, permits only a
fast-forward sync, compares Build IDs, runs the doctor and proves the no-op.
The first controller attempts exposed Windows `ssh.exe` quote rewriting: an
empty Bash test became a false dirty-check result, then the manifest `sed`
expression and comparison were altered. The final controller transports the
UTF-8 remote script as Base64 into a private temporary file, preserving it
byte-for-byte while leaving stdin attached to the interactive terminal. The
corrected controller completed successfully.

A real forced hard-failure rollback remains **NOT TESTED** because it was not
separately authorized.
