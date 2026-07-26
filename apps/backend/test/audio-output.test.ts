import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizeMpvAudioOutputDevices,
  systemDefaultAudioOutputDevice,
} from "../../../packages/shared/src/audio-output.js";
import {
  AudioOutputRepository,
  audioOutputConfigPath,
  parseAudioOutputPreference,
} from "../src/audio-output/audio-output-repository.js";
import {
  AudioOutputService,
  type AudioOutputMpvAdapter,
  type AudioOutputPropertyName,
} from "../src/audio-output/audio-output-service.js";

class FakeAudioOutputAdapter implements AudioOutputMpvAdapter {
  available = true;
  playbackActive = false;
  device = "auto";
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
    return Promise.resolve(
      name === "audio-device-list" ? this.devices : this.device,
    );
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
    for (const listener of this.propertyListeners) listener(name, value);
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
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
    await availableService.initialize();
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
    await absentService.initialize();
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
    await service.initialize();
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
    await service.initialize();
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
    await service.initialize();
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
    await service.initialize();

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
    await service.initialize();
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
