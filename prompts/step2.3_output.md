# Step 2.3 — Queue, real-time visualizers, and real waveform

Date: 2026-07-17

## Outcome

Step 2.3 is implemented in two verified phases. Phase A passed typecheck and
32/32 existing tests before Phase B began. The final suite passes 40/40 unit/UI
tests and 2/2 real MPV integration tests.

The Queue is reset after MPV IPC startup and again during shutdown. Opening one
file now builds the complete non-recursive parent folder in natural order,
prepares MPV in pause, selects the requested index, and only then starts
playback. Explicit multi-selection remains ordered and deduplicated.

The Queue drawer adds Add Files, Clear Queue with an accessible in-app
confirmation, and a 56 × 56 px Remove control per row. No drag reorder was
introduced. Home is first in the top bar, the clock is 25 px, the audio-device
dot is an inline-flex element, and the mini-player has a real linear seek
timeline.

The visualizer cycles Meter → Spectrum Mono → Spectrum Stereo → None → Meter.
Real frames use a separate FFmpeg sidecar and separate SSE endpoint. Waveforms
use a separate fast-decode process, return 512 real points, and retain the
deterministic fallback when FFmpeg is unavailable.

## Files

Created:

- `apps/backend/src/analysis/analysis-config.ts`
- `apps/backend/src/analysis/audio-analysis-engine.ts`
- `apps/backend/src/analysis/audio-analyzer-service.ts`
- `apps/backend/src/analysis/ffmpeg-discovery.ts`
- `apps/backend/src/analysis/pcm-stream-parser.ts`
- `apps/backend/src/analysis/visualizer-hub.ts`
- `apps/backend/src/analysis/waveform-service.ts`
- `apps/backend/test/audio-analysis.test.ts`
- `apps/backend/test/ffmpeg.integration.ts`
- `apps/backend/test/waveform.test.ts`
- `apps/ui/src/timeline/waveform-loader.ts`
- `apps/ui/src/visualizer/visualizer-stream-client.ts`
- `packages/shared/src/visualizer.ts`
- `scripts/ffmpeg-doctor.ts`
- `prompts/step2.3_output.md`

Modified:

- `.env.example`
- `README.md`
- `docs/architecture.md`
- `docs/ui.md`
- `package.json`
- `scripts/tsconfig.json`
- backend API validation, index, Queue builder, MPV controller, PlayerService,
  Queue tests and MPV integration tests
- frontend API client, app shell, Queue drawer, mini-player, timeline, top bar,
  visualizer, Settings, storage migration, renderers, styles, and localization
- generated `neutralino.config.json` and `dist/` output

No previous prompt output was overwritten.

## Queue decisions and API

- Startup sequence: stop, `playlist-clear`, clear service Queue/current track,
  index, position, duration, enrichment state, and publish idle snapshot.
- Shutdown sequence: clear MPV playlist, reset local state, stop analyzers, then
  close MPV and artwork/metadata resources.
- Volume, mute, Shuffle, and Repeat are not changed by Queue clear.
- Single file: complete first-level folder, supported readable files only,
  case-insensitive numeric natural sort, requested index selected in pause.
- Multi-file Open: explicit paths only, original order, first occurrence wins.
- Add Files: explicit paths only, append, deduplicate against the Queue, keep
  current playback.
- Remove: accepts only an opaque `queue-N` ID. Current removal chooses the next
  item, otherwise the previous; removing the last item resets playback.
- Implemented POST endpoints:
  - `/api/player/queue/append`
  - `/api/player/queue/remove`
  - `/api/player/queue/clear`
- Waveform endpoint:
  - `GET /api/player/queue/:queueItemId/waveform`
- Analysis stream:
  - `GET /api/visualizer/events`

## Visualizer geometry and modes

The previous loaded-track flex slot was approximately 328 px at 1280 × 800.
The centralized replacement token is 164 px, exactly half. Browser geometry
checks after the initial 144 px calibration confirmed the measurement method;
the final token preserves the same bottom anchoring and fixed height across
modes.

At 1280 × 800:

- Home/Hamburger order: correct
- clock: 25 px
- device dot/text center difference: 0 px
- visualizer/artwork bottom difference: 0 px
- meter bar: 16 px; L/R gap remains 10 px
- Mono Spectrum: 32 bands
- Stereo Spectrum: 16 + 16, low frequencies adjacent to center
- mode cycle: `meter`, `spectrumMono`, `spectrumStereo`, `none`, `meter`
- None: empty Canvas and closed EventSource

Metadata at the primary viewport uses a 44–48 px title, 29 px artist, 23 px
album, 18 px technical row, and 12/8/18 px vertical gaps.

Responsive headless checks at 1280 × 800, 1366 × 768, 1600 × 900, 1280 × 720,
and 1024 × 600 found no horizontal overflow, 0 px bottom difference, 0 px
device-center difference, and stable 16 px meter bars.

## Analyzer configuration

- discovery order: `EIDETIC_FFMPEG_PATH`, FFmpeg beside the discovered MPV
  executable, then `ffmpeg` in `PATH`
- verification: `ffmpeg -version`
- stereo float32 little-endian PCM
- sample rate: 24,000 Hz
- channels: 2
- FFT: internal radix-2, 1,024 samples
- hop: 512 samples
- Hann window
- maximum broadcast rate: approximately 20 frames/s
- logarithmic bands with −72 dB floor
- meter window: approximately 50 ms
- fast attack and 0.82 release retention
- drift restart threshold: 300 ms; checks and restarts are rate-limited
- one real-time analyzer process shared by all SSE subscribers
- representative compact visualizer JSON payload: 444 bytes

The analyzer starts only for a playing local track with a subscriber and stops
on pause, stop, clear, track change, seek/resync, last disconnect, or shutdown.
The frontend only subscribes while Now Playing exists and the mode is not None.
A final zero frame clears paused/stopped graphics. The values are pre-volume MPV
source data and never alter playback.

Configuration switches:

- `EIDETIC_ANALYZER_ENABLED=false`
- `EIDETIC_WAVEFORM_PRELOAD_NEXT=false`

## FFmpeg status

FFmpeg was not installed or discoverable in this environment.

- `ffmpeg:doctor`: failed with exit code 1 and the expected clear diagnostic
- FFmpeg integration: skipped explicitly as unavailable
- fallback playback/UI: verified through backend and Neutralino startup
- discovered FFmpeg version: unavailable

No FFmpeg binary was downloaded or added to the repository. A real CPU/memory
profile for Meter, Mono Spectrum, Stereo Spectrum, and waveform generation
could therefore not be produced here.

## Waveform and cache

- FFmpeg mono s16le decode at 8,000 Hz, without `-re`
- incremental absolute-peak aggregation; PCM is never retained in full
- adaptive compaction keeps memory bounded for long tracks
- exactly 512 finite normalized points
- robust 95th-percentile reference with square-root shaping
- session LRU: maximum 64 waveforms
- opaque SHA-256 fingerprint of canonical path, size, and mtime
- ETag/304 and request Abort support
- maximum one waveform child
- current track first, optional next-track preload second
- frontend AbortController and generation/Queue-ID guards reject stale results
- deterministic waveform remains on missing FFmpeg or any generation failure

## Tests and verification

- `npm audit`: passed, 0 vulnerabilities
- `format:check`: passed
- `typecheck`: passed
- `lint`: passed
- `build`: passed
- unit/UI suite: 40/40 passed
- MPV doctor: passed with
  `mpv v0.41.0-744-g304426c39`
- MPV integration: 2/2 passed
- FFmpeg doctor: expected failure because FFmpeg is unavailable
- FFmpeg integration: explicit skip because FFmpeg is unavailable
- Neutralino development startup: backend/frontend ready and shell launch
  reached; fallback diagnostic was logged once

Analysis tests cover partial PCM chunks, interleaved float32, peak/RMS channel
differences, silence/zero frame, clamp/finite values, Hann endpoints, a known
FFT tone, 32 mono bands, 16+16 stereo bands, waveform silence/impulse/long
input, exact bucket count, robust normalization, and deterministic output.

Queue integration covers empty startup, whole-folder expansion, selected index,
Previous to an earlier file, append deduplication, current removal, clear, and
shutdown cleanup. Command validation rejects arbitrary paths for Remove.

## Build and cleanup

Production frontend:

- JavaScript: 60.77 kB raw, 17.98 kB gzip
- CSS: 29.88 kB raw, 5.75 kB gzip
- HTML: 0.43 kB raw, 0.27 kB gzip

Neutralino, backend, Vite, Edge headless, MPV, and their child processes were
closed after verification. The temporary browser profile and measurement
helpers were removed. Final process inspection found no project MPV, FFmpeg,
Neutralino, Vite, or backend process.

## Limits

- Real FFmpeg frames and waveform decode could not be exercised on this host
  because FFmpeg is absent; the integration test is ready and will run when it
  becomes discoverable.
- CPU and memory performance on Raspberry Pi 3B remain unverified and no
  compatibility claim is made.
- Hands-on physical touch behavior was verified structurally and through
  headless pointer/geometry paths, not on the final 8-inch touch panel.
- No library/database, indexing, SMB, USB discovery, AirPlay, Spotify Connect,
  drag reorder, equalizer, audio DSP, or online download was introduced.
