import type { DatabaseSync } from "node:sqlite";
import { LibraryFutureVersionError } from "./library-errors.js";

export const LIBRARY_SCHEMA_VERSION = 1;

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
    database.exec(`PRAGMA user_version = ${String(LIBRARY_SCHEMA_VERSION)}`);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return LIBRARY_SCHEMA_VERSION;
}
