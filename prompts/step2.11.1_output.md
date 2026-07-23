# Step 2.11.1 — USB Library Integration

## Result

Implemented optional persistent Library integration for an already-mounted USB
root or subfolder while preserving USB Quick Browse as an independent path.

## Source model and identity

- Added persistent Source type `removable`.
- The repository is version 2 and still reads existing version 1 local Sources.
- A removable Source persists its stable Source ID, display name, backend-only
  stable volume identity, logical relative root, and timestamps.
- Drive letter, mount point, current native root, raw stable identity, and
  absolute paths do not reach public contracts or persisted removable records.
- Every open, scan, and playback operation resolves the current mounted root
  from stable identity and revalidates containment, directory readability,
  traversal, mixed separators, null bytes, and symlink/junction exclusion.

## Add, coverage, and first scan

- The canonical USB directory header now places `Add this folder to Library`
  beside Play, including at device root.
- Successful addition stays in USB Quick Browse, changes the action to
  non-interactive `In Library`, and relies only on the existing scan progress
  toast.
- The root defaults to the volume label; a subfolder defaults to its logical
  basename.
- Same, parent, and child overlap on one stable volume are blocked with
  segment-aware and platform-case-aware comparisons. Siblings are allowed;
  Unicode and `Music`/`MusicBackup` are covered by tests.
- Concurrent duplicate submits are serialized.
- Exactly the new Source is queued once in the existing single scheduler.
  Pending work is deduplicated and removed if the Source is removed.

## Sources, Folders, and Library

- Sources keeps live `USB Storage` devices separate from persistent
  `USB Library Folders`.
- Persistent USB folders remain visible when unavailable and reuse the
  canonical Open, Rescan, Rename, and non-destructive Remove actions.
- Folders root includes removable Sources with the dedicated USB storage icon
  and availability state.
- Valid scans feed the ordinary Albums, Artists, Tracks, Search, Favorites,
  Playlists, History, Most Played, Stats, artwork, metadata, contextual
  playback, and `libraryTrackId` paths.
- Indexed removable public player paths use opaque `library-source://` URIs.

## Disconnect and reconnect

- Disconnect aborts an active scan cooperatively with terminal
  `source-unavailable`; it does not run final mark-missing or claim first-scan
  completion.
- Existing catalog records and metadata remain available as unavailable.
- Reconnect resolves the new native root, restores Source/Track availability,
  and does not scan, rebuild the Queue, autoplay, or change Library IDs.
- Quick Browse Queue items already present when a Source is added retain their
  UUIDs, removable origin, order, revision, and absence of `libraryTrackId`.
- New indexed playback receives Library identity. Disconnect marks only
  affected Queue items unavailable in place, stops only if the current item
  depends on that volume, preserves current/Queue, and emits the shared
  disconnect notice. Indexed USB Now Playing reports `USB Storage`.
- Remove Source does not write to, unmount, eject, or hide the live device.

## Automated verification

- `npm.cmd run format:check` — PASS
- `npm.cmd run typecheck` — PASS
- `npm.cmd run lint` — PASS
- `npm.cmd run build` — PASS
- `npm.cmd test` — PASS, 362 passed and 2 platform skips
- `npm.cmd run test:mpv` — PASS, 7 passed
- `npm.cmd run mpv:doctor` — PASS
- `git diff --check` — PASS

Focused tests cover the removable Source model and v1 migration, no persisted
native root, relink to another mount root, root/subfolder naming, overlap and
concurrent-add policy, targeted first scan, unavailable/reconnect without
rescan, scheduler cancellation, Sources/Folders/UI contracts, Quick Browse
non-conversion, indexed removable playback, and mixed Queue disconnect.

Pre-existing MPV cases produced transient `property unavailable` errors when
the integration suite ran concurrently with the build gates. The new USB case
still passed, and the required standalone complete rerun passed all seven
tests.

## Real Windows QA

`npm.cmd run dev` was run against the connected Kingston volume `Others`
without modifying its media.

- Physical Windows detection and repeated device reads — PASS.
- Current logs contained no `[removable-storage] enumeration failed` or initial
  snapshot error during the QA run.
- The real album folder exposed 12 supported audio files.
- Add stayed in the USB browser; first scan completed once with generation 1
  and 12 available tracks.
- Sources showed separate live and persistent USB sections.
- USB root showed `Covered`; the indexed album showed `In Library`.
- Tracks and Search returned the Shawn Mendes catalog.
- A temporary Favorite and temporary Playlist entry were exercised and
  removed.
- The pre-existing Quick Browse Queue retained all UUIDs, order, removable
  paths, and queue revision 1 after indexing.
- Indexed playback created 12 Queue items with stable `libraryTrackId` values
  and opaque public paths.
- Remove Source left the live device and all 12 Quick Browse tracks available.
- Visual inspection passed at 1280×800, 1280×720, and 1024×600 with no overlap,
  blank surface, layout shift, or touch-target regression observed.
- The in-app browser control surface was unavailable in this session; the real
  Neutralino window was inspected through local screenshots and native input.
- Physical unplug/reconnect — **NOT TESTED**. No safe removal, eject, mount, or
  unmount action was performed. Fixture and MPV integration cover disconnect,
  relink, Stop, preserved Queue, no autoplay, and manual replay.

## Cleanup and limits

- The QA Source was removed and the pre-QA `sources.json`,
  `player-session.json`, and `library.db` were restored byte-for-byte from a
  temporary backup.
- The USB album retained 14 files, 77,693,105 bytes, and its original newest
  modification timestamp.
- Temporary screenshots, logs, and backup were moved to the Recycle Bin.
- No project process, USB monitor, MPV/FFmpeg/Neutralino process, or listener on
  4310/5173 remained.
- Linux CI for these uncommitted changes is pending. Existing hosted Linux core
  gates remain the documented baseline; physical Debian/Raspberry Pi USB QA is
  pending.
- Step 2.11.2 remains the future platform-specific mount, unmount, eject, safe
  removal, authorization, and boot/kiosk integration step.
- No commit or push was performed.
