# Touch UI and seamless rendering

## Physical target

The primary viewport is 1280 × 800 CSS pixels on an 8-inch landscape
touchscreen. Windows mouse and keyboard are development aids, not the target
interaction model.

- Use at least 56 × 56 px for secondary controls.
- Prefer 64 × 64 px for normal controls.
- Keep primary transport controls at their established larger dimensions.
- Maintain at least 8–12 px separation, and more around high-impact controls.
- Use Pointer Events and pointer capture for drag interactions.
- Do not require hover, tiny handles, tooltips, right-click, or desktop-only
  gestures.
- Preserve keyboard focus and operation during Windows development.

Emergency layouts below 1280 × 800 may scroll or hide secondary information.
They must not shrink touch targets below safe sizes or introduce horizontal
overflow.

## Seamless is a feature

Loading, navigation, track changes, artwork swaps, Queue updates, and mode
changes must appear continuous.

Never ship:

- a white frame or white Canvas clear;
- a temporarily unstyled document;
- content collapsing while data loads;
- artwork dimensions changing after decode;
- old artwork shown beside new metadata;
- Queue rows jumping, blinking, or changing height;
- scroll position resetting on ordinary state updates;
- full component replacement when only a class, label, or value changed;
- an empty image surface between placeholder and decoded artwork.

Use stable dark surfaces and reserve final geometry before data arrives.
Artwork containers must keep the final aspect ratio and size. A new image is
swapped only after it has decoded and still matches the current generation.
When artwork is absent or uncertain, keep the reserved dark surface completely
blank. The invisible placeholder layer may remain for seamless swaps, but it
must not render text, icons, borders, shadows, or loading chrome.

## Layout stability

- Prefer CSS Grid/Flex structure over absolute offsets and negative margins.
- Center the main Play/Pause control relative to the viewport, not leftover
  space between asymmetric side groups.
- Keep fixed-height rows for Queue and mini-player content.
- Use tabular numerals and a sufficient minimum width for time counters.
- Derive elapsed and remaining labels from the same whole-second position so
  both counters cross their second boundary in the same render.
- Long metadata may clamp or wrap within designed limits; it must not push the
  timeline or controls.
- Fixed text rows need line-height plus explicit descender/antialiasing space;
  never clip a glyph by making an `overflow: hidden` box exactly one line tall.
- Async text and images must not alter established panel dimensions.
- Preserve scroll and focus when reconciling lists.
- Every Library subpage that exposes a Back control keeps its complete header
  sticky through the reusable `library-sticky-back-header` contract. New
  Library subpages with Back must adopt the same contract.

History defaults to Recent and preserves its active segment and per-segment
scroll for the app session. Recent follows the established Track-row geometry, groups rows by
local Today/Yesterday/full-date headings, and keeps its red confirmed Clear
action at the end of the scroll rather than in the header. Unavailable rows
remain visible and removable/favoritable, but their Play and Add actions stay
disabled. History refreshes preserve the current content and scroll while the
bounded replacement page is prepared.

Most Played keeps the same touch rows with artwork, Favorite and contextual
actions, adds count and last-played metadata, and has no per-row removal. Stats
uses six simple summary cards and a centered confirmed red reset, with no
Search, sorting, or graphs. The Queue drawer intentionally omits Favorite and
overflow actions to reduce clutter; its row Play and Remove targets remain.

The single fixed toast host is anchored to the app viewport. Its normal bottom
gap is used when no mini-player exists; an explicit root state adds the fixed
mini-player height when it is mounted. Hidden toast surfaces use `display:
none`, so they cannot enlarge the host or push visible messages toward the
center. The bottom-anchored stack grows upward and remains below the keyboard
overlay.

Measure important geometry with `getBoundingClientRect()` in development tests,
but keep production layout CSS-driven rather than continuously JS-measured.

## Animation

Animations are enabled by default but must remain lightweight:

- generally 120–220 ms;
- preferably `opacity` and `transform`;
- no animated blur, filter, height, width, or costly shadow;
- no decorative infinite animation;
- no artificial delay when animations are disabled.

Honor both `animationsEnabled` and `prefers-reduced-motion`. Realtime audio
information may continue updating under reduced motion, but decorative
interpolation should be reduced.

## Artwork

- Use the reusable artwork component in Now Playing, mini-player, and Queue.
- Keep `object-fit: cover`, explicit dimensions, and `draggable="false"`.
- Keep the main Now Playing cover square with `border-radius: 0`.
- Queue and mini-player artwork are decorative when nearby text is sufficient.
- Keep a stable, visually empty dark placeholder under every image.
- Tie each request to stable track/Queue IDs and a generation token.
- Lazy-load Queue artwork with one managed observer and limited concurrency.
- Do not expose paths or use remote artwork.

Track changes use one presentation generation. Metadata text, current Queue
identity, position/duration, artwork, waveform, and visualizer frames must all
match that generation before they are shown. A decoded current/next/previous
artwork cache may be handed to the active component; a miss clears the old
image to the permanent dark placeholder immediately. Artwork and real waveform
reveals use 140 ms opacity transitions, with no delayed frame when animations
are off or reduced motion is requested.

The title normally reserves two lines. At short desktop heights it deliberately
uses one line so metadata and the visualizer cannot overlap. Artist, album,
technical data, visualizer, timeline, artwork, and mini-player otherwise
reserve fixed geometry so a normal track change produces no measurable layout
shift. Waveform changes first draw the neutral empty rail. The visualizer
rejects frames from other generations and decays its existing buffers to zero
through its single existing render loop.

The L/R meter uses one continuous enhanced dB mapping: −60…−24 dB occupies
0…30%, −24…−12 dB 30…60%, −12…−6 dB 60…80%, and −6…0 dB 80…100%. Ballistics
run in the dB domain with a 10 ms attack, 350 ms release, 900 ms peak hold, and
12 dB/s hold decay. Pause freezes values; seek, track change, and incompatible
identity reset them.

Technical applies independent display-only Crest ballistics: 125 ms attack
and 1.8 s release using elapsed time, with a bounded step after hidden-tab or
long-pause gaps. Invalid samples are ignored and track/session/seek resets
clear the carried value. LUFS-S and analyzer output are untouched. The two
numeric values use the renderer's scoped responsive 48–58 px monospace size.

The visualizer cycle and Settings use the same order: Mono Spectrum, Stereo
Spectrum, Meter, Technical, and None. Technical shows channel-aware Crest
Factor, standards-based 3-second LUFS-S, and the same compact enhanced stereo
peak-hold meter. The meter is blue below −18 dBFS, orange from −18 dBFS, and
red from −3 dBFS. Neutral state uses em dashes. Presentation uses a fixed
120 ms lead over the reported audible position to compensate for analyzer,
event-stream, and display latency. It reuses the single analyzer, EventSource,
Canvas, and animation loop and must remain readable at all supported desktop
viewports.

## Folders browser

- Render directory entries before metadata enrichment.
- Keep folders/audio in separate stable regions and never reorder from tags.
- Keep the Folders root minimal; source management belongs to Sources.
- Apply the persisted List/Grid mode to source and folder cards only. Switching
  it must preserve the same DOM, artwork, scroll, and backend request count.
- Folder cards use separate artwork/body Open targets and a sibling menu; never
  nest buttons. Show the direct playable-file count instead of a generic type.
- Persist folder sorting independently from the List/Grid presentation.
- Keep the desktop Grid at a deterministic four columns so a scrollbar cannot
  change the count after returning from a directory; responsive breakpoints
  reduce it to two and then one column.
- Audio rows keep their main Play target and add a sibling menu for Play now and
  Add to Queue. Both Play targets must use the same request path, keep controls
  enabled again after completion, and apply current-row state only when the
  latest requested track has won.
- Folder previews are lazy, direct-child only, and use real opaque artwork refs.
- Transient metadata, image load, and decode failures remain retryable; do not
  turn an abort or decode failure into a persistent negative artwork result.
- The directory header shows Back/current title/view/Play first and ancestor
  breadcrumbs second; never repeat the current folder in the breadcrumb.
- Retain existing content with discreet `aria-busy` until the next directory
  can be committed in one replacement.
- Player ticks update only row class and `aria-current`, never list structure or
  scroll. Never retain the browse response's initial `current` flag after the
  player store has supplied authoritative current-track state.
- Store navigation by source ID plus logical relative path. Native paths never
  enter DOM attributes, labels, breadcrumbs, URLs, or session keys.
- Back, breadcrumb, source actions, dialogs, and rows remain semantic
  keyboard/touch controls with visible focus.

Sorting and List/Grid belong only to the Folders root. A directory keeps its
Back/title/Play controls and omits sorting and view controls. Sorting uses an
app-styled popup menu rather than a native select. Its outer container owns the
single border; the transparent inner trigger uses an inset accent focus ring.
The breadcrumb element is hidden entirely when there are no useful ancestors.

## Favorites

Favorites is a primary browsing route immediately after Library and follows
the same Folders-only/Library-only/Both visibility rule as Library. Its
accessible segmented control switches between Tracks, Albums, and Artists on
the same route; no segment adds Search, sorting, a hero, or statistics. The
selection persists locally and defaults to Tracks. The header keeps one
non-wrapping, category-labelled Play all action.

Tracks retains the Step 2.8 row behavior. Albums reuses the four/two/one-column
Library Grid and List geometry with an independent Grid-default preference.
Artists reuses the touch list. Each entity has a sibling heart and menu button;
the main Album/Artist target opens its Library detail and never starts
playback. Empty Album and Artist segments contain only their approved title.

The Track heart is a semantic button with a 44 px hit area, dynamic accessible
name, visible focus, and filled/empty state. It is a sibling of the row Play
button, so activating it cannot start playback. Queue shows it only when the
backend supplies an explicit stable Library Track ID; filenames, titles and
paths are never used to infer Favorite identity. Unavailable Favorites remain
visible and removable, but their Play and Add to Queue actions are disabled.
Album and Artist hearts follow the same semantic contract on Library root,
detail, grouped/View-all Search, and Favorites surfaces. Their menus expose
single-entity Play/Add-to-Queue plus Add/Remove Favorite actions; only the menu
mutation shows a success toast.

## Settings and inactivity

Settings uses root, Interface, and selection sub-screens. Every boolean uses an
inline segmented control. Without exceptions, any control with three or more
choices uses a shared row, current-value summary, 30 px SVG chevron, and a
dedicated selection screen; three-or-more-choice pill groups are not permitted
inline. A
choice updates the store, persists, renders its checkmark, and returns
immediately; failed persistence rolls back, shows the existing toast, and does
not navigate. Music browsing can expose Folders, Library, or both without
hiding Sources.

The optional global inactivity timer returns to Now Playing without changing
playback. It closes transient overlays and is suspended for every route in the
Settings screen group, including future sub-screens and their dialogs. Entering
Settings clears the sole timer without retaining a remainder; leaving starts a
full timeout.

The immediate splash title never wraps and its progress line reads the theme
accent before the bootstrap barrier. Reduced motion and Animations Off render a
static accent line.

## Transient feedback

After the application shell is mounted, every temporary progress, success,
warning, and error message must use the single shared, deduplicated `showToast`
surface positioned above the mini-player. Screens must not add inline status,
feedback, alert, or banner content above the page for operation results, and
must not create a second toast container. Persistent content such as empty
states, source availability, validation help, and dialog explanations remains
part of the page. A fatal bootstrap error before the shell and toast exist is
the only application-level exception.

Do not create a toast when the action itself has an immediate visible result:
Folders navigation, directory loading, and playback communicate through their
content or player state. Use the toast for errors and operations without an
otherwise visible outcome, such as Add to Queue.

Long Library scans are the controlled persistent exception. They use one keyed
`library-scan-progress` surface inside the same toast host and update it in
place at a coalesced maximum of four visual updates per second. Every toast has
one semantic dismiss button with a 40×40 px hit area; no scan management action
is added. A dismissed Library run is suppressed in memory by its stable
`scanId/sourceId/generation` identity through terminal state, while a new run
is shown normally. Completed and cancelled states otherwise dismiss after 2.5
seconds; failure states remain visible until superseded or shutdown. Manual
dismiss cancels the affected transient/terminal/coalescing callback.

Section content headers do not duplicate the page identity already displayed
by the top bar. Keep only `screen-header__description` at the left, retain
existing right-side actions, and omit decorative icons, eyebrows, and visible
`h1` elements.

## Timeline and Canvas

- A narrow visible track must have a much larger transparent touch area.
- During drag, preview locally and send the authoritative seek at the intended
  rate/final release; do not flood the backend.
- The mini-player timeline is the upper border of the mini-player and must not
  create a new layout row.
- Its right-side controls stay ordered Previous, Play/Pause, Next, Home; Home
  is navigation, while the first three remain real player commands.
- The Now Playing right time counter toggles the persistent `total`/`remaining`
  UI preference without rebuilding the timeline.
- All three transport zones share the same vertical center axis even though
  their touch targets have different sizes.
- Canvas uses the dark app background and must never clear to white.
- Canvas resize happens only on a real size/DPR change, not on each frame.

## Accessibility

The reusable touch keyboard follows the explicit opt-in, opening, editing,
layout, and teardown contract in
[Reusable on-screen keyboard](on-screen-keyboard.md). Keep the actual input as
the only displayed value field. New text-like fields must not automatically
inherit the keyboard: select `text`, `numeric`, or `ipv4` deliberately and
retain ordinary mouse and physical-keyboard behavior.

Use semantic buttons, dialogs, sliders, labels, focus order, focus traps, focus
restoration, `aria-current`, `aria-expanded`, `aria-pressed`, and dynamic
labels where applicable. Visualizer cycling must work with tap, Enter, and
Space. A large touch target does not replace an accessible name.
