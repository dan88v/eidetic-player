import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultUiPreferences } from "../../../packages/shared/src/preferences.js";
import {
  PreferencesError,
  PreferencesStore,
} from "../src/preferences/preferences-store.js";

async function fixture(): Promise<{
  readonly root: string;
  readonly cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "eidetic-preferences-"));
  return {
    root: join(root, "config"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

void test("missing store stays in-memory until safe migration", async () => {
  const testFixture = await fixture();
  try {
    const store = new PreferencesStore(testFixture.root);
    const initial = await store.initialize();
    assert.equal(initial.persistence, "defaults");
    assert.equal(initial.legacyImport, "required");
    assert.equal(initial.preferences.continuePlaybackMode, "off");
    assert.deepEqual(initial.preferences, defaultUiPreferences);
    assert.equal(
      await readFile(join(testFixture.root, "preferences.json"), "utf8").catch(
        () => null,
      ),
      null,
    );

    const migrated = await store.migrateLegacy({
      sourceAvailable: true,
      preferences: {
        visualizerMode: "spectrumStereo",
        volume: 63,
        repeatMode: "all",
      },
    });
    assert.equal(migrated.legacyImport, "imported");
    assert.equal(migrated.preferences.visualizerMode, "spectrumStereo");
    assert.equal(migrated.preferences.volume, 63);
    assert.equal(migrated.revision, 1);

    const duplicate = await store.migrateLegacy({
      sourceAvailable: true,
      preferences: { volume: 10 },
    });
    assert.equal(duplicate.revision, 1);
    assert.equal(duplicate.preferences.volume, 63);
  } finally {
    await testFixture.cleanup();
  }
});

void test("continue playback is an additive schema-3 preference with an Off default", async () => {
  const testFixture = await fixture();
  try {
    await mkdir(testFixture.root, { recursive: true });
    const previousPreferences: Record<string, unknown> = {
      ...defaultUiPreferences,
      futurePreference: { preserved: true },
    };
    delete previousPreferences.continuePlaybackMode;
    await writeFile(
      join(testFixture.root, "preferences.json"),
      JSON.stringify({
        schemaVersion: 3,
        revision: 4,
        preferences: previousPreferences,
        migration: {
          legacyLocalStorage: "imported",
          sourceSchema: 3,
          futureMigrationField: "keep",
        },
        futureTopLevel: 42,
      }),
    );

    const store = new PreferencesStore(testFixture.root);
    const initial = await store.initialize();
    assert.equal(initial.schemaVersion, 3);
    assert.equal(initial.preferences.continuePlaybackMode, "off");

    const saved = await store.patch({
      expectedRevision: initial.revision,
      changes: { continuePlaybackMode: "same-artist" },
    });
    assert.equal(saved.schemaVersion, 3);
    assert.equal(saved.preferences.continuePlaybackMode, "same-artist");

    await assert.rejects(
      store.patch({
        expectedRevision: saved.revision,
        changes: { continuePlaybackMode: "album" } as never,
      }),
      { code: "INVALID_PREFERENCES_PATCH", statusCode: 400 },
    );

    const reopened = new PreferencesStore(testFixture.root);
    const restored = await reopened.initialize();
    assert.equal(restored.preferences.continuePlaybackMode, "same-artist");
    const raw = JSON.parse(
      await readFile(join(testFixture.root, "preferences.json"), "utf8"),
    ) as {
      schemaVersion: number;
      preferences: Record<string, unknown>;
      migration: Record<string, unknown>;
      futureTopLevel: number;
    };
    assert.equal(raw.schemaVersion, 3);
    assert.deepEqual(raw.preferences.futurePreference, { preserved: true });
    assert.equal(raw.migration.futureMigrationField, "keep");
    assert.equal(raw.futureTopLevel, 42);
  } finally {
    await testFixture.cleanup();
  }
});

void test("a genuinely new profile records legacy not-found", async () => {
  const testFixture = await fixture();
  try {
    const store = new PreferencesStore(testFixture.root);
    await store.initialize();
    const migrated = await store.migrateLegacy({
      sourceAvailable: true,
      preferences: {},
    });
    assert.equal(migrated.legacyImport, "not-found");
    assert.equal(migrated.persistence, "persisted");
  } finally {
    await testFixture.cleanup();
  }
});

void test("display preferences migrate with safe defaults and reject inverted timeouts", async () => {
  const testFixture = await fixture();
  try {
    const store = new PreferencesStore(testFixture.root);
    await store.initialize();
    const migrated = await store.migrateLegacy({
      sourceAvailable: true,
      preferences: {},
    });
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.preferences.screenDimTimeoutSeconds, 0);
    assert.equal(migrated.preferences.screenDimLevelPercent, 20);
    assert.equal(migrated.preferences.screenStandbyTimeoutSeconds, 0);

    const lowDim = await store.patch({
      expectedRevision: migrated.revision,
      changes: { screenDimLevelPercent: 5 },
    });
    assert.equal(lowDim.preferences.screenDimLevelPercent, 5);
    const dimmed = await store.patch({
      expectedRevision: lowDim.revision,
      changes: { screenDimTimeoutSeconds: 300 },
    });
    await assert.rejects(
      store.patch({
        expectedRevision: dimmed.revision,
        changes: { screenStandbyTimeoutSeconds: 300 },
      }),
      { code: "INVALID_PREFERENCES_PATCH", statusCode: 400 },
    );
    const valid = await store.patch({
      expectedRevision: dimmed.revision,
      changes: { screenStandbyTimeoutSeconds: 600 },
    });
    assert.equal(valid.preferences.screenStandbyTimeoutSeconds, 600);
  } finally {
    await testFixture.cleanup();
  }
});

void test("atomic patch preserves unknown and invalid raw fields", async () => {
  const testFixture = await fixture();
  try {
    await mkdir(testFixture.root, { recursive: true });
    await writeFile(
      join(testFixture.root, "preferences.json"),
      JSON.stringify({
        schemaVersion: 1,
        revision: 7,
        preferences: {
          ...defaultUiPreferences,
          visualizerMode: "future-visualizer",
          futurePreference: { enabled: true },
        },
        migration: {
          legacyLocalStorage: "imported",
          sourceSchema: 1,
          futureMigrationField: "keep",
        },
        futureTopLevel: 42,
      }),
    );
    const store = new PreferencesStore(testFixture.root);
    const initial = await store.initialize();
    assert.equal(initial.preferences.visualizerMode, "meter");
    assert.equal(initial.warning, true);

    const saved = await store.patch({
      expectedRevision: 7,
      changes: { volume: 51 },
    });
    assert.equal(saved.revision, 8);
    assert.equal(saved.preferences.volume, 51);
    const raw = JSON.parse(
      await readFile(join(testFixture.root, "preferences.json"), "utf8"),
    ) as {
      schemaVersion: number;
      preferences: Record<string, unknown>;
      migration: Record<string, unknown>;
      futureTopLevel: number;
    };
    assert.equal(raw.schemaVersion, 3);
    assert.equal(saved.preferences.outputLevelMode, "variable");
    assert.equal(saved.preferences.equalizerBands.length, 6);
    assert.equal(raw.preferences.visualizerMode, "future-visualizer");
    assert.deepEqual(raw.preferences.futurePreference, { enabled: true });
    assert.equal(raw.migration.futureMigrationField, "keep");
    assert.equal(raw.futureTopLevel, 42);
    assert.equal(
      (await readdir(testFixture.root)).some((name) => name.endsWith(".tmp")),
      false,
    );
  } finally {
    await testFixture.cleanup();
  }
});

void test("revision conflicts are explicit and concurrent writes serialize", async () => {
  const testFixture = await fixture();
  try {
    const store = new PreferencesStore(testFixture.root);
    await store.initialize();
    await store.migrateLegacy({
      sourceAvailable: false,
      preferences: {},
    });
    const revision = store.snapshot().revision;
    const results = await Promise.allSettled([
      store.patch({
        expectedRevision: revision,
        changes: { animationsEnabled: false },
      }),
      store.patch({
        expectedRevision: revision,
        changes: { volume: 25 },
      }),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    assert.ok(rejected);
    assert.ok(rejected.reason instanceof PreferencesError);
    assert.equal(rejected.reason.code, "PREFERENCES_REVISION_CONFLICT");
  } finally {
    await testFixture.cleanup();
  }
});

void test("valid backup recovers without overwriting corrupt evidence", async () => {
  const testFixture = await fixture();
  try {
    const store = new PreferencesStore(testFixture.root);
    await store.initialize();
    await store.migrateLegacy({
      sourceAvailable: true,
      preferences: { volume: 44 },
    });
    await store.patch({
      expectedRevision: 1,
      changes: { muted: true },
    });
    await writeFile(
      join(testFixture.root, "preferences.json"),
      "{not-json",
      "utf8",
    );

    const recovered = new PreferencesStore(testFixture.root);
    const snapshot = await recovered.initialize();
    assert.equal(snapshot.persistence, "recovered");
    assert.equal(snapshot.preferences.volume, 44);
    assert.equal(snapshot.preferences.muted, false);
    assert.equal(
      await readFile(join(testFixture.root, "preferences.json"), "utf8"),
      "{not-json",
    );
  } finally {
    await testFixture.cleanup();
  }
});

void test("future schema is preserved in degraded read-only mode", async () => {
  const testFixture = await fixture();
  try {
    await mkdir(testFixture.root, { recursive: true });
    const future = JSON.stringify({
      schemaVersion: 4,
      revision: 9,
      preferences: { volume: 12, futureSetting: true },
      migration: { legacyLocalStorage: "imported", sourceSchema: 4 },
    });
    await writeFile(join(testFixture.root, "preferences.json"), future, "utf8");
    const store = new PreferencesStore(testFixture.root);
    const snapshot = await store.initialize();
    assert.equal(snapshot.persistence, "degraded");
    await assert.rejects(
      store.patch({ changes: { volume: 20 } }),
      (error: unknown) =>
        error instanceof PreferencesError &&
        error.code === "PREFERENCES_READ_ONLY",
    );
    assert.equal(
      await readFile(join(testFixture.root, "preferences.json"), "utf8"),
      future,
    );
  } finally {
    await testFixture.cleanup();
  }
});

void test("one config root survives release switch, restart, and no-op", async () => {
  const testFixture = await fixture();
  try {
    const firstRelease = new PreferencesStore(testFixture.root);
    await firstRelease.initialize();
    const imported = await firstRelease.migrateLegacy({
      sourceAvailable: true,
      preferences: {
        mainPlayerMode: "cassette",
        folderViewMode: "list",
        onScreenKeyboardMode: "always",
      },
    });

    const nextRelease = new PreferencesStore(testFixture.root);
    const afterUpdate = await nextRelease.initialize();
    assert.deepEqual(afterUpdate.preferences, imported.preferences);
    assert.equal(afterUpdate.revision, imported.revision);

    const afterServiceRestart = new PreferencesStore(testFixture.root);
    const restarted = await afterServiceRestart.initialize();
    assert.deepEqual(restarted.preferences, imported.preferences);
    assert.equal(restarted.revision, imported.revision);

    const previousRelease = new PreferencesStore(testFixture.root);
    const afterRollback = await previousRelease.initialize();
    assert.deepEqual(afterRollback.preferences, imported.preferences);
    assert.equal(afterRollback.revision, imported.revision);
  } finally {
    await testFixture.cleanup();
  }
});

void test("manual migration requires confirmation and rejects secret fields", async () => {
  const testFixture = await fixture();
  try {
    const store = new PreferencesStore(testFixture.root);
    await store.initialize();
    const pending = await store.migrateLegacy({
      sourceAvailable: false,
      preferences: {},
    });
    assert.equal(pending.legacyImport, "manual-required");
    await assert.rejects(
      store.migrateLegacy({
        sourceAvailable: true,
        preferences: { volume: 63 },
      }),
      (error: unknown) =>
        error instanceof PreferencesError &&
        error.code === "PREFERENCES_MIGRATION_CONFIRMATION_REQUIRED",
    );
    await assert.rejects(
      store.migrateLegacy({
        sourceAvailable: true,
        confirmOverwrite: true,
        preferences: { password: "not-allowed" } as never,
      }),
      (error: unknown) =>
        error instanceof PreferencesError &&
        error.code === "INVALID_PREFERENCES_PATCH",
    );
    const imported = await store.migrateLegacy({
      sourceAvailable: true,
      confirmOverwrite: true,
      preferences: { volume: 63 },
    });
    assert.equal(imported.legacyImport, "manual");
    assert.equal(imported.preferences.volume, 63);
  } finally {
    await testFixture.cleanup();
  }
});

void test("schema zero migrates in memory and filesystem modes are private", async () => {
  const testFixture = await fixture();
  try {
    await mkdir(testFixture.root, { recursive: true });
    await writeFile(
      join(testFixture.root, "preferences.json"),
      JSON.stringify({
        schemaVersion: 0,
        revision: 3,
        preferences: { volume: 37 },
      }),
    );
    if (process.platform !== "win32") {
      await chmod(testFixture.root, 0o775);
      await chmod(join(testFixture.root, "preferences.json"), 0o644);
    }
    const store = new PreferencesStore(testFixture.root);
    const snapshot = await store.initialize();
    assert.equal(snapshot.preferences.volume, 37);
    assert.equal(snapshot.legacyImport, "imported");
    await store.patch({
      expectedRevision: 3,
      changes: { muted: true },
    });
    if (process.platform !== "win32") {
      assert.equal((await lstat(testFixture.root)).mode & 0o777, 0o700);
      assert.equal(
        (await lstat(join(testFixture.root, "preferences.json"))).mode & 0o777,
        0o600,
      );
    }
  } finally {
    await testFixture.cleanup();
  }
});

void test(
  "symlink config roots degrade without following the link",
  { skip: process.platform === "win32" },
  async () => {
    const testFixture = await fixture();
    try {
      const target = `${testFixture.root}-target`;
      await mkdir(target, { recursive: true });
      await symlink(target, testFixture.root, "dir");
      const store = new PreferencesStore(testFixture.root);
      const snapshot = await store.initialize();
      assert.equal(snapshot.persistence, "degraded");
      assert.equal(
        await readFile(join(target, "preferences.json"), "utf8").catch(
          () => null,
        ),
        null,
      );
    } finally {
      await testFixture.cleanup();
      await rm(`${testFixture.root}-target`, { recursive: true, force: true });
    }
  },
);
