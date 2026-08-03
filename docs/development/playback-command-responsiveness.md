# Playback command responsiveness

Playback controls use an intent protocol across the UI, REST client,
`PlayerService`, MPV JSON IPC, observed MPV properties, SSE, and `PlayerStore`.
This protocol keeps controls responsive while a track or audio output is
transitioning without restarting MPV or rebuilding the Queue.

## Intent identity and ownership

The UI creates one random client-session ID and one monotonically increasing
intent ID. The backend adds a service generation and retains the latest intent
for each command class:

- level: volume and mute;
- transport state: explicit paused or playing target;
- navigation: stable Queue item ID.

States are `pending`, `acknowledged`, `confirmed`, `failed`, or `superseded`.
Only the latest intent in the same client session may affect public state,
failure handling, or UI rollback. Stable Queue IDs accompany rapid
Next/Previous and Queue-selection requests, so HTTP arrival order and Queue
reorder cannot change the requested target.

## Confirmation rules

Volume, mute, and pause publish their target immediately. MPV IPC
acknowledgement proves command acceptance; a matching observed property or
focused `get_property` confirms the value. Volume confirmation uses a narrow
rounding tolerance. Different telemetry received while a newer intent is
pending is recorded as stale and cannot update UI or persistence.

Navigation is acknowledged when MPV accepts `playlist-pos`; media loading is a
separate transition. A slow SMB `file-loaded` therefore does not turn an
accepted navigation command into a false failure.

Browser-History Previous stages only the selected prior occurrence at the
front of MPV's bounded technical playlist and then selects it with
`playlist-pos`. It must not replace and rebuild the entire Current-plus-future
playlist just to move one step backwards. Forward History remains in place and
continues to win over Explicit Queue and Context. While any available forward
History remains, the public Context summary is hidden because its nominal next
item is not the next item navigation will actually select.

Property confirmation is bounded to two seconds. Failure or timeout rolls
volume, mute, and transport back to the last confirmed value and increments
one failure revision. There is no retry loop. Pending level commands are
reapplied at most once when the same MPV instance changes `audio-device` or
`current-ao`.

## Transition and IPC ordering

Each property refresh captures both a refresh generation and transition
generation. It applies only if both remain current and the property has not
received a newer observed value. Interactive IPC is sent immediately on the
single MPV connection. Read-only background refresh has a bounded two-request
lane, and queued reads cannot hold up an interactive command.

One MPV `start-file` owns one transition generation and carries MPV's stable
`playlist_entry_id`. Every observed playlist row exposes the matching numeric
`id`; `PlayerService` binds that ID to one planner execution occurrence. The
mapping survives prefix removal, reindexing, and duplicate native paths, and
is cleared when the MPV core or exact playlist is replaced.

The audible item is resolved from `playlist-playing-pos` or the unique
`playing` row whose path matches MPV's observed `path`. `playlist-pos` and the
`current` marker are only validated fallbacks because MPV may already point
them at the next selected item while the previous item is still audible. A
scalar index is never accepted when its playlist path disagrees.

A transition refresh is committed transactionally. Failed property reads do
not overwrite the last good cache, and Current is not published until path,
playlist, duration, position, idle state, the audible playlist row, its MPV
ID, and planner Current describe one occurrence. Property events arriving
during an in-flight refresh request at most one coalesced follow-up pass. There
is no polling or retry timer; the existing MPV event stream drives recovery,
and settling never depends on a later unrelated Pause, Play, or Next command.

When planner Current changes before that observation is complete, the previous
public playback projection remains frozen. REST and SSE therefore expose one
coherent old frame followed by one coherent new frame, never a new
`currentPlayback` paired with a null or old `currentTrack`. State derivation is
also fail-closed: an unresolved playlist index or execution-ID repair cannot
mutate Queue identities, increment the track transition, or publish a partial
frame.

Metadata and artwork enrichment may finish while technical reconciliation
removes consumed playlist prefixes. Adjacent preload results retain only their
path-scoped enrichment data across awaits and merge it into the current Queue
at commit time. They must never write back a previously captured Queue array or
resurrect rows removed by MPV reconciliation.

Natural EOF is the sole owner of automatic planner advance. Its queued work is
tied to the ended MPV entry and becomes a no-op if a newer manual Current has
already won. `file-loaded` captures the latest `start-file` token and may only
confirm the expected planner target and reconcile its future; it never infers
another planner advance. A stale callback therefore cannot clear a newer
navigation target or publish an unrelated track.

`beforePlayback` audio preparation is started without blocking Play or
navigation. Play and Pause use explicit `set_property pause` targets; they
never depend on `cycle pause`.

## UI and persistence

`PlayerStore` keeps the last authoritative SSE state separately from its
optimistic view. The volume popover protects its local preview while pointer
capture is active, continues sending bounded live commands, sends the final
value on release, and restores the confirmed value on cancellation.

The UI transition coordinator may recover an active same-generation snapshot
whose public Current was temporarily missing when the matching authoritative
Current arrives at the same public revision. That exception applies only from
`null` to a non-null `currentPlayback`; equal-revision swaps between two tracks
and attempts to revive `idle`, `stopped`, `unavailable`, or `error` snapshots
remain stale and are rejected.

Only confirmed user volume/mute intents are offered to the preferences
controller. Shuffle and repeat are persisted only after their user command
succeeds. Ordinary MPV snapshots are telemetry and are not persisted.

## Diagnostics

Development and tests retain bounded, sanitized rings for UI and backend
stages. They contain command kind, generations, session/intent identity,
monotonic time, and lifecycle stage only. They contain no media paths,
metadata, credentials, usernames, or device identifiers, create no public
endpoint, and add no timer beyond active intent timeouts.
