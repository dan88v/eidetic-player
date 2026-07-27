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

`beforePlayback` audio preparation is started without blocking Play or
navigation. Play and Pause use explicit `set_property pause` targets; they
never depend on `cycle pause`.

## UI and persistence

`PlayerStore` keeps the last authoritative SSE state separately from its
optimistic view. The volume popover protects its local preview while pointer
capture is active, continues sending bounded live commands, sends the final
value on release, and restores the confirmed value on cancellation.

Only confirmed user volume/mute intents are offered to the preferences
controller. Shuffle and repeat are persisted only after their user command
succeeds. Ordinary MPV snapshots are telemetry and are not persisted.

## Diagnostics

Development and tests retain bounded, sanitized rings for UI and backend
stages. They contain command kind, generations, session/intent identity,
monotonic time, and lifecycle stage only. They contain no media paths,
metadata, credentials, usernames, or device identifiers, create no public
endpoint, and add no timer beyond active intent timeouts.
