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

async function waitForTracks(
  service: IndexedLibraryService,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (service.snapshot().summary.trackCount !== count) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for Library");
    await yieldImmediate();
  }
}

void test("Search Play resolves one typed snapshot with the selected occurrence", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-search-context-"));
  const root = join(temporary, "Search Source");
  await mkdir(root);
  await Promise.all(
    ["Fixture Alpha.flac", "Fixture Beta.flac", "Other.flac"].map((name) =>
      writeFile(join(root, name), "fixture"),
    ),
  );
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
    await waitForTracks(service, 3);
    const tracks = service.tracks(null, 10).items;
    const selected = tracks.find((track) => track.title === "Fixture Beta");
    assert.ok(selected);

    const context = await service.resolveSearch("  fixture  ", selected.id);
    assert.ok(context.playbackContext);
    assert.equal(context.playbackContext.kind, "search");
    assert.equal(context.playbackContext.title, "Search: fixture");
    assert.equal(context.playbackContext.source.label, "Library search");
    assert.equal(context.trackIds.length, 2);
    assert.equal(context.selectedIndex, context.trackIds.indexOf(selected.id));
    assert.equal(context.trackIds[context.selectedIndex], selected.id);
    assert.ok(
      context.paths.every((path) =>
        /Fixture (?:Alpha|Beta)\.flac$/u.test(path),
      ),
    );
  } finally {
    await service.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
