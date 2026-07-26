import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizeMpvCurrentAo,
  normalizeMpvAudioOutputDevices,
  systemDefaultAudioOutputDevice,
} from "../../../packages/shared/src/audio-output.js";
import {
  prepareAudioOutputForSessionRestore,
  shouldWaitForInitialAudioEnumeration,
  type BootstrapAudioOutputService,
} from "../src/audio-output/audio-output-bootstrap.js";
import {
  AudioOutputRepository,
  audioOutputConfigPath,
  parseAudioOutputPreference,
} from "../src/audio-output/audio-output-repository.js";
import {
  AUDIO_OUTPUT_INITIAL_ENUMERATION_TIMEOUT_MILLISECONDS,
  AudioOutputService,
  type AudioOutputMpvAdapter,
  type AudioOutputPropertyName,
  type AudioOutputStartupScheduler,
} from "../src/audio-output/audio-output-service.js";

class FakeAudioOutputAdapter implements AudioOutputMpvAdapter {
  available = true;
  playbackActive = false;
  device = "auto";
  currentAo: unknown = null;
  devices: unknown = [
    { name: "auto", description: "Autoselect device" },
    { name: "speakers", description: "Speakers" },
  ];
  readonly writes: string[] = [];
  readonly failingDevices = new Set<string>();
  private readonly propertyListeners = new Set<
    (name: AudioOutputPropertyName, value: unknown) => void
  >();
  private readonly playbackListeners = new Set<(active: boolean) => void>();

  isMpvAvailable(): boolean {
    return this.available;
  }

  isPlaybackActive(): boolean {
    return this.playbackActive;
  }

  readAudioOutputProperty(name: AudioOutputPropertyName): Promise<unknown> {
    if (name === "audio-device-list") return Promise.resolve(this.devices);
    if (name === "audio-device") return Promise.resolve(this.device);
    return Promise.resolve(this.currentAo);
  }

  writeAudioOutputDevice(deviceId: string): Promise<void> {
    this.writes.push(deviceId);
    if (this.failingDevices.has(deviceId))
      return Promise.reject(new Error("fixture switch failed"));
    this.device = deviceId;
    this.emit("audio-device", deviceId);
    return Promise.resolve();
  }

  subscribeAudioOutputProperties(
    listener: (name: AudioOutputPropertyName, value: unknown) => void,
  ): () => void {
    this.propertyListeners.add(listener);
    return () => this.propertyListeners.delete(listener);
  }

  subscribePlaybackActivity(listener: (active: boolean) => void): () => void {
    this.playbackListeners.add(listener);
    return () => this.playbackListeners.delete(listener);
  }

  setPlaybackActive(active: boolean): void {
    this.playbackActive = active;
    for (const listener of this.playbackListeners) listener(active);
  }

  emit(name: AudioOutputPropertyName, value: unknown): void {
    if (name === "audio-device-list") this.devices = value;
    if (name === "current-ao") this.currentAo = value;
    for (const listener of this.propertyListeners) listener(name, value);
  }

  propertyListenerCount(): number {
    return this.propertyListeners.size;
  }
}

class FakeStartupScheduler implements AudioOutputStartupScheduler {
  readonly scheduled: { callback: () => void; milliseconds: number }[] = [];
  readonly cleared = new Set<unknown>();

  setTimeout(callback: () => void, milliseconds: number): unknown {
    const handle = { callback, milliseconds };
    this.scheduled.push(handle);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.cleared.add(handle);
  }

  fire(index = 0): void {
    this.scheduled[index]?.callback();
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

async function initializeAndApply(service: AudioOutputService): Promise<void> {
  await service.initialize();
  await service.applyInitialPreference();
}

void test("MPV audio output normalization synthesizes auto, sanitizes, bounds and deduplicates", () => {
  const normalized = normalizeMpvAudioOutputDevices([
    null,
    { name: "auto", description: "MPV auto" },
    { name: "speakers", description: "  Main Speakers  " },
    { name: "speakers", description: "Duplicate" },
    { name: "", description: "Missing" },
    { name: 42, description: "Wrong type" },
    { name: "fallback", description: "" },
  ]);
  assert.deepEqual(normalized, [
    systemDefaultAudioOutputDevice,
    {
      id: "speakers",
      description: "Main Speakers",
      available: true,
    },
    { id: "fallback", description: "fallback", available: true },
  ]);
  assert.deepEqual(normalizeMpvAudioOutputDevices({}), [
    systemDefaultAudioOutputDevice,
  ]);
});

void test("current-ao accepts bounded unknown MPV drivers and rejects unsafe values", () => {
  assert.equal(normalizeMpvCurrentAo("  wasapi  "), "wasapi");
  assert.equal(normalizeMpvCurrentAo("pipewire"), "pipewire");
  assert.equal(normalizeMpvCurrentAo("future-driver"), "future-driver");
  assert.equal(normalizeMpvCurrentAo(""), null);
  assert.equal(normalizeMpvCurrentAo(null), null);
  assert.equal(normalizeMpvCurrentAo(42), null);
  assert.equal(normalizeMpvCurrentAo("x".repeat(129)), null);
  assert.equal(normalizeMpvCurrentAo("alsa\npath"), null);
});

void test("audio output preference parser accepts only the closed versioned shape", () => {
  assert.deepEqual(
    parseAudioOutputPreference({
      version: 1,
      preferredDeviceId: "speakers",
      preferredDeviceDescription: "Speakers",
    }),
    { deviceId: "speakers", description: "Speakers" },
  );
  assert.equal(
    parseAudioOutputPreference({
      version: 2,
      preferredDeviceId: "speakers",
      preferredDeviceDescription: "Speakers",
    }),
    null,
  );
  assert.equal(
    parseAudioOutputPreference({
      version: 1,
      preferredDeviceId: "",
      preferredDeviceDescription: "Speakers",
    }),
    null,
  );
  assert.equal(
    parseAudioOutputPreference({
      version: 1,
      preferredDeviceId: "speakers",
      preferredDeviceDescription: "x".repeat(257),
    }),
    null,
  );
});

void test("audio output repository defaults, writes atomically and recovers corrupt files", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-output-"));
  const path = join(root, "audio-output.json");
  const repository = new AudioOutputRepository(path);
  try {
    assert.deepEqual(await repository.read(), {
      deviceId: "auto",
      description: "System default",
    });
    await repository.write({
      deviceId: "speakers",
      description: "Speakers",
    });
    assert.deepEqual(await repository.read(), {
      deviceId: "speakers",
      description: "Speakers",
    });
    const persisted = JSON.parse(await readFile(path, "utf8")) as object;
    assert.deepEqual(persisted, {
      version: 1,
      preferredDeviceId: "speakers",
      preferredDeviceDescription: "Speakers",
    });
    assert.equal(
      (await readdir(root)).some((name) => name.endsWith(".tmp")),
      false,
    );
    await writeFile(path, "{broken");
    assert.deepEqual(await repository.read(), {
      deviceId: "auto",
      description: "System default",
    });
    assert.equal(
      (await readdir(root)).some((name) =>
        name.startsWith("audio-output.json.corrupt-"),
      ),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("audio output config is separate from player session across Windows and Linux", () => {
  const windows = audioOutputConfigPath(
    "win32",
    { APPDATA: "C:\\Config", LOCALAPPDATA: "C:\\Data" },
    "C:\\Home",
  );
  const linux = audioOutputConfigPath(
    "linux",
    { XDG_CONFIG_HOME: "/config" },
    "/home/user",
  );
  assert.equal(windows, "C:\\Config\\Eidetic Player\\audio-output.json");
  assert.equal(linux, "/config/eidetic-player/audio-output.json");
  assert.doesNotMatch(windows, /player-session/);
  assert.doesNotMatch(linux, /player-session/);
});

void test("bootstrap applies an available preference before playback and falls back without deleting an absent preference", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-bootstrap-"));
  try {
    const availableRepository = new AudioOutputRepository(
      join(root, "available.json"),
    );
    await availableRepository.write({
      deviceId: "speakers",
      description: "Speakers",
    });
    const availableAdapter = new FakeAudioOutputAdapter();
    const availableService = new AudioOutputService(
      availableAdapter,
      availableRepository,
      50,
    );
    await initializeAndApply(availableService);
    assert.equal(availableAdapter.device, "speakers");
    assert.equal(
      availableService.snapshot().preferredDevice.deviceId,
      "speakers",
    );
    availableService.close();

    const absentRepository = new AudioOutputRepository(
      join(root, "absent.json"),
    );
    await absentRepository.write({
      deviceId: "usb-dac",
      description: "USB DAC",
    });
    const absentAdapter = new FakeAudioOutputAdapter();
    const absentService = new AudioOutputService(
      absentAdapter,
      absentRepository,
      50,
    );
    await initializeAndApply(absentService);
    assert.equal(absentAdapter.device, "auto");
    assert.equal(absentService.snapshot().status, "preferred-unavailable");
    assert.deepEqual(absentService.snapshot().preferredDevice, {
      deviceId: "usb-dac",
      description: "USB DAC",
    });
    assert.deepEqual(await absentRepository.read(), {
      deviceId: "usb-dac",
      description: "USB DAC",
    });
    absentService.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("selection is immediate, persistent, no-op safe and does not touch playback state", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-select-"));
  try {
    const repository = new AudioOutputRepository(join(root, "preference.json"));
    const adapter = new FakeAudioOutputAdapter();
    adapter.setPlaybackActive(true);
    const playbackSentinel = {
      queueIds: ["queue-a", "queue-b"],
      current: "queue-a",
      position: 42,
      volume: 73,
      muted: true,
      shuffle: true,
      repeat: "all",
    };
    const before = structuredClone(playbackSentinel);
    const service = new AudioOutputService(adapter, repository, 50);
    await initializeAndApply(service);
    assert.deepEqual(await service.select("speakers"), {
      changed: true,
      deviceId: "speakers",
    });
    assert.equal(adapter.device, "speakers");
    assert.deepEqual(await repository.read(), {
      deviceId: "speakers",
      description: "Speakers",
    });
    assert.deepEqual(await service.select("speakers"), {
      changed: false,
      deviceId: "speakers",
    });
    assert.deepEqual(playbackSentinel, before);
    service.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("failed selection rolls back and retains the previous preference", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-rollback-"));
  try {
    const repository = new AudioOutputRepository(join(root, "preference.json"));
    const adapter = new FakeAudioOutputAdapter();
    const service = new AudioOutputService(adapter, repository, 50);
    await initializeAndApply(service);
    adapter.failingDevices.add("speakers");
    await assert.rejects(
      service.select("speakers"),
      (error: unknown) =>
        (error as { code?: string }).code === "AUDIO_OUTPUT_SWITCH_FAILED",
    );
    assert.equal(adapter.device, "auto");
    assert.equal(service.snapshot().preferredDevice.deviceId, "auto");
    assert.deepEqual(await repository.read(), {
      deviceId: "auto",
      description: "System default",
    });
    service.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("failed selection falls back to auto when restoring the previous device also fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-fallback-"));
  try {
    const repository = new AudioOutputRepository(join(root, "preference.json"));
    await repository.write({
      deviceId: "speakers",
      description: "Speakers",
    });
    const adapter = new FakeAudioOutputAdapter();
    adapter.devices = [
      { name: "speakers", description: "Speakers" },
      { name: "headphones", description: "Headphones" },
    ];
    adapter.device = "speakers";
    const service = new AudioOutputService(adapter, repository, 50);
    await initializeAndApply(service);
    adapter.failingDevices.add("headphones");
    adapter.failingDevices.add("speakers");

    await assert.rejects(
      service.select("headphones"),
      (error: unknown) =>
        (error as { code?: string }).code === "AUDIO_OUTPUT_SWITCH_FAILED",
    );
    assert.equal(adapter.device, "auto");
    assert.equal(service.snapshot().effectiveDeviceId, "auto");
    assert.equal(service.snapshot().status, "error");
    assert.deepEqual(await repository.read(), {
      deviceId: "speakers",
      description: "Speakers",
    });
    service.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("unplug falls back once and reconnect waits for explicit selection or next playback", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-unplug-"));
  try {
    const repository = new AudioOutputRepository(join(root, "preference.json"));
    await repository.write({
      deviceId: "speakers",
      description: "Speakers",
    });
    const adapter = new FakeAudioOutputAdapter();
    adapter.playbackActive = true;
    adapter.device = "speakers";
    const service = new AudioOutputService(adapter, repository, 50);
    await initializeAndApply(service);

    adapter.emit("audio-device-list", []);
    await settle();
    assert.equal(adapter.device, "auto");
    assert.equal(service.snapshot().status, "preferred-unavailable");
    assert.equal(service.snapshot().noticeRevision, 1);
    adapter.emit("audio-device-list", []);
    await settle();
    assert.equal(service.snapshot().noticeRevision, 1);

    adapter.emit("audio-device-list", [
      { name: "speakers", description: "Speakers" },
    ]);
    await settle();
    assert.equal(adapter.device, "auto");
    assert.equal(service.snapshot().preferredDevice.deviceId, "speakers");
    assert.equal(service.snapshot().status, "pending-playback");

    adapter.setPlaybackActive(false);
    assert.equal(adapter.device, "auto");
    await service.prepareForPlayback();
    assert.equal(adapter.device, "speakers");
    service.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("manual refresh updates a semantic change and rejects MPV unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-refresh-"));
  try {
    const adapter = new FakeAudioOutputAdapter();
    const service = new AudioOutputService(
      adapter,
      new AudioOutputRepository(join(root, "preference.json")),
      50,
    );
    await initializeAndApply(service);
    const before = service.snapshot().revision;
    adapter.devices = [
      ...(adapter.devices as object[]),
      { name: "headphones", description: "Headphones" },
    ];
    const refreshed = await service.refresh();
    assert.ok(refreshed.revision > before);
    assert.equal(refreshed.devices.at(-1)?.id, "headphones");
    adapter.available = false;
    await assert.rejects(
      service.refresh(),
      (error: unknown) =>
        (error as { code?: string }).code === "MPV_NOT_AVAILABLE",
    );
    service.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("current-ao diagnostics update semantically and subscriptions clean up", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-current-ao-"));
  try {
    const adapter = new FakeAudioOutputAdapter();
    adapter.currentAo = "wasapi";
    const service = new AudioOutputService(
      adapter,
      new AudioOutputRepository(join(root, "preference.json")),
      50,
    );
    await initializeAndApply(service);
    assert.equal(service.snapshot().diagnostics.currentAo, "wasapi");
    const revision = service.snapshot().revision;

    adapter.emit("current-ao", "wasapi");
    await settle();
    assert.equal(service.snapshot().revision, revision);

    adapter.emit("current-ao", "pipewire");
    await settle();
    assert.equal(service.snapshot().diagnostics.currentAo, "pipewire");
    assert.ok(service.snapshot().revision > revision);

    adapter.emit("current-ao", "x".repeat(129));
    await settle();
    assert.equal(service.snapshot().diagnostics.currentAo, null);

    assert.equal(adapter.propertyListenerCount(), 1);
    service.close();
    assert.equal(adapter.propertyListenerCount(), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("valid empty raw enumeration is ready immediately without a timer", async () => {
  const adapter = new FakeAudioOutputAdapter();
  adapter.devices = [];
  const scheduler = new FakeStartupScheduler();
  const service = new AudioOutputService(
    adapter,
    new AudioOutputRepository(
      join(tmpdir(), `eidetic-empty-${String(Date.now())}`),
    ),
    50,
    scheduler,
  );
  await service.initialize();
  assert.equal(await service.waitForInitialEnumeration(true), "ready");
  assert.equal(scheduler.scheduled.length, 0);
  assert.equal(
    service.snapshot().diagnostics.initialEnumerationStatus,
    "ready",
  );
  assert.equal(service.snapshot().diagnostics.normalizedDeviceCount, 1);
  service.close();
});

void test("MPV unavailable skips the startup wait and reports unavailable diagnostics", async () => {
  const adapter = new FakeAudioOutputAdapter();
  adapter.available = false;
  const scheduler = new FakeStartupScheduler();
  const service = new AudioOutputService(
    adapter,
    new AudioOutputRepository(
      join(tmpdir(), `eidetic-mpv-unavailable-${String(Date.now())}`),
    ),
    50,
    scheduler,
  );
  await service.initialize();
  assert.equal(await service.waitForInitialEnumeration(true), "unavailable");
  assert.equal(scheduler.scheduled.length, 0);
  assert.equal(service.snapshot().mpvAvailable, false);
  assert.equal(service.snapshot().diagnostics.currentAo, null);
  assert.equal(
    service.snapshot().diagnostics.initialEnumerationStatus,
    "unavailable",
  );
  await service.applyInitialPreference();
  service.close();
});

void test("malformed raw enumeration waits for a valid event and cancels its timer", async () => {
  const adapter = new FakeAudioOutputAdapter();
  adapter.devices = "auto";
  const scheduler = new FakeStartupScheduler();
  const service = new AudioOutputService(
    adapter,
    new AudioOutputRepository(
      join(tmpdir(), `eidetic-wait-${String(Date.now())}`),
    ),
    50,
    scheduler,
  );
  await service.initialize();
  const wait = service.waitForInitialEnumeration(true);
  assert.equal(scheduler.scheduled.length, 1);
  assert.equal(
    scheduler.scheduled[0]?.milliseconds,
    AUDIO_OUTPUT_INITIAL_ENUMERATION_TIMEOUT_MILLISECONDS,
  );

  adapter.emit("audio-device-list", { name: "auto" });
  await settle();
  assert.equal(
    service.snapshot().diagnostics.initialEnumerationStatus,
    "unavailable",
  );

  adapter.emit("audio-device-list", []);
  await settle();
  assert.equal(await wait, "ready");
  assert.equal(scheduler.cleared.has(scheduler.scheduled[0]), true);
  assert.equal(
    service.snapshot().diagnostics.initialEnumerationStatus,
    "ready",
  );
  service.close();
});

void test("Appliance timeout keeps preference, falls back to auto, and late reconnect never auto-switches", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-timeout-"));
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message?: unknown): void => {
    warnings.push(String(message));
  };
  try {
    const repository = new AudioOutputRepository(join(root, "preference.json"));
    await repository.write({
      deviceId: "speakers",
      description: "Speakers",
    });
    const adapter = new FakeAudioOutputAdapter();
    adapter.devices = null;
    adapter.playbackActive = true;
    const scheduler = new FakeStartupScheduler();
    const service = new AudioOutputService(adapter, repository, 50, scheduler);
    await service.initialize();
    const wait = service.waitForInitialEnumeration(true);
    scheduler.fire();
    assert.equal(await wait, "timed-out");
    assert.equal(
      service.snapshot().diagnostics.initialEnumerationStatus,
      "timed-out",
    );
    await service.applyInitialPreference();
    assert.equal(adapter.device, "auto");
    assert.deepEqual(await repository.read(), {
      deviceId: "speakers",
      description: "Speakers",
    });
    assert.equal(
      warnings.filter((warning) => warning.includes("timed out")).length,
      1,
    );

    adapter.emit("audio-device-list", [
      { name: "speakers", description: "Speakers" },
    ]);
    await settle();
    assert.equal(adapter.device, "auto");
    assert.equal(
      service.snapshot().diagnostics.initialEnumerationStatus,
      "ready",
    );
    assert.equal(service.snapshot().noticeRevision, 0);

    adapter.setPlaybackActive(false);
    assert.equal(adapter.device, "auto");
    await service.prepareForPlayback();
    assert.equal(adapter.device, "speakers");
    service.close();
  } finally {
    console.warn = originalWarn;
    await rm(root, { recursive: true, force: true });
  }
});

void test("Windows and Linux Standard never create the Appliance wait timer", async () => {
  assert.equal(
    shouldWaitForInitialAudioEnumeration("linux", "appliance"),
    true,
  );
  assert.equal(
    shouldWaitForInitialAudioEnumeration("win32", "appliance"),
    false,
  );
  assert.equal(
    shouldWaitForInitialAudioEnumeration("linux", "standard"),
    false,
  );
  assert.equal(
    shouldWaitForInitialAudioEnumeration("darwin", "development"),
    false,
  );

  for (const [platform, mode] of [
    ["win32", "appliance"],
    ["linux", "standard"],
  ] as const) {
    const calls: string[] = [];
    const fixture: BootstrapAudioOutputService = {
      initialize: () => {
        calls.push("audio-initialize");
        return Promise.resolve();
      },
      waitForInitialEnumeration: (enabled) => {
        calls.push(`wait-${String(enabled)}`);
        return Promise.resolve("unavailable");
      },
      applyInitialPreference: () => {
        calls.push("output-apply");
        return Promise.resolve();
      },
    };
    await prepareAudioOutputForSessionRestore(fixture, platform, mode);
    assert.deepEqual(calls, ["audio-initialize", "wait-false", "output-apply"]);
  }
});

void test("bootstrap helper orders Appliance wait before output apply and session restore", async () => {
  const calls = ["mpv-initialize"];
  const fixture: BootstrapAudioOutputService = {
    initialize: () => {
      calls.push("audio-initialize");
      return Promise.resolve();
    },
    waitForInitialEnumeration: (enabled) => {
      calls.push(`wait-${String(enabled)}`);
      return Promise.resolve("ready");
    },
    applyInitialPreference: () => {
      calls.push("output-apply");
      return Promise.resolve();
    },
  };
  await prepareAudioOutputForSessionRestore(fixture, "linux", "appliance");
  calls.push("session-restore");
  assert.deepEqual(calls, [
    "mpv-initialize",
    "audio-initialize",
    "wait-true",
    "output-apply",
    "session-restore",
  ]);
});

void test("shutdown during startup wait resolves unavailable and removes subscriptions", async () => {
  const adapter = new FakeAudioOutputAdapter();
  adapter.devices = null;
  const scheduler = new FakeStartupScheduler();
  const service = new AudioOutputService(
    adapter,
    new AudioOutputRepository(
      join(tmpdir(), `eidetic-close-${String(Date.now())}`),
    ),
    50,
    scheduler,
  );
  await service.initialize();
  const wait = service.waitForInitialEnumeration(true);
  service.close();
  assert.equal(await wait, "unavailable");
  assert.equal(adapter.propertyListenerCount(), 0);
  assert.equal(scheduler.cleared.has(scheduler.scheduled[0]), true);
});
