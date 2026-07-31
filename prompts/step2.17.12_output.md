# Step 2.17.12 output — Remote Player UI polish and display wake

Date: 2026-08-01

## Status

`READY FOR LOCAL VALIDATION — PHONE/RASPBERRY UPDATE NOT STARTED`

No commit, push, Raspberry update, playback command, or persistent Raspberry
mutation was performed. Baseline HEAD was
`34c0d50f7fb71a075f4f820b1b3934f1997ee45f`.

## Requested outcome and root causes

- Remote timeline drag failed because every player-position SSE tick rebuilt
  the complete Player page and removed the range input during its gesture.
- Remote Wake changed backend Display state, but the software-dim overlay is
  owned by the appliance UI. That UI received no external Display update and
  therefore remained visibly dimmed even after the backend became Active.
- The Remote Player always mounted the mini-player and used normal document
  flow, leaving artwork, metadata, timeline, and transport taller than compact
  phone viewports.
- The Remote viewport permitted device zoom and Album/Artist `trackCount`
  values were rendered as unexplained bare numbers.

## Implementation

- Position-only player events now update only the Remote range and time labels.
  The mounted range owns Pointer Capture, previews locally during `input`, and
  commits one seek on release; a track change cancels an obsolete gesture.
- Player metadata, mode, transport, or artwork changes still reconcile the
  complete Player surface. Mini-player content on other destinations is no
  longer rebuilt for position-only ticks.
- The mini-player is hidden only on Player. Player content has a viewport-bound
  three-row grid: adaptable square artwork, stable metadata, then a bottom
  controls block containing timeline, transport, and optional variable-volume
  controls directly above bottom navigation. Compact-height rules preserve
  touch targets and remove vertical Player scrolling.
- The mobile viewport explicitly sets `maximum-scale=1.0` and
  `user-scalable=no`; the shell also suppresses double-tap zoom while the
  dedicated range retains gesture ownership.
- Album and Artist aggregate counts are formatted as `1 track` or `N tracks`.
- `DisplayPowerService` now publishes Display revisions. The existing local
  player SSE carries them as a named `display` event; no new connection,
  polling, timer, or Remote stream was added. `DisplayIdleController` accepts a
  newer external Active snapshot, removes its software overlay/wake shield,
  starts a fresh activity epoch, and does not issue a duplicate wake.

## Artwork investigation

Read-only Raspberry checks found no artwork API bottleneck for the current
track: the local endpoint returned HTTP 200 with a 57,556-byte, 600x600 JPEG in
5.4 ms total (5.1 ms to first byte). Backend readiness was Ready, MPV was
available, and the service was healthy. The runtime journal instead reports
that WebKitGTK disabled hardware acceleration because GTK could not initialize
an OpenGL context. The observed phone-versus-appliance difference is therefore
consistent with slower software decode/composition on the Raspberry, not a
remote/API delay. No speculative playback, metadata, or artwork-cache change
was made. Removing position-only Remote image reconstruction reduces unrelated
client churn; physical comparison with a newly selected album remains required
after deployment.

## Validation

- focused Remote UI, backend Display, and local idle-controller tests: PASS,
  34/34;
- Remote production build: PASS; approximately 0.52 kB HTML, 11.69 kB CSS,
  and 24.42 kB JavaScript before gzip;
- TypeScript typecheck: PASS after correcting the intentionally partial test
  fixture cast;
- first lint attempt found one unnecessary optional chain in the new Pointer
  Capture call; it was corrected before final validation;
- `npm.cmd run format:check`: PASS;
- `npm.cmd run lint`: PASS;
- `npm.cmd run build`: PASS;
- `npm.cmd run build:linux`: PASS;
- full `npm.cmd test`: PASS, 647 passed / 12 platform skips / 0 failed;
- `npm.cmd run test:remote`: PASS, 23 passed / 1 Windows capability skip /
  0 failed;
- `git diff --check`: PASS.

Real `npm.cmd run dev` Neutralino/WebView2 QA at 1280x800 exercised the complete
local wake path. An external fixture Dim produced a visibly dimmed Now Playing
surface at Display revision 4. External Wake advanced to revision 6 and the
same mounted window immediately returned fully Active without local input or a
second wake. Preferences were not changed. The application process tree was
closed and ports 4310, 5173, and 8080 plus Neutralino/MPV/FFmpeg processes were
clear.

The in-app Browser runtime exposed no browser instance, so interactive mobile
screenshots, physical pinch, and real-phone drag cannot be marked PASS. Source,
pure behavior tests, production build, and CSS contracts cover those changes,
but final phone acceptance remains explicit.

## Files

Created:

- `apps/remote-ui/src/player-presentation.ts`;
- `prompts/step2.17.12_output.md`.

Modified:

- Remote UI HTML, Player implementation, scoped styles, and isolation tests;
- backend Display service, local SSE hub/composition, and Display tests;
- local player SSE client, AppShell, idle controller, and idle tests;
- Remote access and Display power development contracts.

No dependency or package-lock change was introduced.

## Remaining acceptance

- verify Player at 320x568, 360x640, 390x844, 412x915, 430x932, and 768x1024
  in a real phone browser, including drag release, no scroll, fixed bottom
  controls, hidden Player mini-player, visible mini-player elsewhere, and
  disabled pinch/double-tap zoom;
- deploy only after the user's manual commit/push and exact-head CI;
- on the Raspberry, compare a newly selected album's Remote and appliance
  artwork reveal and validate Remote Wake from real software Dim.
