import type {
  IndexedLibrarySnapshot,
  LibraryAlbumDetail,
  LibraryArtistDetail,
  LibraryCancelScanRequest,
  LibraryPage,
  LibraryAlbum,
  LibraryArtist,
  LibraryScanRequest,
  LibraryTrack,
  LibraryCategorySearchResults,
  LibraryGroupedSearchResults,
  LibrarySearchCategory,
  FavoriteTrackPage,
  FavoriteTrackMutationResponse,
} from "../../../../packages/shared/src/library.js";
import type { FilesystemProvider } from "../filesystem/filesystem-provider.js";
import { PathService } from "../filesystem/path-service.js";
import { SourceRepository } from "../filesystem/source-repository.js";
import { SourceService } from "../filesystem/source-service.js";
import type { PlayerService } from "../player/player-service.js";
import type { PersistedQueueOrigin } from "../player-session/player-session-types.js";
import { LibraryDatabase, libraryDatabasePath } from "./library-database.js";
import { LibraryError } from "./library-errors.js";
import { LibraryRepository } from "./library-repository.js";
import { LibraryScanner } from "./library-scanner.js";
import { LibraryScheduler } from "./library-scheduler.js";
import { normalizeLibrarySearchKey } from "./library-normalization.js";
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

export interface ResolvedLibraryContext {
  readonly paths: readonly string[];
  readonly origins: readonly PersistedQueueOrigin[];
  readonly selectedIndex: number;
  readonly trackIds: readonly string[];
}

const MIN_PAGE_LIMIT = 1;
export const DEFAULT_LIBRARY_PAGE_LIMIT = 48;
export const MAX_LIBRARY_PAGE_LIMIT = 100;
export const DEFAULT_LIBRARY_SEARCH_GROUP_LIMITS = {
  artists: 5,
  albums: 6,
  tracks: 8,
} as const;

export class IndexedLibraryService {
  private readonly listeners = new Set<LibrarySnapshotListener>();
  private recoveryNotice: "database-rebuilt" | null;
  private closed = false;

  private constructor(
    private readonly provider: FilesystemProvider,
    private readonly paths: PathService,
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
      provider,
      paths,
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
    this.scheduler.removeQueuedSource(sourceId);
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

  albums(
    cursor: string | null,
    limit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): LibraryPage<LibraryAlbum> {
    this.ensureOpen();
    return this.repository.albums(cursor, this.pageLimit(limit));
  }

  album(albumId: string): LibraryAlbumDetail {
    this.ensureOpen();
    const detail = this.repository.album(albumId);
    if (!detail)
      throw new LibraryError(
        "LIBRARY_ALBUM_NOT_FOUND",
        "This album is no longer in the Library.",
        404,
      );
    return detail;
  }

  artists(
    cursor: string | null,
    limit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): LibraryPage<LibraryArtist> {
    this.ensureOpen();
    return this.repository.artists(cursor, this.pageLimit(limit));
  }

  artist(
    artistId: string,
    trackCursor: string | null,
    trackLimit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): LibraryArtistDetail {
    this.ensureOpen();
    const detail = this.repository.artist(
      artistId,
      trackCursor,
      this.pageLimit(trackLimit),
    );
    if (!detail)
      throw new LibraryError(
        "LIBRARY_ARTIST_NOT_FOUND",
        "This artist is no longer in the Library.",
        404,
      );
    return detail;
  }

  tracks(
    cursor: string | null,
    limit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): LibraryPage<LibraryTrack> {
    this.ensureOpen();
    return this.repository.tracks(cursor, this.pageLimit(limit));
  }

  favoriteTracks(
    cursor: string | null,
    limit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): FavoriteTrackPage {
    this.ensureOpen();
    return this.repository.favoriteTracks(cursor, this.pageLimit(limit));
  }

  favoriteTrackIds(trackIds: readonly string[]): readonly string[] {
    this.ensureOpen();
    if (
      trackIds.length > 192 ||
      trackIds.some((id) => !/^track-[0-9a-f]{32}$/.test(id))
    )
      throw new LibraryError(
        "INVALID_LIBRARY_FAVORITE_STATUS",
        "Select up to 192 valid Library tracks.",
      );
    return this.repository.favoriteTrackIds(trackIds);
  }

  addFavoriteTrack(trackId: string): FavoriteTrackMutationResponse {
    this.ensureOpen();
    const result = this.repository.addFavoriteTrack(trackId);
    if (!result)
      throw new LibraryError(
        "LIBRARY_TRACK_NOT_FOUND",
        "This track is no longer in the Library.",
        404,
      );
    return result;
  }

  removeFavoriteTrack(trackId: string): FavoriteTrackMutationResponse {
    this.ensureOpen();
    return this.repository.removeFavoriteTrack(trackId);
  }

  async resolveFavorites(
    selectedTrackId?: string,
    expectedFingerprint?: string,
  ): Promise<ResolvedLibraryContext> {
    this.ensureOpen();
    const before = this.repository.catalogFingerprint();
    if (expectedFingerprint && expectedFingerprint !== before)
      throw new LibraryError(
        "LIBRARY_CONTEXT_CHANGED",
        "The Library changed while preparing playback. Try again.",
        409,
      );
    const records = this.repository.favoriteContextTracks();
    if (
      selectedTrackId &&
      !records.some((record) => record.id === selectedTrackId)
    )
      throw new LibraryError(
        "LIBRARY_TRACK_UNAVAILABLE",
        "This track is no longer available.",
        409,
      );
    const resolved = await this.resolveRecords(records);
    if (before !== this.repository.catalogFingerprint())
      throw new LibraryError(
        "LIBRARY_CONTEXT_CHANGED",
        "The Library changed while preparing playback. Try again.",
        409,
      );
    const selectedIndex = selectedTrackId
      ? resolved.findIndex((record) => record.id === selectedTrackId)
      : 0;
    if (resolved.length === 0 || selectedIndex < 0)
      throw new LibraryError(
        selectedTrackId ? "LIBRARY_TRACK_UNAVAILABLE" : "LIBRARY_CONTEXT_EMPTY",
        selectedTrackId
          ? "This track is no longer available."
          : "No available favorite tracks were found.",
        409,
      );
    return this.resolvedContext(resolved, selectedIndex);
  }

  search(query: string, limitPerGroup?: number): LibraryGroupedSearchResults {
    this.ensureOpen();
    const normalizedQuery = this.searchQuery(query);
    const limits = limitPerGroup
      ? {
          artists: this.pageLimit(limitPerGroup),
          albums: this.pageLimit(limitPerGroup),
          tracks: this.pageLimit(limitPerGroup),
        }
      : DEFAULT_LIBRARY_SEARCH_GROUP_LIMITS;
    return {
      normalizedQuery,
      catalogFingerprint: this.repository.catalogFingerprint(),
      artists: this.repository.searchArtists(
        normalizedQuery,
        null,
        limits.artists,
      ),
      albums: this.repository.searchAlbums(
        normalizedQuery,
        null,
        limits.albums,
      ),
      tracks: this.repository.searchTracks(
        normalizedQuery,
        null,
        limits.tracks,
      ),
    };
  }

  searchCategory(
    category: LibrarySearchCategory,
    query: string,
    cursor: string | null,
    limit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): LibraryCategorySearchResults {
    this.ensureOpen();
    const normalizedQuery = this.searchQuery(query);
    const boundedLimit = this.pageLimit(limit);
    const catalogFingerprint = this.repository.catalogFingerprint();
    if (category === "artists")
      return {
        category,
        normalizedQuery,
        catalogFingerprint,
        page: this.repository.searchArtists(
          normalizedQuery,
          cursor,
          boundedLimit,
        ),
      };
    if (category === "albums")
      return {
        category,
        normalizedQuery,
        catalogFingerprint,
        page: this.repository.searchAlbums(
          normalizedQuery,
          cursor,
          boundedLimit,
        ),
      };
    return {
      category,
      normalizedQuery,
      catalogFingerprint,
      page: this.repository.searchTracks(normalizedQuery, cursor, boundedLimit),
    };
  }

  trackLocation(trackId: string) {
    this.ensureOpen();
    return this.repository.trackLocation(trackId);
  }

  async resolveContext(
    context: "album" | "artist" | "track" | "tracks",
    id?: string,
    selectedTrackId?: string,
  ): Promise<ResolvedLibraryContext> {
    this.ensureOpen();
    if (context !== "tracks" && !id)
      throw new LibraryError(
        "INVALID_LIBRARY_CONTEXT",
        "Select a valid Library context.",
      );
    if (context === "track") {
      const trackId = id ?? "";
      const target = this.repository.playbackContextForTrack(trackId);
      if (!target)
        throw new LibraryError(
          "LIBRARY_TRACK_UNAVAILABLE",
          "This track is no longer available.",
          409,
        );
      return target.albumId
        ? this.resolveContext("album", target.albumId, trackId)
        : this.resolveTrack(trackId);
    }
    const before = this.repository.catalogFingerprint();
    const records = this.repository.contextTracks(context, id);
    if (
      selectedTrackId &&
      !records.some((record) => record.id === selectedTrackId)
    )
      throw new LibraryError(
        "LIBRARY_TRACK_UNAVAILABLE",
        "This track is no longer available.",
        409,
      );
    const resolved = await this.resolveRecords(records);
    if (before !== this.repository.catalogFingerprint())
      throw new LibraryError(
        "LIBRARY_CONTEXT_CHANGED",
        "The Library changed while preparing playback. Try again.",
        409,
      );
    const selectedIndex = selectedTrackId
      ? resolved.findIndex((record) => record.id === selectedTrackId)
      : 0;
    if (resolved.length === 0 || selectedIndex < 0)
      throw new LibraryError(
        selectedTrackId ? "LIBRARY_TRACK_UNAVAILABLE" : "LIBRARY_CONTEXT_EMPTY",
        selectedTrackId
          ? "This track is no longer available."
          : "No available tracks were found.",
        409,
      );
    return this.resolvedContext(resolved, selectedIndex);
  }

  async resolveTrack(trackId: string): Promise<ResolvedLibraryContext> {
    this.ensureOpen();
    const record = this.repository.contextTrack(trackId);
    if (!record)
      throw new LibraryError(
        "LIBRARY_TRACK_UNAVAILABLE",
        "This track is no longer available.",
        409,
      );
    const resolved = await this.resolveRecords([record]);
    const item = resolved[0];
    if (!item)
      throw new LibraryError(
        "LIBRARY_TRACK_UNAVAILABLE",
        "This track is no longer available.",
        409,
      );
    return this.resolvedContext([item], 0);
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

  private pageLimit(limit: number): number {
    if (
      !Number.isInteger(limit) ||
      limit < MIN_PAGE_LIMIT ||
      limit > MAX_LIBRARY_PAGE_LIMIT
    )
      throw new LibraryError(
        "INVALID_LIBRARY_PAGE",
        `Library page size must be between ${String(MIN_PAGE_LIMIT)} and ${String(MAX_LIBRARY_PAGE_LIMIT)}.`,
      );
    return limit;
  }

  private searchQuery(query: string): string {
    if (typeof query !== "string" || query.length > 256)
      throw new LibraryError(
        "INVALID_LIBRARY_SEARCH",
        "Enter a valid Library search.",
      );
    const normalized = normalizeLibrarySearchKey(query);
    if (Array.from(normalized).length < 2)
      throw new LibraryError(
        "LIBRARY_SEARCH_TOO_SHORT",
        "Type at least 2 characters.",
      );
    return normalized;
  }

  private async resolveRecords(
    records: readonly {
      readonly id: string;
      readonly sourceId: string;
      readonly relativePath: string;
    }[],
  ): Promise<
    readonly {
      readonly id: string;
      readonly sourceId: string;
      readonly relativePath: string;
      readonly path: string;
    }[]
  > {
    const sourceCache = new Map<
      string,
      Awaited<ReturnType<SourceService["getInternal"]>> | null
    >();
    for (const sourceId of new Set(records.map((record) => record.sourceId))) {
      try {
        const source = await this.sources.getInternal(sourceId);
        sourceCache.set(
          sourceId,
          (await this.sources.availabilityOf(sourceId)) === "available"
            ? source
            : null,
        );
      } catch {
        sourceCache.set(sourceId, null);
      }
    }
    const output = new Array<{
      readonly id: string;
      readonly sourceId: string;
      readonly relativePath: string;
      readonly path: string;
    } | null>(records.length).fill(null);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < records.length) {
        const index = next++;
        const record = records[index];
        if (!record) continue;
        const source = sourceCache.get(record.sourceId);
        if (!source) continue;
        try {
          const path = await this.paths.resolveWithinSource(
            source.canonicalRoot,
            record.relativePath,
          );
          const details = await this.provider.lstat(path);
          if (details.isSymbolicLink() || !details.isFile()) continue;
          await this.provider.access(path);
          output[index] = { ...record, path };
        } catch {
          // Files can disappear after the indexed query; omit them atomically.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(8, records.length) }, () => worker()),
    );
    return output.filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
  }

  private resolvedContext(
    records: readonly {
      readonly id: string;
      readonly sourceId: string;
      readonly relativePath: string;
      readonly path: string;
    }[],
    selectedIndex: number,
  ): ResolvedLibraryContext {
    return {
      paths: records.map((record) => record.path),
      origins: records.map((record) => ({
        kind: "folders" as const,
        sourceId: record.sourceId,
        relativePath: record.relativePath,
        libraryTrackId: record.id,
      })),
      selectedIndex,
      trackIds: records.map((record) => record.id),
    };
  }
}
