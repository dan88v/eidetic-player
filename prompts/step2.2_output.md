# Step 2.2 — Real metadata and artwork

Date: 2026-07-17

## Outcome

Step 2.2 is complete. The backend now enriches MPV state asynchronously with
real metadata parsed by `music-metadata`, resolves embedded or folder artwork,
serves images through opaque safe endpoints, preloads only the next track, and
keeps bounded session caches. The frontend uses one reusable artwork component
in Now Playing, the mini-player, and Queue without changing the approved
geometry.

MPV remains authoritative for playback state, position, playback duration,
effective codec and sample rate, audio device, pause, Queue, volume, mute,
Shuffle, and Repeat. Parser results enrich textual tags, container details,
reliable bit depth fallback, bitrate, lossless state, and artwork. Empty parser
values never replace valid MPV values.

No SQLite library, folder index, online lookup, thumbnail generation, base64
payload, image processing backend, worker, polling, or real audio visualizer was
introduced. Step 2.3 was not started.

## Architecture

`MetadataService` normalizes title, artist/artists, album, album artist,
track/disc numbers and totals, year, genre, duration, codec, container, sample
rate, bit depth, bitrate, lossless, and pictures. Its 128-record LRU cache is
keyed by canonical path, size, and modification time. Picture buffers are
transient and are not stored in the metadata cache.

`ArtworkService` validates declared MIME and JPEG/PNG/WebP signatures, rejects
images over 15 MiB, creates opaque UUIDs, maintains a registry limited to 64
records and 128 MiB, revalidates folder files before streaming, and cleans
embedded files on eviction/shutdown. Embedded files use:

`<os.tmpdir()>/eidetic-player-artwork-<pid>-<session-uuid>/`

The current parser chain has concurrency 1, the next-track preload chain has
concurrency 1, and Queue artwork resolution is limited to 2. Generation and
path checks prevent stale results from being applied after rapid track changes.

Artwork priority is:

1. embedded front cover;
2. embedded normal cover;
3. first valid embedded picture;
4. case-insensitive `cover.jpg`, `cover.jpeg`, `cover.png`, `cover.webp`;
5. case-insensitive `folder.jpg`, `folder.jpeg`, `folder.png`, `folder.webp`;
6. case-insensitive `front.jpg`, `front.jpeg`, `front.png`, `front.webp`;
7. existing abstract placeholder.

## API and frontend

Implemented:

- `GET|HEAD /api/artwork/:artworkId`
- `GET|HEAD /api/player/queue/:queueItemId/artwork`

Responses include validated Content-Type, Content-Length for 200/HEAD,
`X-Content-Type-Options: nosniff`, private immutable caching, ETag, and
If-None-Match/304 support. Unknown IDs and traversal-like paths return 404.
Local artwork paths, Buffer data, and base64 are never added to SSE.

The shared `ArtworkRef` contains only opaque ID, MIME, source type, and
revision. The API client centrally creates artwork URLs; `music-metadata` is not
imported by the frontend and does not appear in the Vite output.

The reusable artwork component uses real `<img>` elements, async decoding,
generation guards, `object-fit: cover`, localized descriptive alt text in Now
Playing, and decorative images in mini-player/Queue. It preserves the
placeholder during loading and applies a 170 ms opacity transition only when
animations are enabled. Reduced-motion and Animations Off disable the
transition.

Queue uses one `IntersectionObserver` with a 120 px root margin, disconnects it
when closed/destroyed, avoids rebuilding rows for position-only SSE updates, and
loads at most two thumbnails concurrently. Current/next refs render directly;
other rows request only their own Queue endpoint.

## Files

Created:

- `apps/backend/src/artwork/artwork-service.ts`
- `apps/backend/src/metadata/enrichment-guard.ts`
- `apps/backend/src/metadata/metadata-merge.ts`
- `apps/backend/src/metadata/metadata-service.ts`
- `apps/backend/src/metadata/types.ts`
- `apps/backend/src/utils/limited-concurrency.ts`
- `apps/backend/test/artwork.test.ts`
- `apps/backend/test/concurrency.test.ts`
- `apps/backend/test/metadata.test.ts`
- `apps/ui/src/components/artwork.ts`
- `packages/shared/src/metadata.ts`
- `prompts/step2.2_output.md`

Modified:

- `package.json`
- `package-lock.json`
- `packages/shared/src/player.ts`
- `apps/backend/src/index.ts`
- `apps/backend/src/player/player-service.ts`
- `apps/backend/test/mpv.integration.ts`
- `apps/ui/src/api/player-api-client.ts`
- `apps/ui/src/components/app-shell.ts`
- `apps/ui/src/components/mini-player.ts`
- `apps/ui/src/components/queue-drawer.ts`
- `apps/ui/src/i18n/en.ts`
- `apps/ui/src/screens/now-playing.ts`
- `apps/ui/src/styles/components.css`
- `apps/ui/src/styles/screens.css`
- `apps/ui/src/utils/layout-diagnostics.ts`
- `README.md`
- `docs/architecture.md`
- `docs/ui.md`
- `neutralino.config.json` and generated `dist/` output

## Dependency and limits

- exact dependency: `music-metadata@11.14.0`
- reason: stable ESM parser with built-in strict TypeScript declarations,
  compatible with Node >=18 and the project's Node >=22.12/NodeNext setup
- direct dependencies added: 1
- packages added by npm: 12 total including transitive packages
- separate type package: none
- `npm audit`: 0 vulnerabilities
- metadata cache: 128 records
- artwork cache: 64 records / 128 MiB
- maximum single image: 15 MiB
- current parser concurrency: 1
- next preload concurrency: 1
- Queue artwork concurrency: 2 backend and 2 frontend

## Measurements

Generated silent 30-second WAV fixtures with real PNG folder artwork:

- MPV open command completion: approximately 208.66 ms
- current metadata/artwork ready: approximately 259.89 ms
- next metadata/artwork preload ready: approximately 270.06 ms
- backend snapshot private memory: approximately 66.71 MiB
- backend snapshot working set: approximately 2.42 MiB
- backend handles: 221
- representative SSE payload before Step 2.2 fields: 1,525 bytes
- representative enriched SSE payload: 2,258 bytes
- payload delta: 733 bytes

Frontend production bundle before/after:

- JavaScript: 50.75 kB → 54.50 kB raw; 15.16 kB → 16.47 kB gzip
- CSS: 26.63 kB → 27.49 kB raw; 5.36 kB → 5.47 kB gzip
- HTML: 0.43 kB raw, 0.27 kB gzip
- `music-metadata` matches in `dist/ui`: 0

At 1280 × 800, artwork bottom and meter graphic bottom remain 588 px, Play
center remains exactly 640 px, and horizontal overflow is absent. Center and
meter alignment differences remain 0 px at 1366 × 768, 1600 × 900,
1280 × 720, and 1024 × 600. The 1024 × 600 compact gaps remain symmetric.

## Tests and manual verification

- `npm audit`: passed, 0 vulnerabilities
- `format:check`: passed
- `typecheck`: passed
- `lint`: passed
- `build`: passed
- unit/UI tests: 32/32 passed
- MPV integration tests: 2/2 passed
- `mpv:doctor`: passed with
  `mpv v0.41.0-744-g304426c39`; headless startup and JSON IPC passed

Automated coverage includes metadata merge/fallbacks, technical normalization,
front-cover selection, first-valid fallback, JPEG/PNG/WebP signatures, false
MIME and size rejection, all artwork priorities, case-insensitive lookup,
absence handling, metadata/artwork cache invalidation, opaque IDs, unknown and
traversal IDs, embedded cleanup, stale generations, and Queue concurrency.

The real MPV integration uses generated silent WAV files and verifies metadata
enrichment, sample rate/bit depth, folder artwork, current/next Queue, Next,
Previous, Queue artwork resolution, and cleanup. Live checks additionally
verified JPEG/PNG folder artwork, placeholder fallback, HEAD 200, ETag 304,
unknown/traversal 404, Queue item-specific 200/404, rapid 1→0→1 selection with
matching final title/artwork, Now Playing rendering, mini-player/Queue geometry,
long title handling, and responsive layouts.

Shutdown through the Neutralino window message removed Neutralino, MPV,
backend, Vite, and project Node processes. Artwork temporary directory count
after shutdown is 0. Generated manual fixtures were also removed.

## Limits

No original or generated tagged MP3/FLAC encoder was available in the workspace,
so hands-on parsing of real embedded artwork in MP3 and FLAC was not possible.
Embedded extraction, priority, validation, opaque registration, temporary file
creation, streaming resource lookup, and cleanup were instead exercised with a
mockable `music-metadata` result and generated raster signatures. Complete and
missing tag behavior is covered by unit tests; live WAV verification covered
real parser technical metadata and filename/Unknown fallbacks.

The native Open Files dialog was not reopened during the final Step 2.2 run.
PlatformBridge was not modified, and all existing Neutralino selection/native
dialog mapping tests pass. Animations Off, OS reduced-motion, file removal
during playback, and repeated visual fade timing were verified structurally
rather than through a full manual interaction matrix.

No optimized thumbnails are generated; the browser/WebView scales original
validated artwork. This can be reconsidered later only if Raspberry Pi 3B
profiling demonstrates a need.

Official dependency reference:
https://www.npmjs.com/package/music-metadata
