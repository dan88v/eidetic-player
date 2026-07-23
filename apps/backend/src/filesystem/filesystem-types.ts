import type {
  DirectoryBrowseResponse,
  DirectoryEntry,
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

export interface StoredSource {
  readonly id: string;
  readonly type: "local" | "removable";
  readonly displayName: string;
  readonly nativeRoot: string;
  readonly canonicalRoot: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DirectorySourceCatalog {
  getInternal(sourceId: string): Promise<StoredSource>;
  availabilityOf(sourceId: string): Promise<"available" | "unavailable">;
}

export interface SourceConfig {
  readonly version: 1;
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
  source: StoredSource,
  availability: SourceAvailability,
): LibrarySource {
  return {
    id: source.id,
    type: source.type,
    displayName: source.displayName,
    availability,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}
