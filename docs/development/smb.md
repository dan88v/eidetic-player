# SMB connections and Quick Browse

## Ownership and scope

`SmbConnectionService` is the single owner of configured shares, connection
state, bounded reconnect scheduling, current backend roots, and the global SMB
snapshot. `SmbConnectionRepository` stores only non-secret records.
`SmbCredentialStore` owns secrets, and `SmbPlatformAdapter` owns the operating
system connection. One global SSE stream is consumed by `AppShell`; there is
no stream, timer, or frontend poll per share.

Step 2.13 is deliberately browse-only. SMB records are not Library Sources,
are not scanned or indexed, and do not appear in the Folders root. Sources is
the only configuration surface. Quick Browse is reached from a connected
Sources card and reuses the canonical Folders browser.

## Records and credentials

The JSON record contains an opaque `smb-*` ID, display name, normalized
server/share, authentication mode, optional username/domain, an opaque
credential reference, and timestamps. Server and share are immutable after
creation. Passwords never enter the record, SQLite, frontend state, SSE,
localStorage, command lines, logs, or reports.

Windows secrets use the current user's Credential Manager under a backend-only
target derived from the connection ID. Windows establishes a deviceless UNC
session with `WNetAddConnection2`; it assigns no drive letter and cancels only
the UNC connection managed by Eidetic.

Linux secrets use a separate backend-only credential file with an atomic write
and mode `0600` inside a private `0700` directory. The CIFS adapter mounts below
the application runtime directory with `ro,nosuid,nodev,noexec`. Passwords are
not arguments. The backend never invokes sudo or prompts in a terminal.
Production mount authorization and Raspberry Pi hardware validation remain
Step 2.13.2.

Guest is always explicit. There is no automatic Guest fallback, SMB1 option,
`vers=1.0`, signing downgrade, discovery, or protocol selector.

## Validation and lifecycle

Both UI and backend validate names, hostname/FQDN/IPv4 server values, a single
share name, authentication fields, lengths, null bytes, and control
characters. Display-name comparison normalizes whitespace and case.
Server/share duplicates are rejected. On Windows, shares on one server must
use the same account/Guest identity; Eidetic never removes another
application's mapping to resolve a conflict.

The first Add is persisted only after the operating-system connection and root
readability check succeed. Any failed attempt removes its temporary secret and
managed connection. Edit tests the proposed identity first and preserves the
old record on failure. Remove disconnects the managed session, removes the
record and Eidetic secret, and never changes files on the server.

Configured shares auto-connect during bootstrap. Transient errors use one
bounded scheduler with delays of 2, 5, 15, 30, and 60 seconds, then at most one
attempt per minute. At most two connections run concurrently, and operations
for one connection ID are serialized. Authentication, credential-conflict,
permission-required, and unsupported states do not auto-retry. A meaningful
network reconnection resets transient backoff; Retry remains available in
Sources.

## Browse, Queue, and disconnect

Quick Browse performs only one-level, read-only directory work. The shared
Folders implementation supplies natural sorting, breadcrumbs, list/grid,
lazy metadata/artwork, hidden/system filtering, and symlink exclusion.
Available actions are Play, Play Folder, Add Track to Queue, and Add Folder to
Queue. Favorite, Playlist, History, Most Played, Stats, and Library identity
are absent.

Queue origins contain only connection ID, logical relative path, and opaque
entry identity. Public paths use `smb://<connection-id>/...`; UNC roots and
Linux mount points remain backend-only and are resolved and contained again
before playback.

When a share becomes unavailable, its browser work is invalidated and its
Queue rows are updated in place without a structural Queue revision. If the
current item belongs to that share, playback stops with the playlist kept.
The current item and Queue remain, no skip occurs, and reconnect never
autoplays. Local and USB playback continue when an unrelated SMB share fails.

## Status UI

The top-bar SMB button is absent when no share is configured. It is green only
when every configured share is connected/readable, red when any share is
unavailable, and neutral while connections are still in progress without an
error. Its anchored popover contains at most a summary and one display-name
detail line, has no actions, and closes on outside pointer input or Escape.

Step 2.13.1 will add explicit SMB Library integration. Step 2.13.2 will add the
production Linux/Raspberry Pi mount authorization and real hardware
validation.
