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
Transport and seek commands remain exclusively in the existing mini-player.
Cassette adds only the existing Library, Folders, Volume, and Queue actions;
they call the same navigation, popover, and global drawer callbacks as Default.

## Metadata, utility controls, and time

A static metadata SVG shares the scene's `0 0 1070 710` viewBox and sits above
the frame. Artist and album use the locally bundled Nothing You Could Do font,
with local Open Sans and sans-serif fallbacks. The measured safe label area is
`x=150`, `y=567`, `width=770`, `height=82`, with 8 units of inner padding. It
uses both ruled rows while staying inside the lower ivory panel and clear of the
sloped sides and bottom shell border. Artist and album share one large centred
line separated by `-` across the full panel height; a sole value is centred
without a separator, and missing values produce no invented label.

Text measurement runs only when the Queue identity, transition generation,
artist, album, or font availability changes. A bounded binary search reduces
the font size before a Unicode-aware bounded truncation adds an ellipsis at the
minimum size. SVG scaling preserves the safe-area relationship during resize,
so no resize observer or per-frame layout read is required. Metadata is assigned
with `textContent`; the decorative SVG is inert, while the Cassette section gets
a concise accessible description on metadata changes.

The utility row is Cassette-only and reserves layout space below the global
header. Its left Library/Folders group and right Volume/Queue group anchor to
the outer Cassette surface edges while the cassette itself remains centred. It
preserves Default's 64-pixel touch targets, shared icons, accessible labels, browsing
visibility rules, mute/volume state, global volume popover, and global Queue
drawer. It creates no duplicate navigation, state, popup, or drawer.

The larger time row spans the Cassette surface width immediately above the
global mini-player, anchoring elapsed and total/remaining near the respective
outer window edges. It uses the locally bundled Bitcount Single variable font, with
local Open Sans and monospace fallbacks, for elapsed on the left and
total/remaining on the right. It reuses the Default timeline formatters,
remaining sign, persisted mode callback, semantic toggle, current Player
snapshot, and mini-player seek preview. It creates no timer or second seekbar.
Both local fonts are requested once per module session through the Font Loading
API; failure is silent and retains the local fallback stack without blocking
playback.

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
destination. Both use a 112-unit core and 270-unit full radius; the full pack
remains inside the cassette's lateral bounds. Angular velocity
is the shared linear tape speed divided by each live radius and then capped:
an empty reel is faster than a full reel, while equal radii produce equal
speeds. Because CSS/SVG screen coordinates have a downward-positive Y axis,
both reels integrate a negative angular velocity to rotate counterclockwise.
Reel angles integrate bounded frame deltas and are never reconstructed from
progress, so seeks move tape mass without discontinuously jumping the hubs.

The premium scene uses the `0 0 1070 710` coordinate system shared by three
layers. A single dynamic SVG sits below
`/assets/main-player/cassette/cassette-frame.png`, and the static metadata SVG
sits above it; the frame is the only raster asset loaded at runtime. Reel
centres are `(290, 388)` for the left destination
and `(776, 388)` for the right source. The SVG contains exactly two circular
tape masses clipped to the centre window and below the two reel/hub groups; the
cassette frame covers the rest of each mass. Their `r` values are the only
visual representation of changing tape quantity: the left radius grows and the
right radius shrinks as Queue progress advances, while total tape area is
conserved. Two static repeating radial gradients render one-pixel concentric
tape windings without additional circles. A static semi-transparent glass
overlay covers the clipped window; neither layer is updated per frame.
Logical tape flow remains right to left. There is no animated head, capstan,
pinch roller, transport assembly, external mechanism, or animation-driven
text.

The source master at `design/cassette/cassette-master-original.png` is a visual
and documentation reference only. It is not imported, copied, encoded, or
served by the application. The approved frame preserves the master typography,
label, silhouette, screws, windows, and smoked shell.

One animation controller owns at most one `requestAnimationFrame` handle and
renders no faster than 30 fps. It runs only while visible and playing or while
a tape-mass interpolation or brief reel deceleration is settling. Each rendered
frame can update only two circle radii and two reel rotations; the centre window
is never updated. Pause, stop, empty state, screen destruction, and document
hiding cancel continuous work. Animations Off and reduced motion apply static
state immediately without a continuous frame loop. No layout read, periodic
timer, observer, visualizer EventSource, Canvas, or FFmpeg analyzer is created
by Cassette mode.

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
