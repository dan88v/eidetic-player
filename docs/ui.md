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
Meter consumes real L/R peak values, converts linear amplitude to a −60–0 dB
display domain, and renders a compact labeled dB scale above both bars. Mono
uses 32 logarithmic bands; Stereo uses 16 bands per channel with low
frequencies at the center and higher frequencies toward the outer edges. None
is visually empty and closes its analysis stream.
All modes use a fixed 164 px slot at 1280 × 800, half the previous
visualizer height, with the lower edge aligned to the artwork.

Waveform uses 512 real points when FFmpeg is available and keeps the approved
deterministic fallback. Waveform and Line preview locally during pointer drag
and send one absolute seek on release. Tap and keyboard seek remain connected.
The mini-player retains its 108 px height and adds a 40 px touch timeline with
tap, Pointer Capture drag, Home/End, and arrow-key seek.
Its right controls are Previous (56 px), Play/Pause (64 px), Next (56 px), and
Home (56 px), with Home always last and no time counter added.

The Queue drawer highlights the current item and provides individual 56 × 56 px
Remove controls. Its centered red Clear Queue button follows the final Queue
row inside the scrolling list instead of occupying a top action bar; focus
trapping, confirmation, Escape, and focus restoration remain unchanged. File
opening remains available from its established non-drawer
surface and native drop handling. Its main row target starts the selected item immediately,
including when an idle staged Queue must first be materialized; Remove remains
a separate sibling control. Drag reordering remains out of scope.

The top bar begins with a 64 px Hamburger and the screen title. Its right side
contains non-interactive Ethernet and Wi-Fi status plus the unchanged USB/DAC SVG
followed by the unchanged 25 px tabular clock; no Home or audio-device chrome is
rendered there. The lower row uses three stable zones: Library and Folders at
the left edge;
the symmetric Shuffle/Previous/Play/Next/Repeat group at center; and
Volume/Queue at the right edge. Play/Pause remains centered on the viewport.
The development viewport badge is not mounted in the normal UI. When at least
one readable mounted USB volume exists, a USB control appears immediately
after Folders in the left group; otherwise it occupies no space. One device
opens directly and multiple devices use the shared picker. The same ordering
and visibility apply to Cassette without changing its playback-side controls.

At 1280 × 800, artwork and visualizer share the same structural row. The stereo
meter keeps its approved 16 px L/R bars and 10 px gap, while the reduced
visualizer container is controlled by `--now-playing-visualizer-height`.

## Sources, Folders, and Library

Sources uses real Local Folder cards with Open, Rename, Remove, and conditional
Retry actions. Its toolbar places Rescan Library before Add Folder and changes
that action to Cancel Scan while the single Library scheduler is queued or
active. Adding a Source schedules only that persistent Source ID; an active scan
retains one deduplicated pending request in the same scheduler. Rename is an
accessible modal with Escape, focus trap, and focus restoration; Remove states
that files are not deleted. USB Storage is a real, live section of mounted
volumes with status, optional capacity/read-only detail, and Browse. A separate
USB Library Folders section manages opted-in persistent roots with Open,
Rescan, Rename, Remove, and available/unavailable state. Network Shares remains
a subdued static placeholder.

Folders starts with a minimal configured-source collection and no duplicate
hero or Add Folder action. Source/folder cards share persistent sorting and
List/Grid presentation, real single/mosaic artwork, clickable artwork/body Open
targets, direct-audio counts, and a sibling accessible action menu. Switching
view changes CSS state only: it performs no request, artwork reload, screen
rebuild, or scroll reset.

USB Storage reuses the same Folders directory header, breadcrumb, cards, rows,
lazy metadata/artwork, Play Folder, and Add-to-Queue mechanics with a separate
per-device logical-path/scroll session. Disconnect keeps Back available,
disables stale actions, and shows a persistent dark empty state.
Mounted live-device cards expose Browse plus a compact Safely remove menu;
unmounted volumes expose Mount only when the platform reports support. The USB
Browser header reuses its compact menu for Safely remove. In-use removal uses
the shared confirmation dialog, while progress, busy/Retry, and persistent Safe
to remove states keep geometry stable and Back usable. No removal action is
added to Main Player, mini-player, or Queue.
The app header identifies this surface as `USB / <device name>`. Inside the
browser, Back remains left-aligned while Play, Add this folder to Library, and
the overflow menu form one right-aligned group. Nested paths use a compact
Root-to-current breadcrumb with a chevron and restrained current-folder accent.
The header also offers a fixed-width Add this folder to Library action at the
volume root and in subfolders. It becomes In Library after success, stays
disabled with an accessible explanation for overlap, and leaves the Quick
Browse screen open. Indexed USB folders also appear in Folders root with the
dedicated USB storage icon; unavailable cards remain visible with playback
actions disabled.

Library root is dedicated to Albums, Artists, and Tracks browsing. A single
compact toolbar places the segmented control on the left and Search, Manage,
then the Albums-only Grid/List mode on the right; Rescan/Cancel exist only
inside Manage Library. Search replaces that toolbar with its focused compact
field.
The selected segment and Album presentation persist independently. Album cards
reserve cover geometry before lazy artwork decode; album and artist details
replace the top-bar title, open at the top, and restore the prior list position
on Back. Rows use sibling semantic controls for their primary action and
three-dot menu. Track taps play the complete ordered context directly from that
row; Play and Add actions are disabled for unavailable entities. Lists use
keyset pagination and retain at most 192 rendered items.

Search replaces the Library header and browsing region without adding a
persistent row. It requires two characters, debounces for 250 ms, groups
Artists, Albums, then Tracks, and offers bounded keyset-paginated View all
subviews. Exact, prefix, word-prefix, and contains matches use stable
accent-insensitive catalog keys. Search query, loaded pages, category/detail
route, and scroll survive Library remounts in the current app session only.
Album/Artist row taps reuse their details, while their menus add Play album/Play
all beside the existing Queue actions. Track tap and menu Play resolve the
current-catalog Album by opaque Track ID and start that Track directly inside
the complete ordered Album; an album-less Track uses a single-item context.
Track Add to Queue still appends only that Track. Unavailable results remain
visible but cannot play or be added.

Manage Library is an internal Library subpage, distinct from Settings and from
the Sources configuration screen. It reuses the four Tracks, Albums, Artists,
and Unavailable counters, the detailed scan panel, and a compact operational
Source overview. The overview exposes Source-specific Rescan/Retry and links to
the existing Sources screen; it does not duplicate Add, Rename, Remove, or
native dialogs. Back restores the browsing segment, Album view, loaded pages,
and scroll. Rescan becomes Cancel for active work and stays disabled while work
is queued. Scan completion invalidates only current Library pages; progress
events never rebuild browse lists or artwork.

Each Source also reuses its existing sibling popup for a targeted Rescan,
Rename, Remove, and conditional Retry. Targeted Rescan is disabled while any
Library scan is active or queued because the backend admits one scan only.

Inside a folder, Back, the compact current title, sorting, List/Grid, and Play share the
primary row; a compact second row contains only ancestor breadcrumbs. Audio
keeps its separate fixed-height list with 64 px artwork. Filename/extension
render immediately, while title, artist, duration, compact quality, and artwork
update in place without reordering. Every audio row has a sibling action menu
for Play now and Add to Queue. The main row and menu Play now share one
latest-request-wins action path; current state changes only after the newest
request succeeds, affects only the row class and `aria-current`, and controls
are always re-enabled. All transient operation feedback uses the single
application toast, never inline status content above the screen. Persistent
empty states and availability labels remain in their content context.
Folders does not toast navigation, loading, or playback because those actions
have an immediate visible result. Queue additions, results without visible
state, and errors continue to use the shared toast.

Back and the keyboard-accessible breadcrumb use logical locations only. Existing
content remains visible during the next request and the result commits once.
Source, directory, selected row, List/Grid preference, and per-directory scroll
survive navigation. Empty source/folder states provide the contextual next
action. At 1024 x 600 the grid reduces columns without shrinking touch targets.

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

Technical keeps LUFS-S at the analyzer value and smooths only the displayed
Crest number. New Crest peaks use a 125 ms attack; decreases use a 1.8 s
release. The delta-time filter ignores invalid/missing samples, bounds long
foreground gaps, and resets on track/session/seek identity changes. Crest and
LUFS-S use responsive 48–58 px tabular monospace values without changing the
Technical layout or the visualizer cycle.

The right timeline counter is a 25 px semantic button with stable width. It
toggles total duration and negative remaining time, persists only the typed
`total`/`remaining` preference, and is disabled when duration is unavailable.
Elapsed and remaining use the same integer position boundary, so their seconds
advance together even when the source duration contains a fractional second.
Section headers rely on the top bar for their page title. Their content area
shows only `screen-header__description` on the left and preserves any existing
action on the right; decorative icons, eyebrows, and duplicate visible `h1`
elements are omitted.

Now Playing title, artist, album, and technical rows reserve additional
descender and antialiasing space. Single-line artist and album use native
ellipsis instead of one-line WebKit clamping. The left, center, and right
transport zones share one vertical center axis.

## Settings and startup

Settings root separates Interface and Network. Network selects a Wired or
Wi-Fi view without disabling the other interface, shows current IPv4 values
read-only, and keeps scan/connection dialogs on the existing Settings and
shared-dialog surfaces. Its content header matches Interface, with Back and
description on the left and the Wired/Wi-Fi selector on the right; the Settings
hamburger remains unchanged. Ethernet and Wi-Fi top-bar icons reflect the shared
global network snapshot without becoming controls.

The Interface screen includes an inline Main player segmented control with
`Default` and `Cassette`. The choice commits immediately through the central
store and persistence module. Cassette Now Playing uses the unchanged existing
mini-player as its sole playback control surface; Default Now Playing retains
its established geometry and does not display a mini-player. See
[Cassette main player](development/cassette-player.md) for tape progress and
animation lifecycle details.

The Cassette surface preserves the approved 1070×710 cassette artwork with a
single transparent PNG frame above one lightweight SVG layer. Only the two
reels, their tape masses, and the clipped centre-window tape move; the surface
adds no controls or track metadata. A same-size simplified prototype remains
available while the frame decodes or if the frame is unavailable, so the mode
does not flash, collapse, or expose a broken image.

Settings rows share one 72 px base contract with 22 px primary copy and 30 px
SVG chevrons. Binary values use inline segmented controls; values with three or
more choices use a selection screen and commit at tap time before returning.
Storage failure rolls the store back, keeps the selection screen open, and uses
the application toast. The global inactivity timer is fully suspended for the
entire Settings route group and restarts with a complete timeout only after
leaving it.

The immediate splash keeps “Eidetic Player” on one responsive, non-wrapping
line. Its loading line uses the active theme accent and becomes static when
Animations are off or reduced motion is requested. Empty Now Playing reserves
its normal surfaces but renders no instructional sentence.

Library scans extend the single application toast host with one persistent
`library-scan-progress` notification. Queued, scanning, cancelling, completed,
cancelled, and failure states update that keyed surface in place. Visual
updates are coalesced to at most four per second; terminal states are immediate.
Complete/cancelled dismiss after 2.5 seconds, while failed, interrupted, and
unavailable states remain visible until superseded or shutdown. Every toast
has one accessible dismiss button with a visually small × and a 40×40 px touch
area. Dismissing progress hides the stable `scanId/sourceId/generation` run,
including its later terminal update; a future run is visible again. No Manage,
Cancel, or Retry action is placed in the toast. Normal transient messages keep
their existing duration, cancel auto-dismiss when manually closed, and share
the same host.
