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

Meter and Spectrum are deterministic static Canvas placeholders. They do not
consume audio data and have no render loop. The visualizer is integrated directly
into Now Playing: tap it, or use Enter/Space, to switch mode. Spectrum uses 32
bands and the responsive waveform uses roughly 160–240 Canvas bars.

No explanatory mock labels are shown in the player. Waveform and Line keep their
approved deterministic renderers, preview locally during pointer drag, and send
one absolute seek on release. Tap and keyboard seek are also connected. The
Queue drawer renders the current MPV playlist, highlights the current item, and
allows direct selection; removal and reordering remain out of scope.

The top bar keeps Home immediately after Menu on every screen, while its right
side contains only the real audio device and clock. The lower row uses three
stable zones: Library/Volume at the left edge; the symmetric
Shuffle/Previous/Play/Next/Repeat group at center; and Queue at the right edge.
Play/Pause remains centered on the viewport. The Volume popover opens upward
from its lower trigger. Menu, queue, and volume overlays are mutually exclusive
and restore focus when closed.

At 1280 × 800, the artwork uses the same perceived gap on its left and below:
the lower reference is the first visible waveform pixel rather than the larger
invisible slider hit area. Artwork and visualizer share the same structural grid
row, keeping their lower edges aligned.

The approved artwork stays a fixed placeholder. The stereo meter uses thin
16 px L/R bars with a 10 px gap and is bottom-anchored to the artwork; Spectrum
is unchanged. Timeline times use larger 25 px tabular numerals. Meter and
Spectrum remain simulated graphics until a later real-audio visualization step.

## Artwork presentation

Now Playing, the mini-player, and Queue share one lightweight artwork component.
It keeps the existing abstract placeholder until a validated image is decoded,
uses `object-fit: cover` without changing approved geometry, and applies a
170 ms opacity transition only when animations are enabled. Reduced motion and
Animations Off switch immediately.

Now Playing uses descriptive localized alt text. Mini-player and 56 × 56 px
Queue images are decorative. Queue rows start with placeholders and use one
`IntersectionObserver` with a 120 px root margin; at most two images load at
once. Current and next artwork references can render immediately, while other
rows request only their own opaque Queue endpoint. No online image, base64
payload, or generated thumbnail is used.
