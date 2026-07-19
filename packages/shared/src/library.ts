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
}

export interface LibraryScanRequest {
  readonly sourceId?: string;
}

export interface LibraryCancelScanRequest {
  readonly scanId?: string;
  readonly sourceId?: string;
}
