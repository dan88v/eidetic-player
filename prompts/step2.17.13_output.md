# Step 2.17.13 output — Remote startup and stable display standby

Date: 2026-08-01

## Status

`READY FOR USER COMMIT — RASPBERRY UPDATE NOT STARTED`

No commit, push, release build installation, or Raspberry update was performed.
Baseline HEAD was `4edd20adbbd83e623f45a0bee604b36aeae22ff6`.

## Reported defects and reproduction

- On the Raspberry, Remote access was saved as On but remained at `Starting...`
  after application startup. Switching it Off and On started the listener.
- A controlled Raspberry standby request reached real Wayland standby, then the
  display returned to Active after approximately 12–13 seconds without user
  input. Display revision advanced from 72 to 76, which represents two complete
  serialized wake transitions.
- Raspberry inspection found Remote access healthy and listening after the
  manual toggle, with the expected persisted enabled preference. No automatic
  Remote code path calls Display wake: only the explicit authenticated
  `Wake display` action does so.

## Root causes

- Backend startup called Remote initialization eagerly and then called the
  persisted-preference startup from the listener callback. The first call set
  an `initialized` boolean before its asynchronous store read completed. The
  second call returned immediately, observed the in-memory default `enabled =
false`, and skipped listener startup. The original read later exposed the
  persisted enabled value as `Starting`, but nothing restarted the listener.
- The local idle controller treated any single trusted, non-zero mouse movement
  as wake activity. Disabling and re-enabling a Wayland output can synthesize an
  isolated pointer relocation; the observed double Display revision is
  consistent with output-off and output-on topology changes producing those
  events. Remote access itself was not the wake source.

## Implementation

- Remote initialization is now single-flight through one shared Promise.
  Concurrent callers all wait for the persisted preference read before deciding
  whether the listener must start. Core backend readiness remains independent
  of Remote listener success.
- Dimmed/standby mouse wake now requires two coalesced samples totaling at least
  eight pixels within 1.2 seconds. A lone compositor-generated relocation is
  ignored. Touch/pointer press, key, wheel, and click-fallback wake behavior is
  unchanged, and ordinary confirmed mouse activity still wakes normally.
- Focused regressions cover the concurrent Remote startup race and the isolated
  synthetic mouse relocation.
- Remote access and Display power development contracts document both startup
  convergence and the wake boundary.

## Validation

- focused backend Remote store and local idle-controller tests: PASS, 24 passed
  / 1 Windows symlink capability skip / 0 failed;
- early TypeScript typecheck: PASS;
- early lint: PASS;
- real `npm.cmd run dev` Neutralino/WebView2 startup at the target 1280x800
  content size: PASS. A BOM-free isolated store was seeded with `enabled=true`;
  without any management or toggle request, backend readiness became Ready,
  Remote state became `listening`, and `0.0.0.0:8080` was listening. The empty
  Now Playing surface remained stable with the established artwork, timeline,
  and transport geometry;
- the first `npm.cmd run format:check` identified the two edited TypeScript
  files and this report; Prettier formatted them before the successful final
  pass;
- `npm.cmd run typecheck`: PASS;
- `npm.cmd run lint`: PASS;
- `npm.cmd run build`: PASS;
- `npm.cmd run build:linux`: PASS;
- full `npm.cmd test`: PASS, 649 passed / 12 platform skips / 0 failed;
- `npm.cmd run test:remote`: PASS, 24 passed / 1 Windows capability skip / 0
  failed;
- `git diff --check`: PASS.

The development process tree was closed after real-app QA. Ports 4310, 5173,
and 8080 were clear, no Neutralino/MPV/FFmpeg runtime remained, and the isolated
temporary profile and screenshot were removed.

The post-fix standby behavior cannot be accepted on the physical Raspberry
until these uncommitted sources are committed, built, and installed. The
Raspberry reproduction, code-path audit, and focused trusted-event regression
cover the defect locally without changing saved display preferences or
playback.

## Files

Created:

- `prompts/step2.17.13_output.md`.

Modified:

- Remote access service and store regression tests;
- display idle controller and idle regression tests;
- Remote access and Display power development contracts.

No dependency or package-lock change was introduced.

## Remaining acceptance

- after the user's manual commit/push and exact-head CI, install that release on
  the Raspberry;
- reboot or restart the application with Remote access already On and verify it
  reaches `Listening` without a toggle;
- let the real Wayland display enter standby and verify it remains off until a
  deliberate local input or explicit Remote `Wake display` action.
