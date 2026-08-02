# Step 3.2 output — AirPlay Receiver Integration

## Status

The AirPlay receiver integration is implemented and locally validated against
the production provider boundary, the real Step 3.1 Arbiter, Linux deployment
contracts, and the real Windows Neutralino/WebView2 application. Nothing was
committed, pushed, installed on a Raspberry Pi, or deployed to a device.

`READY FOR CI VALIDATION — AIRPLAY NOT DEPLOYED`

`AIRPLAY CLASSIC FALLBACK — NOT PHYSICALLY TESTED`

## Baseline Git and CI

- Branch: `main`.
- Baseline HEAD and `origin/main`:
  `453940baf644ac272657d07e04a40ea8798a192c`.
- Ahead/behind before editing: `0/0`.
- Working tree before editing: clean; no merge or rebase in progress.
- Step 3.1 and its corrective work were present.
- Exact-head CI was green before implementation.
- No commit, push, merge, rebase, reset, restore, stash, or clean was run.

## Official upstream audit and selected sources

Only the official `mikebrady` repositories and their release source archives
were used.

| Component      | Stable release/tag | Exact commit                               | Source archive SHA-256                                             | License                            |
| -------------- | ------------------ | ------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------- |
| Shairport Sync | `5.2.1`            | `08af668a5d17b4714da38981dea4c9039263a4cc` | `8f97d1a6e045bc3765b10d0cd64abe467eba343af89fa1e158f7fa28b73c4ab6` | MIT with bundled component notices |
| NQPTP          | `1.2.8`            | `c925f27c1fd12e4033ac477e5a405969b0b0260b` | `3a2882a299c21605f53bb215ce537f9cc7a1e894476f639ab28562c68fd183a9` | GPL-2.0-or-later                   |

The audited Shairport release exposes AirPlay 2 with SMI version 10, Classic
fallback through one receiver, OpenSSL, Avahi, ALSA, PipeWire, soxr, metadata,
metadata pipe, session interruption, and a 15-second session timeout. The
NQPTP release reports shared-memory interface version 10 and owns the AirPlay 2
timing role on UDP 319/320.

The authoritative manifest is `deploy/linux/airplay/sources.json`. It records
the immutable tag, commit, HTTPS archive, checksums, flags, dependencies,
licenses, expected features, shared-memory interface, and the Eidetic patch.
Corresponding source archives, patch, notices, and upstream license files are
included in the staged integration artifact to satisfy source availability.

## Authorized fail-closed Shairport patch

Upstream 5.2.1 waits for the pre-play command but does not use its non-zero
exit status to deny playback. That behavior is insufficient for output
arbitration. The user explicitly authorized a maintained Eidetic patch.

`shairport-sync-5.2.1-eidetic-fail-closed.patch` propagates the blocking hook
failure out of `player_play` before output preparation or the playback thread
can open the audio device. The patch dry-applies to the exact pinned source and
is verified as part of the deployment contract. The closed hook returns success
only after the Arbiter has suspended MPV, released the canonical output,
validated the provider route, and granted the pending AirPlay session.

## Managed source build, dependencies, and cache

The source builder:

- refuses root execution;
- downloads only the pinned HTTPS archives with bounded retries;
- verifies both SHA-256 checksums before extraction;
- rejects absolute paths, traversal, device/FIFO entries, and escaping links;
- applies the exact maintained patch;
- builds with `make -j2` for the Raspberry Pi 3B budget;
- emits binary hashes, architecture, compiler identity, source material, and
  licenses in a versioned artifact;
- checks Shairport version features and NQPTP version/SMI before publishing the
  artifact.

Shairport flags are `--with-airplay-2`, `--with-alsa`, `--with-pipewire`,
`--with-avahi`, `--with-ssl=openssl`, `--with-soxr`, `--with-metadata`, and
`--with-metadata-pipe`.

The explicit package plan adds the autotools toolchain, `patch`, ALSA,
PipeWire, Avahi, OpenSSL, soxr, plist, sodium, UUID, gcrypt, and FFmpeg
development libraries. The distribution Shairport package is not used as the
binary authority. Shairport links FFmpeg libraries; no Eidetic FFmpeg analyzer
process is created for AirPlay.

The first Linux source-build CI run exposed that the AirPlay 2 configure step
requires the `plistutil` executable in addition to the plist development
headers. The package contract and dedicated CI job now install
`libplist-utils`, and the source builder checks for `plistutil` before any
download or compilation work begins.

The following Linux staging run exposed a separate fixture-only inconsistency:
its generated AirPlay binaries were not represented in the fixture artifact's
hash map, so the installation doctor correctly rejected their integrity. The
staging installer now records the actual SHA-256 digest for both generated
fixture binaries, preserving the production-strength doctor check instead of
weakening it for tests.

The subsequent real source-build run compiled both receivers successfully and
then exposed an incorrect post-build expectation: the pinned Shairport Sync
5.2.1 and NQPTP 1.2.8 sources both declare SMI version 10, while the original
manifest expected version 5. The manifest now records version 10, and both the
builder and installed-cache validator derive their `smi` checks from that
single value. The builder also compares the authenticated source headers before
compilation, so mismatched Shairport and NQPTP shared-memory contracts fail
before an artifact can be published. The managed integration identity advances
to `shairport-sync-5.2.1-eidetic.2+nqptp-1.2.8`, preventing reuse of a cache
created under the superseded SMI declaration. Existing AirPlay stores migrate
that internal integration identity atomically on startup while preserving the
receiver name and enabled state.

The Linux full-suite run then exposed a fixture lifecycle defect: the AirPlay
provider opened its native metadata FIFO based only on the host OS, despite the
platform adapter being an explicit fixture. Fixtures now always skip native
FIFO work, and the blocking-hook regression owns shutdown even when provider
initialization rejects, preventing failed tests from leaving a control server
that stalls the entire Node test process.

The root-owned cache is keyed by integration version and architecture. A cache
entry is accepted only when it is root-owned, contains no symlink or
group/world-writable object, has the expected architecture and artifact hashes,
reports every required feature/version, and has no unresolved dynamic library.
Corruption, a changed integration identity, wrong architecture, missing
feature, wrong hash, or incompatible linkage causes a cache miss/failure rather
than untrusted reuse. The release stages a verified copy under `airplay/`.

A separate `airplay-source-build` Linux CI job performs the real pinned x64
source build. The exact source build was not performed on Windows. The ARM64
build remains a post-CI Raspberry validation item.

## Services, privileges, ports, and pre-existing integration

- Shairport runs as the Eidetic runtime user in a user unit. It is never root,
  has `NoNewPrivileges`, a strict filesystem view, a private temporary
  directory, and a fixed config and executable.
- The Shairport unit requires the existing Eidetic user service and a live
  private control socket. Loss or shutdown of the core stops the receiver; a
  restarted backend recreates the private runtime before advertising again.
- NQPTP is a separate system unit with `DynamicUser`,
  `CAP_NET_BIND_SERVICE` as its only ambient/bounding capability, restricted
  address families, and systemd hardening. It has no root Shairport coupling.
- The installer refuses an active unmanaged system/user Shairport service and
  an unmanaged UDP 319/320 conflict. It never overwrites a generic Shairport
  configuration.
- Managed-record backup/restore protects pre-existing files at Eidetic-owned
  paths. The uninstaller restores only records whose ownership/integrity is
  proven.
- A post-activation NQPTP runtime failure is reported as an AirPlay warning;
  it does not falsely report that the already activated, locally usable
  Eidetic release was rolled back.

## Persistent settings and receiver identity

`airplay.json` is schema 1, atomically written, mode `0600`, owned by the
runtime user, protected from symlinks, and stored independently of releases.
The first install creates it only when absent with `enabled: true`.

The generated name is `Eidetic Player - XY`, where `XY` contains exactly two
cryptographically generated characters from
`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`. It is generated once and is not derived
from MAC, hostname, IP, build ID, or any hardware identity. A user rename is
normalized, trimmed, limited to 1–40 visible characters, safely quoted, and
never receives an automatic suffix.

Generated-name collision recovery is bounded to three advertisement attempts.
A custom-name conflict returns a typed error and never changes the chosen name.
An enabled idle rename writes the new config, restarts the receiver, and
verifies the exact new advertisement. Active rename is rejected. Explicit Off,
custom name, and generated suffix survive updates and normal reinstall. The
installer summary now reports preserved On/Off rather than claiming On
unconditionally. Strong purge removes the store and build cache.

## Configuration, route, and output level

The deterministic renderer accepts only canonical ALSA and PipeWire routes.
It emits one receiver with `service_type = "auto"`, fixed before/after hooks,
blocking completion, session interruption, a 15-second timeout, the private
metadata pipe, artwork/progress events, and the exact selected physical target.
No sender value becomes a command, path, service name, or raw config fragment.

There is no System default fallback. Unsupported, unavailable, or stale routes
leave MPV authoritative and put AirPlay in Error/Unavailable. An idle output
change rewrites config and performs a bounded receiver restart. An active
AirPlay session rejects output and output-level mutations with a typed error.

For Variable output, the parser uses Shairport's effective/low/high dB metadata
fields, handles the documented mute sentinel, clamps to 0–100 and Maximum
Software Volume, applies 0.5% hysteresis plus an 80 ms debounce, persists the
confirmed global level through the existing preferences authority, and updates
the suspended MPV token for the return to Local. Local volume controls remain
disabled because no reliable end-to-end Shairport control was exposed.

For Fixed output, Shairport is rendered with volume control ignored, the
provider publishes exactly `100` and `muted: false`, sender volume events are
ignored for effective level, and no positive gain or second attenuation stage
is added. Physical Fixed unity still requires real DAC validation on Raspberry;
it is not claimed from the Windows fixture.

## Provider, handshake, arbitration, and lifecycle

`AirPlayProvider` is a production `ExternalPlaybackProvider` registered with
the one Step 3.1 Arbiter. It owns no MPV and creates no second backend, Arbiter,
HTTP port, or SSE connection.

The before hook speaks a closed, bounded `BEFORE 1` protocol over a private
Unix socket (`0600`; a named-pipe equivalent in the Windows fixture). The
provider creates a distinct session/generation, asks the Arbiter to acquire,
and replies `GRANT` only after MPV output release and provider confirmation.
Timeout, malformed input, duplicate pending request, stale session, route
failure, or Arbiter failure returns/causes denial. The real Arbiter plus
production provider test confirms that the hook remains blocked until MPV is
released.

The same daemon can replace a previous sender without stopping itself between
session generations; the newest valid session wins and stale metadata/artwork
cannot match the new session. Explicit sender pause retains ownership. End,
disconnect, error, Off, local preemption, power/update preparation, and shutdown
flow through the existing serialized release policy. `AFTER 1` releases the
session; Shairport's verified 15-second session timeout handles sender loss
without treating an ordinary pause as disconnect. Local restore obeys Keep
paused or Resume interrupted playback.

Core readiness does not wait indefinitely for AirPlay. AirPlay initialization
is a separate bounded promise after the core/Arbiter is ready. Missing
integration, advertisement, route, or service health becomes AirPlay status
without blocking Library or local MPV recovery.

## Metadata, artwork, and progress

The private runtime parent is `0700`; the FIFO and control socket are `0600`,
runtime-owned, non-symlink, and deterministically removed/stopped. Opening the
FIFO read/write keeps the reader stable across writer restarts without polling
or reopen loops.

The TypeScript parser accepts only audited `core`/`ssnc` codes for title,
artist, album, artwork, progress, volume, play/buffer/flush/end/disconnect, and
metadata sequence boundaries. It supports fragmented and multiple records,
strict base64 and declared lengths, fatal UTF-8 decoding, Unicode NFC,
sanitized controls, bounded text, bounded aggregate buffering, 32-bit progress
wrap, and silent rejection of unknown or malformed records.

Artwork is limited to 5 MiB and accepted only after JPEG/PNG signature
verification. It stays in a session-scoped memory cache behind an opaque UUID
ID and ETag; no local path or base64 payload enters state/SSE. Old artwork is
cleared at metadata generation change, end, release, crash, and shutdown.
Progress remains on the existing source snapshot and existing SSE.

## Local and Remote UI

Settings → Network now contains canonical touch navigation rows in this order:
Wired, Wi-Fi, AirPlay. Wired and Wi-Fi retain their existing standalone detail
pages and functionality. Remote access remains in the Settings root.

The AirPlay page contains only Receiver On/Off, Receiver name, Status, Output,
and the required trusted-LAN notice. It omits versions, pins, ports, processes,
paths, raw config/metadata, and logs. Active Off opens the concise Cancel/Stop
AirPlay confirmation; active rename is disabled. Status reacts to the existing
playback-source snapshot and shows Available, Starting, Playing, Paused, Error,
Off, or Unavailable without polling.

Now Playing and the mini-player reuse the Step 3.1 source-aware presentation:
`Now Playing — AirPlay`, AirPlay icon in the Favorite slot, no Favorite,
provider metadata/artwork/progress, truthful disabled controls, no external
visualizer, and the Resume Local action. No technical AirPlay rows were added.
The Queue remains local and source-aware.

Remote UI receives the same sanitized playback-source event over its existing
multiplexed SSE. It gains no AirPlay administration page, receiver-name editor,
security settings, or second EventSource.

## Installer, updater, rollback, uninstall, and doctor

- Installer builds or reuses the verified cache before release staging, stages
  the integration as part of the Linux release contract, installs the units and
  fixed hook, creates only a missing default store, preserves existing data,
  checks unmanaged conflicts before activation, starts NQPTP after activation,
  and never reboots automatically.
- Updater continues to delegate to the pinned exact-target installer. The
  persisted store is outside releases, unchanged integration reuses cache, and
  current/previous release transaction semantics are unchanged.
- Rollback to an AirPlay release uses its matching staged binaries and
  manifest. A pre-AirPlay current release makes both units harmless through
  `ConditionPathExists`; advertisement stops while the store remains for a
  later re-upgrade.
- Normal uninstall disables/stops the receiver and timing service, removes
  managed units/hook/runtime/release data, preserves shared Avahi packages and
  `airplay.json`, and restores proven pre-existing managed records. Purge also
  removes the store and cache. Operations remain idempotent.
- Doctor is read-only and checks manifest/artifact hashes, source pins, ELF
  architecture, version/features, SMI, units, owners/modes, store/config,
  enabled preference, service state, advertisement, UDP conflicts, FIFO,
  socket, hook, selected-output/provider coherence, and Arbiter API health. It
  does not print sender identity, metadata, artwork, media, raw config, tokens,
  or private paths.

Root-isolated staging covers the mandatory deployment and release-artifact
contracts. No real host service was mutated during local staging.

## Windows real-application QA

The exact required command was used:

```powershell
$env:EIDETIC_MPV_PATH = "C:\Tools\mpv\mpv.exe"
$env:EIDETIC_AIRPLAY_FIXTURE = "1"
npm.cmd run dev
```

Validated in the real Neutralino/WebView2 application:

- stable 1280×800 Now Playing and shared controls;
- Settings root with Remote access unchanged;
- Network canonical Wired/Wi-Fi/AirPlay rows;
- minimal AirPlay page with persistent generated name and On state;
- 1280×800, 1024×768, 1024×600, and 1366×768 local layouts with no
  horizontal overflow or mini-player regression;
- real production-provider named-pipe grant through the real Arbiter and one
  real MPV process;
- Local → AirPlay buffering presentation (`Now Playing — AirPlay`), source
  icon, disabled capabilities, fixed 100%, and Resume Local;
- AirPlay Settings live status showing Starting during provider buffering;
- AirPlay → Local release with `localPlaybackSuspended: false`;
- Off/On Settings actions through the local revisioned API;
- clean shutdown with no Eidetic Neutralino, backend, Vite, MPV, listener 4310,
  listener 5173, or AirPlay control pipe left behind.

Windows cannot validate Shairport/NQPTP binaries, Avahi discovery, real Apple
senders, real audio, DAC unity, AirPlay 2 timing, Classic fallback, real
disconnect timing, or Raspberry performance. Those remain explicit handoff
items.

## Tests and final gates

Focused validation completed before this report:

- `test:airplay`: production provider/Arbiter, store, collision, rename restart,
  config, parser, handshake, end policy, replacement, level, recovery — PASS;
- Network/AirPlay Settings tests — PASS;
- `verify:airplay:deployment` — PASS;
- `verify:linux:installer` and install-safe staging — PASS;
- TypeScript typecheck and formatting — PASS;
- all tracked Linux executable modes — PASS;
- `bash -n` for tracked Linux shell scripts — PASS;
- ShellCheck unavailable on the Windows host and not installed.

The complete post-report gate list is:

`format:check`, `typecheck`, `lint`, `build`, `build:linux`, `npm test`,
`test:posix`, network/deployment/executable/installer/release verification,
AirPlay deployment/tests, MPV doctor/tests, FFmpeg doctor/tests, Remote
tests/build, high-severity npm audit, and `git diff --check`.

The complete post-report pass is green:

- `npm.cmd run format:check` — PASS;
- `npm.cmd run typecheck` — PASS;
- `npm.cmd run lint` — PASS;
- `npm.cmd run build` — PASS;
- `npm.cmd run build:linux` — PASS;
- `npm.cmd test` — PASS, 823 tests, 810 passed, 13 platform skips, 0 failed;
- `npm.cmd run test:posix` — PASS, 3 passed and 2 Windows skips;
- `npm.cmd run verify:network:deployment` — PASS;
- `npm.cmd run verify:linux:executables` — PASS, 50 tracked deployment
  files;
- `npm.cmd run verify:linux:installer` — PASS;
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build` —
  PASS;
- `npm.cmd run verify:airplay:deployment` — PASS;
- `npm.cmd run test:airplay` — PASS, 17/17;
- `npm.cmd run mpv:doctor` — PASS with
  `C:\Tools\mpv\mpv.exe` 0.41.0 development build;
- `npm.cmd run test:mpv` — PASS, 14/14, including one persistent MPV output
  release/restore and 24 automatic Context transitions;
- `npm.cmd run ffmpeg:doctor` — PASS;
- `npm.cmd run test:ffmpeg` — PASS, 3/3 and exactly one realtime analyzer;
- `npm.cmd run test:remote` — PASS, 34 passed, one Windows symlink skip;
- `npm.cmd run build:remote` — PASS;
- `npm.cmd audit --audit-level=high` — PASS, 0 vulnerabilities;
- `git diff --check` and cached diff check — PASS;
- `bash -n` over every tracked Linux shell script — PASS;
- ShellCheck was unavailable on the Windows host and was not installed.

## Files changed

- Shared/API: `packages/shared/src/airplay.ts`, local AirPlay API client, and
  backend endpoint/bootstrap wiring.
- Backend: AirPlay store, renderer, parser, platform adapter, provider, service,
  narrow provider/Arbiter extensions, and focused tests.
- UI: Settings/Network navigation, minimal AirPlay page, source-aware live
  status wiring, scoped styles, and tests.
- Linux: source manifest/notices/patch/builder, hook, user/system units,
  installer, uninstaller, doctor, staged release verifier, and deployment tests.
- CI/docs: separate source-build job, package scripts, README, Linux/network/
  arbitration documentation, and this report.

Explicitly unchanged: playback plan, FFmpeg/analyzer, visualizer, reliable touch
scroll, software update implementation, update runner/progress protocol, and
`package-lock.json`. No npm dependency was added.

## Manual Raspberry handoff after manual commit/push and green exact-head CI

1. Run the exact-target update and verify readable AirPlay build/cache/staging
   progress, ARM64 artifact, hashes, units, doctor, and no automatic reboot.
2. Confirm default/persisted name and automatic On advertisement without MAC or
   hostname-derived identity.
3. Test discovery and real AirPlay 2 audio from an Apple sender through the
   canonical GPIO/I²S DAC, with no System default fallback.
4. Start from active local Context/Explicit Queue; confirm MPV releases the DAC,
   AirPlay owns it without overlap, and local Context/Queue/History remain.
5. Validate metadata, artwork, progress, Variable mapping and maxima, MPV return
   level, Fixed 100% unity, no double attenuation, and no clipping gain.
6. Validate pause ownership, real 15-second disconnect, Keep paused/Resume,
   Local preemption, second-sender replacement, and stale metadata rejection.
7. Validate custom rename, active rename protection, Off/On advertisement,
   persisted custom name and explicit Off.
8. Validate backend/service restart, reboot, rollback to AirPlay and pre-AirPlay
   releases, unchanged update cache hit, and no duplicate process/service.
9. Measure Shairport/NQPTP idle and active CPU/RAM, acquisition/metadata/artwork/
   volume/release latency, descriptors, listeners, journal warnings, and audio
   dropout on Raspberry Pi 3B.
10. Confirm one MPV after Local restore, one Shairport, one NQPTP, no AirPlay
    FFmpeg analyzer, and no stale FIFO/socket/artwork/build process.
11. Test Classic fallback with a compatible sender when available; otherwise
    retain `AIRPLAY CLASSIC FALLBACK — NOT PHYSICALLY TESTED`.

No Raspberry Pi was accessed or updated during this step. No automatic commit
or push was performed.
