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

void test("Favorite Albums and Artists are paged, idempotent, deduplicated and preserve unavailable", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-entity-favorites-"));
  const database = await LibraryDatabase.open(join(temporary, "library.db"));
  try {
    const repository = new LibraryRepository(database);
    repository.syncConfiguredSources([
      {
        id: sourceId,
        type: "local",
        displayName: "Entity Favorites fixture",
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
    const definitions = [
      {
        title: "First",
        album: "Alpha",
        artist: "Main Artist",
        artists: ["Main Artist"],
        albumArtist: "Main Artist",
        trackNumber: 1,
      },
      {
        title: "Collaboration",
        album: "Alpha",
        artist: "Main Artist feat. Guest Artist",
        artists: ["Main Artist", "Guest Artist"],
        albumArtist: "Main Artist",
        trackNumber: 2,
      },
      {
        title: "Second Album",
        album: "Beta",
        artist: "Guest Artist",
        artists: ["Guest Artist"],
        albumArtist: "Guest Artist",
        trackNumber: 1,
      },
    ] as const;
    const records: IndexedTrackInput[] = definitions.map((item, index) => {
      const relativePath = `${item.title}.flac`;
      return {
        id: trackIdentity(sourceId, relativePath),
        sourceId,
        relativePath,
        filename: relativePath,
        extension: "flac",
        size: 2_000 + index,
        mtimeMs: 3_000 + index,
        generation: run.generation,
        seenAt: now,
        metadata: {
          ...emptyMetadata,
          ...item,
          durationSeconds: 120,
          discNumber: 1,
        },
        metadataState: "parsed",
        metadataErrorCode: null,
        artworkAvailable: false,
      };
    });
    repository.applyScanBatch(records, []);
    const albums = repository.albums(null, 10).items;
    const artists = repository.artists(null, 10).items;
    const alpha = albums.find((item) => item.title === "Alpha");
    const beta = albums.find((item) => item.title === "Beta");
    const main = artists.find((item) => item.name === "Main Artist");
    const guest = artists.find((item) => item.name === "Guest Artist");
    assert.ok(alpha && beta && main && guest);

    repository.addFavoriteAlbum(alpha.id, 1_000);
    repository.addFavoriteAlbum(beta.id, 2_000);
    assert.equal(
      repository.addFavoriteAlbum(alpha.id, 9_999)?.favoritedAt,
      1_000,
    );
    const albumPage = repository.favoriteAlbums(null, 1);
    assert.deepEqual(
      albumPage.items.map((item) => item.id),
      [beta.id],
    );
    assert.ok(albumPage.nextCursor);
    assert.deepEqual(
      repository
        .favoriteAlbums(albumPage.nextCursor, 1)
        .items.map((item) => item.id),
      [alpha.id],
    );
    assert.equal(albumPage.total, 2);
    assert.equal(albumPage.availableCount, 2);
    assert.deepEqual(
      repository.favoriteAlbumIds([alpha.id, beta.id]),
      [alpha.id, beta.id].sort(),
    );
    assert.deepEqual(
      repository.favoriteAlbumContextTracks().map((item) => item.id),
      [records[2]?.id, records[0]?.id, records[1]?.id],
    );

    repository.addFavoriteArtist(main.id, 2_000);
    repository.addFavoriteArtist(guest.id, 1_000);
    assert.equal(
      repository.addFavoriteArtist(main.id, 9_999)?.favoritedAt,
      2_000,
    );
    const artistPage = repository.favoriteArtists(null, 10);
    assert.deepEqual(
      artistPage.items.map((item) => item.id),
      [main.id, guest.id],
    );
    assert.equal(artistPage.total, 2);
    assert.equal(artistPage.availableCount, 2);
    const artistContext = repository.favoriteArtistContextTracks();
    assert.equal(artistContext.length, 3);
    assert.equal(new Set(artistContext.map((item) => item.id)).size, 3);
    assert.equal(artistContext[0]?.id, records[0]?.id);
    assert.equal(artistContext[1]?.id, records[1]?.id);
    database.connection
      .prepare("UPDATE favorite_albums SET created_at = 5000")
      .run();
    assert.deepEqual(
      repository.favoriteAlbums(null, 10).items.map((item) => item.id),
      [alpha.id, beta.id].sort(),
    );
    database.connection
      .prepare("UPDATE favorite_artists SET created_at = 5000")
      .run();
    assert.deepEqual(
      repository.favoriteArtists(null, 10).items.map((item) => item.id),
      [main.id, guest.id].sort(),
    );

    database.connection
      .prepare("UPDATE library_sources SET available = 0 WHERE source_id = ?")
      .run(sourceId);
    assert.equal(repository.favoriteAlbums(null, 10).availableCount, 0);
    assert.equal(repository.favoriteArtists(null, 10).availableCount, 0);
    assert.equal(repository.favoriteAlbumIds([alpha.id]).length, 1);
    assert.equal(repository.favoriteArtistIds([main.id]).length, 1);
    assert.equal(repository.favoriteAlbumContextTracks().length, 0);
    assert.equal(repository.favoriteArtistContextTracks().length, 0);
    for (const [query, indexName] of [
      [
        "SELECT album_id, created_at FROM favorite_albums ORDER BY created_at DESC, album_id ASC LIMIT 48",
        "favorite_albums_created_idx",
      ],
      [
        "SELECT artist_id, created_at FROM favorite_artists ORDER BY created_at DESC, artist_id ASC LIMIT 48",
        "favorite_artists_created_idx",
      ],
    ] as const) {
      const plan = database.connection
        .prepare(`EXPLAIN QUERY PLAN ${query}`)
        .all()
        .map((row) => String((row as { detail: unknown }).detail))
        .join("\n");
      assert.match(plan, new RegExp(indexName));
    }

    assert.equal(repository.removeFavoriteAlbum(alpha.id).isFavorite, false);
    assert.equal(repository.removeFavoriteAlbum(alpha.id).isFavorite, false);
    assert.equal(repository.removeFavoriteArtist(main.id).isFavorite, false);
    assert.equal(repository.removeFavoriteArtist(main.id).isFavorite, false);
    assert.equal(
      repository.addFavoriteAlbum("album-00000000000000000000000000000000"),
      null,
    );
    assert.equal(
      repository.addFavoriteArtist("artist-00000000000000000000000000000000"),
      null,
    );
    repository.addFavoriteAlbum(beta.id, 4_000);
    database.connection
      .prepare("UPDATE tracks SET album_id = NULL WHERE album_id = ?")
      .run(beta.id);
    database.connection
      .prepare("DELETE FROM albums WHERE album_id = ?")
      .run(beta.id);
    assert.equal(repository.favoriteAlbumIds([beta.id]).length, 0);
    const cascadeArtistId = `artist-${"c".repeat(32)}`;
    database.connection
      .prepare(
        `INSERT INTO artists (
           artist_id, normalized_key, display_name, search_name, updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(cascadeArtistId, "cascade", "Cascade", "cascade", now);
    repository.addFavoriteArtist(cascadeArtistId, 4_000);
    database.connection
      .prepare("DELETE FROM artists WHERE artist_id = ?")
      .run(cascadeArtistId);
    assert.equal(repository.favoriteArtistIds([cascadeArtistId]).length, 0);
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
