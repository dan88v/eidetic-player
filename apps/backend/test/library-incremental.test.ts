import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/library/library-database.js";
import { trackIdentity } from "../src/library/library-normalization.js";
import { LibraryRepository } from "../src/library/library-repository.js";
import type { IndexedTrackInput } from "../src/library/library-types.js";
import { emptyMetadata } from "../src/metadata/metadata-service.js";

const sourceA = "11111111-1111-4111-8111-111111111111";
const sourceB = "22222222-2222-4222-8222-222222222222";

function counters(discovered: number) {
  return {
    filesDiscovered: discovered,
    filesProcessed: discovered,
    filesUnchanged: 0,
    filesNew: discovered,
    filesModified: 0,
    filesUnavailable: 0,
    filesFailed: 0,
    totalFiles: discovered,
  };
}

void test("1,000 logical tracks use bounded batches and unchanged marker-only updates", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-1000-"));
  const database = await LibraryDatabase.open(join(temporary, "library.db"));
  const repository = new LibraryRepository(database);
  const now = "2026-07-19T12:00:00.000Z";
  repository.syncConfiguredSources(
    [sourceA, sourceB].map((id) => ({
      id,
      type: "local" as const,
      displayName: id === sourceA ? "A" : "B",
      nativeRoot: temporary,
      canonicalRoot: temporary,
      createdAt: now,
      updatedAt: now,
    })),
  );
  try {
    const first = repository.beginScan(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceA,
      now,
    );
    const records: IndexedTrackInput[] = Array.from(
      { length: 1_000 },
      (_, index) => {
        const relativePath = `Album ${String(Math.floor(index / 10))}/Track ${String(index).padStart(4, "0")}.mp3`;
        return {
          id: trackIdentity(sourceA, relativePath),
          sourceId: sourceA,
          relativePath,
          filename: `Track ${String(index).padStart(4, "0")}.mp3`,
          extension: "mp3",
          size: 1_000 + index,
          mtimeMs: 1_700_000_000_000 + index,
          generation: first.generation,
          seenAt: now,
          metadata: {
            ...emptyMetadata,
            title: `Track ${String(index)}`,
            artist: `Artist ${String(index % 20)}`,
            artists: [`Artist ${String(index % 20)}`],
            album: `Album ${String(Math.floor(index / 10))}`,
            albumArtist: `Artist ${String(Math.floor(index / 10) % 20)}`,
          },
          metadataState: "parsed",
          metadataErrorCode: null,
          artworkAvailable: index % 10 === 0,
        };
      },
    );
    const firstStarted = performance.now();
    for (let index = 0; index < records.length; index += 32)
      repository.applyScanBatch(records.slice(index, index + 32), []);
    repository.completeScan(
      first.scanId,
      sourceA,
      first.generation,
      counters(1_000),
      now,
    );
    const firstMilliseconds = performance.now() - firstStarted;
    assert.equal(repository.summary().trackCount, 1_000);
    assert.equal(repository.summary().albumCount, 100);
    assert.equal(repository.summary().artistCount, 20);

    const second = repository.beginScan(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sourceA,
      now,
    );
    const unchanged = records.map((record) => ({
      sourceId: sourceA,
      relativePath: record.relativePath,
      generation: second.generation,
      seenAt: now,
    }));
    const unchangedStarted = performance.now();
    for (let index = 0; index < unchanged.length; index += 32)
      repository.applyScanBatch([], unchanged.slice(index, index + 32));
    const secondCounters = {
      ...counters(1_000),
      filesNew: 0,
      filesUnchanged: 1_000,
    };
    repository.completeScan(
      second.scanId,
      sourceA,
      second.generation,
      secondCounters,
      now,
    );
    const unchangedMilliseconds = performance.now() - unchangedStarted;
    assert.equal(repository.summary().trackCount, 1_000);
    assert.equal(repository.summary().unavailableTrackCount, 0);
    assert.ok(firstMilliseconds < 10_000);
    assert.ok(unchangedMilliseconds < 10_000);

    const sameRelativePath = records[0];
    assert.ok(sameRelativePath);
    const sourceBRun = repository.beginScan(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sourceB,
      now,
    );
    repository.applyScanBatch(
      [
        {
          ...sameRelativePath,
          id: trackIdentity(sourceB, sameRelativePath.relativePath),
          sourceId: sourceB,
          generation: sourceBRun.generation,
        },
      ],
      [],
    );
    repository.completeScan(
      sourceBRun.scanId,
      sourceB,
      sourceBRun.generation,
      counters(1),
      now,
    );
    assert.equal(repository.summary().trackCount, 1_001);
    assert.notEqual(
      trackIdentity(sourceA, sameRelativePath.relativePath),
      trackIdentity(sourceB, sameRelativePath.relativePath),
    );
    assert.ok(repository.databaseSizeBytes() > 0);
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
