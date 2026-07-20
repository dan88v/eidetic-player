# Indexed Library

The indexed Library is a durable, read-only catalog over configured Local
Folder Sources. It does not replace on-demand Folders navigation or MPV
playback. Step 2.6 adds Album, Artist, and Track browsing over that catalog;
genre and search remain future work.

## Storage and ownership

`IndexedLibraryService` owns one `node:sqlite` `DatabaseSync` connection for
the backend lifetime. The database is stored in the application data root:

- Windows: `%LOCALAPPDATA%\Eidetic Player\Data\library.db`;
- Linux: `${XDG_DATA_HOME:-~/.local/share}/eidetic-player/library.db`.

The schema is versioned through `PRAGMA user_version`. Version 1 contains
Sources, Tracks, Albums, Artists, track/artist links, and scan runs. Tables are
`STRICT`, foreign keys are enabled, and indexes cover source/relative-path
identity, availability, album, artist links, and scan history.

The connection uses WAL, `synchronous=NORMAL`, a 2.5-second busy timeout, and
bounded `BEGIN IMMEDIATE` transactions. SQLite work remains synchronous and
small; filesystem and metadata work yields between bounded batches. Node
24.15 or newer is required so the project can use the built-in `node:sqlite`
implementation without a native addon or an extra runtime dependency.

## Identity and incremental scans

A Track is identified by the pair `(sourceId, logicalRelativePath)`. Its opaque
stable ID is derived from that pair. Native roots never enter UI contracts,
Library SSE, or public diagnostics.

For every supported regular audio file the scanner records size and
modification time. An unchanged pair skips metadata parsing. A new or changed
file receives one serialized `music-metadata` read and a normalized catalog
record. Integer technical fields, including bitrate, are rounded at the
metadata boundary before insertion into the strict schema.

Album identity combines normalized title and album artist. Compilations use a
Various Artists sentinel; albums without album-artist metadata are source
local. Artist and album display values preserve normalized user-facing text.
Missing or malformed tags do not stop a scan: the Track remains indexed with a
per-file metadata state and safe fallback fields.

Only a successfully completed traversal marks previously indexed unseen files
unavailable. Cancellation, an unavailable Source, a partial directory
traversal, or a failed transaction preserves the prior availability set.
Reappearing files recover the same stable Track identity.

## Scanner lifecycle

The scanner is iterative and recursive, naturally sorted, and excludes dot
entries, known system entries, symlinks, and Windows junctions. It never follows
a link outside a Source. Desktop batches contain at most 32 Tracks; the
explicit Raspberry profile uses 16.

`LibraryScheduler` permits exactly one active scan. First scans are queued
automatically after player bootstrap; later scans are manual from Library or a
Source action menu. A concurrent manual request is rejected instead of starting
a second traversal. Cancellation uses `AbortSignal`, normally completing at
the next filesystem or metadata boundary.

Playback retains priority. The scanner waits while current/adjacent
metadata-artwork transition work is active and yields after each batch and
directory. It never starts MPV or FFmpeg and does not enter player-state or
visualizer SSE.

Scan progress is persisted in `scan_runs` and mirrored to
`library_sources`. Startup converts non-terminal runs left by an interrupted
process to `interrupted`. Normal shutdown cancels and awaits the active scan,
closes Library SSE, checkpoints WAL, and closes the database before the
development process tree exits.

## Recovery

Startup runs an integrity check before migrations. A corrupt database is
closed and preserved beside the original as
`library.corrupt-<timestamp>.db`; a clean schema is then created and the UI
receives one non-path recovery notice. A database with a schema version newer
than the application is not rewritten and produces a controlled startup error.

The app never edits, renames, or deletes media. Removing a Source removes only
its configuration and marks its catalog records unavailable/removed so
history and stable identity are retained.

## API and UI

Discrete commands use REST:

- `GET /api/library/snapshot`, `/summary`, `/sources`, `/status`;
- `GET /api/library/albums`, `/albums/:id`, `/artists`, `/artists/:id`,
  `/tracks`;
- `GET` or `HEAD /api/library/tracks/:trackId/artwork`;
- `POST /api/library/play`, `/queue`, and `/tracks/queue`;
- `POST /api/library/scan` with an optional `sourceId`;
- `POST /api/library/scan/cancel`;
- `POST /api/library/recovery/acknowledge`;
- development diagnostics at `GET /api/library/diagnostics`.

`GET /api/library/events` is a low-frequency snapshot SSE stream. One backend
subscription and keepalive exist only while at least one client is connected.
There is no polling.

Album, Artist, and Track collections use opaque base64url keyset cursors over
stable SQL ordering. Page size defaults to 48 and is capped at 100. Album
details order explicit discs before unknown discs, then Track number, title,
and stable ID. Artist membership is the union of direct Track artists and
album-artist ownership, deduplicated by Track ID; album-less Tracks form a
stable title-ordered tail.

Browse responses report catalog availability but contain no Source roots or
logical paths. Play/Add resolves a catalog snapshot to Source/logical identity,
checks the catalog fingerprint, reconstructs and contains native paths through
`PathService`, and verifies regular readable files with eight bounded workers.
Unavailable files are excluded. The queue is mutated only after the full
context succeeds, and a selected Track ID maps directly to the resolved queue
index.

The Library UI retains its summary/scan controls and adds persistent
Albums/Artists/Tracks segments plus an independent Album Grid/List setting.
Only the newest 192 paged entities stay mounted. Details update the existing
top-bar title, preserve return scroll state, and use the shared sibling action
popup. Scan progress updates only compact status fields; completion invalidates
the Library pages once.

## Verification

Automated coverage includes migrations, foreign keys, rollback, reopen,
corruption preservation, future versions, Windows/POSIX paths, recursive
filters, metadata failures, incremental new/modified/missing/reappearing files,
unavailable Sources, cancellation, scheduler serialization, first-scan policy,
keyset boundaries, compilation/album-artist aggregation, duplicate joins,
unavailable context filtering, direct selected-Track playback, UI DOM bounds,
and a 1,000-Track browse/context workload.

Real validation must additionally use `npm.cmd run dev` on Windows, play real
media while scanning, inspect all supported viewports, cancel a sufficiently
large temporary fixture scan, restart a populated database, and verify clean
shutdown both idle and during a scan. Temporary fixtures must live outside the
repository and must be removed afterward.
