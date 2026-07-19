import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldImmediate } from "node:timers/promises";
import test from "node:test";
import { LibraryDatabase } from "../src/library/library-database.js";
import { LibraryError } from "../src/library/library-errors.js";
import { LibraryRepository } from "../src/library/library-repository.js";
import { LibraryScheduler } from "../src/library/library-scheduler.js";
import type { LibraryScanner } from "../src/library/library-scanner.js";
import type { LibraryScanResult } from "../src/library/library-types.js";

const sourceA = "11111111-1111-4111-8111-111111111111";
const sourceB = "22222222-2222-4222-8222-222222222222";

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for state");
    await yieldImmediate();
  }
}

void test("scheduler runs one scan, rejects concurrent manual work and cancels cooperatively", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "eidetic-library-scheduler-"));
  const database = await LibraryDatabase.open(join(temporary, "library.db"));
  const repository = new LibraryRepository(database);
  repository.syncConfiguredSources(
    [sourceA, sourceB].map((id, index) => ({
      id,
      type: "local" as const,
      displayName: `Source ${String(index + 1)}`,
      nativeRoot: temporary,
      canonicalRoot: temporary,
      createdAt: new Date(index).toISOString(),
      updatedAt: new Date(index).toISOString(),
    })),
  );
  let active = 0;
  let maximumActive = 0;
  const started: string[] = [];
  const completed: string[] = [];
  const releases = new Map<string, () => void>();
  const scanner = {
    async scan(
      sourceId: string,
      scanId: string,
      signal: AbortSignal,
    ): Promise<LibraryScanResult> {
      const run = repository.beginScan(scanId, sourceId);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      started.push(sourceId);
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          releases.delete(sourceId);
          resolve();
        };
        releases.set(sourceId, finish);
        signal.addEventListener("abort", finish, { once: true });
      });
      const counters = {
        filesDiscovered: 0,
        filesProcessed: 0,
        filesUnchanged: 0,
        filesNew: 0,
        filesModified: 0,
        filesUnavailable: 0,
        filesFailed: 0,
        totalFiles: 0,
      };
      const status = signal.aborted ? "cancelled" : "completed";
      if (status === "completed")
        repository.completeScan(scanId, sourceId, run.generation, counters);
      else
        repository.finishUnsuccessfulScan(
          scanId,
          sourceId,
          "cancelled",
          counters,
          "SCAN_CANCELLED",
        );
      active -= 1;
      completed.push(sourceId);
      const progress = repository.progress(scanId);
      assert.ok(progress);
      return {
        progress,
        durationMilliseconds: 1,
        maximumTransactionMilliseconds: 1,
        averageTransactionMilliseconds: 1,
        transactionCount: 1,
        metadataParses: 0,
      };
    },
    clear() {
      // No test metadata cache.
    },
  } as unknown as LibraryScanner;
  const scheduler = new LibraryScheduler(repository, scanner, () => undefined);
  try {
    scheduler.enqueueAutomatic([sourceA, sourceB]);
    await waitFor(() => started.length === 1);
    assert.equal(started[0], sourceA);
    assert.throws(
      () => {
        scheduler.enqueueManual([sourceB]);
      },
      (error: unknown) =>
        error instanceof LibraryError && error.code === "LIBRARY_SCAN_ACTIVE",
    );
    releases.get(sourceA)?.();
    await waitFor(() => started.length === 2);
    assert.equal(started[1], sourceB);
    assert.equal(maximumActive, 1);
    scheduler.cancel(undefined, sourceB);
    await waitFor(() => completed.length === 2);
    assert.equal(repository.listSources()[1]?.scanStatus, "cancelled");
    assert.equal(scheduler.getDiagnostics().maximumConcurrentScans, 1);
    assert.ok((scheduler.getDiagnostics().lastCancelMilliseconds ?? -1) >= 0);
    await scheduler.close();
    assert.equal(scheduler.getDiagnostics().active, false);
  } finally {
    await scheduler.close();
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
