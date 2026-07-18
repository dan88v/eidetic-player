# Touch UI calibration

Eidetic Player is designed primarily for a physical 8-inch touchscreen at
1280 × 800 CSS pixels. Desktop-sized visual density is intentionally avoided.

## Physical interaction scale

- Secondary touch target: 56 px
- Standard touch target: 64 px
- Previous/Next: 80 px
- Play/Pause: 88 px
- Side-menu row: 76 px
- Top bar: 72 px
- Mini-player: 108 px
- Timeline interaction height: 60 px
- Now Playing artwork: 500 × 500 px at the primary viewport

The 1280 × 720 and 1024 × 600 layouts are emergency adaptations. They preserve
touch targets and aspect ratios, hide secondary metadata where necessary, and
allow central vertical scrolling instead of shrinking the interface to desktop
density.

## Playback interface

Meter, Mono Spectrum, Stereo Spectrum, and None cycle by tap or Enter/Space.
Meter consumes real L/R peak values; Mono uses 32 logarithmic bands; Stereo uses
16 bands per channel with low frequencies at the center and higher frequencies
toward the outer edges. None is visually empty and closes its analysis stream.
All modes use a fixed 164 px slot at 1280 × 800, half the previous
visualizer height, with the lower edge aligned to the artwork.

Waveform uses 512 real points when FFmpeg is available and keeps the approved
deterministic fallback. Waveform and Line preview locally during pointer drag
and send one absolute seek on release. Tap and keyboard seek remain connected.
The mini-player retains its 108 px height and adds a 40 px touch timeline with
tap, Pointer Capture drag, Home/End, and arrow-key seek.
Its right controls are Previous (56 px), Play/Pause (64 px), Next (56 px), and
Home (56 px), with Home always last and no time counter added.

The Queue drawer highlights the current item and provides Add Files, individual
56 × 56 px Remove controls, and Clear Queue with focus trapping, Escape, and
focus restoration. Drag reordering remains out of scope.

The top bar begins with a 64 px Hamburger and the screen title. Its right side
contains neutral, non-interactive Ethernet, Wi-Fi, and USB/DAC placeholder SVGs
followed by the unchanged 25 px tabular clock; no Home or audio-device chrome is
rendered there. The lower row uses three stable zones: Library at the left edge;
the symmetric Shuffle/Previous/Play/Next/Repeat group at center; and
Volume/Queue at the right edge. Play/Pause remains centered on the viewport.
The development viewport badge is not mounted in the normal UI.

At 1280 × 800, artwork and visualizer share the same structural row. The stereo
meter keeps its approved 16 px L/R bars and 10 px gap, while the reduced
visualizer container is controlled by `--now-playing-visualizer-height`.

## Sources and hierarchical Library

Sources uses real Local Folder cards with Open, Rename, Remove, and conditional
Retry actions. Rename is an accessible modal with Escape, focus trap, and focus
restoration; Remove states that files are not deleted. USB Storage and Network
Shares remain subdued static placeholders.

Library starts with configured sources, then loads one directory level at a
time. Folders use a stable touch grid; audio uses a separate fixed-height list
with 64 px artwork. Filename/extension render immediately, while title, artist,
duration, format, and artwork update in place without reordering. Current state
changes only the row class and `aria-current`.

Back and the keyboard-accessible breadcrumb use logical locations only. Existing
content remains visible during the next request and the result commits once.
Source, directory, selected row, and per-directory scroll survive Library to
Now Playing to Library for the UI session. At 1024 x 600 the grid reduces
columns without shrinking touch targets.

## Artwork presentation

Now Playing, the mini-player, and Queue share one lightweight artwork component.
Its empty state is only a stable dark surface: no icon, text, border, shadow, or
loading indicator. A validated image is decoded before swap and uses
`object-fit: cover`; the main Now Playing cover is square with
`border-radius: 0`. The 140 ms opacity transition applies only when animations
are enabled. Reduced motion and Animations Off switch immediately.

Now Playing uses descriptive localized alt text. Mini-player and Queue images
are decorative. Queue rows use one `IntersectionObserver` with a 120 px root
margin and at most two image loads at once. No online image, base64 payload, or
generated thumbnail is used.

Track changes are atomic. Title reserves exactly two lines; artist, album, the
technical row, visualizer, timeline, artwork, and mini-player keep fixed
geometry. A cache miss shows the dark artwork placeholder immediately, while a
decoded preload is handed off without exposing the previous cover beside new
metadata. Artwork and waveform reveal over 140 ms; Animations Off and
`prefers-reduced-motion` switch immediately.

Waveform displays the neutral empty rail as soon as identity changes and only
accepts real points for the current generation. The visualizer decays to zero
and rejects frames for an older track. Queue current state changes
incrementally through class and `aria-current`; rows, scroll, and focus are not
rebuilt for a normal transition.

The right timeline counter is a 25 px semantic button with stable width. It
toggles total duration and negative remaining time, persists only the typed
`total`/`remaining` preference, and is disabled when duration is unavailable.
Elapsed and remaining use the same integer position boundary, so their seconds
advance together even when the source duration contains a fractional second.
The Sources eyebrow uses the localized product name, “Eidetic Player”.

Now Playing title, artist, album, and technical rows reserve additional
descender and antialiasing space. Single-line artist and album use native
ellipsis instead of one-line WebKit clamping. The left, center, and right
transport zones share one vertical center axis.
