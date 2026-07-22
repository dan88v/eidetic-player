# Step 2.8.2 — Favorite Albums and Artists

Date: 2026-07-22

## Result

Step 2.8.2 is complete without starting Recently Played, Playlists, Vinyl
Player, or another product step.

## Schema v4

- Library schema v4 adds dedicated `favorite_albums` and `favorite_artists`
  tables containing only the stable entity ID and `created_at`.
- Both tables use real foreign keys with `ON DELETE CASCADE` and indexed
  newest-first ordering with the entity ID as stable tie-breaker.
- The v3-to-v4 migration is transactional. Tests also cover v1 and v2 upgrades
  through v4, foreign keys, recovery, idempotency, timestamps, pagination,
  query plans, definitive cascade, and preservation while a Source is
  unavailable or removed.
- Favorite Tracks and media files are unchanged.

## API and stores

- Added bounded keyset pages, totals/available counts, batch status, idempotent
  PUT/DELETE mutations, and category Play endpoints for Albums and Artists.
- Responses contain stable opaque IDs and display metadata only; no native path
  enters an API response.
- Track, Album, and Artist stores share the same 512-entry bounded optimistic
  implementation and batch at most 192 visible IDs. Failed mutations roll back
  and notify every mounted copy without polling or another EventSource.

## Favorites UI

- Favorites now has an accessible persistent `Tracks | Albums | Artists`
  segmented control, defaulting to Tracks, with no Search or configurable sort.
- Favorite Tracks retains its existing list and direct selected-Track playback.
- Favorite Albums reuses Library Album geometry with an independent Grid/List
  preference that defaults to Grid and preserves the current-session state.
- Favorite Artists uses the established touch list with counts, availability,
  chevron, heart, and sibling menu.
- The approved empty states are `No favorite albums yet` and
  `No favorite artists yet`.

## Hearts and menus

- Album hearts are present on Library Grid/List cards, Album detail, grouped
  and View-all Search, and Favorite Albums.
- Artist hearts are present on Library Artist rows, Artist detail, grouped and
  View-all Search, and Favorite Artists.
- Hearts are semantic 44 px sibling buttons with `aria-pressed`, dynamic
  Add/Remove labels, optimistic synchronization, rollback/error toast, and no
  success toast. They neither open details nor start playback.
- Album and Artist menus expose single-entity Play, Add to Queue, and exact
  Add/Remove Favorite wording. Menu mutations use the same store/API and show
  the shared success toast.

## Playback and unavailable state

- Album Play all orders favorite Albums newest-first, keeps the existing
  disc/track/title/ID order inside each Album, excludes unavailable Tracks,
  explicitly deduplicates by Track ID, and performs one atomic Queue replace.
- Artist Play all concatenates each newest-first Artist context using the
  existing compilation/collaboration order, deduplicates globally by Track ID,
  excludes unavailable Tracks, and performs one atomic Queue replace.
- A single Album/Artist menu always uses only that entity's established context.
- Fully unavailable Album/Artist Favorites remain visible, openable, and
  removable. Their Play/Add actions and category Play all are disabled; removal
  of a Source does not delete the Favorite.

## Tests and real QA

Focused database/store/UI/playback tests passed during development, including
schema upgrade paths, indexed ordering, status batching, optimistic rollback,
segmented persistence, approved surfaces, dedicated category endpoints, Album
ordering, Artist collaboration deduplication, unavailable preservation, and
unchanged Favorite Track playback.

The real `npm.cmd run dev` Neutralino/WebView2 path was tested with an isolated
temporary profile and generated FLAC/artwork fixture. QA covered:

- Tracks, Album Grid and List, Artist list, switching and persistence;
- Library root, Album/Artist detail, grouped Search, and View-all Search hearts;
- heart removal without a toast and menu removal with the success toast;
- Album and Artist detail navigation and sticky Back header;
- Album Play all producing a two-Track Queue and Artist Play all producing a
  six-Track Queue from the complete category context;
- empty Album/Artist states and a removed-Source fixture with totals `1/0` for
  both entity categories;
- Default Player, Cassette Player, mini-player, Queue drawer, and shared toast
  regression surfaces;
- exact client viewports 1280 × 800, 1280 × 720, and 1024 × 600 with no
  horizontal overflow, clipping, nested controls, or unstable layout.

The app closed normally. Neutralino, backend, Vite, MPV, FFmpeg, ports 4310 and
5173, the isolated database/profile, generated media, and temporary screenshots
were all cleaned up. No user Library or media was read or modified.

## Final checks

- `npm.cmd run format:check` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run lint` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 309 tests, 307 passed and 2 platform skips.
- `git diff --check` passed.

Linux CI remains pending until these uncommitted changes are published by the
user. No standalone benchmark or MPV/FFmpeg doctor was run because
playback/process code was not modified.

No commit, push, merge, rebase, reset, restore, stash, or clean was performed.
