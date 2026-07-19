import { createHash } from "node:crypto";
import type { FolderArtworkPreview } from "../../../../packages/shared/src/library.js";
import { isSupportedAudioPath } from "../../../../packages/shared/src/audio.js";
import { ArtworkService } from "../artwork/artwork-service.js";
import { MetadataService } from "../metadata/metadata-service.js";
import { LimitedConcurrency } from "../utils/limited-concurrency.js";
import type { FilesystemProvider } from "./filesystem-provider.js";
import { PathService } from "./path-service.js";
import { SourceService } from "./source-service.js";

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export class FolderArtworkPreviewService {
  private readonly cache = new Map<string, FolderArtworkPreview>();
  private readonly concurrency = new LimitedConcurrency(2);

  constructor(
    private readonly provider: FilesystemProvider,
    private readonly paths: PathService,
    private readonly sources: SourceService,
    private readonly metadata: MetadataService,
    private readonly artwork: ArtworkService,
    private readonly maxRecords = 32,
  ) {}

  async resolve(
    sourceId: string,
    requestedRelativePath = "",
  ): Promise<FolderArtworkPreview> {
    return this.concurrency.run(async () => {
      const relativePath = this.paths.validateLogicalRelativePath(
        requestedRelativePath,
      );
      const source = await this.sources.getInternal(sourceId);
      const directory = await this.paths.resolveWithinSource(
        source.canonicalRoot,
        relativePath,
      );
      const directoryStat = await this.provider.lstat(directory);
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
        throw new Error("Folder is unavailable");
      const children = await this.provider.readdir(directory);
      const audio: { name: string; path: string; revision: string }[] = [];
      for (const child of children) {
        if (child.name.startsWith(".") || !isSupportedAudioPath(child.name))
          continue;
        const nativePath = this.paths.fromLogicalRelativePath(
          source.canonicalRoot,
          this.paths.joinLogical(relativePath, child.name),
        );
        const stat = await this.provider.lstat(nativePath).catch(() => null);
        if (!stat?.isFile() || stat.isSymbolicLink()) continue;
        audio.push({
          name: child.name,
          path: nativePath,
          revision: `${String(stat.size)}:${String(stat.mtimeMs)}`,
        });
      }
      audio.sort((left, right) => collator.compare(left.name, right.name));
      const revision = createHash("sha256")
        .update(
          `${sourceId}\0${relativePath}\0${String(directoryStat.mtimeMs)}\0${audio
            .map((item) => `${item.name}:${item.revision}`)
            .join("\0")}`,
        )
        .digest("hex");
      const key = `${sourceId}\0${relativePath}\0${revision}`;
      const cached = this.cache.get(key);
      if (cached) {
        this.cache.delete(key);
        this.cache.set(key, cached);
        return cached;
      }

      const refs = [];
      const sidecar = await this.artwork.resolveFolderSidecar(directory);
      if (sidecar) refs.push(sidecar);
      const sample = audio.slice(0, 8);
      if (!sidecar) {
        for (const file of sample) {
          const result = await this.metadata.read(file.path);
          const ref =
            result.artwork?.sourceType === "embedded"
              ? result.artwork
              : await this.artwork.resolveEmbedded(result.pictures);
          if (ref) this.metadata.rememberArtwork(result.cacheKey, ref);
          if (
            ref &&
            !refs.some((existing) => existing.revision === ref.revision)
          )
            refs.push(ref);
          if (refs.length === 4) break;
        }
      }
      const preview: FolderArtworkPreview = {
        sourceId,
        relativePath,
        revision,
        mode:
          refs.length === 0 ? "none" : refs.length === 1 ? "single" : "mosaic",
        artwork: refs,
        playableFileCount: audio.length,
        sampledFileCount: sample.length,
      };
      this.cache.set(key, preview);
      while (this.cache.size > this.maxRecords) {
        const oldest = this.cache.keys().next().value;
        if (typeof oldest !== "string") break;
        this.cache.delete(oldest);
      }
      return preview;
    });
  }

  invalidateSource(sourceId: string): void {
    for (const key of this.cache.keys())
      if (key.startsWith(`${sourceId}\0`)) this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}
