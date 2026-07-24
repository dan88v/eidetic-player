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
import { SmbConnectionRepository } from "../src/smb/smb-connection-repository.js";
import { MemorySmbCredentialStore } from "../src/smb/smb-credential-store.js";
import { SmbConnectionService } from "../src/smb/smb-connection-service.js";
import { FixtureSmbAdapter } from "../src/smb/smb-platform-adapter.js";

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-smb-library-"));
  const share = join(temporary, "share");
  for (const folder of [
    "Music",
    "music",
    "Music/Rock",
    "MusicBackup",
    "Audiobooks",
    "Música",
  ])
    await mkdir(join(share, ...folder.split("/")), { recursive: true });
  await writeFile(join(share, "Music", "01 Song.mp3"), "fixture");
  const filesystem = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(filesystem);
  const connections = new SmbConnectionService(
    filesystem,
    paths,
    new SmbConnectionRepository(join(temporary, "connections.json")),
    new MemorySmbCredentialStore(),
    new FixtureSmbAdapter(share),
  );
  await connections.initialize();
  const first = await connections.add({
    displayName: "Studio NAS",
    server: "nas.local",
    share: "Music",
    authMode: "guest",
  });
  const second = await connections.add({
    displayName: "Backup NAS",
    server: "backup.local",
    share: "Music",
    authMode: "guest",
  });
  const sourceRepository = new SourceRepository(
    join(temporary, "sources.json"),
  );
  const sources = new SourceService(
    filesystem,
    paths,
    sourceRepository,
    undefined,
    connections,
  );
  connections.configureLibraryDependencies((connectionId) =>
    sources.hasSmbSources(connectionId),
  );
  return {
    temporary,
    share,
    filesystem,
    paths,
    connections,
    first,
    second,
    sourceRepository,
    sources,
  };
}

void test("SMB Sources persist opaque identity and enforce segment-safe coverage", async () => {
  const context = await fixture();
  try {
    const music = await context.sources.addSmb(context.first.id, "Music");
    assert.equal(music.source.type, "smb");
    assert.equal(music.source.displayName, "Music");
    assert.equal(music.scanQueued, true);
    assert.equal(
      (await context.sources.smbCoverage(context.first.id, "Music")).state,
      "exact",
    );
    assert.equal(
      (await context.sources.smbCoverage(context.first.id, "Music/Rock")).state,
      "covered-by-parent",
    );
    assert.equal(
      (await context.sources.smbCoverage(context.first.id, "")).state,
      "overlaps-child",
    );
    assert.equal(
      (await context.sources.smbCoverage(context.first.id, "MusicBackup"))
        .state,
      "none",
    );
    assert.equal(
      (await context.sources.smbCoverage(context.first.id, "music")).state,
      context.paths.platform === "win32" ? "exact" : "none",
    );
    await context.sources.addSmb(context.first.id, "MusicBackup");
    await context.sources.addSmb(context.first.id, "Música");
    await context.sources.addSmb(context.first.id, "Audiobooks");
    const otherConnection = await context.sources.addSmb(
      context.second.id,
      "Music",
    );
    assert.equal(otherConnection.source.displayName, "Music");
    await assert.rejects(
      context.sources.addSmb(context.first.id, "Music/Rock"),
      /overlaps an existing Library source/u,
    );

    const persisted = await readFile(
      context.sourceRepository.configPath,
      "utf8",
    );
    assert.match(persisted, /"version": 3/u);
    assert.match(
      persisted,
      new RegExp(`"connectionId": "${context.first.id}"`),
    );
    assert.match(persisted, /"logicalRelativeRoot": "Music"/u);
    assert.doesNotMatch(
      persisted,
      /server|share|username|domain|credential|password|nativeRoot|canonicalRoot/u,
    );
    assert.equal(persisted.includes(context.share), false);
    assert.equal(await context.sources.hasSmbSources(context.first.id), true);
    assert.ok(
      (
        await context.sources.smbSourceIdsForConnections([context.first.id])
      ).includes(music.source.id),
    );

    const resolved = await context.sources.getInternal(music.source.id);
    assert.equal(resolved.type, "smb");
    assert.equal(resolved.canonicalRoot, join(context.share, "Music"));
  } finally {
    await context.connections.close();
    await rm(context.temporary, { recursive: true, force: true });
  }
});

void test("SMB root naming, targeted first scan, offline catalog, and reconnect are stable", async () => {
  const context = await fixture();
  const player = {
    waitForLibraryScanSlot: () => Promise.resolve(),
  } as unknown as PlayerService;
  const library = await IndexedLibraryService.create(
    context.filesystem,
    context.paths,
    context.sourceRepository,
    context.sources,
    player,
    join(context.temporary, "library.db"),
  );
  try {
    const rootSource = await context.sources.addSmb(context.first.id, "");
    assert.equal(rootSource.source.displayName, "Studio NAS");
    await library.sourceAdded(rootSource.source.id);
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
    assert.equal(scanned.status.latestScan?.sourceId, rootSource.source.id);
    const generation = scanned.sources[0]?.currentGeneration;
    const trackId = library.tracks(null, 10).items[0]?.id;
    assert.ok(trackId);
    library.addFavoriteTrack(trackId);

    await context.connections.reportUnavailable(context.first.id);
    for (const change of await context.sources.refreshSmbAvailability([
      context.first.id,
    ]))
      library.setSourceAvailability(change.sourceId, change.available);
    assert.equal(
      library.tracks(null, 10).items[0]?.availability,
      "unavailable",
    );
    assert.equal(
      library.favoriteTracks(null, 10).items[0]?.availability,
      "unavailable",
    );

    await context.connections.retry(context.first.id);
    for (const change of await context.sources.refreshSmbAvailability([
      context.first.id,
    ]))
      library.setSourceAvailability(change.sourceId, change.available);
    assert.equal(library.tracks(null, 10).items[0]?.availability, "available");
    assert.equal(library.snapshot().sources[0]?.currentGeneration, generation);
    assert.equal(library.snapshot().status.queuedSourceIds.length, 0);

    await assert.rejects(
      context.connections.remove(context.first.id),
      /Remove the related Library sources first\./u,
    );
    assert.equal(context.connections.snapshot().configuredCount, 2);
    await context.sources.remove(rootSource.source.id);
    library.sourceRemoved(rootSource.source.id);
    assert.equal(context.connections.snapshot().configuredCount, 2);
    assert.equal(await context.sources.hasSmbSources(context.first.id), false);
    assert.equal(
      context.connections
        .snapshot()
        .connections.some(
          (connection) =>
            connection.id === context.first.id && connection.readable,
        ),
      true,
    );
    await context.connections.remove(context.first.id);
    assert.equal(context.connections.snapshot().configuredCount, 1);
  } finally {
    await library.close();
    await context.connections.close();
    await rm(context.temporary, { recursive: true, force: true });
  }
});
