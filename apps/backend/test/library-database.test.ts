import assert from "node:assert/strict";
import { readdir, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  BUSY_TIMEOUT_MILLISECONDS,
  LIBRARY_SCHEMA_VERSION,
  LibraryDatabase,
  libraryDatabasePath,
} from "../src/library/library-database.js";
import { LibraryFutureVersionError } from "../src/library/library-errors.js";
import { LibraryRepository } from "../src/library/library-repository.js";

void test("new Library database uses the current schema, WAL and safe pragmas", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-db-"));
  const path = join(temporary, "Data Unicode", "library.db");
  try {
    const database = await LibraryDatabase.open(path);
    try {
      assert.equal(database.diagnostics.schemaVersion, LIBRARY_SCHEMA_VERSION);
      assert.equal(database.diagnostics.journalMode, "wal");
      assert.equal(database.diagnostics.synchronous, 1);
      assert.equal(database.diagnostics.foreignKeys, true);
      assert.equal(
        database.diagnostics.busyTimeoutMilliseconds,
        BUSY_TIMEOUT_MILLISECONDS,
      );
      assert.equal(database.integrityCheck(), true);
      const tables = database.connection
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all()
        .map((row) => String((row as { name: unknown }).name));
      assert.deepEqual(tables, [
        "albums",
        "artists",
        "favorite_albums",
        "favorite_artists",
        "favorite_tracks",
        "library_sources",
        "scan_runs",
        "track_artists",
        "tracks",
      ]);
      assert.throws(() => {
        database.connection
          .prepare(
            `INSERT INTO tracks (
               track_id, source_id, relative_path, filename, extension, size,
               mtime_ms, first_seen_at, last_seen_at, last_seen_generation,
               metadata_state
             ) VALUES ('track-x', 'missing', 'x.mp3', 'x.mp3', 'mp3', 1, 1,
                       'now', 'now', 1, 'parsed')`,
          )
          .run();
      });
      assert.throws(() => {
        database.transaction(() => {
          database.connection
            .prepare(
              `INSERT INTO library_sources (
                 source_id, display_name, created_at, updated_at
               ) VALUES ('rollback', 'Rollback', 'now', 'now')`,
            )
            .run();
          throw new Error("rollback");
        });
      });
      assert.equal(
        (
          database.connection
            .prepare(
              "SELECT COUNT(*) AS count FROM library_sources WHERE source_id = 'rollback'",
            )
            .get() as { count: number }
        ).count,
        0,
      );
    } finally {
      database.close();
      database.close();
    }
    const reopened = await LibraryDatabase.open(path);
    assert.equal(reopened.diagnostics.schemaVersion, LIBRARY_SCHEMA_VERSION);
    reopened.close();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("schema v1 migrates through v4 and backfills accent-insensitive Search keys", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-v1-"));
  const path = join(temporary, "library.db");
  try {
    const current = await LibraryDatabase.open(path);
    current.connection
      .prepare(
        `INSERT INTO artists (
           artist_id, normalized_key, display_name, updated_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run("artist-v1", "bjork", "Björk", "2026-07-21T00:00:00.000Z");
    current.close();

    const legacy = new DatabaseSync(path);
    for (const statement of [
      "DROP TABLE favorite_albums",
      "DROP TABLE favorite_artists",
      "DROP TABLE favorite_tracks",
      "ALTER TABLE artists DROP COLUMN search_name",
      "ALTER TABLE albums DROP COLUMN search_title",
      "ALTER TABLE albums DROP COLUMN search_artist",
      "ALTER TABLE tracks DROP COLUMN search_title",
      "ALTER TABLE tracks DROP COLUMN search_artist",
      "ALTER TABLE tracks DROP COLUMN search_album",
      "ALTER TABLE tracks DROP COLUMN search_album_artist",
    ])
      legacy.exec(statement);
    legacy.exec("PRAGMA user_version = 1");
    legacy.close();

    const migrated = await LibraryDatabase.open(path);
    try {
      assert.equal(migrated.diagnostics.schemaVersion, 4);
      assert.equal(
        (
          migrated.connection
            .prepare(
              "SELECT search_name FROM artists WHERE artist_id = 'artist-v1'",
            )
            .get() as { search_name: string }
        ).search_name,
        "bjork",
      );
    } finally {
      migrated.close();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("schema v2 migrates transactionally through Favorites v4", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-v2-"));
  const path = join(temporary, "library.db");
  try {
    const current = await LibraryDatabase.open(path);
    current.close();
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "DROP TABLE favorite_albums; DROP TABLE favorite_artists; DROP TABLE favorite_tracks; PRAGMA user_version = 2",
    );
    legacy.close();
    const migrated = await LibraryDatabase.open(path);
    try {
      assert.equal(migrated.diagnostics.schemaVersion, 4);
      const foreignKey = migrated.connection
        .prepare("PRAGMA foreign_key_list(favorite_tracks)")
        .get() as { table: string; on_delete: string };
      assert.equal(foreignKey.table, "tracks");
      assert.equal(foreignKey.on_delete, "CASCADE");
      assert.equal(migrated.integrityCheck(), true);
    } finally {
      migrated.close();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("schema v3 migrates transactionally to Favorite Albums and Artists v4", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-v3-"));
  const path = join(temporary, "library.db");
  try {
    const current = await LibraryDatabase.open(path);
    current.close();
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "DROP TABLE favorite_albums; DROP TABLE favorite_artists; PRAGMA user_version = 3",
    );
    legacy.close();
    const migrated = await LibraryDatabase.open(path);
    try {
      assert.equal(migrated.diagnostics.schemaVersion, 4);
      for (const [table, parent] of [
        ["favorite_albums", "albums"],
        ["favorite_artists", "artists"],
      ] as const) {
        const foreignKey = migrated.connection
          .prepare(`PRAGMA foreign_key_list(${table})`)
          .get() as { table: string; on_delete: string };
        assert.equal(foreignKey.table, parent);
        assert.equal(foreignKey.on_delete, "CASCADE");
      }
      assert.equal(migrated.integrityCheck(), true);
    } finally {
      migrated.close();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("corrupt Library is preserved and rebuilt without touching JSON state", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-corrupt-"));
  const data = join(temporary, "data");
  const path = join(data, "library.db");
  const sources = join(temporary, "config", "sources.json");
  const session = join(temporary, "config", "player-session.json");
  try {
    await writeFile(path, "not a sqlite database", { flag: "wx" }).catch(
      async () => {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(data, { recursive: true });
        await writeFile(path, "not a sqlite database");
      },
    );
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(temporary, "config"), { recursive: true });
    await writeFile(sources, '{"sources":[]}');
    await writeFile(session, '{"queue":[]}');
    const database = await LibraryDatabase.open(path);
    try {
      assert.ok(database.diagnostics.recoveredCorruptPath);
      assert.equal(database.integrityCheck(), true);
      assert.equal(
        (await readdir(data)).some((name) =>
          /^library\.corrupt-.+\.db$/.test(name),
        ),
        true,
      );
      assert.equal(
        await import("node:fs/promises").then(({ readFile }) =>
          readFile(sources, "utf8"),
        ),
        '{"sources":[]}',
      );
      assert.equal(
        await import("node:fs/promises").then(({ readFile }) =>
          readFile(session, "utf8"),
        ),
        '{"queue":[]}',
      );
    } finally {
      database.close();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("future Library schema is rejected without destructive recovery", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-future-"));
  const path = join(temporary, "library.db");
  try {
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA user_version = 99");
    raw.close();
    await assert.rejects(LibraryDatabase.open(path), LibraryFutureVersionError);
    const verify = new DatabaseSync(path);
    assert.equal(
      (
        verify.prepare("PRAGMA user_version").get() as {
          user_version: number;
        }
      ).user_version,
      99,
    );
    verify.close();
    assert.equal(
      (await readdir(temporary)).some((name) => name.includes(".corrupt-")),
      false,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("Library path uses the data directory on Windows and Linux", () => {
  assert.equal(
    libraryDatabasePath(
      "win32",
      {
        APPDATA: "C:\\Users\\Test\\Roaming",
        LOCALAPPDATA: "D:\\Local",
        TEMP: "E:\\Temp",
      },
      "C:\\Users\\Test",
    ),
    "D:\\Local\\Eidetic Player\\Data\\library.db",
  );
  assert.equal(
    libraryDatabasePath(
      "linux",
      {
        HOME: "/home/test",
        XDG_DATA_HOME: "/srv/data",
      },
      "/home/test",
    ),
    "/srv/data/eidetic-player/library.db",
  );
});

void test("interrupted scan state is recovered persistently", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-recover-"));
  const path = join(temporary, "library.db");
  try {
    const database = await LibraryDatabase.open(path);
    const repository = new LibraryRepository(database);
    repository.syncConfiguredSources([
      {
        id: "11111111-1111-4111-8111-111111111111",
        type: "local",
        displayName: "Source",
        nativeRoot: temporary,
        canonicalRoot: temporary,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    repository.beginScan(
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    );
    assert.equal(repository.recoverInterruptedScans(), 1);
    assert.equal(repository.listSources()[0]?.scanStatus, "interrupted");
    database.close();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
