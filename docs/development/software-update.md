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
- `Start update` accepts only the plan ID and the same expected full commit.
  The backend rejects stale, expired, changed, or already-installed plans.
- Update endpoints accept only loopback clients and reject a supplied
  non-local or malformed Origin.

The backend calls the fixed root-owned helper through `pkexec` with an argument
array. The generated Polkit rule exact-matches the helper and configured
runtime user. The helper revalidates every field, writes a mode-0600 request,
and starts the system `eidetic-player-update.service`. That service and its
runner survive GUI, backend, user-service, and release replacement.

The runner holds a non-blocking `flock`, invokes the installed updater with the
checked exact SHA, and keeps preparation at reduced CPU and I/O priority. The
installer restores normal priority immediately before activation. There is no
cancel action and only one job may be active.

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

The backend polls the journal at a low fixed cadence and owns one SSE stream
for the application. Reconnection accepts a new backend generation even when
its revision counter restarts. During preparation the app remains usable and a
reserved top-bar status slot shows progress without shifting adjacent icons.
Activation closes overlays, flushes preferences, and replaces the app with a
minimal stable restart surface. After reconnection the UI reports the concise
authoritative result.

The existing atomic `current`/`previous` switch, hard Build ID health gate, MPV
soft warning, and automatic rollback remain owned by the Linux updater.
Structured rollback events record whether the previous release was restored or
manual recovery is required. Manual rollback is deliberately not exposed in
Settings.

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
