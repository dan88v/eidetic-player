import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, lstat, open, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { performance } from "node:perf_hooks";
import type { PlaybackSourceCapabilities } from "../../../../packages/shared/src/playback-source.js";
import type {
  ExternalPlaybackProvider,
  ExternalPlaybackRoute,
  ExternalProviderEvent,
  ExternalProviderEventKind,
  ExternalProviderSnapshot,
} from "../playback-source/external-playback-provider.js";
import { PlaybackSourceError } from "../playback-source/playback-source-error.js";
import {
  AirPlayMetadataParser,
  type AirPlayMetadataEvent,
} from "./airplay-metadata-parser.js";
import type { AirPlayPlatformAdapter } from "./airplay-platform-adapter.js";

const CAPABILITIES: PlaybackSourceCapabilities = Object.freeze({
  play: false,
  pause: false,
  stop: false,
  previous: false,
  next: false,
  seek: false,
  volume: false,
  mute: false,
  metadata: true,
  artwork: true,
  progress: true,
});
const CONTROL_LIMIT = 256;
const CONTROL_TIMEOUT_MILLISECONDS = 4_000;

interface PendingGrant {
  readonly sessionId: string;
  readonly socket: Socket;
  readonly timeout: NodeJS.Timeout;
}

export class AirPlayProvider implements ExternalPlaybackProvider {
  readonly kind = "airplay" as const;
  readonly capabilities = CAPABILITIES;
  readonly automaticAcquisition = true;
  readonly seamlessSessionReplacement = true;
  private readonly listeners = new Set<
    (event: ExternalProviderEvent) => void
  >();
  private readonly parser: AirPlayMetadataParser;
  private server: Server | null = null;
  private metadataStream: ReturnType<typeof createReadStream> | null = null;
  private metadataHandle: Awaited<ReturnType<typeof open>> | null = null;
  private pending: PendingGrant | null = null;
  private volumeTimer: NodeJS.Timeout | null = null;
  private lastEmittedVolume = 100;
  private lastEmittedMuted = false;
  private pendingMetadata: ExternalProviderSnapshot["metadata"] | null = null;
  private metadataSequenceArtworkRevision: string | null = null;
  private preparedRoute: ExternalPlaybackRoute | null = null;
  private artwork: {
    readonly id: string;
    readonly revision: string;
    readonly mimeType: "image/jpeg" | "image/png";
    readonly bytes: Buffer;
  } | null = null;
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
    capabilities: CAPABILITIES,
  };

  constructor(
    private readonly platform: AirPlayPlatformAdapter,
    sampleRate = 48_000,
  ) {
    this.parser = new AirPlayMetadataParser(sampleRate);
  }

  async initialize(): Promise<void> {
    await this.platform.prepareRuntime();
    await this.startControlServer();
    if (
      process.platform !== "win32" &&
      process.env.EIDETIC_AIRPLAY_FIXTURE !== "1"
    )
      await this.startMetadataReader();
  }

  setPreparedRoute(route: ExternalPlaybackRoute): void {
    this.preparedRoute = { ...route };
  }

  ingestFixtureMetadata(chunk: Buffer | string): void {
    for (const event of this.parser.push(chunk)) this.receiveMetadata(event);
  }

  artworkResource(id: string): {
    readonly bytes: Buffer;
    readonly mimeType: string;
    readonly etag: string;
  } | null {
    if (this.artwork?.id !== id) return null;
    return {
      bytes: this.artwork.bytes,
      mimeType: this.artwork.mimeType,
      etag: `"${this.artwork.revision}"`,
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
    if (
      this.preparedRoute?.physicalOutputId !== route.physicalOutputId ||
      this.preparedRoute.providerTarget !== route.providerTarget ||
      this.preparedRoute.levelMode !== route.levelMode
    )
      throw new PlaybackSourceError(
        "EXTERNAL_OUTPUT_ROUTE_STALE",
        "AirPlay is not configured for the selected audio output.",
      );
    return Promise.resolve();
  }

  acquire(sessionId: string, generation: number): Promise<void> {
    if (this.pending?.sessionId !== sessionId)
      throw new PlaybackSourceError(
        "AIRPLAY_PREPLAY_SESSION_MISSING",
        "The AirPlay pre-play request is no longer active.",
      );
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timeout);
    this.current = { ...this.current, generation, state: "buffering" };
    pending.socket.end("GRANT\n");
    this.emit("buffering");
    return Promise.resolve();
  }

  release(generation: number): Promise<void> {
    this.denyPending();
    this.clearSessionResources();
    this.current = {
      ...this.current,
      generation,
      state: "stopped",
      sessionId: null,
      artwork: null,
    };
    return Promise.resolve();
  }

  async stop(generation: number): Promise<void> {
    const hadActiveSession = this.current.sessionId !== null && !this.pending;
    this.denyPending();
    if (hadActiveSession) await this.platform.restart();
    this.clearSessionResources();
    this.current = {
      ...this.current,
      generation,
      state: "stopped",
      sessionId: null,
      artwork: null,
    };
  }

  play(): Promise<void> {
    return this.unsupported();
  }
  pause(): Promise<void> {
    return this.unsupported();
  }
  previous(): Promise<void> {
    return this.unsupported();
  }
  next(): Promise<void> {
    return this.unsupported();
  }
  seek(): Promise<void> {
    return this.unsupported();
  }
  setVolume(): Promise<void> {
    return this.unsupported();
  }
  setMuted(): Promise<void> {
    return this.unsupported();
  }

  snapshot(): ExternalProviderSnapshot {
    return {
      ...this.current,
      metadata: this.current.metadata ? { ...this.current.metadata } : null,
      artwork: this.current.artwork ? { ...this.current.artwork } : null,
      capabilities: { ...CAPABILITIES },
    };
  }

  async shutdown(): Promise<void> {
    this.denyPending();
    this.clearSessionResources();
    await this.platform.stopRuntime().catch(() => undefined);
    this.listeners.clear();
    this.metadataStream?.destroy();
    this.metadataStream = null;
    await this.metadataHandle?.close().catch(() => undefined);
    this.metadataHandle = null;
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolveClose) =>
        server.close(() => {
          resolveClose();
        }),
      );
    }
    if (process.platform !== "win32")
      await unlink(this.platform.controlSocket).catch(() => undefined);
    await this.platform.close();
  }

  private unsupported(): Promise<void> {
    return Promise.reject(
      new PlaybackSourceError(
        "SOURCE_ACTION_NOT_SUPPORTED",
        "AirPlay does not support this action.",
      ),
    );
  }

  private async startControlServer(): Promise<void> {
    if (process.platform !== "win32") {
      try {
        const stats = await lstat(this.platform.controlSocket);
        if (stats.isSymbolicLink() || !stats.isSocket())
          throw new Error("Unsafe AirPlay control socket.");
        await unlink(this.platform.controlSocket);
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "ENOENT"
        )
          throw error;
      }
    }
    const server = createServer((socket) => {
      this.receiveControlSocket(socket);
    });
    this.server = server;
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(this.platform.controlSocket, resolveListen);
    });
    if (process.platform !== "win32")
      await chmod(this.platform.controlSocket, 0o600);
  }

  private receiveControlSocket(socket: Socket): void {
    socket.setEncoding("utf8");
    let input = "";
    const timeout = setTimeout(
      () => socket.destroy(),
      CONTROL_TIMEOUT_MILLISECONDS,
    );
    timeout.unref();
    socket.on("data", (chunk: string) => {
      input += chunk;
      if (input.length > CONTROL_LIMIT) return socket.destroy();
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      const command = input.slice(0, newline);
      socket.removeAllListeners("data");
      if (command === "BEFORE 1") this.beginSession(socket);
      else if (command === "AFTER 1") {
        socket.end("OK\n");
        if (this.current.sessionId) this.patch("stopped", "ended");
      } else socket.end("DENY\n");
    });
    socket.once("close", () => {
      clearTimeout(timeout);
    });
  }

  private beginSession(socket: Socket): void {
    if (this.pending) {
      socket.end("DENY\n");
      return;
    }
    const sessionId = `airplay-${randomUUID()}`;
    const timeout = setTimeout(() => {
      if (this.pending?.sessionId !== sessionId) return;
      this.pending = null;
      socket.end("DENY\n");
      this.patch("error", "error");
    }, CONTROL_TIMEOUT_MILLISECONDS);
    timeout.unref();
    this.pending = { sessionId, socket, timeout };
    this.artwork = null;
    this.parser.reset();
    this.pendingMetadata = null;
    this.metadataSequenceArtworkRevision = null;
    this.lastEmittedVolume =
      this.preparedRoute?.levelMode === "fixed" ? 100 : this.current.volume;
    this.lastEmittedMuted = false;
    this.current = {
      sessionId,
      generation: this.current.generation + 1,
      state: "buffering",
      metadata: {
        title: "AirPlay",
        artist: "",
        album: "",
        durationSeconds: null,
      },
      artwork: null,
      positionSeconds: null,
      durationSeconds: null,
      volume:
        this.preparedRoute?.levelMode === "fixed" ? 100 : this.current.volume,
      muted: false,
      capabilities: CAPABILITIES,
    };
    this.emit("session-starting");
  }

  private denyPending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timeout);
    this.pending.socket.end("DENY\n");
    this.pending = null;
  }

  private async startMetadataReader(): Promise<void> {
    this.metadataHandle = await open(
      this.platform.metadataPipe,
      constants.O_RDWR,
    );
    this.metadataStream = createReadStream(this.platform.metadataPipe, {
      fd: this.metadataHandle.fd,
      autoClose: false,
    });
    this.metadataStream.on("data", (chunk: Buffer | string) => {
      for (const event of this.parser.push(chunk)) this.receiveMetadata(event);
    });
    this.metadataStream.on("error", () => {
      if (this.current.sessionId) this.patch("error", "error");
    });
  }

  private receiveMetadata(event: AirPlayMetadataEvent): void {
    if (!this.current.sessionId) return;
    if (event.kind === "metadata-start") {
      this.metadataSequenceArtworkRevision =
        this.current.artwork?.revision ?? null;
      this.pendingMetadata = {
        title: "AirPlay",
        artist: "",
        album: "",
        durationSeconds: this.current.durationSeconds,
      };
    } else if (event.kind === "metadata-end") {
      if (!this.pendingMetadata) return;
      this.current = { ...this.current, metadata: this.pendingMetadata };
      this.pendingMetadata = null;
      if (
        this.current.artwork?.revision === this.metadataSequenceArtworkRevision
      ) {
        this.artwork = null;
        this.current = { ...this.current, artwork: null };
      }
      this.metadataSequenceArtworkRevision = null;
      this.emit("metadata");
    } else if (event.kind === "text") {
      const metadata = {
        title:
          this.pendingMetadata?.title ??
          this.current.metadata?.title ??
          "AirPlay",
        artist:
          this.pendingMetadata?.artist ?? this.current.metadata?.artist ?? "",
        album:
          this.pendingMetadata?.album ?? this.current.metadata?.album ?? "",
        durationSeconds: this.current.durationSeconds,
        [event.field]: event.value,
      };
      if (this.pendingMetadata) this.pendingMetadata = metadata;
      else {
        this.current = { ...this.current, metadata };
        this.emit("metadata");
      }
    } else if (event.kind === "artwork") {
      const revision = createHash("sha256").update(event.bytes).digest("hex");
      const id = `external-artwork-airplay-${randomUUID()}`;
      this.artwork = {
        id,
        revision,
        mimeType: event.mimeType,
        bytes: Buffer.from(event.bytes),
      };
      this.current = {
        ...this.current,
        artwork: { id, revision, mimeType: event.mimeType },
      };
      this.emit("artwork");
    } else if (event.kind === "progress") {
      this.current = {
        ...this.current,
        positionSeconds: event.positionSeconds,
        durationSeconds: event.durationSeconds,
        metadata: this.current.metadata
          ? { ...this.current.metadata, durationSeconds: event.durationSeconds }
          : null,
      };
      this.emit("progress");
    } else if (event.kind === "volume") {
      const fixed = this.preparedRoute?.levelMode === "fixed";
      this.current = {
        ...this.current,
        volume: fixed ? 100 : event.volume,
        muted: fixed ? false : event.muted,
      };
      if (
        Math.abs(this.current.volume - this.lastEmittedVolume) < 0.5 &&
        this.current.muted === this.lastEmittedMuted
      )
        return;
      if (this.volumeTimer) clearTimeout(this.volumeTimer);
      this.volumeTimer = setTimeout(() => {
        this.volumeTimer = null;
        this.lastEmittedVolume = this.current.volume;
        this.lastEmittedMuted = this.current.muted;
        this.emit(this.current.muted ? "mute" : "volume");
      }, 80);
      this.volumeTimer.unref();
    } else if (event.kind === "playing") this.patch("playing", "playing");
    else if (event.kind === "buffering" || event.kind === "flush")
      this.patch("buffering", "buffering");
    else if (event.kind === "ended") this.patch("stopped", "ended");
    else this.patch("stopped", "disconnected");
  }

  private patch(
    state: ExternalProviderSnapshot["state"],
    kind: ExternalProviderEventKind,
  ): void {
    if (kind === "ended" || kind === "disconnected" || kind === "error") {
      this.clearSessionResources();
    }
    this.current = {
      ...this.current,
      generation: this.current.generation + 1,
      state,
    };
    if (state === "stopped" || state === "error")
      this.current = { ...this.current, artwork: null };
    this.emit(kind);
  }

  private clearSessionResources(): void {
    this.artwork = null;
    this.pendingMetadata = null;
    this.metadataSequenceArtworkRevision = null;
    if (this.volumeTimer) clearTimeout(this.volumeTimer);
    this.volumeTimer = null;
  }

  private emit(kind: ExternalProviderEventKind): void {
    if (!this.current.sessionId) return;
    const event: ExternalProviderEvent = {
      kind,
      sessionId: this.current.sessionId,
      generation: this.current.generation,
      monotonicMilliseconds: performance.now(),
      snapshot: this.snapshot(),
    };
    for (const listener of this.listeners) listener(event);
  }
}
