import type {
  DirectoryBrowseResponse,
  DirectoryEntry,
  BrowseSource,
  LibrarySource,
  SourceAvailability,
} from "../../../../packages/shared/src/library.js";

export interface FilesystemDirectoryEntry {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface FilesystemStat {
  readonly size: number;
  readonly mtimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface StoredSourceBase {
  readonly id: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredLocalSource extends StoredSourceBase {
  readonly type: "local";
  readonly nativeRoot: string;
  readonly canonicalRoot: string;
}

export interface StoredRemovableSource extends StoredSourceBase {
  readonly type: "removable";
  readonly stableIdentity: string;
  readonly logicalRelativeRoot: string;
}

export interface StoredSmbSource extends StoredSourceBase {
  readonly type: "smb";
  readonly connectionId: string;
  readonly logicalRelativeRoot: string;
}

export type StoredSource =
  StoredLocalSource | StoredRemovableSource | StoredSmbSource;

export interface ResolvedSource<
  T extends "local" | "removable" | "smb" = "local" | "removable" | "smb",
> extends StoredSourceBase {
  readonly type: T;
  readonly nativeRoot: string;
  readonly canonicalRoot: string;
}

export interface DirectorySourceCatalog {
  getInternal(sourceId: string): Promise<ResolvedSource>;
  availabilityOf(sourceId: string): Promise<"available" | "unavailable">;
}

export interface SourceConfig {
  readonly version: 3;
  readonly sources: readonly StoredSource[];
}

export interface SourceWithAvailability {
  readonly record: StoredSource;
  readonly availability: SourceAvailability;
}

export interface InternalDirectoryEntry {
  readonly publicEntry: DirectoryEntry;
  readonly nativePath: string;
}

export interface CachedDirectory {
  readonly response: DirectoryBrowseResponse;
  readonly entries: readonly InternalDirectoryEntry[];
  readonly directoryMtimeMs: number;
}

export interface SourceServiceDiagnostics {
  readonly configPath: string;
  readonly sourceCount: number;
}

export function toPublicSource(
  source: StoredSourceBase & {
    readonly type: "local" | "removable" | "smb";
  },
  availability: SourceAvailability,
): LibrarySource;
export function toPublicSource(
  source: StoredSourceBase & {
    readonly type: "local" | "removable" | "smb";
  },
  availability: SourceAvailability,
): BrowseSource;
export function toPublicSource(
  source: StoredSourceBase & { readonly type: "local" | "removable" | "smb" },
  availability: SourceAvailability,
): BrowseSource {
  return {
    id: source.id,
    type: source.type,
    displayName: source.displayName,
    availability,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}
