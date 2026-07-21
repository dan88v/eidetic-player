# Performance and realtime guidelines

## Target budget

Design for Raspberry Pi 3B even while developing on a faster Windows PC.
Smoothness on the PC is necessary but not proof of target performance.

Prefer:

- small bundles and no unnecessary runtime dependencies;
- bounded caches and concurrency;
- incremental DOM updates;
- fixed-size, reused buffers;
- limited event frequency;
- work that stops when not visible or needed.

Any new high-frequency feature must include measurements, a lifecycle, resource
limits, and a fallback.

The opt-in `EIDETIC_ANALYZER_PROFILE=rpi3` profile is the conservative
Raspberry Pi 3 preparation: 16 kHz analyzer input and at most 15 output frames
per second. Desktop remains 24 kHz/20 frames per second. Never infer the
profile from fragile hardware strings; tune additional bounds only from real
Pi measurements.

## Rendering

High-frequency data must not enter the global application store.

The visualizer path is:

1. receive a compact timestamped frame into a 24-frame bounded buffer;
2. select the newest non-future frame against extrapolated MPV position after
   subtracting its bounded runtime `audio-buffer`, with a documented 50 ms
   scheduling tolerance;
3. retain only that frame's newest target values;
4. draw from one `requestAnimationFrame` loop owned by the active visualizer;
5. reuse arrays and computed geometry;
6. cancel the loop on teardown.

Rules for the hot path:

- no `map`, `filter`, spread, nested object creation, or DOM reconstruction per
  frame;
- no `getBoundingClientRect`, computed style, gradient creation, or Canvas
  backing-store resize per frame;
- no Queue, metadata, artwork, or player-state updates from visualizer frames;
- peak ballistics, peak hold, and Technical rendering reuse the same active
  animation-frame loop; never add a meter-specific timer or loop;
- drop stale identity/generation frames instead of building a backlog;
- freeze the position anchor on pause and clear incompatible frames on seeks or
  track changes;
- cap UI rendering and analyzer output independently;
- cap device-pixel ratio when higher resolution has no visible benefit.

Mode `none` must close the visualizer EventSource, stop analysis when no other
subscriber exists, and cancel rendering.

## SSE and events

- Maintain one player-state subscription per application.
- Maintain at most one visualizer EventSource for active Now Playing.
- A single backend analyzer is shared by all visualizer clients.
- Meter, spectrum, and Technical modes consume the same analyzer PCM. The
  LUFS-S path uses a preallocated 3-second stereo energy ring and fixed filter
  state; it must not allocate per sample.
- Coalesce playback position to the established modest frequency.
- Send discrete state changes immediately.
- Keep visualizer payloads mode-specific and compact.
- Do not serialize the Queue or full state for each visualizer/position frame.
- Dispose disconnected clients and all component subscriptions.

Instrument connection count in development when diagnosing stutter.

## Queue

Position, volume, visualizer, and unrelated metadata ticks must not rebuild the
Queue. Use stable Queue IDs and a structural revision. Reconcile only additions,
removals, order changes, active-row state, and row-specific metadata/artwork.

During a stable 30-second playback interval, normal position ticks should cause
zero complete Queue rebuilds.

## MPV and FFmpeg

- MPV is a single persistent, headless playback process.
- Never decode playback audio in Node.
- Realtime analysis uses at most one FFmpeg process.
- Waveform extraction uses at most one separate FFmpeg process.
- Spawn with argument arrays and no shell interpolation.
- Analyzer restart is reserved for a real lifecycle event: file change,
  completed seek, resume, meaningful drift, subscriber return, or recovery.
- Normal position ticks, artwork, Queue opening, volume, and repaint must not
  restart analysis.
- Apply restart cooldown and prevent restart loops.
- Missing or failed FFmpeg must not interrupt MPV.

## Caches and concurrency

Use bounded session caches with invalidation based on canonical path, file size,
and modification time. Respect the established limits unless measurements
justify a deliberate change.

- metadata: bounded LRU, no retained artwork buffers;
- artwork: bounded items and bytes, safe temporary-file cleanup;
- Queue artwork: limited concurrent resolution;
- waveform: bounded numeric arrays and one generation process;
- current-track work has priority over next-track preload.

Do not add a cache dependency for simple bounded LRU behavior.
Transient parser, artwork-resolution, load, decode, and abort failures must not
be retained as negative cache entries. Retry only the affected entry and leave
valid positive cache records intact.
Metadata cache entries remember whether embedded artwork existed without
retaining its bytes. If a bounded artwork-registry record has been evicted,
only that file is reparsed to reconstruct the embedded image.
Normal backend shutdown removes both player and Folders artwork registries.
Development shutdown must request that graceful path before terminating the
watch runner. Startup removes only correctly named artwork directories owned
by dead process IDs.

Folders browsing adds a bounded 32-directory session LRU. A miss performs one
non-recursive `readdir` plus immediate-child `lstat`; a hit checks directory
modification identity. Responses retain no artwork buffers. UI/backend metadata
work and artwork resolution each have independent limits of two. Navigation
starts no recursive traversal, watcher, poll, worker, or EventSource.

The indexed Library is the sole intentional recursive path. It has one
scheduler, one scanner, one SQLite connection, serialized metadata parsing,
and bounded transactions of 32 Tracks on desktop or 16 in the Raspberry
profile. It yields after each batch and directory, and it waits for playback
transition enrichment before starting lower-priority metadata work. One
low-frequency Library SSE subscription remains app-lifetime so background scan
state can feed the global keyed notification; it is not a visualizer or
position channel. Toast rendering coalesces snapshots to at most four visual
updates per second and applies terminal states immediately.

Entity browsing uses deterministic keyset pagination, never SQL offsets.
Default pages contain 48 items, requests are capped at 100, and the UI retains
at most 192 rows/cards. There is one load-more sentinel at a time. Artwork is
lazy, occupies reserved geometry, and becomes visible only after decode through
the existing artwork service. Play/Add context path checks use eight bounded
workers; they create no scanner, observer, timer, SSE connection, or artwork
pipeline.

Incremental identity is `(sourceId, logicalRelativePath, size, mtime)`.
Unchanged files must cause zero metadata parses. A cancelled, failed, partial,
or unavailable traversal must not run the missing-file availability update.
Do not add a watcher or polling loop in place of explicit scans.

Folder previews are visibility-driven by one Folders `IntersectionObserver`.
The backend admits at most two preview jobs, samples the first eight naturally
sorted direct audio files, stops after four unique covers, and caches 32
revision-keyed results. The List/Grid toggle only changes a root data attribute.

Track-transition preload is deliberately bounded to three identities:

1. current metadata/artwork;
2. next metadata/artwork/waveform;
3. previous metadata/artwork, plus its waveform only when already cached.

Changing the Queue or presentation generation aborts in-flight UI waveform
requests and makes all late results inapplicable. Rapid Previous/Next commands
keep only the latest target identity; they do not disable controls or create
additional fades, timers, EventSource connections, animation loops, analyzers,
or unbounded parse work.

The accent-aware bootstrap splash has a 700 ms minimum and a 5 s safety timeout;
its only optional transition is a 140 ms opacity fade. Player-session writes are
structural, debounced by 120 ms, atomic, and exclude playback-position ticks.

Visualizer samples used for a paused remount live in one bounded module-level
snapshot store keyed by Queue item, transition generation, and mode. A remount
draws the snapshot but still owns only one EventSource and one animation-frame
handle.

## Required performance evidence

For changes affecting realtime behavior, measure before and after:

- frame arrival and render rates;
- average interval and jitter;
- dropped/stale frames;
- EventSource and `requestAnimationFrame` counts;
- active MPV/FFmpeg process counts;
- analyzer restarts during stable playback;
- backend and FFmpeg CPU when practical;
- memory when practical;
- Queue full rebuild count;
- average payload size.

For Library work also record first-scan and unchanged throughput, metadata
parse count, transaction count/maximum/average duration, database size,
backend working set/CPU where practical, cancellation latency, populated
startup time, integrity, maximum concurrent scans, browse-page latency,
album/artist detail latency, and Album/Artist/all-Tracks context-build latency.
Desktop results are not evidence of Raspberry Pi 3B performance.

Test Meter, Mono Spectrum, Stereo Spectrum, Technical, and None independently
with real FLAC and MP3 files. Record limitations honestly; do not claim
Raspberry Pi 3B performance until measured on that hardware.

### Cassette premium scene

The Cassette premium renderer has one 1070×710 RGBA frame and one bounded SVG
scene. Its animation controller is shared by the loading prototype and premium
scene rather than duplicated during the atomic swap. It is capped at 30 fps,
retains its SVG nodes, and writes only two tape-mass circle radii and two reel
rotations. The centre-window glass and one-pixel winding gradients are static.
The controller performs no
per-frame layout reads or backing-store resizes and creates no periodic timer,
worker, observer, visualizer EventSource, Canvas, or FFmpeg process.

Reels briefly decelerate on Pause/Stop, while the loop stops after motion and
progress settle. Hidden, destroyed, Animations Off, and reduced-motion states
cancel continuous work. Clipping, winding gradients, and the glass overlay add
no centre-window state that can keep the loop alive.
The PNG loader is module-cached and uses normal browser caching; it neither
duplicates fetches nor retries indefinitely. Windows figures belong in the
step report; Raspberry Pi validation remains a separate hardware task.

The Cassette metadata overlay, utility row, and time row do not enter the reel
hot path. Metadata fitting performs a bounded number of SVG measurements only
on identity/content changes and once after the module-cached local fonts settle;
viewBox scaling needs no resize observer. Time text is derived from the existing
Player snapshots and seek-preview callback, with no timer, polling, rAF, MPV
query, EventSource, or second seek pipeline. Utility controls call existing
AppShell callbacks and create no duplicate Queue drawer, volume state, or
listener infrastructure.
