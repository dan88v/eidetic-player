import { realpath, stat } from "node:fs/promises";
import { parseFile, type IAudioMetadata } from "music-metadata";
import type { ArtworkRef } from "../../../../packages/shared/src/player.js";
import type {
  MetadataResult,
  NormalizedMetadata,
  PictureCandidate,
} from "./types.js";

export type MetadataParser = (path: string) => Promise<IAudioMetadata>;

interface CacheEntry {
  readonly metadata: NormalizedMetadata;
  readonly hasEmbeddedArtwork: boolean;
  artwork: ArtworkRef | null;
}

function text(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function normalizeMetadata(raw: IAudioMetadata): NormalizedMetadata {
  return {
    title: text(raw.common.title),
    artist: text(raw.common.artist),
    artists: (raw.common.artists ?? [])
      .map((artist) => artist.trim())
      .filter(Boolean),
    album: text(raw.common.album),
    albumArtist: text(raw.common.albumartist),
    trackNumber: positive(raw.common.track.no),
    trackTotal: positive(raw.common.track.of),
    discNumber: positive(raw.common.disk.no),
    discTotal: positive(raw.common.disk.of),
    year: positive(raw.common.year),
    genre: (raw.common.genre ?? [])
      .map((genre) => genre.trim())
      .filter(Boolean),
    durationSeconds: positive(raw.format.duration),
    codec: text(raw.format.codec),
    container: text(raw.format.container),
    sampleRate: positive(raw.format.sampleRate),
    bitDepth: positive(raw.format.bitsPerSample),
    bitrate: positive(raw.format.bitrate),
    lossless:
      typeof raw.format.lossless === "boolean" ? raw.format.lossless : null,
  };
}

function pictures(raw: IAudioMetadata): PictureCandidate[] {
  return (raw.common.picture ?? []).map((picture) => ({
    data: picture.data,
    mimeType: picture.format,
    type: text(picture.type),
    description: text(picture.description),
  }));
}

export const emptyMetadata: NormalizedMetadata = Object.freeze({
  title: null,
  artist: null,
  artists: [],
  album: null,
  albumArtist: null,
  trackNumber: null,
  trackTotal: null,
  discNumber: null,
  discTotal: null,
  year: null,
  genre: [],
  durationSeconds: null,
  codec: null,
  container: null,
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  lossless: null,
});

export class MetadataService {
  readonly maxRecords: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<MetadataResult>>();

  constructor(
    private readonly parser: MetadataParser = (path) =>
      parseFile(path, { duration: false, skipCovers: false }),
    maxRecords = 128,
  ) {
    this.maxRecords = maxRecords;
  }

  async read(path: string): Promise<MetadataResult> {
    const canonicalPath = await realpath(path);
    const file = await stat(canonicalPath);
    const cacheKey = `${canonicalPath}\0${String(file.size)}\0${String(file.mtimeMs)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return {
        cacheKey,
        metadata: cached.metadata,
        pictures: [],
        artwork: cached.artwork,
        hasEmbeddedArtwork: cached.hasEmbeddedArtwork,
        fromCache: true,
      };
    }
    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;
    this.deleteOtherVersions(canonicalPath, cacheKey);
    const operation = this.parser(canonicalPath)
      .then((raw) => {
        const metadata = normalizeMetadata(raw);
        const embeddedPictures = pictures(raw);
        this.cache.set(cacheKey, {
          metadata,
          artwork: null,
          hasEmbeddedArtwork: embeddedPictures.length > 0,
        });
        this.trim();
        return {
          cacheKey,
          metadata,
          pictures: embeddedPictures,
          artwork: null,
          hasEmbeddedArtwork: embeddedPictures.length > 0,
          fromCache: false,
        } satisfies MetadataResult;
      })
      .catch((error: unknown) => {
        console.warn(
          `[metadata] parser failed for ${canonicalPath}; using MPV and folder-artwork fallbacks`,
          error,
        );
        return {
          cacheKey,
          metadata: emptyMetadata,
          pictures: [],
          artwork: null,
          hasEmbeddedArtwork: false,
          fromCache: false,
        } satisfies MetadataResult;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
    this.inFlight.set(cacheKey, operation);
    return operation;
  }

  async readForArtwork(
    path: string,
    isAvailable: (artwork: ArtworkRef) => Promise<boolean>,
  ): Promise<MetadataResult> {
    let result = await this.read(path);
    if (
      result.fromCache &&
      result.hasEmbeddedArtwork &&
      (!result.artwork || !(await isAvailable(result.artwork)))
    ) {
      this.invalidate(result.cacheKey);
      result = await this.read(path);
    }
    return result;
  }

  rememberArtwork(cacheKey: string, artwork: ArtworkRef | null): void {
    const entry = this.cache.get(cacheKey);
    if (entry) entry.artwork = artwork;
  }

  invalidate(cacheKey: string): void {
    this.cache.delete(cacheKey);
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  private deleteOtherVersions(canonicalPath: string, currentKey: string): void {
    const prefix = `${canonicalPath}\0`;
    for (const key of this.cache.keys())
      if (key !== currentKey && key.startsWith(prefix)) this.cache.delete(key);
  }

  private trim(): void {
    while (this.cache.size > this.maxRecords) {
      const iterator = this.cache.keys().next();
      const oldest = iterator.done ? undefined : iterator.value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }
}
