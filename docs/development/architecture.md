# Architecture guidelines

## Runtime boundaries

Keep these responsibilities separate:

```text
Neutralino shell
  native file dialogs and native drop events only
          │
          ▼
PlatformBridge
          │
          ▼
Vanilla TypeScript UI ── REST commands ──► Node backend
          ▲                                  │
          └──── player-state SSE ────────────┤
                                             ▼
                                      PlayerService
                                             │ JSON IPC
                                             ▼
                                         MPV process

Now Playing Canvas ◄── visualizer SSE ── VisualizerHub
                                             │ PCM
                                             ▼
                                  optional FFmpeg sidecar
```

The shell contains no playback or domain logic. UI components do not know
whether the platform implementation is Neutralino, a browser fallback, or a
future Raspberry shell.

## Ownership

- `PlayerService` owns the playback session, Queue, current track, transport
  state, MPV commands, and authoritative state publication.
- MPV owns decoding, playback position, pause, playlist behavior, volume, mute,
  repeat, shuffle, and the selected audio output.
- `MetadataService` enriches tracks asynchronously and must not delay playback.
- `ArtworkService` validates, registers, caches, streams, and cleans artwork.
- `AudioAnalyzerService` owns at most one realtime FFmpeg process.
- `AudioAnalysisEngine` derives peak, spectrum, and 3-second K-weighted
  short-term loudness from that same PCM stream. Technical mode is a transport
  and presentation mode, not a second analyzer.
- `WaveformService` owns at most one fast-decode waveform process.
- The frontend player store receives authoritative state; a component may keep
  only short-lived interaction state such as a seek preview.
- `SourceService` owns persistent source identity, display name, and
  availability. `DirectoryBrowserService` owns one-level listings and its
  bounded cache; `FolderArtworkPreviewService` owns bounded direct-child folder
  previews; `PathService` is the only logical/native path authority.
- `RemovableStorageService` owns the single mounted-USB monitor, opaque volume
  identity, current native-root mapping, connect/disconnect lifecycle, and the
  one serialized mutating operation per physical device. Platform media
  adapters expose Mount and Safely remove capabilities; safe removal blocks
  new device I/O, releases app work, stops only affected playback while
  preserving Queue/current, unmounts every volume, and then ejects/powers off
  the physical device. A partial or vetoed operation is never reported safe.
  Windows and Linux enumeration stay behind separate providers. Removable
  volumes join the same provider-neutral `DirectoryBrowserService`. An
  explicitly selected root or subfolder may also become a persistent
  `removable` Source: its record contains only stable backend volume identity
  and logical relative root, while the current native root is resolved again
  for every open, scan, and playback command.
- `IndexedLibraryService` owns the durable SQLite catalog and publishes
  low-frequency Library snapshots. `LibraryScheduler` owns the single active
  scan, while `LibraryScanner` owns recursive traversal and incremental
  metadata ingestion. `LibraryRepository` owns deterministic entity queries
  and opaque keyset cursors; `IndexedLibraryService` resolves Play/Add contexts
  and revalidates their paths before delegating to `PlayerService`. Folders
  browsing remains an independent on-demand path.
- `SmbConnectionService` owns persistent share identity, one bounded reconnect
  scheduler, availability, and current backend roots. Platform SMB sessions
  and credentials remain behind their adapters/stores. Quick Browse uses its
  separate `DirectoryBrowserService`. An optional persistent `smb` Source
  stores only connection ID and logical relative root; `SourceService` resolves
  it through the current connection root for Folders, scanner, and Library
  playback.

Do not introduce a second owner for any of these concerns.

## Data channels

- REST carries discrete, validated commands.
- Player SSE carries low-frequency state and discrete changes.
- Visualizer SSE carries only the active mode's compact realtime data.
- Every visualizer frame carries player session, track, transition generation,
  sample-rate, and mode identity; the UI rejects any mismatched frame.
- Artwork and waveform use dedicated, opaque-ID HTTP endpoints.
- Large binary data, local paths, base64, and PCM never belong in player SSE.
- Folders responses use opaque IDs and logical relative paths. Absolute roots
  remain backend-only after the native Add Source command.
- Removable Storage REST/SSE exposes only opaque `usb-*` device IDs, logical
  paths, capacity/status data, and opaque entry/artwork IDs. Queue origins keep
  `deviceId`, logical relative path, and entry identity; the backend resolves
  the device's current root immediately before playback. Mount/removal commands
  also accept only the opaque ID; native PnP IDs, device nodes, partitions, and
  mount points remain private to the provider/controller boundary.
- Persistent removable Source APIs expose only normal opaque Source identity
  and logical coverage state. Stable volume identity, drive letters, mount
  points, and native roots remain backend-only. Existing Quick Browse Queue
  origins are never converted when the same folder is indexed.
- Persistent SMB Source APIs expose only opaque connection/Source identity,
  logical paths, and coverage state. Connection records and credential storage
  remain separate; native UNC/mount roots are reconstructed only in the
  backend. Quick Browse Queue origins are never converted when a folder is
  indexed.
- Network REST/SSE exposes opaque adapter and session-network IDs, safe link,
  radio, connectivity, scan and read-only IP state. One AppShell subscription
  feeds Settings and the top bar. Passwords, BSSID/MAC, native GUID/UUID,
  profile material, helper commands, and native errors remain backend-only.
- SMB REST/SSE exposes non-secret connection records and safe status only.
  Passwords, Credential Manager blobs, credential-file paths, UNC roots, mount
  points, and helper output remain backend-only. One AppShell subscription
  feeds Sources, Quick Browse, and the top bar.
- Library REST/SSE carries only opaque Source/Album/Artist/Track identity,
  catalog metadata, aggregate counts, progress, and safe error codes. Database
  paths and native roots remain backend-only. Native paths are reconstructed
  only inside validated Play/Add commands after Source and file availability
  checks.
- Library Search uses bounded grouped/category REST reads, the existing
  Library SSE invalidation signal, and the standard Library Play/Add commands.
  Track Play contains only the selected opaque Track ID; current Album lookup,
  path resolution, selected-index mapping, and queue mutation remain backend-only.

Components use central API clients. Shared request, response, state, and event
types live in `packages/shared`.

## Update granularity

Treat the UI as several independent update regions:

- playback position updates timeline and counters only;
- visualizer frames update the active Canvas only;
- volume updates its button/popover only;
- current-track changes update metadata, artwork, active Queue row, and relevant
  transport state;
- Queue structure changes reconcile Queue rows by stable ID;
- settings changes update the affected component only.

Do not rebuild `AppShell`, Now Playing, Queue, or the full mini-player for a
single-field update.

One app-lifetime Library SSE subscription feeds the mounted Library/Sources
screen and the global keyed scan notification. Library scan events update only
counters, status text, progress, Source overview fields, and action state. They
must not rebuild Queue, Now Playing, browse collections, or the screen shell.

Library browse pages are independent screen-local state. Scan progress never
refetches them; a completed generation invalidates only the active Library
pages. Detail routing swaps the Library root/detail regions without rebuilding
the application shell. Manage Library uses the same internal route owner and
preserves the root/detail route, segment, Album view, loaded pages, and scroll;
it updates the existing top-bar title.

Search is screen-local typed state with abort controllers and monotonically
sequenced requests. It retains grouped/category pages and scroll in module
memory for the app session, never in persistence. A completed scan invalidates
and refetches the active Search once; progress snapshots do not issue queries.

## Async correctness

Every async result that can outlive its target must be guarded:

- metadata parsing uses track/generation identity;
- artwork uses queue/track identity plus generation identity;
- old requests are aborted when possible and ignored otherwise;
- replacing a Queue invalidates observers and requests associated with the old
  Queue;
- reconnecting SSE must not duplicate subscriptions or native listeners.

Correct content with a placeholder is preferable to stale content that looks
complete.

## Bootstrap and player-session ownership

The backend owns the durable player session. `PlayerSessionService` observes
structural Queue/current-item changes, debounces atomic repository writes, and
stores either a Folders source ID plus logical relative path or a backend-only
direct native path. Position and play state are deliberately not persisted.

`GET /api/bootstrap` completes only after MPV discovery/startup and session
restore. The UI keeps the static splash visible until this endpoint completes,
subject to the minimum display interval and safety timeout, then mounts the
shell once with the returned state. A restored Queue always starts paused at
the beginning of its saved current item.
If the saved current item belongs to absent removable storage, the existing
current-item restore rule invalidates that saved session rather than inventing
a root or auto-resuming. Runtime disconnects preserve the in-memory Queue.
For indexed removable playback, disconnect marks only affected Queue items
unavailable in place and stops only when the current item depends on that
volume. Reconnect restores resolution and availability without scanning,
rebuilding the Queue, or autoplaying.

## Cross-platform behavior

Keep OS-specific IPC endpoints, executable discovery, native file dialogs, and
display control behind adapters. Do not spread `process.platform` branches
through domain services or UI components.

Linux config, cache, data, and runtime roots are resolved centrally according
to XDG. Persistent Sources and player-session state belong to config,
regenerable artwork belongs to cache, the SQLite Library belongs to data, and
MPV Unix sockets belong to a private runtime directory. Windows keeps its
APPDATA/LOCALAPPDATA and named-pipe adapters.

Mounted removable storage uses CIM disk/partition/volume associations on
Windows and `lsblk` transport topology on Linux. Filesystem UUID or volume
serial is preferred; provider device identity plus partition is the fallback,
and a final model/name/size-style fallback is session-stable only where the OS
supplies no durable identifier. Raw identity and mount roots never cross the
backend boundary.

Windows safe removal calls Configuration Manager on the parent physical USB
device, with a bounded non-interactive helper and structured veto/error mapping;
it never simulates eject by deleting a drive letter. Windows manual Mount stays
unsupported. Linux uses bounded, non-interactive `udisksctl` argument arrays
for per-volume mount/unmount and physical-drive power-off, without a shell,
sudo, force, or hidden password prompt. UDisks2/polkit deployment policy is not
owned by this layer.

MPV, FFmpeg, and native-shell absence must degrade independently:

- missing MPV disables playback but does not crash the backend;
- missing FFmpeg preserves playback and uses established visualizer/waveform
  fallbacks;
- browser fallback may display the UI but cannot pretend to provide native
  absolute file paths.
