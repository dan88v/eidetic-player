import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/library/library-database.js";
import { trackIdentity } from "../src/library/library-normalization.js";
import { LibraryRepository } from "../src/library/library-repository.js";
import type { IndexedTrackInput } from "../src/library/library-types.js";
import { emptyMetadata } from "../src/metadata/metadata-service.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const now = "2026-07-22T08:00:00.000Z";

void test("Favorite Tracks are idempotent, newest-first, paged and preserve unavailable", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-favorites-"));
  const database = await LibraryDatabase.open(join(temporary, "library.db"));
  try {
    const repository = new LibraryRepository(database);
    repository.syncConfiguredSources([
      {
        id: sourceId,
        type: "local",
        displayName: "Favorites fixture",
        nativeRoot: temporary,
        canonicalRoot: temporary,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const run = repository.beginScan(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceId,
      now,
    );
    const records: IndexedTrackInput[] = ["One", "Two", "Three"].map(
      (title, index) => {
        const relativePath = `${title}.mp3`;
        return {
          id: trackIdentity(sourceId, relativePath),
          sourceId,
          relativePath,
          filename: relativePath,
          extension: "mp3",
          size: 1_000 + index,
          mtimeMs: 2_000 + index,
          generation: run.generation,
          seenAt: now,
          metadata: { ...emptyMetadata, title, durationSeconds: 180 },
          metadataState: "parsed",
          metadataErrorCode: null,
          artworkAvailable: false,
        };
      },
    );
    repository.applyScanBatch(records, []);
    const [one, two, three] = records;
    assert.ok(one && two && three);
    for (const [index, record] of records.entries())
      repository.addFavoriteTrack(record.id, index < 2 ? 1_000 : 2_000);
    const firstTimestamp = repository.addFavoriteTrack(one.id, 9_999);
    assert.equal(firstTimestamp?.favoritedAt, 1_000);
    assert.deepEqual(
      repository.favoriteTrackIds([three.id, one.id]),
      [one.id, three.id].sort(),
    );

    const first = repository.favoriteTracks(null, 2);
    assert.equal(first.total, 3);
    assert.equal(first.availableCount, 3);
    assert.deepEqual(
      first.items.map((item) => item.id),
      [three.id, ...[one.id, two.id].sort()].slice(0, 2),
    );
    assert.ok(first.nextCursor);
    assert.doesNotMatch(JSON.stringify(first), /relativePath|sourceId|native/i);
    const plan = database.connection
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT track_id, created_at FROM favorite_tracks
         ORDER BY created_at DESC, track_id ASC LIMIT 48`,
      )
      .all()
      .map((row) => String((row as { detail: unknown }).detail))
      .join("\n");
    assert.match(plan, /favorite_tracks_created_idx/);
    const second = repository.favoriteTracks(first.nextCursor, 2);
    assert.equal(second.items.length, 1);

    database.connection
      .prepare("UPDATE tracks SET available = 0 WHERE track_id = ?")
      .run(three.id);
    const unavailable = repository.favoriteTracks(null, 10);
    assert.equal(unavailable.total, 3);
    assert.equal(unavailable.availableCount, 2);
    assert.equal(
      unavailable.items.find((item) => item.id === three.id)?.availability,
      "unavailable",
    );
    assert.equal(repository.favoriteContextTracks().length, 2);

    assert.deepEqual(repository.removeFavoriteTrack(two.id), {
      trackId: two.id,
      isFavorite: false,
      favoritedAt: null,
    });
    assert.equal(repository.removeFavoriteTrack(two.id).isFavorite, false);
    assert.equal(
      repository.addFavoriteTrack("track-00000000000000000000000000000000"),
      null,
    );
    database.connection
      .prepare("DELETE FROM tracks WHERE track_id = ?")
      .run(one.id);
    assert.equal(repository.favoriteTrackIds([one.id]).length, 0);
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
