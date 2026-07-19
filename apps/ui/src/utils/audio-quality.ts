import type { LibraryMetadataSummary } from "../../../../packages/shared/src/library";

export function formatAudioQuality(
  metadata: LibraryMetadataSummary,
  fallback: string,
): string {
  const parts: string[] = [];
  const format = metadata.container ?? metadata.format ?? metadata.codec;
  if (format) parts.push(format.toUpperCase());
  else if (fallback) parts.push(fallback.toUpperCase());
  const lossy =
    metadata.lossless === false ||
    /mp3|mpeg|aac|ogg|opus/i.test(format ?? fallback);
  if (lossy && metadata.bitrate)
    parts.push(`${String(Math.round(metadata.bitrate / 1000))} kbps`);
  else if (metadata.bitDepth) parts.push(`${String(metadata.bitDepth)}-bit`);
  if (!lossy && metadata.sampleRate) {
    const khz = metadata.sampleRate / 1000;
    parts.push(`${Number.isInteger(khz) ? String(khz) : khz.toFixed(1)} kHz`);
  } else if (!lossy && !metadata.bitDepth && metadata.bitrate) {
    parts.push(`${String(Math.round(metadata.bitrate / 1000))} kbps`);
  }
  return parts.join(" · ");
}
