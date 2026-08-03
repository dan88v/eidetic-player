import { TextDecoder } from "node:util";

const MAX_BUFFER_BYTES = 6 * 1024 * 1024;
const MAX_ARTWORK_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024;
const ALLOWED_CODES = new Set([
  "minm",
  "asar",
  "asal",
  "PICT",
  "pbeg",
  "pend",
  "prsm",
  "pfls",
  "prgr",
  "pvol",
  "mdst",
  "mden",
  "disc",
]);

export type AirPlayMetadataEvent =
  | {
      readonly kind: "text";
      readonly field: "title" | "artist" | "album";
      readonly value: string;
    }
  | {
      readonly kind: "artwork";
      readonly bytes: Buffer;
      readonly mimeType: "image/jpeg" | "image/png";
    }
  | {
      readonly kind: "progress";
      readonly positionSeconds: number;
      readonly durationSeconds: number;
    }
  | {
      readonly kind: "volume";
      readonly volume: number;
      readonly muted: boolean;
    }
  | { readonly kind: "playing" }
  | { readonly kind: "buffering" }
  | { readonly kind: "ended" }
  | { readonly kind: "disconnected" }
  | { readonly kind: "flush" }
  | { readonly kind: "metadata-start" }
  | { readonly kind: "metadata-end" };

function fourCC(hex: string): string | null {
  if (!/^[0-9a-f]{8}$/iu.test(hex)) return null;
  const bytes = Buffer.from(hex, "hex");
  return [...bytes].every((byte) => byte >= 0x20 && byte <= 0x7e)
    ? bytes.toString("ascii")
    : null;
}

function boundedText(bytes: Buffer): string | null {
  if (bytes.length > MAX_TEXT_BYTES) return null;
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .normalize("NFC")
      .trim();
  } catch {
    return null;
  }
  if (!decoded) return null;
  let result = "";
  let count = 0;
  for (const character of decoded) {
    const codePoint = character.codePointAt(0) ?? 0;
    result +=
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
        ? " "
        : character;
    count += 1;
    if (count >= 256) break;
  }
  return result.trim() || null;
}

function artworkType(bytes: Buffer): "image/jpeg" | "image/png" | null {
  if (bytes.length < 8 || bytes.length > MAX_ARTWORK_BYTES) return null;
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  return null;
}

function unsignedDistance(start: number, end: number): number {
  return end >= start ? end - start : 0x1_0000_0000 - start + end;
}

function parseProgress(
  bytes: Buffer,
  sampleRate: number,
): AirPlayMetadataEvent | null {
  const value = boundedText(bytes);
  if (!value) return null;
  const parts = value.split("/");
  if (parts.length !== 3) return null;
  const start = Number(parts[0]);
  const current = Number(parts[1]);
  const end = Number(parts[2]);
  if (
    ![start, current, end].every(
      (item) => Number.isSafeInteger(item) && item >= 0 && item <= 0xffff_ffff,
    )
  )
    return null;
  const durationFrames = unsignedDistance(start, end);
  const positionFrames = Math.min(
    durationFrames,
    unsignedDistance(start, current),
  );
  const durationSeconds = durationFrames / sampleRate;
  const positionSeconds = positionFrames / sampleRate;
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 86_400
  )
    return null;
  return { kind: "progress", positionSeconds, durationSeconds };
}

function parseVolume(bytes: Buffer): AirPlayMetadataEvent | null {
  const value = boundedText(bytes);
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item)))
    return null;
  const airplayVolume = parts[0] ?? Number.NaN;
  if (airplayVolume <= -144) return { kind: "volume", volume: 0, muted: true };
  if (airplayVolume < -30 || airplayVolume > 0) return null;
  const volume = Math.max(0, Math.min(100, ((airplayVolume + 30) / 30) * 100));
  return { kind: "volume", volume, muted: false };
}

export class AirPlayMetadataParser {
  private buffer = "";
  constructor(private readonly sampleRate = 48_000) {}

  push(chunk: Buffer | string): readonly AirPlayMetadataEvent[] {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("ascii");
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_BUFFER_BYTES) {
      this.buffer = "";
      return [];
    }
    const events: AirPlayMetadataEvent[] = [];
    for (;;) {
      const end = this.buffer.indexOf("</item>");
      if (end < 0) break;
      const item = this.buffer.slice(0, end + 7);
      this.buffer = this.buffer.slice(end + 7).replace(/^\s+/u, "");
      const event = this.parseItem(item);
      if (event) events.push(event);
    }
    return events;
  }

  reset(): void {
    this.buffer = "";
  }

  private parseItem(item: string): AirPlayMetadataEvent | null {
    const header =
      /^<item><type>([0-9a-f]{8})<\/type><code>([0-9a-f]{8})<\/code><length>(\d{1,8})<\/length>/iu.exec(
        item,
      );
    if (!header) return null;
    const type = fourCC(header[1] ?? "");
    const code = fourCC(header[2] ?? "");
    const length = Number(header[3]);
    if (
      !type ||
      !code ||
      !ALLOWED_CODES.has(code) ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_ARTWORK_BYTES
    )
      return null;
    const dataMatch =
      /<data encoding="base64">\s*([A-Za-z0-9+/=\s]*)<\/data>/u.exec(item);
    const encoded = dataMatch?.[1]?.replace(/\s+/gu, "") ?? "";
    if (
      encoded.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        encoded,
      )
    )
      return null;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== length) return null;
    if (type === "core") {
      const field =
        code === "minm"
          ? "title"
          : code === "asar"
            ? "artist"
            : code === "asal"
              ? "album"
              : null;
      const value = field ? boundedText(bytes) : null;
      return field && value ? { kind: "text", field, value } : null;
    }
    if (type !== "ssnc") return null;
    if (code === "PICT") {
      const mimeType = artworkType(bytes);
      return mimeType
        ? { kind: "artwork", bytes: Buffer.from(bytes), mimeType }
        : null;
    }
    if (code === "prgr") return parseProgress(bytes, this.sampleRate);
    if (code === "pvol") return parseVolume(bytes);
    if (code === "pbeg" || code === "prsm") return { kind: "playing" };
    if (code === "pend") return { kind: "ended" };
    if (code === "disc") return { kind: "disconnected" };
    if (code === "pfls") return { kind: "flush" };
    if (code === "mdst") return { kind: "metadata-start" };
    if (code === "mden") return { kind: "metadata-end" };
    return null;
  }
}
