# Cassette main player

The Main player preference is independent from the visualizer preference. It
accepts only `default` and `cassette`, persists in central UI storage, and
falls back to `default` for missing or invalid values. The Main Player host
mounts one active surface. The Default branch remains the established Now
Playing component; the Cassette branch never creates a visualizer or its
EventSource.

The Cassette screen is a read-only projection of `PlayerState`. Its snapshot
contains only status, pause state, Queue revision, opaque Queue IDs, optional
durations, and derived progress. It does not receive or retain media paths.
Playback commands remain exclusively in the existing mini-player, which is the
single control surface in Cassette mode.

## Queue tape progress

When every duration is known, progress is the sum of completed durations plus
the current position divided by total Queue duration. With no Queue duration,
the fallback is `(current index + current-track progress) / queue length`.
For partial metadata, unknown entries use the median known duration; the
current duration and a neutral 180-second fallback are retained as defensive
fallbacks. Results are always finite and clamped to `[0, 1]`, with an
`exact`/`estimated` confidence marker.

`QueueItem.durationSeconds` is optional for compatibility. MPV supplies the
current duration; the existing non-blocking metadata enrichment supplies
current, adjacent, and lazily requested Queue durations. Metadata-only changes
reuse stable IDs and the existing Queue array reconciliation without changing
`queueRevision` or rebuilding rows.

## Mechanics and lifecycle

Tape mass is area-based. With full radius `R`, core radius `r`, and progress
`p`, source radius is `sqrt(r² + (1-p)(R²-r²))` and destination radius is
`sqrt(r² + p(R²-r²))`. Angular velocity is derived from the visual linear tape
speed divided by each live radius and capped. Reel angles integrate bounded
frame deltas and are never reconstructed from progress, so seeks move tape
mass without discontinuously jumping the hubs.

The SVG keeps shell, label, band, window, tape masses, hubs, tape paths, head,
capstan, and pinch roller as separate layers. Playback engages the upper
mechanism; pause leaves the head engaged with the pinch assembly partially
withdrawn; stopped and empty states settle out. Seek preview comes from the
existing mini-player timeline callback and does not issue additional player
commands.

One animation controller owns at most one `requestAnimationFrame` handle and
renders no faster than 30 fps. It runs only while visible and playing or while
a transition is settling. Pause, stop, empty state, screen destruction, and
document hiding cancel continuous work. Animations Off and reduced motion
apply static state immediately without a continuous frame loop.
