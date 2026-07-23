import type { DatabaseSync, StatementSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  LibraryAlbum,
  LibraryAlbumDetail,
  LibraryArtist,
  LibraryArtistDetail,
  LibraryPage,
  LibrarySearchAlbum,
  LibrarySearchPage,
  LibraryTrack,
  IndexedLibrarySource,
  IndexedLibrarySummary,
  LibraryScanProgress,
  LibraryScanStatus,
  FavoriteTrackPage,
  FavoriteTrackMutationResponse,
  FavoriteAlbumPage,
  FavoriteArtistPage,
  FavoriteAlbumMutationResponse,
  FavoriteArtistMutationResponse,
  RecentlyPlayedPage,
  MostPlayedPage,
  ListeningStats,
  PlaylistPage,
  PlaylistSummary,
  PlaylistDetail,
  PlaylistItem,
} from "../../../../packages/shared/src/library.js";
import type { StoredSource } from "../filesystem/filesystem-types.js";
import { LibraryDatabase } from "./library-database.js";
import { LibraryError } from "./library-errors.js";
import {
  albumIdentity,
  artistIdentity,
  normalizeLibraryIdentity,
  normalizeLibrarySearchKey,
  trackArtists,
} from "./library-normalization.js";

function searchRankSql(field: string): string {
  return `CASE
    WHEN ${field} = ? THEN 0
    WHEN ${field} GLOB ? || '*' THEN 1
    WHEN instr(' ' || ${field}, ' ' || ?) > 0 THEN 2
    WHEN instr(${field}, ?) > 0 THEN 3
    ELSE 4 END`;
}

function searchRankParameters(
  normalizedQuery: string,
  fields: number,
): readonly string[] {
  return Array.from({ length: fields * 4 }, () => normalizedQuery);
}
import type {
  IndexedTrackIdentity,
  IndexedTrackInput,
  LibraryContextTrack,
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

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : numberValue(value);
}

type CursorValue = string | number | null;

function encodeCursor(values: readonly CursorValue[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

function decodeCursor(
  cursor: string | null,
  length: number,
): readonly CursorValue[] | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;
    if (
      !Array.isArray(value) ||
      value.length !== length ||
      value.some(
        (part) =>
          part !== null && typeof part !== "string" && typeof part !== "number",
      )
    )
      throw new Error("invalid cursor");
    return value as CursorValue[];
  } catch {
    throw new LibraryError(
      "INVALID_LIBRARY_CURSOR",
      "The Library page cursor is invalid.",
    );
  }
}

function decodeSearchCursor(
  cursor: string | null,
  normalizedQuery: string,
  types: readonly ("number" | "string")[],
): readonly CursorValue[] | null {
  const decoded = decodeCursor(cursor, types.length + 1);
  if (!decoded) return null;
  if (
    decoded[0] !== normalizedQuery ||
    types.some((type, index) => typeof decoded[index + 1] !== type)
  )
    throw new LibraryError(
      "INVALID_LIBRARY_CURSOR",
      "The Library page cursor is invalid.",
    );
  return decoded.slice(1);
}

function effectiveAvailability(row: SqlRow): "available" | "unavailable" {
  return numberValue(row.effective_available) === 1
    ? "available"
    : "unavailable";
}

function aggregateAvailability(
  trackCount: number,
  availableTrackCount: number,
): "available" | "partial" | "unavailable" {
  if (availableTrackCount === 0) return "unavailable";
  return availableTrackCount === trackCount ? "available" : "partial";
}

function trackFromRow(row: SqlRow): LibraryTrack {
  return {
    id: String(row.track_id),
    title: String(row.display_title),
    artist: nullableString(row.artist_display),
    album: nullableString(row.album_display),
    durationSeconds: nullableNumber(row.duration_seconds),
    discNumber: nullableNumber(row.disc_number),
    trackNumber: nullableNumber(row.track_number),
    artworkTrackId:
      numberValue(row.artwork_available) === 1
        ? String(row.track_id)
        : nullableString(row.representative_track_id),
    availability: effectiveAvailability(row),
  };
}

function historyId(id: number): string {
  return `history-${String(id)}`;
}

const HISTORY_RETENTION_MILLISECONDS = 90 * 24 * 60 * 60 * 1_000;
const MAX_HISTORY_EVENTS = 500;
const MAX_PLAYLIST_ITEMS = 2_000;

export function normalizePlaylistName(value: string): {
  readonly name: string;
  readonly normalizedName: string;
} {
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (name.length === 0 || Array.from(name).length > 80)
    throw new LibraryError(
      "INVALID_PLAYLIST_NAME",
      "Playlist names must contain between 1 and 80 characters.",
    );
  return { name, normalizedName: name.toLocaleLowerCase("en-US") };
}

function albumFromRow(row: SqlRow): LibraryAlbum {
  const trackCount = numberValue(row.track_count);
  const availableTrackCount = numberValue(row.available_track_count);
  return {
    id: String(row.album_id),
    title: String(row.display_title),
    albumArtist: nullableString(row.album_artist_display),
    year: nullableNumber(row.year),
    artworkTrackId: nullableString(row.representative_track_id),
    trackCount,
    availableTrackCount,
    totalDurationSeconds: numberValue(row.total_duration_seconds),
    availability: aggregateAvailability(trackCount, availableTrackCount),
  };
}

function searchAlbumFromRow(row: SqlRow): LibrarySearchAlbum {
  const trackCount = numberValue(row.track_count);
  const availableTrackCount = numberValue(row.available_track_count);
  return {
    id: String(row.album_id),
    title: String(row.display_title),
    albumArtist: nullableString(row.album_artist_display),
    year: nullableNumber(row.year),
    artworkTrackId: nullableString(row.representative_track_id),
    trackCount,
    availableTrackCount,
    availability: aggregateAvailability(trackCount, availableTrackCount),
  };
}

function artistFromRow(row: SqlRow): LibraryArtist {
  const trackCount = numberValue(row.track_count);
  const availableTrackCount = numberValue(row.available_track_count);
  return {
    id: String(row.artist_id),
    name: String(row.display_name),
    albumCount: numberValue(row.album_count),
    trackCount,
    availableTrackCount,
    availability: aggregateAvailability(trackCount, availableTrackCount),
  };
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

  setSourceAvailability(
    sourceId: string,
    available: boolean,
    now = new Date().toISOString(),
  ): boolean {
    const changed = this.connection
      .prepare(
        `UPDATE library_sources
         SET available = ?, updated_at = ?
         WHERE source_id = ? AND removed = 0 AND available <> ?`,
      )
      .run(available ? 1 : 0, now, sourceId, available ? 1 : 0);
    if (Number(changed.changes) > 0) {
      this.rebuildAggregates(now);
      return true;
    }
    return false;
  }

  markSourceRemoved(sourceId: string, now = new Date().toISOString()): void {
    this.database.transaction(() => {
      this.connection
        .prepare(
          `UPDATE library_sources
           SET removed = 1, available = 0, scan_status = 'idle', updated_at = ?
           WHERE source_id = ?`,
        )
        .run(now, sourceId);
      this.rebuildAggregates(now);
    });
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
      this.rebuildAggregates(now);
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
      if (status === "source-unavailable") this.rebuildAggregates(now);
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

  albums(cursor: string | null, limit: number): LibraryPage<LibraryAlbum> {
    const decoded = decodeCursor(cursor, 4);
    const cursorWhere = decoded
      ? `WHERE (
          lower(a.display_title),
          lower(COALESCE(a.album_artist_display, '')),
          COALESCE(a.year, 2147483647),
          a.album_id
        ) > (?, ?, ?, ?)`
      : "";
    const rows = this.connection
      .prepare(
        `SELECT a.album_id, a.display_title, a.album_artist_display, a.year,
                a.representative_track_id, a.track_count,
                a.available_track_count,
                COALESCE(SUM(
                  CASE WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                       THEN t.duration_seconds ELSE 0 END
                ), 0) AS total_duration_seconds,
                lower(a.display_title) AS title_key,
                lower(COALESCE(a.album_artist_display, '')) AS artist_key,
                COALESCE(a.year, 2147483647) AS year_key
         FROM albums a
         LEFT JOIN tracks t ON t.album_id = a.album_id
         LEFT JOIN library_sources s ON s.source_id = t.source_id
         ${cursorWhere}
         GROUP BY a.album_id
         ORDER BY title_key, artist_key, year_key, a.album_id
         LIMIT ?`,
      )
      .all(...(decoded ?? []), limit + 1) as SqlRow[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(albumFromRow),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([
              String(last.title_key),
              String(last.artist_key),
              numberValue(last.year_key),
              String(last.album_id),
            ])
          : null,
    };
  }

  album(albumId: string): LibraryAlbumDetail | null {
    const row = this.connection
      .prepare(
        `SELECT a.album_id, a.display_title, a.album_artist_display, a.year,
                a.representative_track_id, a.track_count,
                a.available_track_count,
                COALESCE(SUM(
                  CASE WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                       THEN t.duration_seconds ELSE 0 END
                ), 0) AS total_duration_seconds
         FROM albums a
         LEFT JOIN tracks t ON t.album_id = a.album_id
         LEFT JOIN library_sources s ON s.source_id = t.source_id
         WHERE a.album_id = ?
         GROUP BY a.album_id`,
      )
      .get(albumId) as SqlRow | undefined;
    if (!row) return null;
    const tracks = this.connection
      .prepare(
        `SELECT t.track_id, COALESCE(t.title, substr(t.filename, 1,
                  length(t.filename) - length(t.extension) - 1)) AS display_title,
                t.artist_display, a.display_title AS album_display,
                t.duration_seconds, t.disc_number, t.track_number,
                t.artwork_available, a.representative_track_id,
                CASE WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                     THEN 1 ELSE 0 END AS effective_available
         FROM tracks t
         JOIN library_sources s ON s.source_id = t.source_id
         LEFT JOIN albums a ON a.album_id = t.album_id
         WHERE t.album_id = ?
         ORDER BY t.disc_number IS NULL, t.disc_number,
                  t.track_number IS NULL, t.track_number,
                  lower(display_title), t.track_id`,
      )
      .all(albumId) as SqlRow[];
    return { ...albumFromRow(row), tracks: tracks.map(trackFromRow) };
  }

  artists(cursor: string | null, limit: number): LibraryPage<LibraryArtist> {
    const decoded = decodeCursor(cursor, 2);
    const rows = this.connection
      .prepare(
        `SELECT artist_id, display_name, album_count, track_count,
                available_track_count, normalized_key
         FROM artists
         ${decoded ? "WHERE (normalized_key, artist_id) > (?, ?)" : ""}
         ORDER BY normalized_key, artist_id
         LIMIT ?`,
      )
      .all(...(decoded ?? []), limit + 1) as SqlRow[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(artistFromRow),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([String(last.normalized_key), String(last.artist_id)])
          : null,
    };
  }

  artist(
    artistId: string,
    trackCursor: string | null,
    trackLimit: number,
  ): LibraryArtistDetail | null {
    const artistRow = this.connection
      .prepare(
        `SELECT artist_id, display_name, album_count, track_count,
                available_track_count
         FROM artists WHERE artist_id = ?`,
      )
      .get(artistId) as SqlRow | undefined;
    if (!artistRow) return null;
    const albums = this.connection
      .prepare(
        `WITH artist_tracks(track_id) AS (
           SELECT track_id FROM track_artists WHERE artist_id = ?
           UNION
           SELECT t.track_id FROM tracks t
           JOIN albums owned ON owned.album_id = t.album_id
           WHERE owned.album_artist_id = ?
         )
         SELECT a.album_id, a.display_title, a.album_artist_display, a.year,
                a.representative_track_id, COUNT(DISTINCT t.track_id) AS track_count,
                COUNT(DISTINCT CASE
                  WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                  THEN t.track_id END) AS available_track_count,
                COALESCE(SUM(CASE
                  WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                  THEN t.duration_seconds ELSE 0 END), 0) AS total_duration_seconds
         FROM artist_tracks at
         JOIN tracks t ON t.track_id = at.track_id
         JOIN albums a ON a.album_id = t.album_id
         JOIN library_sources s ON s.source_id = t.source_id
         GROUP BY a.album_id
         ORDER BY lower(a.display_title),
                  lower(COALESCE(a.album_artist_display, '')),
                  COALESCE(a.year, 2147483647), a.album_id`,
      )
      .all(artistId, artistId) as SqlRow[];
    const tracks = this.artistTracks(artistId, trackCursor, trackLimit);
    return {
      ...artistFromRow(artistRow),
      albums: albums.map(albumFromRow),
      tracks,
    };
  }

  tracks(cursor: string | null, limit: number): LibraryPage<LibraryTrack> {
    const decoded = decodeCursor(cursor, 6);
    const rows = this.trackRows("", decoded, [limit + 1]);
    return this.trackPage(rows, limit);
  }

  recordPlayHistory(
    trackId: string,
    playedSeconds: number,
    completed: boolean,
    playedAt = Date.now(),
  ): { readonly historyId: string; readonly created: boolean } | null {
    return this.database.transaction(() => {
      const track = this.connection
        .prepare("SELECT track_id FROM tracks WHERE track_id = ?")
        .get(trackId) as SqlRow | undefined;
      if (!track) return null;
      const latest = this.connection
        .prepare(
          `SELECT id, track_id FROM play_history
           ORDER BY played_at DESC, id DESC LIMIT 1`,
        )
        .get() as SqlRow | undefined;
      let id: number;
      let created = false;
      if (latest && String(latest.track_id) === trackId) {
        id = numberValue(latest.id);
        this.connection
          .prepare(
            `UPDATE play_history
             SET played_at = ?, played_seconds = ?,
                 completed = ?
             WHERE id = ?`,
          )
          .run(playedAt, playedSeconds, completed ? 1 : 0, id);
      } else {
        const result = this.connection
          .prepare(
            `INSERT INTO play_history (
               track_id, played_at, played_seconds, completed
             ) VALUES (?, ?, ?, ?)`,
          )
          .run(trackId, playedAt, playedSeconds, completed ? 1 : 0);
        id = Number(result.lastInsertRowid);
        created = true;
      }
      this.prunePlayHistory(playedAt);
      return { historyId: historyId(id), created };
    });
  }

  updatePlayHistory(
    id: number,
    playedSeconds: number,
    completed: boolean,
    playedAt = Date.now(),
  ): boolean {
    return this.database.transaction(() => {
      const result = this.connection
        .prepare(
          `UPDATE play_history
           SET played_at = ?, played_seconds = ?,
               completed = MAX(completed, ?)
           WHERE id = ?`,
        )
        .run(playedAt, playedSeconds, completed ? 1 : 0, id);
      this.prunePlayHistory(playedAt);
      return Number(result.changes) > 0;
    });
  }

  recentlyPlayed(cursor: string | null, limit: number): RecentlyPlayedPage {
    const decoded = decodeCursor(cursor, 2);
    if (
      decoded &&
      (typeof decoded[0] !== "number" || typeof decoded[1] !== "number")
    )
      throw new LibraryError(
        "INVALID_LIBRARY_CURSOR",
        "The Library page cursor is invalid.",
      );
    const cursorPlayedAt = decoded ? numberValue(decoded[0]) : null;
    const cursorId = decoded ? numberValue(decoded[1]) : null;
    const rows = this.connection
      .prepare(
        `SELECT h.id, h.played_at, h.played_seconds, h.completed,
                t.track_id,
                COALESCE(t.title, substr(t.filename, 1,
                  length(t.filename) - length(t.extension) - 1)) AS display_title,
                t.artist_display, a.display_title AS album_display,
                t.duration_seconds, t.disc_number, t.track_number,
                t.artwork_available, a.representative_track_id,
                CASE WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                     THEN 1 ELSE 0 END AS effective_available
         FROM play_history h
         JOIN tracks t ON t.track_id = h.track_id
         JOIN library_sources s ON s.source_id = t.source_id
         LEFT JOIN albums a ON a.album_id = t.album_id
         ${decoded ? "WHERE h.played_at < ? OR (h.played_at = ? AND h.id < ?)" : ""}
         ORDER BY h.played_at DESC, h.id DESC
         LIMIT ?`,
      )
      .all(
        ...(decoded ? [cursorPlayedAt, cursorPlayedAt, cursorId] : []),
        limit + 1,
      ) as SqlRow[];
    const counts = this.connection
      .prepare(
        `SELECT COUNT(*) AS total,
                COUNT(CASE WHEN t.available = 1 AND s.available = 1
                                 AND s.removed = 0 THEN 1 END) AS available
         FROM play_history h
         JOIN tracks t ON t.track_id = h.track_id
         JOIN library_sources s ON s.source_id = t.source_id`,
      )
      .get() as SqlRow;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...trackFromRow(row),
        historyId: historyId(numberValue(row.id)),
        playedAt: numberValue(row.played_at),
        playedSeconds: numberValue(row.played_seconds),
        completed: numberValue(row.completed) === 1,
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([numberValue(last.played_at), numberValue(last.id)])
          : null,
      total: numberValue(counts.total),
      availableCount: numberValue(counts.available),
    };
  }

  removePlayHistory(id: number): number {
    return Number(
      this.connection.prepare("DELETE FROM play_history WHERE id = ?").run(id)
        .changes,
    );
  }

  clearPlayHistory(): number {
    return Number(
      this.connection.prepare("DELETE FROM play_history").run().changes,
    );
  }

  playHistoryTrackId(id: number): string | null {
    const row = this.connection
      .prepare("SELECT track_id FROM play_history WHERE id = ?")
      .get(id) as SqlRow | undefined;
    return row ? String(row.track_id) : null;
  }

  playHistoryContextTracks(): readonly LibraryContextTrack[] {
    return (
      this.connection
        .prepare(
          `WITH ranked AS (
             SELECT h.track_id, h.played_at, h.id,
                    ROW_NUMBER() OVER (
                      PARTITION BY h.track_id
                      ORDER BY h.played_at DESC, h.id DESC
                    ) AS occurrence
             FROM play_history h
           )
           SELECT t.track_id, t.source_id, t.relative_path
           FROM ranked r
           JOIN tracks t ON t.track_id = r.track_id
           JOIN library_sources s ON s.source_id = t.source_id
           WHERE r.occurrence = 1 AND t.available = 1
             AND s.available = 1 AND s.removed = 0
           ORDER BY r.played_at DESC, r.id DESC`,
        )
        .all() as SqlRow[]
    ).map((row) => ({
      id: String(row.track_id),
      sourceId: String(row.source_id),
      relativePath: String(row.relative_path),
    }));
  }

  recordQualifiedPlay(
    trackId: string,
    playedSeconds: number,
    completed: boolean,
    playedAt = Date.now(),
  ): boolean {
    const result = this.connection
      .prepare(
        `INSERT INTO track_play_stats (
           track_id, play_count, completed_count, total_played_seconds,
           first_played_at, last_played_at
         ) VALUES (?, 1, ?, ?, ?, ?)
         ON CONFLICT(track_id) DO UPDATE SET
           play_count = play_count + 1,
           completed_count = completed_count + excluded.completed_count,
           total_played_seconds = total_played_seconds + excluded.total_played_seconds,
           last_played_at = excluded.last_played_at`,
      )
      .run(trackId, completed ? 1 : 0, playedSeconds, playedAt, playedAt);
    return Number(result.changes) > 0;
  }

  updateQualifiedPlay(
    trackId: string,
    playedSecondsDelta: number,
    completedIncrement: boolean,
    playedAt = Date.now(),
  ): boolean {
    const result = this.connection
      .prepare(
        `UPDATE track_play_stats SET
           total_played_seconds = total_played_seconds + ?,
           completed_count = completed_count + ?,
           last_played_at = ?
         WHERE track_id = ?`,
      )
      .run(playedSecondsDelta, completedIncrement ? 1 : 0, playedAt, trackId);
    return Number(result.changes) > 0;
  }

  mostPlayed(cursor: string | null, limit: number): MostPlayedPage {
    const decoded = decodeCursor(cursor, 3);
    if (
      decoded &&
      (typeof decoded[0] !== "number" ||
        typeof decoded[1] !== "number" ||
        typeof decoded[2] !== "string")
    )
      throw new LibraryError(
        "INVALID_LIBRARY_CURSOR",
        "The Library page cursor is invalid.",
      );
    const rows = this.connection
      .prepare(
        `SELECT p.play_count, p.completed_count, p.total_played_seconds,
                p.first_played_at, p.last_played_at, t.track_id,
                COALESCE(t.title, substr(t.filename, 1,
                  length(t.filename) - length(t.extension) - 1)) AS display_title,
                t.artist_display, a.display_title AS album_display,
                t.duration_seconds, t.disc_number, t.track_number,
                t.artwork_available, a.representative_track_id,
                CASE WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                     THEN 1 ELSE 0 END AS effective_available
         FROM track_play_stats p
         JOIN tracks t ON t.track_id = p.track_id
         JOIN library_sources s ON s.source_id = t.source_id
         LEFT JOIN albums a ON a.album_id = t.album_id
         ${
           decoded
             ? `WHERE p.play_count < ? OR
           (p.play_count = ? AND p.last_played_at < ?) OR
           (p.play_count = ? AND p.last_played_at = ? AND p.track_id > ?)`
             : ""
         }
         ORDER BY p.play_count DESC, p.last_played_at DESC, p.track_id ASC
         LIMIT ?`,
      )
      .all(
        ...(decoded
          ? [
              Number(decoded[0]),
              Number(decoded[0]),
              Number(decoded[1]),
              Number(decoded[0]),
              Number(decoded[1]),
              String(decoded[2]),
            ]
          : []),
        limit + 1,
      ) as SqlRow[];
    const counts = this.connection
      .prepare(
        `SELECT COUNT(*) AS total,
                COUNT(CASE WHEN t.available = 1 AND s.available = 1
                                 AND s.removed = 0 THEN 1 END) AS available
         FROM track_play_stats p
         JOIN tracks t ON t.track_id = p.track_id
         JOIN library_sources s ON s.source_id = t.source_id`,
      )
      .get() as SqlRow;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...trackFromRow(row),
        playCount: numberValue(row.play_count),
        completedCount: numberValue(row.completed_count),
        totalPlayedSeconds: numberValue(row.total_played_seconds),
        firstPlayedAt: numberValue(row.first_played_at),
        lastPlayedAt: numberValue(row.last_played_at),
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([
              numberValue(last.play_count),
              numberValue(last.last_played_at),
              String(last.track_id),
            ])
          : null,
      total: numberValue(counts.total),
      availableCount: numberValue(counts.available),
    };
  }

  listeningStats(): ListeningStats {
    const row = this.connection
      .prepare(
        `SELECT COALESCE(SUM(total_played_seconds), 0) AS listening_seconds,
                COALESCE(SUM(play_count), 0) AS qualified_plays,
                COALESCE(SUM(completed_count), 0) AS completed_plays,
                COUNT(*) AS unique_tracks,
                MIN(first_played_at) AS tracking_since,
                MAX(last_played_at) AS last_listened
         FROM track_play_stats`,
      )
      .get() as SqlRow;
    return {
      listeningSeconds: numberValue(row.listening_seconds),
      qualifiedPlays: numberValue(row.qualified_plays),
      completedPlays: numberValue(row.completed_plays),
      uniqueTracks: numberValue(row.unique_tracks),
      trackingSince: nullableNumber(row.tracking_since),
      lastListened: nullableNumber(row.last_listened),
    };
  }

  resetPlayStats(): number {
    return Number(
      this.connection.prepare("DELETE FROM track_play_stats").run().changes,
    );
  }

  playlists(cursor: string | null, limit: number): PlaylistPage {
    const decoded = decodeCursor(cursor, 2);
    if (
      decoded &&
      (typeof decoded[0] !== "number" || typeof decoded[1] !== "string")
    )
      throw new LibraryError(
        "INVALID_LIBRARY_CURSOR",
        "The Library page cursor is invalid.",
      );
    const updatedAt = decoded ? Number(decoded[0]) : null;
    const playlistId = decoded ? String(decoded[1]) : null;
    const rows = this.connection
      .prepare(
        `SELECT p.id, p.name, p.created_at, p.updated_at,
                COUNT(i.id) AS track_count,
                COUNT(CASE WHEN t.available = 1 AND s.available = 1
                                 AND s.removed = 0 THEN 1 END) AS available_count,
                COALESCE(SUM(CASE WHEN t.available = 1 AND s.available = 1
                                      AND s.removed = 0
                                  THEN t.duration_seconds ELSE 0 END), 0)
                  AS total_duration_seconds,
                (SELECT COALESCE(
                    CASE WHEN at.artwork_available = 1 THEN at.track_id END,
                    aa.representative_track_id)
                 FROM playlist_items ai
                 JOIN tracks at ON at.track_id = ai.track_id
                 JOIN library_sources als ON als.source_id = at.source_id
                 LEFT JOIN albums aa ON aa.album_id = at.album_id
                 WHERE ai.playlist_id = p.id AND at.available = 1
                   AND als.available = 1 AND als.removed = 0
                 ORDER BY ai.position, ai.id LIMIT 1) AS artwork_track_id
         FROM playlists p
         LEFT JOIN playlist_items i ON i.playlist_id = p.id
         LEFT JOIN tracks t ON t.track_id = i.track_id
         LEFT JOIN library_sources s ON s.source_id = t.source_id
         ${decoded ? "WHERE p.updated_at < ? OR (p.updated_at = ? AND p.id > ?)" : ""}
         GROUP BY p.id
         ORDER BY p.updated_at DESC, p.id ASC
         LIMIT ?`,
      )
      .all(
        ...(decoded ? [updatedAt, updatedAt, playlistId] : []),
        limit + 1,
      ) as SqlRow[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const total = this.connection
      .prepare("SELECT COUNT(*) AS total FROM playlists")
      .get() as SqlRow;
    return {
      items: page.map((row) => this.playlistSummaryFromRow(row)),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([numberValue(last.updated_at), String(last.id)])
          : null,
      total: numberValue(total.total),
    };
  }

  playlist(id: string): PlaylistDetail | null {
    const summary = this.connection
      .prepare(
        `SELECT p.id, p.name, p.created_at, p.updated_at,
                COUNT(i.id) AS track_count,
                COUNT(CASE WHEN t.available = 1 AND s.available = 1
                                 AND s.removed = 0 THEN 1 END) AS available_count,
                COALESCE(SUM(CASE WHEN t.available = 1 AND s.available = 1
                                      AND s.removed = 0
                                  THEN t.duration_seconds ELSE 0 END), 0)
                  AS total_duration_seconds,
                NULL AS artwork_track_id
         FROM playlists p
         LEFT JOIN playlist_items i ON i.playlist_id = p.id
         LEFT JOIN tracks t ON t.track_id = i.track_id
         LEFT JOIN library_sources s ON s.source_id = t.source_id
         WHERE p.id = ? GROUP BY p.id`,
      )
      .get(id) as SqlRow | undefined;
    if (!summary) return null;
    const rows = this.connection
      .prepare(
        `SELECT i.id AS item_id, i.position, i.created_at, t.track_id,
                COALESCE(t.title, substr(t.filename, 1,
                  length(t.filename) - length(t.extension) - 1)) AS display_title,
                t.artist_display, a.display_title AS album_display,
                t.duration_seconds, t.disc_number, t.track_number,
                t.artwork_available, a.representative_track_id,
                CASE WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                     THEN 1 ELSE 0 END AS effective_available
         FROM playlist_items i
         JOIN tracks t ON t.track_id = i.track_id
         JOIN library_sources s ON s.source_id = t.source_id
         LEFT JOIN albums a ON a.album_id = t.album_id
         WHERE i.playlist_id = ? ORDER BY i.position, i.id
         LIMIT ?`,
      )
      .all(id, MAX_PLAYLIST_ITEMS + 1) as SqlRow[];
    if (rows.length > MAX_PLAYLIST_ITEMS)
      throw new LibraryError(
        "PLAYLIST_TOO_LARGE",
        `Playlist exceeds the ${String(MAX_PLAYLIST_ITEMS)} item safety limit.`,
        409,
      );
    const items: PlaylistItem[] = rows.map((row) => ({
      ...trackFromRow(row),
      itemId: String(row.item_id),
      position: numberValue(row.position),
      createdAt: numberValue(row.created_at),
    }));
    const firstArtwork = items.find(
      (item) => item.availability === "available" && item.artworkTrackId,
    )?.artworkTrackId;
    return {
      ...this.playlistSummaryFromRow(summary),
      artworkTrackId: firstArtwork ?? null,
      items,
    };
  }

  createPlaylist(nameValue: string, now = Date.now()): PlaylistSummary {
    const { name, normalizedName } = normalizePlaylistName(nameValue);
    const id = `playlist-${randomUUID()}`;
    try {
      this.connection
        .prepare(
          `INSERT INTO playlists (id, name, normalized_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, name, normalizedName, now, now);
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw new LibraryError(
          "PLAYLIST_NAME_EXISTS",
          "A playlist with this name already exists.",
          409,
        );
      throw error;
    }
    const created = this.playlist(id);
    if (!created) throw new Error("Created playlist could not be read");
    return {
      id: created.id,
      name: created.name,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      trackCount: created.trackCount,
      availableTrackCount: created.availableTrackCount,
      totalDurationSeconds: created.totalDurationSeconds,
      artworkTrackId: created.artworkTrackId,
    };
  }

  renamePlaylist(
    id: string,
    nameValue: string,
    now = Date.now(),
  ): PlaylistSummary | null {
    const { name, normalizedName } = normalizePlaylistName(nameValue);
    try {
      const result = this.connection
        .prepare(
          `UPDATE playlists SET name = ?, normalized_name = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(name, normalizedName, now, id);
      if (Number(result.changes) === 0) return null;
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw new LibraryError(
          "PLAYLIST_NAME_EXISTS",
          "A playlist with this name already exists.",
          409,
        );
      throw error;
    }
    const detail = this.playlist(id);
    if (!detail) return null;
    return {
      id: detail.id,
      name: detail.name,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      trackCount: detail.trackCount,
      availableTrackCount: detail.availableTrackCount,
      totalDurationSeconds: detail.totalDurationSeconds,
      artworkTrackId: detail.artworkTrackId,
    };
  }

  deletePlaylist(id: string): number {
    return Number(
      this.connection.prepare("DELETE FROM playlists WHERE id = ?").run(id)
        .changes,
    );
  }

  addPlaylistTracks(
    playlistId: string,
    trackIds: readonly string[],
    allowDuplicates: boolean,
    now = Date.now(),
  ): {
    readonly addedCount: number;
    readonly duplicateTrackIds: readonly string[];
  } {
    return this.database.transaction(() => {
      const playlist = this.connection
        .prepare("SELECT id FROM playlists WHERE id = ?")
        .get(playlistId);
      if (!playlist)
        throw new LibraryError(
          "PLAYLIST_NOT_FOUND",
          "This playlist no longer exists.",
          404,
        );
      if (trackIds.length === 0 || trackIds.length > MAX_PLAYLIST_ITEMS)
        throw new LibraryError(
          "INVALID_PLAYLIST_TRACKS",
          "Select between 1 and 2000 Library tracks.",
        );
      const known = new Set(
        (
          this.connection
            .prepare(
              `SELECT track_id FROM tracks WHERE track_id IN (${trackIds.map(() => "?").join(",")})`,
            )
            .all(...trackIds) as SqlRow[]
        ).map((row) => String(row.track_id)),
      );
      if (known.size !== new Set(trackIds).size)
        throw new LibraryError(
          "PLAYLIST_TRACK_NOT_FOUND",
          "One or more tracks no longer exist in the Library.",
          404,
        );
      const existing = new Set(
        (
          this.connection
            .prepare(
              "SELECT DISTINCT track_id FROM playlist_items WHERE playlist_id = ?",
            )
            .all(playlistId) as SqlRow[]
        ).map((row) => String(row.track_id)),
      );
      const seen = new Set(existing);
      const duplicates = new Set<string>();
      for (const trackId of trackIds) {
        if (seen.has(trackId)) duplicates.add(trackId);
        seen.add(trackId);
      }
      if (duplicates.size > 0 && !allowDuplicates)
        return { addedCount: 0, duplicateTrackIds: [...duplicates] };
      const row = this.connection
        .prepare(
          "SELECT COALESCE(MAX(position), -1) AS position, COUNT(*) AS count FROM playlist_items WHERE playlist_id = ?",
        )
        .get(playlistId) as SqlRow;
      if (numberValue(row.count) + trackIds.length > MAX_PLAYLIST_ITEMS)
        throw new LibraryError(
          "PLAYLIST_TOO_LARGE",
          `Playlist cannot exceed ${String(MAX_PLAYLIST_ITEMS)} items.`,
          409,
        );
      let position = numberValue(row.position) + 1;
      const insert = this.connection.prepare(
        `INSERT INTO playlist_items (id, playlist_id, track_id, position, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const trackId of trackIds)
        insert.run(
          `playlist-item-${randomUUID()}`,
          playlistId,
          trackId,
          position++,
          now,
        );
      this.connection
        .prepare("UPDATE playlists SET updated_at = ? WHERE id = ?")
        .run(now, playlistId);
      return { addedCount: trackIds.length, duplicateTrackIds: [] };
    });
  }

  removePlaylistItem(
    playlistId: string,
    itemId: string,
    now = Date.now(),
  ): number {
    return this.database.transaction(() => {
      const result = this.connection
        .prepare("DELETE FROM playlist_items WHERE playlist_id = ? AND id = ?")
        .run(playlistId, itemId);
      if (Number(result.changes) === 0) return 0;
      const rows = this.connection
        .prepare(
          "SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position, id",
        )
        .all(playlistId) as SqlRow[];
      this.connection
        .prepare(
          "UPDATE playlist_items SET position = position + 100000 WHERE playlist_id = ?",
        )
        .run(playlistId);
      const update = this.connection.prepare(
        "UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND id = ?",
      );
      rows.forEach((row, index) =>
        update.run(index, playlistId, String(row.id)),
      );
      this.connection
        .prepare("UPDATE playlists SET updated_at = ? WHERE id = ?")
        .run(now, playlistId);
      return 1;
    });
  }

  reorderPlaylist(
    playlistId: string,
    itemIds: readonly string[],
    now = Date.now(),
  ): boolean {
    return this.database.transaction(() => {
      const current = (
        this.connection
          .prepare(
            "SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position, id",
          )
          .all(playlistId) as SqlRow[]
      ).map((row) => String(row.id));
      if (
        current.length !== itemIds.length ||
        new Set(itemIds).size !== itemIds.length ||
        itemIds.some((id) => !current.includes(id))
      )
        throw new LibraryError(
          "INVALID_PLAYLIST_ORDER",
          "Playlist order no longer matches the current items.",
          409,
        );
      if (current.every((id, index) => id === itemIds[index])) return false;
      this.connection
        .prepare(
          "UPDATE playlist_items SET position = position + 100000 WHERE playlist_id = ?",
        )
        .run(playlistId);
      const update = this.connection.prepare(
        "UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND id = ?",
      );
      itemIds.forEach((id, index) => update.run(index, playlistId, id));
      this.connection
        .prepare("UPDATE playlists SET updated_at = ? WHERE id = ?")
        .run(now, playlistId);
      return true;
    });
  }

  playlistContextTracks(
    playlistId: string,
  ): readonly (LibraryContextTrack & { readonly contextId: string })[] {
    return (
      this.connection
        .prepare(
          `SELECT i.id AS context_id, t.track_id, t.source_id, t.relative_path
           FROM playlist_items i
           JOIN tracks t ON t.track_id = i.track_id
           JOIN library_sources s ON s.source_id = t.source_id
           WHERE i.playlist_id = ? AND t.available = 1
             AND s.available = 1 AND s.removed = 0
           ORDER BY i.position, i.id`,
        )
        .all(playlistId) as SqlRow[]
    ).map((row) => ({
      id: String(row.track_id),
      sourceId: String(row.source_id),
      relativePath: String(row.relative_path),
      contextId: String(row.context_id),
    }));
  }

  private playlistSummaryFromRow(row: SqlRow): PlaylistSummary {
    return {
      id: String(row.id),
      name: String(row.name),
      createdAt: numberValue(row.created_at),
      updatedAt: numberValue(row.updated_at),
      trackCount: numberValue(row.track_count),
      availableTrackCount: numberValue(row.available_count),
      totalDurationSeconds: numberValue(row.total_duration_seconds),
      artworkTrackId: nullableString(row.artwork_track_id),
    };
  }

  mostPlayedContextTracks(): readonly LibraryContextTrack[] {
    return (
      this.connection
        .prepare(
          `SELECT t.track_id, t.source_id, t.relative_path
           FROM track_play_stats p
           JOIN tracks t ON t.track_id = p.track_id
           JOIN library_sources s ON s.source_id = t.source_id
           WHERE t.available = 1 AND s.available = 1 AND s.removed = 0
           ORDER BY p.play_count DESC, p.last_played_at DESC, p.track_id ASC`,
        )
        .all() as SqlRow[]
    ).map((row) => ({
      id: String(row.track_id),
      sourceId: String(row.source_id),
      relativePath: String(row.relative_path),
    }));
  }

  private prunePlayHistory(now: number): void {
    this.connection
      .prepare("DELETE FROM play_history WHERE played_at < ?")
      .run(Math.max(0, now - HISTORY_RETENTION_MILLISECONDS));
    this.connection
      .prepare(
        `DELETE FROM play_history
         WHERE id NOT IN (
           SELECT id FROM play_history
           ORDER BY played_at DESC, id DESC LIMIT ?
         )`,
      )
      .run(MAX_HISTORY_EVENTS);
  }

  addFavoriteTrack(
    trackId: string,
    createdAt = Date.now(),
  ): FavoriteTrackMutationResponse | null {
    const track = this.connection
      .prepare("SELECT track_id FROM tracks WHERE track_id = ?")
      .get(trackId) as SqlRow | undefined;
    if (!track) return null;
    this.connection
      .prepare(
        `INSERT INTO favorite_tracks (track_id, created_at) VALUES (?, ?)
         ON CONFLICT(track_id) DO NOTHING`,
      )
      .run(trackId, createdAt);
    const row = this.connection
      .prepare("SELECT created_at FROM favorite_tracks WHERE track_id = ?")
      .get(trackId) as SqlRow;
    return {
      trackId,
      isFavorite: true,
      favoritedAt: numberValue(row.created_at),
    };
  }

  removeFavoriteTrack(trackId: string): FavoriteTrackMutationResponse {
    this.connection
      .prepare("DELETE FROM favorite_tracks WHERE track_id = ?")
      .run(trackId);
    return { trackId, isFavorite: false, favoritedAt: null };
  }

  favoriteTrackIds(trackIds: readonly string[]): readonly string[] {
    const unique = [...new Set(trackIds)];
    if (unique.length === 0) return [];
    const placeholders = unique.map(() => "?").join(", ");
    return (
      this.connection
        .prepare(
          `SELECT track_id FROM favorite_tracks
           WHERE track_id IN (${placeholders}) ORDER BY track_id`,
        )
        .all(...unique) as SqlRow[]
    ).map((row) => String(row.track_id));
  }

  favoriteTracks(cursor: string | null, limit: number): FavoriteTrackPage {
    const decoded = decodeCursor(cursor, 2);
    if (
      decoded &&
      (typeof decoded[0] !== "number" || typeof decoded[1] !== "string")
    )
      throw new LibraryError(
        "INVALID_LIBRARY_CURSOR",
        "The Library page cursor is invalid.",
      );
    const cursorCreatedAt = decoded ? numberValue(decoded[0]) : null;
    const cursorTrackId = decoded ? String(decoded[1]) : null;
    const rows = this.connection
      .prepare(
        `SELECT t.track_id,
                COALESCE(t.title, substr(t.filename, 1,
                  length(t.filename) - length(t.extension) - 1)) AS display_title,
                t.artist_display, a.display_title AS album_display,
                t.duration_seconds, t.disc_number, t.track_number,
                t.artwork_available, a.representative_track_id,
                CASE WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                     THEN 1 ELSE 0 END AS effective_available,
                f.created_at
         FROM favorite_tracks f
         JOIN tracks t ON t.track_id = f.track_id
         JOIN library_sources s ON s.source_id = t.source_id
         LEFT JOIN albums a ON a.album_id = t.album_id
         ${decoded ? "WHERE f.created_at < ? OR (f.created_at = ? AND f.track_id > ?)" : ""}
         ORDER BY f.created_at DESC, f.track_id ASC
         LIMIT ?`,
      )
      .all(
        ...(decoded ? [cursorCreatedAt, cursorCreatedAt, cursorTrackId] : []),
        limit + 1,
      ) as SqlRow[];
    const counts = this.connection
      .prepare(
        `SELECT COUNT(*) AS total,
                COUNT(CASE WHEN t.available = 1 AND s.available = 1
                                 AND s.removed = 0 THEN 1 END) AS available
         FROM favorite_tracks f
         JOIN tracks t ON t.track_id = f.track_id
         JOIN library_sources s ON s.source_id = t.source_id`,
      )
      .get() as SqlRow;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...trackFromRow(row),
        favoritedAt: numberValue(row.created_at),
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([numberValue(last.created_at), String(last.track_id)])
          : null,
      total: numberValue(counts.total),
      availableCount: numberValue(counts.available),
    };
  }

  favoriteContextTracks(): readonly LibraryContextTrack[] {
    return (
      this.connection
        .prepare(
          `SELECT t.track_id, t.source_id, t.relative_path
           FROM favorite_tracks f
           JOIN tracks t ON t.track_id = f.track_id
           JOIN library_sources s ON s.source_id = t.source_id
           WHERE t.available = 1 AND s.available = 1 AND s.removed = 0
           ORDER BY f.created_at DESC, f.track_id ASC`,
        )
        .all() as SqlRow[]
    ).map((row) => ({
      id: String(row.track_id),
      sourceId: String(row.source_id),
      relativePath: String(row.relative_path),
    }));
  }

  addFavoriteAlbum(
    albumId: string,
    createdAt = Date.now(),
  ): FavoriteAlbumMutationResponse | null {
    const album = this.connection
      .prepare("SELECT album_id FROM albums WHERE album_id = ?")
      .get(albumId) as SqlRow | undefined;
    if (!album) return null;
    this.connection
      .prepare(
        `INSERT INTO favorite_albums (album_id, created_at) VALUES (?, ?)
         ON CONFLICT(album_id) DO NOTHING`,
      )
      .run(albumId, createdAt);
    const row = this.connection
      .prepare("SELECT created_at FROM favorite_albums WHERE album_id = ?")
      .get(albumId) as SqlRow;
    return {
      albumId,
      isFavorite: true,
      favoritedAt: numberValue(row.created_at),
    };
  }

  removeFavoriteAlbum(albumId: string): FavoriteAlbumMutationResponse {
    this.connection
      .prepare("DELETE FROM favorite_albums WHERE album_id = ?")
      .run(albumId);
    return { albumId, isFavorite: false, favoritedAt: null };
  }

  favoriteAlbumIds(albumIds: readonly string[]): readonly string[] {
    const unique = [...new Set(albumIds)];
    if (unique.length === 0) return [];
    const placeholders = unique.map(() => "?").join(", ");
    return (
      this.connection
        .prepare(
          `SELECT album_id FROM favorite_albums
           WHERE album_id IN (${placeholders}) ORDER BY album_id`,
        )
        .all(...unique) as SqlRow[]
    ).map((row) => String(row.album_id));
  }

  favoriteAlbums(cursor: string | null, limit: number): FavoriteAlbumPage {
    const decoded = decodeCursor(cursor, 2);
    if (
      decoded &&
      (typeof decoded[0] !== "number" || typeof decoded[1] !== "string")
    )
      throw new LibraryError(
        "INVALID_LIBRARY_CURSOR",
        "The Library page cursor is invalid.",
      );
    const createdAt = decoded ? numberValue(decoded[0]) : null;
    const albumId = decoded ? String(decoded[1]) : null;
    const rows = this.connection
      .prepare(
        `SELECT a.album_id, a.display_title, a.album_artist_display, a.year,
                a.representative_track_id, a.track_count,
                COUNT(DISTINCT CASE
                  WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                  THEN t.track_id END) AS available_track_count,
                COALESCE(SUM(CASE
                  WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                  THEN t.duration_seconds ELSE 0 END), 0) AS total_duration_seconds,
                f.created_at
         FROM favorite_albums f
         JOIN albums a ON a.album_id = f.album_id
         LEFT JOIN tracks t ON t.album_id = a.album_id
         LEFT JOIN library_sources s ON s.source_id = t.source_id
         ${decoded ? "WHERE f.created_at < ? OR (f.created_at = ? AND f.album_id > ?)" : ""}
         GROUP BY a.album_id, f.created_at
         ORDER BY f.created_at DESC, f.album_id ASC
         LIMIT ?`,
      )
      .all(
        ...(decoded ? [createdAt, createdAt, albumId] : []),
        limit + 1,
      ) as SqlRow[];
    const counts = this.connection
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN EXISTS (
                  SELECT 1 FROM tracks t
                  JOIN library_sources s ON s.source_id = t.source_id
                  WHERE t.album_id = f.album_id AND t.available = 1
                    AND s.available = 1 AND s.removed = 0
                ) THEN 1 ELSE 0 END) AS available
         FROM favorite_albums f`,
      )
      .get() as SqlRow;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...albumFromRow(row),
        favoritedAt: numberValue(row.created_at),
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([numberValue(last.created_at), String(last.album_id)])
          : null,
      total: numberValue(counts.total),
      availableCount: numberValue(counts.available),
    };
  }

  favoriteAlbumContextTracks(): readonly LibraryContextTrack[] {
    const rows = this.connection
      .prepare(
        `SELECT t.track_id, t.source_id, t.relative_path
           FROM favorite_albums f
           JOIN tracks t ON t.album_id = f.album_id
           JOIN library_sources s ON s.source_id = t.source_id
           WHERE t.available = 1 AND s.available = 1 AND s.removed = 0
           ORDER BY f.created_at DESC, f.album_id ASC,
                    t.disc_number IS NULL, t.disc_number,
                    t.track_number IS NULL, t.track_number,
                    lower(COALESCE(t.title, t.filename)), t.track_id`,
      )
      .all() as SqlRow[];
    const seen = new Set<string>();
    const result: LibraryContextTrack[] = [];
    for (const row of rows) {
      const id = String(row.track_id);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        id,
        sourceId: String(row.source_id),
        relativePath: String(row.relative_path),
      });
    }
    return result;
  }

  addFavoriteArtist(
    artistId: string,
    createdAt = Date.now(),
  ): FavoriteArtistMutationResponse | null {
    const artist = this.connection
      .prepare("SELECT artist_id FROM artists WHERE artist_id = ?")
      .get(artistId) as SqlRow | undefined;
    if (!artist) return null;
    this.connection
      .prepare(
        `INSERT INTO favorite_artists (artist_id, created_at) VALUES (?, ?)
         ON CONFLICT(artist_id) DO NOTHING`,
      )
      .run(artistId, createdAt);
    const row = this.connection
      .prepare("SELECT created_at FROM favorite_artists WHERE artist_id = ?")
      .get(artistId) as SqlRow;
    return {
      artistId,
      isFavorite: true,
      favoritedAt: numberValue(row.created_at),
    };
  }

  removeFavoriteArtist(artistId: string): FavoriteArtistMutationResponse {
    this.connection
      .prepare("DELETE FROM favorite_artists WHERE artist_id = ?")
      .run(artistId);
    return { artistId, isFavorite: false, favoritedAt: null };
  }

  favoriteArtistIds(artistIds: readonly string[]): readonly string[] {
    const unique = [...new Set(artistIds)];
    if (unique.length === 0) return [];
    const placeholders = unique.map(() => "?").join(", ");
    return (
      this.connection
        .prepare(
          `SELECT artist_id FROM favorite_artists
           WHERE artist_id IN (${placeholders}) ORDER BY artist_id`,
        )
        .all(...unique) as SqlRow[]
    ).map((row) => String(row.artist_id));
  }

  favoriteArtists(cursor: string | null, limit: number): FavoriteArtistPage {
    const decoded = decodeCursor(cursor, 2);
    if (
      decoded &&
      (typeof decoded[0] !== "number" || typeof decoded[1] !== "string")
    )
      throw new LibraryError(
        "INVALID_LIBRARY_CURSOR",
        "The Library page cursor is invalid.",
      );
    const createdAt = decoded ? numberValue(decoded[0]) : null;
    const artistId = decoded ? String(decoded[1]) : null;
    const rows = this.connection
      .prepare(
        `WITH favorite_artist_tracks AS (
           SELECT f.artist_id, ta.track_id
           FROM favorite_artists f
           JOIN track_artists ta ON ta.artist_id = f.artist_id
           UNION
           SELECT f.artist_id, t.track_id
           FROM favorite_artists f
           JOIN albums a ON a.album_artist_id = f.artist_id
           JOIN tracks t ON t.album_id = a.album_id
         )
         SELECT ar.artist_id, ar.display_name, ar.album_count, ar.track_count,
                COUNT(DISTINCT CASE
                  WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                  THEN t.track_id END) AS available_track_count,
                f.created_at
         FROM favorite_artists f
         JOIN artists ar ON ar.artist_id = f.artist_id
         LEFT JOIN favorite_artist_tracks fat ON fat.artist_id = f.artist_id
         LEFT JOIN tracks t ON t.track_id = fat.track_id
         LEFT JOIN library_sources s ON s.source_id = t.source_id
         ${decoded ? "WHERE f.created_at < ? OR (f.created_at = ? AND f.artist_id > ?)" : ""}
         GROUP BY ar.artist_id, f.created_at
         ORDER BY f.created_at DESC, f.artist_id ASC
         LIMIT ?`,
      )
      .all(
        ...(decoded ? [createdAt, createdAt, artistId] : []),
        limit + 1,
      ) as SqlRow[];
    const counts = this.connection
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN EXISTS (
                  SELECT 1 FROM tracks t
                  JOIN library_sources s ON s.source_id = t.source_id
                  WHERE t.available = 1 AND s.available = 1 AND s.removed = 0
                    AND (EXISTS (
                      SELECT 1 FROM track_artists ta
                      WHERE ta.track_id = t.track_id AND ta.artist_id = f.artist_id
                    ) OR EXISTS (
                      SELECT 1 FROM albums a
                      WHERE a.album_id = t.album_id
                        AND a.album_artist_id = f.artist_id
                    ))
                ) THEN 1 ELSE 0 END) AS available
         FROM favorite_artists f`,
      )
      .get() as SqlRow;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...artistFromRow(row),
        favoritedAt: numberValue(row.created_at),
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([numberValue(last.created_at), String(last.artist_id)])
          : null,
      total: numberValue(counts.total),
      availableCount: numberValue(counts.available),
    };
  }

  favoriteArtistContextTracks(): readonly LibraryContextTrack[] {
    const rows = this.connection
      .prepare(
        `WITH favorite_artist_tracks AS (
           SELECT f.artist_id, f.created_at, ta.track_id
           FROM favorite_artists f
           JOIN track_artists ta ON ta.artist_id = f.artist_id
           UNION
           SELECT f.artist_id, f.created_at, t.track_id
           FROM favorite_artists f
           JOIN albums owned ON owned.album_artist_id = f.artist_id
           JOIN tracks t ON t.album_id = owned.album_id
         )
         SELECT fat.artist_id, fat.created_at, t.track_id, t.source_id,
                t.relative_path, t.album_id,
                lower(COALESCE(a.display_title, '')) AS album_key,
                lower(COALESCE(a.album_artist_display, '')) AS album_artist_key,
                lower(COALESCE(t.title, t.filename)) AS title_key,
                t.disc_number, t.track_number
         FROM favorite_artist_tracks fat
         JOIN tracks t ON t.track_id = fat.track_id
         JOIN library_sources s ON s.source_id = t.source_id
         LEFT JOIN albums a ON a.album_id = t.album_id
         WHERE t.available = 1 AND s.available = 1 AND s.removed = 0
         ORDER BY fat.created_at DESC, fat.artist_id ASC,
                  t.album_id IS NULL, album_key, album_artist_key,
                  CASE WHEN t.album_id IS NULL THEN 1 ELSE t.disc_number IS NULL END,
                  CASE WHEN t.album_id IS NULL THEN 2147483647
                       ELSE COALESCE(t.disc_number, 2147483647) END,
                  CASE WHEN t.album_id IS NULL THEN 1 ELSE t.track_number IS NULL END,
                  CASE WHEN t.album_id IS NULL THEN 2147483647
                       ELSE COALESCE(t.track_number, 2147483647) END,
                  title_key, t.track_id`,
      )
      .all() as SqlRow[];
    const seen = new Set<string>();
    const result: LibraryContextTrack[] = [];
    for (const row of rows) {
      const id = String(row.track_id);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        id,
        sourceId: String(row.source_id),
        relativePath: String(row.relative_path),
      });
    }
    return result;
  }

  searchArtists(
    normalizedQuery: string,
    cursor: string | null,
    limit: number,
  ): LibrarySearchPage<LibraryArtist> {
    const decoded = decodeSearchCursor(cursor, normalizedQuery, [
      "number",
      "string",
      "string",
    ]);
    const rows = this.connection
      .prepare(
        `WITH keyed AS MATERIALIZED (
           SELECT artist_id, display_name, album_count, track_count,
                  available_track_count,
                  search_name AS display_key
           FROM artists
         ), ranked AS MATERIALIZED (
           SELECT *, ${searchRankSql("display_key")} AS match_rank
           FROM keyed
         ), eligible AS MATERIALIZED (
           SELECT *, COUNT(*) OVER () AS total_count
           FROM ranked WHERE match_rank < 4
         )
         SELECT * FROM eligible
         ${decoded ? "WHERE (match_rank, display_key, artist_id) > (?, ?, ?)" : ""}
         ORDER BY match_rank, display_key, artist_id
         LIMIT ?`,
      )
      .all(
        ...searchRankParameters(normalizedQuery, 1),
        ...(decoded ?? []),
        limit + 1,
      );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(artistFromRow),
      total: numberValue(rows[0]?.total_count),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([
              normalizedQuery,
              numberValue(last.match_rank),
              String(last.display_key),
              String(last.artist_id),
            ])
          : null,
    };
  }

  searchAlbums(
    normalizedQuery: string,
    cursor: string | null,
    limit: number,
  ): LibrarySearchPage<LibrarySearchAlbum> {
    const decoded = decodeSearchCursor(cursor, normalizedQuery, [
      "number",
      "number",
      "string",
      "string",
      "string",
    ]);
    const rows = this.connection
      .prepare(
        `WITH keyed AS MATERIALIZED (
           SELECT album_id, display_title, album_artist_display, year,
                  representative_track_id, track_count, available_track_count,
                  search_title AS title_key, search_artist AS artist_key
           FROM albums
         ), ranked AS MATERIALIZED (
           SELECT *, ${searchRankSql("title_key")} AS title_rank,
                  ${searchRankSql("artist_key")} AS artist_rank
           FROM keyed
         ), matched AS MATERIALIZED (
           SELECT *, min(title_rank, artist_rank) AS match_rank,
                  CASE WHEN title_rank <= artist_rank THEN 0 ELSE 1 END AS field_priority
           FROM ranked
         ), eligible AS MATERIALIZED (
           SELECT *, COUNT(*) OVER () AS total_count
           FROM matched WHERE match_rank < 4
         )
         SELECT * FROM eligible
         ${decoded ? "WHERE (match_rank, field_priority, title_key, artist_key, album_id) > (?, ?, ?, ?, ?)" : ""}
         ORDER BY match_rank, field_priority, title_key, artist_key, album_id
         LIMIT ?`,
      )
      .all(
        ...searchRankParameters(normalizedQuery, 2),
        ...(decoded ?? []),
        limit + 1,
      ) as SqlRow[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(searchAlbumFromRow),
      total: numberValue(rows[0]?.total_count),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([
              normalizedQuery,
              numberValue(last.match_rank),
              numberValue(last.field_priority),
              String(last.title_key),
              String(last.artist_key),
              String(last.album_id),
            ])
          : null,
    };
  }

  searchTracks(
    normalizedQuery: string,
    cursor: string | null,
    limit: number,
  ): LibrarySearchPage<LibraryTrack> {
    const decoded = decodeSearchCursor(cursor, normalizedQuery, [
      "number",
      "number",
      "string",
      "string",
      "string",
      "string",
    ]);
    const rows = this.searchTrackRows(
      normalizedQuery,
      decoded,
      limit + 1,
      false,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(trackFromRow),
      total: numberValue(rows[0]?.total_count),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([
              normalizedQuery,
              numberValue(last.match_rank),
              numberValue(last.field_priority),
              String(last.title_key),
              String(last.artist_key),
              String(last.album_key),
              String(last.track_id),
            ])
          : null,
    };
  }

  contextTracks(
    context: "album" | "artist" | "tracks",
    id?: string,
  ): readonly LibraryContextTrack[] {
    const effective = "t.available = 1 AND s.available = 1 AND s.removed = 0";
    const baseSelect = `SELECT DISTINCT t.track_id, t.source_id, t.relative_path,
      lower(COALESCE(t.title, t.filename)) AS title_key,
      lower(COALESCE(t.artist_display, '')) AS artist_key,
      lower(COALESCE(a.display_title, '')) AS album_key,
      lower(COALESCE(a.album_artist_display, '')) AS album_artist_key,
      t.disc_number, t.track_number
      FROM tracks t
      JOIN library_sources s ON s.source_id = t.source_id
      LEFT JOIN albums a ON a.album_id = t.album_id`;
    let rows: SqlRow[];
    if (context === "album") {
      rows = this.connection
        .prepare(
          `${baseSelect} WHERE t.album_id = ? AND ${effective}
           ORDER BY t.disc_number IS NULL, t.disc_number,
                    t.track_number IS NULL, t.track_number,
                    title_key, t.track_id`,
        )
        .all(id ?? "");
    } else if (context === "artist") {
      rows = this.connection
        .prepare(
          `WITH artist_tracks(track_id) AS (
             SELECT track_id FROM track_artists WHERE artist_id = ?
             UNION
             SELECT t2.track_id FROM tracks t2
             JOIN albums a2 ON a2.album_id = t2.album_id
             WHERE a2.album_artist_id = ?
           )
           ${baseSelect}
           JOIN artist_tracks at ON at.track_id = t.track_id
           WHERE ${effective}
           ORDER BY t.album_id IS NULL, album_key, album_artist_key,
                    CASE WHEN t.album_id IS NULL THEN 1
                         ELSE t.disc_number IS NULL END,
                    CASE WHEN t.album_id IS NULL THEN 2147483647
                         ELSE COALESCE(t.disc_number, 2147483647) END,
                    CASE WHEN t.album_id IS NULL THEN 1
                         ELSE t.track_number IS NULL END,
                    CASE WHEN t.album_id IS NULL THEN 2147483647
                         ELSE COALESCE(t.track_number, 2147483647) END,
                    title_key, t.track_id`,
        )
        .all(id ?? "", id ?? "");
    } else {
      rows = this.connection
        .prepare(
          `${baseSelect} WHERE ${effective}
           ORDER BY title_key, artist_key, album_key,
                    t.disc_number IS NULL, t.disc_number,
                    t.track_number IS NULL, t.track_number, t.track_id`,
        )
        .all();
    }
    return rows.map((row) => ({
      id: String(row.track_id),
      sourceId: String(row.source_id),
      relativePath: String(row.relative_path),
    }));
  }

  contextTrack(trackId: string): LibraryContextTrack | null {
    const row = this.connection
      .prepare(
        `SELECT t.track_id, t.source_id, t.relative_path
         FROM tracks t JOIN library_sources s ON s.source_id = t.source_id
         WHERE t.track_id = ? AND t.available = 1
           AND s.available = 1 AND s.removed = 0`,
      )
      .get(trackId) as SqlRow | undefined;
    return row
      ? {
          id: String(row.track_id),
          sourceId: String(row.source_id),
          relativePath: String(row.relative_path),
        }
      : null;
  }

  playbackContextForTrack(
    trackId: string,
  ): { readonly albumId: string | null } | null {
    const row = this.connection
      .prepare(
        `SELECT t.album_id
         FROM tracks t JOIN library_sources s ON s.source_id = t.source_id
         WHERE t.track_id = ? AND t.available = 1
           AND s.available = 1 AND s.removed = 0`,
      )
      .get(trackId) as SqlRow | undefined;
    return row
      ? {
          albumId: typeof row.album_id === "string" ? row.album_id : null,
        }
      : null;
  }

  trackLocation(trackId: string): LibraryContextTrack | null {
    const row = this.connection
      .prepare(
        `SELECT track_id, source_id, relative_path
         FROM tracks WHERE track_id = ?`,
      )
      .get(trackId) as SqlRow | undefined;
    return row
      ? {
          id: String(row.track_id),
          sourceId: String(row.source_id),
          relativePath: String(row.relative_path),
        }
      : null;
  }

  catalogFingerprint(): string {
    const row = this.connection
      .prepare(
        `SELECT (SELECT COUNT(*) FROM tracks) AS tracks,
                COALESCE(SUM(current_generation), 0) AS generations,
                COALESCE(SUM(file_count), 0) AS files,
                COALESCE(SUM(unavailable_count), 0) AS unavailable
         FROM library_sources`,
      )
      .get() as SqlRow;
    return [
      numberValue(row.tracks),
      numberValue(row.generations),
      numberValue(row.files),
      numberValue(row.unavailable),
    ].join(":");
  }

  private artistTracks(
    artistId: string,
    cursor: string | null,
    limit: number,
  ): LibraryPage<LibraryTrack> {
    const decoded = decodeCursor(cursor, 7);
    const keys = `t.album_id IS NULL,
      lower(COALESCE(a.display_title, '')),
      lower(COALESCE(a.album_artist_display, '')),
      CASE WHEN t.album_id IS NULL THEN 2147483647
           ELSE COALESCE(t.disc_number, 2147483647) END,
      CASE WHEN t.album_id IS NULL THEN 2147483647
           ELSE COALESCE(t.track_number, 2147483647) END,
      lower(COALESCE(t.title, t.filename)), t.track_id`;
    const rows = this.connection
      .prepare(
        `WITH artist_tracks(track_id) AS (
           SELECT track_id FROM track_artists WHERE artist_id = ?
           UNION
           SELECT t2.track_id FROM tracks t2
           JOIN albums a2 ON a2.album_id = t2.album_id
           WHERE a2.album_artist_id = ?
         )
         SELECT t.track_id,
                COALESCE(t.title, substr(t.filename, 1,
                  length(t.filename) - length(t.extension) - 1)) AS display_title,
                t.artist_display, a.display_title AS album_display,
                t.duration_seconds, t.disc_number, t.track_number,
                t.artwork_available, a.representative_track_id,
                CASE WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                     THEN 1 ELSE 0 END AS effective_available,
                t.album_id IS NULL AS k1,
                lower(COALESCE(a.display_title, '')) AS k2,
                lower(COALESCE(a.album_artist_display, '')) AS k3,
                CASE WHEN t.album_id IS NULL THEN 2147483647
                     ELSE COALESCE(t.disc_number, 2147483647) END AS k4,
                CASE WHEN t.album_id IS NULL THEN 2147483647
                     ELSE COALESCE(t.track_number, 2147483647) END AS k5,
                lower(COALESCE(t.title, t.filename)) AS k6,
                t.track_id AS k7
         FROM artist_tracks at
         JOIN tracks t ON t.track_id = at.track_id
         JOIN library_sources s ON s.source_id = t.source_id
         LEFT JOIN albums a ON a.album_id = t.album_id
         ${decoded ? `WHERE (${keys}) > (?, ?, ?, ?, ?, ?, ?)` : ""}
         ORDER BY ${keys}
         LIMIT ?`,
      )
      .all(artistId, artistId, ...(decoded ?? []), limit + 1) as SqlRow[];
    return this.trackPage(rows, limit, true);
  }

  private searchTrackRows(
    normalizedQuery: string,
    cursor: readonly CursorValue[] | null,
    limit: number | null,
    availableOnly: boolean,
  ): SqlRow[] {
    const pageProjection = availableOnly
      ? "SELECT * FROM page"
      : `SELECT page.*, COALESCE(t.title, substr(t.filename, 1,
           length(t.filename) - length(t.extension) - 1)) AS display_title,
           t.artist_display, a.display_title AS album_display,
           t.album_artist_display, t.duration_seconds, t.disc_number,
           t.track_number, t.artwork_available, a.representative_track_id,
           CASE WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                THEN 1 ELSE 0 END AS effective_available
         FROM page
         JOIN tracks t ON t.track_id = page.track_id
         JOIN library_sources s ON s.source_id = t.source_id
         LEFT JOIN albums a ON a.album_id = t.album_id`;
    const eligibleProjection = availableOnly
      ? `SELECT *, 0 AS total_count FROM matched
         WHERE match_rank < 4 AND track_available = 1
           AND EXISTS (
             SELECT 1 FROM library_sources s
             WHERE s.source_id = matched.source_id
               AND s.available = 1 AND s.removed = 0
           )`
      : `SELECT *, COUNT(*) OVER () AS total_count
         FROM matched WHERE match_rank < 4`;
    const identityProjection = availableOnly
      ? `t.track_id, t.source_id, t.relative_path,
         t.available AS track_available,`
      : "t.track_id,";
    return this.connection
      .prepare(
        `WITH ranked AS MATERIALIZED (
           SELECT ${identityProjection}
                  t.search_title AS title_key,
                  t.search_artist AS artist_key,
                  t.search_album AS album_key,
                  ${searchRankSql("t.search_title")} AS title_rank,
                  ${searchRankSql("t.search_artist")} AS artist_rank,
                  ${searchRankSql("t.search_album")} AS album_rank,
                  ${searchRankSql("t.search_album_artist")} AS album_artist_rank
           FROM tracks t
         ), matched AS MATERIALIZED (
           SELECT *, min(title_rank, artist_rank, album_rank, album_artist_rank) AS match_rank,
                  CASE
                    WHEN title_rank = min(title_rank, artist_rank, album_rank, album_artist_rank) THEN 0
                    WHEN artist_rank = min(title_rank, artist_rank, album_rank, album_artist_rank) THEN 1
                    WHEN album_rank = min(title_rank, artist_rank, album_rank, album_artist_rank) THEN 2
                    ELSE 3
                  END AS field_priority
           FROM ranked
         ), eligible AS MATERIALIZED (
           ${eligibleProjection}
         ), page AS MATERIALIZED (
           SELECT * FROM eligible
           ${cursor ? "WHERE (match_rank, field_priority, title_key, artist_key, album_key, track_id) > (?, ?, ?, ?, ?, ?)" : ""}
           ORDER BY match_rank, field_priority, title_key, artist_key, album_key, track_id
           ${limit === null ? "" : "LIMIT ?"}
         )
         ${pageProjection}
         ORDER BY match_rank, field_priority, title_key, artist_key, album_key, track_id
         `,
      )
      .all(
        ...searchRankParameters(normalizedQuery, 4),
        ...(cursor ?? []),
        ...(limit === null ? [] : [limit]),
      );
  }

  private trackRows(
    joinPrefix: string,
    cursor: readonly CursorValue[] | null,
    tailParameters: readonly CursorValue[],
  ): SqlRow[] {
    const keys = `lower(COALESCE(t.title, t.filename)),
      lower(COALESCE(t.artist_display, '')),
      lower(COALESCE(a.display_title, '')),
      COALESCE(t.disc_number, 2147483647),
      COALESCE(t.track_number, 2147483647), t.track_id`;
    return this.connection
      .prepare(
        `SELECT t.track_id,
                COALESCE(t.title, substr(t.filename, 1,
                  length(t.filename) - length(t.extension) - 1)) AS display_title,
                t.artist_display, a.display_title AS album_display,
                t.duration_seconds, t.disc_number, t.track_number,
                t.artwork_available, a.representative_track_id,
                CASE WHEN t.available = 1 AND s.available = 1 AND s.removed = 0
                     THEN 1 ELSE 0 END AS effective_available,
                lower(COALESCE(t.title, t.filename)) AS k1,
                lower(COALESCE(t.artist_display, '')) AS k2,
                lower(COALESCE(a.display_title, '')) AS k3,
                COALESCE(t.disc_number, 2147483647) AS k4,
                COALESCE(t.track_number, 2147483647) AS k5,
                t.track_id AS k6
         FROM tracks t
         JOIN library_sources s ON s.source_id = t.source_id
         LEFT JOIN albums a ON a.album_id = t.album_id
         ${joinPrefix}
         ${cursor ? `WHERE (${keys}) > (${cursor.map(() => "?").join(", ")})` : ""}
         ORDER BY ${keys}
         LIMIT ?`,
      )
      .all(...(cursor ?? []), tailParameters.at(-1) ?? 1);
  }

  private trackPage(
    rows: readonly SqlRow[],
    limit: number,
    artistOrder = false,
  ): LibraryPage<LibraryTrack> {
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const cursorValues = last
      ? artistOrder
        ? [
            numberValue(last.k1),
            String(last.k2),
            String(last.k3),
            numberValue(last.k4),
            numberValue(last.k5),
            String(last.k6),
            String(last.k7),
          ]
        : [
            String(last.k1),
            String(last.k2),
            String(last.k3),
            numberValue(last.k4),
            numberValue(last.k5),
            String(last.k6),
          ]
      : null;
    return {
      items: page.map(trackFromRow),
      nextCursor:
        rows.length > limit && cursorValues ? encodeCursor(cursorValues) : null,
    };
  }

  private upsertTrack(track: IndexedTrackInput): void {
    const artists = trackArtists(track.metadata);
    const album = albumIdentity(track.sourceId, track.metadata);
    const albumArtist = album?.albumArtistDisplay
      ? artistIdentity(album.albumArtistDisplay)
      : null;
    const upsertArtist = this.connection.prepare(`
      INSERT INTO artists (
        artist_id, normalized_key, display_name, search_name, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(artist_id) DO UPDATE SET
        display_name = excluded.display_name,
        search_name = excluded.search_name,
        updated_at = excluded.updated_at
    `);
    for (const artist of artists)
      upsertArtist.run(
        artist.id,
        artist.key,
        artist.displayName,
        normalizeLibrarySearchKey(artist.displayName),
        track.seenAt,
      );
    if (albumArtist)
      upsertArtist.run(
        albumArtist.id,
        albumArtist.key,
        albumArtist.displayName,
        normalizeLibrarySearchKey(albumArtist.displayName),
        track.seenAt,
      );
    if (album)
      this.connection
        .prepare(
          `INSERT INTO albums (
             album_id, normalized_key, display_title, album_artist_id,
             album_artist_display, year, representative_track_id,
             representative_artwork_revision, search_title, search_artist,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(album_id) DO UPDATE SET
             display_title = excluded.display_title,
             album_artist_id = excluded.album_artist_id,
             album_artist_display = excluded.album_artist_display,
             year = COALESCE(excluded.year, albums.year),
             search_title = excluded.search_title,
             search_artist = excluded.search_artist,
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
          normalizeLibrarySearchKey(album.displayTitle),
          normalizeLibrarySearchKey(album.albumArtistDisplay ?? ""),
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
           last_seen_generation, title, search_title, album_id, artist_display,
           search_artist, album_artist_display, search_album_artist,
           search_album, track_number, track_total, disc_number,
           disc_total, duration_seconds, codec, container, bitrate, sample_rate,
           bit_depth, channels, lossless, year, genre_raw, genre_normalized,
           artwork_available, artwork_source_type, artwork_revision,
           metadata_state, metadata_error_code
         ) VALUES (${Array.from({ length: 39 }, (_, index) => (index === 7 ? "1" : "?")).join(", ")})
         ON CONFLICT(source_id, relative_path) DO UPDATE SET
           filename = excluded.filename,
           extension = excluded.extension,
           size = excluded.size,
           mtime_ms = excluded.mtime_ms,
           available = 1,
           last_seen_at = excluded.last_seen_at,
           last_seen_generation = excluded.last_seen_generation,
           title = excluded.title,
           search_title = excluded.search_title,
           album_id = excluded.album_id,
           artist_display = excluded.artist_display,
           search_artist = excluded.search_artist,
           album_artist_display = excluded.album_artist_display,
           search_album_artist = excluded.search_album_artist,
           search_album = excluded.search_album,
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
        normalizeLibrarySearchKey(
          track.metadata.title ??
            track.filename.slice(0, -(track.extension.length + 1)),
        ),
        album?.id ?? null,
        track.metadata.artist,
        normalizeLibrarySearchKey(track.metadata.artist ?? ""),
        track.metadata.albumArtist,
        normalizeLibrarySearchKey(track.metadata.albumArtist ?? ""),
        normalizeLibrarySearchKey(album?.displayTitle ?? ""),
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
             SELECT COUNT(*) FROM (
               SELECT track_id FROM track_artists
               WHERE track_artists.artist_id = artists.artist_id
               UNION
               SELECT tracks.track_id FROM tracks
               JOIN albums ON albums.album_id = tracks.album_id
               WHERE albums.album_artist_id = artists.artist_id
             )
           ),
           album_count = (
             SELECT COUNT(DISTINCT album_id) FROM (
               SELECT tracks.album_id
               FROM track_artists
               JOIN tracks ON tracks.track_id = track_artists.track_id
               WHERE track_artists.artist_id = artists.artist_id
                 AND tracks.album_id IS NOT NULL
               UNION
               SELECT albums.album_id FROM albums
               WHERE albums.album_artist_id = artists.artist_id
             )
           ),
           available_track_count = (
             SELECT COUNT(*) FROM (
               SELECT tracks.track_id
               FROM track_artists
               JOIN tracks ON tracks.track_id = track_artists.track_id
               JOIN library_sources s ON s.source_id = tracks.source_id
               WHERE track_artists.artist_id = artists.artist_id
                 AND tracks.available = 1
                 AND s.available = 1 AND s.removed = 0
               UNION
               SELECT tracks.track_id FROM tracks
               JOIN albums ON albums.album_id = tracks.album_id
               JOIN library_sources s ON s.source_id = tracks.source_id
               WHERE albums.album_artist_id = artists.artist_id
                 AND tracks.available = 1
                 AND s.available = 1 AND s.removed = 0
             )
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
