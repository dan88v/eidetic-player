import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import type { WaveformResponse } from "../../../../packages/shared/src/visualizer.js";
import type { FfmpegDiscoveryResult } from "./ffmpeg-discovery.js";

interface CachedWaveform {
  readonly fingerprint: string;
  readonly points: readonly number[];
}

export class WaveformService {
  private readonly cache = new Map<string, CachedWaveform>();
  private chain: Promise<void> = Promise.resolve();
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private closing = false;

  constructor(private readonly discovery: () => FfmpegDiscoveryResult | null) {}

  async get(
    queueItemId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<WaveformResponse> {
    const canonical = resolve(path);
    const details = await stat(canonical);
    const fingerprint = createHash("sha256")
      .update(
        `${canonical.toLocaleLowerCase("en")}:${String(details.size)}:${String(details.mtimeMs)}`,
      )
      .digest("base64url");
    const cached = this.cache.get(fingerprint);
    if (cached) {
      this.cache.delete(fingerprint);
      this.cache.set(fingerprint, cached);
      return {
        queueItemId,
        fingerprint,
        points: cached.points,
        status: "ready",
        source: "real",
      };
    }
    if (!this.discovery())
      return {
        queueItemId,
        fingerprint,
        points: [],
        status: "unavailable",
        source: "fallback",
      };
    let points: readonly number[];
    const previous = this.chain;
    let release = (): void => undefined;
    this.chain = new Promise<void>((resolveChain) => {
      release = resolveChain;
    });
    await previous;
    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      points = await this.generate(canonical, signal);
      this.cache.set(fingerprint, { fingerprint, points });
      while (this.cache.size > 64) {
        const oldest = this.cache.keys().next().value;
        if (!oldest) break;
        this.cache.delete(oldest);
      }
    } finally {
      release();
    }
    return {
      queueItemId,
      fingerprint,
      points,
      status: "ready",
      source: "real",
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    this.child?.kill("SIGKILL");
    this.child = null;
    await this.chain;
    this.cache.clear();
  }

  cancel(): void {
    this.child?.kill("SIGKILL");
  }

  private async generate(
    path: string,
    signal?: AbortSignal,
  ): Promise<number[]> {
    const discovery = this.discovery();
    if (!discovery || this.closing) throw new Error("FFmpeg is unavailable");
    const child = spawn(
      discovery.executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.child = child;
    const peaks: number[] = [];
    let remainder: Buffer | null = null;
    let blockSize = 128;
    let blockCount = 0;
    let blockPeak = 0;
    const compact = (): void => {
      const merged: number[] = [];
      for (let index = 0; index < peaks.length; index += 2)
        merged.push(Math.max(peaks[index] ?? 0, peaks[index + 1] ?? 0));
      peaks.splice(0, peaks.length, ...merged);
      blockSize *= 2;
    };
    child.stdout.on("data", (chunk: Buffer) => {
      const data = remainder ? Buffer.concat([remainder, chunk]) : chunk;
      const byteLength = data.length - (data.length % 2);
      remainder = byteLength < data.length ? data.subarray(byteLength) : null;
      for (let offset = 0; offset < byteLength; offset += 2) {
        blockPeak = Math.max(
          blockPeak,
          Math.abs(data.readInt16LE(offset)) / 32_768,
        );
        blockCount += 1;
        if (blockCount >= blockSize) {
          peaks.push(blockPeak);
          blockCount = 0;
          blockPeak = 0;
          if (peaks.length > 1_024) compact();
        }
      }
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 2_048) stderr += chunk.toString();
    });
    const abort = (): void => {
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", abort, { once: true });
    const code = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", resolveExit);
    });
    signal?.removeEventListener("abort", abort);
    this.child = null;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (code !== 0) throw new Error(`FFmpeg waveform failed: ${stderr.trim()}`);
    if (blockCount > 0) peaks.push(blockPeak);
    return normalizeAndResample(peaks, 512);
  }
}

export function normalizeAndResample(
  values: readonly number[],
  count: number,
): number[] {
  if (values.length === 0) return Array(count).fill(0) as number[];
  const sorted = [...values].sort((left, right) => left - right);
  const reference = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;
  const scale = reference > 1e-9 ? reference : 1;
  return Array.from({ length: count }, (_, index) => {
    const source = (index * (values.length - 1)) / Math.max(1, count - 1);
    const lower = Math.floor(source);
    const fraction = source - lower;
    const value =
      (values[lower] ?? 0) * (1 - fraction) +
      (values[Math.min(values.length - 1, lower + 1)] ?? 0) * fraction;
    return Math.max(0, Math.min(1, Math.sqrt(value / scale)));
  });
}
