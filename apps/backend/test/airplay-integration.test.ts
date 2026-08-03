import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AIRPLAY_INTEGRATION_VERSION,
  AirPlayStore,
  AirPlayStoreError,
} from "../src/airplay/airplay-store.js";
import { renderAirPlayConfig } from "../src/airplay/airplay-config-renderer.js";
import { AirPlayMetadataParser } from "../src/airplay/airplay-metadata-parser.js";
import {
  AirPlayProvider,
  shouldStartAirPlayMetadataReader,
} from "../src/airplay/airplay-provider.js";
import { AirPlayService } from "../src/airplay/airplay-service.js";
import type {
  AirPlayPlatformAdapter,
  AirPlayPlatformStatus,
} from "../src/airplay/airplay-platform-adapter.js";
import {
  airPlayServiceCommandPlan,
  isRequiredAirPlayServiceCommand,
} from "../src/airplay/airplay-platform-adapter.js";

function metadataItem(type: string, code: string, bytes: Buffer): string {
  const hexadecimal = (value: string): string =>
    Buffer.from(value, "ascii").toString("hex");
  return `<item><type>${hexadecimal(type)}</type><code>${hexadecimal(code)}</code><length>${String(bytes.length)}</length><data encoding="base64">${bytes.toString("base64")}</data></item>`;
}

class FixturePlatform implements AirPlayPlatformAdapter {
  readonly fixture = true;
  readonly controlSocket = `\\\\.\\pipe\\eidetic-airplay-${String(process.pid)}-${randomUUID()}`;
  readonly metadataPipe = join(
    tmpdir(),
    `eidetic-airplay-${randomUUID()}.fifo`,
  );
  readonly hookExecutable = "/usr/libexec/eidetic-player-airplay-hook";
  stopped = false;
  active = false;
  advertisementChecks = 0;
  restartCount = 0;
  setEnabledCount = 0;

  constructor(
    private readonly advertisements: (
      "verified" | "collision" | "unavailable"
    )[] = ["verified"],
  ) {}

  status(): Promise<AirPlayPlatformStatus> {
    return Promise.resolve({
      available: true,
      active: this.active,
      protocol: "airplay2",
      message: null,
    });
  }
  verifyAdvertisement(): Promise<"verified" | "collision" | "unavailable"> {
    const index = Math.min(
      this.advertisementChecks,
      this.advertisements.length - 1,
    );
    this.advertisementChecks += 1;
    return Promise.resolve(this.advertisements[index] ?? "unavailable");
  }
  prepareRuntime(): Promise<void> {
    return Promise.resolve();
  }
  writeConfiguration(): Promise<void> {
    return Promise.resolve();
  }
  setEnabled(enabled: boolean): Promise<void> {
    this.setEnabledCount += 1;
    this.active = enabled;
    return Promise.resolve();
  }
  restart(): Promise<void> {
    this.restartCount += 1;
    this.active = true;
    return Promise.resolve();
  }
  stopRuntime(): Promise<void> {
    this.stopped = true;
    this.active = false;
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

function control(path: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let reply = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${command}\n`);
    });
    socket.on("data", (chunk: string) => {
      reply += chunk;
    });
    socket.once("end", () => {
      resolve(reply);
    });
    socket.once("error", reject);
  });
}

void test("AirPlay store defaults On with an anonymous persistent receiver name", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-airplay-store-"));
  try {
    const store = new AirPlayStore(root);
    const initial = await store.initialize();
    assert.equal(initial.enabled, true);
    assert.match(initial.receiverName, /^Eidetic Player - [0-9A-F]{4}$/u);
    assert.match(initial.generatedSuffix, /^[0-9A-F]{4}$/u);
    assert.doesNotMatch(initial.receiverName, /[0-9a-f]{6,}/iu);
    const saved = await store.save({ receiverName: "Living Room" });
    assert.equal(saved.receiverName, "Living Room");
    assert.equal(saved.receiverNameOrigin, "user");
    assert.equal(saved.revision, 1);
    assert.equal(
      (
        JSON.parse(await readFile(join(root, "airplay.json"), "utf8")) as {
          enabled: boolean;
        }
      ).enabled,
      true,
    );
    const disabled = await store.save({ enabled: false });
    assert.equal(disabled.enabled, false);
    assert.equal((await new AirPlayStore(root).initialize()).enabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("AirPlay store migrates its integration identity without changing user settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-airplay-store-version-"));
  const path = join(root, "airplay.json");
  try {
    const store = new AirPlayStore(root);
    const initial = await store.initialize();
    const legacy = {
      ...initial,
      revision: 7,
      enabled: false,
      receiverName: "Listening Room",
      receiverNameOrigin: "user",
      integrationVersion: "shairport-sync-5.2.1-eidetic.1+nqptp-1.2.8",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await writeFile(path, `${JSON.stringify(legacy)}\n`, "utf8");

    const migrated = await new AirPlayStore(root).initialize();
    assert.equal(migrated.integrationVersion, AIRPLAY_INTEGRATION_VERSION);
    assert.equal(migrated.revision, 8);
    assert.equal(migrated.enabled, false);
    assert.equal(migrated.receiverName, "Listening Room");
    assert.equal(migrated.receiverNameOrigin, "user");
    assert.notEqual(migrated.updatedAt, legacy.updatedAt);

    const persisted = JSON.parse(await readFile(path, "utf8")) as {
      integrationVersion: string;
      revision: number;
    };
    assert.equal(persisted.integrationVersion, AIRPLAY_INTEGRATION_VERSION);
    assert.equal(persisted.revision, 8);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("legacy generated receiver suffixes migrate to four hex characters without renaming custom receivers", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-airplay-suffix-"));
  const path = join(root, "airplay.json");
  try {
    const initial = await new AirPlayStore(root).initialize();
    await writeFile(
      path,
      `${JSON.stringify({
        ...initial,
        revision: 4,
        receiverName: "Eidetic Player - XY",
        receiverNameOrigin: "generated",
        generatedSuffix: "XY",
      })}\n`,
      "utf8",
    );
    const migratedGenerated = await new AirPlayStore(root).initialize();
    assert.equal(migratedGenerated.revision, 5);
    assert.match(migratedGenerated.generatedSuffix, /^[0-9A-F]{4}$/u);
    assert.equal(
      migratedGenerated.receiverName,
      `Eidetic Player - ${migratedGenerated.generatedSuffix}`,
    );

    await writeFile(
      path,
      `${JSON.stringify({
        ...migratedGenerated,
        revision: 8,
        receiverName: "Listening Room",
        receiverNameOrigin: "user",
        generatedSuffix: "YZ",
      })}\n`,
      "utf8",
    );
    const migratedCustom = await new AirPlayStore(root).initialize();
    assert.equal(migratedCustom.revision, 9);
    assert.equal(migratedCustom.receiverName, "Listening Room");
    assert.match(migratedCustom.generatedSuffix, /^[0-9A-F]{4}$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("renaming an idle enabled receiver restarts it before advertisement verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-airplay-rename-"));
  const platform = new FixturePlatform(["verified", "verified"]);
  const provider = new AirPlayProvider(platform);
  const service = new AirPlayService(
    provider,
    platform,
    () => Promise.resolve(),
    new AirPlayStore(root),
  );
  const route = {
    physicalOutputId: "usb-dac",
    description: "USB DAC",
    routeKind: "alsa" as const,
    providerTarget: "alsa/hw:2,0",
    levelMode: "variable" as const,
    maximumSoftwareVolume: 100,
    availabilityRevision: 1,
  };
  try {
    await service.initialize(() => route);
    assert.equal(platform.restartCount, 0);
    const renamed = await service.patch(
      {
        receiverName: "Listening Room",
        expectedRevision: service.snapshot().revision,
      },
      () => route,
    );
    assert.equal(renamed.receiverName, "Listening Room");
    assert.equal(renamed.serviceStatus, "ready");
    assert.equal(platform.restartCount, 1);
    assert.equal(platform.advertisementChecks, 2);
  } finally {
    service.close();
    await provider.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

void test("generated receiver collision retries are bounded and custom names fail visibly", async () => {
  const route = {
    physicalOutputId: "usb-dac",
    description: "USB DAC",
    routeKind: "alsa" as const,
    providerTarget: "alsa/hw:2,0",
    levelMode: "variable" as const,
    maximumSoftwareVolume: 100,
    availabilityRevision: 1,
  };
  const generatedRoot = await mkdtemp(
    join(tmpdir(), "eidetic-airplay-collision-"),
  );
  const generatedPlatform = new FixturePlatform([
    "collision",
    "collision",
    "verified",
  ]);
  const generatedProvider = new AirPlayProvider(generatedPlatform);
  const generatedService = new AirPlayService(
    generatedProvider,
    generatedPlatform,
    () => Promise.resolve(),
    new AirPlayStore(generatedRoot),
  );
  try {
    await generatedService.initialize(() => route);
    assert.equal(generatedService.snapshot().serviceStatus, "ready");
    assert.equal(generatedService.snapshot().revision, 2);
    assert.equal(generatedPlatform.advertisementChecks, 3);
  } finally {
    generatedService.close();
    await generatedProvider.shutdown();
    await rm(generatedRoot, { recursive: true, force: true });
  }

  const customRoot = await mkdtemp(
    join(tmpdir(), "eidetic-airplay-custom-collision-"),
  );
  const customStore = new AirPlayStore(customRoot);
  await customStore.initialize();
  await customStore.save({ receiverName: "Listening Room" });
  const customPlatform = new FixturePlatform(["collision"]);
  const customProvider = new AirPlayProvider(customPlatform);
  const customService = new AirPlayService(
    customProvider,
    customPlatform,
    () => Promise.resolve(),
    customStore,
  );
  try {
    await customService.initialize(() => route);
    assert.equal(customService.snapshot().serviceStatus, "error");
    assert.match(customService.snapshot().message ?? "", /already in use/u);
    assert.equal(customService.snapshot().receiverName, "Listening Room");
    assert.equal(customPlatform.active, false);
    assert.equal(customPlatform.advertisementChecks, 1);
  } finally {
    customService.close();
    await customProvider.shutdown();
    await rm(customRoot, { recursive: true, force: true });
  }
});

void test("AirPlay config is deterministic, escaped, and tied to the canonical route", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-airplay-config-"));
  try {
    const document = await new AirPlayStore(root).initialize();
    const config = renderAirPlayConfig(
      { ...document, receiverName: 'Room "A"' },
      {
        physicalOutputId: "usb-dac",
        description: "USB DAC",
        routeKind: "alsa",
        providerTarget: "alsa/hw:2,0",
        levelMode: "fixed",
        maximumSoftwareVolume: 100,
        availabilityRevision: 4,
      },
      {
        controlSocket: "/run/user/1000/eidetic-player/airplay-control.sock",
        metadataPipe: "/run/user/1000/eidetic-player/airplay-metadata",
        hookExecutable: "/usr/libexec/eidetic-player-airplay-hook",
      },
    );
    assert.match(config, /name = "Room \\"A\\"";/u);
    assert.match(config, /output_backend = "alsa";/u);
    assert.match(config, /output_device = "hw:2,0";/u);
    assert.match(config, /interpolation = "vernier";/u);
    assert.match(config, /ignore_volume_control = "no";/u);
    assert.match(config, /volume_max_db = 0\.0;/u);
    assert.match(
      config,
      /audio_backend_buffer_desired_length_in_seconds = 0\.5;/u,
    );
    assert.match(config, /eidetic-player-airplay-hook before/u);
    assert.doesNotMatch(config, /airplay-control\.sock before/u);
    assert.throws(() =>
      renderAirPlayConfig(
        document,
        {
          physicalOutputId: "default",
          description: "System default",
          routeKind: "other",
          providerTarget: "auto",
          levelMode: "variable",
          maximumSoftwareVolume: 100,
          availabilityRevision: 1,
        },
        {
          controlSocket: "/tmp/control",
          metadataPipe: "/tmp/metadata",
          hookExecutable: "/usr/libexec/hook",
        },
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("AirPlay metadata parser handles fragmented text, progress, volume, and rejects malformed data", () => {
  const parser = new AirPlayMetadataParser(48_000);
  const title = metadataItem(
    "core",
    "minm",
    Buffer.from("Neon Brother", "utf8"),
  );
  assert.deepEqual(parser.push(title.slice(0, 24)), []);
  assert.deepEqual(parser.push(title.slice(24)), [
    { kind: "text", field: "title", value: "Neon Brother" },
  ]);
  assert.deepEqual(
    parser.push(metadataItem("ssnc", "prgr", Buffer.from("100/48100/96100"))),
    [{ kind: "progress", positionSeconds: 1, durationSeconds: 2 }],
  );
  assert.deepEqual(
    parser.push(
      metadataItem("ssnc", "pvol", Buffer.from("-144.0,-144.0,-30.0,0.0")),
    ),
    [{ kind: "volume", volume: 0, muted: true }],
  );
  assert.deepEqual(
    parser.push(
      metadataItem("ssnc", "pvol", Buffer.from("-15.0,-15.0,-30.0,0.0")),
    ),
    [{ kind: "volume", volume: 50, muted: false }],
  );
  const jpegWithTrailingBytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9, 0x00,
  ]);
  assert.deepEqual(
    parser.push(metadataItem("ssnc", "PICT", jpegWithTrailingBytes)),
    [
      {
        kind: "artwork",
        bytes: jpegWithTrailingBytes,
        mimeType: "image/jpeg",
      },
    ],
  );
  const malformed = metadataItem("core", "minm", Buffer.from("unsafe")).replace(
    /dW5zYWZl/u,
    "dW5zYW?l",
  );
  assert.deepEqual(parser.push(malformed), []);
});

void test("AirPlay fixture never opens the native metadata FIFO on Linux", () => {
  assert.equal(shouldStartAirPlayMetadataReader(true, "linux", ""), false);
  assert.equal(shouldStartAirPlayMetadataReader(false, "linux", ""), true);
  assert.equal(shouldStartAirPlayMetadataReader(false, "win32", ""), false);
  assert.equal(shouldStartAirPlayMetadataReader(false, "linux", "1"), false);
});

void test("enabled AirPlay starts only after the backend runtime and clears a stale systemd failure", () => {
  const enabledPlan = airPlayServiceCommandPlan(true);
  assert.deepEqual(enabledPlan, [
    ["--user", "disable", "eidetic-player-airplay.service"],
    ["--user", "reset-failed", "eidetic-player-airplay.service"],
    ["--user", "start", "eidetic-player-airplay.service"],
  ]);
  assert.deepEqual(enabledPlan.map(isRequiredAirPlayServiceCommand), [
    true,
    false,
    true,
  ]);
  assert.deepEqual(airPlayServiceCommandPlan(false), [
    ["--user", "disable", "--now", "eidetic-player-airplay.service"],
  ]);
});

void test("failed receiver activation terminates in Error instead of enabled Starting", async () => {
  class FailingEnablePlatform extends FixturePlatform {
    override setEnabled(enabled: boolean): Promise<void> {
      this.setEnabledCount += 1;
      this.active = false;
      return enabled
        ? Promise.reject(
            new Error("AirPlay service state could not be changed."),
          )
        : Promise.resolve();
    }
  }

  const root = await mkdtemp(join(tmpdir(), "eidetic-airplay-start-failure-"));
  const store = new AirPlayStore(root);
  await store.initialize();
  await store.save({ enabled: false });
  const platform = new FailingEnablePlatform();
  const provider = new AirPlayProvider(platform);
  const service = new AirPlayService(
    provider,
    platform,
    () => Promise.resolve(),
    store,
  );
  const route = {
    physicalOutputId: "usb-dac",
    description: "USB DAC",
    routeKind: "alsa" as const,
    providerTarget: "alsa/hw:2,0",
    levelMode: "variable" as const,
    maximumSoftwareVolume: 100,
    availabilityRevision: 1,
  };
  try {
    await service.initialize(() => route);
    assert.equal(service.snapshot().serviceStatus, "off");
    await assert.rejects(
      service.patch(
        {
          enabled: true,
          expectedRevision: service.snapshot().revision,
        },
        () => route,
      ),
      (error: unknown) =>
        error instanceof AirPlayStoreError &&
        error.code === "AIRPLAY_START_FAILED" &&
        error.statusCode === 409,
    );
    assert.equal(service.snapshot().enabled, true);
    assert.equal(service.snapshot().serviceStatus, "error");
    assert.equal(
      service.snapshot().message,
      "AirPlay service state could not be changed.",
    );
  } finally {
    service.close();
    await provider.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

void test("an already-running receiver is detached from boot before its generated config is reloaded", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-airplay-running-"));
  const platform = new FixturePlatform();
  platform.active = true;
  const provider = new AirPlayProvider(platform);
  const service = new AirPlayService(
    provider,
    platform,
    () => Promise.resolve(),
    new AirPlayStore(root),
  );
  try {
    await service.initialize(() => ({
      physicalOutputId: "usb-dac",
      description: "USB DAC",
      routeKind: "alsa",
      providerTarget: "alsa/hw:2,0",
      levelMode: "variable",
      maximumSoftwareVolume: 100,
      availabilityRevision: 1,
    }));
    assert.equal(platform.setEnabledCount, 1);
    assert.equal(platform.restartCount, 1);
    assert.equal(service.snapshot().serviceStatus, "ready");
  } finally {
    service.close();
    await provider.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

void test("blocking AirPlay hook grants only after provider acquisition and releases on shutdown", async () => {
  const platform = new FixturePlatform();
  const provider = new AirPlayProvider(platform);
  try {
    await provider.initialize();
    provider.setPreparedRoute({
      physicalOutputId: "usb-dac",
      description: "USB DAC",
      routeKind: "alsa",
      providerTarget: "alsa/hw:2,0",
      levelMode: "variable",
      maximumSoftwareVolume: 100,
      availabilityRevision: 1,
    });
    const starting = new Promise<{ sessionId: string; generation: number }>(
      (resolve) => {
        provider.subscribe((event) => {
          if (event.kind === "session-starting")
            resolve({
              sessionId: event.sessionId,
              generation: event.generation,
            });
        });
      },
    );
    const pendingReply = control(platform.controlSocket, "BEFORE 1");
    const session = await starting;
    let settled = false;
    void pendingReply.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    await provider.acquire(session.sessionId, session.generation + 1);
    assert.equal(await pendingReply, "GRANT\n");
    assert.equal(await control(platform.controlSocket, "AFTER 1"), "OK\n");
  } finally {
    await provider.shutdown();
  }
  assert.equal(platform.stopped, true);
});

void test("AirPlay progress is conditional, advances only while playing, and fixed output accepts sender attenuation", async () => {
  const platform = new FixturePlatform();
  const provider = new AirPlayProvider(platform, 48_000, 1_000, 10);
  try {
    await provider.initialize();
    provider.setPreparedRoute({
      physicalOutputId: "gpio-dac",
      description: "GPIO I2S DAC",
      routeKind: "alsa",
      providerTarget: "alsa/hw:2,0",
      levelMode: "fixed",
      maximumSoftwareVolume: 100,
      availabilityRevision: 1,
    });
    const starting = new Promise<{ sessionId: string; generation: number }>(
      (resolve) => {
        provider.subscribe((event) => {
          if (event.kind === "session-starting")
            resolve({
              sessionId: event.sessionId,
              generation: event.generation,
            });
        });
      },
    );
    const grant = control(platform.controlSocket, "BEFORE 1");
    const session = await starting;
    await provider.acquire(session.sessionId, session.generation + 1);
    assert.equal(await grant, "GRANT\n");
    assert.equal(provider.snapshot().capabilities.progress, false);

    provider.ingestFixtureMetadata(
      metadataItem("ssnc", "prgr", Buffer.from("100/48100/96100")) +
        metadataItem("ssnc", "pbeg", Buffer.alloc(0)),
    );
    await new Promise((resolve) => setTimeout(resolve, 35));
    const moving = provider.snapshot();
    assert.equal(moving.capabilities.progress, true);
    assert.equal(moving.durationSeconds, 2);
    assert.ok((moving.positionSeconds ?? 0) > 1);

    provider.ingestFixtureMetadata(
      metadataItem("ssnc", "pfls", Buffer.alloc(0)),
    );
    const frozenPosition = provider.snapshot().positionSeconds;
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(provider.snapshot().positionSeconds, frozenPosition);

    provider.ingestFixtureMetadata(
      metadataItem("ssnc", "pvol", Buffer.from("-15.0,-15.0,-30.0,0.0")),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(provider.snapshot().volume, 50);
    assert.equal(provider.snapshot().muted, false);

    provider.ingestFixtureMetadata(
      metadataItem("ssnc", "mdst", Buffer.alloc(0)),
    );
    assert.equal(provider.snapshot().capabilities.progress, false);
    assert.equal(provider.snapshot().positionSeconds, null);
    assert.equal(provider.snapshot().durationSeconds, null);
  } finally {
    await provider.shutdown();
  }
});

void test("natural AirPlay end releases without restarting the idle receiver", async () => {
  const platform = new FixturePlatform();
  const provider = new AirPlayProvider(platform);
  try {
    await provider.initialize();
    provider.setPreparedRoute({
      physicalOutputId: "usb-dac",
      description: "USB DAC",
      routeKind: "alsa",
      providerTarget: "alsa/hw:2,0",
      levelMode: "variable",
      maximumSoftwareVolume: 100,
      availabilityRevision: 1,
    });
    const starting = new Promise<{ sessionId: string; generation: number }>(
      (resolve) => {
        provider.subscribe((event) => {
          if (event.kind === "session-starting")
            resolve({
              sessionId: event.sessionId,
              generation: event.generation,
            });
        });
      },
    );
    const grant = control(platform.controlSocket, "BEFORE 1");
    const session = await starting;
    await provider.acquire(session.sessionId, session.generation + 1);
    assert.equal(await grant, "GRANT\n");
    assert.equal(await control(platform.controlSocket, "AFTER 1"), "OK\n");
    await provider.stop(provider.snapshot().generation + 1);
    assert.equal(platform.restartCount, 0);
  } finally {
    await provider.shutdown();
  }
});

void test("AirPlay buffering is bounded and recovers instead of holding MPV indefinitely", async () => {
  const platform = new FixturePlatform();
  const provider = new AirPlayProvider(platform, 48_000, 20);
  try {
    await provider.initialize();
    provider.setPreparedRoute({
      physicalOutputId: "usb-dac",
      description: "USB DAC",
      routeKind: "alsa",
      providerTarget: "alsa/hw:2,0",
      levelMode: "variable",
      maximumSoftwareVolume: 100,
      availabilityRevision: 1,
    });
    const events: string[] = [];
    const starting = new Promise<{ sessionId: string; generation: number }>(
      (resolve) => {
        provider.subscribe((event) => {
          events.push(event.kind);
          if (event.kind === "session-starting")
            resolve({
              sessionId: event.sessionId,
              generation: event.generation,
            });
        });
      },
    );
    const grant = control(platform.controlSocket, "BEFORE 1");
    const session = await starting;
    await provider.acquire(session.sessionId, session.generation + 1);
    assert.equal(await grant, "GRANT\n");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(provider.snapshot().state, "error");
    assert.ok(events.includes("error"));
  } finally {
    await provider.shutdown();
  }
});
