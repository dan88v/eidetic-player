# Step 2.13 output — SMB Connections and Quick Browse

## Status

**COMPLETE with explicit native-runtime limitations.** Persistent SMB
connections, credential boundaries, bounded reconnect, Sources management,
top-bar status, read-only Quick Browse, opaque Queue origins, disconnect
handling, automated coverage, and mandatory Windows Neutralino QA are
implemented.

Real Windows SMB/Credential Manager connection is **NOT TESTED** because no
safe NAS share/credential was available. Linux CIFS runtime and Raspberry Pi
mount authorization are **NOT TESTED** and remain Step 2.13.2. Fixture results
are not reported as native SMB results.

SMB Library Integration was not started.

## Baseline

- Repository: `C:\Users\dan88\Desktop\eidetic-player`.
- Initial branch: `main`; initial worktree clean; no merge/rebase.
- Initial `HEAD`: `e9adb6c network deployment preparation for linux/debian`.
- `HEAD...origin/main`: `0 0` after `git fetch --prune origin`.
- Node `v24.18.0`; npm `11.16.0`.
- Step 2.12.2 was committed before this work.
- Latest known Linux CI remained externally pending as documented by Step
  2.12.2. No CI run was created because no commit or push was performed.

## Repository and credential stores

Added a versioned atomic `SmbConnectionRepository` for opaque IDs, display
name, normalized server/share, auth mode, optional username/domain, credential
reference, and timestamps. Passwords and native roots are rejected from the
record boundary. Names are whitespace/case normalized; duplicate names and
duplicate normalized server/share pairs are rejected. Server and share are
immutable after Add.

- Windows: the current user's Credential Manager is accessed through a hidden,
  bounded PowerShell/P/Invoke helper with structured stdin. The target is
  derived from the connection ID; no password enters argv or logs.
- Linux: the backend writes a separate CIFS credential file atomically in a
  private directory, enforces `0600` on the file and `0700` on the directory,
  and passes only the credential-file path to mount.
- Fixture: an in-memory secret store leaves no host credential.

First Add writes only a temporary managed secret, connects and verifies the
root, then persists the record. Failure disconnects and removes the temporary
secret. Edit restores the previous secret/connection if replacement fails.
Remove deletes only the Eidetic record and secret; it does not modify NAS
files and makes no secure-erase claim.

## Platform adapters

`WindowsSmbAdapter` uses `WNetAddConnection2W` with a null local name, so no
drive letter is assigned. It classifies authentication, credential conflict,
host/share missing, access, network, timeout, and generic failures. It tracks
only successful Eidetic UNC sessions and never uses `net use * /delete`.
Multiple shares on one Windows server require the same auth mode,
username, and domain.

`LinuxSmbAdapter` uses argument-array `mount -t cifs` below the private runtime
directory with `ro,nosuid,nodev,noexec`. It contains no SMB1 option,
`vers=1.0`, sudo, shell, force unmount, password argument, or interactive
prompt. Missing CIFS support and permission failures remain safe public
states. Production authorization/deployment is deferred.

## Service, auto-connect, and SSE

`SmbConnectionService` owns records, adapter operations, current roots,
availability, and one global snapshot. It auto-connects at bootstrap,
serializes work per connection ID, caps concurrent connections at two, and
uses one scheduler with 2/5/15/30/60-second transient backoff followed by at
most one attempt per minute. A significant network reconnect resets transient
backoff. Authentication, credential conflict, permission-required, and
unsupported states do not auto-retry. Manual Retry remains available.

One `SmbSseHub` and one AppShell `EventSource` feed Sources, the active browser,
and the top bar. Public snapshots contain no password, UNC root, mount point,
credential path, or helper output.

## Sources and dialogs

The Sources placeholder was replaced by a canonical Network Shares section
with Add Share, safe server/share display, status, Browse, contextual Retry,
Edit, and confirmed Remove. The Add/Edit dialog provides Name, Server, Share,
Account/Guest, Username, Password, optional Domain/Workgroup, Show/Hide,
Cancel, and Connect/Save. Existing on-screen keyboard profiles are reused;
Password is explicitly opt-in. Server/Share become read-only in Edit.

No SMB control was added to either Main Player, the drawer, Library, or the
Folders root.

## Top bar and popover

The compact interactive SMB status button is immediately before the clock:

- absent with zero configured connections;
- green only when every configured share is connected/readable;
- red when at least one share is unavailable;
- neutral while connecting without an error.

The anchored popover has a maximum of two lines, uses display name only for
detail, has no action/navigation/scroll, and closes on outside pointer input
or Escape.

## Quick Browse and Queue

`SMB / <display name>` reuses the canonical Folders browser and its list/grid,
breadcrumbs, Back, session scroll, natural sort, lazy metadata/artwork,
hidden/system filtering, symlink exclusion, direct Track play, Play Folder,
Add Track, and Add Folder behavior. It performs no recursive scan and exposes
no Favorite, Playlist, History, Most Played, Stats, or Library identity.

Queue origins store only connection ID, logical relative path, and opaque
entry identity. Public player/Queue paths use `smb://<connection-id>/...`.
Every playback resolution rechecks the connected root, logical containment,
entry type, supported extension, and readability.

The real Neutralino fixture test opened the third track in a 12-track folder:
MPV started index 2 directly, the Queue was in natural order, and no transient
index-zero playback occurred.

## Disconnect, reconnect, and Remove

SMB availability updates Queue rows in place without a structural Queue
revision. A current SMB item is stopped with `keep-playlist`; current and Queue
remain, no skip/clear occurs, and reconnect does not autoplay. Unrelated
local/USB playback is unaffected.

During native QA, confirmed Remove while an SMB fixture track was current
produced:

- player `stopped`, paused;
- Queue length still 12;
- current index still 3;
- current row unavailable;
- Queue revision still 1;
- configured SMB count 0.

## Windows Neutralino QA

The real application was launched with exactly `npm.cmd run dev`, isolated
APPDATA/LOCALAPPDATA/TEMP, `EIDETIC_SMB_FIXTURE=1`, and the user-provided USB
root as a read-only browse target. No NAS connection, drive mapping,
Credential Manager entry, host network setting, or media file was changed.

- 1280×800: **PASS**.
- 1280×720: **PASS**.
- 1024×600: **PASS after fixes**.

Verified Add Share Guest, frontend/backend validation feedback, Sources card,
green top-bar state, popover, canonical Quick Browse, breadcrumbs, metadata,
artwork, a non-first selected Track, natural Queue, mini-player, responsive
scroll, confirmed Remove, opaque public paths, disconnect Stop, and preserved
Queue/current/revision. Main Player, drawer, USB, Sources, Queue, toast, and
keyboard shared surfaces remained intact.

Two QA defects were fixed:

1. the Account dialog title could sit behind the top bar at 1024×600; its
   scrollable bounds now occupy only the area between top bar and mini-player;
2. a low Sources action menu could place Remove behind the mini-player; all
   Sources menus now flip above their trigger when needed.

Account connection, real Credential Manager content, real offline/reconnect,
red/neutral top-bar runtime states, and an actual UNC server are **NOT TESTED**.
Their state/security boundaries are covered by focused automated tests.

## Tests

PASS:

- `npm.cmd run format:check`;
- `npm.cmd run typecheck`;
- `npm.cmd run lint`;
- `npm.cmd run build`;
- `npm.cmd test`: 411 tests, 408 passed, 3 platform skips, 0 failed;
- `npm.cmd run test:posix`: 3 passed, 2 Windows platform skips, 0 failed;
- `npm.cmd run mpv:doctor`;
- `npm.cmd run test:mpv`: 7 passed, 0 failed;
- 15 focused SMB repository/credential/adapter/service/UI tests;
- real Neutralino → backend → fixture root → Folders → PlayerService → MPV
  path;
- `git diff --check`.

Focused coverage includes add/edit/remove boundaries, duplicate validation,
secret absence/cleanup, Linux modes, deviceless UNC/CIFS source audit,
SMB1/password-argv exclusion, bootstrap concurrency, backoff reset, no-retry
authentication state, one scheduler/SSE, top-bar states, canonical browser,
opaque Queue origin, player/drawer absence, and disconnect invariants.

FFmpeg doctor was not run because analyzer lifecycle was not changed.

## Cleanup and source control

The Neutralino/backend/Vite/MPV process tree was closed. No listener remained
on 4310/5173, no SMB helper/mount/UNC mapping/credential/retry timer/EventSource
remained, and the isolated profile, temporary logs, fixture probe, screenshots,
and native QA helper were removed. User media and network state were
unchanged.

No commit, push, merge, rebase, reset, restore, stash, clean, or force-push was
performed.
