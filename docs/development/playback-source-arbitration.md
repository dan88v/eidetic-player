# Playback source arbitration

## Scope

`PlaybackSourceArbiter` is the single authority that decides whether the local
MPV session, AirPlay, or Spotify Connect owns the selected physical audio
output. Step 3.1 introduced the contract and development fixtures. Step 3.2
adds the production AirPlay provider while preserving the same authority.

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
previous provider must stop and release before the new provider can acquire. A
new sender handled by the same single Shairport process is the narrow
exception: its new session generation replaces the old one without restarting
the daemon between the blocking pre-play request and grant.

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
maximum and confirmed by the active provider. Fixed output keeps the physical
route at unity and rejects app-side volume/mute commands. A provider may
explicitly support sender-side attenuation on that fixed route: the reported
external level then remains session-local, never boosts above unity, and never
overwrites the suspended Local level or its persisted preferences.

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

## AirPlay provider

Shairport Sync invokes the fixed `eidetic-player-airplay-hook before` command
before preparing its audio backend. The hook sends the closed `BEFORE 1`
message over the private runtime socket and blocks until the Arbiter has paused
MPV, released the device, verified the canonical ALSA or PipeWire route, and
answered `GRANT`. The maintained Shairport patch propagates a denied or failed
hook exit status back to `player_play`, so audio preparation is fail-closed.
The matching `AFTER 1` message ends the provider session.

The private metadata FIFO carries only audited Shairport metadata codes. The
bounded parser assembles fragmented items, ignores malformed or unknown items,
validates UTF-8 and artwork signatures, and publishes title, artist, album,
progress, artwork, and sender volume against the active session. Artwork is
temporary, exposed only through an opaque resource ID, and remains absent when
the sender does not supply a valid `PICT` item.

AirPlay progress is conditional rather than advertised optimistically. A valid
sender `prgr` item enables a non-seekable Line timeline; one session-scoped
250 ms timer advances it only while the provider is playing and freezes it on
buffering or flush. A metadata generation without valid progress hides the
timeline on both the local and Remote surfaces. No waveform or FFmpeg work is
started for AirPlay.

Shairport always accepts sender volume for AirPlay. Its maximum is capped at
0 dB, so an iPhone can attenuate a fixed-unity DAC but can never boost beyond
the player's 100% fixed level. This AirPlay-only level does not mutate Local
MPV volume. The generated Raspberry configuration uses the lightweight
`vernier` interpolator and a 0.5-second backend buffer to provide headroom
against ALSA underruns on the Pi 3B.

`airplay.json` stores the enabled preference and receiver name atomically. The
first install defaults to On and creates `Eidetic Player - 1A2B` using four
cryptographically random uppercase hexadecimal characters. Existing generated
two-character names migrate once; user-defined names are never replaced.
Settings exposes the current name in the AirPlay row and edits it on a
dedicated canonical subpage without adding another SSE connection.

The persistent preference, rather than systemd enablement, is authoritative.
The backend starts the disabled receiver unit only after its private runtime
and output route are ready. `systemctl reset-failed` is best-effort because it
returns non-zero when an inactive unit is not loaded and has no failure to
clear; the following `start` or `restart` remains mandatory. An activation
request publishes `starting` only while work is in flight and must terminate
in either `ready` or an explicit `error`, never an indefinite enabled/Starting
state.

The receiver unit retains Shairport's upstream `LimitRTPRIO=5` allowance. The
ALSA buffer monitor must be able to request realtime scheduling; a zero limit
produces explicit startup warnings and periodic DAC XRUN recovery even when the
receiver, network session, and source arbitration remain continuously active.

## Shutdown and deployment

Quit, restart, maintenance, power, and update preparation flush arbitration,
request a bounded provider release, stop the receiver runtime, and remove its
private FIFO/socket state. Linux deployment builds exact verified Shairport
Sync and NQPTP sources into a root-owned versioned cache, stages the integration
inside the release, and installs least-privilege user/system units.
