import type {
  IndexedLibrarySnapshot,
  LibraryCancelScanRequest,
  LibraryScanRequest,
} from "../../../../packages/shared/src/library.js";
import type { FilesystemProvider } from "../filesystem/filesystem-provider.js";
import { PathService } from "../filesystem/path-service.js";
import { SourceRepository } from "../filesystem/source-repository.js";
import { SourceService } from "../filesystem/source-service.js";
import type { PlayerService } from "../player/player-service.js";
import { LibraryDatabase, libraryDatabasePath } from "./library-database.js";
import { LibraryError } from "./library-errors.js";
import { LibraryRepository } from "./library-repository.js";
import { LibraryScanner } from "./library-scanner.js";
import { LibraryScheduler } from "./library-scheduler.js";
import type {
  LibrarySnapshotListener,
  LibraryDatabaseDiagnostics,
} from "./library-types.js";

export interface IndexedLibraryDiagnostics {
  readonly database: Omit<
    LibraryDatabaseDiagnostics,
    "path" | "recoveredCorruptPath"
  > & {
    readonly recoveredCorruptDatabase: boolean;
  };
  readonly databaseSizeBytes: number;
  readonly integrity: boolean;
  readonly interruptedScansRecovered: number;
  readonly scheduler: ReturnType<LibraryScheduler["getDiagnostics"]>;
}

export class IndexedLibraryService {
  private readonly listeners = new Set<LibrarySnapshotListener>();
  private recoveryNotice: "database-rebuilt" | null;
  private closed = false;

  private constructor(
    private readonly sourceRepository: SourceRepository,
    private readonly sources: SourceService,
    private readonly database: LibraryDatabase,
    private readonly repository: LibraryRepository,
    private readonly scheduler: LibraryScheduler,
    private readonly interruptedScansRecovered: number,
  ) {
    this.recoveryNotice = database.diagnostics.recoveredCorruptPath
      ? "database-rebuilt"
      : null;
  }

  static async create(
    provider: FilesystemProvider,
    paths: PathService,
    sourceRepository: SourceRepository,
    sources: SourceService,
    player: PlayerService,
    databasePath = libraryDatabasePath(),
  ): Promise<IndexedLibraryService> {
    const database = await LibraryDatabase.open(databasePath);
    const repository = new LibraryRepository(database);
    const interruptedScansRecovered = repository.recoverInterruptedScans();
    repository.syncConfiguredSources(await sourceRepository.list());
    let service: IndexedLibraryService | null = null;
    const scanner = new LibraryScanner(provider, paths, sources, repository, {
      waitForPlaybackPriority: (signal) =>
        player.waitForLibraryScanSlot(signal),
    });
    const scheduler = new LibraryScheduler(repository, scanner, () => {
      service?.publish();
    });
    service = new IndexedLibraryService(
      sourceRepository,
      sources,
      database,
      repository,
      scheduler,
      interruptedScansRecovered,
    );
    return service;
  }

  async startAutomaticScans(): Promise<void> {
    this.ensureOpen();
    this.repository.syncConfiguredSources(await this.sourceRepository.list());
    this.scheduler.enqueueAutomatic(
      this.repository.sourceIdsNeedingFirstScan(),
    );
  }

  async sourceAdded(sourceId: string): Promise<void> {
    this.ensureOpen();
    const record = await this.sources.getInternal(sourceId);
    this.repository.upsertConfiguredSource(record);
    if (this.repository.sourceNeedsFirstScan(sourceId))
      this.scheduler.enqueueAutomatic([sourceId]);
    this.publish();
  }

  sourceRenamed(sourceId: string, displayName: string): void {
    this.ensureOpen();
    this.repository.renameSource(sourceId, displayName);
    this.publish();
  }

  sourceRemoved(sourceId: string): void {
    this.ensureOpen();
    this.repository.markSourceRemoved(sourceId);
    this.publish();
  }

  async requestScan(
    request: LibraryScanRequest = {},
  ): Promise<IndexedLibrarySnapshot> {
    this.ensureOpen();
    const records = await this.sourceRepository.list();
    const sourceIds = request.sourceId
      ? records.some((record) => record.id === request.sourceId)
        ? [request.sourceId]
        : []
      : records.map((record) => record.id);
    if (request.sourceId && sourceIds.length === 0)
      throw new LibraryError(
        "LIBRARY_SOURCE_NOT_FOUND",
        "Library source not found.",
        404,
      );
    this.repository.syncConfiguredSources(records);
    this.scheduler.enqueueManual(sourceIds);
    return this.snapshot();
  }

  cancelScan(request: LibraryCancelScanRequest = {}): IndexedLibrarySnapshot {
    this.ensureOpen();
    this.scheduler.cancel(request.scanId, request.sourceId);
    return this.snapshot();
  }

  snapshot(): IndexedLibrarySnapshot {
    this.ensureOpen();
    return {
      summary: this.repository.summary(),
      sources: this.repository.listSources(),
      status: this.scheduler.status(this.recoveryNotice),
    };
  }

  subscribe(listener: LibrarySnapshotListener): () => void {
    this.ensureOpen();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  acknowledgeRecoveryNotice(): void {
    if (this.recoveryNotice === null) return;
    this.recoveryNotice = null;
    this.publish();
  }

  getDiagnostics(): IndexedLibraryDiagnostics {
    this.ensureOpen();
    const databaseDiagnostics = this.database.diagnostics;
    return {
      database: {
        sqliteVersion: databaseDiagnostics.sqliteVersion,
        schemaVersion: databaseDiagnostics.schemaVersion,
        journalMode: databaseDiagnostics.journalMode,
        synchronous: databaseDiagnostics.synchronous,
        foreignKeys: databaseDiagnostics.foreignKeys,
        busyTimeoutMilliseconds: databaseDiagnostics.busyTimeoutMilliseconds,
        openedInMilliseconds: databaseDiagnostics.openedInMilliseconds,
        migrationMilliseconds: databaseDiagnostics.migrationMilliseconds,
        recoveredCorruptDatabase:
          databaseDiagnostics.recoveredCorruptPath !== null,
      },
      databaseSizeBytes: this.repository.databaseSizeBytes(),
      integrity: this.database.integrityCheck(),
      interruptedScansRecovered: this.interruptedScansRecovered,
      scheduler: this.scheduler.getDiagnostics(),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.scheduler.close();
    this.listeners.clear();
    this.database.close();
  }

  private publish(): void {
    if (this.closed) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private ensureOpen(): void {
    if (this.closed)
      throw new LibraryError(
        "LIBRARY_CLOSED",
        "The Library is unavailable.",
        503,
      );
  }
}
