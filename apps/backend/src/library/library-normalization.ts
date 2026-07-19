import { createHash } from "node:crypto";
import type { NormalizedMetadata } from "../metadata/types.js";

export interface NormalizedArtistIdentity {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
}

export interface NormalizedAlbumIdentity {
  readonly id: string;
  readonly key: string;
  readonly displayTitle: string;
  readonly albumArtistKey: string | null;
  readonly albumArtistDisplay: string | null;
}

export function normalizeLibraryIdentity(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en");
}

function stableId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}-${createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 32)}`;
}

export function trackIdentity(sourceId: string, relativePath: string): string {
  return stableId("track", sourceId, relativePath);
}

export function artistIdentity(
  displayName: string,
): NormalizedArtistIdentity | null {
  const key = normalizeLibraryIdentity(displayName);
  if (!key) return null;
  return {
    id: stableId("artist", key),
    key,
    displayName: displayName.normalize("NFC").trim().replace(/\s+/gu, " "),
  };
}

export function trackArtists(
  metadata: NormalizedMetadata,
): readonly NormalizedArtistIdentity[] {
  const values =
    metadata.artists.length > 0
      ? metadata.artists
      : metadata.artist
        ? [metadata.artist]
        : [];
  const result = new Map<string, NormalizedArtistIdentity>();
  for (const value of values) {
    const identity = artistIdentity(value);
    if (identity && !result.has(identity.key))
      result.set(identity.key, identity);
  }
  return [...result.values()];
}

export function albumIdentity(
  sourceId: string,
  metadata: NormalizedMetadata,
): NormalizedAlbumIdentity | null {
  if (!metadata.album) return null;
  const titleKey = normalizeLibraryIdentity(metadata.album);
  if (!titleKey) return null;
  const trackArtist = trackArtists(metadata)[0] ?? null;
  const albumArtistDisplay =
    metadata.albumArtist ??
    (metadata.compilation ? "Various Artists" : trackArtist?.displayName) ??
    null;
  const albumArtistKey = albumArtistDisplay
    ? normalizeLibraryIdentity(albumArtistDisplay)
    : null;
  const ownershipKey = albumArtistKey
    ? `artist:${albumArtistKey}`
    : `source:${sourceId}`;
  const key = `${titleKey}\0${ownershipKey}`;
  return {
    id: stableId("album", key),
    key,
    displayTitle: metadata.album.normalize("NFC").trim().replace(/\s+/gu, " "),
    albumArtistKey,
    albumArtistDisplay,
  };
}
