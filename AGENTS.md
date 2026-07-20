# Eidetic Player — Codex working agreement

This file defines the operating rules for AI-assisted development in this
repository. Read it before making changes. More detailed guidance lives in
[`docs/development/`](docs/development/README.md).

## Product and target

Eidetic Player is a lightweight, touch-first network audio player. Its primary
target is a Raspberry Pi 3B connected to an 8-inch, 1280 × 800 landscape
touchscreen. Windows with Neutralino is the main development environment.

Lightness, responsiveness, predictable behavior, and touch usability are
product features, not optional optimizations.

## Non-negotiable architecture

- Keep the UI in vanilla TypeScript, semantic HTML, modern CSS, and Canvas 2D.
- Do not introduce React, Vue, Angular, Svelte, Electron, a CSS framework, or a
  runtime UI/animation library.
- Keep UI, Node backend, platform shell, playback, and analysis separated.
- The UI must use `PlatformBridge`; components must not call Neutralino APIs.
- MPV owns playback and audio output. Node controls it through JSON IPC.
- FFmpeg is an optional sidecar for analysis and waveform extraction. It must
  never become the playback engine or block playback.
- Ordinary commands use REST. Player state uses its existing SSE stream.
  High-frequency visualizer data uses its separate stream.
- Shared contracts belong in `packages/shared`; do not duplicate API types.
- Do not access `fetch`, local storage, or native APIs ad hoc in components.
  Use the central clients, stores, persistence module, and platform bridge.

See [architecture guidelines](docs/development/architecture.md).

## UI and interaction requirements

- Design first for physical touch at 1280 × 800, not for desktop mouse density.
- Preserve established touch targets, artwork geometry, and the centered
  transport layout unless the current step explicitly changes them.
- Use Pointer Events and real semantic controls. No required hover behavior.
- Every state change and load must be seamless:
  - no white flash;
  - no blank intermediate surface;
  - no unintended layout shift;
  - no scroll jump;
  - no stale artwork associated with new metadata;
  - no full-screen or full-component reconstruction for a small update;
  - no visibly unstable queue rows.
- Reserve final dimensions before asynchronous content arrives. Keep a dark,
  stable placeholder until artwork has decoded and is safe to swap.
- Animations must be short, optional, and limited mainly to `transform` and
  `opacity`. Honor both the app setting and `prefers-reduced-motion`.
- Treat the top bar, mini-player, Home, transport, Queue, and toast as shared
  regression surfaces for every UI change. Scope new CSS to its owning
  component; do not add or broaden selectors for `svg`, `path`, `button`, or
  `.icon` without a documented reason and focused regression coverage. Verify
  these shared controls visually in the real app with `npm.cmd run dev` on
  Windows before accepting a UI step.

See [touch UI and seamless rendering](docs/development/ui-ux.md).

## Performance rules

- Treat Raspberry Pi 3B constraints as the default design budget.
- Do not add polling, duplicate timers, duplicate observers, duplicate SSE
  connections, or duplicate `requestAnimationFrame` loops.
- Never rebuild the Queue on playback-position or visualizer ticks.
- Key queue rows by stable session IDs and update only changed fields.
- Keep high-frequency data out of the global player store and normal state SSE.
- A visualizer retains only the newest frame; stale frames are dropped.
- Preallocate and reuse hot-path arrays. Avoid per-frame object churn.
- Do not read layout or resize Canvas backing stores inside a render loop.
- At most one realtime FFmpeg analyzer and one waveform process may exist.
- Mode `none`, leaving Now Playing, pause, stop, and shutdown must release
  realtime work as defined by the existing lifecycle.
- New dependencies need a concrete justification, bundle/runtime impact review,
  and a lighter-alternative check.

See [performance and realtime guidance](docs/development/performance.md).

## Queue, artwork, and state integrity

- The media session and Queue start empty on every application launch.
- Opening one file builds the complete non-recursive parent folder in natural
  order and starts the exact selected file without briefly loading track one.
- Opening multiple files uses only the explicit selection and preserves its
  order. Queue `Add Files` appends without expanding a folder.
- Queue item IDs must remain stable across ordinary state updates.
- Artwork requests and async metadata results must be tied to stable IDs and a
  generation token. Obsolete results must be ignored or aborted.
- Prefer the correct placeholder over displaying stale or incorrect artwork.
- Never expose local paths, artwork buffers, or base64 images in UI state/SSE.

## Safety and security

- Validate all paths, extensions, request bodies, IDs, MIME types, and image
  signatures at backend boundaries.
- Never build shell commands by string concatenation. Spawn executables with
  argument arrays.
- Do not expose stack traces or local filesystem paths to the UI.
- Do not weaken CORS, Neutralino allowlists, or endpoint validation for
  convenience.
- Do not modify, rename, or delete users' media during tests.
- Never commit test music, personal paths, credentials, `.env`, or generated
  temporary media.

See [security and accessibility](docs/development/security-accessibility.md).

## Required workflow

1. Read the relevant code, current docs, and the latest applicable file under
   `prompts/` before editing.
2. Reproduce reported defects before changing code. Capture a measurable
   baseline for performance or rendering defects.
3. Implement only the current step. Avoid speculative features and broad
   refactors.
4. Preserve unrelated user changes and all behavior outside the step scope.
5. Add focused regression tests for every fixed defect.
6. Test the actual Neutralino → backend → MPV/FFmpeg path when the change
   affects native dialogs, playback, Queue, artwork, seek, or visualizers.
7. Run the relevant checks, normally:
   - `npm run format:check`
   - `npm run typecheck`
   - `npm run lint`
   - `npm run build`
   - `npm test`
   - `npm run mpv:doctor` and `npm run test:mpv` when relevant
   - `npm run ffmpeg:doctor` and `npm run test:ffmpeg` when relevant
8. Verify clean shutdown: no residual MPV, FFmpeg, Neutralino, Node, Vite,
   sockets, or generated temporary artwork.
9. Save the final report to `prompts/step<number>_output.md`. Do not overwrite
   previous step reports. The saved file must match the final task summary.

See [workflow, testing, and non-regression rules](docs/development/workflow.md)
and [real-system testing](docs/development/testing.md).

## Definition of done

A step is complete only when:

- requested behavior works through the real application path;
- static checks and relevant automated tests pass;
- 1280 × 800 touch UI has been inspected;
- no white flashes, layout shifts, stale asynchronous content, or avoidable
  reconstruction were introduced;
- relevant MPV/FFmpeg/Neutralino integration was tested, or a precise,
  explicit limitation was recorded;
- shutdown is clean;
- documentation and the required step output are updated.
