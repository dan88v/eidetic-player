# Step 2.16.1 — Raspberry/Linux Favorites persistence regression

Date: 2026-07-26

## Result

`READY FOR CI VALIDATION`

The Raspberry failure was reproduced on the currently installed build and its
root cause was proven without updating or modifying that installation. The
minimal local fix and focused regression are ready for a new CI run.

This report does not claim a new GitHub Actions PASS.

## Baseline Git and CI

- Branch: `main`.
- Initial working tree: clean.
- `HEAD` matched `origin/main` with divergence `0 0`.
- Baseline commit: `f356e4be66e0f2c3404723521229d7fdd53302f8`.
- Step 2.15, Step 2.15.1-R1/R2, and Step 2.16 were present.
- GitHub Actions workflow `Eidetic Player CI` for the exact baseline commit
  completed successfully before changes began.
- No merge, rebase, reset, restore, stash, clean, commit, or push was run.

## Windows real baseline

The real Neutralino/WebView2 application was started with the mandatory
`npm.cmd run dev` command and the configured MPV executable.

A non-favorite indexed `<test-track>` from `<library-source>` was used:

- Add from the visible heart: PASS.
- Immediate heart update: PASS.
- Navigate away and return: persisted.
- Full application restart: persisted.
- Remove: PASS.
- Original Favorite count restored.
- No `Load failed` toast.
- Queue remained at 12 items with the same current item.
- Paused state, volume, mute, shuffle, and repeat remained unchanged.
- No MPV reload or unrelated player-session mutation occurred.
- Neutralino, backend, Vite, MPV, FFmpeg, and listeners shut down cleanly.

No personal media path, title, artist, album, or public ID is retained in this
report.

## Local Favorites architecture audit

- UI control: `createFavoriteTrackButton` backed by the shared optimistic
  Favorite store with rollback on failure.
- Client: `LibraryApiClient`.
- API: idempotent `PUT`/`DELETE`
  `/api/library/favorites/tracks/:trackId`, `GET` page, and `POST` batch status.
- Service: `IndexedLibraryService`.
- Repository: `LibraryRepository`.
- Persistence: the single indexed Library SQLite database, not JSON and not
  player session.
- Schema: current version 7; `favorite_tracks` was introduced in schema 3 and
  is keyed by the opaque Track ID with a foreign key to `tracks`.
- Idempotency: `INSERT ... ON CONFLICT(track_id) DO NOTHING`.
- Removal of an absent Favorite is a safe no-op.
- Database initialization creates the parent directory, enables foreign keys,
  bounded busy timeout, WAL, and migrations, and preserves a corrupt database
  before rebuilding.
- Windows data uses Local AppData; Linux uses `XDG_DATA_HOME` or the documented
  home-directory fallback. No path depends on `process.cwd()`.
- UI Favorite state uses the existing Library stream/store and does not mutate
  Queue or media.

## SSH and remote-build rules

- OpenSSH was opened interactively.
- The user entered the password only in the OpenSSH prompt.
- The password was not requested in chat, placed in argv or environment,
  written to a file, or included in this report.
- Host-key checking remained enabled.
- No updater, installer, `git pull`, `git fetch`, service restart, reboot,
  package installation, sudo, chmod, chown, backend replacement, or database
  edit was performed.
- The SSH control master and socket were closed after the audit.

The user described the installed build as updated the previous evening.
Installed provenance was available and identified commit `a2932f5ac740`, which
is present in local history and predates the current Step 2.14–2.16 work. It
was used only to reproduce and diagnose the pre-existing Favorites defect.

## Remote read-only storage audit

- Platform: Raspberry Pi 3 on Debian 13 family.
- Eidetic user service: active.
- Backend health: HTTP 200.
- Effective storage: `<favorite-storage>` under the runtime user's Linux data
  directory.
- SQLite schema: 7.
- `favorite_tracks`: present.
- `PRAGMA quick_check`: `ok`.
- Journal mode: WAL.
- Indexed Tracks: 149.
- Initial Favorites: 0.
- Parent and database owner: matches `<runtime-user>`.
- Parent mode: `0775`; database mode: `0644`.
- Runtime user read/write/traverse: PASS.
- Filesystem: ext4, mounted read/write, sufficient space.
- Database symlink: no.
- Residual Favorite temporary files: none.

The modes are broader than a newly designed private store would require, but
the runtime user owns and can write both locations. They did not cause this
failure, so no speculative permission or installer change was made.

## Raspberry current-build reproduction

The user selected one already indexed USB `<test-track>` and pressed Add to
Favorites exactly once.

- Initial Track ID contract: valid opaque indexed Track ID.
- Initial Favorite state: false.
- Initial Favorites count: 0.
- Queue: 12 items, paused, no player error.
- Observed toast: `Load failed`.
- SQLite Favorite count after the tap: 0.
- Database and WAL timestamps: unchanged by the tap.
- Journal/backend error: none for the Favorite route.
- Classification: the browser blocked the mutation before the `PUT` reached
  the backend.

Source matrix:

| Source | Add                                     | Remove                      | Restart persistence |
| ------ | --------------------------------------- | --------------------------- | ------------------- |
| Local  | NOT TESTED                              | NOT TESTED                  | NOT TESTED          |
| USB    | FAIL in UI; PASS through controlled API | PASS through controlled API | NOT TESTED          |
| SMB    | NOT TESTED                              | NOT TESTED                  | NOT TESTED          |

The cause is transport-global and independent of source identity, so redundant
physical source tests were not performed.

`RASPBERRY CURRENT-BUILD FAVORITES REPRODUCTION — PASS`

## Controlled localhost API and backup

After explicit user confirmation:

1. A private temporary directory outside the repository was created as
   `<runtime-user>`.
2. The live SQLite online-backup API produced a coherent backup.
3. Backup mode matched the source, count matched, and integrity was `ok`.
4. Add returned HTTP 200 and `isFavorite: true`.
5. Duplicate Add returned HTTP 200, remained true, and kept count 1.
6. GET returned the expected count.
7. Remove returned HTTP 200 and `isFavorite: false`.
8. Final GET returned the original count 0.
9. Final live integrity was `ok`.
10. The verified backup and temporary directory were removed.

No record, media path, title, or complete ID was printed into the repository or
report.

## Root cause

The production Raspberry WebView calls the backend loopback URL cross-origin.
Favorite Add uses HTTP `PUT`, so the browser first sends an `OPTIONS`
preflight.

The installed backend returned:

- preflight status: HTTP 204;
- allowed origin: restricted loopback origin;
- allowed headers: `content-type`;
- allowed methods: `GET, POST, PATCH, DELETE, OPTIONS`.

`PUT` was absent. WebView therefore rejected the Favorite request with the
network-level `Load failed` message before SQLite or the Favorite route could
run. A direct localhost `PUT` succeeded because it did not enforce browser
CORS.

The same missing verb was present in current `main`; this is **Case A — defect
present in current main**.

## Local fix

The existing loopback-only CORS methods now include `PUT`:

`GET, POST, PUT, PATCH, DELETE, OPTIONS`

Security boundaries are unchanged:

- allowed origins remain only `localhost` and `127.0.0.1`;
- there is no wildcard origin;
- no remote host, extra header, credential mode, or API route was enabled;
- Favorite persistence, optimistic rollback, UI copy, and toast behavior are
  unchanged.

Installer impact: none.

Doctor impact: none. Storage, schema, integrity, ownership, and permissions were
healthy, so a Favorites storage doctor would not diagnose this transport bug.

## Tests

The new regression:

- proved failure before the fix;
- verifies Favorite Add uses `PUT`;
- requires the production loopback CORS contract to include `PUT`;
- preserves the two exact loopback-origin checks;
- rejects wildcard-origin broadening.

Focused tests passed after the fix for:

- production Favorite CORS;
- Track Add, duplicate idempotency, Remove, absent Remove, paging, unavailable
  retention, and foreign-key cleanup;
- Album and Artist Favorite persistence;
- optimistic UI update and rollback;
- Favorites navigation, geometry, playback context, and Queue separation.

Existing database tests cover parent creation, first initialization,
migrations, corruption preservation, Windows and Linux data paths, Unicode,
spaces, apostrophes, case-sensitive Linux identities, failure handling,
concurrency, restart persistence, and working-directory independence.

## Windows post-fix smoke

The real app was run again at the 1280 × 800 target:

- browser-style Favorite `PUT` preflight: HTTP 204 with `PUT` allowed;
- Add from the UI: PASS;
- duplicate Add through the API: PASS with no duplicate;
- Remove from the UI: PASS;
- restart persistence and original Favorite count: PASS;
- Queue remained 12 items with the same current index;
- MPV remained available and paused without error;
- Audio Output, Network, Power drawer, top bar, mini-player, touch geometry,
  scrolling, and toast surfaces remained intact;
- final shutdown left no app processes or dev listeners.

No real Windows network, audio-output selection, media file, or source was
modified.

## Final gates

The complete final gate set passed:

| Gate                                                                    | Result                         |
| ----------------------------------------------------------------------- | ------------------------------ |
| `npm.cmd run format:check`                                              | PASS                           |
| `npm.cmd run typecheck`                                                 | PASS                           |
| `npm.cmd run lint`                                                      | PASS                           |
| `npm.cmd run build`                                                     | PASS                           |
| `npm.cmd run build:linux`                                               | PASS                           |
| `npm.cmd test`                                                          | PASS — 502 pass, 10 skip       |
| `npm.cmd run test:posix`                                                | PASS — 3 pass, 2 platform skip |
| `npm.cmd run verify:network:deployment`                                 | PASS                           |
| `npm.cmd run verify:linux:executables`                                  | PASS                           |
| `npm.cmd run verify:linux:installer`                                    | PASS                           |
| `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build` | PASS                           |
| `npm.cmd run mpv:doctor`                                                | PASS                           |
| `npm.cmd run test:mpv`                                                  | PASS — 8 pass                  |
| `git diff --check`                                                      | PASS                           |

Linux root staging: NOT RUN.

## Remote restoration and cleanup

- Favorite count restored to the initial value 0.
- Test item absent.
- SQLite integrity: `ok`.
- No direct database modification or restore was needed.
- No temporary backup or audit directory remained.
- Service remained active.
- Media, Queue, playback files, permissions, installation, and systemd unit
  were not modified.
- SSH master closed.
- Local temporary screenshots, logs, and PID files are removed during final
  cleanup.

## Raspberry updated-build validation

`RASPBERRY UPDATED-BUILD FAVORITES VALIDATION — NOT TESTED`

Future checklist, only after the user explicitly confirms a successful
Raspberry update:

1. Verify the installed commit/version.
2. Start Eidetic normally.
3. Add and Remove a local Track Favorite.
4. Repeat Add and verify idempotency.
5. Restart Eidetic and verify persistence.
6. Verify USB Favorite when available.
7. Verify SMB Favorite when available.
8. Confirm no `Load failed`.
9. Confirm Queue and playback remain unchanged.
10. Run the read-only doctor and inspect sanitized logs.

## Files changed

- `apps/backend/src/index.ts`
- `apps/backend/test/favorites-cors.test.ts`
- `docs/development/library-index.md`
- `prompts/step2.16.1_output.md`

No commit or push was performed.
No Raspberry update or reinstall was performed.
