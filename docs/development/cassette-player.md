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
`sqrt(r² + p(R²-r²))`. The right reel is the source and the left reel is the
destination. Both use a 28-unit core and 56-unit full radius. Angular velocity
is derived from the visual linear tape speed divided by each live radius and
capped. Reel angles integrate bounded frame deltas and are never reconstructed
from progress, so seeks move tape mass without discontinuously jumping the
hubs.

The premium scene uses the `0 0 1070 710` coordinate system shared by two
layers. A single dynamic SVG sits below
`/assets/main-player/cassette/cassette-frame.png`; the frame is the only raster
asset loaded at runtime. Reel centres are `(290, 388)` for the left destination
and `(776, 388)` for the right source. The SVG contains only the two tape
masses, the two reel/hub groups, and the clipped centre-window tape texture.
Tape flows right to left. There is no animated head, capstan, pinch roller,
transport assembly, external mechanism, or dynamic text.

The source master at `design/cassette/cassette-master-original.png` is a visual
and documentation reference only. It is not imported, copied, encoded, or
served by the application. The approved frame preserves the master typography,
label, silhouette, screws, windows, and smoked shell.

One animation controller owns at most one `requestAnimationFrame` handle and
renders no faster than 30 fps. It runs only while visible and playing or while
a tape-mass interpolation or brief reel deceleration is settling. The centre
tape advances only while playing. Pause, stop, empty state, screen destruction,
and document hiding cancel continuous work. Animations Off and reduced motion
apply static state immediately without a continuous frame loop. No layout read,
periodic timer, observer, visualizer EventSource, Canvas, or FFmpeg analyzer is
created by Cassette mode.

## Loading and fallback

The simplified SVG prototype is mounted first in the final aspect-ratio box.
The frame loader uses one module-cached image request and waits for
`HTMLImageElement.decode()` plus the expected 1070×710 intrinsic dimensions.
Only then is the premium scene committed and the prototype hidden, keeping the
swap atomic and layout-stable.

If loading or decoding the frame fails, the prototype remains visible and the
application emits at most one passive notification per application session.
If a premium animation layer fails at runtime, the existing controller is
retargeted to the prototype; a prototype/controller failure alone restores the
Default player. These fallbacks do not alter playback, Queue contents,
`queueRevision`, track, or position.
