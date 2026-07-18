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
  readonly artwork: ArtworkRef | null;
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

export interface AddLocalSourceRequest {
  readonly nativePath: string;
}

export interface RenameSourceRequest {
  readonly displayName: string;
}
