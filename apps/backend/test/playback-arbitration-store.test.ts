import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  defaultPlaybackArbitrationDocument,
  PlaybackArbitrationStore,
} from "../src/playback-source/playback-arbitration-store.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "eidetic-arbitration-store-"));
  const path = join(root, "state", "playback-arbitration.json");
  return {
    root,
    path,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

void test("arbitration storage is absent-safe, atomic and metadata-free", async () => {
  const subject = await fixture();
  try {
    const store = new PlaybackArbitrationStore(subject.path);
    const missing = await store.load();
    assert.equal(missing.document.activeSource, "local");
    assert.equal(await readFile(subject.path, "utf8").catch(() => null), null);
    const document = {
      ...defaultPlaybackArbitrationDocument(),
      revision: 1,
      transitionGeneration: 2,
      activeSource: "spotify" as const,
      phase: "external-active" as const,
      providerSessionId: "spotify-session-test",
      localSuspensionId: "local-suspension-test",
      localSessionRevision: 7,
      localOccurrenceId: "playback-test",
      localWasPlaying: true,
      suspendedAt: "2026-08-02T00:00:00.000Z",
      lastTransitionResult: { code: "acquired", success: true },
      updatedAt: "2026-08-02T00:00:01.000Z",
    };
    await store.save(document);
    const serialized = await readFile(subject.path, "utf8");
    assert.doesNotMatch(serialized, /title|artist|album|credential|password/u);
    assert.equal(
      (await readdir(dirname(subject.path))).some((name) =>
        name.endsWith(".tmp"),
      ),
      false,
    );
    const restored = await new PlaybackArbitrationStore(subject.path).load();
    assert.deepEqual(restored.document, document);
    if (process.platform !== "win32") {
      assert.equal((await lstat(dirname(subject.path))).mode & 0o777, 0o700);
      assert.equal((await lstat(subject.path)).mode & 0o777, 0o600);
    }
  } finally {
    await subject.cleanup();
  }
});

void test("malformed and future arbitration stores degrade without overwrite", async () => {
  const malformedFixture = await fixture();
  try {
    await new PlaybackArbitrationStore(malformedFixture.path).load();
    await writeFile(malformedFixture.path, "{bad-json", "utf8");
    const store = new PlaybackArbitrationStore(malformedFixture.path);
    const malformed = await store.load();
    assert.equal(malformed.degraded, true);
    await assert.rejects(store.save(defaultPlaybackArbitrationDocument()));
    assert.equal(await readFile(malformedFixture.path, "utf8"), "{bad-json");
  } finally {
    await malformedFixture.cleanup();
  }

  const futureFixture = await fixture();
  try {
    await new PlaybackArbitrationStore(futureFixture.path).load();
    const future = JSON.stringify({
      ...defaultPlaybackArbitrationDocument(),
      schemaVersion: 2,
    });
    await writeFile(futureFixture.path, future, "utf8");
    const store = new PlaybackArbitrationStore(futureFixture.path);
    const loaded = await store.load();
    assert.equal(loaded.readOnly, true);
    assert.equal(loaded.degraded, true);
    await assert.rejects(store.save(defaultPlaybackArbitrationDocument()));
    assert.equal(await readFile(futureFixture.path, "utf8"), future);
  } finally {
    await futureFixture.cleanup();
  }
});

void test(
  "arbitration storage refuses a symbolic-link file",
  { skip: process.platform === "win32" },
  async () => {
    const subject = await fixture();
    try {
      await new PlaybackArbitrationStore(subject.path).load();
      const target = join(subject.root, "target.json");
      await writeFile(target, "{}", "utf8");
      await symlink(target, subject.path);
      await assert.rejects(new PlaybackArbitrationStore(subject.path).load());
    } finally {
      await subject.cleanup();
    }
  },
);
