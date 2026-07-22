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
import { IndexedLibraryService } from "../src/library/library-service.js";
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
  } finally {
    await service.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
