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
  FavoriteAlbumPage,
  FavoriteArtistPage,
  FavoriteAlbumMutationResponse,
  FavoriteArtistMutationResponse,
  RecentlyPlayedPage,
  RecentlyPlayedMutationResponse,
  MostPlayedPage,
  ListeningStats,
  ListeningStatsResetResponse,
  PlaylistPage,
  PlaylistSummary,
  PlaylistDetail,
  PlaylistAddTracksResponse,
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
  private historyRevision = 0;
  private statsRevision = 0;
  private playlistRevision = 0;

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
    const record = (await this.sourceRepository.list()).find(
      (candidate) => candidate.id === sourceId,
    );
    if (!record)
      throw new LibraryError(
        "LIBRARY_SOURCE_NOT_FOUND",
        "Library source not found.",
        404,
      );
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

  setSourceAvailability(sourceId: string, available: boolean): void {
    this.ensureOpen();
    if (!available) this.scheduler.sourceUnavailable(sourceId);
    if (this.repository.setSourceAvailability(sourceId, available))
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
      historyRevision: this.historyRevision,
      statsRevision: this.statsRevision,
      playlistRevision: this.playlistRevision,
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

  recentlyPlayed(
    cursor: string | null,
    limit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): RecentlyPlayedPage {
    this.ensureOpen();
    return this.repository.recentlyPlayed(cursor, this.pageLimit(limit));
  }

  recordPlayHistory(
    trackId: string,
    playedSeconds: number,
    completed: boolean,
    playedAt = Date.now(),
  ): { readonly historyId: string; readonly created: boolean } | null {
    this.ensureOpen();
    if (
      !/^track-[0-9a-f]{32}$/.test(trackId) ||
      !Number.isFinite(playedSeconds) ||
      playedSeconds < 0 ||
      !Number.isFinite(playedAt) ||
      playedAt < 0
    )
      return null;
    const result = this.repository.recordPlayHistory(
      trackId,
      playedSeconds,
      completed,
      Math.floor(playedAt),
    );
    if (result) this.publishHistoryChange();
    return result;
  }

  updatePlayHistory(
    historyId: string,
    playedSeconds: number,
    completed: boolean,
    playedAt = Date.now(),
  ): boolean {
    this.ensureOpen();
    const id = this.historyId(historyId);
    if (
      id === null ||
      !Number.isFinite(playedSeconds) ||
      playedSeconds < 0 ||
      !Number.isFinite(playedAt) ||
      playedAt < 0
    )
      return false;
    const changed = this.repository.updatePlayHistory(
      id,
      playedSeconds,
      completed,
      Math.floor(playedAt),
    );
    if (changed) this.publishHistoryChange();
    return changed;
  }

  recordQualifiedPlay(
    trackId: string,
    playedSeconds: number,
    completed: boolean,
    playedAt = Date.now(),
  ): boolean {
    this.ensureOpen();
    if (
      !/^track-[0-9a-f]{32}$/.test(trackId) ||
      !Number.isFinite(playedSeconds) ||
      playedSeconds < 0 ||
      !Number.isFinite(playedAt) ||
      playedAt < 0
    )
      return false;
    const changed = this.repository.recordQualifiedPlay(
      trackId,
      playedSeconds,
      completed,
      Math.floor(playedAt),
    );
    if (changed) this.publishStatsChange();
    return changed;
  }

  updateQualifiedPlay(
    trackId: string,
    playedSecondsDelta: number,
    completedIncrement: boolean,
    playedAt = Date.now(),
  ): boolean {
    this.ensureOpen();
    if (
      !/^track-[0-9a-f]{32}$/.test(trackId) ||
      !Number.isFinite(playedSecondsDelta) ||
      playedSecondsDelta < 0 ||
      !Number.isFinite(playedAt) ||
      playedAt < 0
    )
      return false;
    const changed = this.repository.updateQualifiedPlay(
      trackId,
      playedSecondsDelta,
      completedIncrement,
      Math.floor(playedAt),
    );
    if (changed) this.publishStatsChange();
    return changed;
  }

  mostPlayed(
    cursor: string | null,
    limit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): MostPlayedPage {
    this.ensureOpen();
    return this.repository.mostPlayed(cursor, this.pageLimit(limit));
  }

  listeningStats(): ListeningStats {
    this.ensureOpen();
    return this.repository.listeningStats();
  }

  resetListeningStats(): ListeningStatsResetResponse {
    this.ensureOpen();
    const removedCount = this.repository.resetPlayStats();
    if (removedCount > 0) this.publishStatsChange();
    return { removedCount };
  }

  async resolveMostPlayed(
    selectedTrackId?: string,
  ): Promise<ResolvedLibraryContext> {
    this.ensureOpen();
    if (selectedTrackId && !/^track-[0-9a-f]{32}$/.test(selectedTrackId))
      throw new LibraryError(
        "INVALID_LIBRARY_TRACK",
        "Select a valid Library track.",
      );
    const before = this.repository.catalogFingerprint();
    const records = this.repository.mostPlayedContextTracks();
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
          : "No available most-played tracks were found.",
        409,
      );
    return this.resolvedContext(resolved, selectedIndex);
  }

  playlists(
    cursor: string | null,
    limit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): PlaylistPage {
    this.ensureOpen();
    return this.repository.playlists(cursor, this.pageLimit(limit));
  }

  playlist(playlistId: string): PlaylistDetail {
    this.ensureOpen();
    this.requirePlaylistId(playlistId);
    const detail = this.repository.playlist(playlistId);
    if (!detail)
      throw new LibraryError(
        "PLAYLIST_NOT_FOUND",
        "This playlist no longer exists.",
        404,
      );
    return detail;
  }

  createPlaylist(name: string): PlaylistSummary {
    this.ensureOpen();
    const result = this.repository.createPlaylist(name);
    this.publishPlaylistChange();
    return result;
  }

  renamePlaylist(playlistId: string, name: string): PlaylistSummary {
    this.ensureOpen();
    this.requirePlaylistId(playlistId);
    const result = this.repository.renamePlaylist(playlistId, name);
    if (!result)
      throw new LibraryError(
        "PLAYLIST_NOT_FOUND",
        "This playlist no longer exists.",
        404,
      );
    this.publishPlaylistChange();
    return result;
  }

  deletePlaylist(playlistId: string): { readonly removedCount: number } {
    this.ensureOpen();
    this.requirePlaylistId(playlistId);
    const removedCount = this.repository.deletePlaylist(playlistId);
    if (removedCount > 0) this.publishPlaylistChange();
    return { removedCount };
  }

  addPlaylistTracks(
    playlistId: string,
    trackIds: readonly string[],
    allowDuplicates = false,
  ): PlaylistAddTracksResponse {
    this.ensureOpen();
    this.requirePlaylistId(playlistId);
    if (trackIds.some((trackId) => !/^track-[0-9a-f]{32}$/.test(trackId)))
      throw new LibraryError(
        "INVALID_PLAYLIST_TRACKS",
        "Select valid indexed Library tracks.",
      );
    const result = this.repository.addPlaylistTracks(
      playlistId,
      trackIds,
      allowDuplicates,
    );
    if (result.addedCount > 0) this.publishPlaylistChange();
    return result;
  }

  removePlaylistItem(
    playlistId: string,
    itemId: string,
  ): { readonly removedCount: number } {
    this.ensureOpen();
    this.requirePlaylistId(playlistId);
    this.requirePlaylistItemId(itemId);
    const removedCount = this.repository.removePlaylistItem(playlistId, itemId);
    if (removedCount > 0) this.publishPlaylistChange();
    return { removedCount };
  }

  reorderPlaylist(
    playlistId: string,
    itemIds: readonly string[],
  ): PlaylistDetail {
    this.ensureOpen();
    this.requirePlaylistId(playlistId);
    if (itemIds.length > 2_000)
      throw new LibraryError(
        "PLAYLIST_TOO_LARGE",
        "Playlist order is too large.",
      );
    itemIds.forEach((id) => {
      this.requirePlaylistItemId(id);
    });
    if (this.repository.reorderPlaylist(playlistId, itemIds))
      this.publishPlaylistChange();
    return this.playlist(playlistId);
  }

  async resolvePlaylist(
    playlistId: string,
    selectedItemId?: string,
  ): Promise<ResolvedLibraryContext> {
    this.ensureOpen();
    this.requirePlaylistId(playlistId);
    if (selectedItemId) this.requirePlaylistItemId(selectedItemId);
    if (!this.repository.playlist(playlistId))
      throw new LibraryError(
        "PLAYLIST_NOT_FOUND",
        "This playlist no longer exists.",
        404,
      );
    const before = this.repository.catalogFingerprint();
    const records = this.repository.playlistContextTracks(playlistId);
    const resolved = await this.resolveRecords(records);
    if (before !== this.repository.catalogFingerprint())
      throw new LibraryError(
        "LIBRARY_CONTEXT_CHANGED",
        "The Library changed while preparing playback. Try again.",
        409,
      );
    const selectedIndex = selectedItemId
      ? resolved.findIndex((record) => record.contextId === selectedItemId)
      : 0;
    if (resolved.length === 0 || selectedIndex < 0)
      throw new LibraryError(
        selectedItemId ? "PLAYLIST_ITEM_UNAVAILABLE" : "LIBRARY_CONTEXT_EMPTY",
        selectedItemId
          ? "This playlist track is unavailable."
          : "No available playlist tracks were found.",
        409,
      );
    return this.resolvedContext(resolved, selectedIndex);
  }

  removePlayHistory(historyId: string): RecentlyPlayedMutationResponse {
    this.ensureOpen();
    const id = this.historyId(historyId);
    if (id === null)
      throw new LibraryError(
        "INVALID_LIBRARY_HISTORY",
        "Select a valid listening-history event.",
      );
    const removedCount = this.repository.removePlayHistory(id);
    if (removedCount > 0) this.publishHistoryChange();
    return { removedCount };
  }

  clearPlayHistory(): RecentlyPlayedMutationResponse {
    this.ensureOpen();
    const removedCount = this.repository.clearPlayHistory();
    if (removedCount > 0) this.publishHistoryChange();
    return { removedCount };
  }

  async resolveRecentlyPlayed(
    selectedHistoryId?: string,
  ): Promise<ResolvedLibraryContext> {
    this.ensureOpen();
    const before = this.repository.catalogFingerprint();
    const selectedTrackId = selectedHistoryId
      ? this.repository.playHistoryTrackId(
          this.requiredHistoryId(selectedHistoryId),
        )
      : null;
    if (selectedHistoryId && !selectedTrackId)
      throw new LibraryError(
        "LIBRARY_HISTORY_NOT_FOUND",
        "This listening-history event no longer exists.",
        404,
      );
    const records = this.repository.playHistoryContextTracks();
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
          : "No available listening-history tracks were found.",
        409,
      );
    return this.resolvedContext(resolved, selectedIndex);
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

  favoriteAlbums(
    cursor: string | null,
    limit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): FavoriteAlbumPage {
    this.ensureOpen();
    return this.repository.favoriteAlbums(cursor, this.pageLimit(limit));
  }

  favoriteAlbumIds(albumIds: readonly string[]): readonly string[] {
    this.validateFavoriteIds(albumIds, "album");
    return this.repository.favoriteAlbumIds(albumIds);
  }

  addFavoriteAlbum(albumId: string): FavoriteAlbumMutationResponse {
    this.ensureOpen();
    const result = this.repository.addFavoriteAlbum(albumId);
    if (!result)
      throw new LibraryError(
        "LIBRARY_ALBUM_NOT_FOUND",
        "This album is no longer in the Library.",
        404,
      );
    return result;
  }

  removeFavoriteAlbum(albumId: string): FavoriteAlbumMutationResponse {
    this.ensureOpen();
    return this.repository.removeFavoriteAlbum(albumId);
  }

  resolveFavoriteAlbums(): Promise<ResolvedLibraryContext> {
    this.ensureOpen();
    return this.resolveFavoriteEntityRecords(
      () => this.repository.favoriteAlbumContextTracks(),
      "No available favorite album tracks were found.",
    );
  }

  favoriteArtists(
    cursor: string | null,
    limit = DEFAULT_LIBRARY_PAGE_LIMIT,
  ): FavoriteArtistPage {
    this.ensureOpen();
    return this.repository.favoriteArtists(cursor, this.pageLimit(limit));
  }

  favoriteArtistIds(artistIds: readonly string[]): readonly string[] {
    this.validateFavoriteIds(artistIds, "artist");
    return this.repository.favoriteArtistIds(artistIds);
  }

  addFavoriteArtist(artistId: string): FavoriteArtistMutationResponse {
    this.ensureOpen();
    const result = this.repository.addFavoriteArtist(artistId);
    if (!result)
      throw new LibraryError(
        "LIBRARY_ARTIST_NOT_FOUND",
        "This artist is no longer in the Library.",
        404,
      );
    return result;
  }

  removeFavoriteArtist(artistId: string): FavoriteArtistMutationResponse {
    this.ensureOpen();
    return this.repository.removeFavoriteArtist(artistId);
  }

  resolveFavoriteArtists(): Promise<ResolvedLibraryContext> {
    this.ensureOpen();
    return this.resolveFavoriteEntityRecords(
      () => this.repository.favoriteArtistContextTracks(),
      "No available favorite artist tracks were found.",
    );
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

  private publishHistoryChange(): void {
    this.historyRevision += 1;
    this.publish();
  }

  private publishStatsChange(): void {
    this.statsRevision += 1;
    this.publish();
  }

  private publishPlaylistChange(): void {
    this.playlistRevision += 1;
    this.publish();
  }

  private requirePlaylistId(value: string): void {
    if (!/^playlist-[0-9a-f-]{36}$/i.test(value))
      throw new LibraryError("INVALID_PLAYLIST", "Select a valid playlist.");
  }

  private requirePlaylistItemId(value: string): void {
    if (!/^playlist-item-[0-9a-f-]{36}$/i.test(value))
      throw new LibraryError(
        "INVALID_PLAYLIST_ITEM",
        "Select a valid playlist item.",
      );
  }

  private historyId(value: string): number | null {
    const match = /^history-([1-9][0-9]*)$/.exec(value);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) ? id : null;
  }

  private requiredHistoryId(value: string): number {
    const id = this.historyId(value);
    if (id === null)
      throw new LibraryError(
        "INVALID_LIBRARY_HISTORY",
        "Select a valid listening-history event.",
      );
    return id;
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

  private validateFavoriteIds(
    ids: readonly string[],
    entity: "album" | "artist",
  ): void {
    this.ensureOpen();
    const expression = new RegExp(`^${entity}-[0-9a-f]{32}$`);
    if (ids.length > 192 || ids.some((id) => !expression.test(id)))
      throw new LibraryError(
        "INVALID_LIBRARY_FAVORITE_STATUS",
        `Select up to 192 valid Library ${entity}s.`,
      );
  }

  private async resolveFavoriteEntityRecords(
    getRecords: () => readonly {
      readonly id: string;
      readonly sourceId: string;
      readonly relativePath: string;
    }[],
    emptyMessage: string,
  ): Promise<ResolvedLibraryContext> {
    const before = this.repository.catalogFingerprint();
    const resolved = await this.resolveRecords(getRecords());
    if (before !== this.repository.catalogFingerprint())
      throw new LibraryError(
        "LIBRARY_CONTEXT_CHANGED",
        "The Library changed while preparing playback. Try again.",
        409,
      );
    if (resolved.length === 0)
      throw new LibraryError("LIBRARY_CONTEXT_EMPTY", emptyMessage, 409);
    return this.resolvedContext(resolved, 0);
  }

  private async resolveRecords(
    records: readonly {
      readonly id: string;
      readonly sourceId: string;
      readonly relativePath: string;
      readonly contextId?: string;
    }[],
  ): Promise<
    readonly {
      readonly id: string;
      readonly sourceId: string;
      readonly relativePath: string;
      readonly path: string;
      readonly sourceType: "local" | "removable";
      readonly contextId?: string;
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
      readonly sourceType: "local" | "removable";
      readonly contextId?: string;
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
          output[index] = { ...record, path, sourceType: source.type };
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
      readonly sourceType: "local" | "removable";
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
        ...(record.sourceType === "removable"
          ? { removable: true as const }
          : {}),
      })),
      selectedIndex,
      trackIds: records.map((record) => record.id),
    };
  }
}
