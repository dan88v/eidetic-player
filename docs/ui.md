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
The mini-player retains its 108 px height and adds a 36 px touch timeline with
tap, Pointer Capture drag, Home/End, and arrow-key seek.

The Queue drawer highlights the current item and provides Add Files, individual
56 × 56 px Remove controls, and Clear Queue with focus trapping, Escape, and
focus restoration. Drag reordering remains out of scope.

The top bar keeps Home first and Hamburger second. Its right side contains the
real audio device with a stable inline-flex status dot and a 25 px tabular
clock. The lower row uses three stable zones: Library/Volume at the left edge;
the symmetric Shuffle/Previous/Play/Next/Repeat group at center; and Queue at
the right edge. Play/Pause remains centered on the viewport.

At 1280 × 800, artwork and visualizer share the same structural row. The stereo
meter keeps its approved 16 px L/R bars and 10 px gap, while the reduced
visualizer container is controlled by `--now-playing-visualizer-height`.

## Artwork presentation

Now Playing, the mini-player, and Queue share one lightweight artwork component.
It keeps the abstract placeholder until a validated image is decoded, uses
`object-fit: cover`, and applies a 170 ms opacity transition only when animations
are enabled. Reduced motion and Animations Off switch immediately.

Now Playing uses descriptive localized alt text. Mini-player and Queue images
are decorative. Queue rows use one `IntersectionObserver` with a 120 px root
margin and at most two image loads at once. No online image, base64 payload, or
generated thumbnail is used.
