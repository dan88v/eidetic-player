# Step 2.17.11 output — LAN Remote Web UI and Pairing

## Status

`READY FOR CI VALIDATION — REMOTE WEB UI NOT DEPLOYED`

No commit, push, Raspberry Pi update, or external-system mutation was
performed. Raspberry and real-phone acceptance remain post-CI work.

## Baseline

- Branch: `main`.
- Baseline local HEAD and `origin/main`:
  `1d3260c5cb715f619862e0c74be071320fefda1e`.
- Exact-head CI: success,
  `https://github.com/dan88v/eidetic-player/actions/runs/30576334013`.
- Baseline worktree: clean.
- Windows real Neutralino baseline used `npm.cmd run dev`, MPV
  `v0.41.0-744-g304426c39`, local backend `127.0.0.1:4310`, and no listener on
  port 8080.
- Local UI baseline covered Now Playing, navigation drawer, Settings, Network,
  and System at the target 1280 × 800 window.
- The local application retained its single existing player-state
  `EventSource`; enabling the separate remote fixture did not add a local UI
  stream.
- `mpv:doctor` and `ffmpeg:doctor` passed before implementation.

## Architecture and isolation

Remote access is a bounded optional module:

- `RemoteAccessService` owns availability, persisted preference, pairing,
  devices, and listener lifecycle.
- `RemoteGateway` owns the separate HTTP boundary and explicit remote route
  table.
- `apps/remote-ui` is a separate vanilla TypeScript/Vite application. It does
  not import `apps/ui`, use `PlatformBridge`, local storage, a service worker,
  the on-screen keyboard, or visualizer code.
- The existing local backend remains loopback-only on port 4310.
- The remote listener is fixed at `0.0.0.0:8080`, starts only on an appliance
  with Remote access enabled, and can be exercised on loopback only with
  `EIDETIC_REMOTE_ACCESS_FIXTURE=1`.
- Remote initialization and listener failure are outside the backend readiness
  barrier. Default-Off startup creates no remote listener, client stream,
  polling loop, analyzer, or FFmpeg process.
- Player commands reuse validation and the existing command coordinator.
  Library and folder operations call narrow existing service adapters; no
  second player session or media index exists.
- Local AppShell changes are limited to API plumbing and routing a named Remote
  access event over its existing player SSE. Local UI changes are confined to
  the Settings root, its Remote access page, and `.remote-access-*` selectors.

The architecture contract is documented in
`docs/development/remote-access.md`.

## Security and persistence

- The independent `remote-access.json` store defaults Off.
- Writes use temporary-file creation, sync, atomic rename, and directory sync.
  Linux applies `0700` to the state directory and `0600` to the file.
- Symlinks, unexpected ownership, malformed current-schema records, and future
  schemas fail closed; a future schema enters read-only degraded mode.
- Current-schema unknown fields are retained where safe.
- Pairing codes contain exactly six digits, expire after five minutes, are
  one-time, are never persisted, and permit at most five attempts per code with
  per-address accounting.
- At most eight devices can be paired.
- Pairing creates a high-entropy device token. Only its cryptographic hash is
  persisted.
- The browser receives an `HttpOnly`, `SameSite=Strict`, 90-day session cookie.
  Mutations additionally require the in-memory CSRF value from authenticated
  bootstrap.
- Pairing and authenticated traffic are rate-limited. Bodies are bounded.
- Private and link-local IPv4 clients are accepted; public, unspecified, IPv6,
  and ordinary loopback addresses are rejected outside the explicit fixture.
- Host and Origin validation is strict, CORS is absent, and the remote response
  includes restrictive CSP, framing, content-type, referrer, and permissions
  headers.
- Revoking one or all devices invalidates authentication and closes affected
  SSE streams. Disabling Remote access closes all remote streams while paired
  sessions remain valid for a later re-enable; a backend restart renews the
  in-memory CSRF value through authenticated bootstrap.
- Remote player and queue payloads explicitly omit native/logical paths,
  internal player-session and command metadata, client-session IDs, raw audio
  routes, and diagnostic device identifiers.
- No pairing code, token, cookie, CSRF value, SMB credential, source path, or
  private media path appears in this report or application logs.

## Local Settings

The canonical Settings root now exposes a single Remote access navigation row
and dedicated page. The page:

- reports `Unavailable` directly in the root row when the current build
  cannot start the LAN listener;
- replaces the On/Off and pairing controls with an explicit Off/no-listener
  explanation in unavailable Windows development mode, including the opt-in
  fixture command;
- shows Unavailable, Off, Starting, On, and Error states;
- enables, disables, and retries the listener;
- displays the current private LAN URL only while available;
- creates and cancels a pairing code with a countdown active only while the
  panel is visible;
- places Pair new device and Refresh in equal-width canonical actions;
- lists paired device names and safe timestamps in a separate card, with a
  visible Revoke button per device;
- exposes a full-width destructive Revoke all action below the card;
- consumes the code, updates the device card, and shows a completion toast
  automatically when pairing finishes over the existing local player SSE;
- revokes one device or all devices through confirmation dialogs.

The implementation reuses Settings headers, panels, rows, status indicators,
buttons, dialogs, and live regions. It does not make the local AppShell
responsive or alter Player, Queue, mini-player, Home, System, Display, Audio,
Update, or visualizer behavior.

## Remote UI and API

The portrait-first remote shell has four destinations—Player, Queue, Library,
and Browse—plus a stable mini-player and safe-area-aware bottom navigation.
Touch targets are at least 44 px and layouts cover 320 × 568, 360 × 640,
390 × 844, 412 × 915, 430 × 932, and 768 × 1024 in CSS.

The mobile header uses the complete Eidetic Player name, vertically centers
connection state and the bordered Wake display button, and the Player transport
places circular icon controls for Shuffle, Previous, Play/Pause, Next, and
Repeat in one row. Fixed output omits the volume surface entirely. Queue touch
reorder lifts the dragged row, follows the pointer, and marks the current drop
target before the optimistic move.

Unauthenticated access is limited to the static pairing shell, pairing status,
and pairing submission. The authenticated allowlist contains:

- bootstrap, logout, and one multiplexed SSE stream;
- play, pause, play/pause, previous, next, seek, volume, mute, shuffle, repeat;
- queue play, reorder, remove, and clear;
- read-only fixed/software output-level state;
- Library albums, artists, tracks, search, favorites, recently played, most
  played, playlists, and explicit play/queue actions;
- configured sources and bounded folder/SMB browse/play/queue actions;
- authenticated player and queue artwork;
- display wake only.

There is no generic proxy and no remote route for local management, updater,
network administration, display preferences/tests, SMB credentials, native
dialogs, visualizer, analysis, or FFmpeg.

Authenticated bootstrap returns build identity, player/queue state,
audio-output constraints, safe source metadata, library summary, wake
capability, and CSRF state. Player, audio-output, library invalidation, and
session events share one SSE connection per visible device. Hiding the page
closes the stream; showing it refreshes bootstrap before reconnecting. Stale
HTTP responses are aborted or ignored and commands remain ordered by the
existing backend coordinator.

## Build, release, and package plan

- `build:remote` emits a separate `dist/remote-ui`.
- The normal build orchestrator builds the remote bundle without adding a
  dependency.
- Linux release verification requires the remote HTML and asset directory.
- The installer copies `dist/remote-ui` into the versioned application release.
- Update keeps its existing atomic version-directory transaction; uninstall
  keeps its existing application-directory cleanup. No port-80 proxy, firewall
  rule, root runtime, new systemd unit, or updater logic was added.
- `package-lock.json` and the dependency graph are unchanged.
- Deployment package plan: local UI, remote UI, backend, Neutralino resources,
  and existing runtime helpers remain in one versioned release; the remote
  listener serves only the bundled `remote-ui` directory.

## Automated and Windows QA

Focused Remote tests cover default Off, atomic persistence and Linux modes,
future schema handling, validation, pairing lifetime/attempt/device limits,
token hashing, private IPv4 enforcement, security headers, Host/Origin checks,
route isolation, fixed-port conflict, cookie authentication, CSRF, revoke,
disable/re-enable, and the one-SSE budget. The Windows symlink/owner test is
explicitly skipped because an ordinary Windows test account cannot create the
required symlink fixture; POSIX verification remains required in CI.

The standalone-UI contract tests prove four destinations, safe-area layout, no
local UI import, no PWA, no credential storage, no visualizer, and no custom
keyboard. The LAN bootstrap also avoids secure-context-only browser APIs and
renders a visible connecting surface before the first request, preventing a
plain-HTTP phone from remaining on an uninformative black background.

Real Neutralino QA at 1280 × 800 verified the Settings-root entry, unified
status/address card, equal Pair/Refresh actions, separate Paired devices card,
individual button styling, full-width destructive Revoke all action, and an
end-to-end LAN pairing. The final pairing update removed the code, inserted the
new device, and displayed the success toast without Refresh; five QA-only
devices were then revoked while the pre-existing iPhone and enabled preference
were preserved. The listener returned to Listening after validation and was
then closed with the development app during final cleanup.

Windows HTTP fixture QA exercised the actual fixed port and built static
assets: default Off, enable/listen, pairing, `HttpOnly`/`SameSite=Strict`
cookie, authenticated bootstrap, sanitized player/audio state, player command,
all Library collections and search, sources, browse, wake without player-state
corruption, disable with listener closure, re-enable with the persisted
session, revoke with subsequent 401, and final Off with zero devices. Pairing
was 128 ms, bootstrap 39 ms, a player command 18 ms, and a batch of eight
Library reads 102 ms on the local fixture. Browser-session tokens, pairing
codes, CSRF values, and cookies were kept only in process memory and were not
printed.

The in-app Browser connector reported no available browser instance, so
interactive remote mobile rendering and screenshots could not be truthfully
marked PASS. The real Neutralino local fixture was inspected at 1280 × 800:
Now Playing, drawer, Settings root, Network, Remote access Off, and Remote
access Listening all retained their canonical geometry, fixed chrome,
mini-player, scrolling, and dark surfaces. The real toggle opened port 8080 and
the reverse toggle closed it.
The ordinary Windows development mode was also inspected without the Remote
fixture: the Network row visibly reports `Unavailable in this build`, and its
dedicated page replaces On/Off and pairing controls with an explicit Off,
no-LAN-listener explanation. A single read retry prevents a transient Wi-Fi
scan delay from leaving the navigation row in an ambiguous state.
During live source edits, its development-only one-shot bootstrap overlapped a
backend watcher restart and left the already-open page showing “Starting
MPV…”. Logs confirmed MPV was available on every restart. The installed
production bootstrap already retries transient failures indefinitely and has a
focused regression test. The QA fixture and its MPV/backend processes were
then closed; ports 4310 and 8080 were free.

## Performance and non-regression

- One remote SSE per visible device; no polling and no remote visualizer.
- Remote subscriptions exist only while the listener and clients exist.
- Last-seen persistence is coalesced.
- Static assets are bounded and cacheable; API responses are no-store.
- No changes exist under backend player, audio-output, audio-processing,
  display, update, analysis, FFmpeg, visualizer, mini-player, Now Playing,
  reliable touch scroll, update runner, GitHub workflows, or package lock.
- Remote UI build output is approximately 0.49 kB HTML, 10.69 kB CSS, and
  22.48 kB JavaScript before gzip (0.30, 3.09, and 7.62 kB gzip).

## Validation

Completed final checks:

- `npm.cmd run format:check` — PASS.
- `npm.cmd run typecheck` — PASS.
- `npm.cmd run lint` — PASS.
- `npm.cmd run build` — PASS.
- `npm.cmd run build:linux` — PASS.
- `npm.cmd test` — PASS (643 pass, 12 platform skips).
- `npm.cmd run test:posix` — PASS (3 pass, 2 Windows platform skips).
- `npm.cmd run verify:network:deployment` — PASS.
- `npm.cmd run verify:linux:executables` — PASS.
- `npm.cmd run verify:linux:installer` — PASS.
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build` —
  PASS, including separate Remote UI HTML/CSS/JavaScript assets.
- `npm.cmd run mpv:doctor` — PASS.
- `npm.cmd run test:mpv` — PASS (10 pass).
- `npm.cmd run ffmpeg:doctor` — PASS.
- `npm.cmd run test:ffmpeg` — PASS (3 pass).
- `npm.cmd run test:remote` — PASS (19 pass, 1 Windows capability skip).
- `npm.cmd run build:remote` — PASS.
- `npx.cmd tsx --test scripts/linux-verification.test.ts` — PASS
  (17 pass, 3 platform skips).
- `bash -n deploy/linux/install-eidetic-player.sh` — PASS.
- ShellCheck — NOT AVAILABLE in the Windows QA environment; POSIX syntax,
  executable-mode, installer, and staged-release verification passed.
- `git diff --check` — PASS.

Shutdown verification found no Eidetic Node, Neutralino fixture, MPV, or FFmpeg
processes and no listeners on ports 4310 or 8080. Python cache directories
created by cross-platform verification were moved outside the repository.

## Post-CI acceptance still required

The following statuses remain HOLD and must not be promoted based on Windows
fixtures:

- `RASPBERRY LAN REMOTE WEB UI — HOLD`
- `LOCAL APPLIANCE UI NON-REGRESSION — HOLD`
- `REMOTE ACCESS SECURITY BOUNDARY — HOLD`
- `REMOTE VISUALIZER/FFMPEG ISOLATION — HOLD`
- `RASPBERRY SCREEN DIM AND DISPLAY STANDBY — HOLD`

After the user commits and pushes, exact-head CI must be green before using the
already-validated in-app updater. Physical acceptance then requires default
Off, enable, real-phone pairing, all target viewports, Player, Queue, Library,
Browse/SMB, two simultaneous clients, revoke, backend restart/reconnect,
disable/re-enable, exactly one SSE per device, no HTTP starvation, no FFmpeg
process, unchanged local appliance UI, updater no-op, Display 2.17.10 physical
verification, and complete cleanup. Unless the user chooses otherwise, leave
Remote access Off, no listener, display Active, and all original Display,
Audio, Queue, SMB, Favorites, and updater state.

## Files changed

Changes are limited to:

- `apps/remote-ui/**`;
- `apps/backend/src/remote-access/**` and focused tests;
- the backend composition/local management routes in `apps/backend/src/index.ts`;
- `packages/shared/src/remote-access.ts`;
- Network Settings remote panel/client and scoped CSS;
- build/release/installer verification;
- focused tests and documentation;
- this step output.

No automatic commit or push was performed.

## Post-push CI correction — guided staging fixture

The first post-push Linux staging run failed before activation because the
isolated-root installer fixture still created only the legacy local release
artifacts. The production `EIDETIC_ROOT == "/"` path already copied the built
`dist/remote-ui` directory correctly, but the simulated `EIDETIC_ROOT != "/"`
path omitted `remote-ui/index.html` and its CSS/JavaScript assets. The stricter
release verifier therefore rejected the fixture exactly as intended; no
release was activated and no rollback was necessary.

The simulated release now includes non-empty Remote UI HTML, CSS, and
JavaScript artifacts. The guided Standard-install fixture additionally asserts
that all three survive staging and are present through the `current` release
link. The reported failure was reproduced locally with
`bash deploy/linux/test-guided-installer-staging.sh`, then the same complete
fixture passed after the correction.

Correction validation:

- `bash -n deploy/linux/install-eidetic-player.sh` — PASS.
- `bash -n deploy/linux/test-guided-installer-staging.sh` — PASS.
- `bash deploy/linux/test-guided-installer-staging.sh` — PASS.
- `bash deploy/linux/test-staging.sh` — PASS, including Standard, Appliance,
  update, rollback, guided installation, and uninstall fixtures.
- `npm.cmd run verify:linux:installer` — PASS.
- `npm.cmd run lint` — PASS.
- `npm.cmd run format:check` and `git diff --check` — PASS.

This correction changes no production copy path, runtime listener, updater,
application UI, or dependency. It was not committed or pushed automatically.

## Post-update correction — exact target propagation

The first remote run fast-forwarded the Raspberry checkout from `653a428` to
`3f91ece`, while the installed release remained `8aff5ea`. The wrapper then
invoked the updater without `--ref`. Because `install.conf` intentionally pins
`EIDETIC_GIT_REF` to the installed exact commit, target resolution selected
`8aff5ea` and returned `Already up to date.`. The wrapper correctly rejected
the resulting installed/checkout Build-ID mismatch with exit code 69.

The remote wrapper now passes the full `checkout_target` SHA explicitly to the
first update and to the final no-op proof. Both updater calls are unattended
only after the visible SSH and `sudo` privilege boundary. This also prevents a
moving `main` branch from changing the target between checkout validation,
installation, and no-op verification. No Raspberry update was launched while
making this correction, and no commit or push was performed automatically.

Validation passed with PowerShell syntax parsing and the focused
`linux-installation.test.ts` suite (16/16). A read-only Raspberry dry-run using
the exact SHA reported installed `8aff5ea`, target `3f91ece`, preserved
application data, configuration and GPIO/I²S state, required service restart,
and no reboot; it made no release or service change.
