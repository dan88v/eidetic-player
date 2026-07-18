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
- `WaveformService` owns at most one fast-decode waveform process.
- The frontend player store receives authoritative state; a component may keep
  only short-lived interaction state such as a seek preview.

Do not introduce a second owner for any of these concerns.

## Data channels

- REST carries discrete, validated commands.
- Player SSE carries low-frequency state and discrete changes.
- Visualizer SSE carries only the active mode's compact realtime data.
- Artwork and waveform use dedicated, opaque-ID HTTP endpoints.
- Large binary data, local paths, base64, and PCM never belong in player SSE.

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

## Cross-platform behavior

Keep OS-specific IPC endpoints, executable discovery, native file dialogs, and
display control behind adapters. Do not spread `process.platform` branches
through domain services or UI components.

MPV, FFmpeg, and native-shell absence must degrade independently:

- missing MPV disables playback but does not crash the backend;
- missing FFmpeg preserves playback and uses established visualizer/waveform
  fallbacks;
- browser fallback may display the UI but cannot pretend to provide native
  absolute file paths.
