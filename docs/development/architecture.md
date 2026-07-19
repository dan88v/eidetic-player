# Architecture guidelines

## Runtime boundaries

Keep these responsibilities separate:

```text
Neutralino shell
  native file dialogs and native drop events only
          │
          ▼
PlatformBridge
          │
          ▼
Vanilla TypeScript UI ── REST commands ──► Node backend
          ▲                                  │
          └──── player-state SSE ────────────┤
                                             ▼
                                      PlayerService
                                             │ JSON IPC
                                             ▼
                                         MPV process

Now Playing Canvas ◄── visualizer SSE ── VisualizerHub
                                             │ PCM
                                             ▼
                                  optional FFmpeg sidecar
```

The shell contains no playback or domain logic. UI components do not know
whether the platform implementation is Neutralino, a browser fallback, or a
future Raspberry shell.

## Ownership

- `PlayerService` owns the playback session, Queue, current track, transport
  state, MPV commands, and authoritative state publication.
- MPV owns decoding, playback position, pause, playlist behavior, volume, mute,
  repeat, shuffle, and the selected audio output.
- `MetadataService` enriches tracks asynchronously and must not delay playback.
- `ArtworkService` validates, registers, caches, streams, and cleans artwork.
- `AudioAnalyzerService` owns at most one realtime FFmpeg process.
- `AudioAnalysisEngine` derives peak, spectrum, and 3-second K-weighted
  short-term loudness from that same PCM stream. Technical mode is a transport
  and presentation mode, not a second analyzer.
- `WaveformService` owns at most one fast-decode waveform process.
- The frontend player store receives authoritative state; a component may keep
  only short-lived interaction state such as a seek preview.
- `SourceService` owns persistent source identity, display name, and
  availability. `DirectoryBrowserService` owns one-level listings and its
  bounded cache; `FolderArtworkPreviewService` owns bounded direct-child folder
  previews; `PathService` is the only logical/native path authority.
- `IndexedLibraryService` owns the durable SQLite catalog and publishes
  low-frequency Library snapshots. `LibraryScheduler` owns the single active
  scan, while `LibraryScanner` owns recursive traversal and incremental
  metadata ingestion. Folders browsing remains an independent on-demand path.

Do not introduce a second owner for any of these concerns.

## Data channels

- REST carries discrete, validated commands.
- Player SSE carries low-frequency state and discrete changes.
- Visualizer SSE carries only the active mode's compact realtime data.
- Every visualizer frame carries player session, track, transition generation,
  sample-rate, and mode identity; the UI rejects any mismatched frame.
- Artwork and waveform use dedicated, opaque-ID HTTP endpoints.
- Large binary data, local paths, base64, and PCM never belong in player SSE.
- Folders responses use opaque IDs and logical relative paths. Absolute roots
  remain backend-only after the native Add Source command.
- Library REST/SSE carries only opaque Source/Track identity, aggregate counts,
  progress, and safe error codes. Database paths and native roots remain
  backend-only.

Components use central API clients. Shared request, response, state, and event
types live in `packages/shared`.

## Update granularity

Treat the UI as several independent update regions:

- playback position updates timeline and counters only;
- visualizer frames update the active Canvas only;
- volume updates its button/popover only;
- current-track changes update metadata, artwork, active Queue row, and relevant
  transport state;
- Queue structure changes reconcile Queue rows by stable ID;
- settings changes update the affected component only.

Do not rebuild `AppShell`, Now Playing, Queue, or the full mini-player for a
single-field update.

Library scan events update only counters, status text, progress, and action
state in the already mounted Library screen. They must not rebuild Queue,
Now Playing, Sources cards, or the screen shell.

## Async correctness

Every async result that can outlive its target must be guarded:

- metadata parsing uses track/generation identity;
- artwork uses queue/track identity plus generation identity;
- old requests are aborted when possible and ignored otherwise;
- replacing a Queue invalidates observers and requests associated with the old
  Queue;
- reconnecting SSE must not duplicate subscriptions or native listeners.

Correct content with a placeholder is preferable to stale content that looks
complete.

## Bootstrap and player-session ownership

The backend owns the durable player session. `PlayerSessionService` observes
structural Queue/current-item changes, debounces atomic repository writes, and
stores either a Folders source ID plus logical relative path or a backend-only
direct native path. Position and play state are deliberately not persisted.

`GET /api/bootstrap` completes only after MPV discovery/startup and session
restore. The UI keeps the static splash visible until this endpoint completes,
subject to the minimum display interval and safety timeout, then mounts the
shell once with the returned state. A restored Queue always starts paused at
the beginning of its saved current item.

## Cross-platform behavior

Keep OS-specific IPC endpoints, executable discovery, native file dialogs, and
display control behind adapters. Do not spread `process.platform` branches
through domain services or UI components.

Linux config, cache, data, and runtime roots are resolved centrally according
to XDG. Persistent Sources and player-session state belong to config,
regenerable artwork belongs to cache, the SQLite Library belongs to data, and
MPV Unix sockets belong to a private runtime directory. Windows keeps its
APPDATA/LOCALAPPDATA and named-pipe adapters.

MPV, FFmpeg, and native-shell absence must degrade independently:

- missing MPV disables playback but does not crash the backend;
- missing FFmpeg preserves playback and uses established visualizer/waveform
  fallbacks;
- browser fallback may display the UI but cannot pretend to provide native
  absolute file paths.
