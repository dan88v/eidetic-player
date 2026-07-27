# Step 2.17.2 output — Installer and Updater Runtime Progress Refinement

## Status

Implementation, exact-head CI validation, and the guided Raspberry update are
complete.

`REAL RASPBERRY GUIDED UPDATE VALIDATION - PASS`

No automatic commit, push, merge, rebase, reset, stash, or clean was
performed.

## Baseline

- Branch: `main`.
- Baseline HEAD and `origin/main`:
  `b3646b3b9dfe5ba8f5c7dd7f37ad1393944f3703`.
- Divergence before work: `0 0`.
- Working tree before work: clean.
- Step 2.17 and Step 2.17.1 were present, including
  `RASPBERRY GUIDED UPDATE VALIDATION — PASS`.
- The exact baseline GitHub `Linux checks` job was green.
- Initial `git diff --check`: PASS.

## Real Windows baseline

The mandatory real path was run before editing:

```powershell
$env:EIDETIC_MPV_PATH = "C:\Tools\mpv\mpv.exe"
npm.cmd run mpv:doctor
npm.cmd run dev
```

Neutralino/WebView2, backend, Vite, MPV, drawer Build
`b3646b3-dev`, Audio Output, Network, Favorites, Queue, Power, and Quit were
inspected at the real 1280 × 800 content viewport. Preserved state:

- Queue: 12 stable rows.
- Current item: `Politik`.
- Position: approximately 0.047891 seconds, paused.
- Volume: 97.989433; mute off.
- Shuffle off; repeat off.
- Audio Output: system default.
- Favorite Tracks: two visible rows; albums/artists empty.

Baseline shutdown left no Neutralino, MPV, FFmpeg, repository Node/Vite/backend
process, or listener on ports 4310/5173.

## Pipeline audit and canonical runtime plan

The macro phases remain unchanged. Release staging, staged verification,
system integration, optional configuration, atomic activation, `current` /
`previous`, finalization, health gates, and rollback remain in their original
phases.

Default runtime plan: 12 real substeps. `--full-verify`: 17 real substeps.

|                      Order | Stable ID                                                                                  | Canonical real operation                                                 | Output/artifact                                                      |
| -------------------------: | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
|                          1 | `prepare-source`                                                                           | private workspace/runtime and isolated Git fetch                         | detached pinned source                                               |
|                          2 | `install-dependencies`                                                                     | `npm ci`                                                                 | locked build dependencies                                            |
|                          3 | `typecheck`                                                                                | `npm run typecheck`                                                      | verified TypeScript graph                                            |
|                          4 | `verify-installer`                                                                         | `npm run verify:linux:installer`                                         | verified deployment contract                                         |
|              5–9 full only | `format-check`, `lint`, `test-suite`, `test-posix`, `test-case-sensitive`                  | the existing complete gates                                              | verified source and tests                                            |
|   5–9 default / 10–14 full | `clean-build`, `generate-build-info`, `generate-shell-config`, `build-ui`, `build-backend` | canonical shared application orchestrator                                | clean `dist`, build provenance, production shell config, UI, backend |
| 10–11 default / 15–16 full | `sync-neutralino`, `package-neutralino`                                                    | canonical Linux packaging orchestrator                                   | synchronized Neutralino runtime and release package                  |
|       12 default / 17 full | `verify-runtime`                                                                           | architecture/resource checks and `verify-linux-release.ts --phase build` | verified backend, binary, resources, config, and Build ID            |

`scripts/build-orchestrator.mjs` is the single build definition used by
`npm run build`, `npm run build:linux`, and the installer. It executes the old
commands once, in the old order and environment. The updater still delegates
to the installer and has no build pipeline.

Release tree copying, production `npm ci --omit=dev`, release manifest checks,
executable modes, and staged release verification remain in the following
`Release staging and verification` macro phase.

## Progress protocol and dedicated channel

The closed internal format is:

```text
EIDETIC_PROGRESS_V1<TAB>runtime<TAB>event<TAB>step-id<TAB>index<TAB>total[<TAB>elapsed-ms]
```

Allowed events are `start`, `done`, `skipped`, and `failed`. Descriptions and
sanitized command previews are resolved only from local closed maps. Records
contain no human text, path, command line, stdout/stderr, user, environment, or
secret.

Validation covers exact magic/version/scope/event, lexical and known ID,
numeric/ranged index and total, canonical order, active-step coherence,
non-negative terminal duration, field count, 256-character line bound, and
control characters. Invalid records are ignored and receive a technical log
warning without rendering their payload or affecting the child build.

Events travel through an inherited anonymous pipe. The implementation uses
dedicated descriptors, synchronous line reads, no stdout/stderr parsing, no
polling, no shared event file, and no network socket. Reader, writer, child,
and relay descriptors/PIDs are deterministically closed and waited. The child
exit status is preserved.

## Direct installer and embedded updater UX

Direct installation retains the 9-step macro progress. During Application
runtime it stops the macro spinner and shows:

- completed/total runtime sub-bar;
- current stable description and index;
- spinner and elapsed time for a normal TTY;
- final `MM:SS` duration and exact DONE/SKIPPED/FAILED state;
- stable line-based events without ANSI or carriage returns on non-TTY.

Normal mode keeps technical child output in the protected log. Verbose mode
shows the closed sanitized preview and live stdout/stderr while continuing to
show substeps. No fake command percentage or cache inference is used.

The updater invokes the same unattended installer through a strictly validated
internal environment. Embedded mode requires parent scope `update`, numeric
open progress/log descriptors, and `--unattended`. It suppresses the installer
header, initial/final summaries, prompts, macro progress, reboot prompt, and
install-log creation. The updater owns the one header, summary, prompt, global
bar, failure panel, and update log.

The embedded installer writes technical records to the mode-0600 parent
`update-*.log`; protocol records remain on the dedicated pipe and never enter
the log. A direct installer continues to create its own `install-*.log`.

Both success summaries include Application runtime and total monotonic
durations. Durations under one second and beyond one hour format without
fractional precision in the UI.

## Skip/cache, no-op, and dry-run

- The current default/full plans contain only work that runs.
- Full-only gates are absent from the default plan; they are not falsely
  reported as skipped.
- `SKIPPED` is supported only for a technically proven non-applicable step.
- No runtime condition currently claims `CACHED`.
- A fast command is `DONE`, never inferred as cached.
- Same-commit update exits immediately with exactly `Already up to date.`,
  without runtime plan, embedded installer, restart, or release change.
- Dry-run exits before runtime planning and does not simulate build work,
  duration, or artifacts.

## Failure, signals, and rollback

A failed runtime command emits `failed`, retains the closed local substep
label, stops progress at the real completed count, preserves the original
status, and enters the existing authoritative failure panel with macro phase,
substep, reason, exit code, rollback, log, doctor, and sanitized excerpt.

If a child exits without a terminal event, the last valid `start` label remains
the failure substep. SIGINT/SIGTERM cleanup stops spinners, forwards signals,
closes descriptors, waits child/relay processes, and leaves the existing
single rollback path authoritative. Atomic activation was not moved.

## Tests and root staging

Focused coverage includes:

- valid start/done/skipped/failed records;
- unknown version/scope/ID, malformed number/range/total/elapsed/fields;
- oversized records, controls, shell-like text, and injection marker proof;
- raw human stdout not interpreted as progress;
- anonymous-pipe inheritance through an external child;
- EOF, child/relay/FD cleanup, failure status, and interrupt cleanup;
- TTY spinner/duration/sub-bar and non-TTY stable lines;
- embedded parent validation, zero embedded UI, parent log, and dedicated FD;
- canonical build order and exactly-once Linux composition;
- installer/updater contract changes and full/default profile boundaries.

Root-isolated staging ran as root with runtime user `daniele` and passed:
Standard/Appliance install and reinstall, guided/non-TTY paths, update embedded
single header/summary/log, exact no-op, dry-run, full-verify flag propagation,
rollback, restore, uninstall, GPIO managed/pre-existing paths, Build ID,
`current`/`previous`, platform rejection, and failure rollback fixtures. It did
not touch real `/opt`, `/etc`, `/boot`, systemd, media, NetworkManager, or
Raspberry hardware.

Shell syntax (`bash -n`) passed for every modified shell file. ShellCheck is not
installed in the local WSL environment, so no package was installed; CI remains
the authoritative ShellCheck run.

The first post-commit CI run exposed ShellCheck-only findings that were not
available locally. The corrective follow-up:

- quotes the protocol event literal `done`;
- marks two test fixture callbacks as intentionally invoked indirectly;
- exports the cross-script runtime-duration result;
- copies the two `coproc` descriptors into scalar FD variables before closing
  them, avoiding unsupported array-subscript redirection syntax.

After this follow-up, `bash -n`, console protocol fixtures,
`verify:linux:installer`, and `git diff --check` pass. The corrective CI rerun
passed on exact commit `82596a7a10127f5bb8aece6cdc5a38feb3d145ee`.

## Real Windows post-smoke

The exact `npm.cmd run dev` path was run again with the explicit MPV path.
Readiness reported Build `b3646b3-dev`, MPV available, and no backend error.
At 1296 × 839 outer / 1280 × 800 content:

- Now Playing remained stable without flash/shift;
- drawer and Build ID were unchanged;
- Settings, Audio, Output selection, Network, Favorites, mini-player, and
  Power dialog remained visually coherent;
- queue/current/position/volume/mute/shuffle/repeat were restored to the
  baseline values after QA;
- app shutdown and cleanup left no Neutralino/MPV/FFmpeg or ports 4310/5173.

No production frontend, backend, shared contract, drawer, Queue, Audio Output,
Network, Favorites, Power, or touch code changed.

## Final gates

Final results:

- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS after correcting the test-only
  `no-empty-function` finding.
- `npm.cmd run build`: PASS after the real Windows run exposed `spawn EINVAL`
  for direct `.cmd` spawning. The orchestrator now invokes npm's current
  `npm-cli.js` with `process.execPath` and `shell:false`.
- `npm.cmd run build:linux`: PASS; UI, backend, Neutralino synchronization,
  resources, Linux/Windows binaries, and bundle produced.
- `npm.cmd test`: PASS, 517 tests (507 passed, 10 platform skips).
- `npm.cmd run test:posix`: PASS, 3 passed and 2 Windows platform skips.
- `npm.cmd run verify:network:deployment`: PASS.
- `npm.cmd run verify:linux:executables`: PASS, 41 tracked deployment files.
- `npm.cmd run verify:linux:installer`: PASS, including 71 install-safe tests
  (60 passed, 11 platform skips).
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`:
  PASS.
- `npm.cmd run mpv:doctor`: PASS with MPV 0.41 and JSON IPC.
- `npm.cmd run test:mpv`: PASS, 8 integrations.
- `git diff --check`: PASS.

Additionally:

- all modified shell files: `bash -n` PASS;
- root-isolated `deploy/linux/test-staging.sh daniele`: PASS;
- protocol/console fixtures: PASS;
- no generated Python cache remains in the repository (test caches were moved
  to recoverable temporary quarantine);
- no residual app/runtime process or listener remains.

## Files and invariants

Changes are limited to installer/updater console and staging surfaces, the
canonical build orchestrator, contract/protocol tests, documentation,
package scripts, and this report. The only file under `apps` is the existing
Linux deployment contract test; no application source changed.

- `package.json`: scripts only.
- `package-lock.json`: unchanged.
- Dependencies/devDependencies: unchanged.
- `.github/workflows`: unchanged.
- `packages/shared`: unchanged.
- Uninstaller, restore script, GPIO helper, power helper: unchanged.
- Build-info schema and Build ID behavior: unchanged.
- No automatic commit or push.

## Real Raspberry guided update

The reusable visible-terminal workflow
`scripts/remote-rpi-update.ps1` was run against `daniele@10.0.0.112` only after
the local tree was clean, `HEAD == origin/main`, exact-head CI was green, and
the user explicitly authorized the connection. Normal mode was used; no
`--verbose` flag and no reboot were requested.

The real updater showed one updater header, one update summary, one
confirmation prompt, macro progress, runtime substep progress and elapsed
durations. It did not show a second installer header, installer summary,
installer prompt, raw protocol record, or normal-mode technical build output.
The pasted terminal transcript retains the first four transient runtime
substeps; the completed updater reports 12-step runtime preparation at 09:42
and total duration 10:01.

Results:

- installed Build ID moved from `b448c44` to `82596a7`;
- release activated as `releases/20260727T111454Z-82596a7`;
- user service: `active`;
- readiness: `ready`, player paused, MPV available, no error code;
- API commit: `82596a7a10127f5bb8aece6cdc5a38feb3d145ee`;
- installation doctor: PASS for every required platform, runtime, maintenance,
  power, manifest, and build-info check;
- ALSA: three cards, HDMI detected, GPIO/I2S DAC detected;
- application audio: reachable, MPV true, ALSA preferred output available,
  25 enumerated devices;
- application data, configuration, and pre-existing GPIO/I2S configuration
  preserved;
- reboot not performed;
- same-commit second invocation returned exactly `Already up to date.`;
- SSH workflow ended successfully and reported
  `Remote update and same-commit verification passed.`

The read-only doctor reported build provenance `source/dirty git/true`; commit,
short Build ID, ref, package version, and API coherence all matched. This
pre-existing provenance observation did not affect activation, readiness,
doctor status, audio detection, or the no-op proof.

`REAL RASPBERRY RUNTIME FAILURE ROLLBACK - NOT TESTED`
