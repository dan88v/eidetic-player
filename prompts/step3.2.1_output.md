# Step 3.2.1 output — AirPlay doctor live-receiver correction

## Status

The AirPlay installation doctor no longer starts a second Shairport Sync
receiver while validating an installed configuration. The correction is local
and uncommitted. It has not been installed on the Raspberry Pi.

## Requested outcome

Correct the misleading remote-update failure reported after build `2ae5072`
was successfully activated. The post-update doctor reported only
`airplay-config: fail`, which made the PowerShell wrapper return SSH exit code
1 even though installation, activation, restart, hard health, player readiness,
and AirPlay runtime had succeeded.

## Root cause and measured reproduction

On the Raspberry Pi, the previous doctor executed the installed
`shairport-sync` binary with the generated config and `--displayConfig` while
the managed receiver was already active. In Shairport Sync 5.2.1 this option
prints configuration but is not parse-only: execution proceeds into receiver
startup. The diagnostic instance then collided with the legitimate receiver on
AirPlay port 7000 and exited with status 139.

Read-only Raspberry evidence before the correction:

- config: regular file, mode `0600`, UID 1000 (`daniele`);
- managed receiver: active;
- managed NQPTP timing service: active;
- diagnostic output reached `Display Config End`;
- diagnostic then reported that port 7000 already had another Shairport
  instance and exited 139.

This was a false negative in the doctor, not an update, rollback, config-file,
or AirPlay runtime failure.

## Correction

`airplay-config` remains a read-only security check for a regular non-symlink
file with mode `0600` owned by the runtime user. It no longer executes
Shairport Sync.

This preserves the complete effective contract without creating a competing
receiver:

- the backend atomically rewrites the deterministic generated configuration
  before every enable or restart;
- when AirPlay is enabled, the existing `airplay-runtime` check verifies that
  the managed receiver accepted its configuration and that the receiver,
  timing service, FIFO, control socket, Avahi, and timing ports are healthy;
- when AirPlay is disabled, the latent config is not executed and will be
  regenerated before the next enable.

The AirPlay deployment verifier now reads the doctor and fails if a Shairport
config invocation is reintroduced, while retaining the file-security and
runtime checks.

## Files changed

- `deploy/linux/doctor-installation.sh`
- `scripts/verify-airplay-deployment.ts`
- `prompts/step3.2.1_output.md`

No dependency was added or removed. There is no UI, playback, DSP, Queue,
metadata, artwork, network protocol, bundle, or steady-state runtime impact.
The executable mode of the doctor remains `100755`.

## Validation

Focused checks completed:

- `npm.cmd run verify:airplay:deployment` — PASS, including the new
  `read-only AirPlay config doctor` regression;
- `bash -n deploy/linux/doctor-installation.sh` — PASS;
- `npm.cmd run format:check` — PASS;
- `git diff --check` — PASS.

Final gates completed after the report draft:

- `npm.cmd run typecheck` — PASS;
- `npm.cmd run lint` — PASS;
- `npm.cmd run build` — PASS, including local and Remote UI plus backend;
- `npm.cmd test` — PASS, 825 tests: 812 passed, 13 platform skips,
  0 failed;
- `npm.cmd run verify:linux:executables` — PASS, 55 tracked deployment
  files with valid Git modes;
- `npm.cmd run verify:linux:installer` — PASS, including installer contract,
  install-safe suite (74 tests: 63 passed, 11 platform skips, 0 failed),
  network deployment, and the corrected AirPlay deployment verifier;
- final `npm.cmd run format:check` and `git diff --check` — PASS.

## Real-system and UI scope

The failing command was reproduced read-only on the real Raspberry Pi and the
running AirPlay services were verified. The corrected full root doctor was not
deployed or executed on the Pi because that would require installing the local
change; target confirmation remains the next remote-update verification after
the user's commit and push.

No visual surface changed, so Neutralino/WebView2 and 1280 × 800 visual/touch
QA are not applicable. MPV and FFmpeg tests are also not applicable. No process
was started locally by this correction, and the read-only remote diagnostics
left the existing managed receiver and timing service running.

No commit or push was performed.
