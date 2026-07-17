import type {
  ArtworkRef,
  PlayerTrack,
} from "../../../../packages/shared/src/player.js";
import type { NormalizedMetadata } from "./types.js";

function usable(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized;
}

export function fallbackTitle(
  parserTitle: string | null,
  mpvTitle: string | null,
  filenameWithoutExtension: string,
): string {
  return (
    usable(parserTitle) ??
    usable(mpvTitle) ??
    usable(filenameWithoutExtension) ??
    "Unknown Track"
  );
}

export function fallbackArtist(
  metadata: Pick<NormalizedMetadata, "artist" | "artists" | "albumArtist">,
  mpvArtist: string | null,
): string {
  return (
    usable(metadata.artist) ??
    (metadata.artists.length ? metadata.artists.join(", ") : null) ??
    usable(mpvArtist) ??
    usable(metadata.albumArtist) ??
    "Unknown Artist"
  );
}

export function fallbackAlbum(
  parserAlbum: string | null,
  mpvAlbum: string | null,
): string {
  return usable(parserAlbum) ?? usable(mpvAlbum) ?? "Unknown Album";
}

export function mergeTrackMetadata(
  mpv: PlayerTrack,
  metadata: NormalizedMetadata,
  artwork: ArtworkRef | null,
): PlayerTrack {
  const filenameTitle = mpv.filename.replace(/\.[^.]+$/, "");
  const mpvArtist = mpv.artist === "Unknown Artist" ? null : usable(mpv.artist);
  const mpvAlbum = mpv.album === "Unknown Album" ? null : usable(mpv.album);
  const codec = usable(mpv.codec) ?? usable(metadata.codec);
  const container = usable(metadata.container);
  return {
    ...mpv,
    title: fallbackTitle(metadata.title, mpv.title, filenameTitle),
    artist: fallbackArtist(metadata, mpvArtist),
    artists: metadata.artists,
    album: fallbackAlbum(metadata.album, mpvAlbum),
    albumArtist: metadata.albumArtist,
    trackNumber: metadata.trackNumber,
    trackTotal: metadata.trackTotal,
    discNumber: metadata.discNumber,
    discTotal: metadata.discTotal,
    year: metadata.year,
    genre: metadata.genre,
    durationSeconds:
      mpv.durationSeconds > 0
        ? mpv.durationSeconds
        : (metadata.durationSeconds ?? 0),
    format: (container ?? codec ?? mpv.format).toUpperCase(),
    codec,
    sampleRate: mpv.sampleRate ?? metadata.sampleRate,
    bitDepth: mpv.bitDepth ?? metadata.bitDepth,
    bitrate: metadata.bitrate,
    lossless: metadata.lossless,
    container,
    artwork,
  };
}
