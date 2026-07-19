import type { ArtworkRef } from "../../../../packages/shared/src/player.js";

export interface PictureCandidate {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly type: string | null;
  readonly description: string | null;
}

export interface NormalizedMetadata {
  readonly title: string | null;
  readonly artist: string | null;
  readonly artists: readonly string[];
  readonly album: string | null;
  readonly albumArtist: string | null;
  readonly trackNumber: number | null;
  readonly trackTotal: number | null;
  readonly discNumber: number | null;
  readonly discTotal: number | null;
  readonly year: number | null;
  readonly genre: readonly string[];
  readonly durationSeconds: number | null;
  readonly codec: string | null;
  readonly container: string | null;
  readonly sampleRate: number | null;
  readonly bitDepth: number | null;
  readonly bitrate: number | null;
  readonly channels: number | null;
  readonly lossless: boolean | null;
  readonly compilation: boolean;
}

export interface MetadataResult {
  readonly cacheKey: string;
  readonly metadata: NormalizedMetadata;
  readonly pictures: readonly PictureCandidate[];
  readonly artwork: ArtworkRef | null;
  readonly hasEmbeddedArtwork: boolean;
  readonly errorCode: string | null;
  readonly fromCache: boolean;
}
