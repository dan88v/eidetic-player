# Step 2.11 — USB Quick Browse

Date: 2026-07-23

## Result

USB Quick Browse is implemented from the Step 2.10.1 baseline. Mounted USB
volumes are detected by platform providers, exposed through opaque contracts
and one global monitor, browsed through the canonical Folders component, and
played through the existing Queue/PlayerService path.

A physical Kingston DataTraveler volume was subsequently supplied for the
Step 2.11 follow-up. Real Windows detection, Sources, root and album browsing,
metadata, artwork, selected-Track playback, exact Queue replacement, opaque
public paths, and the Default Player at all three required window sizes passed.
Physical unplug/reconnect remains NOT TESTED because the device was not removed
during this run.

## Architecture and providers

- Added one `RemovableStorageService` with a single immediate enumeration and
  one deduplicated 2.5-second fallback monitor. There is no frontend polling or
  per-device watcher.
- Windows uses the Storage CIM `MSFT_Disk` bus type, partition, volume, and
  logical-disk data. It excludes system/boot disks and accepts both flash and
  USB fixed disks with mounted partitions.
- Linux uses `lsblk --json --bytes`, USB transport ancestry, mounted disk or
  partition nodes, and excludes `/`, non-USB, network, and optical devices.
- The fixture provider supports zero, one, multiple, read-only, root-change,
  disconnect, reconnect, singleton-monitor, and shutdown tests.
- Filesystem UUID/volume serial is preferred. Provider device identity plus
  partition is the fallback; the final name/size-style fallback is documented
  as less durable when the OS supplies no stable identity.
- Device IDs are deterministic opaque `usb-*` hashes. Raw serial/UUID,
  drive letter, mount point, stable identity, and native root never enter
  shared/UI contracts.
- No dependency was added.

## API, browser, and UI

- Added typed device snapshot and capability contracts. Mount, unmount, and
  eject capabilities are false.
- Added one Removable Storage SSE plus bounded device, browse, metadata,
  artwork, open, Track queue, directory play, and directory queue routes.
- A composite source catalog feeds the existing `DirectoryBrowserService`;
  USB does not have a second directory renderer, cache, metadata pipeline, or
  artwork pipeline.
- USB browsing keeps separate per-device logical location, selection, and
  scroll state while local Folders behavior remains unchanged.
- The USB screen reuses Folders header, breadcrumb, cards, rows, menus, lazy
  metadata/artwork, natural sort, Play Folder, tap Track, Add Track, and Add
  Folder. At root the duplicate content title is visually omitted.
- Disconnect while browsing disables stale actions immediately, keeps Back
  available, and shows a persistent dark state.
- Sources now has a real USB section with zero-device copy, name, status,
  optional capacity/read-only detail, and Browse. Network Shares remains the
  only future placeholder.
- Default and Cassette add USB immediately after Folders only while a readable
  device exists. One device opens directly; multiple devices use the shared
  live-updating picker. No USB drawer entry was added.
- The connected-device button now uses a dedicated flash-drive glyph and a
  scoped teal connected-state treatment in both Default and Cassette. The
  generic USB/DAC indicator retains its separate icon and styling.

## Queue, playback, disconnect, and reconnect

- Queue origins now support `removable` with opaque device ID, logical relative
  path, and entry identity.
- Tap Track builds the direct parent directory in natural order and opens the
  selected index atomically. Folder operations remain non-recursive.
- Exact replacement now clears non-current MPV playlist entries before loading
  the new Queue and waits, bounded to two seconds, until MPV reports both the
  selected index and selected path. This prevents old Queue entries and a stale
  current path from surviving an open operation.
- USB Queue items receive no Library Track ID, so Favorite, Playlist, History,
  Most Played, and Library identity are not enabled or inferred.
- Public player state rewrites removable paths to opaque logical
  `removable://` identities; native USB roots do not reach REST or player SSE.
- Disconnect issues MPV Stop with keep-playlist, marks matching items
  unavailable in place, retains the current item, UUIDs, order, Queue, and
  `queueRevision`, and does not skip.
- Reconnect restores availability without autoplay or position restore. Manual
  Play resolves the current device root and rematerializes the existing Queue
  while preserving item IDs.
- Runtime USB Queue state is preserved on disconnect. On application restart,
  an absent saved removable current item follows the existing current-item
  restore rule and invalidates that saved session.

## Security and scope

- Every browse/play resolution rechecks device presence, current root,
  containment, entry identity, regular-file type, supported audio extension,
  readability, and symlink/junction exclusion.
- Quick Browse is read-only. It writes no tags, artwork, database, or files to
  removable media.
- No mount, unmount, eject, sudo, udisks, DeviceIoControl, udev, systemd, SMB,
  Library integration, DAC selection, scanner, rescan, or auto-indexing was
  added.
- Step 2.11.1 remains USB Library Integration. Step 2.11.2 remains
  platform-specific mount, unmount, eject, safe removal, and authorization.

## Tests and measurements

Focused tests cover opaque/stable identity, Unicode and missing labels,
read-only state, root change, disconnect/reconnect, snapshot deduplication,
monitor shutdown, logical-path isolation, natural ordering, hidden/system
filtering, traversal rejection, separate USB session/scroll, Sources, player
button/picker boundaries, and absence from the drawer.

Real MPV integration verifies selected USB playback, disconnect Stop, preserved
Queue/current item/UUID/order/revision/transition, unavailable items, no native
path in public state, reconnect without autoplay, and successful manual Play.
It also starts from a populated three-item playlist, replaces it with a shorter
two-item playlist at a nonzero selected index, and verifies that no old item or
old current path remains.

Commands completed:

- `npm.cmd run format:check` — PASS
- `npm.cmd run typecheck` — PASS
- `npm.cmd run lint` — PASS
- `npm.cmd run build` — PASS
- `npm.cmd test` — PASS, 359 tests: 357 passed, 2 expected skips
- `npm.cmd run test:posix` — PASS, 3 passed and 2 expected Windows skips
- `npm.cmd run mpv:doctor` — PASS
- `npm.cmd run test:mpv` — PASS, 6 tests
- `npm.cmd run ffmpeg:doctor` — PASS
- `npm.cmd run test:ffmpeg` — PASS, 3 tests
- focused removable/Folders/session/UI tests — PASS

Fixture desktop measurements:

- initial empty enumeration: 0.12 ms;
- connect refresh: 1.28 ms;
- disconnect refresh: 0.11 ms;
- root open: 1.26 ms;
- directory cache hit: 0.23 ms;
- measured heap delta: 140,984 bytes;
- monitor/browser shutdown: 0.30 ms.

With the Kingston connected, six direct provider enumerations completed in
2.39–3.77 seconds with no failure. The real application monitor completed 94
refresh attempts, retained one active device, and logged zero enumeration
failures; initial and maximum enumeration time were both 3.84 seconds. The
previous eight-second PowerShell timeout was too close to Windows Storage CIM
latency under contention, so it is now 20 seconds. The service still coalesces
to one in-flight enumeration and retains the last valid snapshot on a failure.
These are desktop figures, not Raspberry Pi 3B evidence. Linux CI and physical
Debian/Raspberry Pi USB runtime validation remain pending.

## Real runtime and cleanup

`npm.cmd run dev` launched the real Neutralino → backend → MPV path with a
Kingston DataTraveler mounted as the `Others` NTFS volume. The public snapshot
reported one readable 15.1 GB volume with an opaque stable device ID. Root
browsing exposed only `ArchivioFenice` and `Shawn Mendes - Shawn (2024)`;
system-hidden content was excluded. The album exposed 12 naturally ordered MP3
Tracks plus decoded cover artwork and metadata.

The real Queue follow-up first opened two existing direct items, then opened
`02. Why Why Why.mp3` through the removable entry endpoint. The final Queue had
exactly 12 items, selected index 1, zero retained old Queue UUIDs, zero
non-removable public paths, and no native drive path in the response. Playback
was paused again after the check. Physical unplug/reconnect remains NOT TESTED.

The integrated browser runtime still exposed no browser, so the real Neutralino
window was captured and inspected directly. The Default Player passed at
1280x800, 1280x720, and 1024x600: the dedicated teal flash-drive control is
visible only for the connected device, remains aligned after Folders, and does
not disturb centered transport or Volume/Queue. Sources at 1024x600 showed the
real `Others` card and Browse action; USB root and album views reused the
canonical Folders cards, rows, breadcrumb, metadata, artwork, and stable dark
layout. Cassette received the same scoped glyph/color implementation and
automated coverage but was not visually selected in this follow-up.

Neutralino was closed through its window close path. Final runtime inspection
found no project listener on 4310, 5173, or 9222 and no residual project
Neutralino, backend, Vite, MPV, FFmpeg, monitor, fixture, or screenshot
process/file.

No commit, push, merge, rebase, reset, restore, stash, or clean was performed
during implementation.
