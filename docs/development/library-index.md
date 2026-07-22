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

Schema v3 adds `favorite_tracks`, keyed by the opaque Track ID with an integer
creation timestamp. The foreign key uses `ON DELETE CASCADE`: Source offline or
removed states retain the Track and its Favorite, while a Track that is truly
deleted cannot leave an orphan. The `(created_at DESC, track_id ASC)` index
serves newest-first keyset pages. Migration from v1 runs v2 and v3 in the same
bounded transaction; Track metadata is never duplicated in the Favorite row.

Schema v4 adds dedicated `favorite_albums` and `favorite_artists` tables. Each
stores only the opaque entity ID and creation timestamp, uses a real cascading
foreign key, and has a `(created_at DESC, entity_id ASC)` index for stable
newest-first keyset pagination. Source offline/removed state retains the
catalog entity and Favorite; only definitive orphan cleanup cascades it. The
v3-to-v4 migration and the complete v1/v2 upgrade path run transactionally.

Schema v5 adds `play_history`, which stores only the Track foreign key,
listening timestamp, real accumulated playback seconds, and completion flag.
The Track foreign key cascades only on definitive Track deletion; offline or
removed Sources therefore retain their history. Newest-first and Track lookup
indexes support bounded keyset pages and contextual playback. All earlier
schema versions upgrade to v5 in the existing migration transaction.

Schema v6 adds strict `track_play_stats` rows keyed by Track. It keeps all-time
play count, completion count, real qualified listening seconds, and first/last
timestamps. A composite count/last/Track index provides deterministic keyset
ranking; Track deletion cascades, while offline or removed Sources retain the
row. Earlier versions migrate transactionally without backfilling Recent
history, so listening statistics initially start at zero.

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
automatically after player bootstrap, and a newly added Source immediately
queues only its persistent Source ID. If another scan is active, that ID stays
once in the scheduler's existing queue; removal before execution drops it.
Later rescans are manual from Sources, Manage Library, or a Source action menu.
A concurrent manual request is rejected instead of starting a second traversal.
Cancellation uses `AbortSignal`, normally completing at the next filesystem or
metadata boundary.

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
- `GET`/`DELETE /api/library/recently-played`, event `DELETE` by opaque history
  ID, and atomic contextual `POST /api/library/recently-played/play`;
- `GET /api/library/favorites/tracks`, idempotent `PUT`/`DELETE`
  `/api/library/favorites/tracks/:trackId`, batch `POST /status`, and atomic
  `POST /play`;
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

The Library root places persistent Albums/Artists/Tracks on the left and Search,
Manage, plus the independent Albums-only Grid/List setting on the right in one
compact toolbar row. Rescan/Cancel, summary, detailed scan state, and the compact
operational Source overview live on the internal Manage Library subpage.
Manage is not Settings and does not duplicate Sources configuration, Rename,
Remove, Add Folder, or native dialogs. Only the newest 192 paged entities stay
mounted. Details and Manage update the existing top-bar title and preserve the
originating route and scroll.

One app-lifetime Library EventSource consumes the existing low-frequency SSE
and distributes snapshots to the mounted screen plus the single toast host.
The keyed `library-scan-progress` notification is restored only for active or
queued work, coalesces visual updates to 250 ms, and applies terminal states
immediately. Complete and cancelled states reuse the same surface and dismiss
after 2.5 seconds; failure, interruption, and Source-unavailable states remain
visible until superseded or shutdown. The toast has no controls; management
stays on the Library screen. No polling,
second EventSource, second toast host, or scan-specific endpoint is used.

History is a separate main screen immediately after Favorites, with session-
preserved Recent, Most Played, and Stats segments. Recent uses
48-row keyset pages, retains at most 192 mounted rows, groups events by local
day, preserves unavailable rows, and adds neither Search nor another
EventSource. Its contextual Play builder reads the complete database history,
keeps only the newest occurrence of each Track, excludes unavailable Tracks,
and maps the requested event directly before one atomic Queue replacement.
Add to Queue remains a single-Track command. Event removal and confirmed footer
Clear affect neither Queue nor Favorites.

One backend tracker consumes the existing Player state subscription. For each
stable Library Track transition it accumulates only bounded forward playback
deltas and explicitly ignores pause, buffering, seek, sleep-sized gaps, and
unindexed Queue entries. An event is recorded at `min(30 seconds, 50% of known
duration)`, or 30 real seconds when duration is unknown. The same event becomes
completed at 90% or natural end. Consecutive duplicate Tracks update the newest
event; intervening Tracks create a new event. Each write transaction removes
events older than 90 days and then retains only the newest 500. A revision on
the existing Library snapshot invalidates the mounted screen only after a
meaningful history mutation, never on ordinary Player ticks.

The same tracker records one all-time play for every qualified Track
transition, even when consecutive Recent events aggregate. At qualification it
includes already-heard real time; completion and finalization add only bounded
remaining deltas. Most Played ranks complete backend context by play count,
last play, and Track ID. Stats uses one aggregate query for listening time,
qualified/completed plays, unique Tracks, and first/last dates. Its confirmed
reset deletes only `track_play_stats`; Recent has a separate clear. A distinct
`statsRevision` travels on the existing Library SSE, with no polling or second
stream.

Favorites is a separate main screen, visible whenever Library browsing is
enabled, with persistent Tracks, Albums, and Artists segments. Bounded 48-item
keyset pages retain at most 192 mounted entries and preserve unavailable
entities while excluding unavailable Tracks from playback. Album Grid/List is
independent from the Library preference; Artists uses the established touch
list geometry.

The three entity stores share one bounded 512-entry implementation and request
visible Favorite state in batches of at most 192 IDs. Optimistic hearts
synchronize mounted Library, Search, detail, Favorites, player Track status,
and indexed Queue rows as applicable, without polling or another EventSource.
Heart actions toast only on error; contextual menu mutations use the same API
and show the shared success toast.

Track playback retains its selected-Track direct-index behavior. Album Play
all concatenates favorite Albums newest-first and preserves the existing
disc/track/title/ID order inside each Album. Artist Play all concatenates each
favorite Artist's established context, including compilation ownership and
collaborations. Both category builders deduplicate globally by Track ID,
validate files, exclude unavailable entries, and perform one atomic Queue
replacement without depending on the mounted page.

## Search

Schema v2 adds materialized accent-insensitive keys for Artist name, Album
title/artist, and Track title/artist/album/album artist. Missing Track titles
alone fall back to filename. Scan upserts maintain the keys and migration from
v1 backfills them transactionally. Search queries are parameterized and rank
exact, prefix, word-prefix, then contains, followed by normalized display keys
and persistent IDs. Grouped defaults are 5 Artists, 6 Albums, and 8 Tracks;
category pages default to 48 and are capped at 100 with query-bound opaque
keyset cursors. Responses expose no catalog paths.

Track Search Play resolves the selected Track ID from the current catalog. A
Track with an Album rebuilds that complete disc/track/title/ID ordered Album,
excludes effectively unavailable Tracks, revalidates every resolved file, and
maps the selected Track directly before one atomic queue replace. An album-less
Track builds a single-item context. Track Add appends only that Track. Album and
Artist row taps retain detail navigation; their menus expose the existing
Play/Add context operations.
The UI retains at most 192 category rows and one sentinel. No FTS5, virtual
table, trigger, history, autocomplete, polling, or second Library EventSource
is used.

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
