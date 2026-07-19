import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { PlayerState } from "../../../../packages/shared/src/player.js";
import type { VisualizerFrame } from "../../../../packages/shared/src/visualizer.js";
import {
  ANALYSIS_SAMPLE_RATE,
  AudioAnalysisEngine,
  zeroFrame,
} from "./audio-analysis-engine.js";
import { analysisConfig } from "./analysis-config.js";
import {
  discoverFfmpeg,
  type FfmpegDiscoveryResult,
} from "./ffmpeg-discovery.js";
import { PcmStreamParser } from "./pcm-stream-parser.js";

type FrameListener = (frame: VisualizerFrame) => void;

export class AudioAnalyzerService {
  private discovery: FfmpegDiscoveryResult | null = null;
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private state: PlayerState | null = null;
  private subscriberCount = 0;
  private generation = 0;
  private readonly parser = new PcmStreamParser();
  private readonly engine = new AudioAnalysisEngine();
  private readonly listeners = new Set<FrameListener>();
  private samplesReceived = 0;
  private startPosition = 0;
  private lastEmission = 0;
  private activeTrackId: string | null = null;
  private activeTransitionId = -1;
  private failedTrackId: string | null = null;
  private lastDriftCheck = 0;
  private lastRestart = 0;
  private lifecycle: Promise<void> = Promise.resolve();
  private synchronizationQueued = false;
  private restartRequested = false;
  private subscriberStopTimer: NodeJS.Timeout | null = null;
  private starts = 0;
  private driftRestarts = 0;

  async initialize(mpvExecutable?: string): Promise<void> {
    this.discovery = await discoverFfmpeg(process.env, mpvExecutable);
    console.log(
      this.discovery
        ? `[ffmpeg] ${this.discovery.version}`
        : "[ffmpeg] unavailable; visualizer and waveform use fallback",
    );
    this.synchronize();
  }

  getDiscovery(): FfmpegDiscoveryResult | null {
    return this.discovery;
  }

  getDiagnostics(): {
    readonly starts: number;
    readonly driftRestarts: number;
    readonly activeProcesses: number;
  } {
    return {
      starts: this.starts,
      driftRestarts: this.driftRestarts,
      activeProcesses: this.child ? 1 : 0,
    };
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSubscriberCount(count: number): void {
    if (this.subscriberStopTimer) clearTimeout(this.subscriberStopTimer);
    this.subscriberStopTimer = null;
    const normalized = Math.max(0, count);
    if (normalized === 0 && this.subscriberCount > 0) {
      this.subscriberStopTimer = setTimeout(() => {
        this.subscriberStopTimer = null;
        this.subscriberCount = 0;
        this.synchronize();
      }, 200);
      return;
    }
    this.subscriberCount = normalized;
    this.synchronize();
  }

  updatePlayerState(state: PlayerState): void {
    const previousTrack = this.state?.currentTrack?.path ?? null;
    this.state = state;
    if (previousTrack !== state.currentTrack?.path) this.failedTrackId = null;
    this.synchronize();
    this.checkDrift();
  }

  restartAtCurrentPosition(): void {
    if (!this.shouldRun()) return;
    this.lastRestart = Date.now();
    this.synchronize(true);
  }

  async close(): Promise<void> {
    if (this.subscriberStopTimer) clearTimeout(this.subscriberStopTimer);
    this.subscriberStopTimer = null;
    this.subscriberCount = 0;
    this.synchronize();
    await this.lifecycle;
    this.listeners.clear();
  }

  private shouldRun(): boolean {
    return Boolean(
      analysisConfig.realTimeEnabled &&
      this.discovery &&
      this.subscriberCount > 0 &&
      this.state?.currentTrack?.path &&
      this.state.status === "playing" &&
      !this.state.paused &&
      this.failedTrackId !== this.state.currentTrack.path,
    );
  }

  private synchronize(forceRestart = false): void {
    this.restartRequested ||= forceRestart;
    if (this.synchronizationQueued) return;
    this.synchronizationQueued = true;
    this.lifecycle = this.lifecycle
      .catch(() => {
        // A failed transition must not poison later lifecycle operations.
      })
      .then(async () => {
        this.synchronizationQueued = false;
        const restart = this.restartRequested;
        this.restartRequested = false;
        if (!this.shouldRun()) {
          if (this.child) await this.stop(true);
          return;
        }
        const trackId =
          this.state?.queue[this.state.currentQueueIndex]?.id ?? null;
        if (
          restart ||
          !this.child ||
          trackId !== this.activeTrackId ||
          this.state?.trackTransitionId !== this.activeTransitionId
        )
          await this.start();
      });
  }

  private async start(): Promise<void> {
    const discovery = this.discovery;
    const state = this.state;
    const path = state?.currentTrack?.path;
    const trackId = state?.queue[state.currentQueueIndex]?.id;
    if (!discovery || !state || !path || !trackId || !this.shouldRun()) return;
    await this.stop(false);
    if (!this.shouldRun()) return;
    const generation = ++this.generation;
    this.parser.reset();
    this.engine.reset();
    this.samplesReceived = 0;
    this.startPosition = Math.max(0, state.positionSeconds);
    this.activeTrackId = trackId;
    this.activeTransitionId = state.trackTransitionId;
    this.starts += 1;
    const analyzerStartedAt = Date.now();
    const child = spawn(
      discovery.executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-re",
        "-ss",
        this.startPosition.toFixed(3),
        "-i",
        path,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-ac",
        String(analysisConfig.channels),
        "-ar",
        String(analysisConfig.sampleRate),
        "-f",
        "f32le",
        "-flush_packets",
        "1",
        "-blocksize",
        "4800",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.child = child;
    let startupSamplesToDiscard: number | null = null;
    child.stdout.on("data", (chunk: Buffer) => {
      if (generation !== this.generation) return;
      let values = this.parser.push(chunk);
      if (startupSamplesToDiscard === null) {
        const current = this.state;
        const playerDrift =
          current?.trackTransitionId === state.trackTransitionId
            ? Math.max(0, current.positionSeconds - this.startPosition)
            : 0;
        const startupDrift =
          current?.trackTransitionId === state.trackTransitionId &&
          !current.paused
            ? Math.max(playerDrift, (Date.now() - analyzerStartedAt) / 1_000)
            : playerDrift;
        const catchupSeconds = Math.min(
          startupDrift,
          analysisConfig.startupCatchupMaximumSeconds,
        );
        startupSamplesToDiscard = Math.floor(
          catchupSeconds * ANALYSIS_SAMPLE_RATE,
        );
        this.startPosition += startupSamplesToDiscard / ANALYSIS_SAMPLE_RATE;
      }
      if (startupSamplesToDiscard > 0) {
        const valuesToDiscard = Math.min(
          values.length,
          startupSamplesToDiscard * analysisConfig.channels,
        );
        values = values.subarray(valuesToDiscard);
        startupSamplesToDiscard -= Math.floor(
          valuesToDiscard / analysisConfig.channels,
        );
      }
      const frames = this.engine.push(
        values,
        trackId,
        this.startPosition,
        state.trackTransitionId,
        state.playerSessionId,
      );
      this.samplesReceived += Math.floor(values.length / 2);
      for (const frame of frames) {
        const now = Date.now();
        if (
          now - this.lastEmission <
          1_000 / analysisConfig.maximumFramesPerSecond
        )
          continue;
        this.lastEmission = now;
        this.emit(frame);
      }
    });
    let errorText = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorText.length < 2_048) errorText += chunk.toString();
    });
    child.once("error", (error) => {
      if (generation !== this.generation) return;
      this.failedTrackId = path;
      console.warn("[analyzer] FFmpeg process failed", error);
      this.synchronize();
    });
    child.once("exit", (code) => {
      if (generation !== this.generation || this.child !== child) return;
      this.child = null;
      if (code && this.shouldRun()) {
        this.failedTrackId = path;
        console.warn(
          `[analyzer] FFmpeg exited (${String(code)}): ${errorText.trim()}`,
        );
        this.emit(
          zeroFrame(trackId, 0, state.trackTransitionId, state.playerSessionId),
        );
      }
      this.synchronize();
    });
  }

  private async stop(emitZero: boolean): Promise<void> {
    const child = this.child;
    this.child = null;
    this.generation += 1;
    this.parser.reset();
    this.engine.reset();
    if (child) {
      child.kill();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 800);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (emitZero)
      this.emit(
        zeroFrame(
          this.activeTrackId,
          0,
          this.activeTransitionId,
          this.state?.playerSessionId ?? "",
        ),
      );
    this.activeTrackId = null;
    this.activeTransitionId = -1;
  }

  private emit(frame: VisualizerFrame): void {
    for (const listener of this.listeners) listener(frame);
  }

  private checkDrift(): void {
    if (!this.child || !this.state || Date.now() - this.lastDriftCheck < 2_000)
      return;
    this.lastDriftCheck = Date.now();
    const estimated =
      this.startPosition + this.samplesReceived / ANALYSIS_SAMPLE_RATE;
    if (
      Math.abs(estimated - this.state.positionSeconds) >
        analysisConfig.driftRestartSeconds &&
      Date.now() - this.lastRestart >
        analysisConfig.driftRestartCooldownMilliseconds
    ) {
      this.lastRestart = Date.now();
      this.driftRestarts += 1;
      this.synchronize(true);
    }
  }
}
