import assert from "node:assert/strict";
import test from "node:test";
import { defaultUiPreferences } from "../../../packages/shared/src/preferences.js";
import {
  legacyPreferenceStorageKeys,
  readLegacyPreferences,
} from "../src/utils/storage.js";
import { PreferencesController } from "../src/state/preferences-controller.js";
import type { PreferencesTransport } from "../src/state/preferences-controller.js";
import type {
  PreferencesPatch,
  PreferencesSnapshot,
} from "../../../packages/shared/src/preferences.js";

class RecordingStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  failReads = false;
  failWrites = false;

  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    this.reads.push(key);
    if (this.failReads) throw new Error("storage unavailable");
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    if (this.failWrites) throw new Error("storage unavailable");
    this.values.set(key, value);
  }
}

function snapshot(
  revision = 1,
  changes: Partial<typeof defaultUiPreferences> = {},
): PreferencesSnapshot {
  return {
    schemaVersion: 1,
    revision,
    preferences: { ...defaultUiPreferences, ...changes },
    persistence: "persisted",
    legacyImport: "imported",
    warning: false,
  };
}

function installWindow(storage: Storage): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
      localStorage: storage,
    },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

function nextRevision(patch: PreferencesPatch): number {
  if (typeof patch.expectedRevision !== "number")
    throw new Error("fixture expected a revision");
  return patch.expectedRevision + 1;
}

void test("legacy migration reads only exact whitelist keys and maps spectrum", () => {
  const storage = new RecordingStorage();
  storage.values.set(legacyPreferenceStorageKeys.visualizerMode, "spectrum");
  storage.values.set(legacyPreferenceStorageKeys.volume, "63");
  storage.values.set(legacyPreferenceStorageKeys.repeatMode, "all");
  storage.values.set("third-party.secret", "must-not-be-read");

  const result = readLegacyPreferences(storage);
  assert.equal(result.sourceAvailable, true);
  assert.equal(result.foundKeyCount, 3);
  assert.deepEqual(result.preferences, {
    visualizerMode: "spectrumMono",
    volume: 63,
    repeatMode: "all",
  });
  assert.equal(storage.reads.includes("third-party.secret"), false);
  assert.equal(
    storage.reads.every((key) =>
      Object.values(legacyPreferenceStorageKeys).includes(
        key as (typeof legacyPreferenceStorageKeys)[keyof typeof legacyPreferenceStorageKeys],
      ),
    ),
    true,
  );
});

void test("absent and invalid legacy values do not become defaults in payload", () => {
  const storage = new RecordingStorage();
  storage.values.set(legacyPreferenceStorageKeys.volume, "");
  storage.values.set(legacyPreferenceStorageKeys.timelineStyle, "future");
  const result = readLegacyPreferences(storage);
  assert.deepEqual(result.preferences, {});
  assert.equal(result.foundKeyCount, 2);
  assert.equal(storage.writes.length, 0);
});

void test("localStorage exceptions require manual migration without enumeration", () => {
  const storage = new RecordingStorage();
  storage.failReads = true;
  const result = readLegacyPreferences(storage);
  assert.equal(result.sourceAvailable, false);
  assert.deepEqual(result.preferences, {});
  assert.equal(storage.reads.length, 1);
});

void test("preferences controller coalesces changes and flushes immediately", async () => {
  const storage = new RecordingStorage();
  const restoreWindow = installWindow(storage);
  try {
    const patches: PreferencesPatch[] = [];
    const api = {
      patch(patch: PreferencesPatch) {
        patches.push(patch);
        return Promise.resolve(snapshot(nextRevision(patch), patch.changes));
      },
      get: () => Promise.resolve(snapshot()),
    } satisfies PreferencesTransport;
    const controller = new PreferencesController(snapshot(), api, {
      debounceMs: 1_000,
      retryDelaysMs: [],
      onWarning: () => assert.fail("unexpected warning"),
    });
    controller.update({ volume: 63 });
    controller.update({ repeatMode: "all" });
    assert.equal(controller.getPreferences().volume, 63);
    assert.equal(controller.getPreferences().repeatMode, "all");
    assert.equal(controller.getSaveState(), "pending");
    assert.equal(await controller.flush(), true);
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0]?.changes, {
      volume: 63,
      repeatMode: "all",
    });
    assert.equal(controller.getSaveState(), "saved");
    controller.destroy();
  } finally {
    restoreWindow();
  }
});

void test("preferences controller bounds retries and recovers dirty fields", async () => {
  const storage = new RecordingStorage();
  const restoreWindow = installWindow(storage);
  try {
    let failuresRemaining = 4;
    let calls = 0;
    let warnings = 0;
    const api = {
      patch(patch: PreferencesPatch) {
        calls += 1;
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          return Promise.reject(new Error("fixture unavailable"));
        }
        return Promise.resolve(snapshot(nextRevision(patch), patch.changes));
      },
      get: () => Promise.resolve(snapshot()),
    } satisfies PreferencesTransport;
    const controller = new PreferencesController(snapshot(), api, {
      debounceMs: 1_000,
      retryDelaysMs: [1, 1, 1],
      onWarning: () => {
        warnings += 1;
      },
    });
    controller.update({ animationsEnabled: false });
    assert.equal(await controller.flush(), false);
    assert.equal(calls, 4);
    assert.equal(warnings, 1);
    assert.equal(controller.getPreferences().animationsEnabled, false);
    assert.equal(controller.getSaveState(), "degraded");

    controller.update({ volume: 72 });
    assert.equal(await controller.flush(), true);
    assert.equal(calls, 5);
    assert.equal(warnings, 1);
    assert.equal(controller.getSaveState(), "saved");
    controller.destroy();
  } finally {
    restoreWindow();
  }
});

void test("revision conflict reloads latest and reapplies only dirty changes", async () => {
  const storage = new RecordingStorage();
  const restoreWindow = installWindow(storage);
  try {
    const patches: PreferencesPatch[] = [];
    let conflicted = false;
    const api = {
      patch(patch: PreferencesPatch) {
        patches.push(patch);
        if (!conflicted) {
          conflicted = true;
          return Promise.reject(
            Object.assign(new Error("fixture conflict"), {
              code: "PREFERENCES_REVISION_CONFLICT",
            }),
          );
        }
        return Promise.resolve(
          snapshot(nextRevision(patch), {
            timelineStyle: "line",
            ...patch.changes,
          }),
        );
      },
      get() {
        return Promise.resolve(snapshot(7, { timelineStyle: "line" }));
      },
    } satisfies PreferencesTransport;
    const controller = new PreferencesController(snapshot(), api, {
      debounceMs: 1_000,
      retryDelaysMs: [1],
      onWarning: () => assert.fail("unexpected warning"),
    });
    controller.update({ volume: 41 });
    assert.equal(await controller.flush(), true);
    assert.equal(patches.length, 2);
    const retriedPatch = patches[1];
    assert.ok(retriedPatch);
    assert.equal(retriedPatch.expectedRevision, 7);
    assert.deepEqual(retriedPatch.changes, { volume: 41 });
    assert.equal(controller.getPreferences().timelineStyle, "line");
    assert.equal(controller.getPreferences().volume, 41);
    controller.destroy();
  } finally {
    restoreWindow();
  }
});

void test("destroy cancels a pending debounced request", async () => {
  const storage = new RecordingStorage();
  const restoreWindow = installWindow(storage);
  try {
    let calls = 0;
    const api = {
      patch() {
        calls += 1;
        return Promise.resolve(snapshot(2));
      },
      get() {
        return Promise.resolve(snapshot());
      },
    } satisfies PreferencesTransport;
    const controller = new PreferencesController(snapshot(), api, {
      debounceMs: 5,
      onWarning: () => assert.fail("unexpected warning"),
    });
    controller.update({ muted: true });
    controller.destroy();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(calls, 0);
  } finally {
    restoreWindow();
  }
});

void test("unchanged player snapshots do not create preference writes", async () => {
  const storage = new RecordingStorage();
  const restoreWindow = installWindow(storage);
  try {
    let calls = 0;
    const api = {
      patch() {
        calls += 1;
        return Promise.resolve(snapshot(2));
      },
      get: () => Promise.resolve(snapshot()),
    } satisfies PreferencesTransport;
    const controller = new PreferencesController(snapshot(), api, {
      debounceMs: 1,
      onWarning: () => assert.fail("unexpected warning"),
    });
    controller.update({
      volume: 100,
      muted: false,
      shuffleEnabled: false,
      repeatMode: "off",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, 0);
    assert.equal(controller.getSaveState(), "idle");
    controller.destroy();
  } finally {
    restoreWindow();
  }
});
