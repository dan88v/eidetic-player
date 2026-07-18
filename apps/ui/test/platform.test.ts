import assert from "node:assert/strict";
import test from "node:test";
import {
  runSingleAudioFileSelection,
  selectSingleAudioFile,
} from "../src/platform/audio-file-selection.js";
import { BrowserPlatformBridge } from "../src/platform/browser-platform-bridge.js";
import {
  initializePlatform,
  NativeShellInitializationError,
} from "../src/platform/index.js";
import { NeutralinoPlatformBridge } from "../src/platform/neutralino-platform-bridge.js";
import type {
  NeutralinoListener,
  NeutralinoRuntime,
  NeutralinoRuntimeScope,
} from "../src/platform/neutralino-runtime.js";

function createRuntime(options?: {
  readonly initError?: Error;
  readonly dialogResult?: unknown;
}): {
  readonly runtime: NeutralinoRuntime;
  readonly getInitCount: () => number;
  readonly getReadyListenerCount: () => number;
  readonly getListenerCount: (name: string) => number;
  readonly getDialogMultiple: () => boolean | undefined;
} {
  let initCount = 0;
  let dialogMultiple: boolean | undefined;
  const listeners = new Map<string, Set<NeutralinoListener>>();
  const runtime: NeutralinoRuntime = {
    init() {
      initCount += 1;
      if (options?.initError) throw options.initError;
      for (const listener of listeners.get("ready") ?? []) listener({});
    },
    os: {
      showOpenDialog: (_title, dialogOptions) => {
        dialogMultiple = dialogOptions?.multiSelections;
        return Promise.resolve(options?.dialogResult ?? []);
      },
    },
    events: {
      on(name, listener) {
        const registered = listeners.get(name) ?? new Set();
        registered.add(listener);
        listeners.set(name, registered);
      },
      off(name, listener) {
        listeners.get(name)?.delete(listener);
      },
    },
  };
  return {
    runtime,
    getInitCount: () => initCount,
    getReadyListenerCount: () => listeners.get("ready")?.size ?? 0,
    getListenerCount: (name) => listeners.get(name)?.size ?? 0,
    getDialogMultiple: () => dialogMultiple,
  };
}

function neutralinoScope(runtime: NeutralinoRuntime): NeutralinoRuntimeScope {
  return {
    Neutralino: runtime,
    NL_MODE: "window",
    NL_PORT: 54_321,
    NL_TOKEN: "header.payload.signature",
  };
}

void test("selects and initializes Neutralino exactly once when available", async () => {
  const selectedPaths = ["C:\\Music\\first.wav", "C:\\Music\\second.flac"];
  const fake = createRuntime({ dialogResult: selectedPaths });
  const scope = neutralinoScope(fake.runtime);
  const first = await initializePlatform(scope, 100);
  const second = await initializePlatform(scope, 100);
  assert.ok(first.bridge instanceof NeutralinoPlatformBridge);
  assert.ok(second.bridge instanceof NeutralinoPlatformBridge);
  assert.equal(first.diagnostics.platformBridge, "neutralino");
  assert.equal(first.diagnostics.nlMode, "window");
  assert.equal(fake.getInitCount(), 1);
  assert.equal(fake.getReadyListenerCount(), 0);
  assert.deepEqual(
    await first.bridge.openAudioFiles({ multiple: true }),
    selectedPaths,
  );
  assert.equal(fake.getDialogMultiple(), true);
});

void test("maps native dialog cancellation to an empty selection", async () => {
  const fake = createRuntime({ dialogResult: undefined });
  const platform = await initializePlatform(neutralinoScope(fake.runtime), 100);
  assert.deepEqual(
    await platform.bridge.openAudioFiles({ multiple: false }),
    [],
  );
  assert.equal(fake.getDialogMultiple(), false);
});

void test("main Open Files forwards only the ninth file selected by the UI", async () => {
  const ninth = "C:/Music/09 Track.flac";
  const fake = createRuntime({ dialogResult: [ninth] });
  const platform = await initializePlatform(neutralinoScope(fake.runtime), 100);
  const forwarded: string[][] = [];
  await runSingleAudioFileSelection(platform.bridge, (paths) => {
    forwarded.push([...paths]);
  });
  assert.deepEqual(forwarded, [[ninth]]);
  assert.deepEqual(await selectSingleAudioFile(platform.bridge), [ninth]);
  assert.equal(fake.getDialogMultiple(), false);
});

void test("registers and removes one native drop listener", async () => {
  const fake = createRuntime();
  const platform = await initializePlatform(neutralinoScope(fake.runtime), 100);
  const unsubscribe = platform.bridge.subscribeToDroppedFiles(() => undefined);
  assert.equal(fake.getListenerCount("filesDropped"), 1);
  unsubscribe();
  unsubscribe();
  assert.equal(fake.getListenerCount("filesDropped"), 0);
});

void test("selects the browser fallback when Neutralino is absent", async () => {
  const platform = await initializePlatform({}, 100);
  assert.ok(platform.bridge instanceof BrowserPlatformBridge);
  assert.equal(platform.diagnostics.platformBridge, "browser");
  assert.equal(platform.diagnostics.nlMode, null);
});

void test("rejects an incomplete Neutralino namespace instead of degrading", async () => {
  await assert.rejects(
    initializePlatform(
      {
        Neutralino: { init: () => undefined },
        NL_MODE: "window",
        NL_PORT: 54_321,
        NL_TOKEN: "header.payload.signature",
      },
      100,
    ),
    NativeShellInitializationError,
  );
});

void test("propagates Neutralino initialization failure", async () => {
  const fake = createRuntime({ initError: new Error("initialization failed") });
  await assert.rejects(
    initializePlatform(neutralinoScope(fake.runtime), 100),
    (error: unknown) =>
      error instanceof NativeShellInitializationError &&
      error.cause instanceof Error &&
      error.cause.message === "initialization failed",
  );
  assert.equal(fake.getInitCount(), 1);
  assert.equal(fake.getReadyListenerCount(), 0);
});
