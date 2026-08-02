# Playback source arbitration

## Scope

`PlaybackSourceArbiter` is the single authority that decides whether the local
MPV session, AirPlay, or Spotify Connect owns the selected physical audio
output. Step 3.1 provides the contract and development-only in-process fixture
providers. It does not install or start a real external playback service.

The fixtures exist only when `EIDETIC_EXTERNAL_PLAYBACK_FIXTURE=1` is set in a
non-production process. Their control routes are loopback-only and are absent
from an ordinary production router.

## Ownership boundaries

- `PlayerService` and Player Session v3 remain authoritative for local Current,
  Playback Context, Explicit Queue, History, position, shuffle, and repeat.
- `LocalPlaybackAdapter` captures only a minimal suspension token, flushes the
  Player Session, and asks the existing persistent MPV instance to release or
  restore its output.
- `PlaybackSourceArbiter` serializes ownership transitions, command routing,
  rollback, global level reconciliation, and startup reconciliation.
- `ExternalPlaybackProvider` isolates provider-specific control and events.
- `PlaybackArbitrationStore` persists only transition identity and recovery
  data. It never persists metadata, artwork, paths, or credentials.
- `ActivePlaybackPresentation` combines the local player read model or the
  external source snapshot for presentation without copying external metadata
  into `PlayerState`.

The backend publishes a named `playback-source` event on the existing local SSE
connection and the existing multiplexed Remote SSE connection. No polling or
second `EventSource` is used.

## MPV release and restore

An external acquisition flushes Player Session, captures the local occurrence
and position, confirms MPV pause, then sends `stop keep-playlist`. Release is
accepted only after MPV reports `idle-active=true` and no `current-ao`. This
keeps the one persistent MPV process alive while releasing the audio device.

Restore prepares the same selected output, rebuilds the captured current item,
seeks to the captured position, reapplies volume, mute, and the local MPV DSP
chain, and leaves playback paused unless an allowed resume policy applies. A
failed initial or replacement acquisition rolls back to this preserved local
session; it never starts a second player.

## Transition rules

Transitions are serialized and carry a monotonic generation. A paused external
provider retains ownership indefinitely. A local Play/context/Queue-Play intent
preempts the external provider, while add, reorder, remove, and clear operations
on the local Explicit Queue do not. For external-to-external replacement, the
previous provider must stop and release before the new provider can acquire.

The end preference is `keep-paused` by default. `resume-interrupted` resumes
only when local playback was genuinely playing before suspension and no newer
local intent invalidated the token. Provider crashes follow the same bounded
release path; a release failure remains an explicit recoverable error and does
not activate another owner.

Startup probes registered providers with bounded calls. Zero active providers
normalizes to Local. One is adopted through the normal acquisition transaction.
Multiple active providers are stopped and released before MPV is restored
paused, and the state records `MULTIPLE_EXTERNAL_SOURCES`.

## Audio and presentation policy

All providers must accept the explicitly selected physical output; there is no
silent System-default fallback. Global volume is clamped to the configured
maximum and confirmed by the active provider. Fixed output is always 100% with
mute disabled.

EQ and DSP remain local to MPV. External sources do not start FFmpeg and cannot
show the local analyzer or visualizer. Their Now Playing surface shows provider
artwork and metadata, the exact source heading, a non-interactive white source
icon in the Favorite slot, capability-driven transport, and an icon control in
the Volume slot for returning to local playback. Technical Source, DSP, Output,
and Level rows are intentionally omitted from this surface; Signal Path and the
Remote administrative presentation retain the DSP-boundary information.

External artwork crosses the API only through a bounded opaque ID. The backend
validates the MIME type, size, and image signature and never exposes a provider
URL or native path. External metadata never updates Library, Favorites,
Recently Played, Most Played, or play counts.

External `playing` and `buffering` inhibit display dim and standby. External
`paused` retains audio ownership but participates in the normal idle countdown.

## Shutdown and deployment

Quit, restart, maintenance, power, and update preparation flush arbitration and
request a bounded provider release. Step 3.1 is a local arbitration core only:
Raspberry Pi production remains Local-only until later provider integration
steps.
