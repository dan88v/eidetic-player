import type { PlayerTrack } from "./player.js";

export function formatSampleRate(sampleRate: number | null): string | null {
  if (!sampleRate || sampleRate <= 0) return null;
  const kilohertz = sampleRate / 1000;
  return `${kilohertz.toLocaleString("en", { maximumFractionDigits: 1 })} kHz`;
}

export function formatBitrate(bitrate: number | null): string | null {
  if (!bitrate || bitrate <= 0) return null;
  return `${String(Math.round(bitrate / 1000))} kbps`;
}

export function formatTechnicalName(value: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const compact = normalized.toLowerCase();
  if (compact === "opus") return "Opus";
  return normalized.replace(/[_-]+/g, " ").toUpperCase();
}

export function composeTechnicalDetails(
  track: Pick<
    PlayerTrack,
    "format" | "codec" | "bitDepth" | "sampleRate" | "bitrate" | "source"
  >,
): readonly string[] {
  const format = formatTechnicalName(track.format) ?? "";
  const codec = formatTechnicalName(track.codec) ?? "";
  const details = [
    format || codec,
    codec && codec.toLowerCase() !== format.toLowerCase() ? codec : null,
    track.bitDepth ? `${String(track.bitDepth)}-bit` : null,
    formatSampleRate(track.sampleRate),
    formatBitrate(track.bitrate),
    track.source,
  ];
  return details.filter(
    (value, index, values): value is string =>
      Boolean(value) &&
      values.findIndex(
        (candidate) => candidate?.toLowerCase() === value?.toLowerCase(),
      ) === index,
  );
}
