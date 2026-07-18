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

The title always reserves two lines. Artist, album, technical data, visualizer,
timeline, artwork, and mini-player reserve fixed geometry so a normal track
change produces no measurable layout shift. Waveform changes first draw the
neutral empty rail. The visualizer rejects frames from other generations and
decays its existing buffers to zero through its single existing render loop.

## Library browser

- Render directory entries before metadata enrichment.
- Keep folders/audio in separate stable regions and never reorder from tags.
- Retain existing content with discreet `aria-busy` until the next directory
  can be committed in one replacement.
- Player ticks update only row class and `aria-current`, never list structure or
  scroll.
- Store navigation by source ID plus logical relative path. Native paths never
  enter DOM attributes, labels, breadcrumbs, URLs, or session keys.
- Back, breadcrumb, source actions, dialogs, and rows remain semantic
  keyboard/touch controls with visible focus.

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

Use semantic buttons, dialogs, sliders, labels, focus order, focus traps, focus
restoration, `aria-current`, `aria-expanded`, `aria-pressed`, and dynamic
labels where applicable. Visualizer cycling must work with tap, Enter, and
Space. A large touch target does not replace an accessible name.
