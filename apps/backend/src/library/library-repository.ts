import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
  IndexedLibrarySource,
  IndexedLibrarySummary,
  LibraryScanProgress,
  LibraryScanStatus,
} from "../../../../packages/shared/src/library.js";
import type { StoredSource } from "../filesystem/filesystem-types.js";
import { LibraryDatabase } from "./library-database.js";
import {
  albumIdentity,
  artistIdentity,
  normalizeLibraryIdentity,
  trackArtists,
} from "./library-normalization.js";
import type {
  IndexedTrackIdentity,
  IndexedTrackInput,
  ScanCounters,
  ScanRunRecord,
} from "./library-types.js";

type SqlRow = Record<string, unknown>;

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function scanStatus(value: unknown): LibraryScanStatus {
  switch (value) {
    case "queued":
    case "scanning":
    case "cancelling":
    case "completed":
    case "cancelled":
    case "interrupted":
    case "failed":
    case "source-unavailable":
      return value;
    default:
      return "idle";
  }
}

export class LibraryRepository {
  private readonly connection: DatabaseSync;
  private readonly selectTrackIdentity: StatementSync;
  private readonly markTrackSeen: StatementSync;

  constructor(readonly database: LibraryDatabase) {
    this.connection = database.connection;
    this.selectTrackIdentity = this.connection.prepare(`
      SELECT track_id, size, mtime_ms, available
      FROM tracks
      WHERE source_id = ? AND relative_path = ?
    `);
    this.markTrackSeen = this.connection.prepare(`
      UPDATE tracks
      SET available = 1, last_seen_at = ?, last_seen_generation = ?
      WHERE source_id = ? AND relative_path = ?
    `);
  }

  recoverInterruptedScans(now = new Date().toISOString()): number {
    return this.database.transaction(() => {
      const runs = this.connection
        .prepare(
          `UPDATE scan_runs
           SET status = 'interrupted', updated_at = ?, completed_at = ?,
               error_code = 'SCAN_INTERRUPTED'
           WHERE status IN ('queued', 'scanning', 'cancelling')`,
        )
        .run(now, now);
      this.connection
        .prepare(
          `UPDATE library_sources
           SET scan_status = 'interrupted', last_scan_completed = ?,
               last_error_code = 'SCAN_INTERRUPTED', updated_at = ?
           WHERE scan_status IN ('queued', 'scanning', 'cancelling')`,
        )
        .run(now, now);
      return Number(runs.changes);
    });
  }

  syncConfiguredSources(
    records: readonly StoredSource[],
    now = new Date().toISOString(),
  ): void {
    this.database.transaction(() => {
      const upsert = this.connection.prepare(`
        INSERT INTO library_sources (
          source_id, display_name, removed, available, created_at, updated_at
        ) VALUES (?, ?, 0, 1, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          display_name = excluded.display_name,
          removed = 0,
          updated_at = excluded.updated_at
      `);
      for (const record of records)
        upsert.run(record.id, record.displayName, record.createdAt || now, now);
      if (records.length === 0) {
        this.connection
          .prepare(
            `UPDATE library_sources
             SET removed = 1, available = 0, updated_at = ?`,
          )
          .run(now);
      } else {
        const placeholders = records.map(() => "?").join(", ");
        this.connection
          .prepare(
            `UPDATE library_sources
             SET removed = 1, available = 0, updated_at = ?
             WHERE source_id NOT IN (${placeholders})`,
          )
          .run(now, ...records.map((record) => record.id));
      }
    });
  }

  upsertConfiguredSource(
    record: StoredSource,
    now = new Date().toISOString(),
  ): void {
    this.connection
      .prepare(
        `INSERT INTO library_sources (
           source_id, display_name, removed, available, created_at, updated_at
         ) VALUES (?, ?, 0, 1, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           display_name = excluded.display_name,
           removed = 0,
           updated_at = excluded.updated_at`,
      )
      .run(record.id, record.displayName, record.createdAt, now);
  }

  renameSource(
    sourceId: string,
    displayName: string,
    now = new Date().toISOString(),
  ): void {
    this.connection
      .prepare(
        `UPDATE library_sources
         SET display_name = ?, updated_at = ?
         WHERE source_id = ?`,
      )
      .run(displayName, now, sourceId);
  }

  markSourceRemoved(sourceId: string, now = new Date().toISOString()): void {
    this.connection
      .prepare(
        `UPDATE library_sources
         SET removed = 1, available = 0, scan_status = 'idle', updated_at = ?
         WHERE source_id = ?`,
      )
      .run(now, sourceId);
  }

  sourceNeedsFirstScan(sourceId: string): boolean {
    const row = this.connection
      .prepare(
        `SELECT first_scan_completed
         FROM library_sources
         WHERE source_id = ? AND removed = 0`,
      )
      .get(sourceId) as SqlRow | undefined;
    return row !== undefined && numberValue(row.first_scan_completed) === 0;
  }

  sourceIdsNeedingFirstScan(): readonly string[] {
    return (
      this.connection
        .prepare(
          `SELECT source_id
           FROM library_sources
           WHERE removed = 0 AND first_scan_completed = 0
           ORDER BY created_at, source_id`,
        )
        .all() as SqlRow[]
    ).flatMap((row) =>
      typeof row.source_id === "string" ? [row.source_id] : [],
    );
  }

  markQueued(sourceId: string, now = new Date().toISOString()): void {
    this.connection
      .prepare(
        `UPDATE library_sources
         SET scan_status = 'queued', last_error_code = NULL, updated_at = ?
         WHERE source_id = ? AND removed = 0`,
      )
      .run(now, sourceId);
  }

  beginScan(
    scanId: string,
    sourceId: string,
    now = new Date().toISOString(),
  ): ScanRunRecord {
    return this.database.transaction(() => {
      const row = this.connection
        .prepare(
          `SELECT display_name, current_generation
           FROM library_sources
           WHERE source_id = ? AND removed = 0`,
        )
        .get(sourceId) as SqlRow | undefined;
      if (!row || typeof row.display_name !== "string")
        throw new Error("Library source is not configured");
      const generation = numberValue(row.current_generation) + 1;
      this.connection
        .prepare(
          `UPDATE library_sources
           SET available = 1, scan_status = 'scanning',
               last_scan_started = ?, last_scan_completed = NULL,
               last_error_code = NULL, current_generation = ?, updated_at = ?
           WHERE source_id = ?`,
        )
        .run(now, generation, now, sourceId);
      this.connection
        .prepare(
          `INSERT INTO scan_runs (
             scan_id, source_id, generation, status, started_at, updated_at
           ) VALUES (?, ?, ?, 'scanning', ?, ?)`,
        )
        .run(scanId, sourceId, generation, now, now);
      return {
        scanId,
        sourceId,
        sourceName: row.display_name,
        generation,
        status: "scanning",
        startedAt: now,
        updatedAt: now,
        completedAt: null,
        filesDiscovered: 0,
        filesProcessed: 0,
        filesUnchanged: 0,
        filesNew: 0,
        filesModified: 0,
        filesUnavailable: 0,
        filesFailed: 0,
        totalFiles: null,
        errorCode: null,
      };
    });
  }

  updateScanProgress(
    scanId: string,
    counters: ScanCounters,
    status: LibraryScanStatus = "scanning",
    now = new Date().toISOString(),
  ): void {
    this.connection
      .prepare(
        `UPDATE scan_runs
         SET status = ?, updated_at = ?, files_discovered = ?,
             files_processed = ?, files_unchanged = ?, files_new = ?,
             files_modified = ?, files_unavailable = ?, files_failed = ?,
             total_files = ?
         WHERE scan_id = ?`,
      )
      .run(
        status,
        now,
        counters.filesDiscovered,
        counters.filesProcessed,
        counters.filesUnchanged,
        counters.filesNew,
        counters.filesModified,
        counters.filesUnavailable,
        counters.filesFailed,
        counters.totalFiles,
        scanId,
      );
  }

  findTrack(
    sourceId: string,
    relativePath: string,
  ): IndexedTrackIdentity | null {
    const row = this.selectTrackIdentity.get(sourceId, relativePath) as
      SqlRow | undefined;
    if (!row || typeof row.track_id !== "string") return null;
    return {
      id: row.track_id,
      size: numberValue(row.size),
      mtimeMs: numberValue(row.mtime_ms),
      available: numberValue(row.available) === 1,
    };
  }

  markUnchanged(
    sourceId: string,
    relativePath: string,
    generation: number,
    seenAt: string,
  ): void {
    this.markTrackSeen.run(seenAt, generation, sourceId, relativePath);
  }

  applyScanBatch(
    tracks: readonly IndexedTrackInput[],
    unchanged: readonly {
      readonly sourceId: string;
      readonly relativePath: string;
      readonly generation: number;
      readonly seenAt: string;
    }[],
  ): void {
    if (tracks.length === 0 && unchanged.length === 0) return;
    this.database.transaction(() => {
      for (const track of tracks) this.upsertTrack(track);
      for (const item of unchanged)
        this.markTrackSeen.run(
          item.seenAt,
          item.generation,
          item.sourceId,
          item.relativePath,
        );
      this.removeOrphanedEntities();
    });
  }

  completeScan(
    scanId: string,
    sourceId: string,
    generation: number,
    counters: ScanCounters,
    now = new Date().toISOString(),
  ): number {
    return this.database.transaction(() => {
      const missing = this.connection
        .prepare(
          `UPDATE tracks
           SET available = 0
           WHERE source_id = ? AND available = 1
             AND last_seen_generation <> ?`,
        )
        .run(sourceId, generation);
      const unavailable = Number(missing.changes);
      counters.filesUnavailable = unavailable;
      counters.totalFiles = counters.filesDiscovered;
      this.rebuildAggregates(now);
      this.connection
        .prepare(
          `UPDATE library_sources
           SET available = 1, first_scan_completed = 1,
               scan_status = 'completed', last_scan_completed = ?,
               last_successful_scan = ?, last_error_code = NULL,
               file_count = (
                 SELECT COUNT(*) FROM tracks WHERE source_id = ?
               ),
               unavailable_count = (
                 SELECT COUNT(*) FROM tracks
                 WHERE source_id = ? AND available = 0
               ),
               updated_at = ?
           WHERE source_id = ?`,
        )
        .run(now, now, sourceId, sourceId, now, sourceId);
      this.finishRun(scanId, "completed", counters, now, null);
      return unavailable;
    });
  }

  finishUnsuccessfulScan(
    scanId: string,
    sourceId: string,
    status: Extract<
      LibraryScanStatus,
      "cancelled" | "failed" | "source-unavailable" | "interrupted"
    >,
    counters: ScanCounters,
    errorCode: string | null,
    now = new Date().toISOString(),
  ): void {
    this.database.transaction(() => {
      this.finishRun(scanId, status, counters, now, errorCode);
      this.connection
        .prepare(
          `UPDATE library_sources
           SET available = CASE WHEN ? = 'source-unavailable' THEN 0 ELSE available END,
               scan_status = ?, last_scan_completed = ?,
               last_error_code = ?, updated_at = ?
           WHERE source_id = ?`,
        )
        .run(status, status, now, errorCode, now, sourceId);
    });
  }

  markCancelling(
    scanId: string,
    sourceId: string,
    now = new Date().toISOString(),
  ): void {
    this.database.transaction(() => {
      this.connection
        .prepare(
          `UPDATE scan_runs SET status = 'cancelling', updated_at = ?
           WHERE scan_id = ?`,
        )
        .run(now, scanId);
      this.connection
        .prepare(
          `UPDATE library_sources SET scan_status = 'cancelling', updated_at = ?
           WHERE source_id = ?`,
        )
        .run(now, sourceId);
    });
  }

  summary(): IndexedLibrarySummary {
    const row = this.connection
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM tracks) AS track_count,
           (SELECT COUNT(*) FROM tracks t
              JOIN library_sources s ON s.source_id = t.source_id
            WHERE t.available = 1 AND s.available = 1 AND s.removed = 0)
             AS available_track_count,
           (SELECT COUNT(*) FROM albums) AS album_count,
           (SELECT COUNT(*) FROM artists) AS artist_count,
           (SELECT COUNT(*) FROM library_sources WHERE removed = 0)
             AS source_count,
           (SELECT MAX(last_successful_scan) FROM library_sources)
             AS last_successful_scan,
           COALESCE(
             (SELECT scan_status FROM library_sources
                WHERE scan_status IN ('scanning', 'cancelling', 'queued')
                ORDER BY CASE scan_status
                  WHEN 'scanning' THEN 0 WHEN 'cancelling' THEN 1 ELSE 2 END
                LIMIT 1),
             (SELECT status FROM scan_runs
                ORDER BY COALESCE(started_at, updated_at) DESC, rowid DESC
                LIMIT 1),
             'idle'
           ) AS active_status`,
      )
      .get() as SqlRow;
    const trackCount = numberValue(row.track_count);
    const availableTrackCount = numberValue(row.available_track_count);
    return {
      trackCount,
      availableTrackCount,
      unavailableTrackCount: Math.max(0, trackCount - availableTrackCount),
      albumCount: numberValue(row.album_count),
      artistCount: numberValue(row.artist_count),
      sourceCount: numberValue(row.source_count),
      scanStatus: scanStatus(row.active_status),
      lastSuccessfulScan: nullableString(row.last_successful_scan),
    };
  }

  listSources(): readonly IndexedLibrarySource[] {
    return (
      this.connection
        .prepare(
          `SELECT source_id, display_name, removed, available,
                  first_scan_completed, scan_status, last_scan_started,
                  last_scan_completed, last_successful_scan, last_error_code,
                  current_generation, file_count, unavailable_count
           FROM library_sources
           ORDER BY removed, display_name COLLATE NOCASE, source_id`,
        )
        .all() as SqlRow[]
    ).map((row) => ({
      sourceId: String(row.source_id),
      displayName: String(row.display_name),
      availability:
        numberValue(row.removed) === 1
          ? "removed"
          : numberValue(row.available) === 1
            ? "available"
            : "unavailable",
      firstScanCompleted: numberValue(row.first_scan_completed) === 1,
      scanStatus: scanStatus(row.scan_status),
      lastScanStarted: nullableString(row.last_scan_started),
      lastScanCompleted: nullableString(row.last_scan_completed),
      lastSuccessfulScan: nullableString(row.last_successful_scan),
      lastErrorCode: nullableString(row.last_error_code),
      currentGeneration: numberValue(row.current_generation),
      fileCount: numberValue(row.file_count),
      unavailableCount: numberValue(row.unavailable_count),
    }));
  }

  progress(scanId: string): LibraryScanProgress | null {
    const row = this.connection
      .prepare(
        `SELECT r.*, s.display_name
         FROM scan_runs r
         JOIN library_sources s ON s.source_id = r.source_id
         WHERE r.scan_id = ?`,
      )
      .get(scanId) as SqlRow | undefined;
    if (!row || typeof row.source_id !== "string") return null;
    return this.toProgress(row);
  }

  latestProgress(): LibraryScanProgress | null {
    const row = this.connection
      .prepare(
        `SELECT r.*, s.display_name
         FROM scan_runs r
         JOIN library_sources s ON s.source_id = r.source_id
         ORDER BY COALESCE(r.started_at, r.updated_at) DESC, r.rowid DESC
         LIMIT 1`,
      )
      .get() as SqlRow | undefined;
    return row?.source_id ? this.toProgress(row) : null;
  }

  databaseSizeBytes(): number {
    const row = this.connection
      .prepare(
        `SELECT
           (SELECT page_count FROM pragma_page_count()) *
           (SELECT page_size FROM pragma_page_size()) AS bytes`,
      )
      .get() as SqlRow | undefined;
    return numberValue(row?.bytes);
  }

  private upsertTrack(track: IndexedTrackInput): void {
    const artists = trackArtists(track.metadata);
    const album = albumIdentity(track.sourceId, track.metadata);
    const albumArtist = album?.albumArtistDisplay
      ? artistIdentity(album.albumArtistDisplay)
      : null;
    const upsertArtist = this.connection.prepare(`
      INSERT INTO artists (
        artist_id, normalized_key, display_name, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(artist_id) DO UPDATE SET
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `);
    for (const artist of artists)
      upsertArtist.run(artist.id, artist.key, artist.displayName, track.seenAt);
    if (albumArtist)
      upsertArtist.run(
        albumArtist.id,
        albumArtist.key,
        albumArtist.displayName,
        track.seenAt,
      );
    if (album)
      this.connection
        .prepare(
          `INSERT INTO albums (
             album_id, normalized_key, display_title, album_artist_id,
             album_artist_display, year, representative_track_id,
             representative_artwork_revision, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(album_id) DO UPDATE SET
             display_title = excluded.display_title,
             album_artist_id = excluded.album_artist_id,
             album_artist_display = excluded.album_artist_display,
             year = COALESCE(excluded.year, albums.year),
             updated_at = excluded.updated_at`,
        )
        .run(
          album.id,
          album.key,
          album.displayTitle,
          albumArtist?.id ?? null,
          album.albumArtistDisplay,
          track.metadata.year,
          track.artworkAvailable ? track.id : null,
          null,
          track.seenAt,
        );
    const genres = [...track.metadata.genre];
    const normalizedGenres = [
      ...new Set(genres.map(normalizeLibraryIdentity).filter(Boolean)),
    ];
    this.connection
      .prepare(
        `INSERT INTO tracks (
           track_id, source_id, relative_path, filename, extension, size,
           mtime_ms, available, first_seen_at, last_seen_at,
           last_seen_generation, title, album_id, artist_display,
           album_artist_display, track_number, track_total, disc_number,
           disc_total, duration_seconds, codec, container, bitrate, sample_rate,
           bit_depth, channels, lossless, year, genre_raw, genre_normalized,
           artwork_available, artwork_source_type, artwork_revision,
           metadata_state, metadata_error_code
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )
         ON CONFLICT(source_id, relative_path) DO UPDATE SET
           filename = excluded.filename,
           extension = excluded.extension,
           size = excluded.size,
           mtime_ms = excluded.mtime_ms,
           available = 1,
           last_seen_at = excluded.last_seen_at,
           last_seen_generation = excluded.last_seen_generation,
           title = excluded.title,
           album_id = excluded.album_id,
           artist_display = excluded.artist_display,
           album_artist_display = excluded.album_artist_display,
           track_number = excluded.track_number,
           track_total = excluded.track_total,
           disc_number = excluded.disc_number,
           disc_total = excluded.disc_total,
           duration_seconds = excluded.duration_seconds,
           codec = excluded.codec,
           container = excluded.container,
           bitrate = excluded.bitrate,
           sample_rate = excluded.sample_rate,
           bit_depth = excluded.bit_depth,
           channels = excluded.channels,
           lossless = excluded.lossless,
           year = excluded.year,
           genre_raw = excluded.genre_raw,
           genre_normalized = excluded.genre_normalized,
           artwork_available = excluded.artwork_available,
           artwork_source_type = excluded.artwork_source_type,
           artwork_revision = excluded.artwork_revision,
           metadata_state = excluded.metadata_state,
           metadata_error_code = excluded.metadata_error_code`,
      )
      .run(
        track.id,
        track.sourceId,
        track.relativePath,
        track.filename,
        track.extension,
        track.size,
        track.mtimeMs,
        track.seenAt,
        track.seenAt,
        track.generation,
        track.metadata.title,
        album?.id ?? null,
        track.metadata.artist,
        track.metadata.albumArtist,
        track.metadata.trackNumber,
        track.metadata.trackTotal,
        track.metadata.discNumber,
        track.metadata.discTotal,
        track.metadata.durationSeconds,
        track.metadata.codec,
        track.metadata.container,
        track.metadata.bitrate,
        track.metadata.sampleRate,
        track.metadata.bitDepth,
        track.metadata.channels,
        track.metadata.lossless === null
          ? null
          : track.metadata.lossless
            ? 1
            : 0,
        track.metadata.year,
        JSON.stringify(genres),
        JSON.stringify(normalizedGenres),
        track.artworkAvailable ? 1 : 0,
        track.artworkAvailable ? "embedded" : null,
        null,
        track.metadataState,
        track.metadataErrorCode,
      );
    this.connection
      .prepare("DELETE FROM track_artists WHERE track_id = ?")
      .run(track.id);
    const attach = this.connection.prepare(
      `INSERT INTO track_artists (track_id, artist_id, artist_order)
       VALUES (?, ?, ?)`,
    );
    artists.forEach((artist, index) => {
      attach.run(track.id, artist.id, index);
    });
  }

  private finishRun(
    scanId: string,
    status: LibraryScanStatus,
    counters: ScanCounters,
    now: string,
    errorCode: string | null,
  ): void {
    this.connection
      .prepare(
        `UPDATE scan_runs
         SET status = ?, updated_at = ?, completed_at = ?,
             files_discovered = ?, files_processed = ?,
             files_unchanged = ?, files_new = ?, files_modified = ?,
             files_unavailable = ?, files_failed = ?, total_files = ?,
             error_code = ?
         WHERE scan_id = ?`,
      )
      .run(
        status,
        now,
        now,
        counters.filesDiscovered,
        counters.filesProcessed,
        counters.filesUnchanged,
        counters.filesNew,
        counters.filesModified,
        counters.filesUnavailable,
        counters.filesFailed,
        counters.totalFiles,
        errorCode,
        scanId,
      );
  }

  private removeOrphanedEntities(): void {
    this.connection.exec(`
      DELETE FROM albums
      WHERE NOT EXISTS (
        SELECT 1 FROM tracks WHERE tracks.album_id = albums.album_id
      );
      DELETE FROM artists
      WHERE NOT EXISTS (
        SELECT 1 FROM track_artists
        WHERE track_artists.artist_id = artists.artist_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM albums
        WHERE albums.album_artist_id = artists.artist_id
      );
    `);
  }

  private rebuildAggregates(now: string): void {
    this.removeOrphanedEntities();
    this.connection
      .prepare(
        `UPDATE albums SET
           track_count = (
             SELECT COUNT(*) FROM tracks WHERE tracks.album_id = albums.album_id
           ),
           available_track_count = (
             SELECT COUNT(*) FROM tracks
             JOIN library_sources s ON s.source_id = tracks.source_id
             WHERE tracks.album_id = albums.album_id
               AND tracks.available = 1 AND s.available = 1 AND s.removed = 0
           ),
           representative_track_id = COALESCE(
             (
               SELECT track_id FROM tracks
               WHERE tracks.album_id = albums.album_id
                 AND artwork_available = 1
               ORDER BY available DESC, disc_number, track_number, relative_path
               LIMIT 1
             ),
             (
               SELECT track_id FROM tracks
               WHERE tracks.album_id = albums.album_id
               ORDER BY available DESC, disc_number, track_number, relative_path
               LIMIT 1
             )
           ),
           updated_at = ?`,
      )
      .run(now);
    this.connection
      .prepare(
        `UPDATE artists SET
           track_count = (
             SELECT COUNT(*) FROM track_artists
             WHERE track_artists.artist_id = artists.artist_id
           ),
           album_count = (
             SELECT COUNT(DISTINCT tracks.album_id)
             FROM track_artists
             JOIN tracks ON tracks.track_id = track_artists.track_id
             WHERE track_artists.artist_id = artists.artist_id
               AND tracks.album_id IS NOT NULL
           ),
           available_track_count = (
             SELECT COUNT(*)
             FROM track_artists
             JOIN tracks ON tracks.track_id = track_artists.track_id
             JOIN library_sources s ON s.source_id = tracks.source_id
             WHERE track_artists.artist_id = artists.artist_id
               AND tracks.available = 1 AND s.available = 1 AND s.removed = 0
           ),
           updated_at = ?`,
      )
      .run(now);
  }

  private toProgress(row: SqlRow): LibraryScanProgress {
    const startedAt = nullableString(row.started_at);
    const completedAt = nullableString(row.completed_at);
    const elapsedEnd = completedAt ? Date.parse(completedAt) : Date.now();
    const elapsedStart = startedAt ? Date.parse(startedAt) : elapsedEnd;
    return {
      scanId: String(row.scan_id),
      sourceId: String(row.source_id),
      sourceName: String(row.display_name),
      generation: numberValue(row.generation),
      status: scanStatus(row.status),
      filesDiscovered: numberValue(row.files_discovered),
      filesProcessed: numberValue(row.files_processed),
      filesUnchanged: numberValue(row.files_unchanged),
      filesNew: numberValue(row.files_new),
      filesModified: numberValue(row.files_modified),
      filesUnavailable: numberValue(row.files_unavailable),
      filesFailed: numberValue(row.files_failed),
      totalFiles:
        row.total_files === null ? null : numberValue(row.total_files),
      startedAt,
      updatedAt: String(row.updated_at),
      completedAt,
      elapsedMilliseconds: Math.max(0, elapsedEnd - elapsedStart),
      errorCode: nullableString(row.error_code),
    };
  }
}
