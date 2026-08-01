import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldImmediate } from "node:timers/promises";
import test from "node:test";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import { SourceRepository } from "../src/filesystem/source-repository.js";
import { SourceService } from "../src/filesystem/source-service.js";
import { LibraryDatabase } from "../src/library/library-database.js";
import {
  artistIdentity,
  trackIdentity,
} from "../src/library/library-normalization.js";
import { LibraryRepository } from "../src/library/library-repository.js";
import { IndexedLibraryService } from "../src/library/library-service.js";
import type { IndexedTrackInput } from "../src/library/library-types.js";
import { emptyMetadata } from "../src/metadata/metadata-service.js";
import type { PlayerService } from "../src/player/player-service.js";

async function waitFor(
  service: IndexedLibraryService,
  predicate: (status: ReturnType<IndexedLibraryService["snapshot"]>) => boolean,
): Promise<ReturnType<IndexedLibraryService["snapshot"]>> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const snapshot = service.snapshot();
    if (predicate(snapshot)) return snapshot;
    if (Date.now() > deadline) throw new Error("Timed out waiting for Library");
    await yieldImmediate();
  }
}

void test("first scan is automatic once, later scans are manual and removal preserves catalog", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-service-"));
  const root = join(temporary, "Empty Source");
  await mkdir(root);
  const provider = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(provider);
  const sourceRepository = new SourceRepository(
    join(temporary, "config", "sources.json"),
  );
  const sources = new SourceService(provider, paths, sourceRepository);
  const added = await sources.addLocal(root);
  const player = {
    waitForLibraryScanSlot: () => Promise.resolve(),
  } as unknown as PlayerService;
  const service = await IndexedLibraryService.create(
    provider,
    paths,
    sourceRepository,
    sources,
    player,
    join(temporary, "data", "library.db"),
  );
  try {
    await service.startAutomaticScans();
    const first = await waitFor(
      service,
      (snapshot) =>
        snapshot.status.activeScan === null &&
        snapshot.sources[0]?.firstScanCompleted === true,
    );
    assert.equal(first.summary.trackCount, 0);
    assert.equal(first.status.latestScan?.status, "completed");
    assert.equal(first.sources[0]?.currentGeneration, 1);

    await service.startAutomaticScans();
    await yieldImmediate();
    assert.equal(service.snapshot().sources[0]?.currentGeneration, 1);

    await service.requestScan({ sourceId: added.source.id });
    const second = await waitFor(
      service,
      (snapshot) =>
        snapshot.status.activeScan === null &&
        snapshot.sources[0]?.currentGeneration === 2,
    );
    assert.equal(second.status.latestScan?.status, "completed");

    const renamed = await sources.rename(added.source.id, "Renamed");
    service.sourceRenamed(added.source.id, renamed.displayName);
    assert.equal(service.snapshot().sources[0]?.displayName, "Renamed");

    const addedLaterRoot = join(temporary, "Added Later");
    await mkdir(addedLaterRoot);
    const addedLater = await sources.addLocal(addedLaterRoot);
    await service.sourceAdded(addedLater.source.id);
    const addedLaterScan = await waitFor(
      service,
      (snapshot) =>
        snapshot.status.activeScan === null &&
        snapshot.sources.some(
          (item) =>
            item.sourceId === addedLater.source.id && item.firstScanCompleted,
        ),
    );
    assert.equal(
      addedLaterScan.status.latestScan?.sourceId,
      addedLater.source.id,
    );

    await sources.remove(addedLater.source.id);
    service.sourceRemoved(addedLater.source.id);
    assert.equal(
      service
        .snapshot()
        .sources.find((item) => item.sourceId === addedLater.source.id)
        ?.availability,
      "removed",
    );
  } finally {
    await service.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("Recently Played resolves the full deduplicated context at the selected index", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-history-context-"));
  const root = join(temporary, "History Source");
  await mkdir(root);
  await writeFile(join(root, "Alpha.flac"), "fixture");
  await writeFile(join(root, "Beta.flac"), "fixture");
  const provider = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(provider);
  const sourceRepository = new SourceRepository(
    join(temporary, "config", "sources.json"),
  );
  const sources = new SourceService(provider, paths, sourceRepository);
  await sources.addLocal(root);
  const player = {
    waitForLibraryScanSlot: () => Promise.resolve(),
  } as unknown as PlayerService;
  const service = await IndexedLibraryService.create(
    provider,
    paths,
    sourceRepository,
    sources,
    player,
    join(temporary, "data", "library.db"),
  );
  try {
    await service.startAutomaticScans();
    await waitFor(
      service,
      (snapshot) =>
        snapshot.status.activeScan === null &&
        snapshot.summary.trackCount === 2,
    );
    const tracks = service.tracks(null, 10).items;
    const alpha = tracks.find((track) => track.title === "Alpha");
    const beta = tracks.find((track) => track.title === "Beta");
    assert.ok(alpha && beta);
    const older = service.recordPlayHistory(alpha.id, 30, false, 1_000);
    service.recordPlayHistory(beta.id, 30, false, 2_000);
    assert.ok(older);

    const context = await service.resolveRecentlyPlayed(older.historyId);
    assert.deepEqual(
      context.origins.map((origin) =>
        origin.kind === "folders" ? origin.libraryTrackId : null,
      ),
      [beta.id, alpha.id],
    );
    assert.equal(context.selectedIndex, 1);
    assert.match(context.paths[1] ?? "", /Alpha\.flac$/);

    service.recordQualifiedPlay(alpha.id, 30, false, 3_000);
    service.recordQualifiedPlay(beta.id, 30, true, 4_000);
    service.recordQualifiedPlay(beta.id, 15, false, 5_000);
    const mostPlayed = await service.resolveMostPlayed(alpha.id);
    assert.deepEqual(mostPlayed.trackIds, [beta.id, alpha.id]);
    assert.equal(mostPlayed.selectedIndex, 1);
    assert.match(mostPlayed.paths[1] ?? "", /Alpha\.flac$/);
    assert.equal(service.listeningStats().qualifiedPlays, 3);
    assert.equal(service.resetListeningStats().removedCount, 2);
    assert.equal(service.listeningStats().qualifiedPlays, 0);
    assert.equal(service.recentlyPlayed(null, 10).total, 2);
  } finally {
    await service.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("same-artist candidates resolve available indexed files without public path leakage", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-same-artist-"));
  const root = join(temporary, "Same Artist Source");
  await mkdir(root);
  const relativePaths = {
    both: "Both.flac",
    albumOwned: "Album Owned.flac",
    direct: "Direct.flac",
    unavailable: "Unavailable.flac",
    missing: "Missing.flac",
  } as const;
  await Promise.all(
    [
      relativePaths.both,
      relativePaths.albumOwned,
      relativePaths.direct,
      relativePaths.unavailable,
    ].map((relativePath) => writeFile(join(root, relativePath), "fixture")),
  );

  const provider = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(provider);
  const sourceRepository = new SourceRepository(
    join(temporary, "config", "sources.json"),
  );
  const sources = new SourceService(provider, paths, sourceRepository);
  const added = await sources.addLocal(root);
  const sourceId = added.source.id;
  const databasePath = join(temporary, "data", "library.db");
  const database = await LibraryDatabase.open(databasePath);
  const repository = new LibraryRepository(database);
  repository.syncConfiguredSources(await sourceRepository.list());
  const indexedAt = "2026-08-01T08:00:00.000Z";
  const run = repository.beginScan(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    sourceId,
    indexedAt,
  );
  const specs = [
    {
      relativePath: relativePaths.both,
      artist: "Main Artist",
      album: "Shared Album",
      albumArtist: "Main Artist",
    },
    {
      relativePath: relativePaths.albumOwned,
      artist: "Guest Artist",
      album: "Shared Album",
      albumArtist: "Main Artist",
    },
    {
      relativePath: relativePaths.direct,
      artist: "Main Artist",
      album: "Other Album",
      albumArtist: "Other Artist",
    },
    {
      relativePath: relativePaths.unavailable,
      artist: "Main Artist",
      album: null,
      albumArtist: null,
    },
    {
      relativePath: relativePaths.missing,
      artist: "Main Artist",
      album: null,
      albumArtist: null,
    },
  ] as const;
  const records: readonly IndexedTrackInput[] = specs.map((spec, index) => ({
    id: trackIdentity(sourceId, spec.relativePath),
    sourceId,
    relativePath: spec.relativePath,
    filename: spec.relativePath,
    extension: "flac",
    size: 1_000 + index,
    mtimeMs: 2_000 + index,
    generation: run.generation,
    seenAt: indexedAt,
    metadata: {
      ...emptyMetadata,
      title: spec.relativePath.replace(/\.flac$/u, ""),
      artist: spec.artist,
      artists: [spec.artist],
      album: spec.album,
      albumArtist: spec.albumArtist,
      trackNumber: index + 1,
      durationSeconds: 180,
    },
    metadataState: "parsed",
    metadataErrorCode: null,
    artworkAvailable: false,
  }));
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
    indexedAt,
  );
  const both = records[0];
  const albumOwned = records[1];
  const direct = records[2];
  const unavailable = records[3];
  assert.ok(both && albumOwned && direct && unavailable);
  const sharedAlbumId = repository.playbackContextForTrack(both.id)?.albumId;
  assert.ok(sharedAlbumId);
  database.connection
    .prepare("UPDATE tracks SET available = 0 WHERE track_id = ?")
    .run(unavailable.id);
  database.close();

  const player = {
    waitForLibraryScanSlot: () => Promise.resolve(),
  } as unknown as PlayerService;
  const service = await IndexedLibraryService.create(
    provider,
    paths,
    sourceRepository,
    sources,
    player,
    databasePath,
  );
  try {
    const mainArtistId = artistIdentity("Main Artist")?.id ?? "";
    const guestArtistId = artistIdentity("Guest Artist")?.id ?? "";
    assert.equal(service.albumArtistIdForAlbum(sharedAlbumId), mainArtistId);
    assert.equal(service.primaryArtistIdForTrack(albumOwned.id), guestArtistId);
    assert.equal(service.albumArtistIdForAlbum("invalid"), null);
    assert.equal(service.primaryArtistIdForTrack("invalid"), null);
    assert.deepEqual(await service.resolveSameArtistCandidates("invalid"), []);

    const candidates = await service.resolveSameArtistCandidates(mainArtistId);
    assert.deepEqual(
      candidates.map((candidate) => candidate.trackId),
      [both.id, albumOwned.id, direct.id].sort(),
    );
    assert.equal(
      new Set(candidates.map((candidate) => candidate.trackId)).size,
      candidates.length,
    );
    for (const candidate of candidates) {
      assert.equal(candidate.artistName, "Main Artist");
      assert.match(candidate.path, /\.flac$/u);
      assert.equal(candidate.origin.kind, "folders");
      assert.equal(candidate.origin.sourceId, sourceId);
      assert.equal(candidate.origin.libraryTrackId, candidate.trackId);
    }

    const publicPayload = JSON.stringify({
      snapshot: service.snapshot(),
      tracks: service.tracks(null, 20),
      album: service.album(sharedAlbumId),
      artist: service.artist(mainArtistId, null, 20),
    });
    assert.equal(
      publicPayload.includes(JSON.stringify(temporary).slice(1, -1)),
      false,
    );
    assert.doesNotMatch(
      publicPayload,
      /(?:nativeRoot|canonicalRoot|relativePath)/u,
    );

    service.setSourceAvailability(sourceId, false);
    assert.deepEqual(
      await service.resolveSameArtistCandidates(mainArtistId),
      [],
    );
    service.setSourceAvailability(sourceId, true);
    assert.equal(
      (await service.resolveSameArtistCandidates(mainArtistId)).length,
      3,
    );
  } finally {
    await service.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
