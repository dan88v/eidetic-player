import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryDatabase } from "../apps/backend/src/library/library-database.js";
import { normalizeLibrarySearchKey } from "../apps/backend/src/library/library-normalization.js";
import { LibraryRepository } from "../apps/backend/src/library/library-repository.js";

const TRACK_COUNT = 10_000;
const ALBUM_COUNT = 1_000;
const ARTIST_COUNT = 500;
const SOURCE_ID = "11111111-1111-4111-8111-111111111111";

interface Timing {
  readonly median: number;
  readonly p95: number;
  readonly maximum: number;
}

function measure(operation: () => unknown, rounds = 8): Timing {
  operation();
  const values: number[] = [];
  for (let index = 0; index < rounds; index += 1) {
    const started = performance.now();
    operation();
    values.push(performance.now() - started);
  }
  values.sort((left, right) => left - right);
  return {
    median: Number(values[Math.floor(values.length / 2)]?.toFixed(3)),
    p95: Number(values[Math.floor(values.length * 0.95)]?.toFixed(3)),
    maximum: Number(values.at(-1)?.toFixed(3)),
  };
}

function opaqueId(kind: "artist" | "album" | "track", value: number): string {
  return `${kind}-${value.toString(16).padStart(32, "0")}`;
}

const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-search-"));
const database = await LibraryDatabase.open(join(temporary, "library.db"));
const repository = new LibraryRepository(database);
const connection = database.connection;
const now = new Date().toISOString();

try {
  const insertSource = connection.prepare(`
    INSERT INTO library_sources(
      source_id, display_name, available, first_scan_completed, scan_status,
      current_generation, file_count, unavailable_count, created_at, updated_at
    ) VALUES (?, ?, 1, 1, 'completed', 1, ?, ?, ?, ?)
  `);
  const insertArtist = connection.prepare(`
    INSERT INTO artists(
      artist_id, normalized_key, display_name, track_count, album_count,
      available_track_count, updated_at
    ) VALUES (?, ?, ?, 20, 2, ?, ?)
  `);
  const insertAlbum = connection.prepare(`
    INSERT INTO albums(
      album_id, normalized_key, display_title, album_artist_id,
      album_artist_display, year, track_count, available_track_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 10, ?, ?)
  `);
  const insertTrack = connection.prepare(`
    INSERT INTO tracks(
      track_id, source_id, relative_path, filename, extension, size, mtime_ms,
      available, first_seen_at, last_seen_at, last_seen_generation, title,
      album_id, artist_display, album_artist_display, duration_seconds,
      artwork_available, metadata_state, genre_raw, genre_normalized
    ) VALUES (?, ?, ?, ?, 'mp3', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?,
      'parsed', '[]', '[]')
  `);
  insertSource.run(SOURCE_ID, "Benchmark", TRACK_COUNT, 104, now, now);
  connection.exec("BEGIN IMMEDIATE");
  try {
    for (let artistIndex = 0; artistIndex < ARTIST_COUNT; artistIndex += 1) {
      const name =
        artistIndex === 0
          ? "Björk"
          : artistIndex === 1
            ? "The Presidents of the United States of America"
            : artistIndex === 2
              ? "Golden Artist"
              : `Artist ${String(artistIndex).padStart(3, "0")}`;
      insertArtist.run(
        opaqueId("artist", artistIndex),
        normalizeLibrarySearchKey(name),
        name,
        20 - (artistIndex % 17 === 0 ? 1 : 0),
        now,
      );
    }
    for (let albumIndex = 0; albumIndex < ALBUM_COUNT; albumIndex += 1) {
      const artistIndex = Math.floor(albumIndex / 2);
      const artist =
        artistIndex === 0
          ? "Björk"
          : artistIndex === 1
            ? "The Presidents of the United States of America"
            : artistIndex === 2
              ? "Golden Artist"
              : `Artist ${String(artistIndex).padStart(3, "0")}`;
      const albumArtist = albumIndex % 67 === 0 ? "Various Artists" : artist;
      const title =
        albumIndex === 0
          ? "Golden Hour"
          : albumIndex === 1
            ? "Ágætis byrjun"
            : albumIndex % 50 === 0
              ? `The Golden Collection ${String(albumIndex)}`
              : albumIndex % 37 === 0
                ? `After-Hours Anthology ${String(albumIndex)}`
                : `Album ${String(albumIndex).padStart(4, "0")}`;
      insertAlbum.run(
        opaqueId("album", albumIndex),
        `${normalizeLibrarySearchKey(title)}\0artist:${normalizeLibrarySearchKey(albumArtist)}`,
        title,
        opaqueId("artist", artistIndex),
        albumArtist,
        1990 + (albumIndex % 35),
        10 - (albumIndex % 10 === 0 ? 1 : 0),
        now,
      );
      for (let offset = 0; offset < 10; offset += 1) {
        const trackIndex = albumIndex * 10 + offset;
        const missingTitle = trackIndex % 113 === 0;
        const title = missingTitle
          ? null
          : trackIndex === 1
            ? "Anti-Hero"
            : trackIndex === 2
              ? "Golden Hour"
              : trackIndex % 41 === 0
                ? `Anti-Hero Live ${String(trackIndex)}`
                : trackIndex % 29 === 0
                  ? `The Hero Returns ${String(trackIndex)}`
                  : trackIndex % 23 === 0
                    ? `Midnight Golden Hour ${String(trackIndex)}`
                    : `Track ${String(trackIndex).padStart(5, "0")}`;
        const filename = missingTitle
          ? `Golden Hour Fallback ${String(trackIndex)}.mp3`
          : `${String(trackIndex).padStart(5, "0")}.mp3`;
        insertTrack.run(
          opaqueId("track", trackIndex),
          SOURCE_ID,
          `Album ${String(albumIndex)}/${filename}`,
          filename,
          1_000 + trackIndex,
          2_000 + trackIndex,
          trackIndex % 97 === 0 ? 0 : 1,
          now,
          now,
          title,
          opaqueId("album", albumIndex),
          artist,
          albumArtist,
          120 + (trackIndex % 300),
          trackIndex % 13 === 0 ? 1 : 0,
        );
      }
    }
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }

  const queries = {
    exact: "golden hour",
    prefix: "anti",
    wordPrefix: "hero",
    contains: "old",
    accented: "bjork",
    common: "track",
    absent: "zzzz-not-found",
  } as const;
  connection.exec(`
    UPDATE artists SET search_name = library_search_key(display_name);
    UPDATE albums SET
      search_title = library_search_key(display_title),
      search_artist = library_search_key(COALESCE(album_artist_display, ''));
    UPDATE tracks SET
      search_title = library_search_key(COALESCE(title,
        substr(filename, 1, length(filename) - length(extension) - 1))),
      search_artist = library_search_key(COALESCE(artist_display, '')),
      search_album = library_search_key(COALESCE((
        SELECT display_title FROM albums WHERE albums.album_id = tracks.album_id
      ), '')),
      search_album_artist = library_search_key(COALESCE(album_artist_display, ''));
  `);
  const searchTiming = Object.fromEntries(
    Object.entries(queries).map(([name, query]) => {
      const selectedTrackId = repository.searchTracks(query, null, 1).items[0]
        ?.id;
      const playbackContext = (): readonly unknown[] => {
        if (!selectedTrackId) return [];
        const target = repository.playbackContextForTrack(selectedTrackId);
        if (!target) return [];
        return target.albumId
          ? repository.contextTracks("album", target.albumId)
          : [repository.contextTrack(selectedTrackId)].filter(Boolean);
      };
      return [
        name,
        {
          grouped: measure(() => {
            repository.searchArtists(query, null, 5);
            repository.searchAlbums(query, null, 6);
            repository.searchTracks(query, null, 8);
          }),
          tracks: measure(() => repository.searchTracks(query, null, 48)),
          context: measure(playbackContext, name === "common" ? 5 : 10),
          totals: {
            artists: repository.searchArtists(query, null, 5).total,
            albums: repository.searchAlbums(query, null, 6).total,
            tracks: repository.searchTracks(query, null, 8).total,
            context: playbackContext().length,
          },
        },
      ];
    }),
  );
  connection.exec(`
    UPDATE artists SET search_name = library_search_key(display_name);
    UPDATE albums SET
      search_title = library_search_key(display_title),
      search_artist = library_search_key(COALESCE(album_artist_display, ''));
    UPDATE tracks SET
      search_title = library_search_key(COALESCE(title,
        substr(filename, 1, length(filename) - length(extension) - 1))),
      search_artist = library_search_key(COALESCE(artist_display, '')),
      search_album = library_search_key(COALESCE((
        SELECT display_title FROM albums WHERE albums.album_id = tracks.album_id
      ), '')),
      search_album_artist = library_search_key(COALESCE(album_artist_display, ''));
  `);
  const rankSql = (field: string): string => `CASE
    WHEN ${field} = ? THEN 0
    WHEN ${field} GLOB ? || '*' THEN 1
    WHEN instr(' ' || ${field}, ' ' || ?) > 0 THEN 2
    WHEN instr(${field}, ?) > 0 THEN 3
    ELSE 4 END`;
  const prototypeArtist = connection.prepare(`
    WITH ranked AS MATERIALIZED (
      SELECT artist_id, search_name,
        ${rankSql("search_name")} AS match_rank
      FROM artists
    ) SELECT *, COUNT(*) OVER () AS total_count FROM ranked
      WHERE match_rank < 4 ORDER BY match_rank, search_name, artist_id LIMIT ?
  `);
  const prototypeAlbum = connection.prepare(`
    WITH ranked AS MATERIALIZED (
      SELECT album_id, search_title, search_artist,
        ${rankSql("search_title")} AS title_rank,
        ${rankSql("search_artist")} AS artist_rank
      FROM albums
    ), matched AS MATERIALIZED (
      SELECT *, min(title_rank, artist_rank) AS match_rank,
        CASE WHEN title_rank <= artist_rank THEN 0 ELSE 1 END AS field_priority
      FROM ranked
    ) SELECT *, COUNT(*) OVER () AS total_count FROM matched
      WHERE match_rank < 4
      ORDER BY match_rank, field_priority, search_title, search_artist, album_id
      LIMIT ?
  `);
  const prototypeTrack = connection.prepare(`
    WITH ranked AS MATERIALIZED (
      SELECT track_id, available, search_title, search_artist, search_album,
        search_album_artist,
        ${rankSql("search_title")} AS title_rank,
        ${rankSql("search_artist")} AS artist_rank,
        ${rankSql("search_album")} AS album_rank,
        ${rankSql("search_album_artist")} AS album_artist_rank
      FROM tracks
    ), matched AS MATERIALIZED (
      SELECT *, min(title_rank, artist_rank, album_rank, album_artist_rank) AS match_rank,
        CASE
          WHEN title_rank = min(title_rank, artist_rank, album_rank, album_artist_rank) THEN 0
          WHEN artist_rank = min(title_rank, artist_rank, album_rank, album_artist_rank) THEN 1
          WHEN album_rank = min(title_rank, artist_rank, album_rank, album_artist_rank) THEN 2
          ELSE 3 END AS field_priority
      FROM ranked
    ) SELECT *, COUNT(*) OVER () AS total_count FROM matched
      WHERE match_rank < 4
      ORDER BY match_rank, field_priority, search_title, search_artist, search_album, track_id
      LIMIT ?
  `);
  const prototypeContext = connection.prepare(`
    WITH ranked AS MATERIALIZED (
      SELECT track_id, available, search_title, search_artist, search_album,
        search_album_artist,
        ${rankSql("search_title")} AS title_rank,
        ${rankSql("search_artist")} AS artist_rank,
        ${rankSql("search_album")} AS album_rank,
        ${rankSql("search_album_artist")} AS album_artist_rank
      FROM tracks
    ), matched AS MATERIALIZED (
      SELECT *, min(title_rank, artist_rank, album_rank, album_artist_rank) AS match_rank,
        CASE
          WHEN title_rank = min(title_rank, artist_rank, album_rank, album_artist_rank) THEN 0
          WHEN artist_rank = min(title_rank, artist_rank, album_rank, album_artist_rank) THEN 1
          WHEN album_rank = min(title_rank, artist_rank, album_rank, album_artist_rank) THEN 2
          ELSE 3 END AS field_priority
      FROM ranked
    ) SELECT track_id FROM matched WHERE match_rank < 4 AND available = 1
      ORDER BY match_rank, field_priority, search_title, search_artist, search_album, track_id
  `);
  const rankParameters = (query: string, fields: number): string[] =>
    Array.from({ length: fields * 4 }, () => query);
  const narrowSqlComparisonTiming = Object.fromEntries(
    Object.entries(queries).map(([name, query]) => [
      name,
      {
        grouped: measure(() => {
          prototypeArtist.all(...rankParameters(query, 1), 6);
          prototypeAlbum.all(...rankParameters(query, 2), 7);
          prototypeTrack.all(...rankParameters(query, 4), 9);
        }, 20),
        tracks: measure(
          () => prototypeTrack.all(...rankParameters(query, 4), 49),
          20,
        ),
        context: measure(
          () => prototypeContext.all(...rankParameters(query, 4)),
          10,
        ),
      },
    ]),
  );
  const categoryQueries = {
    artists: "artist",
    albums: "album",
    tracks: queries.common,
  } as const;
  const categoryFirstPageTiming = {
    artists: measure(() =>
      repository.searchArtists(categoryQueries.artists, null, 48),
    ),
    albums: measure(() =>
      repository.searchAlbums(categoryQueries.albums, null, 48),
    ),
    tracks: measure(() =>
      repository.searchTracks(categoryQueries.tracks, null, 48),
    ),
  };
  const firstTrackPage = repository.searchTracks(
    categoryQueries.tracks,
    null,
    48,
  );
  const firstAlbumPage = repository.searchAlbums(
    categoryQueries.albums,
    null,
    48,
  );
  const firstArtistPage = repository.searchArtists(
    categoryQueries.artists,
    null,
    48,
  );
  const paginationTiming = {
    tracks: firstTrackPage.nextCursor
      ? measure(() =>
          repository.searchTracks(
            categoryQueries.tracks,
            firstTrackPage.nextCursor,
            48,
          ),
        )
      : null,
    albums: firstAlbumPage.nextCursor
      ? measure(() =>
          repository.searchAlbums(
            categoryQueries.albums,
            firstAlbumPage.nextCursor,
            48,
          ),
        )
      : null,
    artists: firstArtistPage.nextCursor
      ? measure(() =>
          repository.searchArtists(
            categoryQueries.artists,
            firstArtistPage.nextCursor,
            48,
          ),
        )
      : null,
  };
  const explain = {
    artists: connection
      .prepare(
        "EXPLAIN QUERY PLAN SELECT artist_id FROM artists WHERE instr(search_name, ?) > 0 ORDER BY search_name, artist_id LIMIT ?",
      )
      .all(queries.prefix, 6),
    albums: connection
      .prepare(
        "EXPLAIN QUERY PLAN SELECT album_id FROM albums WHERE instr(search_title, ?) > 0 OR instr(search_artist, ?) > 0 ORDER BY search_title, album_id LIMIT ?",
      )
      .all(queries.prefix, queries.prefix, 7),
    tracks: connection
      .prepare(
        "EXPLAIN QUERY PLAN SELECT track_id FROM tracks WHERE instr(search_title, ?) > 0 ORDER BY search_title, track_id LIMIT ?",
      )
      .all(queries.prefix, 49),
  };
  const virtualTables = connection
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%VIRTUAL TABLE%'",
    )
    .all();
  console.log(
    JSON.stringify(
      {
        fixture: {
          tracks: TRACK_COUNT,
          albums: ALBUM_COUNT,
          artists: ARTIST_COUNT,
          unavailable: 104,
          databaseBytes: repository.databaseSizeBytes(),
        },
        searchTiming,
        narrowSqlComparisonTiming,
        categoryFirstPageTiming,
        paginationTiming,
        explain,
        virtualTables,
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
  await rm(temporary, { recursive: true, force: true });
}
