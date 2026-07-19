import { randomUUID } from "node:crypto";
import { basename, extname, resolve } from "node:path";
import type {
  ArtworkRef,
  PlayerState,
  PlayerTrack,
  QueueItem,
  RepeatMode,
} from "../../../../packages/shared/src/player.js";

const MAX_REPORTED_AUDIO_BUFFER_SECONDS = 1;
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
import { buildExplicitQueue, buildQueue } from "./queue-builder.js";
import { LimitedConcurrency } from "../utils/limited-concurrency.js";
import type {
  PersistedQueueOrigin,
  PlayerSessionSnapshot,
  ResolvedQueueItem,
} from "../player-session/player-session-types.js";

type StateListener = (state: PlayerState) => void;

const initialState: PlayerState = {
  playerSessionId: randomUUID(),
  trackTransitionId: 0,
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
  queueRevision: 0,
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

function isQueueItemId(value: string): boolean {
  return /^queue-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export class PlayerService {
  private state: PlayerState = initialState;
  private controller: MpvController | null = null;
  private executable: string | null = null;
  private unsubscribeMpv: (() => void) | null = null;
  private readonly listeners = new Set<StateListener>();
  private readonly properties = new Map<string, unknown>();
  private originalQueue: string[] = [];
  private stagedQueue: string[] | null = null;
  private readonly itemIds = new Map<string, string>();
  private readonly queueOrigins = new Map<string, PersistedQueueOrigin>();
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
  private transitionPending = false;
  private trackTransitionId = 0;
  private readonly preloadedEnrichments = new Map<
    string,
    {
      readonly metadata: NormalizedMetadata;
      readonly artwork: ArtworkRef | null;
    }
  >();
  private readonly queueArtworkConcurrency = new LimitedConcurrency(2);
  private preparingPlaylist = false;
  private pendingTrackTarget: number | null = null;
  private openRequestGeneration = 0;
  private openRequestChain: Promise<void> = Promise.resolve();
  private enrichmentWork = 0;
  private readonly libraryPriorityWaiters = new Set<() => void>();

  constructor(
    private readonly metadataService = new MetadataService(),
    private readonly artworkService = new ArtworkService(),
  ) {}

  getState(): PlayerState {
    return this.state;
  }

  getMpvExecutable(): string | null {
    return this.executable;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async waitForLibraryScanSlot(signal: AbortSignal): Promise<void> {
    if (!this.hasLibraryPriorityWork()) return;
    await new Promise<void>((resolve, reject) => {
      const ready = (): void => {
        if (this.hasLibraryPriorityWork()) return;
        cleanup();
        resolve();
      };
      const aborted = (): void => {
        cleanup();
        reject(new DOMException("Library scan cancelled.", "AbortError"));
      };
      const cleanup = (): void => {
        this.libraryPriorityWaiters.delete(ready);
        signal.removeEventListener("abort", aborted);
      };
      this.libraryPriorityWaiters.add(ready);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
      else ready();
    });
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
      await this.resetQueue();
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
    const requestGeneration = this.reserveOpenRequest();
    const queue = await buildQueue(paths);
    const selectedKey = this.pathKey(paths[0] ?? "");
    const selectedIndex =
      paths.length === 1
        ? Math.max(
            0,
            queue.findIndex((path) => this.pathKey(path) === selectedKey),
          )
        : 0;
    await this.openResolvedQueue(
      queue,
      selectedIndex,
      undefined,
      requestGeneration,
    );
  }

  reserveOpenRequest(): number {
    this.openRequestGeneration += 1;
    return this.openRequestGeneration;
  }

  async openResolvedQueue(
    paths: readonly string[],
    selectedIndex: number,
    origins?: readonly PersistedQueueOrigin[],
    requestGeneration = this.reserveOpenRequest(),
  ): Promise<void> {
    const operation = this.openRequestChain.then(async () => {
      if (requestGeneration !== this.openRequestGeneration) return;
      await this.loadResolvedQueue(paths, selectedIndex, {
        autoplay: true,
        ...(origins ? { origins } : {}),
      });
    });
    this.openRequestChain = operation.catch(() => undefined);
    await operation;
  }

  async restoreResolvedQueue(
    items: readonly ResolvedQueueItem[],
    selectedIndex: number,
  ): Promise<void> {
    await this.loadResolvedQueue(
      items.map((item) => item.path),
      selectedIndex,
      {
        autoplay: false,
        origins: items.map((item) => item.origin),
        itemIds: items.map((item) => item.id),
      },
    );
  }

  getSessionSnapshot(): PlayerSessionSnapshot {
    const current = this.state.queue[this.state.currentQueueIndex];
    return {
      currentQueueItemId: current?.id ?? null,
      queue: this.state.queue.map((item) => ({
        id: item.id,
        origin:
          this.queueOrigins.get(this.pathKey(item.path)) ??
          ({ kind: "direct", nativePath: item.path } as const),
        filename: item.filename,
        displayTitle: item.displayTitle,
      })),
    };
  }

  private async loadResolvedQueue(
    paths: readonly string[],
    selectedIndex: number,
    options: {
      readonly autoplay: boolean;
      readonly origins?: readonly PersistedQueueOrigin[];
      readonly itemIds?: readonly string[];
    },
  ): Promise<void> {
    const queue = await buildExplicitQueue(paths);
    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= queue.length
    )
      throw new PlayerError(
        "INVALID_QUEUE_INDEX",
        "The selected library item is unavailable.",
      );
    const controller = this.requireController();
    const hadQueue = this.state.queue.length > 0;
    this.itemIds.clear();
    this.queueOrigins.clear();
    for (const path of queue) {
      const inputIndex = paths.findIndex(
        (candidate) => this.pathKey(candidate) === this.pathKey(path),
      );
      const origin = options.origins?.[inputIndex];
      const itemId = options.itemIds?.[inputIndex];
      if (origin) this.queueOrigins.set(this.pathKey(path), origin);
      if (itemId) this.itemIds.set(this.pathKey(path), itemId);
    }
    this.stagedQueue = null;
    this.enrichmentGeneration += 1;
    this.enrichmentPathKey = null;
    this.currentEnrichment = null;
    this.nextArtwork = null;
    this.preloadedEnrichments.clear();
    this.pendingTrackTarget = null;
    this.artworkService.setPinned([]);
    if (!hadQueue) this.update({ status: "loading", error: null });
    this.originalQueue = [...queue];
    this.preparingPlaylist = true;
    try {
      await controller.loadPlaylist(queue, selectedIndex);
      if (this.state.shuffleEnabled)
        await controller.command(["playlist-shuffle"]);
      await controller.setProperty("pause", !options.autoplay);
      this.preparingPlaylist = false;
      await this.refreshProperties();
    } catch (error) {
      this.preparingPlaylist = false;
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

  getCurrentPath(): string | null {
    return this.state.currentTrack?.path ?? null;
  }

  async append(
    paths: readonly string[],
    origins?: readonly PersistedQueueOrigin[],
  ): Promise<number> {
    const controller = this.requireController();
    this.preparingPlaylist = true;
    try {
      const candidates = await buildExplicitQueue(paths);
      const existing = new Set(
        this.state.queue.map((item) => this.pathKey(item.path)),
      );
      const appended = candidates.filter(
        (path) => !existing.has(this.pathKey(path)),
      );
      if (appended.length === 0) return 0;
      for (const path of appended) {
        const inputIndex = paths.findIndex(
          (candidate) => this.pathKey(candidate) === this.pathKey(path),
        );
        const origin = origins?.[inputIndex];
        if (origin) this.queueOrigins.set(this.pathKey(path), origin);
      }
      if (this.stagedQueue || this.state.queue.length === 0) {
        const staged = [...(this.stagedQueue ?? []), ...appended];
        this.stagedQueue = staged;
        this.originalQueue = [...staged];
        const queue = staged.map((path, index) => {
          const key = this.pathKey(path);
          let id = this.itemIds.get(key);
          if (!id) {
            id = `queue-${randomUUID()}`;
            this.itemIds.set(key, id);
          }
          const previous = this.state.queue.find((item) => item.id === id);
          const filename = basename(path);
          return {
            id,
            index,
            path,
            filename,
            displayTitle:
              previous?.displayTitle ?? filename.replace(/\.[^.]+$/, ""),
            artwork: previous?.artwork ?? null,
            isCurrent: false,
          };
        });
        this.update({
          status: "stopped",
          currentTrack: null,
          currentQueueIndex: -1,
          queue,
          queueRevision: this.state.queueRevision + 1,
          paused: true,
        });
        return appended.length;
      }
      await controller.appendToPlaylist(appended);
      this.originalQueue.push(...appended);
      await this.refreshProperties();
      return appended.length;
    } finally {
      this.preparingPlaylist = false;
    }
  }

  async removeQueueItem(queueItemId: string): Promise<void> {
    if (!isQueueItemId(queueItemId))
      throw new PlayerError(
        "INVALID_QUEUE_ITEM",
        "A valid Queue item ID is required.",
      );
    const index = this.state.queue.findIndex((item) => item.id === queueItemId);
    if (index < 0)
      throw new PlayerError(
        "QUEUE_ITEM_NOT_FOUND",
        "Queue item not found.",
        404,
      );
    const wasCurrent = index === this.state.currentQueueIndex;
    const remainingCount = this.state.queue.length - 1;
    const removedPath = this.state.queue[index]?.path ?? "";
    this.queueOrigins.delete(this.pathKey(removedPath));
    if (this.stagedQueue) {
      this.stagedQueue = this.stagedQueue.filter(
        (path) => this.pathKey(path) !== this.pathKey(removedPath),
      );
      this.originalQueue = [...this.stagedQueue];
      const queue = this.state.queue
        .filter((item) => item.id !== queueItemId)
        .map((item, nextIndex) => ({ ...item, index: nextIndex }));
      if (queue.length === 0) {
        this.resetLocalState();
      } else {
        this.update({
          queue,
          queueRevision: this.state.queueRevision + 1,
        });
      }
      return;
    }
    await this.requireController().command(["playlist-remove", index]);
    this.originalQueue = this.originalQueue.filter(
      (path) => this.pathKey(path) !== this.pathKey(removedPath),
    );
    if (remainingCount === 0) {
      await this.clearQueue();
      return;
    }
    if (wasCurrent) {
      const target = Math.min(index, remainingCount - 1);
      await this.requireController().setProperty("playlist-pos", target);
      await this.requireController().setProperty("pause", false);
    }
    await this.refreshProperties();
  }

  async clearQueue(): Promise<void> {
    this.preparingPlaylist = true;
    try {
      await this.requireController().clearPlaylist();
      this.properties.clear();
      this.resetLocalState();
    } finally {
      this.preparingPlaylist = false;
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
    if (this.pendingTrackTarget === null && this.state.positionSeconds > 3) {
      await controller.command(["seek", 0, "absolute+exact"]);
      return;
    }
    const base = this.pendingTrackTarget ?? this.state.currentQueueIndex;
    if (base <= 0) return;
    const target = base - 1;
    this.pendingTrackTarget = target;
    await controller.setProperty("playlist-pos", target);
  }

  async next(): Promise<void> {
    this.requireTrack();
    const base = this.pendingTrackTarget ?? this.state.currentQueueIndex;
    let target = base + 1;
    if (target >= this.state.queue.length) {
      if (this.state.repeatMode !== "all") return;
      target = 0;
    }
    this.pendingTrackTarget = target;
    await this.requireController().setProperty("playlist-pos", target);
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
    if (this.stagedQueue) {
      this.update({ shuffleEnabled: enabled });
      return;
    }
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
    if (this.stagedQueue) {
      const staged = [...this.stagedQueue];
      await this.loadResolvedQueue(staged, index, {
        autoplay: true,
        origins: staged.map(
          (path) =>
            this.queueOrigins.get(this.pathKey(path)) ??
            ({ kind: "direct", nativePath: path } as const),
        ),
        itemIds: staged.map(
          (path) =>
            this.itemIds.get(this.pathKey(path)) ?? `queue-${randomUUID()}`,
        ),
      });
      return;
    }
    this.pendingTrackTarget = index;
    await this.requireController().setProperty("playlist-pos", index);
    await this.requireController().setProperty("pause", false);
  }

  getArtworkResource(id: string): Promise<ArtworkResource | null> {
    return this.artworkService.getResource(id);
  }

  async resolveQueueArtwork(queueItemId: string): Promise<ArtworkRef | null> {
    if (!isQueueItemId(queueItemId)) return null;
    const item = this.state.queue.find(
      (candidate) => candidate.id === queueItemId,
    );
    if (!item) return null;
    return this.queueArtworkConcurrency.run(async () => {
      try {
        const result = await this.resolveEnrichment(item.path);
        const current = this.state.queue.find(
          (candidate) =>
            candidate.id === queueItemId &&
            this.pathKey(candidate.path) === this.pathKey(item.path),
        );
        if (current) {
          const queue = this.withQueueArtwork(item.path, result.artwork);
          if (queue !== this.state.queue)
            this.update({
              queue,
              queueRevision: this.state.queueRevision + 1,
            });
        }
        return result.artwork;
      } catch (error) {
        console.warn("[metadata] queue artwork resolution failed", error);
        return null;
      }
    });
  }

  getQueueItemPath(queueItemId: string): string | null {
    if (!isQueueItemId(queueItemId)) return null;
    return (
      this.state.queue.find((candidate) => candidate.id === queueItemId)
        ?.path ?? null
    );
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.enrichmentGeneration += 1;
    if (this.positionTimer) clearTimeout(this.positionTimer);
    this.positionTimer = null;
    await this.controller?.clearPlaylist().catch(() => undefined);
    this.resetLocalState();
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

  private async resetQueue(): Promise<void> {
    await this.requireController().clearPlaylist();
    this.properties.clear();
    this.resetLocalState();
    await this.refreshProperties();
  }

  private resetLocalState(): void {
    if (this.state.currentTrack || this.state.queue.length > 0) {
      this.trackTransitionId += 1;
    }
    this.originalQueue = [];
    this.stagedQueue = null;
    this.itemIds.clear();
    this.queueOrigins.clear();
    this.enrichmentGeneration += 1;
    this.enrichmentPathKey = null;
    this.currentEnrichment = null;
    this.nextArtwork = null;
    this.preloadedEnrichments.clear();
    this.transitionPending = false;
    this.pendingTrackTarget = null;
    this.artworkService.setPinned([]);
    this.update({
      trackTransitionId: this.trackTransitionId,
      status: "idle",
      currentTrack: null,
      queue: [],
      queueRevision:
        this.state.queue.length > 0
          ? this.state.queueRevision + 1
          : this.state.queueRevision,
      currentQueueIndex: -1,
      positionSeconds: 0,
      durationSeconds: 0,
      paused: true,
      error: null,
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
        queueRevision:
          this.state.queue.length > 0
            ? this.state.queueRevision + 1
            : this.state.queueRevision,
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
      if (this.preparingPlaylist) return;
      if (
        (message.name === "path" &&
          this.pathKey(this.asString(message.data) ?? "") !==
            this.pathKey(this.state.currentTrack?.path ?? "")) ||
        (message.name === "playlist-pos" &&
          Math.trunc(this.asNumber(message.data, -1)) !==
            this.state.currentQueueIndex)
      )
        this.beginTrackTransition();
      if (this.transitionPending) return;
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
        if (this.preparingPlaylist) break;
        this.beginTrackTransition();
        break;
      case "file-loaded":
      case "playback-restart":
        if (this.preparingPlaylist) break;
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
      "audio-buffer",
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
    this.transitionPending = false;
    this.deriveStateFromProperties();
  }

  private beginTrackTransition(): void {
    if (this.transitionPending) return;
    this.transitionPending = true;
    this.enrichmentGeneration += 1;
    this.enrichmentPathKey = null;
    this.currentEnrichment = null;
    this.nextArtwork = null;
    this.pendingPosition = null;
    if (this.positionTimer) clearTimeout(this.positionTimer);
    this.positionTimer = null;
    this.artworkService.setPinned([]);
  }

  private deriveStateFromProperties(): void {
    if (this.transitionPending) return;
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
    const queueChanged = queue !== this.state.queue;
    const nextPathKey = path ? this.pathKey(path) : null;
    const trackChanged = nextPathKey !== this.enrichmentPathKey;
    if (trackChanged) {
      this.enrichmentPathKey = nextPathKey;
      this.enrichmentGeneration += 1;
      const preloaded = nextPathKey
        ? this.preloadedEnrichments.get(nextPathKey)
        : null;
      this.currentEnrichment =
        nextPathKey && preloaded
          ? { pathKey: nextPathKey, ...preloaded }
          : null;
      this.nextArtwork = null;
      this.artworkService.setPinned([]);
      if (path) this.trackTransitionId += 1;
    }
    const currentTrack = path ? this.createTrack(path, duration) : null;
    if (playlistIndex === this.pendingTrackTarget)
      this.pendingTrackTarget = null;
    this.update({
      trackTransitionId: this.trackTransitionId,
      paused: pause,
      status: idle
        ? queue.length
          ? "stopped"
          : "idle"
        : pause
          ? "paused"
          : "playing",
      durationSeconds: duration,
      positionSeconds: Math.max(
        0,
        Math.min(
          duration,
          this.asNumber(
            this.properties.get("time-pos"),
            this.state.positionSeconds,
          ),
        ),
      ),
      currentQueueIndex: playlistIndex,
      queue,
      queueRevision: queueChanged
        ? this.state.queueRevision + 1
        : this.state.queueRevision,
      currentTrack,
      audioBufferSeconds: Math.max(
        0,
        Math.min(
          MAX_REPORTED_AUDIO_BUFFER_SECONDS,
          this.asNumber(this.properties.get("audio-buffer"), 0),
        ),
      ),
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
      const previousPath = queue[playlistIndex - 1]?.path ?? null;
      this.scheduleCurrentEnrichment(path, nextPath, previousPath);
    }
  }

  private createQueue(value: unknown, currentIndex: number): QueueItem[] {
    if (!Array.isArray(value)) return this.state.queue as QueueItem[];
    const next = value.flatMap((entry, index) => {
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
        id = `queue-${randomUUID()}`;
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
    if (
      next.length === this.state.queue.length &&
      next.every((item, index) => {
        const previous = this.state.queue[index];
        return (
          previous?.id === item.id &&
          previous.index === item.index &&
          previous.path === item.path &&
          previous.filename === item.filename &&
          previous.displayTitle === item.displayTitle &&
          previous.artwork?.id === item.artwork?.id &&
          previous.isCurrent === item.isCurrent
        );
      })
    )
      return this.state.queue as QueueItem[];
    return next;
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
    previousPath: string | null,
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
        this.rememberPreloaded(path, result);
        const current = this.state.currentTrack;
        if (current && this.pathKey(current.path) === this.pathKey(path)) {
          const queue = this.withQueueArtwork(path, result.artwork);
          this.update({
            currentTrack: mergeTrackMetadata(
              current,
              result.metadata,
              result.artwork,
            ),
            queue,
            queueRevision:
              queue === this.state.queue
                ? this.state.queueRevision
                : this.state.queueRevision + 1,
          });
        }
        this.artworkService.setPinned([result.artwork, this.nextArtwork]);
        this.scheduleAdjacentPreload(nextPath, previousPath, generation);
      })
      .catch((error: unknown) => {
        if (generation === this.enrichmentGeneration)
          console.warn("[metadata] current track enrichment failed", error);
      });
  }

  private scheduleAdjacentPreload(
    nextPath: string | null,
    previousPath: string | null,
    generation: number,
  ): void {
    this.preloadParsing = this.preloadParsing
      .catch(() => {
        // Keep the one-item preload chain usable after parser errors.
      })
      .then(async () => {
        let queue = this.state.queue;
        if (nextPath) {
          if (!this.canApplyGeneration(generation)) return;
          const next = await this.resolveEnrichment(nextPath);
          if (!this.canApplyGeneration(generation)) return;
          this.rememberPreloaded(nextPath, next);
          this.nextArtwork = next.artwork;
          queue = this.withQueueArtwork(nextPath, next.artwork, queue);
        }
        if (previousPath) {
          if (!this.canApplyGeneration(generation)) return;
          const previous = await this.resolveEnrichment(previousPath);
          if (!this.canApplyGeneration(generation)) return;
          this.rememberPreloaded(previousPath, previous);
          queue = this.withQueueArtwork(previousPath, previous.artwork, queue);
        }
        if (queue !== this.state.queue)
          this.update({
            queue,
            queueRevision: this.state.queueRevision + 1,
          });
        this.artworkService.setPinned([
          this.currentEnrichment?.artwork ?? null,
          this.nextArtwork,
          previousPath
            ? (this.preloadedEnrichments.get(this.pathKey(previousPath))
                ?.artwork ?? null)
            : null,
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
    this.enrichmentWork += 1;
    try {
      const result = await this.metadataService.readForArtwork(
        path,
        async (artwork) =>
          (await this.artworkService.getResource(artwork.id)) !== null,
      );
      const artwork =
        result.artwork ??
        (await this.artworkService.resolve(
          path,
          result.cacheKey,
          result.pictures,
        ));
      this.metadataService.rememberArtwork(result.cacheKey, artwork);
      return { metadata: result.metadata, artwork };
    } finally {
      this.enrichmentWork = Math.max(0, this.enrichmentWork - 1);
      this.notifyLibraryPriorityWaiters();
    }
  }

  private withQueueArtwork(
    path: string,
    artwork: ArtworkRef | null,
    source: readonly QueueItem[] = this.state.queue,
  ): readonly QueueItem[] {
    const key = this.pathKey(path);
    const queue = source.map((item) => {
      if (this.pathKey(item.path) !== key || item.artwork?.id === artwork?.id)
        return item;
      return { ...item, artwork };
    });
    return queue.some((item, index) => item !== source[index]) ? queue : source;
  }

  private rememberPreloaded(
    path: string,
    result: {
      readonly metadata: NormalizedMetadata;
      readonly artwork: ArtworkRef | null;
    },
  ): void {
    const key = this.pathKey(path);
    this.preloadedEnrichments.delete(key);
    this.preloadedEnrichments.set(key, result);
    while (this.preloadedEnrichments.size > 3) {
      const oldest = this.preloadedEnrichments.keys().next().value;
      if (!oldest) break;
      this.preloadedEnrichments.delete(oldest);
    }
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
    const positionSeconds = Math.max(
      0,
      Math.min(this.state.durationSeconds, this.pendingPosition),
    );
    this.pendingPosition = null;
    this.update({ positionSeconds });
  }

  private update(patch: Partial<PlayerState>): void {
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) listener(this.state);
    this.notifyLibraryPriorityWaiters();
  }

  private hasLibraryPriorityWork(): boolean {
    return (
      this.state.status === "loading" ||
      this.transitionPending ||
      this.preparingPlaylist ||
      this.pendingTrackTarget !== null ||
      this.enrichmentWork > 0
    );
  }

  private notifyLibraryPriorityWaiters(): void {
    if (this.hasLibraryPriorityWork()) return;
    for (const waiter of [...this.libraryPriorityWaiters]) waiter();
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
    return resolve(path).toLocaleLowerCase("en");
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
