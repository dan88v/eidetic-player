# Step 2.17.10 — In-App Update Smoke-Test Commit

Date: 2026-07-30

Status: READY TO PUBLISH — IN-APP RASPBERRY EXECUTION PENDING

## Requested outcome

Create a new, low-risk commit that can be published to `main` and used as the
next target for an in-app update test.

## Change

`docs/development/software-update.md` now documents the release smoke-test
procedure. A reviewed documentation-only commit is enough because the updater
pins the exact target SHA and the release embeds that SHA as its Build ID. No
package-version bump, tag, runtime behavior change, dependency change, or UI
change is required.

The procedure records the expected checks before, during, and after the update:
green CI for the exact target, distinct current and target Build IDs, structured
progress, exact installed Build ID after reconnection, core application
function, same-commit no-op behavior, no rollback or reboot, and clean process
shutdown.

## Files

- Modified `docs/development/software-update.md`.
- Added `prompts/step2.17.10_output.md`.

## Validation

- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd test`: PASS — 599 passed, 11 platform-specific skips, 0 failed.
- `npm.cmd run verify:linux:executables`: PASS — all 46 tracked deployment
  files retain valid Git modes.

No MPV, FFmpeg, Neutralino, media, Raspberry, or 1280 × 800 visual test is
required for this documentation-only change. The real in-app Raspberry update
is deliberately pending until the commit is published and its exact GitHub
Actions run is green.

## Runtime and dependency impact

None. No production source, configuration, executable, package manifest, lock
file, dependency, bundle, service, or generated artifact changed.

## Cleanup and limitations

The working tree contained no unrelated changes before this step. No runtime
process was started. The commit only creates the target; it does not itself
execute the in-app update.
