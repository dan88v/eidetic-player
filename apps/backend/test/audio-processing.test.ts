import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  defaultAudioProcessingPreferences,
  defaultEqualizerBands,
  isEqualizerBandForIndex,
} from "../../../packages/shared/src/audio-processing.js";
import {
  canonicalizeAudioOutputs,
  normalizeMpvAudioOutputDevices,
} from "../../../packages/shared/src/audio-output.js";
import { PreferencesStore } from "../src/preferences/preferences-store.js";
import { AudioProcessingError } from "../src/audio-processing/audio-processing-error.js";
import { AudioProcessingService } from "../src/audio-processing/audio-processing-service.js";
import {
  buildAudioSignalPath,
  buildEideticDspFilter,
  combinedEqualizerBoostDb,
} from "../src/audio-processing/dsp-config.js";
import { MpvDspFilterAdapter } from "../src/audio-processing/mpv-dsp-filter-adapter.js";

void test("canonical output grouping keeps physical devices separate and routes explicit", () => {
  const outputs = canonicalizeAudioOutputs(
    normalizeMpvAudioOutputDevices([
      {
        name: "pipewire/alsa_output.platform-soc_sound.stereo-fallback",
        description: "Built-in Audio Stereo",
      },
      {
        name: "pulse/alsa_output.platform-soc_sound.stereo-fallback",
        description: "Built-in Audio Stereo",
      },
      {
        name: "alsa/dmix:CARD=sndrpirpidac,DEV=0",
        description: "snd_rpi_rpi_dac, RPi-DAC/Direct sample mixing device",
      },
      {
        name: "alsa/hdmi:CARD=vc4hdmi,DEV=0",
        description: "vc4-hdmi/HDMI Audio Output",
      },
    ]),
  );
  assert.equal(outputs[0]?.id, "system-default");
  assert.equal(
    outputs.find((output) => output.id === "gpio-i2s-dac")?.routes.length,
    3,
  );
  assert.equal(
    outputs.find((output) => output.id === "hdmi")?.routes.length,
    1,
  );
});

void test("headroom uses combined EQ response and the graph stays flat at defaults", () => {
  assert.equal(combinedEqualizerBoostDb(defaultEqualizerBands), 0);
  assert.equal(buildEideticDspFilter(defaultAudioProcessingPreferences), null);
  const preferences = {
    ...defaultAudioProcessingPreferences,
    audioProcessingEnabled: true,
    equalizerEnabled: true,
    equalizerBands: defaultEqualizerBands.map((band, index) => ({
      ...band,
      gainDb: index < 2 ? 6 : 0,
    })),
  };
  const boost = combinedEqualizerBoostDb(preferences.equalizerBands);
  assert.ok(boost > 6);
  const path = buildAudioSignalPath(preferences, 73);
  assert.equal(path.preampDb, -boost);
  assert.equal(path.projectedPeakGainDb, 0);
  assert.match(buildEideticDspFilter(preferences) ?? "", /@eidetic-dsp:lavfi=/);
});

void test("outer EQ bands default to shelving and can switch explicitly to bell", () => {
  assert.equal(defaultAudioProcessingPreferences.audioProcessingEnabled, false);
  assert.equal(defaultAudioProcessingPreferences.equalizerEnabled, false);
  assert.equal(defaultEqualizerBands[0]?.filterType, "low-shelf");
  assert.equal(defaultEqualizerBands[5]?.filterType, "high-shelf");
  const shelving = {
    ...defaultAudioProcessingPreferences,
    audioProcessingEnabled: true,
    equalizerEnabled: true,
    equalizerBands: defaultEqualizerBands.map((band, index) => ({
      ...band,
      gainDb: index === 0 || index === 5 ? 4 : 0,
    })),
  };
  const graph = buildEideticDspFilter(shelving) ?? "";
  assert.match(graph, /bass=f=/);
  assert.match(graph, /treble=f=/);
  const bell = {
    ...shelving,
    equalizerBands: shelving.equalizerBands.map((band, index) =>
      index === 0 || index === 5
        ? { ...band, filterType: "peaking" as const }
        : band,
    ),
  };
  const bellGraph = buildEideticDspFilter(bell) ?? "";
  assert.doesNotMatch(bellGraph, /bass=f=|treble=f=/);
  assert.equal(
    isEqualizerBandForIndex(
      { ...defaultEqualizerBands[2], filterType: "low-shelf" },
      2,
    ),
    false,
  );
});

void test("DSP adapter removes only the Eidetic label and rolls back its own filter", async () => {
  const commands: unknown[][] = [];
  let failNextAdd = false;
  const adapter = new MpvDspFilterAdapter({
    isMpvAvailable: () => true,
    commandMpv(command) {
      commands.push([...command]);
      if (failNextAdd && command[1] === "add") {
        failNextAdd = false;
        return Promise.reject(new Error("apply failed"));
      }
      return Promise.resolve(undefined);
    },
  });
  await adapter.apply("@eidetic-dsp:lavfi=[volume=-1dB]");
  failNextAdd = true;
  await assert.rejects(adapter.apply("@eidetic-dsp:lavfi=[volume=-2dB]"));
  assert.ok(
    commands.every(
      (command) =>
        command[0] !== "af" ||
        command[1] !== "remove" ||
        command[2] === "@eidetic-dsp",
    ),
  );
  assert.deepEqual(commands.at(-1), [
    "af",
    "add",
    "@eidetic-dsp:lavfi=[volume=-1dB]",
  ]);
});

void test("DSP adapter coalesces stale generations before touching MPV", async () => {
  const commands: unknown[][] = [];
  const adapter = new MpvDspFilterAdapter({
    isMpvAvailable: () => true,
    commandMpv(command) {
      commands.push([...command]);
      return Promise.resolve(undefined);
    },
  });
  const stale = adapter.apply("@eidetic-dsp:lavfi=[volume=-1dB]");
  const latest = adapter.apply("@eidetic-dsp:lavfi=[volume=-3dB]");
  await Promise.all([stale, latest]);
  assert.equal(
    commands.some((command) =>
      command.includes("@eidetic-dsp:lavfi=[volume=-1dB]"),
    ),
    false,
  );
  assert.deepEqual(commands.at(-1), [
    "af",
    "add",
    "@eidetic-dsp:lavfi=[volume=-3dB]",
  ]);
});

void test("channel graphs use normalized mono and attenuation-only balance", () => {
  const mono = buildEideticDspFilter({
    ...defaultAudioProcessingPreferences,
    audioProcessingEnabled: true,
    channelMode: "mono",
  });
  assert.match(mono ?? "", /c0=0\.5\*c0\+0\.5\*c1/);
  assert.match(mono ?? "", /c1=0\.5\*c0\+0\.5\*c1/);
  const rightBalance = buildEideticDspFilter({
    ...defaultAudioProcessingPreferences,
    audioProcessingEnabled: true,
    balanceDb: 6,
  });
  assert.match(rightBalance ?? "", /c0=0\.501187\*c0/);
  assert.match(rightBalance ?? "", /c1=1\.000000\*c1/);
});

void test("Fixed output is confirmed, safe, locked, paused, and Variable restores", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-processing-"));
  try {
    const store = new PreferencesStore(join(root, "config"));
    await store.initialize();
    const snapshot = await store.migrateLegacy({
      sourceAvailable: true,
      preferences: { volume: 72 },
    });
    const state = { volume: 72, muted: true, paused: false };
    const commands: unknown[][] = [];
    const service = new AudioProcessingService(
      {
        isMpvAvailable: () => true,
        getState: () => state,
        pauseForAudioPolicy() {
          state.paused = true;
          return Promise.resolve();
        },
        setVolume(volume) {
          state.volume = volume;
          return Promise.resolve();
        },
        setMuted(muted) {
          state.muted = muted;
          return Promise.resolve();
        },
        commandMpv(command) {
          commands.push([...command]);
          return Promise.resolve(undefined);
        },
        subscribeAudioOutputProperties() {
          return () => undefined;
        },
      },
      store,
    );
    await service.initialize(snapshot);
    await assert.rejects(
      service.patch({ changes: { outputLevelMode: "fixed" } }),
      (error: unknown) =>
        error instanceof AudioProcessingError &&
        error.code === "FIXED_OUTPUT_CONFIRMATION_REQUIRED",
    );
    const fixed = await service.patch({
      changes: { outputLevelMode: "fixed" },
      confirmFixedOutput: true,
    });
    assert.equal(fixed.pausedForFixedOutput, true);
    assert.deepEqual(state, { volume: 100, muted: false, paused: true });
    assert.equal(fixed.state.preferences.lastVariableVolume, 72);
    await assert.rejects(
      service.setVolume(20),
      (error: unknown) =>
        error instanceof AudioProcessingError && error.statusCode === 409,
    );
    await assert.rejects(service.setMuted(true));
    await service.patch({ changes: { outputLevelMode: "variable" } });
    assert.equal(state.volume, 72);
    assert.equal(state.muted, false);
    await service.patch({ changes: { maximumSoftwareVolume: 60 } });
    assert.equal(state.volume, 60);
    await service.patch({ changes: { maximumSoftwareVolume: 100 } });
    assert.equal(state.volume, 60);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("Fixed output rejects positive projected DSP gain", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-fixed-gain-"));
  try {
    const store = new PreferencesStore(join(root, "config"));
    await store.initialize();
    const snapshot = await store.migrateLegacy({
      sourceAvailable: true,
      preferences: {},
    });
    const service = new AudioProcessingService(
      {
        isMpvAvailable: () => true,
        getState: () => ({ volume: 50, muted: false, paused: true }),
        pauseForAudioPolicy() {
          return Promise.resolve();
        },
        setVolume() {
          return Promise.resolve();
        },
        setMuted() {
          return Promise.resolve();
        },
        commandMpv() {
          return Promise.resolve(undefined);
        },
        subscribeAudioOutputProperties() {
          return () => undefined;
        },
      },
      store,
    );
    await service.initialize(snapshot);
    await service.patch({
      changes: {
        audioProcessingEnabled: true,
        equalizerEnabled: true,
        headroomMode: "manual",
        manualPreampDb: 0,
        equalizerBands: defaultEqualizerBands.map((band, index) => ({
          ...band,
          gainDb: index === 0 ? 6 : 0,
        })),
      },
    });
    await assert.rejects(
      service.patch({
        changes: { outputLevelMode: "fixed" },
        confirmFixedOutput: true,
      }),
      (error: unknown) =>
        error instanceof AudioProcessingError &&
        error.code === "FIXED_OUTPUT_POSITIVE_GAIN",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("Headroom Off explicitly permits positive-gain processing in Fixed output", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-headroom-off-"));
  try {
    const store = new PreferencesStore(join(root, "config"));
    await store.initialize();
    const snapshot = await store.migrateLegacy({
      sourceAvailable: true,
      preferences: {},
    });
    const service = new AudioProcessingService(
      {
        isMpvAvailable: () => true,
        getState: () => ({ volume: 100, muted: false, paused: true }),
        pauseForAudioPolicy() {
          return Promise.resolve();
        },
        setVolume() {
          return Promise.resolve();
        },
        setMuted() {
          return Promise.resolve();
        },
        commandMpv() {
          return Promise.resolve(undefined);
        },
        subscribeAudioOutputProperties() {
          return () => undefined;
        },
      },
      store,
    );
    await service.initialize(snapshot);
    await service.patch({
      changes: { outputLevelMode: "fixed" },
      confirmFixedOutput: true,
    });
    await service.patch({
      changes: {
        equalizerEnabled: true,
        headroomMode: "off",
        equalizerBands: defaultEqualizerBands.map((band, index) => ({
          ...band,
          gainDb: index === 0 ? 6 : 0,
        })),
      },
    });
    const enabled = await service.patch({
      changes: { audioProcessingEnabled: true },
    });
    assert.equal(enabled.state.preferences.audioProcessingEnabled, true);
    assert.equal(enabled.state.signalPath.projectedPeakGainDb > 0, true);
    assert.equal(enabled.state.signalPath.warning, "positive-gain");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("Fixed positive gain asks once before enabling processing or EQ", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-gain-confirm-"));
  try {
    const store = new PreferencesStore(join(root, "config"));
    await store.initialize();
    const snapshot = await store.migrateLegacy({
      sourceAvailable: true,
      preferences: {},
    });
    const service = new AudioProcessingService(
      {
        isMpvAvailable: () => true,
        getState: () => ({ volume: 100, muted: false, paused: true }),
        pauseForAudioPolicy: () => Promise.resolve(),
        setVolume: () => Promise.resolve(),
        setMuted: () => Promise.resolve(),
        commandMpv: () => Promise.resolve(undefined),
        subscribeAudioOutputProperties: () => () => undefined,
      },
      store,
    );
    await service.initialize(snapshot);
    await service.patch({
      changes: { outputLevelMode: "fixed" },
      confirmFixedOutput: true,
    });
    const boostedBands = defaultEqualizerBands.map((band, index) => ({
      ...band,
      gainDb: index === 0 ? 6 : 0,
    }));
    await service.patch({
      changes: {
        equalizerEnabled: true,
        equalizerBands: boostedBands,
        headroomMode: "manual",
        manualPreampDb: 0,
      },
    });

    await assert.rejects(
      service.patch({ changes: { audioProcessingEnabled: true } }),
      (error: unknown) =>
        error instanceof AudioProcessingError &&
        error.code === "POSITIVE_GAIN_CONFIRMATION_REQUIRED",
    );
    const processingEnabled = await service.patch({
      changes: { audioProcessingEnabled: true },
      confirmPositiveGain: true,
    });
    assert.equal(
      processingEnabled.state.preferences.audioProcessingEnabled,
      true,
    );
    assert.equal(processingEnabled.state.signalPath.warning, "positive-gain");

    await service.patch({ changes: { equalizerEnabled: false } });
    await assert.rejects(
      service.patch({ changes: { equalizerEnabled: true } }),
      (error: unknown) =>
        error instanceof AudioProcessingError &&
        error.code === "POSITIVE_GAIN_CONFIRMATION_REQUIRED",
    );
    const equalizerEnabled = await service.patch({
      changes: { equalizerEnabled: true },
      confirmPositiveGain: true,
    });
    assert.equal(equalizerEnabled.state.preferences.equalizerEnabled, true);
    assert.equal(equalizerEnabled.state.signalPath.warning, "positive-gain");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("MPV unavailability does not block fixed-output preference bootstrap", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-audio-no-mpv-"));
  try {
    const store = new PreferencesStore(join(root, "config"));
    await store.initialize();
    const snapshot = store.snapshot();
    let mpvCommandCalls = 0;
    const service = new AudioProcessingService(
      {
        isMpvAvailable: () => false,
        getState: () => ({ volume: 100, muted: false, paused: true }),
        pauseForAudioPolicy() {
          mpvCommandCalls += 1;
          return Promise.reject(new Error("MPV unavailable"));
        },
        setVolume() {
          mpvCommandCalls += 1;
          return Promise.reject(new Error("MPV unavailable"));
        },
        setMuted() {
          mpvCommandCalls += 1;
          return Promise.reject(new Error("MPV unavailable"));
        },
        commandMpv() {
          mpvCommandCalls += 1;
          return Promise.reject(new Error("MPV unavailable"));
        },
        subscribeAudioOutputProperties() {
          return () => undefined;
        },
      },
      store,
    );

    await service.initialize({
      ...snapshot,
      preferences: {
        ...snapshot.preferences,
        outputLevelMode: "fixed",
      },
    });

    assert.equal(mpvCommandCalls, 0);
    assert.equal(service.snapshot().preferences.outputLevelMode, "fixed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
