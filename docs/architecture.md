# Architecture

Step 2.3 keeps the established runtime boundaries:

```text
Neutralino PlatformBridge ── full local paths ──> Vanilla TypeScript UI
                                                    │ REST commands
                                                    │ SSE state
                                                    ▼
                                              Node PlayerService
                                                    │ JSON IPC
                                                    ▼
                                              persistent MPV

              Now Playing Canvas <── separate SSE ── VisualizerHub
                                                       │ shared PCM frames
                                                       ▼
                                                FFmpeg sidecar
```

Neutralino owns only the multi-file native dialog and native dropped-file
events. Components depend on `PlatformBridge`; they do not import Neutralino.
The Neutralino adapter is the sole native API boundary, while the browser
adapter is an explicit development fallback without access to absolute paths.

## Backend and MPV

Discovery checks `EIDETIC_MPV_PATH` first and then `mpv` in `PATH`. Every
candidate must successfully execute `--version`. MPV runs once in idle,
headless, audio-only mode with user configuration, terminal, OSC, OSD, video,
and audio cover display disabled. It uses the system's default audio output.

`mpv-endpoint.ts` creates a unique Windows named pipe or a temporary Unix domain
socket and owns socket cleanup. `mpv-process.ts` owns the child process.
`mpv-transport.ts` uses Node `net` and owns incremental request IDs, response
matching, timeouts, pending-request rejection, and event dispatch.
`json-line-parser.ts` handles partial chunks and multiple newline-delimited JSON
messages per chunk. `mpv-controller.ts` exposes commands and property
observation without shell string construction.

`PlayerService` is the sole owner of session queue, playback state, real
metadata, shuffle restoration, repeat configuration, and the controller. It
coalesces `time-pos` to approximately five state updates per second, while
discrete changes publish immediately. An unexpected MPV exit rejects transport
requests, moves state to error, and permits at most one controlled idle restart.
Startup and shutdown both stop playback and clear MPV's playlist. Shutdown
closes both SSE hubs, analyzer and waveform children, requests MPV quit, waits
briefly, force-stops only as a
fallback, closes IPC, and removes a Unix socket.

## Metadata and artwork

`MetadataService` uses `music-metadata` and keeps an LRU session cache of 128
normalized records keyed by canonical path, size, and modification time.
Picture buffers exist only during immediate artwork resolution and are never
retained in the metadata cache.

`ArtworkService` validates JPEG, PNG, and WebP signatures and rejects images
over 15 MiB. Priority is embedded front/cover/first valid image, then
case-insensitive `cover`, `folder`, and `front` names in the audio file's own
directory. Its opaque registry is limited to 64 records and 128 MiB. Embedded
data is written under
`<os.tmpdir()>/eidetic-player-artwork-<pid>-<session-id>/`; eviction and shutdown
remove only internally generated files. Original folder artwork is never
deleted.

PlayerService publishes MPV state immediately, applies parser results only when
the generation and path still match, and emits a later SSE snapshot containing
small normalized fields and `ArtworkRef`. Parsing is serialized separately for
the current track and one next-track preload. Queue artwork resolution is lazy
and limited to two concurrent requests.

## HTTP boundary

Commands use validated JSON POST endpoints:

- `/api/player/open`
- `/api/player/play-pause`, `/play`, `/pause`, `/previous`, `/next`
- `/api/player/seek`, `/volume`, `/mute`, `/shuffle`, `/repeat`
- `/api/player/queue/play`
- `/api/player/queue/append`, `/remove`, `/clear`
- `GET /api/visualizer/events`
- `GET /api/player/queue/:queueItemId/waveform`
- `GET|HEAD /api/artwork/:opaqueId`
- `GET|HEAD /api/player/queue/:queueItemId/artwork`

`GET /api/player/state` returns a full snapshot. `GET /api/player/events` is an
SSE stream that sends an immediate snapshot, subsequent state, and a lightweight
keepalive. One hub subscription broadcasts to all clients and removes them on
disconnect. Development uses the Vite `/api` proxy. Production cross-origin
access is limited to exact loopback origins, never a wildcard.

Artwork responses set the validated content type and length, `nosniff`, private
immutable caching, and ETag, including `If-None-Match`/304 support. Client paths
and image data never appear in artwork URLs or SSE references. Unknown IDs and
traversal-like inputs return 404.

Shared contracts in `packages/shared` define `PlayerState`, queue and track
shapes, status/repeat types, API envelopes, and supported extensions. The UI has
one API client and one player store; components never issue raw `fetch` calls.

## Queue and persistence

The backend validates extension, existence, file type, and readability. A
single file expands the complete non-recursive parent folder in natural order.
MPV prepares it paused and then selects the requested index before play. A
multi-selection keeps only validated explicit paths in input order and removes
duplicates. Append never expands a one-file selection. Removal accepts only an
opaque Queue ID.

Only volume, mute, shuffle, repeat mode, animations, visualizer mode, and
timeline style persist in browser storage. The queue and media session start
empty on every launch.

## FFmpeg analysis boundary

`FfmpegDiscovery` checks `EIDETIC_FFMPEG_PATH`, an executable beside configured
MPV, then `ffmpeg` in `PATH`, verifying `-version`. `AudioAnalyzerService` owns
at most one realtime child. `PcmStreamParser` joins partial float32 chunks and
`AudioAnalysisEngine` applies a Hann window, internal radix-2 FFT, logarithmic
bands, peak/RMS and attack/release. `VisualizerHub` broadcasts at most about
20 frames/s to all clients without adding frames to `PlayerState`.

`WaveformService` owns at most one independent fast-decode child and compacts
mono s16 PCM incrementally. Its 64-entry session LRU returns 512 numeric points
through opaque Queue IDs with ETag support. Both services fail independently of
MPV and leave the deterministic frontend fallback intact.
