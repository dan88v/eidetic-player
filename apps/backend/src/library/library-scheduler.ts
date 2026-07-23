import { randomUUID } from "node:crypto";
import { setImmediate as yieldImmediate } from "node:timers/promises";
import type {
  IndexedLibraryStatus,
  LibraryScanProgress,
} from "../../../../packages/shared/src/library.js";
import { LibraryError } from "./library-errors.js";
import { LibraryRepository } from "./library-repository.js";
import { LibraryScanner } from "./library-scanner.js";
import type { LibraryScanResult } from "./library-types.js";

export interface LibrarySchedulerDiagnostics {
  readonly active: boolean;
  readonly queued: number;
  readonly completedScans: number;
  readonly maximumConcurrentScans: number;
  readonly lastResult: LibraryScanResult | null;
  readonly lastCancelMilliseconds: number | null;
}

export class LibraryScheduler {
  private readonly queue: string[] = [];
  private active: {
    readonly sourceId: string;
    readonly scanId: string;
    readonly controller: AbortController;
  } | null = null;
  private running: Promise<void> | null = null;
  private stopping = false;
  private completedScans = 0;
  private activeScans = 0;
  private maximumConcurrentScans = 0;
  private lastResult: LibraryScanResult | null = null;
  private cancelStartedAt: number | null = null;
  private lastCancelMilliseconds: number | null = null;

  constructor(
    private readonly repository: LibraryRepository,
    private readonly scanner: LibraryScanner,
    private readonly onChange: () => void,
  ) {}

  enqueueAutomatic(sourceIds: readonly string[]): void {
    if (this.stopping) return;
    for (const sourceId of sourceIds) {
      if (this.active?.sourceId === sourceId || this.queue.includes(sourceId))
        continue;
      this.repository.markQueued(sourceId);
      this.queue.push(sourceId);
    }
    this.start();
    this.onChange();
  }

  enqueueManual(sourceIds: readonly string[]): void {
    if (this.stopping)
      throw new LibraryError(
        "LIBRARY_SHUTTING_DOWN",
        "The Library is shutting down.",
        503,
      );
    if (this.active || this.queue.length > 0)
      throw new LibraryError(
        "LIBRARY_SCAN_ACTIVE",
        "A Library scan is already active.",
        409,
      );
    if (sourceIds.length === 0)
      throw new LibraryError(
        "LIBRARY_NO_SOURCES",
        "No local folder sources are configured.",
        409,
      );
    const unique = [...new Set(sourceIds)];
    for (const sourceId of unique) {
      this.repository.markQueued(sourceId);
      this.queue.push(sourceId);
    }
    this.start();
    this.onChange();
  }

  removeQueuedSource(sourceId: string): void {
    const index = this.queue.indexOf(sourceId);
    if (index < 0) return;
    this.queue.splice(index, 1);
  }

  sourceUnavailable(sourceId: string): void {
    this.removeQueuedSource(sourceId);
    if (this.active?.sourceId !== sourceId) {
      this.onChange();
      return;
    }
    this.active.controller.abort(
      new DOMException("Library source unavailable.", "SourceUnavailableError"),
    );
    this.onChange();
  }

  cancel(scanId?: string, sourceId?: string): void {
    const active = this.active;
    if (
      !active ||
      (scanId !== undefined && active.scanId !== scanId) ||
      (sourceId !== undefined && active.sourceId !== sourceId)
    )
      throw new LibraryError(
        "LIBRARY_SCAN_NOT_ACTIVE",
        "No matching Library scan is active.",
        409,
      );
    this.cancelStartedAt = performance.now();
    this.repository.markCancelling(active.scanId, active.sourceId);
    active.controller.abort();
    this.onChange();
  }

  status(recoveryNotice: "database-rebuilt" | null): IndexedLibraryStatus {
    return {
      activeScan: this.activeProgress(),
      latestScan: this.repository.latestProgress(),
      queuedSourceIds: [...this.queue],
      recoveryNotice,
    };
  }

  getDiagnostics(): LibrarySchedulerDiagnostics {
    return {
      active: this.active !== null,
      queued: this.queue.length,
      completedScans: this.completedScans,
      maximumConcurrentScans: this.maximumConcurrentScans,
      lastResult: this.lastResult,
      lastCancelMilliseconds: this.lastCancelMilliseconds,
    };
  }

  async close(): Promise<void> {
    this.stopping = true;
    this.queue.length = 0;
    if (this.active) {
      this.repository.markCancelling(this.active.scanId, this.active.sourceId);
      this.active.controller.abort();
    }
    await this.running;
    this.scanner.clear();
  }

  private start(): void {
    if (this.running || this.stopping) return;
    this.running = this.runQueue().finally(() => {
      this.running = null;
      if (this.queue.length > 0 && !this.stopping) this.start();
    });
  }

  private async runQueue(): Promise<void> {
    await yieldImmediate();
    while (!this.stopping && this.queue.length > 0) {
      const sourceId = this.queue.shift();
      if (!sourceId) continue;
      const scanId = randomUUID();
      const controller = new AbortController();
      this.active = { sourceId, scanId, controller };
      this.activeScans += 1;
      this.maximumConcurrentScans = Math.max(
        this.maximumConcurrentScans,
        this.activeScans,
      );
      this.onChange();
      try {
        this.lastResult = await this.scanner.scan(
          sourceId,
          scanId,
          controller.signal,
          this.onChange,
        );
      } catch (error) {
        console.error(`[library] scan ${scanId} failed`, error);
      } finally {
        if (this.cancelStartedAt !== null) {
          this.lastCancelMilliseconds =
            performance.now() - this.cancelStartedAt;
          this.cancelStartedAt = null;
        }
        this.activeScans = Math.max(0, this.activeScans - 1);
        this.completedScans += 1;
        this.active = null;
        this.onChange();
      }
      await yieldImmediate();
    }
  }

  private activeProgress(): LibraryScanProgress | null {
    return this.active ? this.repository.progress(this.active.scanId) : null;
  }
}
