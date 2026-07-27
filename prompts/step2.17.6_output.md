# Step 2.17.6 — Settings Persistence Across Updates

## Status

`READY FOR CI VALIDATION — RASPBERRY SETTINGS MIGRATION NOT DEPLOYED`

No commit, push, merge, rebase, Raspberry update, or Raspberry mutation was
performed.

## Baseline

- Branch: `main`.
- Local HEAD and `origin/main`:
  `8bd1721d2bf40ecb118972ddc1f06a222b03180e`.
- Ahead/behind: `0/0`.
- Worktree before the step: clean.
- Step 2.17.5: present.
- Exact-head GitHub Actions run: `30295462102`, green.
- Initial `git diff --check`: PASS.

## Raspberry read-only audit

The mandatory visible OpenSSH audit completed before repository changes.
Passwords were entered only in the OpenSSH prompt. No `sudo`, service action,
update, mount, preference change, database parser, or remote write was used.

- Installed Build ID: `6a41970`.
- Full commit:
  `6a4197015af3e1872575f900b49436502dae4441`.
- Current release:
  `/opt/eidetic-player/releases/20260727T182043Z-6a41970`.
- Previous release:
  `/opt/eidetic-player/releases/20260727T143500Z-6f49d17`.
- Runtime user: `daniele`, UID/GID `1000/1000`.
- Service: active.
- ExecStart:
  `/opt/eidetic-player/current/bin/eidetic-player-launch`.
- Backend:
  `/opt/eidetic-player/node/current/bin/node`
  `/opt/eidetic-player/current/backend/apps/backend/src/index.js`.
- Neutralino:
  `/opt/eidetic-player/current/eidetic-player`.
- Working directory and HOME: `/home/daniele`.
- No `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, or `XDG_CACHE_HOME` override was
  present. `XDG_RUNTIME_DIR=/run/user/1000`.
- Neutralino application ID: `dev.eidetic.player`.
- Neutralino server: enabled, `port: 0`, URL `/`.
- Neutralino configuration hash was identical in current and previous.
- WebKit localStorage profile:
  `~/.local/share/eidetic-player/localstorage`.
- Relevant files were private to `daniele` but named by origin, for example
  `http_127.0.0.1_38219.localstorage` plus WAL/SHM. Many other files existed
  for ports `33025`, `33141`, `34417`, `38489`, `38757`, `40843`, `42065`,
  `43237`, `43963`, and `46557`.
- `sqlite3` was not installed. The audit did not install a parser, use
  `strings`, or inspect database contents.

Separate-store controls:

- Audio Output preference: present.
- SMB: one configured and connected share.
- Queue count: 15.
- Player session: present through the running player/session state.
- Favorite counts were not exposed by the audited bootstrap and were not
  guessed.
- No credential, media path, track title, NAS filename, cookie, cache, or
  browser history was printed.

## Root cause

Classification: **B — ORIGIN CHANGE**.

Neutralino uses an ephemeral loopback port. WebKitGTK keys localStorage by the
complete HTTP origin, so each changed port creates or selects a different
`http_127.0.0.1_<port>.localstorage` database. The profile itself remains in a
stable XDG data directory and is neither release-local nor removed by update.

| Level          | Before update/restart                        | After update/restart        | Evidence                             |
| -------------- | -------------------------------------------- | --------------------------- | ------------------------------------ |
| Release path   | timestamped release                          | another timestamped release | `current` and `previous` targets     |
| WebView origin | `http://127.0.0.1:<port A>`                  | `http://127.0.0.1:<port B>` | `port: 0` and origin-named databases |
| Profile path   | `~/.local/share/eidetic-player/localstorage` | same                        | read-only metadata audit             |
| Storage file   | `<port A>.localstorage`                      | `<port B>.localstorage`     | multiple dated SQLite/WAL/SHM sets   |
| Ownership      | `daniele:daniele`                            | `daniele:daniele`           | metadata audit                       |
| Legacy keys    | available only to matching origin            | not reliably visible        | Web storage origin isolation         |

The evidence excludes release-specific profile, HOME/XDG change, profile
cleanup, private mode, and ownership failure. It also explains why a
localStorage compatibility mirror would not help a restarted legacy rollback:
that process would receive another origin. The implementation therefore does
not add an ineffective mirror.

## Backend-authoritative store

- Shared contract: `packages/shared/src/preferences.ts`.
- Service: `PreferencesStore`, isolated from Player, Audio Output, SMB,
  Network, and Library services.
- Linux path:
  `${XDG_CONFIG_HOME:-$HOME/.config}/eidetic-player/preferences.json`.
- Windows path: canonical backend roaming config root,
  `Eidetic Player/preferences.json`.
- Schema: version 1.
- Revision: monotonic integer.
- POSIX directory mode: `0700`.
- POSIX file/backup/temp mode: `0600`.
- Symlink file/root, non-regular file, wrong owner, and non-canonical root are
  rejected/degraded.
- Writes use same-directory exclusive temp creation, file `fsync`, atomic
  rename, and parent `fsync` on POSIX.
- A previous valid document is atomically retained as
  `preferences.json.bak`.
- Verification rereads and validates the committed revision.
- Malformed main plus valid backup yields in-memory `recovered` without
  overwriting corrupt evidence.
- Invalid main and backup yield degraded read-only defaults and preserve both.
- Future schema yields degraded read-only defaults and preserves the file.
- Invalid known values fall back per field in memory and are not rewritten by
  an unrelated patch.
- Unknown top-level, migration, and preference fields are preserved.
- Schema 0 has a pure in-memory migration to schema 1 and writes only on the
  next explicit patch.

The JSON contains exactly the 18 UI preferences requested:

- animations;
- visualizer;
- main player;
- timeline style/time mode;
- volume/mute/shuffle/repeat;
- folder view/sort;
- music browsing;
- return timeout;
- Library segment/album view;
- Favorites segment/album view;
- on-screen keyboard.

It contains no Audio Output ID, SMB record/username/password, Library,
Favorites, Playlist, history, Queue, current media, media path, Build ID,
hostname, or OS username.

## Bootstrap and API

`GET /api/bootstrap` now returns the preference snapshot after backend store
initialization. The UI keeps the canonical splash until the snapshot and any
safe legacy migration complete, initializes AppStore from backend values, and
only then mounts the meaningful UI. localStorage cannot overwrite bootstrap.

Endpoints:

- `GET /api/preferences`;
- `PATCH /api/preferences`;
- `POST /api/preferences/migrate-legacy`.

Mutation endpoints require JSON, have a 16 KiB body bound, reject unknown
top-level and preference keys, validate every value, and return no path or raw
invalid data. PATCH is partial and uses `expectedRevision`; HTTP 409 causes
the UI to reload the latest revision and reapply only still-dirty fields.

## Legacy migration and fallback

The automatic adapter calls `getItem` only for the exact known keys. It never
enumerates localStorage and never reads/deletes cookies, sessionStorage,
IndexedDB, cache, history, or third-party keys. Empty, absent, invalid, valid
non-default, boolean, numeric, enum, and legacy `spectrum` values are covered;
`spectrum` maps to `spectrumMono`.

- New profile plus accessible empty localStorage: `not-found`.
- Valid visible keys: one idempotent import, state `imported`.
- Existing app data plus no visible old-origin keys: `manual-required`.
- localStorage exception: `manual-required`.
- Existing completed migration: a second automatic import is a no-op.

The safe fallback is `scripts/import-preferences.mjs`. It:

- reads the preference object from stdin, never argv;
- accepts only the 18 non-sensitive keys;
- has a 16 KiB bound;
- tolerates the initial BOM emitted by Windows PowerShell pipelines;
- sends only to fixed loopback `127.0.0.1:4310`;
- requires backend overwrite confirmation;
- prints only field count and revision.

End-to-end isolated Windows proof:

1. prior-app marker plus no visible legacy keys produced
   `manual-required`, revision 1;
2. stdin import of four non-default values produced `manual`, revision 2;
3. an object containing `password` was rejected locally with exit 65;
4. revision and saved volume remained unchanged after rejection.

## Saving lifecycle

- Existing `save…` wrappers now update one authoritative in-memory controller.
- UI state changes immediately.
- Dirty fields coalesce with a 300 ms trailing debounce.
- Requests serialize.
- Semantically unchanged player snapshots do not issue PATCH or increment
  revision.
- Volume remains immediate through PlayerService, while persistence is
  debounced and flushed on pointer/key commit.
- Flush runs before accepted Power actions, on `pagehide`, hidden visibility,
  `beforeunload`, app destroy, and test teardown.
- Flush is bounded to 1.5 seconds.
- A save has at most three automatic retries with bounded backoff.
- Failed values remain dirty/in memory.
- One warning episode says:
  `Settings could not be saved. They will be retried.`
- A later successful modification/flush closes the warning episode.

## Update, rollback, uninstall, and separate stores

- The config root is outside `/opt/eidetic-player`, `current`, and `previous`.
- Installer/update scripts do not copy, replace, or remove it.
- Updater no-op does not call the preferences API.
- Ordinary uninstall already preserves the whole application config root.
- Existing strongly confirmed `--purge-data --yes-really-purge-data` removes
  it as application data; no delete contract changed.
- Restore/rollback never copy preferences from a release.
- A shared-config release/current/previous test proves identical values and
  revision across new service instances.
- Audio Output, SMB/credentials, SQLite Library/Favorites/history/playlists,
  Queue, and player-session implementations were not modified.

## Automated tests

Focused tests cover:

- absent file/defaults/first write;
- new-profile `not-found`;
- automatic and second idempotent migration;
- manual-required/confirmation/manual import;
- all whitelist reads, absent/empty/invalid values, `spectrum`, exception, and
  no enumeration/delete;
- schema 0, schema 1, and future schema;
- partial corruption and unknown-field preservation;
- revision increment/conflict/concurrent serialization;
- corrupt-main backup recovery;
- temp cleanup and private POSIX modes;
- symlink-root protection on POSIX;
- release switch, restart, rollback, and no-op revision;
- coalescing, immediate memory state, bounded retry, recovery, conflict
  reapply, destroy cleanup, and unchanged-state suppression;
- existing Power, Settings, Cassette, and Recently Played regressions.

## Windows Neutralino/WebView2 QA

Required command used exactly: `npm.cmd run dev`, with
`EIDETIC_MPV_PATH=C:\Tools\mpv\mpv.exe`.

- MPV doctor: PASS, mpv `v0.41.0-744-g304426c39`, JSON IPC PASS.
- Real existing Windows profile automatic migration: PASS (`imported`).
- The preference files created by that proof were removed afterward; legacy
  localStorage was not deleted.
- Isolated new profile: `not-found`, persisted schema 1.
- Mouse changed Animations On → Off: API/file updated.
- App restart: Off remained authoritative.
- Revision at restart and after two-second settling: `3` → `3`.
- Mouse restored On, then changed Off for Power Quit proof.
- Power → Quit through the real UI: saved Off at revision 5 and closed cleanly.
- File contained 18 preference fields and no credential/password/media-path
  marker.
- 1280 × 800 client viewport: Now Playing, drawer, Settings root, Interface,
  and Power surfaces visually PASS.
- 1024 × 600 client viewport: drawer, Settings Interface, selected Off state,
  mini-player, and Quit confirmation visually PASS.
- No flash of defaults was observed on restart; Off was already selected on
  the first inspected Interface render.
- Touch scrolling code, Queue, Now Playing, Audio Output, and shared layout CSS
  were unchanged.
- One limitation: the first QA launch expanded environment variables too
  early and used the normal Windows profile. The new preference files were
  moved out and then removed, but the normal player-session file was touched
  by the ordinary launch/quit lifecycle before an isolated rerun. No media,
  Queue command, Audio Output, SMB, Library, or Favorite mutation was issued.

Cleanup:

- Neutralino/backend/Vite/MPV: no residual process.
- Ports 4310/5173: closed by the dev orchestrator.
- Isolated profiles, screenshots, SSH audit controller, and the temporary
  preference backup were moved to the Windows Recycle Bin.
- No real `preferences.json` created by QA remains.

## Documentation

Added `docs/development/preferences.md` and updated architecture, Linux paths,
testing, remote Raspberry procedure, and the development documentation index.
The documentation covers authority, schema, modes, atomic writes, migration,
fallback, warning behavior, exclusions, update/rollback, uninstall/purge, and
post-CI device validation.

## Package plan and protected diffs

- `package.json`: unchanged.
- `package-lock.json`: unchanged.
- Dependencies: unchanged.
- GitHub workflows: unchanged.
- Installer/updater/uninstaller: unchanged.
- SMB, Network, Audio Output, Library, Player, reliable touch scroll, Now
  Playing, and SMB helper: unchanged.

## Final local gates

The final gate block is recorded after the one complete end-of-step run:

- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd run build:linux`: PASS.
- `npm.cmd test`: PASS, 557 tests, 546 passed, 11 expected skips.
- `npm.cmd run test:posix`: PASS, 3 passed, 2 expected Windows skips.
- `npm.cmd run verify:network:deployment`: PASS.
- `npm.cmd run verify:linux:executables`: PASS.
- `npm.cmd run verify:linux:installer`: PASS, including 71 installer tests
  with 60 passed and 11 expected platform skips.
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`:
  PASS.
- `npm.cmd run mpv:doctor`: PASS.
- `npm.cmd run test:mpv`: PASS, 9/9.
- `npm.cmd run ffmpeg:doctor`: PASS.
- `npm.cmd run test:ffmpeg`: PASS, 3/3.
- `git diff --check`: PASS.

Four legacy source-contract tests were updated during the final run because
they still asserted direct old-storage parsing/bootstrap implementation
details. They now verify the shared preference contract and
backend-authoritative bootstrap while retaining their original behavior
coverage.

## Post-CI Raspberry track

Not started, by design. Commit/push, exact-head CI, the complete Raspberry
test vector, update, automatic/manual migration result, file mode/owner check,
service restart, updater no-op, separate-store regression, restoration of
original values, and final remote cleanup remain the authorized post-CI phase.

The final device status
`RASPBERRY SETTINGS PERSISTENCE ACROSS UPDATE — PASS` is not claimed.
