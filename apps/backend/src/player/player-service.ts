import { basename, extname } from "node:path";
import type {
  ArtworkRef,
  PlayerState,
  PlayerTrack,
  QueueItem,
  RepeatMode,
} from "../../../../packages/shared/src/player.js";
import {
  ArtworkService,
  type ArtworkResource,
} from "../artwork/artwork-service.js";
import { mergeTrackMetadata } from "../metadata/metadata-merge.js";
import { isCurrentEnrichment } from "../metadata/enrichment-guard.js";
import { MetadataService } from "../metadata/metadata-service.js";
import type { NormalizedMetadata } from "../metadata/types.js";
import { discoverMpv } from "./mpv-discovery.js";
import { MpvController } from "./mpv-controller.js";
import type { MpvResponse } from "./mpv-transport.js";
import { PlayerError } from "./player-error.js";
import { buildQueue } from "./queue-builder.js";
import { LimitedConcurrency } from "../utils/limited-concurrency.js";

type StateListener = (state: PlayerState) => void;

const initialState: PlayerState = {
  status: "loading",
  mpvAvailable: false,
  mpvVersion: null,
  currentTrack: null,
  positionSeconds: 0,
  durationSeconds: 0,
  paused: true,
  volume: 100,
  muted: false,
  shuffleEnabled: false,
  repeatMode: "off",
  currentQueueIndex: -1,
  queue: [],
  audioDevice: "Default output",
  error: null,
};

interface MpvPlaylistEntry {
  readonly filename?: unknown;
  readonly title?: unknown;
  readonly current?: unknown;
  readonly playing?: unknown;
}

interface AudioParameters {
  readonly samplerate?: unknown;
}

export class PlayerService {
  private state: PlayerState = initialState;
  private controller: MpvController | null = null;
  private executable: string | null = null;
  private unsubscribeMpv: (() => void) | null = null;
  private readonly listeners = new Set<StateListener>();
  private readonly properties = new Map<string, unknown>();
  private originalQueue: string[] = [];
  private readonly itemIds = new Map<string, string>();
  private nextItemId = 0;
  private restartAttempted = false;
  private shuttingDown = false;
  private positionTimer: NodeJS.Timeout | null = null;
  private pendingPosition: number | null = null;
  private enrichmentGeneration = 0;
  private enrichmentPathKey: string | null = null;
  private currentEnrichment: {
    readonly pathKey: string;
    readonly metadata: NormalizedMetadata;
    readonly artwork: ArtworkRef | null;
  } | null = null;
  private priorityParsing: Promise<void> = Promise.resolve();
  private preloadParsing: Promise<void> = Promise.resolve();
  private nextArtwork: ArtworkRef | null = null;
  private readonly queueArtworkConcurrency = new LimitedConcurrency(2);

  constructor(
    private readonly metadataService = new MetadataService(),
    private readonly artworkService = new ArtworkService(),
  ) {}

  getState(): PlayerState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    const discovery = await discoverMpv();
    if (!discovery) {
      this.update({
        status: "unavailable",
        mpvAvailable: false,
        error: {
          code: "MPV_NOT_FOUND",
          message: "MPV was not found. Check EIDETIC_MPV_PATH or your PATH.",
        },
      });
      return;
    }
    this.executable = discovery.executable;
    this.update({
      mpvAvailable: true,
      mpvVersion: discovery.version,
      status: "loading",
      error: null,
    });
    try {
      await this.startController();
      this.update({ status: "idle", paused: true });
      await this.refreshProperties();
    } catch (error) {
      await this.controller?.stop().catch(() => {
        // Preserve the original startup error.
      });
      this.controller = null;
      this.updateError(
        "MPV_START_FAILED",
        "MPV could not be started or its IPC endpoint was unavailable.",
      );
      console.error("[player] MPV startup failed", error);
    }
  }

  async open(paths: readonly string[]): Promise<void> {
    const controller = this.requireController();
    const queue = await buildQueue(paths);
    this.update({ status: "loading", error: null });
    this.originalQueue = [...queue];
    try {
      await controller.loadPlaylist(queue);
      if (this.state.shuffleEnabled)
        await controller.command(["playlist-shuffle"]);
      await controller.setProperty("pause", false);
      await this.refreshProperties();
    } catch (error) {
      this.updateError(
        "OPEN_FAILED",
        "The selected audio files could not be opened.",
      );
      console.error("[player] opening playlist failed", error);
      throw new PlayerError(
        "OPEN_FAILED",
        "The selected audio files could not be opened.",
        422,
      );
    }
  }

  async playPause(): Promise<void> {
    this.requireTrack();
    await this.requireController().command(["cycle", "pause"]);
  }

  async play(): Promise<void> {
    this.requireTrack();
    await this.requireController().setProperty("pause", false);
  }

  async pause(): Promise<void> {
    this.requireTrack();
    await this.requireController().setProperty("pause", true);
  }

  async previous(): Promise<void> {
    this.requireTrack();
    const controller = this.requireController();
    if (this.state.positionSeconds > 3) {
      await controller.command(["seek", 0, "absolute+exact"]);
      return;
    }
    if (this.state.currentQueueIndex > 0)
      await controller.command(["playlist-prev", "weak"]);
  }

  async next(): Promise<void> {
    this.requireTrack();
    const hasNext = this.state.currentQueueIndex < this.state.queue.length - 1;
    if (hasNext || this.state.repeatMode === "all")
      await this.requireController().command(["playlist-next", "weak"]);
  }

  async seek(positionSeconds: number): Promise<void> {
    this.requireTrack();
    const target = Math.max(
      0,
      Math.min(this.state.durationSeconds, positionSeconds),
    );
    await this.requireController().command(["seek", target, "absolute+exact"]);
  }

  async setVolume(volume: number): Promise<void> {
    await this.requireController().setProperty("volume", volume);
  }

  async setMuted(muted: boolean): Promise<void> {
    await this.requireController().setProperty("mute", muted);
  }

  async setRepeatMode(mode: RepeatMode): Promise<void> {
    const controller = this.requireController();
    await controller.setProperty("loop-file", mode === "one" ? "inf" : "no");
    await controller.setProperty(
      "loop-playlist",
      mode === "all" ? "inf" : "no",
    );
    this.update({ repeatMode: mode });
  }

  async setShuffle(enabled: boolean): Promise<void> {
    const controller = this.requireController();
    if (enabled === this.state.shuffleEnabled) return;
    if (this.state.queue.length > 1) {
      if (enabled) {
        await controller.command(["playlist-shuffle"]);
      } else {
        const currentPath = this.state.currentTrack?.path;
        const position = this.state.positionSeconds;
        const paused = this.state.paused;
        await controller.loadPlaylist(this.originalQueue);
        const index = currentPath
          ? this.originalQueue.findIndex(
              (path) => this.pathKey(path) === this.pathKey(currentPath),
            )
          : 0;
        await controller.setProperty("playlist-pos", Math.max(0, index));
        await controller.command(["seek", position, "absolute+exact"]);
        await controller.setProperty("pause", paused);
      }
      await this.refreshProperties();
    }
    this.update({ shuffleEnabled: enabled });
  }

  async playQueueIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.state.queue.length)
      throw new PlayerError(
        "INVALID_QUEUE_INDEX",
        "Queue index is out of range.",
      );
    await this.requireController().setProperty("playlist-pos", index);
  }

  getArtworkResource(id: string): Promise<ArtworkResource | null> {
    return this.artworkService.getResource(id);
  }

  async resolveQueueArtwork(queueItemId: string): Promise<ArtworkRef | null> {
    if (!/^queue-\d+$/.test(queueItemId)) return null;
    const item = this.state.queue.find(
      (candidate) => candidate.id === queueItemId,
    );
    if (!item) return null;
    return this.queueArtworkConcurrency.run(async () => {
      try {
        const result = await this.resolveEnrichment(item.path);
        return result.artwork;
      } catch (error) {
        console.warn("[metadata] queue artwork resolution failed", error);
        return null;
      }
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.enrichmentGeneration += 1;
    if (this.positionTimer) clearTimeout(this.positionTimer);
    this.positionTimer = null;
    this.unsubscribeMpv?.();
    this.unsubscribeMpv = null;
    await this.controller?.stop();
    this.controller = null;
    this.metadataService.clear();
    await this.artworkService.close();
    this.listeners.clear();
  }

  private async startController(): Promise<void> {
    if (!this.executable) return;
    const controller = new MpvController();
    await controller.start({
      executable: this.executable,
      onUnexpectedExit: () => void this.handleUnexpectedExit(),
    });
    this.controller = controller;
    this.unsubscribeMpv = controller.subscribe((message) => {
      this.handleMpvMessage(message);
    });
  }

  private async handleUnexpectedExit(): Promise<void> {
    this.controller = null;
    this.unsubscribeMpv?.();
    this.unsubscribeMpv = null;
    if (this.shuttingDown) return;
    this.updateError("MPV_EXITED", "MPV stopped unexpectedly.");
    if (this.restartAttempted || !this.executable) return;
    this.restartAttempted = true;
    try {
      await this.startController();
      this.originalQueue = [];
      this.properties.clear();
      this.update({
        status: "idle",
        currentTrack: null,
        queue: [],
        currentQueueIndex: -1,
        positionSeconds: 0,
        durationSeconds: 0,
        paused: true,
        error: null,
      });
    } catch (error) {
      console.error("[player] controlled MPV restart failed", error);
    }
  }

  private handleMpvMessage(message: MpvResponse): void {
    if (
      message.event === "property-change" &&
      typeof message.name === "string"
    ) {
      this.properties.set(message.name, message.data);
      if (message.name === "time-pos") {
        this.queuePositionUpdate(this.asNumber(message.data));
      } else {
        if (message.name === "pause") this.flushPosition();
        this.deriveStateFromProperties();
      }
      return;
    }
    switch (message.event) {
      case "start-file":
        this.enrichmentGeneration += 1;
        this.enrichmentPathKey = null;
        this.currentEnrichment = null;
        this.nextArtwork = null;
        this.artworkService.setPinned([]);
        this.update({ status: "loading", currentTrack: null, error: null });
        break;
      case "file-loaded":
      case "playback-restart":
        void this.refreshProperties();
        break;
      case "end-file":
        if ((message as { reason?: unknown }).reason === "error")
          this.updateError("PLAYBACK_FAILED", "MPV could not play this file.");
        else this.flushPosition();
        break;
      case "idle":
        this.update({
          status: this.state.queue.length ? "stopped" : "idle",
          paused: true,
        });
        break;
      case "shutdown":
        if (!this.shuttingDown)
          this.updateError("MPV_SHUTDOWN", "MPV has shut down.");
        break;
    }
  }

  private async refreshProperties(): Promise<void> {
    const controller = this.controller;
    if (!controller) return;
    const names = [
      "pause",
      "time-pos",
      "duration",
      "playlist",
      "playlist-pos",
      "media-title",
      "metadata",
      "path",
      "audio-params",
      "audio-codec-name",
      "volume",
      "mute",
      "idle-active",
      "audio-device",
    ];
    const values = await Promise.all(
      names.map(async (name) => {
        try {
          return await controller.getProperty(name);
        } catch {
          return undefined;
        }
      }),
    );
    names.forEach((name, index) => this.properties.set(name, values[index]));
    this.deriveStateFromProperties();
  }

  private deriveStateFromProperties(): void {
    const pause = this.asBoolean(this.properties.get("pause"), true);
    const idle = this.asBoolean(this.properties.get("idle-active"), false);
    const duration = this.asNumber(this.properties.get("duration"));
    const path = this.asString(this.properties.get("path"));
    const playlistIndex = Math.trunc(
      this.asNumber(this.properties.get("playlist-pos"), -1),
    );
    const queue = this.createQueue(
      this.properties.get("playlist"),
      playlistIndex,
    );
    const nextPathKey = path ? this.pathKey(path) : null;
    const trackChanged = nextPathKey !== this.enrichmentPathKey;
    if (trackChanged) {
      this.enrichmentPathKey = nextPathKey;
      this.enrichmentGeneration += 1;
      this.currentEnrichment = null;
      this.nextArtwork = null;
      this.artworkService.setPinned([]);
    }
    const currentTrack = path ? this.createTrack(path, duration) : null;
    this.update({
      paused: pause,
      status: idle
        ? queue.length
          ? "stopped"
          : "idle"
        : pause
          ? "paused"
          : "playing",
      durationSeconds: duration,
      positionSeconds: this.asNumber(
        this.properties.get("time-pos"),
        this.state.positionSeconds,
      ),
      currentQueueIndex: playlistIndex,
      queue,
      currentTrack,
      volume: Math.max(
        0,
        Math.min(
          100,
          this.asNumber(this.properties.get("volume"), this.state.volume),
        ),
      ),
      muted: this.asBoolean(this.properties.get("mute"), this.state.muted),
      audioDevice: this.formatAudioDevice(this.properties.get("audio-device")),
      error: null,
    });
    if (trackChanged && path) {
      const nextPath = queue[playlistIndex + 1]?.path ?? null;
      this.scheduleCurrentEnrichment(path, nextPath);
    }
  }

  private createQueue(value: unknown, currentIndex: number): QueueItem[] {
    if (!Array.isArray(value)) return this.state.queue as QueueItem[];
    return value.flatMap((entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const playlistEntry = entry as MpvPlaylistEntry;
      const path = this.asString(playlistEntry.filename);
      if (!path) return [];
      const filename = basename(path);
      const key = this.pathKey(path);
      const previous = this.state.queue.find(
        (item) => this.pathKey(item.path) === key,
      );
      let id = this.itemIds.get(key);
      if (!id) {
        id = `queue-${String(++this.nextItemId)}`;
        this.itemIds.set(key, id);
      }
      return [
        {
          id,
          index,
          path,
          filename,
          displayTitle:
            this.asString(playlistEntry.title) ??
            filename.replace(/\.[^.]+$/, ""),
          artwork: previous?.artwork ?? null,
          isCurrent:
            index === currentIndex ||
            playlistEntry.current === true ||
            playlistEntry.playing === true,
        },
      ];
    });
  }

  private createTrack(path: string, durationSeconds: number): PlayerTrack {
    const metadataValue = this.properties.get("metadata");
    const metadata =
      metadataValue && typeof metadataValue === "object"
        ? (metadataValue as Record<string, unknown>)
        : {};
    const getMetadata = (...names: string[]): string | null => {
      for (const [key, value] of Object.entries(metadata)) {
        if (
          names.some((name) => key.toLowerCase() === name.toLowerCase()) &&
          typeof value === "string" &&
          value.trim()
        )
          return value.trim();
      }
      return null;
    };
    const filename = basename(path);
    const audioParameters = this.properties.get("audio-params") as
      AudioParameters | undefined;
    const bitDepthText = getMetadata(
      "bits_per_raw_sample",
      "bits_per_sample",
      "bitdepth",
    );
    const parsedBitDepth = bitDepthText
      ? Number.parseInt(bitDepthText, 10)
      : Number.NaN;
    const codec = this.asString(this.properties.get("audio-codec-name"));
    const baseTrack: PlayerTrack = {
      path,
      filename,
      title: getMetadata("title") ?? filename.replace(/\.[^.]+$/, ""),
      artist: getMetadata("artist", "album_artist") ?? "Unknown Artist",
      album: getMetadata("album") ?? "Unknown Album",
      artists: [],
      albumArtist: null,
      trackNumber: null,
      trackTotal: null,
      discNumber: null,
      discTotal: null,
      year: null,
      genre: [],
      durationSeconds,
      format: ((codec ?? extname(filename).slice(1)) || "audio").toUpperCase(),
      codec,
      sampleRate: audioParameters
        ? this.asNullableNumber(audioParameters.samplerate)
        : null,
      bitDepth:
        Number.isInteger(parsedBitDepth) && parsedBitDepth > 0
          ? parsedBitDepth
          : null,
      bitrate: null,
      lossless: null,
      container: null,
      artwork: null,
      source: "Local File",
    };
    return this.currentEnrichment?.pathKey === this.pathKey(path)
      ? mergeTrackMetadata(
          baseTrack,
          this.currentEnrichment.metadata,
          this.currentEnrichment.artwork,
        )
      : baseTrack;
  }

  private scheduleCurrentEnrichment(
    path: string,
    nextPath: string | null,
  ): void {
    const generation = this.enrichmentGeneration;
    this.priorityParsing = this.priorityParsing
      .catch(() => {
        // Keep the single-file priority chain usable after parser errors.
      })
      .then(async () => {
        const result = await this.resolveEnrichment(path);
        if (
          this.shuttingDown ||
          !isCurrentEnrichment(
            generation,
            this.enrichmentGeneration,
            this.pathKey(path),
            this.enrichmentPathKey,
          )
        )
          return;
        this.currentEnrichment = {
          pathKey: this.pathKey(path),
          metadata: result.metadata,
          artwork: result.artwork,
        };
        const current = this.state.currentTrack;
        if (current && this.pathKey(current.path) === this.pathKey(path))
          this.update({
            currentTrack: mergeTrackMetadata(
              current,
              result.metadata,
              result.artwork,
            ),
            queue: this.withQueueArtwork(path, result.artwork),
          });
        this.artworkService.setPinned([result.artwork, this.nextArtwork]);
        if (nextPath) this.schedulePreload(nextPath, generation);
      })
      .catch((error: unknown) => {
        if (generation === this.enrichmentGeneration)
          console.warn("[metadata] current track enrichment failed", error);
      });
  }

  private schedulePreload(path: string, generation: number): void {
    this.preloadParsing = this.preloadParsing
      .catch(() => {
        // Keep the one-item preload chain usable after parser errors.
      })
      .then(async () => {
        if (!this.canApplyGeneration(generation)) return;
        const result = await this.resolveEnrichment(path);
        if (!this.canApplyGeneration(generation)) return;
        this.nextArtwork = result.artwork;
        this.update({ queue: this.withQueueArtwork(path, result.artwork) });
        this.artworkService.setPinned([
          this.currentEnrichment?.artwork ?? null,
          result.artwork,
        ]);
      })
      .catch((error: unknown) => {
        if (generation === this.enrichmentGeneration)
          console.warn("[metadata] next track preload failed", error);
      });
  }

  private async resolveEnrichment(path: string): Promise<{
    readonly metadata: NormalizedMetadata;
    readonly artwork: ArtworkRef | null;
  }> {
    let result = await this.metadataService.read(path);
    if (
      result.artwork &&
      !(await this.artworkService.getResource(result.artwork.id))
    ) {
      this.metadataService.invalidate(result.cacheKey);
      result = await this.metadataService.read(path);
    }
    const artwork =
      result.artwork ??
      (await this.artworkService.resolve(
        path,
        result.cacheKey,
        result.pictures,
      ));
    this.metadataService.rememberArtwork(result.cacheKey, artwork);
    return { metadata: result.metadata, artwork };
  }

  private withQueueArtwork(
    path: string,
    artwork: ArtworkRef | null,
  ): readonly QueueItem[] {
    const key = this.pathKey(path);
    const queue = this.state.queue.map((item) => {
      if (this.pathKey(item.path) !== key || item.artwork?.id === artwork?.id)
        return item;
      return { ...item, artwork };
    });
    return queue.some((item, index) => item !== this.state.queue[index])
      ? queue
      : this.state.queue;
  }

  private canApplyGeneration(generation: number): boolean {
    return !this.shuttingDown && generation === this.enrichmentGeneration;
  }

  private queuePositionUpdate(position: number): void {
    this.pendingPosition = position;
    if (this.positionTimer || this.state.paused) {
      if (this.state.paused) this.flushPosition();
      return;
    }
    this.positionTimer = setTimeout(() => {
      this.positionTimer = null;
      this.flushPosition();
    }, 200);
  }

  private flushPosition(): void {
    if (this.positionTimer) clearTimeout(this.positionTimer);
    this.positionTimer = null;
    if (this.pendingPosition === null) return;
    const positionSeconds = this.pendingPosition;
    this.pendingPosition = null;
    this.update({ positionSeconds });
  }

  private update(patch: Partial<PlayerState>): void {
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) listener(this.state);
  }

  private updateError(code: string, message: string): void {
    this.update({ status: "error", error: { code, message } });
  }

  private requireController(): MpvController {
    if (!this.state.mpvAvailable || !this.controller)
      throw new PlayerError(
        "MPV_UNAVAILABLE",
        "MPV is not available. Check EIDETIC_MPV_PATH or PATH.",
        503,
      );
    return this.controller;
  }

  private requireTrack(): void {
    this.requireController();
    if (!this.state.currentTrack)
      throw new PlayerError("NO_TRACK", "No track is loaded.", 409);
  }

  private pathKey(path: string): string {
    return path.toLocaleLowerCase("en");
  }
  private asString(value: unknown): string | null {
    return typeof value === "string" && value ? value : null;
  }
  private asNumber(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  }
  private asNullableNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  private asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
  }
  private formatAudioDevice(value: unknown): string {
    const device = this.asString(value);
    return !device || device === "auto" ? "Default output" : device;
  }
}
