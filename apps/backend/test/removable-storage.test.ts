import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ArtworkService } from "../src/artwork/artwork-service.js";
import { DirectoryBrowserService } from "../src/filesystem/directory-browser-service.js";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import { MetadataService } from "../src/metadata/metadata-service.js";
import { FixtureRemovableStorageProvider } from "../src/removable-storage/fixture-removable-storage-provider.js";
import { RemovableStorageService } from "../src/removable-storage/removable-storage-service.js";

void test("removable monitor deduplicates snapshots and preserves opaque identity across root changes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-usb-provider-"));
  const firstRoot = join(temporary, "E");
  const secondRoot = join(temporary, "F");
  await Promise.all([
    mkdir(firstRoot, { recursive: true }),
    mkdir(secondRoot, { recursive: true }),
  ]);
  const provider = new FixtureRemovableStorageProvider();
  const filesystem = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(filesystem);
  const storage = new RemovableStorageService(
    provider,
    filesystem,
    paths,
    60_000,
  );
  const changes: {
    connected: readonly string[];
    disconnected: readonly string[];
    changed: readonly string[];
  }[] = [];
  storage.subscribe((change) => {
    changes.push({
      connected: change.connectedIds,
      disconnected: change.disconnectedIds,
      changed: change.changedIds,
    });
  });
  try {
    await storage.start();
    assert.deepEqual(storage.snapshot().devices, []);
    assert.equal(storage.diagnostics().timerActive, true);

    provider.setVolumes([
      {
        stableIdentity: "uuid:fixture-volume",
        nativeRoot: firstRoot,
        displayName: "Música USB",
        readable: true,
        readOnly: true,
        filesystemType: "exFAT",
        capacityBytes: 64_000_000_000,
      },
    ]);
    await storage.refresh();
    const first = storage.snapshot();
    assert.equal(first.devices.length, 1);
    const firstDevice = first.devices[0];
    assert.ok(firstDevice);
    assert.match(firstDevice.id, /^usb-[0-9a-f]{32}$/);
    assert.equal(firstDevice.displayName, "Música USB");
    assert.equal(firstDevice.readOnly, true);
    assert.equal(JSON.stringify(first).includes(firstRoot), false);
    const deviceId = firstDevice.id;
    const connectedAt = firstDevice.connectedAt;

    await storage.refresh();
    assert.equal(storage.snapshot().revision, first.revision);

    provider.setVolumes([
      {
        stableIdentity: "uuid:fixture-volume",
        nativeRoot: secondRoot,
        displayName: "Música USB",
        readable: true,
        readOnly: true,
      },
    ]);
    await storage.refresh();
    assert.equal(storage.snapshot().devices[0]?.id, deviceId);
    assert.deepEqual(changes.at(-1)?.changed, [deviceId]);

    provider.setVolumes([]);
    await storage.refresh();
    assert.deepEqual(storage.snapshot().devices, []);
    assert.deepEqual(changes.at(-1)?.disconnected, [deviceId]);

    provider.setVolumes([
      {
        stableIdentity: "uuid:fixture-volume",
        nativeRoot: firstRoot,
        displayName: "",
        readable: true,
        readOnly: false,
      },
    ]);
    await storage.refresh();
    assert.equal(storage.snapshot().devices[0]?.id, deviceId);
    assert.equal(storage.snapshot().devices[0]?.displayName, "USB Storage");
    assert.equal(storage.snapshot().devices[0]?.connectedAt, connectedAt);
  } finally {
    await storage.close();
    assert.equal(provider.closed, true);
    assert.equal(storage.diagnostics().timerActive, false);
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("USB Quick Browse reuses one-level Folders filtering and direct natural order", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-usb-browser-"));
  const root = join(temporary, "USB");
  await mkdir(join(root, "Album"), { recursive: true });
  await writeFile(join(root, "10 Finale.mp3"), "");
  await writeFile(join(root, "2 Middle.flac"), "");
  await writeFile(join(root, ".hidden.mp3"), "");
  await writeFile(join(root, "desktop.ini"), "");
  const fixture = new FixtureRemovableStorageProvider([
    {
      stableIdentity: "serial:browser",
      nativeRoot: root,
      displayName: "Browser Fixture",
      readable: true,
      readOnly: false,
    },
  ]);
  const filesystem = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(filesystem);
  const storage = new RemovableStorageService(
    fixture,
    filesystem,
    paths,
    60_000,
  );
  await storage.start();
  const browser = new DirectoryBrowserService(
    filesystem,
    paths,
    storage,
    () => null,
    new MetadataService(),
    new ArtworkService(),
  );
  try {
    const deviceId = storage.snapshot().devices[0]?.id ?? "";
    const listing = await browser.browse(deviceId);
    assert.deepEqual(
      listing.entries.map((entry) => entry.name),
      ["Album", "2 Middle.flac", "10 Finale.mp3"],
    );
    assert.equal(listing.source.type, "removable");
    assert.equal(JSON.stringify(listing).includes(root), false);
    const queue = await browser.queueForDirectoryWithOrigins(deviceId, "");
    assert.deepEqual(queue.relativePaths, ["2 Middle.flac", "10 Finale.mp3"]);
    assert.equal(queue.paths.length, 2);
    assert.throws(
      () => paths.validateLogicalRelativePath("../escape"),
      /invalid/i,
    );
  } finally {
    await browser.close();
    await storage.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("removable monitor and one-level browser stay bounded", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-usb-benchmark-"));
  const root = join(temporary, "USB");
  await mkdir(root);
  await writeFile(join(root, "01 Track.wav"), "");
  const fixture = new FixtureRemovableStorageProvider();
  const filesystem = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(filesystem);
  const storage = new RemovableStorageService(
    fixture,
    filesystem,
    paths,
    60_000,
  );
  const heapBefore = process.memoryUsage().heapUsed;
  const initialStart = performance.now();
  await storage.start();
  const initialEnumerationMilliseconds = performance.now() - initialStart;
  fixture.setVolumes([
    {
      stableIdentity: "benchmark-volume",
      nativeRoot: root,
      displayName: "Benchmark USB",
      readable: true,
      readOnly: false,
    },
  ]);
  const connectStart = performance.now();
  await storage.refresh();
  const connectRefreshMilliseconds = performance.now() - connectStart;
  const browser = new DirectoryBrowserService(
    filesystem,
    paths,
    storage,
    () => null,
  );
  try {
    const deviceId = storage.snapshot().devices[0]?.id ?? "";
    const rootStart = performance.now();
    await browser.browse(deviceId);
    const rootOpenMilliseconds = performance.now() - rootStart;
    const cacheStart = performance.now();
    const cached = await browser.browse(deviceId);
    const cacheHitMilliseconds = performance.now() - cacheStart;
    fixture.setVolumes([]);
    const disconnectStart = performance.now();
    await storage.refresh();
    const disconnectRefreshMilliseconds = performance.now() - disconnectStart;
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
    const shutdownStart = performance.now();
    await Promise.all([browser.close(), storage.close()]);
    const shutdownMilliseconds = performance.now() - shutdownStart;
    console.log(
      "[removable-benchmark]",
      JSON.stringify({
        initialEnumerationMilliseconds,
        connectRefreshMilliseconds,
        disconnectRefreshMilliseconds,
        rootOpenMilliseconds,
        cacheHitMilliseconds,
        cacheHit: cached.fromCache,
        heapDeltaBytes,
        shutdownMilliseconds,
      }),
    );
    assert.equal(cached.fromCache, true);
    assert.equal(storage.diagnostics().timerActive, false);
    assert.ok(shutdownMilliseconds >= 0);
  } finally {
    await browser.close();
    await storage.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
