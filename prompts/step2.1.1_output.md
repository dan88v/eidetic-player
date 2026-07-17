# Step 2.1.1 — UI positioning and presentation

Date: 2026-07-17

## Outcome

Step 2.1.1 is complete. The top bar now keeps a 64 × 64 px Home button
immediately after Menu and no longer contains Volume. Home returns to Now
Playing without reloading or changing playback, is a safe no-op on Now Playing,
and uses the shared navigation path that closes Menu, Queue, and Volume.

The lower controls now use three independent `1fr auto 1fr` zones:
Library/Volume at the far left, the symmetric
Shuffle/Previous/Play/Next/Repeat group at center, and Queue at the far right.
The existing Volume popover, MPV state, slider, mute, keyboard handling, focus
restoration, and persistence are retained; the popover is anchored above its new
trigger and clamped to the viewport.

The deterministic stereo meter now has 16 px L/R bars, a 10 px inter-row gap,
18 px labels, and is bottom-anchored to the artwork. Spectrum and waveform
renderers were not changed. Timeline times use 25 px, weight 600, tabular
numerals and now format durations over one hour as `1:02:31`.

## Files

Created:

- `apps/ui/src/utils/layout-diagnostics.ts`
- `apps/ui/test/layout-geometry.test.ts`
- `prompts/step2.1.1_output.md`

Modified:

- `apps/ui/src/components/app-shell.ts`
- `apps/ui/src/components/icons.ts`
- `apps/ui/src/components/timeline.ts`
- `apps/ui/src/components/top-bar.ts`
- `apps/ui/src/components/visualizer.ts`
- `apps/ui/src/components/volume-popover.ts`
- `apps/ui/src/i18n/en.ts`
- `apps/ui/src/screens/index.ts`
- `apps/ui/src/screens/now-playing.ts`
- `apps/ui/src/styles/components.css`
- `apps/ui/src/styles/responsive.css`
- `apps/ui/src/styles/screens.css`
- `apps/ui/src/visualizer/meter-renderer.ts`
- `docs/ui.md`
- `neutralino.config.json` (regenerated for production by the required build)

Generated build artifacts under `dist/ui/` were refreshed.

## Measurements

At 1280 × 800:

- viewport center: 640 px
- Play/Pause center: 640 px
- center difference: 0 px
- Shuffle/Previous gap: 32 px
- Previous/Play gap: 16 px
- Play/Next gap: 16 px
- Next/Repeat gap: 32 px
- visible L/R bar height: 16 px
- L/R vertical gap: 10 px
- artwork bottom: 588 px
- R graphic bottom: 588 px
- bottom difference: 0 px
- timeline time font: 25 px
- Volume popover: left 92.39 px, top 444 px, 116 × 264 px, bottom 708 px
- popover above trigger: yes
- popover inside viewport: yes
- popover overlaps Play/Pause: no

Responsive browser measurements:

- 1366 × 768: Play center difference 0 px, meter bottom difference 0 px,
  no horizontal overflow
- 1600 × 900: Play center difference 0 px, meter bottom difference 0 px,
  no horizontal overflow
- 1280 × 720: Play center difference 0 px, meter bottom difference 0 px,
  no horizontal overflow
- 1024 × 600: Play center difference 0 px, compact symmetric
  12/12/12/12 px gaps, meter bottom difference 0 px, no horizontal overflow

Production frontend bundle:

- JavaScript: 50.75 kB raw, 15.16 kB gzip
- CSS: 26.63 kB raw, 5.36 kB gzip
- HTML: 0.43 kB raw, 0.27 kB gzip

The layout diagnostic is loaded only in development and is absent from the
production JavaScript bundle.

## Verification results

- `format:check`: passed
- `typecheck`: passed
- `lint`: passed
- `build`: passed
- tests: 17/17 passed
- `mpv:doctor`: passed with mpv
  `v0.41.0-744-g304426c39`; headless startup and JSON IPC passed
- Neutralino development window: opened at a measured 1280 × 800 viewport
- native Open Files: opened the Windows `Open audio files` dialog
- Library → Home: verified in the Neutralino window
- Volume popover: verified visually and geometrically above the lower trigger
- real MPV volume: changed through the UI to 55.14706%, then restored
- mute: changed through the UI to `true`, then restored to `false`
- Meter → Spectrum: verified in the Neutralino window; the unchanged 32-band
  Spectrum rendered correctly
- overlay exclusivity: retained through the shared centralized state transitions
- browser fallback and Neutralino platform selection: existing tests passed
- clean shutdown: Neutralino, project Node/Vite/backend, and MPV processes all
  exited; no project process remained

No backend, MPV transport, REST, SSE, PlatformBridge, artwork geometry,
waveform renderer, Spectrum renderer, audio analysis, dependency, framework,
timer, polling, animation loop, or audio feature was added or changed.

## Limits

No audio file was supplied in the workspace, so shutdown during active playback
and hands-on checks of seek, Previous/Next, metadata changes, drag-and-drop, and
queue selection with populated media could not be repeated manually. Their
implementation paths were not modified; static checks, the full automated suite,
live MPV startup/IPC, native Open Files, real volume/mute, visualizer switching,
browser fallback, and clean idle shutdown were verified.

Step 2.2 was not started.
