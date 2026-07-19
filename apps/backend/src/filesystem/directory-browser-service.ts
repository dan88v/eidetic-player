import { createHash } from "node:crypto";
import type { ArtworkResource } from "../artwork/artwork-service.js";
import { ArtworkService } from "../artwork/artwork-service.js";
import { MetadataService } from "../metadata/metadata-service.js";
import { LimitedConcurrency } from "../utils/limited-concurrency.js";
import type {
  BreadcrumbSegment,
  DirectoryBrowseResponse,
  DirectoryEntry,
  LibraryMetadataSummary,
} from "../../../../packages/shared/src/library.js";
import { isSupportedAudioPath } from "../../../../packages/shared/src/audio.js";
import type { FilesystemProvider } from "./filesystem-provider.js";
import { FilesystemError } from "./filesystem-errors.js";
import { PathService } from "./path-service.js";
import { SourceService } from "./source-service.js";
import { FolderArtworkPreviewService } from "./folder-artwork-preview-service.js";
import {
  type CachedDirectory,
  type InternalDirectoryEntry,
  toPublicSource,
} from "./filesystem-types.js";

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

interface EntryRecord extends InternalDirectoryEntry {
  readonly parentRelativePath: string;
}

export class DirectoryBrowserService {
  private readonly cache = new Map<string, CachedDirectory>();
  private readonly entries = new Map<string, EntryRecord>();
  private readonly metadataConcurrency = new LimitedConcurrency(2);
  private readonly artworkConcurrency = new LimitedConcurrency(2);
  private activeMetadata = 0;
  private activeArtwork = 0;
  private maxMetadata = 0;
  private maxArtwork = 0;
  private cacheHits = 0;
  private readonly folderPreviews: FolderArtworkPreviewService;

  constructor(
    private readonly provider: FilesystemProvider,
    private readonly paths: PathService,
    private readonly sources: SourceService,
    private readonly currentPath: () => string | null,
    private readonly metadata = new MetadataService(),
    private readonly artwork = new ArtworkService(),
    private readonly maxDirectories = 32,
  ) {
    this.folderPreviews = new FolderArtworkPreviewService(
      provider,
      paths,
      sources,
      metadata,
      artwork,
    );
  }

  async browse(
    sourceId: string,
    requestedRelativePath = "",
  ): Promise<DirectoryBrowseResponse> {
    const relativePath = this.paths.validateLogicalRelativePath(
      requestedRelativePath,
    );
    const source = await this.sources.getInternal(sourceId);
    const availability = await this.sources.availabilityOf(sourceId);
    if (availability !== "available") {
      this.invalidateSource(sourceId);
      throw new FilesystemError(
        "SOURCE_UNAVAILABLE",
        "This source is currently unavailable.",
        409,
      );
    }
    const key = this.cacheKey(sourceId, relativePath);
    const cached = this.cache.get(key);
    if (cached) {
      const cachedNativeDirectory = this.paths.fromLogicalRelativePath(
        source.canonicalRoot,
        relativePath,
      );
      const currentStat = await this.provider
        .lstat(cachedNativeDirectory)
        .catch(() => null);
      if (
        currentStat?.isDirectory() &&
        !currentStat.isSymbolicLink() &&
        currentStat.mtimeMs === cached.directoryMtimeMs
      ) {
        this.cache.delete(key);
        this.cache.set(key, cached);
        this.cacheHits += 1;
        return this.refreshResponse(cached, source.displayName, true);
      }
      this.dropCacheEntry(key, cached);
    }

    const nativeDirectory = await this.paths.resolveWithinSource(
      source.canonicalRoot,
      relativePath,
    );
    let directoryStat;
    try {
      directoryStat = await this.provider.lstat(nativeDirectory);
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
        throw new Error("not a directory");
    } catch {
      console.warn(`[library] unable to browse source ${sourceId}`);
      throw new FilesystemError(
        "DIRECTORY_UNAVAILABLE",
        "Unable to read this folder.",
        409,
      );
    }

    let children;
    try {
      children = await this.provider.readdir(nativeDirectory);
    } catch {
      console.warn(`[library] unable to list source ${sourceId}`);
      throw new FilesystemError(
        "DIRECTORY_UNREADABLE",
        "Unable to read this folder.",
        403,
      );
    }

    const internalEntries: InternalDirectoryEntry[] = [];
    let containsUnsupportedFiles = false;
    for (const child of children) {
      if (
        child.name.startsWith(".") ||
        hiddenSystemNames.has(child.name.toLowerCase())
      )
        continue;
      const childRelativePath = this.paths.joinLogical(
        relativePath,
        child.name,
      );
      const childNativePath = this.paths.fromLogicalRelativePath(
        source.canonicalRoot,
        childRelativePath,
      );
      let details;
      try {
        details = await this.provider.lstat(childNativePath);
      } catch {
        continue;
      }
      if (details.isSymbolicLink()) continue;
      const type = details.isDirectory()
        ? "directory"
        : details.isFile() && isSupportedAudioPath(child.name)
          ? "audio"
          : null;
      if (!type) {
        if (details.isFile()) containsUnsupportedFiles = true;
        continue;
      }
      const id = this.entryId(
        sourceId,
        childRelativePath,
        details.size,
        details.mtimeMs,
      );
      const publicEntry: DirectoryEntry = {
        id,
        sourceId,
        relativePath: childRelativePath,
        name: child.name,
        type,
        extension: type === "audio" ? this.paths.extension(child.name) : null,
        availability: "available",
        metadataSummary: null,
        current: this.isCurrent(childNativePath),
      };
      const internal = { publicEntry, nativePath: childNativePath };
      internalEntries.push(internal);
      this.entries.set(id, {
        ...internal,
        parentRelativePath: relativePath,
      });
    }

    internalEntries.sort((left, right) => {
      if (left.publicEntry.type !== right.publicEntry.type)
        return left.publicEntry.type === "directory" ? -1 : 1;
      return naturalCollator.compare(
        left.publicEntry.name,
        right.publicEntry.name,
      );
    });
    const response: DirectoryBrowseResponse = {
      source: toPublicSource(source, "available"),
      current: { sourceId, relativePath },
      parent:
        relativePath === ""
          ? null
          : {
              sourceId,
              relativePath: this.paths.dirnameLogical(relativePath),
            },
      breadcrumbs: this.breadcrumbs(source.displayName, relativePath),
      entries: internalEntries.map((entry) => entry.publicEntry),
      fingerprint: createHash("sha256")
        .update(
          `${sourceId}\0${relativePath}\0${String(directoryStat.mtimeMs)}\0${internalEntries
            .map((entry) => entry.publicEntry.id)
            .join("\0")}`,
        )
        .digest("hex"),
      fromCache: false,
      containsUnsupportedFiles,
    };
    const cachedDirectory = {
      response,
      entries: internalEntries,
      directoryMtimeMs: directoryStat.mtimeMs,
    };
    this.cache.set(key, cachedDirectory);
    this.trimCache();
    return response;
  }

  async metadataFor(
    sourceId: string,
    entryId: string,
  ): Promise<LibraryMetadataSummary> {
    const entry = this.requireAudioEntry(sourceId, entryId);
    return this.metadataConcurrency.run(async () => {
      this.activeMetadata += 1;
      this.maxMetadata = Math.max(this.maxMetadata, this.activeMetadata);
      try {
        const result = await this.metadata.readForArtwork(
          entry.nativePath,
          async (ref) => (await this.artwork.getResource(ref.id)) !== null,
        );
        let artwork;
        try {
          artwork = await this.artworkConcurrency.run(async () => {
            this.activeArtwork += 1;
            this.maxArtwork = Math.max(this.maxArtwork, this.activeArtwork);
            try {
              return await this.artwork.resolve(
                entry.nativePath,
                result.cacheKey,
                result.pictures,
              );
            } finally {
              this.activeArtwork -= 1;
            }
          });
        } catch (error) {
          this.metadata.invalidate(result.cacheKey);
          throw error;
        }
        this.metadata.rememberArtwork(result.cacheKey, artwork);
        const extension = entry.publicEntry.extension;
        const summary: LibraryMetadataSummary = {
          title:
            result.metadata.title ??
            this.filenameWithoutExtension(entry.publicEntry.name),
          artist: result.metadata.artist,
          durationSeconds: result.metadata.durationSeconds,
          format:
            result.metadata.container ??
            result.metadata.codec ??
            extension?.toUpperCase() ??
            null,
          codec: result.metadata.codec,
          container: result.metadata.container,
          bitrate: result.metadata.bitrate,
          sampleRate: result.metadata.sampleRate,
          bitDepth: result.metadata.bitDepth,
          lossless: result.metadata.lossless,
          isVariableBitrate: null,
          artwork,
        };
        this.commitMetadata(entryId, summary);
        return summary;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new FilesystemError(
            "ENTRY_NOT_FOUND",
            "This audio file is no longer available.",
            404,
          );
        throw error;
      } finally {
        this.activeMetadata -= 1;
      }
    });
  }

  async artworkFor(
    sourceId: string,
    entryId: string,
  ): Promise<ArtworkResource | null> {
    const summary = await this.metadataFor(sourceId, entryId);
    return summary.artwork
      ? this.artwork.getResource(summary.artwork.id)
      : null;
  }

  getArtworkResource(artworkId: string): Promise<ArtworkResource | null> {
    return this.artwork.getResource(artworkId);
  }

  async queueForEntry(
    sourceId: string,
    entryId: string,
  ): Promise<{
    readonly paths: readonly string[];
    readonly relativePaths: readonly string[];
    readonly selectedIndex: number;
  }> {
    const selected = this.requireAudioEntry(sourceId, entryId);
    const source = await this.sources.getInternal(sourceId);
    const listing = await this.browse(sourceId, selected.parentRelativePath);
    const paths: string[] = [];
    const relativePaths: string[] = [];
    let selectedIndex = -1;
    for (const publicEntry of listing.entries) {
      if (publicEntry.type !== "audio") continue;
      const record = this.entries.get(publicEntry.id);
      if (!record) continue;
      let canonical: string;
      try {
        const details = await this.provider.lstat(record.nativePath);
        if (details.isSymbolicLink() || !details.isFile()) continue;
        canonical = await this.paths.canonicalizePath(record.nativePath);
      } catch {
        continue;
      }
      if (!this.paths.isWithinSource(source.canonicalRoot, canonical)) continue;
      if (publicEntry.id === entryId) selectedIndex = paths.length;
      paths.push(canonical);
      relativePaths.push(publicEntry.relativePath);
    }
    if (selectedIndex < 0)
      throw new FilesystemError(
        "ENTRY_NOT_FOUND",
        "This audio file is no longer available.",
        404,
      );
    return { paths, relativePaths, selectedIndex };
  }

  async pathForEntry(sourceId: string, entryId: string): Promise<string> {
    const entry = this.requireAudioEntry(sourceId, entryId);
    const source = await this.sources.getInternal(sourceId);
    try {
      const details = await this.provider.lstat(entry.nativePath);
      const canonical = await this.paths.canonicalizePath(entry.nativePath);
      if (
        details.isSymbolicLink() ||
        !details.isFile() ||
        !this.paths.isWithinSource(source.canonicalRoot, canonical)
      )
        throw new Error("unavailable");
      return canonical;
    } catch {
      throw new FilesystemError(
        "ENTRY_NOT_FOUND",
        "This audio file is no longer available.",
        404,
      );
    }
  }

  relativePathForEntry(sourceId: string, entryId: string): string {
    return this.requireAudioEntry(sourceId, entryId).publicEntry.relativePath;
  }

  folderArtworkFor(sourceId: string, relativePath: string) {
    return this.folderPreviews.resolve(sourceId, relativePath);
  }

  async queueForDirectory(
    sourceId: string,
    relativePath: string,
  ): Promise<readonly string[]> {
    return (await this.queueForDirectoryWithOrigins(sourceId, relativePath))
      .paths;
  }

  async queueForDirectoryWithOrigins(
    sourceId: string,
    relativePath: string,
  ): Promise<{
    readonly paths: readonly string[];
    readonly relativePaths: readonly string[];
  }> {
    const source = await this.sources.getInternal(sourceId);
    const listing = await this.browse(sourceId, relativePath);
    const paths: string[] = [];
    const relativePaths: string[] = [];
    for (const entry of listing.entries) {
      if (entry.type !== "audio") continue;
      const record = this.entries.get(entry.id);
      if (!record) continue;
      try {
        const details = await this.provider.lstat(record.nativePath);
        const canonical = await this.paths.canonicalizePath(record.nativePath);
        if (
          !details.isSymbolicLink() &&
          details.isFile() &&
          this.paths.isWithinSource(source.canonicalRoot, canonical)
        ) {
          paths.push(canonical);
          relativePaths.push(entry.relativePath);
        }
      } catch {
        // A file removed while listing is simply omitted from the action.
      }
    }
    return { paths, relativePaths };
  }

  invalidateSource(sourceId: string): void {
    this.folderPreviews.invalidateSource(sourceId);
    for (const key of this.cache.keys())
      if (key.startsWith(`${sourceId}\0`)) this.cache.delete(key);
    for (const [id, entry] of this.entries)
      if (entry.publicEntry.sourceId === sourceId) this.entries.delete(id);
  }

  getDiagnostics() {
    let approximateBytes = 0;
    for (const cached of this.cache.values())
      approximateBytes += JSON.stringify(cached.response).length * 2;
    return {
      cacheSize: this.cache.size,
      cacheHits: this.cacheHits,
      approximateBytes,
      metadataLimit: this.metadataConcurrency.limit,
      artworkLimit: this.artworkConcurrency.limit,
      maxMetadataConcurrency: this.maxMetadata,
      maxArtworkConcurrency: this.maxArtwork,
    };
  }

  async close(): Promise<void> {
    this.cache.clear();
    this.entries.clear();
    this.metadata.clear();
    this.folderPreviews.clear();
    await this.artwork.close();
  }

  private refreshResponse(
    cached: CachedDirectory,
    displayName: string,
    fromCache: boolean,
  ): DirectoryBrowseResponse {
    return {
      ...cached.response,
      source: {
        ...cached.response.source,
        displayName,
        availability: "available",
      },
      breadcrumbs: cached.response.breadcrumbs.map((segment, index) =>
        index === 0 ? { ...segment, name: displayName } : segment,
      ),
      entries: cached.entries.map((entry) => ({
        ...entry.publicEntry,
        current: this.isCurrent(entry.nativePath),
      })),
      fromCache,
    };
  }

  private requireAudioEntry(sourceId: string, entryId: string): EntryRecord {
    if (!/^entry-[0-9a-f]{32}$/.test(entryId))
      throw new FilesystemError(
        "ENTRY_NOT_FOUND",
        "Audio file not found.",
        404,
      );
    const entry = this.entries.get(entryId);
    if (entry?.publicEntry.sourceId !== sourceId)
      throw new FilesystemError(
        "ENTRY_NOT_FOUND",
        "Audio file not found.",
        404,
      );
    if (entry.publicEntry.type !== "audio")
      throw new FilesystemError(
        "ENTRY_NOT_FOUND",
        "Audio file not found.",
        404,
      );
    return entry;
  }

  private commitMetadata(
    entryId: string,
    summary: LibraryMetadataSummary,
  ): void {
    const record = this.entries.get(entryId);
    if (!record) return;
    const publicEntry = {
      ...record.publicEntry,
      metadataSummary: summary,
    };
    this.entries.set(entryId, { ...record, publicEntry });
    for (const cached of this.cache.values()) {
      const index = cached.entries.findIndex(
        (entry) => entry.publicEntry.id === entryId,
      );
      if (index < 0) continue;
      const next = [...cached.entries];
      next[index] = { publicEntry, nativePath: record.nativePath };
      this.cache.set(
        this.cacheKey(publicEntry.sourceId, record.parentRelativePath),
        {
          response: {
            ...cached.response,
            entries: next.map((entry) => entry.publicEntry),
          },
          entries: next,
          directoryMtimeMs: cached.directoryMtimeMs,
        },
      );
      break;
    }
  }

  private breadcrumbs(
    sourceName: string,
    relativePath: string,
  ): readonly BreadcrumbSegment[] {
    const segments = relativePath ? relativePath.split("/") : [];
    const result: BreadcrumbSegment[] = [
      {
        name: sourceName,
        relativePath: "",
        current: segments.length === 0,
      },
    ];
    let current = "";
    for (const [index, segment] of segments.entries()) {
      current = current ? `${current}/${segment}` : segment;
      result.push({
        name: segment,
        relativePath: current,
        current: index === segments.length - 1,
      });
    }
    return result;
  }

  private cacheKey(sourceId: string, relativePath: string): string {
    return `${sourceId}\0${relativePath}`;
  }

  private entryId(
    sourceId: string,
    relativePath: string,
    size: number,
    mtimeMs: number,
  ): string {
    return `entry-${createHash("sha256")
      .update(
        `${sourceId}\0${relativePath}\0${String(size)}\0${String(mtimeMs)}`,
      )
      .digest("hex")
      .slice(0, 32)}`;
  }

  private isCurrent(candidate: string): boolean {
    const current = this.currentPath();
    return Boolean(
      current && this.paths.pathKey(candidate) === this.paths.pathKey(current),
    );
  }

  private filenameWithoutExtension(name: string): string {
    const extension = this.paths.extension(name);
    return extension ? name.slice(0, -(extension.length + 1)) : name;
  }

  private trimCache(): void {
    while (this.cache.size > this.maxDirectories) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      const cached = this.cache.get(oldest);
      if (cached) this.dropCacheEntry(oldest, cached);
      else this.cache.delete(oldest);
    }
  }

  private dropCacheEntry(key: string, cached: CachedDirectory): void {
    this.cache.delete(key);
    for (const entry of cached.entries)
      this.entries.delete(entry.publicEntry.id);
  }
}
