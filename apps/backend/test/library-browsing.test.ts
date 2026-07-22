import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/library/library-database.js";
import {
  artistIdentity,
  trackIdentity,
} from "../src/library/library-normalization.js";
import { LibraryRepository } from "../src/library/library-repository.js";
import type { IndexedTrackInput } from "../src/library/library-types.js";
import { emptyMetadata } from "../src/metadata/metadata-service.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const now = "2026-07-20T08:00:00.000Z";

function counters(count: number) {
  return {
    filesDiscovered: count,
    filesProcessed: count,
    filesUnchanged: 0,
    filesNew: count,
    filesModified: 0,
    filesUnavailable: 0,
    filesFailed: 0,
    totalFiles: count,
  };
}

async function fixture(): Promise<{
  readonly temporary: string;
  readonly database: LibraryDatabase;
  readonly repository: LibraryRepository;
  readonly records: readonly IndexedTrackInput[];
}> {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-browse-"));
  const database = await LibraryDatabase.open(join(temporary, "library.db"));
  const repository = new LibraryRepository(database);
  repository.syncConfiguredSources([
    {
      id: sourceId,
      type: "local",
      displayName: "Fixture",
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
  const records: IndexedTrackInput[] = Array.from(
    { length: 72 },
    (_, index) => {
      const albumIndex = Math.floor(index / 12);
      const relativePath = `Album ${String(albumIndex)}/${String(index + 1).padStart(3, "0")}.mp3`;
      const compilation = albumIndex === 4;
      const noAlbum = albumIndex === 5;
      return {
        id: trackIdentity(sourceId, relativePath),
        sourceId,
        relativePath,
        filename: `${String(index + 1).padStart(3, "0")}.mp3`,
        extension: "mp3",
        size: 1_000 + index,
        mtimeMs: 2_000 + index,
        generation: run.generation,
        seenAt: now,
        metadata: {
          ...emptyMetadata,
          title: `Title ${String(71 - index).padStart(3, "0")}`,
          artist: compilation ? `Guest ${String(index % 3)}` : "Main Artist",
          artists:
            index === 0
              ? ["Main Artist", "Featured Artist", "Main Artist"]
              : compilation
                ? [`Guest ${String(index % 3)}`]
                : ["Main Artist"],
          album: noAlbum ? null : `Album ${String(albumIndex)}`,
          albumArtist: compilation ? "Various Artists" : "Main Artist",
          compilation,
          discNumber: index < 6 ? 2 : 1,
          trackNumber: (index % 12) + 1,
          durationSeconds: 180 + index,
          year: 2020 + albumIndex,
        },
        metadataState: "parsed",
        metadataErrorCode: null,
        artworkAvailable: index % 12 === 0,
      };
    },
  );
  for (let index = 0; index < records.length; index += 16)
    repository.applyScanBatch(records.slice(index, index + 16), []);
  repository.completeScan(
    run.scanId,
    sourceId,
    run.generation,
    counters(records.length),
    now,
  );
  return { temporary, database, repository, records };
}

void test("Library browsing is bounded, keyset-paginated and deterministic", async () => {
  const { temporary, database, repository } = await fixture();
  try {
    const albumsFirst = repository.albums(null, 2);
    assert.equal(albumsFirst.items.length, 2);
    assert.ok(albumsFirst.nextCursor);
    const albumsSecond = repository.albums(albumsFirst.nextCursor, 2);
    assert.equal(albumsSecond.items.length, 2);
    assert.equal(
      new Set(
        [...albumsFirst.items, ...albumsSecond.items].map((item) => item.id),
      ).size,
      4,
    );
    assert.deepEqual(
      albumsFirst.items.map((item) => item.title),
      ["Album 0", "Album 1"],
    );
    assert.equal(albumsFirst.items[0]?.trackCount, 12);
    assert.equal(albumsFirst.items[0].availableTrackCount, 12);
    assert.equal(albumsFirst.items[0].totalDurationSeconds, 2_226);
    assert.ok(albumsFirst.items[0].artworkTrackId?.startsWith("track-"));

    const artistsFirst = repository.artists(null, 3);
    assert.equal(artistsFirst.items.length, 3);
    assert.ok(artistsFirst.nextCursor);
    const names = artistsFirst.items.map((item) => item.name);
    assert.deepEqual(
      [...names].sort((a, b) => a.localeCompare(b)),
      names,
    );

    const tracksFirst = repository.tracks(null, 17);
    assert.equal(tracksFirst.items.length, 17);
    assert.ok(tracksFirst.nextCursor);
    const tracksSecond = repository.tracks(tracksFirst.nextCursor, 17);
    assert.equal(tracksSecond.items.length, 17);
    assert.equal(
      new Set(
        [...tracksFirst.items, ...tracksSecond.items].map((item) => item.id),
      ).size,
      34,
    );
    assert.equal(
      JSON.stringify({ albumsFirst, artistsFirst, tracksFirst }).includes(
        temporary,
      ),
      false,
    );
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("Album and Artist detail preserve disc order, deduplication and no-album tail", async () => {
  const { temporary, database, repository, records } = await fixture();
  try {
    const album = repository.album(
      repository.albums(null, 1).items[0]?.id ?? "",
    );
    assert.ok(album);
    assert.equal(album.tracks.length, 12);
    assert.equal(album.tracks[0]?.discNumber, 1);
    assert.equal(album.tracks.at(-1)?.discNumber, 2);

    const mainArtistId = artistIdentity("Main Artist")?.id ?? "";
    const artist = repository.artist(mainArtistId, null, 100);
    assert.ok(artist);
    assert.equal(
      new Set(artist.tracks.items.map((item) => item.id)).size,
      artist.tracks.items.length,
    );
    assert.equal(artist.tracks.items.at(-1)?.album, null);
    assert.equal(
      repository.contextTracks("artist", mainArtistId).at(-1)?.id,
      records[60]?.id,
    );

    const variousId = artistIdentity("Various Artists")?.id ?? "";
    const compilation = repository.artist(variousId, null, 100);
    assert.ok(compilation);
    assert.equal(compilation.trackCount, 12);
    assert.equal(compilation.albums.length, 1);
    assert.equal(repository.contextTracks("artist", variousId).length, 12);

    const albumTrack = records[8];
    assert.ok(albumTrack);
    const albumContext = repository.playbackContextForTrack(albumTrack.id);
    assert.ok(albumContext?.albumId);
    const albumTracks = repository.contextTracks("album", albumContext.albumId);
    assert.equal(albumTracks.length, 12);
    assert.equal(new Set(albumTracks.map((track) => track.id)).size, 12);
    assert.ok(albumTracks.findIndex((track) => track.id === albumTrack.id) > 0);

    const compilationTrack = records[50];
    assert.ok(compilationTrack);
    const compilationContext = repository.playbackContextForTrack(
      compilationTrack.id,
    );
    assert.ok(compilationContext?.albumId);
    assert.equal(
      repository.contextTracks("album", compilationContext.albumId).length,
      12,
    );

    const albumlessTrack = records[60];
    assert.ok(albumlessTrack);
    assert.deepEqual(repository.playbackContextForTrack(albumlessTrack.id), {
      albumId: null,
    });
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("effective unavailable state stays visible and is excluded from Queue contexts", async () => {
  const { temporary, database, repository, records } = await fixture();
  try {
    const unavailable = records[10];
    assert.ok(unavailable);
    database.connection
      .prepare("UPDATE tracks SET available = 0 WHERE track_id = ?")
      .run(unavailable.id);
    const albumId = database.connection
      .prepare("SELECT album_id FROM tracks WHERE track_id = ?")
      .get(unavailable.id) as { album_id: string };
    const detail = repository.album(albumId.album_id);
    const visible = detail?.tracks.find((track) => track.id === unavailable.id);
    assert.equal(visible?.availability, "unavailable");
    assert.equal(
      repository
        .contextTracks("album", albumId.album_id)
        .some((track) => track.id === unavailable.id),
      false,
    );
    assert.equal(repository.contextTrack(unavailable.id), null);
    repository.markSourceRemoved(sourceId);
    const removedDetail = repository.album(albumId.album_id);
    assert.equal(removedDetail?.availableTrackCount, 0);
    assert.equal(removedDetail.availability, "unavailable");
    assert.equal(repository.contextTracks("tracks").length, 0);
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
