import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldImmediate } from "node:timers/promises";
import test from "node:test";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import { SourceRepository } from "../src/filesystem/source-repository.js";
import { SourceService } from "../src/filesystem/source-service.js";
import { IndexedLibraryService } from "../src/library/library-service.js";
import type { PlayerService } from "../src/player/player-service.js";
import { FixtureRemovableStorageProvider } from "../src/removable-storage/fixture-removable-storage-provider.js";
import { RemovableStorageService } from "../src/removable-storage/removable-storage-service.js";

void test("removable Sources persist logical identity, enforce segment coverage, and relink", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-removable-source-"));
  const firstRoot = join(temporary, "D");
  const secondRoot = join(temporary, "E");
  for (const root of [firstRoot, secondRoot])
    for (const folder of [
      "Music",
      "music",
      "Music/Rock",
      "MusicBackup",
      "Audiobooks",
      "Música",
    ])
      await mkdir(join(root, ...folder.split("/")), { recursive: true });
  const fixture = new FixtureRemovableStorageProvider([
    {
      stableIdentity: "volume:stable-fixture",
      nativeRoot: firstRoot,
      displayName: "Kingston",
      readable: true,
      readOnly: false,
    },
  ]);
  const filesystem = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(filesystem);
  const removable = new RemovableStorageService(
    fixture,
    filesystem,
    paths,
    60_000,
  );
  const configPath = join(temporary, "sources.json");
  const repository = new SourceRepository(configPath);
  const sources = new SourceService(filesystem, paths, repository, removable);
  await removable.start();
  try {
    const deviceId = removable.snapshot().devices[0]?.id ?? "";
    const music = await sources.addRemovable(deviceId, "Music");
    assert.equal(music.source.displayName, "Music");
    assert.equal(music.source.type, "removable");
    assert.equal(music.scanQueued, true);
    assert.equal(
      (await sources.removableCoverage(deviceId, "Music")).state,
      "exact",
    );
    assert.equal(
      (await sources.removableCoverage(deviceId, "Music/Rock")).state,
      "covered-by-parent",
    );
    assert.equal(
      (await sources.removableCoverage(deviceId, "")).state,
      "overlaps-child",
    );
    assert.equal(
      (await sources.removableCoverage(deviceId, "MusicBackup")).state,
      "none",
    );
    assert.equal(
      (await sources.removableCoverage(deviceId, "music")).state,
      paths.platform === "win32" ? "exact" : "none",
    );
    await sources.addRemovable(deviceId, "MusicBackup");
    await sources.addRemovable(deviceId, "Música");
    const duplicateSubmit = await Promise.allSettled([
      sources.addRemovable(deviceId, "Audiobooks"),
      sources.addRemovable(deviceId, "Audiobooks"),
    ]);
    assert.equal(
      duplicateSubmit.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      duplicateSubmit.filter((result) => result.status === "rejected").length,
      1,
    );
    await assert.rejects(
      sources.addRemovable(deviceId, "Music/Rock"),
      /overlaps an existing Library source/,
    );

    const persisted = await readFile(configPath, "utf8");
    assert.match(persisted, /"version": 2/);
    assert.match(persisted, /"stableIdentity": "volume:stable-fixture"/);
    assert.match(persisted, /"logicalRelativeRoot": "Music"/);
    assert.doesNotMatch(persisted, /nativeRoot|canonicalRoot/);
    assert.equal(persisted.includes(firstRoot), false);

    fixture.setVolumes([
      {
        stableIdentity: "volume:stable-fixture",
        nativeRoot: secondRoot,
        displayName: "Kingston",
        readable: true,
        readOnly: false,
      },
    ]);
    await removable.refresh();
    const resolved = await sources.getInternal(music.source.id);
    assert.equal(resolved.canonicalRoot, join(secondRoot, "Music"));
    assert.equal(resolved.type, "removable");

    fixture.setVolumes([]);
    await removable.refresh();
    const changes = await sources.refreshRemovableAvailability();
    assert.ok(
      changes.some(
        (change) => change.sourceId === music.source.id && !change.available,
      ),
    );
    assert.equal(await sources.availabilityOf(music.source.id), "unavailable");
  } finally {
    await removable.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("removable root Source uses the volume label and v1 local records remain readable", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-removable-root-"));
  const root = join(temporary, "USB");
  const localRoot = join(temporary, "Local");
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(localRoot, { recursive: true }),
  ]);
  const configPath = join(temporary, "sources.json");
  const localId = "11111111-1111-4111-8111-111111111111";
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      sources: [
        {
          id: localId,
          type: "local",
          displayName: "Legacy Local",
          nativeRoot: localRoot,
          canonicalRoot: localRoot,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  const fixture = new FixtureRemovableStorageProvider([
    {
      stableIdentity: "volume:root-fixture",
      nativeRoot: root,
      displayName: "USB Storage",
      readable: true,
      readOnly: true,
    },
  ]);
  const filesystem = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(filesystem);
  const removable = new RemovableStorageService(
    fixture,
    filesystem,
    paths,
    60_000,
  );
  const repository = new SourceRepository(configPath);
  const sources = new SourceService(filesystem, paths, repository, removable);
  await removable.start();
  try {
    const deviceId = removable.snapshot().devices[0]?.id ?? "";
    const added = await sources.addRemovable(deviceId, "");
    assert.equal(added.source.displayName, "USB Storage");
    const records = await repository.list();
    assert.equal(
      records.find((record) => record.id === localId)?.type,
      "local",
    );
    assert.equal(
      records.some((record) => record.type === "removable"),
      true,
    );
    assert.match(await readFile(configPath, "utf8"), /"version": 2/);
  } finally {
    await removable.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("new removable Source scans alone and reconnect restores catalog availability without rescan", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-removable-scan-"));
  const root = join(temporary, "USB");
  const album = join(root, "Album");
  await mkdir(album, { recursive: true });
  await writeFile(join(album, "01 Song.mp3"), "fixture");
  const fixture = new FixtureRemovableStorageProvider([
    {
      stableIdentity: "volume:scan-fixture",
      nativeRoot: root,
      displayName: "Scan USB",
      readable: true,
      readOnly: false,
    },
  ]);
  const filesystem = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(filesystem);
  const removable = new RemovableStorageService(
    fixture,
    filesystem,
    paths,
    60_000,
  );
  const sourceRepository = new SourceRepository(
    join(temporary, "config", "sources.json"),
  );
  const sources = new SourceService(
    filesystem,
    paths,
    sourceRepository,
    removable,
  );
  await removable.start();
  const player = {
    waitForLibraryScanSlot: () => Promise.resolve(),
  } as unknown as PlayerService;
  const library = await IndexedLibraryService.create(
    filesystem,
    paths,
    sourceRepository,
    sources,
    player,
    join(temporary, "data", "library.db"),
  );
  try {
    const deviceId = removable.snapshot().devices[0]?.id ?? "";
    const added = await sources.addRemovable(deviceId, "Album");
    await library.sourceAdded(added.source.id);
    const deadline = Date.now() + 4_000;
    while (
      library.snapshot().status.activeScan !== null ||
      library.snapshot().sources[0]?.firstScanCompleted !== true
    ) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for scan");
      await yieldImmediate();
    }
    const scanned = library.snapshot();
    assert.equal(scanned.summary.sourceCount, 1);
    assert.equal(scanned.summary.trackCount, 1);
    assert.equal(scanned.status.latestScan?.sourceId, added.source.id);
    const generation = scanned.sources[0]?.currentGeneration;
    const track = library.tracks(null, 10).items[0];
    assert.ok(track);
    library.addFavoriteTrack(track.id);

    fixture.setVolumes([]);
    await removable.refresh();
    for (const change of await sources.refreshRemovableAvailability())
      library.setSourceAvailability(change.sourceId, change.available);
    assert.equal(
      library.tracks(null, 10).items[0]?.availability,
      "unavailable",
    );
    assert.equal(
      library.favoriteTracks(null, 10).items[0]?.availability,
      "unavailable",
    );

    fixture.setVolumes([
      {
        stableIdentity: "volume:scan-fixture",
        nativeRoot: root,
        displayName: "Scan USB",
        readable: true,
        readOnly: false,
      },
    ]);
    await removable.refresh();
    for (const change of await sources.refreshRemovableAvailability())
      library.setSourceAvailability(change.sourceId, change.available);
    assert.equal(library.tracks(null, 10).items[0]?.availability, "available");
    assert.equal(library.snapshot().sources[0]?.currentGeneration, generation);
    assert.equal(library.snapshot().status.queuedSourceIds.length, 0);
  } finally {
    await library.close();
    await removable.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
