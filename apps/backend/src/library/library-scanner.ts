import { setImmediate as yieldImmediate } from "node:timers/promises";
import { isSupportedAudioPath } from "../../../../packages/shared/src/audio.js";
import type { LibraryScanProgress } from "../../../../packages/shared/src/library.js";
import type { FilesystemProvider } from "../filesystem/filesystem-provider.js";
import { PathService } from "../filesystem/path-service.js";
import { SourceService } from "../filesystem/source-service.js";
import {
  emptyMetadata,
  MetadataService,
} from "../metadata/metadata-service.js";
import type { NormalizedMetadata } from "../metadata/types.js";
import { analysisConfig } from "../analysis/analysis-config.js";
import { trackIdentity } from "./library-normalization.js";
import { LibraryRepository } from "./library-repository.js";
import type {
  IndexedTrackInput,
  LibraryScanResult,
  ScanCounters,
} from "./library-types.js";

const naturalCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

const hiddenSystemNames = new Set([
  "$recycle.bin",
  "desktop.ini",
  "system volume information",
  "thumbs.db",
]);

interface PendingUnchanged {
  readonly sourceId: string;
  readonly relativePath: string;
  readonly generation: number;
  readonly seenAt: string;
}

export interface LibraryScannerOptions {
  readonly batchSize?: number;
  readonly metadata?: MetadataService;
  readonly waitForPlaybackPriority?: (signal: AbortSignal) => Promise<void>;
  readonly now?: () => Date;
}

function abortError(): DOMException {
  return new DOMException("Library scan cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,48}$/.test(code)
    ? code
    : "LIBRARY_SCAN_FAILED";
}

export class LibraryScanner {
  private readonly metadata: MetadataService;
  private readonly batchSize: number;
  private readonly waitForPlaybackPriority: (
    signal: AbortSignal,
  ) => Promise<void>;
  private readonly now: () => Date;

  constructor(
    private readonly provider: FilesystemProvider,
    private readonly paths: PathService,
    private readonly sources: SourceService,
    private readonly repository: LibraryRepository,
    options: LibraryScannerOptions = {},
  ) {
    this.metadata = options.metadata ?? new MetadataService();
    this.batchSize =
      options.batchSize ?? (analysisConfig.profile === "rpi3" ? 16 : 32);
    this.waitForPlaybackPriority =
      options.waitForPlaybackPriority ?? (() => Promise.resolve());
    this.now = options.now ?? (() => new Date());
  }

  async scan(
    sourceId: string,
    scanId: string,
    signal: AbortSignal,
    onProgress: (progress: LibraryScanProgress) => void,
  ): Promise<LibraryScanResult> {
    const startedPerformance = performance.now();
    const transactionDurations: number[] = [];
    const measureTransaction = <T>(operation: () => T): T => {
      const startedAt = performance.now();
      try {
        return operation();
      } finally {
        transactionDurations.push(performance.now() - startedAt);
      }
    };
    const run = measureTransaction(() =>
      this.repository.beginScan(scanId, sourceId, this.now().toISOString()),
    );
    const counters: ScanCounters = {
      filesDiscovered: 0,
      filesProcessed: 0,
      filesUnchanged: 0,
      filesNew: 0,
      filesModified: 0,
      filesUnavailable: 0,
      filesFailed: 0,
      totalFiles: null,
    };
    let metadataParses = 0;
    let traversalComplete = true;
    let lastProgressAt = 0;
    const pendingTracks: IndexedTrackInput[] = [];
    const pendingUnchanged: PendingUnchanged[] = [];

    const persistProgress = (
      force = false,
      status: LibraryScanProgress["status"] = "scanning",
    ): void => {
      const now = performance.now();
      if (!force && now - lastProgressAt < 125) return;
      lastProgressAt = now;
      this.repository.updateScanProgress(
        scanId,
        counters,
        status,
        this.now().toISOString(),
      );
      const progress = this.repository.progress(scanId);
      if (progress) onProgress(progress);
    };
    const flush = (): void => {
      if (pendingTracks.length === 0 && pendingUnchanged.length === 0) return;
      measureTransaction(() => {
        this.repository.applyScanBatch(pendingTracks, pendingUnchanged);
      });
      pendingTracks.length = 0;
      pendingUnchanged.length = 0;
      persistProgress();
    };
    const finishResult = (): LibraryScanResult => {
      const progress = this.repository.progress(scanId);
      if (!progress) throw new Error("Scan progress disappeared");
      const transactionTotal = transactionDurations.reduce(
        (total, duration) => total + duration,
        0,
      );
      return {
        progress,
        durationMilliseconds: performance.now() - startedPerformance,
        maximumTransactionMilliseconds:
          transactionDurations.length === 0
            ? 0
            : Math.max(...transactionDurations),
        averageTransactionMilliseconds:
          transactionDurations.length === 0
            ? 0
            : transactionTotal / transactionDurations.length,
        transactionCount: transactionDurations.length,
        metadataParses,
      };
    };

    try {
      throwIfAborted(signal);
      const source = await this.sources.getInternal(sourceId);
      const rootStatus = await this.provider
        .lstat(source.canonicalRoot)
        .catch(() => null);
      if (
        !rootStatus ||
        rootStatus.isSymbolicLink() ||
        !rootStatus.isDirectory()
      ) {
        measureTransaction(() => {
          this.repository.finishUnsuccessfulScan(
            scanId,
            sourceId,
            "source-unavailable",
            counters,
            "SOURCE_UNAVAILABLE",
            this.now().toISOString(),
          );
        });
        persistProgress(true, "source-unavailable");
        return finishResult();
      }
      try {
        await this.provider.access(source.canonicalRoot);
      } catch {
        measureTransaction(() => {
          this.repository.finishUnsuccessfulScan(
            scanId,
            sourceId,
            "source-unavailable",
            counters,
            "SOURCE_UNAVAILABLE",
            this.now().toISOString(),
          );
        });
        persistProgress(true, "source-unavailable");
        return finishResult();
      }

      const directories = [""];
      for (const relativeDirectory of directories) {
        throwIfAborted(signal);
        await this.waitForPlaybackPriority(signal);
        const nativeDirectory = this.paths.fromLogicalRelativePath(
          source.canonicalRoot,
          relativeDirectory,
        );
        let children;
        try {
          children = await this.provider.readdir(nativeDirectory);
        } catch {
          traversalComplete = false;
          counters.filesFailed += 1;
          persistProgress();
          continue;
        }
        const sorted = [...children].sort((left, right) =>
          naturalCollator.compare(left.name, right.name),
        );
        for (const child of sorted) {
          throwIfAborted(signal);
          if (
            child.name.startsWith(".") ||
            hiddenSystemNames.has(child.name.toLowerCase())
          )
            continue;
          let relativePath: string;
          try {
            relativePath = this.paths.joinLogical(
              relativeDirectory,
              child.name,
            );
          } catch {
            counters.filesFailed += 1;
            continue;
          }
          const nativePath = this.paths.fromLogicalRelativePath(
            source.canonicalRoot,
            relativePath,
          );
          let details;
          try {
            details = await this.provider.lstat(nativePath);
          } catch {
            counters.filesFailed += 1;
            continue;
          }
          if (details.isSymbolicLink()) continue;
          if (details.isDirectory()) {
            directories.push(relativePath);
            continue;
          }
          if (!details.isFile() || !isSupportedAudioPath(child.name)) continue;

          counters.filesDiscovered += 1;
          const existing = this.repository.findTrack(sourceId, relativePath);
          const unchanged =
            existing !== null &&
            existing.size === details.size &&
            existing.mtimeMs === details.mtimeMs;
          const seenAt = this.now().toISOString();
          if (unchanged) {
            pendingUnchanged.push({
              sourceId,
              relativePath,
              generation: run.generation,
              seenAt,
            });
            counters.filesProcessed += 1;
            counters.filesUnchanged += 1;
          } else {
            await this.waitForPlaybackPriority(signal);
            throwIfAborted(signal);
            let metadata: NormalizedMetadata = emptyMetadata;
            let metadataErrorCode: string | null = null;
            let artworkAvailable = false;
            try {
              const result = await this.metadata.read(nativePath);
              metadata = result.metadata;
              metadataErrorCode = result.errorCode;
              artworkAvailable = result.hasEmbeddedArtwork;
              metadataParses += 1;
            } catch (error) {
              metadataErrorCode = errorCode(error);
            }
            throwIfAborted(signal);
            if (metadataErrorCode === "ENOENT") {
              counters.filesProcessed += 1;
              counters.filesFailed += 1;
              continue;
            }
            pendingTracks.push({
              id: existing?.id ?? trackIdentity(sourceId, relativePath),
              sourceId,
              relativePath,
              filename: child.name,
              extension: this.paths.extension(child.name),
              size: details.size,
              mtimeMs: details.mtimeMs,
              generation: run.generation,
              seenAt,
              metadata,
              metadataState: metadataErrorCode ? "failed" : "parsed",
              metadataErrorCode,
              artworkAvailable,
            });
            counters.filesProcessed += 1;
            if (existing) counters.filesModified += 1;
            else counters.filesNew += 1;
            if (metadataErrorCode) counters.filesFailed += 1;
          }
          if (
            pendingTracks.length + pendingUnchanged.length >=
            this.batchSize
          ) {
            flush();
            await yieldImmediate();
          } else persistProgress();
        }
        await yieldImmediate();
      }
      flush();
      counters.totalFiles = counters.filesDiscovered;
      if (!traversalComplete) {
        measureTransaction(() => {
          this.repository.finishUnsuccessfulScan(
            scanId,
            sourceId,
            "failed",
            counters,
            "TRAVERSAL_INCOMPLETE",
            this.now().toISOString(),
          );
        });
        persistProgress(true, "failed");
        return finishResult();
      }
      counters.filesUnavailable = measureTransaction(() =>
        this.repository.completeScan(
          scanId,
          sourceId,
          run.generation,
          counters,
          this.now().toISOString(),
        ),
      );
      persistProgress(true, "completed");
      return finishResult();
    } catch (error) {
      try {
        flush();
      } catch {
        pendingTracks.length = 0;
        pendingUnchanged.length = 0;
      }
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        measureTransaction(() => {
          this.repository.finishUnsuccessfulScan(
            scanId,
            sourceId,
            "cancelled",
            counters,
            "SCAN_CANCELLED",
            this.now().toISOString(),
          );
        });
        persistProgress(true, "cancelled");
        return finishResult();
      }
      measureTransaction(() => {
        this.repository.finishUnsuccessfulScan(
          scanId,
          sourceId,
          "failed",
          counters,
          errorCode(error),
          this.now().toISOString(),
        );
      });
      persistProgress(true, "failed");
      return finishResult();
    }
  }

  clear(): void {
    this.metadata.clear();
  }
}
