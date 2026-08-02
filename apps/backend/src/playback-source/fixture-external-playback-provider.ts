import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  ExternalPlaybackMetadata,
  PlaybackSourceCapabilities,
  PlaybackSourceKind,
} from "../../../../packages/shared/src/playback-source.js";
import type {
  ExternalPlaybackProvider,
  ExternalPlaybackRoute,
  ExternalProviderEvent,
  ExternalProviderEventKind,
  ExternalProviderSnapshot,
} from "./external-playback-provider.js";
import { PlaybackSourceError } from "./playback-source-error.js";

const DEFAULT_CAPABILITIES: PlaybackSourceCapabilities = Object.freeze({
  play: true,
  pause: true,
  stop: true,
  previous: true,
  next: true,
  seek: true,
  volume: true,
  mute: true,
  metadata: true,
  artwork: true,
  progress: true,
});

const FIXTURE_PNG: Readonly<Record<"airplay" | "spotify", Buffer>> = {
  airplay: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACLSURBVHhe7dAxAQAgEIDAT2JJE38S3akAwy2MzLn7zIbBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYfEJdEkqmI34PAAAAAElFTkSuQmCC",
    "base64",
  ),
  spotify: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACLSURBVHhe7dAxAQAgEIDAT2I6c3413akAwy2MzNn7zIbBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYfKCB8g4H0aw8AAAAAElFTkSuQmCC",
    "base64",
  ),
};

export type FixturePlaybackAction =
  "play" | "pause" | "buffering" | "end" | "disconnect" | "crash";

export interface FixtureSessionInput {
  readonly title?: string;
  readonly artist?: string;
  readonly album?: string;
  readonly durationSeconds?: number;
  readonly volume?: number;
  readonly muted?: boolean;
}

function boundedText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.normalize("NFC").trim();
  if (text.length < 1 || text.length > 256) return fallback;
  let sanitized = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized +=
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
        ? " "
        : character;
  }
  return sanitized;
}

function boundedDuration(value: unknown, fallback: number): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 86_400
    ? value
    : fallback;
}

export class FixtureExternalPlaybackProvider implements ExternalPlaybackProvider {
  readonly capabilities = DEFAULT_CAPABILITIES;
  private readonly listeners = new Set<
    (event: ExternalProviderEvent) => void
  >();
  private route: ExternalPlaybackRoute | null = null;
  private failConfigure = false;
  private failAcquire = false;
  private failRelease = false;
  private routeSupported = true;
  private current: ExternalProviderSnapshot = {
    sessionId: null,
    generation: 0,
    state: "stopped",
    metadata: null,
    artwork: null,
    positionSeconds: null,
    durationSeconds: null,
    volume: 100,
    muted: false,
    capabilities: DEFAULT_CAPABILITIES,
  };

  constructor(readonly kind: Exclude<PlaybackSourceKind, "local">) {}

  prepareSession(input: FixtureSessionInput = {}): string {
    const sessionId = `${this.kind}-fixture-${randomUUID()}`;
    const duration = boundedDuration(input.durationSeconds, 240);
    const metadata: ExternalPlaybackMetadata = {
      title: boundedText(input.title, `${this.displayName()} fixture track`),
      artist: boundedText(input.artist, "Fixture Artist"),
      album: boundedText(input.album, "External Playback QA"),
      durationSeconds: duration,
    };
    this.current = {
      sessionId,
      generation: this.current.generation + 1,
      state: "buffering",
      metadata,
      artwork: {
        id: `external-artwork-${this.kind}-${randomUUID()}`,
        mimeType: "image/png",
        revision: randomUUID(),
      },
      positionSeconds: 0,
      durationSeconds: duration,
      volume:
        typeof input.volume === "number" && Number.isFinite(input.volume)
          ? Math.max(0, Math.min(100, input.volume))
          : 100,
      muted: input.muted === true,
      capabilities: this.capabilities,
    };
    this.emit("session-starting");
    return sessionId;
  }

  setFailureMode(input: {
    readonly configure?: boolean;
    readonly acquire?: boolean;
    readonly release?: boolean;
    readonly routeSupported?: boolean;
  }): void {
    if (typeof input.configure === "boolean")
      this.failConfigure = input.configure;
    if (typeof input.acquire === "boolean") this.failAcquire = input.acquire;
    if (typeof input.release === "boolean") this.failRelease = input.release;
    if (typeof input.routeSupported === "boolean")
      this.routeSupported = input.routeSupported;
  }

  simulate(action: FixturePlaybackAction): void {
    if (!this.current.sessionId)
      throw new PlaybackSourceError(
        "FIXTURE_SESSION_NOT_ACTIVE",
        "The fixture has no active session.",
      );
    if (action === "play") this.patch("playing", "playing");
    else if (action === "pause") this.patch("paused", "paused");
    else if (action === "buffering") this.patch("buffering", "buffering");
    else if (action === "end") this.patch("stopped", "ended");
    else if (action === "disconnect") this.patch("stopped", "disconnected");
    else this.patch("error", "error");
  }

  updateProgress(positionSeconds: number): void {
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0)
      throw new PlaybackSourceError(
        "INVALID_FIXTURE_PROGRESS",
        "Fixture progress is invalid.",
        400,
      );
    this.current = {
      ...this.current,
      positionSeconds: Math.min(
        this.current.durationSeconds ?? positionSeconds,
        positionSeconds,
      ),
    };
    this.emit("progress");
  }

  artworkResource(
    id: string,
  ): { readonly bytes: Buffer; readonly etag: string } | null {
    if (this.current.artwork?.id !== id) return null;
    return {
      bytes: FIXTURE_PNG[this.kind],
      etag: `"${this.current.artwork.revision}"`,
    };
  }

  probeActiveSession(): Promise<ExternalProviderSnapshot | null> {
    return Promise.resolve(
      this.current.sessionId && this.current.state !== "stopped"
        ? this.snapshot()
        : null,
    );
  }

  subscribe(listener: (event: ExternalProviderEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  configureOutput(route: ExternalPlaybackRoute): Promise<void> {
    if (!this.routeSupported || this.failConfigure)
      throw new PlaybackSourceError(
        "EXTERNAL_OUTPUT_ROUTE_UNSUPPORTED",
        `${this.displayName()} cannot use the selected audio output.`,
      );
    this.route = route;
    return Promise.resolve();
  }

  acquire(sessionId: string, generation: number): Promise<void> {
    if (this.failAcquire || this.current.sessionId !== sessionId || !this.route)
      throw new PlaybackSourceError(
        "EXTERNAL_SOURCE_ACQUIRE_FAILED",
        `${this.displayName()} could not acquire the audio output.`,
      );
    this.current = {
      ...this.current,
      generation,
      state: "playing",
    };
    this.emit("playing");
    return Promise.resolve();
  }

  release(generation: number): Promise<void> {
    if (this.failRelease)
      throw new PlaybackSourceError(
        "EXTERNAL_SOURCE_RELEASE_FAILED",
        `${this.displayName()} did not release the audio output.`,
      );
    this.current = { ...this.current, generation, state: "stopped" };
    this.route = null;
    return Promise.resolve();
  }

  stop(generation: number): Promise<void> {
    if (this.failRelease)
      throw new PlaybackSourceError(
        "EXTERNAL_SOURCE_RELEASE_FAILED",
        `${this.displayName()} did not stop playback.`,
      );
    this.current = { ...this.current, generation, state: "stopped" };
    return Promise.resolve();
  }

  play(generation: number): Promise<void> {
    this.requireCapability("play");
    this.current = { ...this.current, generation, state: "playing" };
    this.emit("playing");
    return Promise.resolve();
  }

  pause(generation: number): Promise<void> {
    this.requireCapability("pause");
    this.current = { ...this.current, generation, state: "paused" };
    this.emit("paused");
    return Promise.resolve();
  }

  previous(generation: number): Promise<void> {
    this.requireCapability("previous");
    this.current = { ...this.current, generation, positionSeconds: 0 };
    this.emit("progress");
    return Promise.resolve();
  }

  next(generation: number): Promise<void> {
    this.requireCapability("next");
    this.current = { ...this.current, generation, positionSeconds: 0 };
    this.emit("progress");
    return Promise.resolve();
  }

  seek(positionSeconds: number, generation: number): Promise<void> {
    this.requireCapability("seek");
    this.current = { ...this.current, generation };
    this.updateProgress(positionSeconds);
    return Promise.resolve();
  }

  setVolume(volume: number, generation: number): Promise<void> {
    this.requireCapability("volume");
    this.current = {
      ...this.current,
      generation,
      volume: Math.max(0, Math.min(100, volume)),
    };
    this.emit("volume");
    return Promise.resolve();
  }

  setMuted(muted: boolean, generation: number): Promise<void> {
    this.requireCapability("mute");
    this.current = { ...this.current, generation, muted };
    this.emit("mute");
    return Promise.resolve();
  }

  snapshot(): ExternalProviderSnapshot {
    return {
      ...this.current,
      metadata: this.current.metadata ? { ...this.current.metadata } : null,
      artwork: this.current.artwork ? { ...this.current.artwork } : null,
      capabilities: { ...this.current.capabilities },
    };
  }

  async shutdown(): Promise<void> {
    this.failRelease = false;
    await this.release(this.current.generation + 1).catch(() => undefined);
    this.listeners.clear();
  }

  private displayName(): string {
    return this.kind === "spotify" ? "Spotify Connect" : "AirPlay";
  }

  private patch(
    state: ExternalProviderSnapshot["state"],
    event: ExternalProviderEventKind,
  ): void {
    this.current = {
      ...this.current,
      generation: this.current.generation + 1,
      state,
    };
    this.emit(event);
  }

  private emit(kind: ExternalProviderEventKind): void {
    const sessionId = this.current.sessionId;
    if (!sessionId) return;
    const event: ExternalProviderEvent = {
      kind,
      sessionId,
      generation: this.current.generation,
      monotonicMilliseconds: performance.now(),
      snapshot: this.snapshot(),
    };
    for (const listener of this.listeners) listener(event);
  }

  private requireCapability(
    capability: keyof PlaybackSourceCapabilities,
  ): void {
    if (this.capabilities[capability]) return;
    throw new PlaybackSourceError(
      "SOURCE_ACTION_NOT_SUPPORTED",
      `${this.displayName()} does not support this action.`,
    );
  }
}
