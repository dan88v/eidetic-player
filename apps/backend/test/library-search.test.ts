import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/library/library-database.js";
import {
  librarySearchMatchRank,
  normalizeLibrarySearchKey,
  trackIdentity,
} from "../src/library/library-normalization.js";
import { LibraryRepository } from "../src/library/library-repository.js";
import type { IndexedTrackInput } from "../src/library/library-types.js";
import { emptyMetadata } from "../src/metadata/metadata-service.js";

const sourceId = "22222222-2222-4222-8222-222222222222";
const now = "2026-07-21T20:00:00.000Z";

const definitions = [
  ["Hero", "Exact Artist", "Exact Album"],
  ["Heroic Anthem", "Prefix Artist", "Prefix Album"],
  ["The Hero Returns", "Word Artist", "Word Album"],
  ["Superhero Theme", "Contains Artist", "Contains Album"],
  ["Jóga", "Björk", "Ágætis byrjun"],
  ["Golden Hour", "Kacey Musgraves", "Golden Hour"],
  [null, "Fallback Artist", "Fallback Album"],
] as const;

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-search-test-"));
  const database = await LibraryDatabase.open(join(temporary, "library.db"));
  const repository = new LibraryRepository(database);
  repository.syncConfiguredSources([
    {
      id: sourceId,
      type: "local",
      displayName: "Search Fixture",
      nativeRoot: temporary,
      canonicalRoot: temporary,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const run = repository.beginScan(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    sourceId,
    now,
  );
  const records: IndexedTrackInput[] = definitions.map(
    ([title, artist, album], index) => {
      const filename =
        title === null
          ? "Filename Hero Fallback.mp3"
          : `track-${String(index)}.mp3`;
      const relativePath = `${album}/${filename}`;
      return {
        id: trackIdentity(sourceId, relativePath),
        sourceId,
        relativePath,
        filename,
        extension: "mp3",
        size: 1_000 + index,
        mtimeMs: 2_000 + index,
        generation: run.generation,
        seenAt: now,
        metadata: {
          ...emptyMetadata,
          title,
          artist,
          artists: index === 4 ? [artist, "Guest Artist", artist] : [artist],
          album,
          albumArtist: artist,
          durationSeconds: 180 + index,
          trackNumber: index + 1,
        },
        metadataState: "parsed",
        metadataErrorCode: null,
        artworkAvailable: index % 2 === 0,
      };
    },
  );
  repository.applyScanBatch(records, []);
  repository.completeScan(
    run.scanId,
    sourceId,
    run.generation,
    {
      filesDiscovered: records.length,
      filesProcessed: records.length,
      filesUnchanged: 0,
      filesNew: records.length,
      filesModified: 0,
      filesUnavailable: 0,
      filesFailed: 0,
      totalFiles: records.length,
    },
    now,
  );
  return { temporary, database, repository, records };
}

void test("search normalization is accent, punctuation and whitespace insensitive", () => {
  assert.equal(
    normalizeLibrarySearchKey("  Ágætis   byrjun  "),
    "agætis byrjun",
  );
  assert.equal(normalizeLibrarySearchKey("Anti-Hero"), "anti hero");
  assert.equal(normalizeLibrarySearchKey("Björk"), "bjork");
  assert.equal(librarySearchMatchRank("hero", "hero"), 0);
  assert.equal(librarySearchMatchRank("heroic anthem", "hero"), 1);
  assert.equal(librarySearchMatchRank("the hero returns", "hero"), 2);
  assert.equal(librarySearchMatchRank("superhero theme", "hero"), 3);
});

void test("global search ranks exact, prefix, word-prefix and contains deterministically", async () => {
  const { temporary, database, repository } = await fixture();
  try {
    const tracks = repository.searchTracks("hero", null, 20);
    assert.deepEqual(
      tracks.items.slice(0, 5).map((track) => track.title),
      [
        "Hero",
        "Heroic Anthem",
        "Filename Hero Fallback",
        "The Hero Returns",
        "Superhero Theme",
      ],
    );
    assert.equal(tracks.total, 5);
    assert.equal(
      repository.searchArtists("bjork", null, 5).items[0]?.name,
      "Björk",
    );
    assert.equal(
      repository.searchAlbums("agætis", null, 5).items[0]?.title,
      "Ágætis byrjun",
    );
    assert.equal(
      repository.searchTracks("golden hour", null, 5).items[0]?.title,
      "Golden Hour",
    );
    assert.equal(
      repository.searchTracks("fallback", null, 5).items[0]?.title,
      "Filename Hero Fallback",
    );
    assert.equal(JSON.stringify(tracks).includes(temporary), false);
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("search pages are bounded, keyset-paginated and reject stale cursors", async () => {
  const { temporary, database, repository } = await fixture();
  try {
    const first = repository.searchTracks("hero", null, 2);
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor);
    const second = repository.searchTracks("hero", first.nextCursor, 2);
    assert.equal(second.items.length, 2);
    assert.equal(
      new Set([...first.items, ...second.items].map((track) => track.id)).size,
      4,
    );
    assert.throws(
      () => repository.searchTracks("golden", first.nextCursor, 2),
      /cursor/i,
    );
    assert.throws(
      () => repository.searchTracks("hero", "invalid", 2),
      /cursor/i,
    );
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("unavailable Search matches stay visible but cannot resolve for playback", async () => {
  const { temporary, database, repository, records } = await fixture();
  try {
    const unavailable = records[0];
    assert.ok(unavailable);
    database.connection
      .prepare("UPDATE tracks SET available = 0 WHERE track_id = ?")
      .run(unavailable.id);
    const visible = repository
      .searchTracks("hero", null, 20)
      .items.find((track) => track.id === unavailable.id);
    assert.equal(visible?.availability, "unavailable");
    assert.equal(repository.playbackContextForTrack(unavailable.id), null);
    repository.markSourceRemoved(sourceId);
    assert.equal(
      repository.playbackContextForTrack(records[1]?.id ?? ""),
      null,
    );
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("schema v2 materializes search keys without FTS and query plans stay inspectable", async () => {
  const { temporary, database } = await fixture();
  try {
    const keys = database.connection
      .prepare(
        "SELECT search_title, search_artist, search_album, search_album_artist FROM tracks ORDER BY track_id LIMIT 1",
      )
      .get() as Record<string, string>;
    assert.ok(keys.search_title);
    const virtualTables = database.connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%VIRTUAL TABLE%'",
      )
      .all();
    assert.deepEqual(virtualTables, []);
    const plan = database.connection
      .prepare(
        "EXPLAIN QUERY PLAN SELECT track_id FROM tracks WHERE instr(search_title, ?) > 0 ORDER BY search_title, track_id LIMIT ?",
      )
      .all("hero", 8);
    assert.ok(
      plan.some((row) =>
        String((row as { detail: unknown }).detail).includes("tracks"),
      ),
    );
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
