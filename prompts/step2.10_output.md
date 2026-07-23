# Step 2.10 - Playlists and Queue drag reorder

## Implemented

- Library schema v7 adds strict `playlists` and `playlist_items` tables, cascade foreign keys, deterministic indexes, stable item IDs, duplicate Track support, and v1-v6 upgrade coverage.
- Playlist names are NFKC-normalized, trimmed, whitespace-collapsed, limited to 80 Unicode code points, and unique case-insensitively. Duplicate-name errors remain inline in the open dialog.
- Navigation is ordered Now Playing, Library, Folders, Favorites, Playlists, History, Sources, Settings. Playlists follows Library visibility and is hidden in Folders-only mode.
- The Playlists list uses the global title only, updated-descending order, artwork/placeholder, Track count, available duration, updated date, create, rename, delete, Play, and Add to Queue.
- The detail uses global Back/name/overflow actions, Play all, Add to Queue, duplicate-preserving ordered rows, Favorite, unavailable state, item actions, and handle-only Pointer Events reorder with capture, local preview, auto-scroll, one drop request, and rollback.
- The shared picker is available from Library Tracks (including album, artist and Search detail rows), Favorites, Recent/Most Played, Playlist detail, and the Queue footer. It supports existing or new Playlists, the existing on-screen keyboard contract, inline creation errors, and explicit duplicate confirmation on every repeated add.
- The Queue drawer retains Play, Remove, Clear Queue, focus behavior, keyed rows, and scroll. It adds handle-only Pointer Events reorder and a centered `Add to playlist` button beside `Clear Queue`; that action sends the complete ordered Queue and is enabled only when every item has a stable indexed Track ID.
- Playlist playback is built by the backend, excludes unavailable Tracks, preserves duplicates, and starts a selected non-first item directly. Queue append preserves ordered duplicates.
- MPV downward reorder translates the destination index to MPV's pre-removal coordinate system. Real-path verification confirmed one revision, unchanged current item ID, player session, track transition and audio position.

## Main files

- `packages/shared/src/library.ts`
- `apps/backend/src/library/library-migrations.ts`
- `apps/backend/src/library/library-repository.ts`
- `apps/backend/src/library/library-service.ts`
- `apps/backend/src/index.ts`
- `apps/backend/src/player/player-service.ts`
- `apps/ui/src/components/playlist-picker.ts`
- `apps/ui/src/components/queue-drawer.ts`
- `apps/ui/src/components/top-bar.ts`
- `apps/ui/src/screens/playlists.ts`
- `apps/ui/src/screens/library.ts`
- `apps/ui/src/screens/favorites.ts`
- `apps/ui/src/screens/recently-played.ts`
- `apps/ui/src/styles/components.css`
- `apps/ui/src/styles/screens.css`
- `apps/backend/test/library-playlists.test.ts`
- `apps/ui/test/step2.10.test.ts`

## Verification

- Focused database, migration, Queue builder, and Step 2.10 UI-contract tests passed.
- Final checks: `format:check`, `typecheck`, `lint`, `build`, `test`, and `git diff --check` passed.
- `npm.cmd run dev` launched the actual Neutralino -> backend -> MPV path. The real WebView2 window was inspected at 1280x800, 1280x720, and 1024x600 for navigation, header-only list, empty/populated states, create keyboard, normalized duplicate-name error, detail with duplicate items, global detail header, Queue rows, footer actions, and picker.
- The Queue layout regression found during QA was corrected and re-inspected. The real reorder endpoint was exercised on the current Track and restored afterward.
- Default Player and mini-player were visually unchanged. Cassette behavior is covered by the existing regression suite; it was not manually switched during this state-preserving QA pass.
- The Browser plugin could not bind to a browser in this session and its installed bootstrap recovery document was missing. Neutralino WebView2 rendering was therefore inspected directly through the real native window; pointer contracts were covered by focused tests, while automated physical drag injection was unavailable.
- QA Playlists were deleted, the original Queue order/current stable ID were restored, temporary screenshots/logs were deleted, and shutdown left no project processes or listeners on ports 4310/5173.
- Linux CI remains pending.
- No commit, push, merge, rebase, reset, restore, stash, or clean was run. No later step was started.
