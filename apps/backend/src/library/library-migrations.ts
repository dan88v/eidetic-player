import type { DatabaseSync } from "node:sqlite";
import { LibraryFutureVersionError } from "./library-errors.js";

export const LIBRARY_SCHEMA_VERSION = 4;

const migrationV1 = `
CREATE TABLE library_sources (
  source_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  first_scan_completed INTEGER NOT NULL DEFAULT 0 CHECK (first_scan_completed IN (0, 1)),
  scan_status TEXT NOT NULL DEFAULT 'idle',
  last_scan_started TEXT,
  last_scan_completed TEXT,
  last_successful_scan TEXT,
  last_error_code TEXT,
  current_generation INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE artists (
  artist_id TEXT PRIMARY KEY,
  normalized_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  sort_name TEXT,
  track_count INTEGER NOT NULL DEFAULT 0,
  album_count INTEGER NOT NULL DEFAULT 0,
  available_track_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE albums (
  album_id TEXT PRIMARY KEY,
  normalized_key TEXT NOT NULL UNIQUE,
  display_title TEXT NOT NULL,
  album_artist_id TEXT REFERENCES artists(artist_id) ON DELETE SET NULL,
  album_artist_display TEXT,
  year INTEGER,
  representative_track_id TEXT,
  representative_artwork_revision TEXT,
  track_count INTEGER NOT NULL DEFAULT 0,
  available_track_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE tracks (
  track_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES library_sources(source_id) ON DELETE RESTRICT,
  relative_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  mtime_ms REAL NOT NULL,
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_seen_generation INTEGER NOT NULL,
  title TEXT,
  album_id TEXT REFERENCES albums(album_id) ON DELETE SET NULL,
  artist_display TEXT,
  album_artist_display TEXT,
  track_number INTEGER,
  track_total INTEGER,
  disc_number INTEGER,
  disc_total INTEGER,
  duration_seconds REAL,
  codec TEXT,
  container TEXT,
  bitrate INTEGER,
  sample_rate INTEGER,
  bit_depth INTEGER,
  channels INTEGER,
  lossless INTEGER CHECK (lossless IS NULL OR lossless IN (0, 1)),
  year INTEGER,
  genre_raw TEXT NOT NULL DEFAULT '[]',
  genre_normalized TEXT NOT NULL DEFAULT '[]',
  artwork_available INTEGER NOT NULL DEFAULT 0 CHECK (artwork_available IN (0, 1)),
  artwork_source_type TEXT,
  artwork_revision TEXT,
  metadata_state TEXT NOT NULL CHECK (metadata_state IN ('parsed', 'failed')),
  metadata_error_code TEXT,
  UNIQUE(source_id, relative_path)
) STRICT;

CREATE TABLE track_artists (
  track_id TEXT NOT NULL REFERENCES tracks(track_id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(artist_id) ON DELETE RESTRICT,
  artist_order INTEGER NOT NULL,
  PRIMARY KEY (track_id, artist_id)
) STRICT;

CREATE TABLE scan_runs (
  scan_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES library_sources(source_id) ON DELETE RESTRICT,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  files_discovered INTEGER NOT NULL DEFAULT 0,
  files_processed INTEGER NOT NULL DEFAULT 0,
  files_unchanged INTEGER NOT NULL DEFAULT 0,
  files_new INTEGER NOT NULL DEFAULT 0,
  files_modified INTEGER NOT NULL DEFAULT 0,
  files_unavailable INTEGER NOT NULL DEFAULT 0,
  files_failed INTEGER NOT NULL DEFAULT 0,
  total_files INTEGER,
  error_code TEXT,
  UNIQUE(source_id, generation)
) STRICT;

CREATE INDEX tracks_source_generation_idx
  ON tracks(source_id, last_seen_generation);
CREATE INDEX tracks_album_idx ON tracks(album_id);
CREATE INDEX tracks_available_idx ON tracks(available);
CREATE INDEX track_artists_artist_idx ON track_artists(artist_id);
CREATE INDEX scan_runs_status_idx ON scan_runs(status, updated_at);
`;

const migrationV2 = `
ALTER TABLE artists ADD COLUMN search_name TEXT NOT NULL DEFAULT '';
ALTER TABLE albums ADD COLUMN search_title TEXT NOT NULL DEFAULT '';
ALTER TABLE albums ADD COLUMN search_artist TEXT NOT NULL DEFAULT '';
ALTER TABLE tracks ADD COLUMN search_title TEXT NOT NULL DEFAULT '';
ALTER TABLE tracks ADD COLUMN search_artist TEXT NOT NULL DEFAULT '';
ALTER TABLE tracks ADD COLUMN search_album TEXT NOT NULL DEFAULT '';
ALTER TABLE tracks ADD COLUMN search_album_artist TEXT NOT NULL DEFAULT '';

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
`;

const migrationV3 = `
CREATE TABLE favorite_tracks (
  track_id TEXT PRIMARY KEY REFERENCES tracks(track_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX favorite_tracks_created_idx
  ON favorite_tracks(created_at DESC, track_id ASC);
`;

const migrationV4 = `
CREATE TABLE favorite_albums (
  album_id TEXT PRIMARY KEY REFERENCES albums(album_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE favorite_artists (
  artist_id TEXT PRIMARY KEY REFERENCES artists(artist_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX favorite_albums_created_idx
  ON favorite_albums(created_at DESC, album_id ASC);
CREATE INDEX favorite_artists_created_idx
  ON favorite_artists(created_at DESC, artist_id ASC);
`;

function userVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as
    { user_version?: unknown } | undefined;
  const version = row?.user_version;
  return typeof version === "number" ? version : 0;
}

export function migrateLibraryDatabase(database: DatabaseSync): number {
  const current = userVersion(database);
  if (current > LIBRARY_SCHEMA_VERSION)
    throw new LibraryFutureVersionError(current, LIBRARY_SCHEMA_VERSION);
  if (current === LIBRARY_SCHEMA_VERSION) return current;

  database.exec("BEGIN IMMEDIATE");
  try {
    if (current < 1) database.exec(migrationV1);
    if (current < 2) database.exec(migrationV2);
    if (current < 3) database.exec(migrationV3);
    if (current < 4) database.exec(migrationV4);
    database.exec(`PRAGMA user_version = ${String(LIBRARY_SCHEMA_VERSION)}`);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return LIBRARY_SCHEMA_VERSION;
}
