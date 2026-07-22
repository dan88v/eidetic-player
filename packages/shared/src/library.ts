import type { ArtworkRef } from "./player.js";

export type SourceAvailability = "available" | "unavailable" | "checking";

export interface LibrarySource {
  readonly id: string;
  readonly type: "local";
  readonly displayName: string;
  readonly availability: SourceAvailability;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DirectoryLocation {
  readonly sourceId: string;
  readonly relativePath: string;
}

export interface BreadcrumbSegment {
  readonly name: string;
  readonly relativePath: string;
  readonly current: boolean;
}

export interface LibraryMetadataSummary {
  readonly title: string;
  readonly artist: string | null;
  readonly durationSeconds: number | null;
  readonly format: string | null;
  readonly codec: string | null;
  readonly container: string | null;
  readonly bitrate: number | null;
  readonly sampleRate: number | null;
  readonly bitDepth: number | null;
  readonly lossless: boolean | null;
  readonly isVariableBitrate: boolean | null;
  readonly artwork: ArtworkRef | null;
}

export type LibraryFolderViewMode = "list" | "grid";

export interface FolderArtworkPreview {
  readonly sourceId: string;
  readonly relativePath: string;
  readonly revision: string;
  readonly mode: "none" | "single" | "mosaic";
  readonly artwork: readonly ArtworkRef[];
  readonly playableFileCount: number;
  readonly sampledFileCount: number;
}

export interface DirectoryEntry {
  readonly id: string;
  readonly sourceId: string;
  readonly relativePath: string;
  readonly name: string;
  readonly type: "directory" | "audio";
  readonly extension: string | null;
  readonly availability: "available";
  readonly metadataSummary: LibraryMetadataSummary | null;
  readonly current: boolean;
}

export interface DirectoryBrowseResponse {
  readonly source: LibrarySource;
  readonly current: DirectoryLocation;
  readonly parent: DirectoryLocation | null;
  readonly breadcrumbs: readonly BreadcrumbSegment[];
  readonly entries: readonly DirectoryEntry[];
  readonly fingerprint: string;
  readonly fromCache: boolean;
  readonly containsUnsupportedFiles: boolean;
}

export interface SourceListResponse {
  readonly sources: readonly LibrarySource[];
}

export interface AddLocalSourceResponse {
  readonly source: LibrarySource;
  readonly duplicate: boolean;
}

export interface OpenLibraryEntryResponse {
  readonly selectedIndex: number;
  readonly queueLength: number;
}

export interface DirectoryQueueResponse {
  readonly queueLength: number;
  readonly appendedCount: number;
}

export interface AddLocalSourceRequest {
  readonly nativePath: string;
}

export interface RenameSourceRequest {
  readonly displayName: string;
}

export type LibraryScanStatus =
  | "idle"
  | "queued"
  | "scanning"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed"
  | "source-unavailable";

export interface LibraryScanProgress {
  readonly scanId: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly generation: number;
  readonly status: LibraryScanStatus;
  readonly filesDiscovered: number;
  readonly filesProcessed: number;
  readonly filesUnchanged: number;
  readonly filesNew: number;
  readonly filesModified: number;
  readonly filesUnavailable: number;
  readonly filesFailed: number;
  readonly totalFiles: number | null;
  readonly startedAt: string | null;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly elapsedMilliseconds: number;
  readonly errorCode: string | null;
}

export interface IndexedLibrarySummary {
  readonly trackCount: number;
  readonly availableTrackCount: number;
  readonly unavailableTrackCount: number;
  readonly albumCount: number;
  readonly artistCount: number;
  readonly sourceCount: number;
  readonly scanStatus: LibraryScanStatus;
  readonly lastSuccessfulScan: string | null;
}

export interface IndexedLibrarySource {
  readonly sourceId: string;
  readonly displayName: string;
  readonly availability: "available" | "unavailable" | "removed";
  readonly firstScanCompleted: boolean;
  readonly scanStatus: LibraryScanStatus;
  readonly lastScanStarted: string | null;
  readonly lastScanCompleted: string | null;
  readonly lastSuccessfulScan: string | null;
  readonly lastErrorCode: string | null;
  readonly currentGeneration: number;
  readonly fileCount: number;
  readonly unavailableCount: number;
}

export interface IndexedLibraryStatus {
  readonly activeScan: LibraryScanProgress | null;
  readonly latestScan: LibraryScanProgress | null;
  readonly queuedSourceIds: readonly string[];
  readonly recoveryNotice: "database-rebuilt" | null;
}

export interface IndexedLibrarySnapshot {
  readonly summary: IndexedLibrarySummary;
  readonly sources: readonly IndexedLibrarySource[];
  readonly status: IndexedLibraryStatus;
  readonly historyRevision: number;
  readonly statsRevision: number;
}

export interface LibraryScanRequest {
  readonly sourceId?: string;
}

export interface LibraryCancelScanRequest {
  readonly scanId?: string;
  readonly sourceId?: string;
}

export type LibraryEntityAvailability = "available" | "partial" | "unavailable";

export interface LibraryPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface LibraryTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string | null;
  readonly album: string | null;
  readonly durationSeconds: number | null;
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
  readonly artworkTrackId: string | null;
  readonly availability: "available" | "unavailable";
}

export interface FavoriteTrack extends LibraryTrack {
  readonly favoritedAt: number;
}

export interface FavoriteTrackPage extends LibraryPage<FavoriteTrack> {
  readonly total: number;
  readonly availableCount: number;
}

export interface FavoriteTrackStatusRequest {
  readonly trackIds: readonly string[];
}

export interface FavoriteTrackStatusResponse {
  readonly favoriteTrackIds: readonly string[];
}

export interface FavoriteTrackMutationResponse {
  readonly trackId: string;
  readonly isFavorite: boolean;
  readonly favoritedAt: number | null;
}

export interface FavoriteTracksPlayRequest {
  readonly selectedTrackId?: string;
  readonly catalogFingerprint?: string;
}

export interface RecentlyPlayedItem extends LibraryTrack {
  readonly historyId: string;
  readonly playedAt: number;
  readonly playedSeconds: number;
  readonly completed: boolean;
}

export interface RecentlyPlayedPage extends LibraryPage<RecentlyPlayedItem> {
  readonly total: number;
  readonly availableCount: number;
}

export interface RecentlyPlayedPlayRequest {
  readonly selectedHistoryId?: string;
}

export interface RecentlyPlayedMutationResponse {
  readonly removedCount: number;
}

export interface MostPlayedItem extends LibraryTrack {
  readonly playCount: number;
  readonly completedCount: number;
  readonly totalPlayedSeconds: number;
  readonly firstPlayedAt: number;
  readonly lastPlayedAt: number;
}

export interface MostPlayedPage extends LibraryPage<MostPlayedItem> {
  readonly total: number;
  readonly availableCount: number;
}

export interface MostPlayedPlayRequest {
  readonly selectedTrackId?: string;
}

export interface ListeningStats {
  readonly listeningSeconds: number;
  readonly qualifiedPlays: number;
  readonly completedPlays: number;
  readonly uniqueTracks: number;
  readonly trackingSince: number | null;
  readonly lastListened: number | null;
}

export interface ListeningStatsResetResponse {
  readonly removedCount: number;
}

export interface LibraryAlbum {
  readonly id: string;
  readonly title: string;
  readonly albumArtist: string | null;
  readonly year: number | null;
  readonly artworkTrackId: string | null;
  readonly trackCount: number;
  readonly availableTrackCount: number;
  readonly totalDurationSeconds: number;
  readonly availability: LibraryEntityAvailability;
}

export interface LibraryArtist {
  readonly id: string;
  readonly name: string;
  readonly albumCount: number;
  readonly trackCount: number;
  readonly availableTrackCount: number;
  readonly availability: LibraryEntityAvailability;
}

export interface FavoriteAlbum extends LibraryAlbum {
  readonly favoritedAt: number;
}

export interface FavoriteArtist extends LibraryArtist {
  readonly favoritedAt: number;
}

export interface FavoriteAlbumPage extends LibraryPage<FavoriteAlbum> {
  readonly total: number;
  readonly availableCount: number;
}

export interface FavoriteArtistPage extends LibraryPage<FavoriteArtist> {
  readonly total: number;
  readonly availableCount: number;
}

export interface FavoriteAlbumStatusResponse {
  readonly favoriteAlbumIds: readonly string[];
}

export interface FavoriteArtistStatusResponse {
  readonly favoriteArtistIds: readonly string[];
}

export interface FavoriteAlbumMutationResponse {
  readonly albumId: string;
  readonly isFavorite: boolean;
  readonly favoritedAt: number | null;
}

export interface FavoriteArtistMutationResponse {
  readonly artistId: string;
  readonly isFavorite: boolean;
  readonly favoritedAt: number | null;
}

export interface FavoriteAlbumStatusRequest {
  readonly albumIds: readonly string[];
}

export interface FavoriteArtistStatusRequest {
  readonly artistIds: readonly string[];
}

export interface LibraryAlbumDetail extends LibraryAlbum {
  readonly tracks: readonly LibraryTrack[];
}

export interface LibraryArtistDetail extends LibraryArtist {
  readonly albums: readonly LibraryAlbum[];
  readonly tracks: LibraryPage<LibraryTrack>;
}

export type LibraryContextKind = "album" | "artist" | "track" | "tracks";

export interface LibraryContextRequest {
  readonly context: LibraryContextKind;
  readonly id?: string;
  readonly selectedTrackId?: string;
}

export interface LibraryTrackQueueRequest {
  readonly trackId: string;
}

export interface LibraryQueueActionResponse {
  readonly queueLength: number;
  readonly selectedIndex: number | null;
  readonly appendedCount: number;
}

export type LibrarySearchCategory = "artists" | "albums" | "tracks";

export interface LibrarySearchAlbum {
  readonly id: string;
  readonly title: string;
  readonly albumArtist: string | null;
  readonly year: number | null;
  readonly artworkTrackId: string | null;
  readonly trackCount: number;
  readonly availableTrackCount: number;
  readonly availability: LibraryEntityAvailability;
}

export interface LibrarySearchPage<T> extends LibraryPage<T> {
  readonly total: number;
}

export interface LibraryGroupedSearchResults {
  readonly normalizedQuery: string;
  readonly catalogFingerprint: string;
  readonly artists: LibrarySearchPage<LibraryArtist>;
  readonly albums: LibrarySearchPage<LibrarySearchAlbum>;
  readonly tracks: LibrarySearchPage<LibraryTrack>;
}

export type LibraryCategorySearchResults =
  | {
      readonly category: "artists";
      readonly normalizedQuery: string;
      readonly catalogFingerprint: string;
      readonly page: LibrarySearchPage<LibraryArtist>;
    }
  | {
      readonly category: "albums";
      readonly normalizedQuery: string;
      readonly catalogFingerprint: string;
      readonly page: LibrarySearchPage<LibrarySearchAlbum>;
    }
  | {
      readonly category: "tracks";
      readonly normalizedQuery: string;
      readonly catalogFingerprint: string;
      readonly page: LibrarySearchPage<LibraryTrack>;
    };
