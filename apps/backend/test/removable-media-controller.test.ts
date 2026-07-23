import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldImmediate } from "node:timers/promises";
import test from "node:test";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import { FixtureRemovableMediaAdapter } from "../src/removable-storage/fixture-removable-media-adapter.js";
import { FixtureRemovableStorageProvider } from "../src/removable-storage/fixture-removable-storage-provider.js";
import { RemovableStorageService } from "../src/removable-storage/removable-storage-service.js";

const operationReference = (volume: string) => ({
  physicalDevice: "fixture-physical-device",
  volume,
});

void test("safe removal is confirmed only in use and covers every partition once", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-safe-remove-"));
  const firstRoot = join(temporary, "A");
  const secondRoot = join(temporary, "B");
  await Promise.all([
    mkdir(firstRoot, { recursive: true }),
    mkdir(secondRoot, { recursive: true }),
  ]);
  const volumes = [
    {
      stableIdentity: "fixture-volume-a",
      physicalIdentity: "fixture-device",
      nativeRoot: firstRoot,
      displayName: "USB A",
      readable: true,
      readOnly: false,
      mounted: true,
      operationReference: operationReference("volume-a"),
    },
    {
      stableIdentity: "fixture-volume-b",
      physicalIdentity: "fixture-device",
      nativeRoot: secondRoot,
      displayName: "USB B",
      readable: true,
      readOnly: false,
      mounted: true,
      operationReference: operationReference("volume-b"),
    },
  ] as const;
  const provider = new FixtureRemovableStorageProvider(volumes);
  const adapter = new FixtureRemovableMediaAdapter();
  const filesystem = new LocalFilesystemProvider();
  const storage = new RemovableStorageService(
    provider,
    filesystem,
    PathService.forCurrentPlatform(filesystem),
    60_000,
    adapter,
  );
  let prepareCount = 0;
  storage.configureOperations({
    usage: () =>
      Promise.resolve({
        inUse: true,
        playbackWillStop: true,
        queueContainsItems: true,
        scanWillCancel: true,
        mountedVolumeCount: 2,
      }),
    prepareRemoval: (deviceIds, identities) => {
      assert.equal(deviceIds.length, 2);
      assert.deepEqual(identities, ["fixture-volume-a", "fixture-volume-b"]);
      prepareCount += 1;
      return Promise.resolve();
    },
  });
  await storage.start();
  try {
    const device = storage.snapshot().devices[0];
    assert.ok(device);
    assert.equal(device.capabilities.canSafelyRemove, true);
    await assert.rejects(
      storage.safelyRemove(device.id, false),
      /Confirm safe removal/,
    );
    const [first, duplicate] = await Promise.all([
      storage.safelyRemove(device.id, true),
      storage.safelyRemove(device.id, true),
    ]);
    assert.deepEqual(duplicate, first);
    assert.equal(prepareCount, 1);
    assert.deepEqual(adapter.calls, [
      { kind: "unmount", reference: "volume-a" },
      { kind: "unmount", reference: "volume-b" },
      { kind: "eject", reference: "fixture-physical-device" },
    ]);
    assert.equal(adapter.maximumConcurrentOperations, 1);
    assert.ok(
      storage
        .snapshot()
        .devices.every(
          (candidate) =>
            candidate.operation.state === "safe-to-remove" &&
            !candidate.readable,
        ),
    );
    provider.setVolumes([]);
    await storage.refresh();
    assert.ok(
      storage
        .snapshot()
        .devices.every(
          (candidate) =>
            candidate.operation.state === "safe-to-remove" &&
            !candidate.readable,
        ),
    );
    provider.setVolumes(volumes);
    await storage.refresh();
    assert.ok(
      storage
        .snapshot()
        .devices.every(
          (candidate) =>
            candidate.operation.state === "idle" && candidate.readable,
        ),
    );
  } finally {
    await storage.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("busy partial removal never reports safe and remains retryable", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-safe-busy-"));
  const firstRoot = join(temporary, "A");
  const secondRoot = join(temporary, "B");
  await Promise.all([
    mkdir(firstRoot, { recursive: true }),
    mkdir(secondRoot, { recursive: true }),
  ]);
  const provider = new FixtureRemovableStorageProvider(
    [firstRoot, secondRoot].map((nativeRoot, index) => ({
      stableIdentity: `fixture-busy-${String(index)}`,
      physicalIdentity: "fixture-busy-device",
      nativeRoot,
      displayName: `Busy ${String(index)}`,
      readable: true,
      readOnly: false,
      mounted: true,
      operationReference: operationReference(`busy-${String(index)}`),
    })),
  );
  const adapter = new FixtureRemovableMediaAdapter({
    removalFailure: "device-busy",
    removalFailureAfterUnmounts: 2,
  });
  const filesystem = new LocalFilesystemProvider();
  const storage = new RemovableStorageService(
    provider,
    filesystem,
    PathService.forCurrentPlatform(filesystem),
    60_000,
    adapter,
  );
  await storage.start();
  try {
    const deviceId = storage.snapshot().devices[0]?.id ?? "";
    await assert.rejects(
      storage.safelyRemove(deviceId, true),
      /Device is busy/,
    );
    assert.equal(
      adapter.calls.some((call) => call.kind === "eject"),
      false,
    );
    assert.ok(
      storage
        .snapshot()
        .devices.every(
          (device) =>
            device.operation.state === "busy" &&
            device.operation.retryAvailable,
        ),
    );
  } finally {
    await storage.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

void test("mount is per-volume, system targets are rejected, and shutdown aborts", async () => {
  const provider = new FixtureRemovableStorageProvider([
    {
      stableIdentity: "fixture-unmounted",
      physicalIdentity: "fixture-mount-device",
      displayName: "Unmounted",
      readable: false,
      readOnly: false,
      mounted: false,
      operationReference: operationReference("unmounted-volume"),
    },
    {
      stableIdentity: "fixture-system",
      physicalIdentity: "fixture-system-device",
      displayName: "System",
      readable: false,
      readOnly: false,
      mounted: false,
      system: true,
      operationReference: {
        physicalDevice: "system-device",
        volume: "system-volume",
      },
    },
  ]);
  const adapter = new FixtureRemovableMediaAdapter();
  const filesystem = new LocalFilesystemProvider();
  const storage = new RemovableStorageService(
    provider,
    filesystem,
    PathService.forCurrentPlatform(filesystem),
    60_000,
    adapter,
  );
  await storage.start();
  const unmounted = storage
    .snapshot()
    .devices.find((device) => device.displayName === "Unmounted");
  const system = storage
    .snapshot()
    .devices.find((device) => device.displayName === "System");
  assert.ok(unmounted);
  assert.ok(system);
  assert.equal(unmounted.capabilities.canMount, true);
  assert.equal(system.capabilities.canMount, false);
  await storage.mount(unmounted.id);
  assert.deepEqual(adapter.calls, [
    { kind: "mount", reference: "unmounted-volume" },
  ]);
  await storage.close();

  const hangingAdapter = new FixtureRemovableMediaAdapter({
    waitForAbort: true,
  });
  const hangingProvider = new FixtureRemovableStorageProvider([
    {
      stableIdentity: "fixture-hanging",
      physicalIdentity: "fixture-hanging-device",
      displayName: "Hanging",
      readable: false,
      readOnly: false,
      mounted: false,
      operationReference: operationReference("hanging-volume"),
    },
  ]);
  const hangingStorage = new RemovableStorageService(
    hangingProvider,
    filesystem,
    PathService.forCurrentPlatform(filesystem),
    60_000,
    hangingAdapter,
  );
  await hangingStorage.start();
  const operation = hangingStorage.mount(
    hangingStorage.snapshot().devices[0]?.id ?? "",
  );
  const rejected = assert.rejects(operation);
  await yieldImmediate();
  hangingProvider.setVolumes([]);
  await hangingStorage.refresh();
  assert.equal(hangingStorage.snapshot().devices.length, 1);
  await hangingStorage.close();
  await rejected;
  assert.equal(hangingStorage.diagnostics().activeOperations, 0);
  assert.equal(hangingAdapter.closed, true);
});

void test("mount and removal failures stay structured, retryable, and never safe", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-operation-errors-"));
  const mountedRoot = join(temporary, "mounted");
  await mkdir(mountedRoot, { recursive: true });
  const filesystem = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(filesystem);
  try {
    const mountAdapter = new FixtureRemovableMediaAdapter({
      mountFailure: "authorization-required",
    });
    const mountStorage = new RemovableStorageService(
      new FixtureRemovableStorageProvider([
        {
          stableIdentity: "fixture-mount-failure",
          physicalIdentity: "fixture-mount-failure-device",
          displayName: "Mount failure",
          readable: false,
          readOnly: false,
          mounted: false,
          operationReference: operationReference("mount-failure"),
        },
      ]),
      filesystem,
      paths,
      60_000,
      mountAdapter,
    );
    await mountStorage.start();
    await assert.rejects(
      mountStorage.mount(mountStorage.snapshot().devices[0]?.id ?? ""),
      /Permission required/,
    );
    assert.equal(
      mountStorage.snapshot().devices[0]?.operation.errorCode,
      "authorization-required",
    );
    assert.equal(
      mountStorage.snapshot().devices[0]?.operation.retryAvailable,
      true,
    );
    await mountStorage.close();

    for (const failure of [
      "authorization-required",
      "device-not-found",
      "unsupported",
      "timeout",
      "failed",
    ] as const) {
      const adapter = new FixtureRemovableMediaAdapter({
        removalFailure: failure,
      });
      const storage = new RemovableStorageService(
        new FixtureRemovableStorageProvider([
          {
            stableIdentity: `fixture-${failure}`,
            physicalIdentity: `fixture-${failure}-device`,
            nativeRoot: mountedRoot,
            displayName: failure,
            readable: true,
            readOnly: false,
            mounted: true,
            operationReference: operationReference(failure),
          },
        ]),
        filesystem,
        paths,
        60_000,
        adapter,
      );
      await storage.start();
      await assert.rejects(
        storage.safelyRemove(storage.snapshot().devices[0]?.id ?? "", true),
      );
      const operation = storage.snapshot().devices[0]?.operation;
      assert.ok(operation);
      assert.notEqual(operation.state, "safe-to-remove");
      assert.equal(operation.errorCode, failure);
      assert.equal(
        operation.retryAvailable,
        !["unsupported", "device-not-found"].includes(failure),
      );
      assert.equal(
        adapter.calls.some((call) => call.kind === "eject"),
        false,
      );
      await storage.close();
    }

    const unsupportedAdapter = new FixtureRemovableMediaAdapter({
      capabilities: {
        canMount: false,
        canUnmount: false,
        canEject: false,
        canSafelyRemove: false,
      },
    });
    const unsupportedStorage = new RemovableStorageService(
      new FixtureRemovableStorageProvider([
        {
          stableIdentity: "fixture-unsupported-capability",
          physicalIdentity: "fixture-unsupported-capability-device",
          nativeRoot: mountedRoot,
          displayName: "Unsupported",
          readable: true,
          readOnly: false,
          mounted: true,
          operationReference: operationReference("unsupported-capability"),
        },
      ]),
      filesystem,
      paths,
      60_000,
      unsupportedAdapter,
    );
    await unsupportedStorage.start();
    assert.equal(
      unsupportedStorage.snapshot().devices[0]?.capabilities.canSafelyRemove,
      false,
    );
    await assert.rejects(
      unsupportedStorage.safelyRemove(
        unsupportedStorage.snapshot().devices[0]?.id ?? "",
        true,
      ),
      /not supported/,
    );
    assert.deepEqual(unsupportedAdapter.calls, []);
    await unsupportedStorage.close();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
