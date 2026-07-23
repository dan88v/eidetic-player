/* eslint-disable @typescript-eslint/no-non-null-assertion */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/library/library-database.js";
import { LibraryError } from "../src/library/library-errors.js";
import { trackIdentity } from "../src/library/library-normalization.js";
import {
  LibraryRepository,
  normalizePlaylistName,
} from "../src/library/library-repository.js";
import type { IndexedTrackInput } from "../src/library/library-types.js";
import { emptyMetadata } from "../src/metadata/metadata-service.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-07-23T08:00:00.000Z";

void test("playlists normalize names, preserve duplicate item IDs, reorder and retain unavailable tracks", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-playlists-"));
  const database = await LibraryDatabase.open(join(temporary, "library.db"));
  try {
    const repository = new LibraryRepository(database);
    repository.syncConfiguredSources([
      {
        id: sourceId,
        type: "local",
        displayName: "Playlist fixture",
        nativeRoot: temporary,
        canonicalRoot: temporary,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    const scan = repository.beginScan(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceId,
      timestamp,
    );
    const records: IndexedTrackInput[] = ["One", "Two"].map((title, index) => {
      const relativePath = `${title}.mp3`;
      return {
        id: trackIdentity(sourceId, relativePath),
        sourceId,
        relativePath,
        filename: relativePath,
        extension: "mp3",
        size: 1_000 + index,
        mtimeMs: 2_000 + index,
        generation: scan.generation,
        seenAt: timestamp,
        metadata: { ...emptyMetadata, title, durationSeconds: 180 },
        metadataState: "parsed",
        metadataErrorCode: null,
        artworkAvailable: false,
      };
    });
    repository.applyScanBatch(records, []);
    const one = records[0]!;
    const two = records[1]!;
    assert.deepEqual(normalizePlaylistName("  Road   Trip  "), {
      name: "Road Trip",
      normalizedName: "road trip",
    });
    const playlist = repository.createPlaylist(" Road   Trip ", 1_000);
    assert.throws(
      () => repository.createPlaylist("road trip", 1_001),
      (error: unknown) =>
        error instanceof LibraryError && error.code === "PLAYLIST_NAME_EXISTS",
    );
    assert.deepEqual(
      repository.addPlaylistTracks(playlist.id, [one.id], false, 2_000),
      { addedCount: 1, duplicateTrackIds: [] },
    );
    assert.deepEqual(
      repository.addPlaylistTracks(playlist.id, [one.id], false, 2_100),
      { addedCount: 0, duplicateTrackIds: [one.id] },
    );
    repository.addPlaylistTracks(playlist.id, [one.id, two.id], true, 3_000);
    const detail = repository.playlist(playlist.id)!;
    assert.equal(detail.items.length, 3);
    assert.equal(new Set(detail.items.map((item) => item.itemId)).size, 3);
    assert.deepEqual(
      detail.items.map((item) => item.id),
      [one.id, one.id, two.id],
    );
    const reversed = [...detail.items].reverse().map((item) => item.itemId);
    assert.equal(
      repository.reorderPlaylist(playlist.id, reversed, 4_000),
      true,
    );
    assert.deepEqual(
      repository.playlist(playlist.id)!.items.map((item) => item.itemId),
      reversed,
    );
    database.connection
      .prepare("UPDATE tracks SET available = 0 WHERE track_id = ?")
      .run(one.id);
    const unavailable = repository.playlist(playlist.id)!;
    assert.equal(unavailable.items.length, 3);
    assert.equal(unavailable.availableTrackCount, 1);
    assert.equal(repository.playlistContextTracks(playlist.id).length, 1);
    assert.doesNotMatch(
      JSON.stringify(unavailable),
      /relativePath|sourceId|nativeRoot/i,
    );
    assert.equal(repository.deletePlaylist(playlist.id), 1);
    const itemCount = database.connection
      .prepare("SELECT COUNT(*) AS count FROM playlist_items")
      .get() as { count: number };
    assert.equal(itemCount.count, 0);
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
