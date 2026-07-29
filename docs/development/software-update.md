# Software Update

Software Update is an appliance-only system operation. The UI plans and
observes an update, but it never owns the privileged process and never passes a
free-form Git ref, URL, executable, or shell command across the privilege
boundary.

## Trust and lifecycle boundaries

- The canonical source is fixed to the Eidetic Player GitHub repository.
- Branch discovery occurs only when the user taps `Refresh branches`.
- The backend accepts only valid remote branch names. `main` is labelled
  Stable; every other valid branch is labelled Development.
- `Check for updates` resolves the selected branch to one full 40-character
  commit and creates an immutable plan that expires after 30 minutes.
- The update summary pairs the installed Build ID with its embedded build
  timestamp. The target pairs its exact commit with the canonical GitHub commit
  timestamp when that metadata is available; timestamp lookup failure never
  blocks a safe exact-SHA update check.
- `Start update` accepts only the plan ID and the same expected full commit.
  The backend rejects stale, expired, changed, or already-installed plans.
- Update endpoints accept only loopback clients and reject a supplied
  non-local or malformed Origin.

The backend calls the fixed root-owned helper through `pkexec` with an argument
array. The generated Polkit rule exact-matches the helper and configured
runtime user. The helper revalidates every field, writes a mode-0600 request,
and starts the system `eidetic-player-update.service`. That service and its
runner survive GUI, backend, user-service, and release replacement.

The runner holds a non-blocking `flock`. An installed release intentionally has
no `.git` metadata, so the updater first fetches the checked exact SHA into a
private runtime-user bootstrap checkout and invokes the installer from that
checkout. The installer then retains its existing isolated build checkout and
all checkout preflight rules. Preparation stays at reduced CPU and I/O
priority, and the installer restores normal priority immediately before
activation. There is no cancel action and only one job may be active.

## Progress and recovery

Updater phases cross a dedicated inherited file descriptor as versioned
`EIDETIC_PROGRESS_V1` records. Human stdout and logs are never parsed. The
root runner converts only this closed event vocabulary into
`/var/lib/eidetic-player/update/current.json`.

Journal updates use a temporary file, file `fsync`, atomic rename, and parent
directory `fsync`. The current job records its revision, exact branch and
commits, state, phase, timestamps, elapsed time, warning count, result,
rollback result, and service health. Completed snapshots are retained in a
bounded history. Credentials, paths, raw logs, and command output are excluded.

The protected `/var/lib/eidetic-player` parent grants the runtime group
traverse-only access. The update directory is setgid and group-readable, while
the root service runs with the runtime group and a `0027` umask. Request files
remain root-only; only the sanitized current/history journals are readable by
the backend.

The fixed root updater service explicitly permits privilege dropping. Its
runner and installer use `runuser` to execute every source fetch, dependency
operation, and application build as the configured runtime identity; Raspberry
Pi OS rejects that required UID transition when the service sets
`NoNewPrivileges=yes`. Authorization remains limited to the exact root-owned
helper, runner, request schema, canonical remote, and checked commit.

The backend polls the journal at a low fixed cadence and owns one SSE stream
for the application. Reconnection accepts a new backend generation even when
its revision counter restarts. During preparation the app remains usable and a
reserved top-bar status slot shows progress without shifting adjacent icons.
Activation closes overlays, flushes preferences, and replaces the app with a
minimal stable restart surface. After reconnection the UI reports the concise
authoritative result.

After the privileged helper accepts a start request, the backend publishes a
job-identified `queued` state before returning HTTP 202. This opens the
demand-driven updater stream immediately and prevents the short systemd/journal
creation interval from appearing as an idle no-op. A stale journal belonging
to an earlier job cannot replace that accepted queued state.

The update unit is `Type=oneshot`, so systemd reports its long-running
preparation phase as `activating`, not `active`. Backend reconciliation treats
both states as live and synthesizes `interrupted` only after the unit reaches a
terminal state without a matching terminal journal.

The runner's job-progress descriptor can already occupy descriptor 7, while
the updater and embedded installer also keep their protected log and relay
descriptors open. Runtime progress therefore reserves descriptor 8 first, with
explicit child redirection across the `runuser` boundary. A nested updater
relay reserves descriptor 20 when 8 is already occupied; 7/6 remain guarded
fallbacks for shallower invocation contexts. Descriptor 10 is deliberately not
used because Bash commonly allocates it to the relay's dynamic read side.
Dynamically allocated Bash descriptors are not exported as the progress
channel because their environment number can outlive the actual descriptor
across that privileged exec boundary. Human output remains separate from the
closed structured progress stream.

Software Update keeps branch/build information in the canonical bordered
Settings panel. `Check for updates` and `Start update` are equal-width sibling
actions below it. `Refresh branches` is likewise a separate page action below
the branch list. Confirmation closes into an immediate visible busy state
before privilege authorization begins.

The application shell owns update snapshot ordering across backend restarts.
The Settings page accepts every snapshot forwarded by that shell instead of
comparing revision numbers from different backend generations, so a restarted
revision sequence cannot leave the visible job state stuck at `Queued`.

Current build uses the embedded release build timestamp. A different checked
target uses its canonical GitHub commit timestamp because no target release has
yet been built locally. When current and target resolve to the same exact
commit, both rows use the embedded current build timestamp so identical Build
IDs never present contradictory dates.

The existing atomic `current`/`previous` switch, hard Build ID health gate, MPV
soft warning, and automatic rollback remain owned by the Linux updater.
Structured rollback events record whether the previous release was restored or
manual recovery is required. Manual rollback is deliberately not exposed in
Settings.

Production dependency installation retries a failed `npm ci` at most twice,
with bounded 5- and 10-second backoff. This allows transient registry
disconnects to recover while keeping deterministic dependency failures finite
and visible in the same runtime phase.

## Configuration and removal

`/etc/eidetic-player/update.conf` stores its schema, the fixed canonical source,
and `EIDETIC_UPDATE_BRANCH=<validated-branch>`. It contains no target SHA, job
state, log output, credentials, or generic UI preferences. Reinstall and update
preserve it. A normal uninstall preserves the selection but removes jobs,
journal state, runner, helper, service, and policy; purge also removes the
configuration.

Windows development uses an explicit deterministic fixture for UI and
lifecycle validation. It does not claim Linux privilege, systemd, rollback, or
Raspberry deployment coverage.
