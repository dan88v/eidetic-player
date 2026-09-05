import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AudioOutputState } from "../../../packages/shared/src/audio-output.js";
import { defaultDisplaySnapshot } from "../../../packages/shared/src/display.js";
import {
  DisplayPowerService,
  type DisplayScheduler,
} from "../src/display/display-power-service.js";
import type {
  DisplayPlatformAdapter,
  DisplayPlatformCapabilities,
} from "../src/display/display-platform-adapter.js";
import {
  LinuxDisplayPlatformAdapter,
  parseWlrRandrOutput,
  type DisplayExecFile,
} from "../src/display/linux-display-platform-adapter.js";

class RecordingAdapter implements DisplayPlatformAdapter {
  readonly calls: string[] = [];
  capabilities: DisplayPlatformCapabilities = {
    dimMethod: "software",
    standbyMethod: "fixture",
    standbyAvailable: true,
  };

  probe(): Promise<DisplayPlatformCapabilities> {
    this.calls.push("probe");
    return Promise.resolve(this.capabilities);
  }
  dim(level: number): Promise<void> {
    this.calls.push(`dim:${String(level)}`);
    return Promise.resolve();
  }
  standby(): Promise<void> {
    this.calls.push("standby");
    return Promise.resolve();
  }
  wake(): Promise<void> {
    this.calls.push("wake");
    return Promise.resolve();
  }
}

function scheduler(): DisplayScheduler {
  return {
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    sleep: () => Promise.resolve(),
  };
}

function audioState(physicalOutputId: string | null): AudioOutputState {
  return {
    selectedPhysicalOutputId: physicalOutputId,
  } as AudioOutputState;
}

void test("display service probes, dims, enters standby, and wakes", async () => {
  const adapter = new RecordingAdapter();
  const service = new DisplayPowerService(adapter, scheduler());
  const initialized = await service.initialize();
  assert.equal(initialized.state, "active");
  assert.deepEqual(adapter.calls, ["probe", "wake"]);

  assert.equal((await service.dim(20)).state, "dimmed");
  assert.equal((await service.standby()).state, "standby");
  assert.equal((await service.wake()).state, "active");
  assert.deepEqual(adapter.calls, [
    "probe",
    "wake",
    "dim:20",
    "standby",
    "wake",
  ]);
});

void test("display service publishes state changes for the existing local SSE", async () => {
  const adapter = new RecordingAdapter();
  const service = new DisplayPowerService(adapter, scheduler());
  const states: string[] = [];
  const unsubscribe = service.subscribe((snapshot) => {
    states.push(snapshot.state);
  });
  await service.initialize();
  await service.dim(20);
  await service.wake();
  unsubscribe();
  await service.dim(20);
  assert.deepEqual(states, [
    "transitioning",
    "active",
    "transitioning",
    "dimmed",
    "transitioning",
    "active",
  ]);
});

void test("HDMI audio inhibits standby without invoking the adapter", async () => {
  const adapter = new RecordingAdapter();
  const service = new DisplayPowerService(adapter, scheduler());
  await service.initialize();
  service.setAudioOutputState(audioState("hdmi"));
  await assert.rejects(service.standby(), {
    code: "DISPLAY_STANDBY_INHIBITED",
  });
  assert.equal(service.snapshot().standbyInhibitedReason, "hdmi-audio-active");
  assert.equal(adapter.calls.includes("standby"), false);
  service.setAudioOutputState(audioState("gpio-i2s-dac"));
  assert.equal(service.snapshot().standbyInhibitedReason, null);
});

void test("standby is rejected when the platform has no real method", async () => {
  const adapter = new RecordingAdapter();
  adapter.capabilities = {
    ...defaultDisplaySnapshot,
    dimMethod: "software",
    standbyMethod: "none",
    standbyAvailable: false,
  };
  const service = new DisplayPowerService(adapter, scheduler());
  await service.initialize();
  await assert.rejects(service.standby(), {
    code: "DISPLAY_STANDBY_UNAVAILABLE",
  });
});

void test("wlr-randr discovery accepts exactly one enabled output", async () => {
  assert.deepEqual(
    parseWlrRandrOutput('HDMI-A-1 "display"\n  Enabled: yes\n  Modes:\n'),
    [{ name: "HDMI-A-1", enabled: true }],
  );
  const recorded: string[][] = [];
  let enabled = true;
  const execFile: DisplayExecFile = (_path, arguments_) => {
    recorded.push([...arguments_]);
    if (arguments_.at(-1) === "--off") enabled = false;
    if (arguments_.at(-1) === "--on") enabled = true;
    return Promise.resolve({
      stdout: `HDMI-A-1 "display"\n  Enabled: ${enabled ? "yes" : "no"}\n`,
    });
  };
  const adapter = new LinuxDisplayPlatformAdapter({
    environment: {
      XDG_SESSION_TYPE: "wayland",
      WAYLAND_DISPLAY: "wayland-0",
    },
    discoverBacklight: () => Promise.resolve(null),
    executable: () => Promise.resolve(true),
    execFile,
  });
  const capabilities = await adapter.probe();
  assert.equal(capabilities.standbyMethod, "wayland-output");
  await adapter.standby();
  await adapter.wake();
  assert.deepEqual(recorded, [
    [],
    ["--output", "HDMI-A-1", "--off"],
    [],
    ["--output", "HDMI-A-1", "--on"],
  ]);
});

void test("wake accepts an externally restored Wayland output without a redundant modeset", async () => {
  const recorded: string[][] = [];
  let enabled = false;
  const execFile: DisplayExecFile = (_path, arguments_) => {
    recorded.push([...arguments_]);
    if (arguments_.length === 0)
      return Promise.resolve({
        stdout: `HDMI-A-1 "display"\n  Enabled: ${enabled ? "yes" : "no"}\n`,
      });
    if (arguments_.at(-1) === "--off") enabled = false;
    if (arguments_.at(-1) === "--on") enabled = true;
    return Promise.resolve({ stdout: "" });
  };
  const adapter = new LinuxDisplayPlatformAdapter({
    environment: {
      XDG_SESSION_TYPE: "wayland",
      WAYLAND_DISPLAY: "wayland-0",
    },
    discoverBacklight: () => Promise.resolve(null),
    executable: () => Promise.resolve(true),
    execFile,
  });
  await adapter.probe();
  enabled = true;
  await adapter.wake();
  assert.deepEqual(recorded, [[], []]);
});

void test("wake reconciles an output enabled while its modeset command fails", async () => {
  const recorded: string[][] = [];
  let reads = 0;
  const execFile: DisplayExecFile = (_path, arguments_) => {
    recorded.push([...arguments_]);
    if (arguments_.length === 0) {
      reads += 1;
      return Promise.resolve({
        stdout: `HDMI-A-1 "display"\n  Enabled: ${reads >= 3 ? "yes" : "no"}\n`,
      });
    }
    return Promise.reject(new Error("topology changed"));
  };
  const adapter = new LinuxDisplayPlatformAdapter({
    environment: {
      XDG_SESSION_TYPE: "wayland",
      WAYLAND_DISPLAY: "wayland-0",
    },
    discoverBacklight: () => Promise.resolve(null),
    executable: () => Promise.resolve(true),
    execFile,
  });
  await adapter.probe();
  await adapter.wake();
  assert.deepEqual(recorded, [[], [], ["--output", "HDMI-A-1", "--on"], []]);
});

void test("wake fails closed when the refreshed Wayland topology is ambiguous", async () => {
  const recorded: string[][] = [];
  let probeComplete = false;
  const execFile: DisplayExecFile = (_path, arguments_) => {
    recorded.push([...arguments_]);
    if (!probeComplete) {
      probeComplete = true;
      return Promise.resolve({
        stdout: 'HDMI-A-1 "display"\n  Enabled: yes\n',
      });
    }
    return Promise.resolve({
      stdout:
        'HDMI-A-1 "display"\n  Enabled: yes\nHDMI-A-2 "display"\n  Enabled: yes\n',
    });
  };
  const adapter = new LinuxDisplayPlatformAdapter({
    environment: {
      XDG_SESSION_TYPE: "wayland",
      WAYLAND_DISPLAY: "wayland-0",
    },
    discoverBacklight: () => Promise.resolve(null),
    executable: () => Promise.resolve(true),
    execFile,
  });
  await adapter.probe();
  await assert.rejects(
    adapter.wake(),
    /display output topology is unavailable or ambiguous/u,
  );
  assert.deepEqual(recorded, [[], []]);
});

void test("wlr-randr standby stays unavailable for ambiguous outputs", async () => {
  const execFile: DisplayExecFile = () =>
    Promise.resolve({
      stdout: "HDMI-A-1\n  Enabled: yes\nDSI-1\n  Enabled: yes\n",
    });
  const adapter = new LinuxDisplayPlatformAdapter({
    environment: {
      XDG_SESSION_TYPE: "wayland",
      WAYLAND_DISPLAY: "wayland-0",
    },
    discoverBacklight: () => Promise.resolve(null),
    executable: () => Promise.resolve(true),
    execFile,
  });
  assert.equal((await adapter.probe()).standbyAvailable, false);
});

void test("hardware dim clamps low values and restores exact active brightness", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-display-"));
  const brightnessPath = join(root, "brightness");
  try {
    await writeFile(brightnessPath, "73\n", "utf8");
    const adapter = new LinuxDisplayPlatformAdapter({
      environment: {},
      discoverBacklight: () =>
        Promise.resolve({
          brightnessPath,
          maximum: 255,
          activeBrightness: 73,
        }),
      executable: () => Promise.resolve(false),
    });
    assert.equal((await adapter.probe()).dimMethod, "hardware-backlight");
    await adapter.dim(10);
    assert.equal((await readFile(brightnessPath, "utf8")).trim(), "26");
    await adapter.standby();
    assert.equal((await readFile(brightnessPath, "utf8")).trim(), "0");
    await adapter.wake();
    assert.equal((await readFile(brightnessPath, "utf8")).trim(), "73");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("display service reports output-off failure without declaring standby", async () => {
  const adapter = new RecordingAdapter();
  adapter.standby = () => Promise.reject(new Error("permission denied"));
  const service = new DisplayPowerService(adapter, scheduler());
  await service.initialize();
  await service.dim(20);
  await assert.rejects(service.standby(), {
    code: "DISPLAY_STANDBY_FAILED",
  });
  assert.equal(service.snapshot().state, "dimmed");
  assert.equal(service.snapshot().lastErrorCode, "standby-failed");
});

void test("startup restore retries transient output-on failures", async () => {
  const adapter = new RecordingAdapter();
  let attempts = 0;
  adapter.wake = () => {
    attempts += 1;
    return attempts < 3
      ? Promise.reject(new Error("transient"))
      : Promise.resolve();
  };
  const service = new DisplayPowerService(adapter, scheduler());
  assert.equal((await service.initialize()).state, "active");
  assert.equal(attempts, 3);
});
