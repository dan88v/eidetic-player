import { randomUUID } from "node:crypto";
import { basename, dirname, extname, resolve } from "node:path";
import type {
  ArtworkRef,
  ExplicitQueueItem,
  PlaybackContextQueueDecision,
  PlayerState,
  PlayerTrack,
  QueueItem,
  RepeatMode,
  PlayerCommandRequestMetadata,
  PlayerCommandState,
} from "../../../../packages/shared/src/player.js";

const MAX_REPORTED_AUDIO_BUFFER_SECONDS = 1;
import {
  ArtworkService,
  type ArtworkResource,
} from "../artwork/artwork-service.js";
import { mergeTrackMetadata } from "../metadata/metadata-merge.js";
import { isCurrentEnrichment } from "../metadata/enrichment-guard.js";
import { MetadataService } from "../metadata/metadata-service.js";
import { normalizeMetadataText } from "../metadata/metadata-text.js";
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
import type {
  AudioOutputMpvAdapter,
  AudioOutputPropertyName,
} from "../audio-output/audio-output-service.js";
import {
  CommandIntentCoordinator,
  type PlaybackCommandDiagnostic,
  type PlaybackCommandKind,
} from "./command-intent-coordinator.js";
import {
  PlaybackPlanError,
  PlaybackPlanner,
  MAX_EXPLICIT_QUEUE_ITEMS,
  MAX_PLAYBACK_HISTORY_ITEMS,
  type ContinuePlaybackPolicy,
  type ExplicitQueueEntry,
  type ExplicitQueueEntryId,
  type PlaybackContextKind,
  type PlaybackContextItem,
  type PlaybackContextSeed,
  type PlaybackDecision,
  type PlaybackExecutionPlanEntry,
  type PlaybackItemOrigin,
  type PlaybackItemSeed,
  type PlaybackPlanSnapshot,
} from "../playback-plan/index.js";

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
  commands: {
    volume: {
      generation: 0,
      clientSessionId: null,
      clientIntentId: 0,
      phase: "confirmed",
      target: 100,
    },
    mute: {
      generation: 0,
      clientSessionId: null,
      clientIntentId: 0,
      phase: "confirmed",
      target: false,
    },
    transport: {
      generation: 0,
      clientSessionId: null,
      clientIntentId: 0,
      phase: "confirmed",
      target: true,
    },
    navigation: {
      generation: 0,
      clientSessionId: null,
      clientIntentId: 0,
      phase: "confirmed",
      targetQueueItemId: null,
    },
    failureRevision: 0,
  },
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
  return /^(?:queue|explicit|playback-item|execution)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export interface PlaybackContextDescriptor {
  readonly kind: PlaybackContextKind;
  readonly title: string;
  readonly entityId?: string | null;
  readonly continuationArtistId?: string | null;
  readonly source: PlaybackContextSeed["source"];
}

export interface SameArtistCandidate {
  readonly trackId: string;
  readonly path: string;
  readonly origin: PersistedQueueOrigin;
  /** Display name resolved from the same stable Library artist identity. */
  readonly artistName?: string;
}

interface PlaybackPlanAttempt {
  readonly previous: PlaybackPlanSnapshot;
  attempted: PlaybackPlanSnapshot;
  readonly consumedExplicit: Map<ExplicitQueueEntryId, ExplicitQueueEntry>;
}

export class PlayerService implements AudioOutputMpvAdapter {
  private state: PlayerState = initialState;
  private controller: MpvController | null = null;
  private executable: string | null = null;
  private unsubscribeMpv: (() => void) | null = null;
  private readonly listeners = new Set<StateListener>();
  private readonly properties = new Map<string, unknown>();
  private originalQueue: string[] = [];
  private stagedQueue: string[] | null = null;
  private readonly itemIds = new Map<string, string>();
  private playlistItemIds: string[] = [];
  private readonly queueOrigins = new Map<string, PersistedQueueOrigin>();
  private readonly executionOrigins = new Map<string, PersistedQueueOrigin>();
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
  private pendingTrackTargetId: string | null = null;
  private pendingTrackTargetExpiresAt = 0;
  private openRequestGeneration = 0;
  private openRequestChain: Promise<void> = Promise.resolve();
  private enrichmentWork = 0;
  private readonly libraryPriorityWaiters = new Set<() => void>();
  private readonly naturalEndListeners = new Set<
    (state: PlayerState) => void
  >();
  private readonly seekListeners = new Set<(state: PlayerState) => void>();
  private readonly removableAvailability = new Map<string, boolean>();
  private readonly folderSourceAvailability = new Map<string, boolean>();
  private readonly smbAvailability = new Map<string, boolean>();
  private readonly audioOutputPropertyListeners = new Set<
    (name: AudioOutputPropertyName, value: unknown) => void
  >();
  private beforePlayback: () => Promise<void> = () => Promise.resolve();
  private readonly propertyVersions = new Map<string, number>();
  private refreshGeneration = 0;
  private transitionGeneration = 0;
  private lastOutputVolumeReapplyGeneration = 0;
  private lastOutputMuteReapplyGeneration = 0;
  private readonly commandIntents: CommandIntentCoordinator;
  private readonly playbackPlanner = new PlaybackPlanner();
  private playbackPlanSnapshot = this.playbackPlanner.snapshot();
  private executionMutationChain: Promise<void> = Promise.resolve();
  private plannerTransitionChain: Promise<void> = Promise.resolve();
  private executionReconcileGeneration = 0;
  private plannerNavigationPending = false;
  private readonly activePlaybackPlanAttempts = new Set<PlaybackPlanAttempt>();
  private sameArtistResolver:
    ((artistId: string) => Promise<readonly SameArtistCandidate[]>) | null =
    null;
  private primaryArtistResolver: ((trackId: string) => string | null) | null =
    null;
  private publicExplicitSignature = "";
  private publicExplicitQueue: readonly ExplicitQueueItem[] = [];
  private publicCompatibilityQueue: readonly QueueItem[] = [];
  private publicContextLookupRevision = -1;
  private publicContextItems = new Map<string, PlaybackContextItem>();
  private publicPlaybackRevision = 0;
  private publicCanGoNext = false;

  constructor(
    private readonly metadataService = new MetadataService(),
    private readonly artworkService = new ArtworkService(),
    options: {
      readonly commandConfirmationTimeoutMilliseconds?: number;
      readonly commandDiagnostics?: boolean;
    } = {},
  ) {
    this.commandIntents = new CommandIntentCoordinator(
      {
        volume: initialState.volume,
        muted: initialState.muted,
        paused: initialState.paused,
      },
      (commands) => {
        this.publishCommandState(commands);
      },
      options.commandConfirmationTimeoutMilliseconds,
      options.commandDiagnostics,
    );
    this.state = Object.freeze({
      ...this.state,
      commands: this.commandIntents.snapshot(),
    });
  }

  getState(): PlayerState {
    return this.state;
  }

  getPublicState(): PlayerState {
    const publicPath = (
      item: PlaybackItemSeed,
      playbackInstanceId: string,
    ): string => {
      const origin = item.origin;
      const logicalPath = (origin.relativePath ?? item.filename)
        .split("/")
        .filter(Boolean)
        .map(encodeURIComponent)
        .join("/");
      const sourceId = encodeURIComponent(origin.sourceId ?? "unavailable");
      if (origin.kind === "removable")
        return `removable://${sourceId}/${logicalPath}`;
      if (origin.kind === "smb") return `smb://${sourceId}/${logicalPath}`;
      if (origin.kind === "folder" || origin.kind === "library")
        return `library-source://${sourceId}/${logicalPath}`;
      return `player-item://${encodeURIComponent(playbackInstanceId)}`;
    };
    const plan = this.playbackPlanSnapshot;
    const technicalByExecutionId = new Map(
      this.state.queue.map((item) => [item.id, item]),
    );
    const publicItem = (
      item: PlaybackItemSeed,
      executionEntryId: string,
      current = false,
    ) => {
      const technical = technicalByExecutionId.get(executionEntryId);
      const technicalCurrentId =
        this.state.queue[this.state.currentQueueIndex]?.id ?? null;
      const observedCurrent = this.state.currentTrack;
      const currentTrack =
        current &&
        technicalCurrentId === executionEntryId &&
        observedCurrent &&
        this.pathKey(observedCurrent.path) === this.pathKey(item.nativePath)
          ? observedCurrent
          : null;
      return {
        filename: item.filename,
        displayTitle: currentTrack?.title ?? item.title,
        artist: currentTrack?.artist ?? item.artist ?? null,
        album: currentTrack?.album ?? item.album ?? null,
        ...(typeof item.durationSeconds === "number"
          ? { durationSeconds: item.durationSeconds }
          : technical?.durationSeconds !== undefined
            ? { durationSeconds: technical.durationSeconds }
            : {}),
        artwork:
          currentTrack?.artwork ??
          technical?.artwork ??
          this.preloadedEnrichments.get(this.pathKey(item.nativePath))
            ?.artwork ??
          null,
        available: item.availability !== "unavailable",
        libraryTrackId: item.libraryTrackId ?? null,
      };
    };
    const explicitSignature = `${String(
      plan.revisions.explicitQueue,
    )}:${this.state.queue
      .map(
        (item) =>
          `${item.id}:${String(item.durationSeconds ?? "")}:${item.artwork?.revision ?? ""}`,
      )
      .join("|")}:${[...this.preloadedEnrichments.entries()]
      .map(([key, value]) => `${key}:${value.artwork?.revision ?? ""}`)
      .join("|")}`;
    if (explicitSignature !== this.publicExplicitSignature) {
      this.publicExplicitSignature = explicitSignature;
      this.publicExplicitQueue = plan.explicitQueue.map((entry, index) => ({
        explicitQueueEntryId: entry.explicitQueueEntryId,
        playbackInstanceId: entry.playbackInstanceId,
        index,
        item: publicItem(entry.item, entry.executionEntryId),
      }));
      this.publicCompatibilityQueue = this.publicExplicitQueue.map((entry) => ({
        id: entry.explicitQueueEntryId,
        playbackInstanceId: entry.playbackInstanceId,
        index: entry.index,
        path: `queue-entry://${entry.explicitQueueEntryId}`,
        filename: entry.item.filename,
        displayTitle: entry.item.displayTitle,
        ...(entry.item.durationSeconds !== undefined
          ? { durationSeconds: entry.item.durationSeconds }
          : {}),
        artwork: entry.item.artwork,
        isCurrent: false,
        available: entry.item.available,
        ...(entry.item.libraryTrackId
          ? { libraryTrackId: entry.item.libraryTrackId }
          : {}),
      }));
    }
    const explicitQueue = this.publicExplicitQueue;
    const queue = this.publicCompatibilityQueue;
    const context = plan.context;
    if (plan.revisions.context !== this.publicContextLookupRevision) {
      this.publicContextLookupRevision = plan.revisions.context;
      this.publicContextItems = new Map(
        context?.originalItems.map((item) => [item.contextItemId, item]) ?? [],
      );
    }
    const nextContextId = context?.playOrder[context.resumeCursor];
    const nextContextItem = nextContextId
      ? this.publicContextItems.get(nextContextId)
      : undefined;
    const current = plan.current;
    const technicalCurrentId =
      this.state.queue[this.state.currentQueueIndex]?.id ?? null;
    const observedCurrent = this.state.currentTrack;
    const observedCurrentMatchesPlan = Boolean(
      current &&
      observedCurrent &&
      technicalCurrentId === current.executionEntryId &&
      this.pathKey(observedCurrent.path) ===
        this.pathKey(current.item.nativePath),
    );
    const publicCurrentTrack =
      current && observedCurrentMatchesPlan && observedCurrent
        ? {
            ...observedCurrent,
            path: publicPath(current.item, current.playbackInstanceId),
          }
        : null;
    const currentPublicItem = current
      ? publicItem(current.item, current.executionEntryId, true)
      : null;
    const continuationArtistId =
      plan.artistRadio?.artistId ??
      (context?.kind === "artist"
        ? (context.entityId ?? context.continuationArtistId)
        : context?.kind === "album"
          ? context.continuationArtistId
          : (current?.item.primaryArtistId ?? null));
    return {
      ...this.state,
      currentTrack: publicCurrentTrack,
      positionSeconds: observedCurrentMatchesPlan
        ? this.state.positionSeconds
        : 0,
      durationSeconds: observedCurrentMatchesPlan
        ? this.state.durationSeconds
        : (currentPublicItem?.durationSeconds ?? 0),
      currentQueueIndex: -1,
      queue,
      queueRevision: plan.revisions.explicitQueue,
      currentPlayback:
        current && currentPublicItem
          ? {
              playbackInstanceId: current.playbackInstanceId,
              source: current.source,
              relationId: current.relationId,
              contextId: current.contextId,
              historyEntryId: current.historyEntryId,
              startedSequence: current.startedSequence,
              item: currentPublicItem,
            }
          : null,
      explicitQueue,
      playbackContext: context
        ? {
            contextId: context.contextId,
            kind: context.kind,
            entityId: context.entityId,
            title: context.title,
            sourceLabel: context.source.label,
            nextItem: nextContextItem
              ? publicItem(
                  nextContextItem.item,
                  nextContextItem.executionEntryId,
                )
              : null,
            remainingCount: Math.max(
              0,
              context.playOrder.length - context.resumeCursor,
            ),
            totalCount: context.originalItems.length,
            cycle: context.repeatCycle,
          }
        : null,
      playbackHistory: {
        entryCount: plan.history.entries.length,
        cursor: plan.history.cursor,
        canGoBack: plan.history.cursor > 0,
        canGoForward:
          plan.history.cursor >= 0 &&
          plan.history.cursor < plan.history.entries.length - 1,
      },
      playbackContinuation: {
        mode: plan.continuePlayback,
        artistId: continuationArtistId,
        artistName:
          continuationArtistId === null
            ? null
            : context?.kind === "artist" || context?.kind === "artist-radio"
              ? context.title
              : context?.kind === "album"
                ? null
                : (currentPublicItem?.artist ?? null),
        active: context?.kind === "artist-radio",
      },
      contextRevision: plan.revisions.context,
      playbackPlanRevision: this.publicPlaybackRevision,
      canGoNext: this.publicCanGoNext,
    };
  }

  setSameArtistResolver(
    resolver: (artistId: string) => Promise<readonly SameArtistCandidate[]>,
  ): void {
    this.sameArtistResolver = resolver;
  }

  setPrimaryArtistResolver(resolver: (trackId: string) => string | null): void {
    this.primaryArtistResolver = resolver;
    this.hydrateCurrentPrimaryArtistIdentity();
  }

  async setContinuePlaybackMode(mode: ContinuePlaybackPolicy): Promise<void> {
    this.playbackPlanner.setContinuePlayback(mode);
    this.syncPlaybackPlan();
    if (this.playbackPlanSnapshot.current && this.state.mpvAvailable)
      await this.queueExecutionReconciliation();
  }

  getPlaybackPlanSnapshot(): PlaybackPlanSnapshot {
    return structuredClone(this.playbackPlanSnapshot);
  }

  getMpvExecutable(): string | null {
    return this.executable;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  noteCommandApiReceived(
    kind: PlaybackCommandKind,
    metadata?: PlayerCommandRequestMetadata,
  ): void {
    this.commandIntents.noteApiReceived(kind, metadata);
  }

  getCommandDiagnostics(): readonly PlaybackCommandDiagnostic[] {
    return this.commandIntents.diagnosticSnapshot();
  }

  subscribeNaturalEnd(listener: (state: PlayerState) => void): () => void {
    this.naturalEndListeners.add(listener);
    return () => this.naturalEndListeners.delete(listener);
  }

  subscribeSeek(listener: (state: PlayerState) => void): () => void {
    this.seekListeners.add(listener);
    return () => this.seekListeners.delete(listener);
  }

  isMpvAvailable(): boolean {
    return this.controller !== null && this.state.mpvAvailable;
  }

  isPlaybackActive(): boolean {
    return (
      this.state.currentTrack !== null &&
      this.state.status !== "idle" &&
      this.state.status !== "stopped" &&
      this.state.status !== "unavailable"
    );
  }

  readAudioOutputProperty(name: AudioOutputPropertyName): Promise<unknown> {
    return this.requireController().getProperty(name);
  }

  async writeAudioOutputDevice(deviceId: string): Promise<void> {
    await this.requireController().setProperty("audio-device", deviceId);
  }

  commandMpv(command: readonly unknown[]): Promise<unknown> {
    return this.requireController().command(command);
  }

  async pauseForAudioPolicy(): Promise<void> {
    const controller = this.requireController();
    await controller.setProperty("pause", true);
    this.commandIntents.observePaused(true);
    this.update({
      paused: true,
      status: this.state.currentTrack ? "paused" : this.state.status,
    });
  }

  subscribeAudioOutputProperties(
    listener: (name: AudioOutputPropertyName, value: unknown) => void,
  ): () => void {
    this.audioOutputPropertyListeners.add(listener);
    return () => this.audioOutputPropertyListeners.delete(listener);
  }

  subscribePlaybackActivity(listener: (active: boolean) => void): () => void {
    let previous = this.isPlaybackActive();
    return this.subscribe(() => {
      const active = this.isPlaybackActive();
      if (active === previous) return;
      previous = active;
      listener(active);
    });
  }

  setBeforePlaybackHook(hook: () => Promise<void>): void {
    this.beforePlayback = hook;
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
    await this.recover();
  }

  async recover(): Promise<boolean> {
    if (this.shuttingDown) return false;
    if (this.controller && this.state.mpvAvailable) return true;
    this.restartAttempted = false;
    this.update({
      status: "loading",
      mpvAvailable: false,
      error: null,
    });
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
      return false;
    }
    this.executable = discovery.executable;
    this.update({
      mpvAvailable: true,
      mpvVersion: discovery.version,
      status: "loading",
      error: null,
    });
    console.log(
      `[player] MPV available: ${discovery.version} (${String(
        discovery.diagnostics.length,
      )} candidates checked)`,
    );
    try {
      await this.startController();
      await this.resetQueue();
      return true;
    } catch (error) {
      await this.controller?.stop().catch(() => {
        // Preserve the original startup error.
      });
      this.controller = null;
      this.update({
        status: "unavailable",
        mpvAvailable: false,
        error: {
          code: "MPV_START_FAILED",
          message:
            "MPV could not be started or its IPC endpoint was unavailable.",
        },
      });
      console.error("[player] MPV startup failed", error);
      return false;
    }
  }

  async open(
    paths: readonly string[],
    queueDecision?: PlaybackContextQueueDecision,
  ): Promise<void> {
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
      {
        kind: "direct-folder",
        title: basename(dirname(queue[selectedIndex] ?? paths[0] ?? "Music")),
        source: { label: "Files" },
      },
      queueDecision,
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
    descriptor?: PlaybackContextDescriptor,
    queueDecision?: PlaybackContextQueueDecision,
  ): Promise<void> {
    const operation = this.openRequestChain.then(async () => {
      if (requestGeneration !== this.openRequestGeneration) return;
      const resolved = await buildExplicitQueue(paths, true);
      if (requestGeneration !== this.openRequestGeneration) return;
      if (
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= resolved.length
      )
        throw new PlayerError(
          "INVALID_QUEUE_INDEX",
          "The selected library item is unavailable.",
        );
      const alignedOrigins = resolved.map((path, index) =>
        this.originForInput(path, paths, origins, index),
      );
      const attempt = this.beginPlaybackPlanAttempt();
      try {
        const context =
          descriptor ??
          this.inferPlaybackContext(resolved, alignedOrigins, selectedIndex);
        const before = this.playbackPlanner.serialize();
        if (queueDecision?.explicitQueuePolicy === "clear") {
          if (
            before.revisions.explicitQueue !==
            queueDecision.expectedQueueRevision
          )
            throw new PlayerError(
              "STALE_QUEUE_REVISION",
              "Up Next changed before playback started.",
              409,
            );
          this.playbackPlanner.clearExplicitQueue();
        }
        const decision = this.playbackPlanner.startContext({
          ...context,
          items: resolved.map((path, index) =>
            this.playbackSeed(path, alignedOrigins[index]),
          ),
          selectedIndex,
        });
        this.syncPlaybackPlan();
        if (decision.kind === "start")
          this.hydrateCurrentPrimaryArtistIdentity();
        this.capturePlaybackPlanMutation(attempt, before);
        await this.applyPlannerDecision(decision, {
          autoplay: true,
          reloadCurrent: true,
          attempt,
        });
      } catch (error) {
        await this.restorePlaybackPlanAfterFailedDecision(attempt);
        throw error;
      } finally {
        this.finishPlaybackPlanAttempt(attempt);
      }
    });
    this.openRequestChain = operation.catch(() => undefined);
    await operation;
  }

  async restoreResolvedQueue(
    items: readonly ResolvedQueueItem[],
    selectedIndex: number,
    playback?: Pick<
      PlayerState,
      "positionSeconds" | "volume" | "muted" | "shuffleEnabled" | "repeatMode"
    >,
  ): Promise<void> {
    const decision = this.playbackPlanner.startContext({
      kind: "legacy-session",
      title: "Previous session",
      source: { label: "Previous session" },
      items: items.map((item) => this.playbackSeed(item.path, item.origin)),
      selectedIndex,
    });
    if (playback) {
      this.playbackPlanner.setRepeatMode(playback.repeatMode);
      this.playbackPlanner.setShuffle(playback.shuffleEnabled);
    }
    this.syncPlaybackPlan();
    await this.applyPlannerDecision(decision, {
      autoplay: false,
      reloadCurrent: true,
    });
    if (playback) {
      const controller = this.requireController();
      await controller.setProperty("volume", playback.volume);
      await controller.setProperty("mute", playback.muted);
      await controller.setProperty(
        "loop-file",
        playback.repeatMode === "one" ? "inf" : "no",
      );
      await controller.setProperty("loop-playlist", "no");
      if (playback.positionSeconds > 0.05)
        await controller.seekWhenReady(playback.positionSeconds);
      this.commandIntents.observeVolume(playback.volume);
      this.commandIntents.observeMute(playback.muted);
      this.update({
        volume: playback.volume,
        muted: playback.muted,
        positionSeconds: playback.positionSeconds,
      });
    }
  }

  getSessionSnapshot(): PlayerSessionSnapshot {
    const plan = this.playbackPlanSnapshot;
    const contextItems: ReadonlyMap<string, PlaybackContextItem> = plan.context
      ? new Map(
          plan.context.originalItems.map((item) => [item.contextItemId, item]),
        )
      : new Map<string, PlaybackContextItem>();
    const occurrences: readonly Pick<
      PlaybackExecutionPlanEntry,
      "executionEntryId" | "item"
    >[] = [
      ...(plan.current ? [plan.current] : []),
      ...plan.history.entries.slice(plan.history.cursor + 1),
      ...plan.explicitQueue,
      ...(plan.context?.playOrder
        .slice(plan.context.resumeCursor)
        .flatMap((id) => {
          const item = contextItems.get(id);
          return item ? [item] : [];
        }) ?? []),
    ];
    const compatibilityId = (executionEntryId: string): string => {
      const suffix = executionEntryId.replace(/^[^-]+-/, "");
      return `queue-${suffix}`;
    };
    const currentId = plan.current
      ? compatibilityId(plan.current.executionEntryId)
      : null;
    return {
      currentQueueItemId: currentId,
      queue: occurrences.map((entry) => ({
        id: compatibilityId(entry.executionEntryId),
        origin: this.persistedOrigin({
          executionEntryId: entry.executionEntryId,
          source: "context",
          relationId: entry.executionEntryId,
          playbackInstanceId: null,
          item: entry.item,
        }),
        filename: entry.item.filename,
        displayTitle: entry.item.title,
      })),
      positionSeconds: this.state.positionSeconds,
      volume: this.state.volume,
      muted: this.state.muted,
      shuffleEnabled: this.state.shuffleEnabled,
      repeatMode: this.state.repeatMode,
    };
  }

  async restorePlaybackPlan(
    snapshot: PlaybackPlanSnapshot,
    playback: Pick<PlayerState, "positionSeconds" | "volume" | "muted">,
  ): Promise<void> {
    this.playbackPlanner.restore(snapshot);
    this.syncPlaybackPlan();
    const restoredCurrent = this.playbackPlanSnapshot.current;
    const stagedExplicitOnly =
      restoredCurrent === null &&
      this.playbackPlanSnapshot.explicitQueue.length > 0;
    const decision = restoredCurrent
      ? ({
          kind: "start",
          reason: "context-resume",
          current: restoredCurrent,
        } as const)
      : stagedExplicitOnly
        ? null
        : this.playbackPlanner.start();
    if (decision) this.syncPlaybackPlan();
    let loadedCurrent = false;
    if (decision?.kind === "start") {
      await this.applyPlannerDecision(decision, {
        autoplay: false,
        reloadCurrent: true,
      });
      loadedCurrent = true;
    } else if (stagedExplicitOnly) await this.stopTechnicalPlayback();
    else this.update({ status: "idle", paused: true });

    const controller = this.requireController();
    await controller.setProperty("volume", playback.volume);
    await controller.setProperty("mute", playback.muted);
    if (loadedCurrent && playback.positionSeconds > 0.05)
      await controller.seekWhenReady(playback.positionSeconds);
    this.commandIntents.observeVolume(playback.volume);
    this.commandIntents.observeMute(playback.muted);
    this.update({
      volume: playback.volume,
      muted: playback.muted,
      positionSeconds: loadedCurrent ? playback.positionSeconds : 0,
    });
  }

  private async applyPlannerDecision(
    decision: PlaybackDecision,
    options: {
      readonly autoplay: boolean;
      readonly reloadCurrent: boolean;
      readonly attempt?: PlaybackPlanAttempt;
      readonly preserveCurrentAtBoundary?: boolean;
    },
  ): Promise<void> {
    const before = options.attempt
      ? this.playbackPlanner.serialize()
      : undefined;
    this.syncPlaybackPlan();
    if (decision.kind === "start") this.hydrateCurrentPrimaryArtistIdentity();
    if (options.attempt && before)
      this.capturePlaybackPlanMutation(options.attempt, before);
    if (decision.kind === "none") return;
    if (decision.kind === "restart-current") {
      await this.requireController().command(["seek", 0, "absolute+exact"]);
      return;
    }
    if (decision.kind === "continuation-needed") {
      await this.resolveSameArtistContinuation(
        decision,
        options.attempt,
        options.preserveCurrentAtBoundary ?? false,
      );
      return;
    }
    if (decision.kind === "stop") {
      await this.stopTechnicalPlayback();
      return;
    }
    const controller = this.requireController();
    await controller.setProperty(
      "loop-file",
      this.playbackPlanSnapshot.repeatMode === "one" ? "inf" : "no",
    );
    await controller.setProperty("loop-playlist", "no");
    const technicalCurrentId =
      this.state.queue[this.state.currentQueueIndex]?.id ?? null;
    const existingTargetIndex = this.playlistItemIds.indexOf(
      decision.current.executionEntryId,
    );
    if (
      technicalCurrentId !== decision.current.executionEntryId &&
      existingTargetIndex >= 0
    ) {
      this.plannerNavigationPending = true;
      this.pendingTrackTargetId = decision.current.executionEntryId;
      this.pendingTrackTargetExpiresAt = performance.now() + 10_000;
      await controller.setProperty("playlist-pos", existingTargetIndex);
      await controller.setProperty("pause", !options.autoplay);
      return;
    }
    if (
      options.reloadCurrent ||
      technicalCurrentId !== decision.current.executionEntryId
    ) {
      await this.loadPlannerExecutionPlan(options.autoplay);
    } else {
      await this.queueExecutionReconciliation();
      await controller.setProperty("pause", !options.autoplay);
    }
  }

  private async loadPlannerExecutionPlan(autoplay: boolean): Promise<void> {
    const projection = this.playbackPlanner.projectExecutionPlan();
    const entries = projection.current
      ? [projection.current, ...projection.future]
      : [];
    if (entries.length === 0) {
      if (this.playbackPlanSnapshot.explicitQueue.length > 0)
        this.update({ status: "stopped", paused: true });
      else await this.stopTechnicalPlayback();
      return;
    }
    await this.loadResolvedQueue(
      entries.map((entry) => entry.item.nativePath),
      0,
      {
        autoplay,
        origins: entries.map((entry) => this.persistedOrigin(entry)),
        itemIds: entries.map((entry) => entry.executionEntryId),
        allowUnavailablePaths: true,
      },
    );
    if (this.playbackPlanSnapshot.revisions.execution !== projection.revision)
      await this.queueExecutionReconciliation();
  }

  private queueExecutionReconciliation(): Promise<void> {
    const generation = ++this.executionReconcileGeneration;
    const operation = this.executionMutationChain.then(async () => {
      if (generation !== this.executionReconcileGeneration) return;
      await this.reconcileTechnicalFuture(generation);
    });
    this.executionMutationChain = operation.catch(() => undefined);
    return operation;
  }

  private async reconcileTechnicalFuture(generation: number): Promise<void> {
    if (this.preparingPlaylist) return;
    const preserveStoppedState = this.state.status === "stopped";
    const projection = this.playbackPlanner.projectExecutionPlan();
    const current = projection.current;
    if (!current) return;
    let currentIndex = this.playlistItemIds.indexOf(current.executionEntryId);
    if (currentIndex < 0) return;
    const desiredFuture = projection.future;
    const actualFutureIds = this.playlistItemIds.slice(currentIndex + 1);
    let preservedFutureCount = 0;
    while (
      preservedFutureCount < actualFutureIds.length &&
      preservedFutureCount < desiredFuture.length &&
      actualFutureIds[preservedFutureCount] ===
        desiredFuture[preservedFutureCount]?.executionEntryId
    )
      preservedFutureCount += 1;
    const controller = this.requireController();
    this.preparingPlaylist = true;
    try {
      for (
        let index = this.playlistItemIds.length - 1;
        index > currentIndex + preservedFutureCount;
        index -= 1
      ) {
        await controller.command(["playlist-remove", index]);
        this.playlistItemIds.splice(index, 1);
      }
      for (let index = currentIndex - 1; index >= 0; index -= 1) {
        await controller.command(["playlist-remove", index]);
        this.playlistItemIds.splice(index, 1);
      }
      currentIndex = 0;
      if (generation !== this.executionReconcileGeneration) return;
      const appendedFuture = desiredFuture.slice(preservedFutureCount);
      if (appendedFuture.length > 0)
        await controller.appendToPlaylist(
          appendedFuture.map((entry) => entry.item.nativePath),
        );
      const entries = [current, ...desiredFuture];
      this.playlistItemIds = entries.map((entry) => entry.executionEntryId);
      this.executionOrigins.clear();
      for (const entry of entries)
        this.executionOrigins.set(
          entry.executionEntryId,
          this.persistedOrigin(entry),
        );
      this.originalQueue = entries.map((entry) => entry.item.nativePath);
      if (preserveStoppedState) await controller.setProperty("pause", true);
      const playlist = await controller.getProperty("playlist");
      this.properties.set("playlist", playlist);
      this.properties.set("playlist-pos", currentIndex);
    } finally {
      this.preparingPlaylist = false;
    }
    await this.refreshProperties();
    if (preserveStoppedState) {
      this.commandIntents.observePaused(true);
      this.update({ status: "stopped", paused: true });
    }
  }

  private async resolveSameArtistContinuation(
    decision: Extract<PlaybackDecision, { kind: "continuation-needed" }>,
    attempt?: PlaybackPlanAttempt,
    preserveCurrentAtBoundary = false,
  ): Promise<void> {
    const resolver = this.sameArtistResolver;
    const candidates = resolver
      ? await resolver(decision.request.artistId).catch(() => [])
      : [];
    if (
      this.playbackPlanSnapshot.pendingContinuation?.requestId !==
      decision.request.requestId
    )
      return;
    const before = this.playbackPlanner.serialize();
    const next = this.playbackPlanner.installArtistRadio(
      decision.request.artistId,
      candidates.map((candidate) =>
        this.playbackSeed(candidate.path, candidate.origin, {
          libraryTrackId: candidate.trackId,
        }),
      ),
      candidates.find((candidate) => candidate.artistName)?.artistName,
    );
    this.syncPlaybackPlan();
    if (attempt) this.capturePlaybackPlanMutation(attempt, before);
    if (next.kind === "stop" && preserveCurrentAtBoundary && attempt) {
      await this.restorePlaybackPlanAfterFailedDecision(attempt);
      return;
    }
    await this.applyPlannerDecision(next, {
      autoplay: true,
      reloadCurrent: true,
      ...(attempt ? { attempt } : {}),
    });
  }

  private async stopTechnicalPlayback(): Promise<void> {
    const controller = this.controller;
    if (controller) {
      this.preparingPlaylist = true;
      try {
        await controller.command(["stop"]);
        await controller.command(["playlist-clear"]);
      } finally {
        this.preparingPlaylist = false;
      }
    }
    this.properties.clear();
    this.originalQueue = [];
    this.stagedQueue = null;
    this.playlistItemIds = [];
    this.executionOrigins.clear();
    this.update({
      status: this.playbackPlanSnapshot.explicitQueue.length
        ? "stopped"
        : "idle",
      currentTrack: null,
      currentQueueIndex: -1,
      queue: [],
      positionSeconds: 0,
      durationSeconds: 0,
      paused: true,
    });
  }

  private syncPlaybackPlan(): void {
    const previousCurrentId =
      this.playbackPlanSnapshot.current?.playbackInstanceId ?? null;
    const nextSnapshot = this.playbackPlanner.snapshot();
    const nextCurrentId = nextSnapshot.current?.playbackInstanceId ?? null;
    if (previousCurrentId !== nextCurrentId) this.publicPlaybackRevision += 1;
    this.playbackPlanSnapshot = nextSnapshot;
    this.publicCanGoNext = this.playbackPlanner.canAdvance();
    this.update({
      playbackPlanRevision: this.publicPlaybackRevision,
      shuffleEnabled: this.playbackPlanSnapshot.shuffleEnabled,
      repeatMode: this.playbackPlanSnapshot.repeatMode,
    });
  }

  private hydrateCurrentPrimaryArtistIdentity(): void {
    const current = this.playbackPlanSnapshot.current;
    const trackId = current?.item.libraryTrackId;
    const resolver = this.primaryArtistResolver;
    if (!current || current.item.primaryArtistId || !trackId || !resolver)
      return;
    let artistId: string | null;
    try {
      artistId = resolver(trackId);
    } catch {
      return;
    }
    if (!artistId) return;
    if (this.playbackPlanner.setCurrentPrimaryArtistId(artistId))
      this.syncPlaybackPlan();
  }

  private beginPlaybackPlanAttempt(): PlaybackPlanAttempt {
    const previous = this.playbackPlanner.serialize();
    const attempt: PlaybackPlanAttempt = {
      previous,
      attempted: previous,
      consumedExplicit: new Map(),
    };
    this.activePlaybackPlanAttempts.add(attempt);
    return attempt;
  }

  private capturePlaybackPlanMutation(
    attempt: PlaybackPlanAttempt,
    before: PlaybackPlanSnapshot,
  ): void {
    const after = this.playbackPlanner.serialize();
    const remainingIds = new Set(
      after.explicitQueue.map((entry) => entry.explicitQueueEntryId),
    );
    for (const entry of before.explicitQueue)
      if (!remainingIds.has(entry.explicitQueueEntryId))
        attempt.consumedExplicit.set(entry.explicitQueueEntryId, entry);
    attempt.attempted = after;
  }

  private finishPlaybackPlanAttempt(attempt: PlaybackPlanAttempt): void {
    this.activePlaybackPlanAttempts.delete(attempt);
  }

  private reservedExplicitRollbackCapacity(): number {
    const reserved = new Set<ExplicitQueueEntryId>();
    for (const attempt of this.activePlaybackPlanAttempts)
      for (const entryId of attempt.consumedExplicit.keys())
        reserved.add(entryId);
    return reserved.size;
  }

  private async restorePlaybackPlanAfterFailedDecision(
    attempt: PlaybackPlanAttempt,
  ): Promise<void> {
    const { previous, attempted } = attempt;
    const live = this.playbackPlanner.serialize();
    const currentChangedConcurrently = !this.samePlanValue(
      this.currentNavigationShape(live),
      this.currentNavigationShape(attempted),
    );
    const contextChangedConcurrently = !this.samePlanValue(
      this.contextNavigationShape(live),
      this.contextNavigationShape(attempted),
    );
    const historyChangedConcurrently = !this.samePlanValue(
      this.historyNavigationShape(live),
      this.historyNavigationShape(attempted),
    );
    const artistRadioChangedConcurrently = !this.samePlanValue(
      live.artistRadio,
      attempted.artistRadio,
    );
    const continuationChangedConcurrently = !this.samePlanValue(
      live.pendingContinuation,
      attempted.pendingContinuation,
    );
    const current = currentChangedConcurrently
      ? live.current
      : this.rollbackCurrent(previous, live);
    const context = contextChangedConcurrently
      ? live.context
      : this.rollbackContext(previous, attempted, live);
    const history = historyChangedConcurrently
      ? live.history
      : this.rollbackHistory(previous, attempted, live);
    const explicitQueue = this.rollbackExplicitQueue(attempt, live);
    const contextChanged = !this.samePlanValue(context, live.context);
    const currentChanged = !this.samePlanValue(current, live.current);
    const historyChanged = !this.samePlanValue(history, live.history);
    const explicitChanged = !this.samePlanValue(
      explicitQueue,
      live.explicitQueue,
    );
    const restored: PlaybackPlanSnapshot = {
      ...live,
      current,
      context,
      explicitQueue,
      history,
      artistRadio:
        contextChangedConcurrently || artistRadioChangedConcurrently
          ? live.artistRadio
          : previous.artistRadio,
      pendingContinuation: continuationChangedConcurrently
        ? live.pendingContinuation
        : previous.pendingContinuation,
      shuffleEnabled:
        live.shuffleEnabled === attempted.shuffleEnabled
          ? previous.shuffleEnabled
          : live.shuffleEnabled,
      repeatMode:
        live.repeatMode === attempted.repeatMode
          ? previous.repeatMode
          : live.repeatMode,
      continuePlayback:
        live.continuePlayback === attempted.continuePlayback
          ? previous.continuePlayback
          : live.continuePlayback,
      sequence: Math.max(previous.sequence, live.sequence),
      revisions: {
        state: live.revisions.state + 1,
        current: live.revisions.current + (currentChanged ? 1 : 0),
        context: live.revisions.context + (contextChanged ? 1 : 0),
        explicitQueue: live.revisions.explicitQueue + (explicitChanged ? 1 : 0),
        history: live.revisions.history + (historyChanged ? 1 : 0),
        execution: live.revisions.execution + 1,
        availability: live.revisions.availability,
      },
    };
    this.playbackPlanner.restore(restored);
    this.syncPlaybackPlan();
    const attemptedTargetId = attempted.current?.executionEntryId ?? null;
    if (
      !currentChangedConcurrently ||
      (attemptedTargetId !== null &&
        this.pendingTrackTargetId === attemptedTargetId)
    ) {
      this.plannerNavigationPending = false;
      this.clearPendingTrackTarget();
    }
    await this.reconcilePlaybackAfterRollback(restored);
  }

  private currentNavigationShape(snapshot: PlaybackPlanSnapshot): unknown {
    const current = snapshot.current;
    return current
      ? {
          playbackInstanceId: current.playbackInstanceId,
          executionEntryId: current.executionEntryId,
          source: current.source,
          relationId: current.relationId,
          contextId: current.contextId,
          historyEntryId: current.historyEntryId,
          startedSequence: current.startedSequence,
        }
      : null;
  }

  private contextNavigationShape(snapshot: PlaybackPlanSnapshot): unknown {
    const context = snapshot.context;
    return context
      ? {
          contextId: context.contextId,
          kind: context.kind,
          entityId: context.entityId,
          continuationArtistId: context.continuationArtistId,
          originalItems: context.originalItems.map((entry) => ({
            contextItemId: entry.contextItemId,
            executionEntryId: entry.executionEntryId,
          })),
          playOrder: context.playOrder,
          resumeCursor: context.resumeCursor,
          shuffleCycle: context.shuffleCycle,
          repeatCycle: context.repeatCycle,
        }
      : null;
  }

  private historyNavigationShape(snapshot: PlaybackPlanSnapshot): unknown {
    return {
      cursor: snapshot.history.cursor,
      entries: snapshot.history.entries.map((entry) => ({
        historyEntryId: entry.historyEntryId,
        playbackInstanceId: entry.playbackInstanceId,
        executionEntryId: entry.executionEntryId,
        originalSource: entry.originalSource,
        originalRelationId: entry.originalRelationId,
        contextId: entry.contextId,
        startedSequence: entry.startedSequence,
      })),
    };
  }

  private async reconcilePlaybackAfterRollback(
    restored: PlaybackPlanSnapshot,
  ): Promise<void> {
    try {
      if (!restored.current) {
        await this.stopTechnicalPlayback();
        return;
      }
      const currentIndex = this.playlistItemIds.indexOf(
        restored.current.executionEntryId,
      );
      if (currentIndex < 0) {
        await this.loadPlannerExecutionPlan(!this.state.paused);
        return;
      }
      const controller = this.requireController();
      const actualIndex = Math.trunc(
        this.asNumber(await controller.getProperty("playlist-pos"), -1),
      );
      if (actualIndex !== currentIndex)
        await controller.setProperty("playlist-pos", currentIndex);
      await this.queueExecutionReconciliation();
    } catch (error) {
      console.warn(
        "[playback-plan] failed to reconcile MPV after planner rollback",
        error,
      );
    }
  }

  private rollbackCurrent(
    previous: PlaybackPlanSnapshot,
    live: PlaybackPlanSnapshot,
  ): PlaybackPlanSnapshot["current"] {
    const previousCurrent = previous.current;
    if (!previousCurrent) return null;
    const liveHistoryItem = live.history.entries.find(
      (entry) => entry.historyEntryId === previousCurrent.historyEntryId,
    )?.item;
    return liveHistoryItem
      ? { ...previousCurrent, item: liveHistoryItem }
      : previousCurrent;
  }

  private rollbackContext(
    previous: PlaybackPlanSnapshot,
    attempted: PlaybackPlanSnapshot,
    live: PlaybackPlanSnapshot,
  ): PlaybackPlanSnapshot["context"] {
    const previousContext = previous.context;
    if (!previousContext) return null;
    const attemptedContext = attempted.context;
    const liveContext = live.context;
    if (
      !attemptedContext ||
      !liveContext ||
      attemptedContext.contextId !== previousContext.contextId ||
      liveContext.contextId !== previousContext.contextId
    )
      return previousContext;
    const liveItems = new Map(
      liveContext.originalItems.map((entry) => [entry.contextItemId, entry]),
    );
    return {
      ...previousContext,
      originalItems: previousContext.originalItems.map((entry) => {
        const liveEntry = liveItems.get(entry.contextItemId);
        return liveEntry ? { ...entry, item: liveEntry.item } : entry;
      }),
      playOrder: this.samePlanValue(
        liveContext.playOrder,
        attemptedContext.playOrder,
      )
        ? previousContext.playOrder
        : liveContext.playOrder,
      resumeCursor:
        liveContext.resumeCursor === attemptedContext.resumeCursor
          ? previousContext.resumeCursor
          : liveContext.resumeCursor,
      shuffleCycle:
        liveContext.shuffleCycle === attemptedContext.shuffleCycle
          ? previousContext.shuffleCycle
          : liveContext.shuffleCycle,
      repeatCycle:
        liveContext.repeatCycle === attemptedContext.repeatCycle
          ? previousContext.repeatCycle
          : liveContext.repeatCycle,
      availabilityRevision: Math.max(
        previousContext.availabilityRevision,
        liveContext.availabilityRevision,
      ),
    };
  }

  private rollbackHistory(
    previous: PlaybackPlanSnapshot,
    attempted: PlaybackPlanSnapshot,
    live: PlaybackPlanSnapshot,
  ): PlaybackPlanSnapshot["history"] {
    const attemptedIds = new Set(
      attempted.history.entries.map((entry) => entry.historyEntryId),
    );
    const liveById = new Map(
      live.history.entries.map((entry) => [entry.historyEntryId, entry]),
    );
    const entries = previous.history.entries.map(
      (entry) => liveById.get(entry.historyEntryId) ?? entry,
    );
    for (const entry of live.history.entries)
      if (!attemptedIds.has(entry.historyEntryId)) entries.push(entry);
    const boundedEntries = entries.slice(-MAX_PLAYBACK_HISTORY_ITEMS);
    const attemptedCursorId =
      attempted.history.entries[attempted.history.cursor]?.historyEntryId ??
      null;
    const liveCursorId =
      live.history.entries[live.history.cursor]?.historyEntryId ?? null;
    const previousCursorId =
      previous.history.entries[previous.history.cursor]?.historyEntryId ?? null;
    const cursorId =
      liveCursorId === attemptedCursorId ? previousCursorId : liveCursorId;
    const cursor = cursorId
      ? boundedEntries.findIndex((entry) => entry.historyEntryId === cursorId)
      : -1;
    return {
      entries: boundedEntries,
      cursor:
        boundedEntries.length === 0
          ? -1
          : cursor >= 0
            ? cursor
            : boundedEntries.length - 1,
    };
  }

  private rollbackExplicitQueue(
    attempt: PlaybackPlanAttempt,
    live: PlaybackPlanSnapshot,
  ): PlaybackPlanSnapshot["explicitQueue"] {
    const liveIds = new Set(
      live.explicitQueue.map((entry) => entry.explicitQueueEntryId),
    );
    const liveItemsByPlaybackId = new Map(
      [...(live.current ? [live.current] : []), ...live.history.entries].map(
        (entry) => [entry.playbackInstanceId, entry.item],
      ),
    );
    const consumed = [...attempt.consumedExplicit.values()]
      .filter((entry) => !liveIds.has(entry.explicitQueueEntryId))
      .map((entry) => ({
        ...entry,
        item: liveItemsByPlaybackId.get(entry.playbackInstanceId) ?? entry.item,
      }));
    const availableRollbackSlots = Math.max(
      0,
      MAX_EXPLICIT_QUEUE_ITEMS - live.explicitQueue.length,
    );
    return [
      ...consumed.slice(0, availableRollbackSlots),
      ...live.explicitQueue,
    ];
  }

  private samePlanValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private async loadResolvedQueue(
    paths: readonly string[],
    selectedIndex: number,
    options: {
      readonly autoplay: boolean;
      readonly origins?: readonly PersistedQueueOrigin[];
      readonly itemIds?: readonly string[];
      readonly allowUnavailablePaths?: boolean;
    },
  ): Promise<void> {
    const queue = options.allowUnavailablePaths
      ? [...paths]
      : await buildExplicitQueue(paths, true);
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
    if (options.autoplay) await this.beforePlayback();
    const hadQueue = this.state.queue.length > 0;
    this.itemIds.clear();
    this.playlistItemIds = queue.map(
      (_, index) => options.itemIds?.[index] ?? `queue-${randomUUID()}`,
    );
    this.queueOrigins.clear();
    this.executionOrigins.clear();
    for (const [queueIndex, path] of queue.entries()) {
      const inputIndex = paths.findIndex(
        (candidate) => this.pathKey(candidate) === this.pathKey(path),
      );
      const origin =
        options.origins?.[queueIndex] ?? options.origins?.[inputIndex];
      const itemId =
        options.itemIds?.[queueIndex] ?? options.itemIds?.[inputIndex];
      if (origin) this.queueOrigins.set(this.pathKey(path), origin);
      if (itemId) {
        this.itemIds.set(this.pathKey(path), itemId);
        if (origin) this.executionOrigins.set(itemId, origin);
      }
    }
    this.stagedQueue = null;
    this.enrichmentGeneration += 1;
    this.enrichmentPathKey = null;
    this.currentEnrichment = null;
    this.nextArtwork = null;
    this.preloadedEnrichments.clear();
    this.clearPendingTrackTarget();
    this.artworkService.setPinned([]);
    if (!hadQueue) this.update({ status: "loading", error: null });
    this.originalQueue = [...queue];
    this.preparingPlaylist = true;
    try {
      await controller.loadPlaylist(queue, selectedIndex);
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
    this.requireController();
    const candidates = await buildExplicitQueue(paths, true);
    if (candidates.length === 0) return 0;
    const alignedOrigins = candidates.map((path, index) =>
      this.originForInput(path, paths, origins, index),
    );
    if (
      this.playbackPlanSnapshot.explicitQueue.length +
        candidates.length +
        this.reservedExplicitRollbackCapacity() >
      MAX_EXPLICIT_QUEUE_ITEMS
    )
      throw new PlaybackPlanError(
        "EXPLICIT_QUEUE_TOO_LARGE",
        "Explicit Queue exceeds its bounded item limit.",
      );
    const added = this.playbackPlanner.enqueueExplicit(
      candidates.map((path, index) =>
        this.playbackSeed(path, alignedOrigins[index]),
      ),
    );
    this.syncPlaybackPlan();
    if (this.playbackPlanSnapshot.current)
      await this.queueExecutionReconciliation();
    else this.update({ status: "stopped", paused: true });
    return added.length;
  }

  async appendResolvedQueue(
    paths: readonly string[],
    origins?: readonly PersistedQueueOrigin[],
  ): Promise<number> {
    return this.append(paths, origins);
  }

  async removeQueueItem(queueItemId: string): Promise<void> {
    if (!isQueueItemId(queueItemId))
      throw new PlayerError(
        "INVALID_QUEUE_ITEM",
        "A valid Queue item ID is required.",
      );
    const removed = this.playbackPlanner.removeExplicit(
      queueItemId as ExplicitQueueEntryId,
    );
    if (!removed)
      throw new PlayerError(
        "QUEUE_ITEM_NOT_FOUND",
        "Queue item not found.",
        404,
      );
    this.syncPlaybackPlan();
    if (this.playbackPlanSnapshot.current)
      await this.queueExecutionReconciliation();
  }

  async reorderQueueItem(
    queueItemId: string,
    toIndex: number,
    expectedQueueRevision?: number,
  ): Promise<void> {
    if (!isQueueItemId(queueItemId) || !Number.isInteger(toIndex))
      throw new PlayerError(
        "INVALID_QUEUE_ITEM",
        "Select a valid Queue position.",
      );
    if (
      expectedQueueRevision !== undefined &&
      expectedQueueRevision !==
        this.playbackPlanSnapshot.revisions.explicitQueue
    )
      throw new PlayerError(
        "STALE_QUEUE_REVISION",
        "The Queue changed before the reorder was applied.",
        409,
      );
    if (
      !this.playbackPlanSnapshot.explicitQueue.some(
        (entry) => entry.explicitQueueEntryId === queueItemId,
      )
    )
      throw new PlayerError(
        "QUEUE_ITEM_NOT_FOUND",
        "Queue item not found.",
        404,
      );
    if (
      toIndex < 0 ||
      toIndex >= this.playbackPlanSnapshot.explicitQueue.length
    )
      throw new PlayerError(
        "INVALID_QUEUE_INDEX",
        "Queue position is out of range.",
      );
    this.playbackPlanner.reorderExplicit(
      queueItemId as ExplicitQueueEntryId,
      toIndex,
    );
    this.syncPlaybackPlan();
    if (this.playbackPlanSnapshot.current)
      await this.queueExecutionReconciliation();
  }

  async clearQueue(): Promise<void> {
    this.requireController();
    this.playbackPlanner.clearExplicitQueue();
    this.syncPlaybackPlan();
    if (this.playbackPlanSnapshot.current)
      await this.queueExecutionReconciliation();
  }

  async clearPlaybackContext(): Promise<void> {
    this.requireController();
    this.playbackPlanner.clearContext();
    this.syncPlaybackPlan();
    if (this.playbackPlanSnapshot.current)
      await this.queueExecutionReconciliation();
  }

  async playPause(metadata?: PlayerCommandRequestMetadata): Promise<void> {
    this.requirePlayableQueue();
    if (!this.playbackPlanSnapshot.current) {
      await this.startStagedPlayback();
      return;
    }
    const base =
      this.commandIntents.pendingPausedTarget() ??
      this.commandIntents.confirmedPausedTarget();
    await this.setPausedIntent(!base, metadata);
  }

  async play(metadata?: PlayerCommandRequestMetadata): Promise<void> {
    this.requirePlayableQueue();
    if (!this.playbackPlanSnapshot.current) {
      await this.startStagedPlayback();
      return;
    }
    await this.setPausedIntent(false, metadata);
  }

  private async startStagedPlayback(): Promise<void> {
    const attempt = this.beginPlaybackPlanAttempt();
    try {
      const before = this.playbackPlanner.serialize();
      const decision = this.playbackPlanner.start();
      this.syncPlaybackPlan();
      if (decision.kind === "start") this.hydrateCurrentPrimaryArtistIdentity();
      this.capturePlaybackPlanMutation(attempt, before);
      await this.applyPlannerDecision(decision, {
        autoplay: true,
        reloadCurrent: true,
        attempt,
      });
    } catch (error) {
      await this.restorePlaybackPlanAfterFailedDecision(attempt);
      throw error;
    } finally {
      this.finishPlaybackPlanAttempt(attempt);
    }
  }

  async pause(metadata?: PlayerCommandRequestMetadata): Promise<void> {
    this.requirePlayableQueue();
    await this.setPausedIntent(true, metadata);
  }

  async previous(
    metadata?: PlayerCommandRequestMetadata,
    targetQueueItemId?: string | null,
  ): Promise<void> {
    void targetQueueItemId;
    this.requirePlayableQueue();
    this.preparePlaybackWithoutBlocking();
    const intent = this.commandIntents.beginNavigation(null, metadata);
    if (!intent.accepted) return;
    this.hydrateCurrentPrimaryArtistIdentity();
    const attempt = this.beginPlaybackPlanAttempt();
    try {
      const before = this.playbackPlanner.serialize();
      const decision = this.playbackPlanner.previous(
        this.state.positionSeconds,
      );
      this.syncPlaybackPlan();
      if (decision.kind === "start") this.hydrateCurrentPrimaryArtistIdentity();
      this.capturePlaybackPlanMutation(attempt, before);
      this.commandIntents.record("navigation", "ipc-sent", intent.generation);
      await this.applyPlannerDecision(decision, {
        autoplay: true,
        reloadCurrent: decision.kind === "start",
        attempt,
      });
      this.commandIntents.acknowledge("navigation", intent.generation);
    } catch (error) {
      await this.restorePlaybackPlanAfterFailedDecision(attempt);
      this.commandIntents.fail("navigation", intent.generation);
      throw error;
    } finally {
      this.finishPlaybackPlanAttempt(attempt);
    }
  }

  async next(
    metadata?: PlayerCommandRequestMetadata,
    targetQueueItemId?: string | null,
  ): Promise<void> {
    void targetQueueItemId;
    this.requirePlayableQueue();
    this.hydrateCurrentPrimaryArtistIdentity();
    if (!this.playbackPlanner.canAdvance()) return;
    this.preparePlaybackWithoutBlocking();
    const intent = this.commandIntents.beginNavigation(null, metadata);
    if (!intent.accepted) return;
    const attempt = this.beginPlaybackPlanAttempt();
    try {
      const before = this.playbackPlanner.serialize();
      const decision = this.playbackPlanner.next();
      this.syncPlaybackPlan();
      if (decision.kind === "start") this.hydrateCurrentPrimaryArtistIdentity();
      this.capturePlaybackPlanMutation(attempt, before);
      this.commandIntents.record("navigation", "ipc-sent", intent.generation);
      if (decision.kind === "stop") {
        await this.restorePlaybackPlanAfterFailedDecision(attempt);
        this.commandIntents.acknowledge("navigation", intent.generation);
        return;
      }
      await this.applyPlannerDecision(decision, {
        autoplay: true,
        reloadCurrent: decision.kind === "start",
        attempt,
        preserveCurrentAtBoundary: true,
      });
      this.commandIntents.acknowledge("navigation", intent.generation);
    } catch (error) {
      await this.restorePlaybackPlanAfterFailedDecision(attempt);
      this.commandIntents.fail("navigation", intent.generation);
      throw error;
    } finally {
      this.finishPlaybackPlanAttempt(attempt);
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    this.requireTrack();
    const target = Math.max(
      0,
      Math.min(this.state.durationSeconds, positionSeconds),
    );
    for (const listener of this.seekListeners) listener(this.state);
    await this.requireController().seekWhenReady(target);
  }

  async setVolume(
    volume: number,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    const controller = this.requireController();
    const intent = this.commandIntents.beginVolume(volume, metadata);
    if (!intent.accepted) return;
    this.commandIntents.record("volume", "ipc-sent", intent.generation);
    try {
      await controller.setProperty("volume", volume);
      this.commandIntents.acknowledge("volume", intent.generation);
      const confirmed = await controller
        .getProperty("volume")
        .catch(() => undefined);
      if (typeof confirmed === "number" && Number.isFinite(confirmed))
        this.update({
          volume: this.commandIntents.observeVolume(
            Math.max(0, Math.min(100, confirmed)),
          ),
        });
    } catch (error) {
      this.commandIntents.fail("volume", intent.generation);
      throw error;
    }
  }

  async setMuted(
    muted: boolean,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    const controller = this.requireController();
    const intent = this.commandIntents.beginMute(muted, metadata);
    if (!intent.accepted) return;
    this.commandIntents.record("mute", "ipc-sent", intent.generation);
    try {
      await controller.setProperty("mute", muted);
      this.commandIntents.acknowledge("mute", intent.generation);
      const confirmed = await controller
        .getProperty("mute")
        .catch(() => undefined);
      if (typeof confirmed === "boolean")
        this.update({
          muted: this.commandIntents.observeMute(confirmed),
        });
    } catch (error) {
      this.commandIntents.fail("mute", intent.generation);
      throw error;
    }
  }

  async setRepeatMode(mode: RepeatMode): Promise<void> {
    const controller = this.requireController();
    this.playbackPlanner.setRepeatMode(mode);
    this.syncPlaybackPlan();
    await controller.setProperty("loop-file", mode === "one" ? "inf" : "no");
    await controller.setProperty("loop-playlist", "no");
    if (this.playbackPlanSnapshot.current)
      await this.queueExecutionReconciliation();
  }

  async setShuffle(enabled: boolean): Promise<void> {
    this.requireController();
    this.playbackPlanner.setShuffle(enabled);
    this.syncPlaybackPlan();
    if (this.playbackPlanSnapshot.current)
      await this.queueExecutionReconciliation();
  }

  async playQueueIndex(
    index: number,
    resolveOrigin?: (origin: PersistedQueueOrigin) => Promise<string>,
    queueItemId?: string,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    void resolveOrigin;
    const explicitQueue = this.playbackPlanSnapshot.explicitQueue;
    const selectedId =
      queueItemId ?? explicitQueue[index]?.explicitQueueEntryId;
    if (!selectedId || !isQueueItemId(selectedId))
      throw new PlayerError(
        "QUEUE_ITEM_NOT_FOUND",
        "Queue item not found.",
        404,
      );
    const currentIndex = explicitQueue.findIndex(
      (entry) => entry.explicitQueueEntryId === selectedId,
    );
    if (currentIndex < 0)
      throw new PlayerError(
        "QUEUE_ITEM_NOT_FOUND",
        "Queue item not found.",
        404,
      );
    if (queueItemId && index !== currentIndex)
      throw new PlayerError(
        "STALE_QUEUE_INDEX",
        "The Queue changed before the selected item was played.",
        409,
      );
    if (index < 0 || index >= explicitQueue.length)
      throw new PlayerError(
        "INVALID_QUEUE_INDEX",
        "Queue index is out of range.",
      );
    const intent = this.commandIntents.beginNavigation(null, metadata);
    if (!intent.accepted) return;
    const attempt = this.beginPlaybackPlanAttempt();
    try {
      const before = this.playbackPlanner.serialize();
      const decision = this.playbackPlanner.selectExplicit(
        selectedId as ExplicitQueueEntryId,
      );
      this.syncPlaybackPlan();
      if (decision.kind === "start") this.hydrateCurrentPrimaryArtistIdentity();
      this.capturePlaybackPlanMutation(attempt, before);
      this.commandIntents.record("navigation", "ipc-sent", intent.generation);
      await this.applyPlannerDecision(decision, {
        autoplay: true,
        reloadCurrent: decision.kind === "start",
        attempt,
      });
      this.commandIntents.acknowledge("navigation", intent.generation);
    } catch (error) {
      await this.restorePlaybackPlanAfterFailedDecision(attempt);
      this.commandIntents.fail("navigation", intent.generation);
      throw error;
    } finally {
      this.finishPlaybackPlanAttempt(attempt);
    }
  }

  private queueOccurrenceOrigin(
    item: QueueItem,
    index: number,
  ): PersistedQueueOrigin | undefined {
    const indexedExecutionId = this.playlistItemIds[index];
    return (
      this.executionOrigins.get(item.id) ??
      (indexedExecutionId
        ? this.executionOrigins.get(indexedExecutionId)
        : undefined)
    );
  }

  async setRemovableDeviceAvailable(
    deviceId: string,
    available: boolean,
  ): Promise<boolean> {
    this.removableAvailability.set(deviceId, available);
    this.updatePlannerAvailability(
      (origin) => origin.kind === "removable" && origin.sourceId === deviceId,
      available,
    );
    const currentIndex = this.state.currentQueueIndex;
    const current = this.state.queue[currentIndex];
    const currentOrigin = current
      ? this.queueOccurrenceOrigin(current, currentIndex)
      : undefined;
    const plannedCurrent = this.playbackPlanSnapshot.current;
    const plannedCurrentOrigin =
      current === undefined
        ? undefined
        : plannedCurrent?.executionEntryId === current.id
          ? plannedCurrent.item.origin
          : undefined;
    const stoppedCurrent =
      !available &&
      ((plannedCurrentOrigin?.kind === "removable" &&
        plannedCurrentOrigin.sourceId === deviceId) ||
        (currentOrigin?.kind === "removable" &&
          currentOrigin.deviceId === deviceId));
    if (stoppedCurrent)
      await this.controller
        ?.command(["stop", "keep-playlist"])
        .catch(() => undefined);
    const queue = this.state.queue.map((item, index) => {
      const origin = this.queueOccurrenceOrigin(item, index);
      return origin?.kind === "removable" && origin.deviceId === deviceId
        ? { ...item, available }
        : item;
    });
    if (
      stoppedCurrent ||
      queue.some((item, index) => item !== this.state.queue[index])
    )
      this.update({
        ...(stoppedCurrent ? { status: "stopped" as const, paused: true } : {}),
        queue,
        queueRevision: this.state.queueRevision,
      });
    if (this.playbackPlanSnapshot.current)
      await this.queueExecutionReconciliation();
    return stoppedCurrent;
  }

  async setFolderSourceAvailable(
    sourceId: string,
    available: boolean,
  ): Promise<boolean> {
    this.folderSourceAvailability.set(sourceId, available);
    this.updatePlannerAvailability(
      (origin) => origin.kind === "folder" && origin.sourceId === sourceId,
      available,
    );
    const currentIndex = this.state.currentQueueIndex;
    const current = this.state.queue[currentIndex];
    const currentOrigin = current
      ? this.queueOccurrenceOrigin(current, currentIndex)
      : undefined;
    const plannedCurrent = this.playbackPlanSnapshot.current;
    const plannedCurrentOrigin =
      current === undefined
        ? undefined
        : plannedCurrent?.executionEntryId === current.id
          ? plannedCurrent.item.origin
          : undefined;
    const stoppedCurrent =
      !available &&
      ((plannedCurrentOrigin?.kind === "folder" &&
        plannedCurrentOrigin.removable === true &&
        plannedCurrentOrigin.sourceId === sourceId) ||
        (currentOrigin?.kind === "folders" &&
          currentOrigin.removable === true &&
          currentOrigin.sourceId === sourceId));
    if (stoppedCurrent)
      await this.controller
        ?.command(["stop", "keep-playlist"])
        .catch(() => undefined);
    const queue = this.state.queue.map((item, itemIndex) => {
      const origin = this.queueOccurrenceOrigin(item, itemIndex);
      return origin?.kind === "folders" &&
        origin.removable === true &&
        origin.sourceId === sourceId
        ? { ...item, available }
        : item;
    });
    if (
      stoppedCurrent ||
      queue.some((item, itemIndex) => item !== this.state.queue[itemIndex])
    )
      this.update({
        ...(stoppedCurrent ? { status: "stopped" as const, paused: true } : {}),
        queue,
        queueRevision: this.state.queueRevision,
      });
    if (this.playbackPlanSnapshot.current)
      await this.queueExecutionReconciliation();
    return stoppedCurrent;
  }

  async setSmbConnectionAvailable(
    connectionId: string,
    available: boolean,
  ): Promise<boolean> {
    this.smbAvailability.set(connectionId, available);
    this.updatePlannerAvailability(
      (origin) => origin.kind === "smb" && origin.sourceId === connectionId,
      available,
    );
    const currentIndex = this.state.currentQueueIndex;
    const current = this.state.queue[currentIndex];
    const currentOrigin = current
      ? this.queueOccurrenceOrigin(current, currentIndex)
      : undefined;
    const plannedCurrent = this.playbackPlanSnapshot.current;
    const plannedCurrentOrigin =
      current === undefined
        ? undefined
        : plannedCurrent?.executionEntryId === current.id
          ? plannedCurrent.item.origin
          : undefined;
    const stoppedCurrent =
      !available &&
      ((plannedCurrentOrigin?.kind === "smb" &&
        plannedCurrentOrigin.sourceId === connectionId) ||
        (currentOrigin?.kind === "smb" &&
          currentOrigin.connectionId === connectionId));
    if (stoppedCurrent)
      await this.controller
        ?.command(["stop", "keep-playlist"])
        .catch(() => undefined);
    const queue = this.state.queue.map((item, index) => {
      const origin = this.queueOccurrenceOrigin(item, index);
      return origin?.kind === "smb" && origin.connectionId === connectionId
        ? { ...item, available }
        : item;
    });
    if (
      stoppedCurrent ||
      queue.some((item, index) => item !== this.state.queue[index])
    )
      this.update({
        ...(stoppedCurrent ? { status: "stopped" as const, paused: true } : {}),
        queue,
        queueRevision: this.state.queueRevision,
      });
    if (this.playbackPlanSnapshot.current)
      await this.queueExecutionReconciliation();
    return stoppedCurrent;
  }

  removableUsage(
    deviceIds: readonly string[],
    sourceIds: readonly string[],
  ): {
    readonly playbackWillStop: boolean;
    readonly queueContainsItems: boolean;
  } {
    const devices = new Set(deviceIds);
    const sources = new Set(sourceIds);
    const matches = (item: QueueItem, index: number): boolean => {
      const origin = this.queueOccurrenceOrigin(item, index);
      return (
        (origin?.kind === "removable" && devices.has(origin.deviceId)) ||
        (origin?.kind === "folders" &&
          origin.removable === true &&
          sources.has(origin.sourceId))
      );
    };
    const matchesPlannedOrigin = (origin: PlaybackItemOrigin): boolean =>
      (origin.kind === "removable" &&
        origin.sourceId !== undefined &&
        devices.has(origin.sourceId)) ||
      (origin.kind === "folder" &&
        origin.sourceId !== undefined &&
        sources.has(origin.sourceId));
    const current = this.state.queue[this.state.currentQueueIndex];
    const plan = this.playbackPlanSnapshot;
    const plannedFutureContainsItems =
      plan.explicitQueue.some((entry) =>
        matchesPlannedOrigin(entry.item.origin),
      ) ||
      (plan.context?.originalItems.some((entry) =>
        matchesPlannedOrigin(entry.item.origin),
      ) ??
        false);
    return {
      queueContainsItems:
        plannedFutureContainsItems ||
        this.state.queue.some((item, index) => matches(item, index)),
      playbackWillStop:
        this.state.status !== "stopped" &&
        ((plan.current !== null &&
          matchesPlannedOrigin(plan.current.item.origin)) ||
          (current !== undefined &&
            matches(current, this.state.currentQueueIndex))),
    };
  }

  getArtworkResource(id: string): Promise<ArtworkResource | null> {
    return this.artworkService.getResource(id);
  }

  async resolveQueueArtwork(queueItemId: string): Promise<ArtworkRef | null> {
    if (!isQueueItemId(queueItemId)) return null;
    const planned = this.plannedItemByPublicId(queueItemId);
    const technical = this.state.queue.find(
      (candidate) => candidate.id === planned?.executionEntryId,
    );
    const path = planned?.item.nativePath ?? technical?.path;
    if (!path) return null;
    return this.queueArtworkConcurrency.run(async () => {
      try {
        const result = await this.resolveEnrichment(path);
        this.rememberPreloaded(path, result);
        if (technical) {
          const queue = this.withQueueEnrichment(
            path,
            result.metadata.durationSeconds,
            result.artwork,
          );
          if (queue !== this.state.queue) {
            this.update({
              queue,
              queueRevision: this.state.queueRevision,
            });
          }
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
      this.plannedItemByPublicId(queueItemId)?.item.nativePath ??
      this.state.queue.find((candidate) => candidate.id === queueItemId)
        ?.path ??
      null
    );
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.commandIntents.dispose();
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
    this.naturalEndListeners.clear();
    this.seekListeners.clear();
    this.audioOutputPropertyListeners.clear();
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
    this.playlistItemIds = [];
    this.queueOrigins.clear();
    this.executionOrigins.clear();
    this.enrichmentGeneration += 1;
    this.enrichmentPathKey = null;
    this.currentEnrichment = null;
    this.nextArtwork = null;
    this.preloadedEnrichments.clear();
    this.transitionPending = false;
    this.clearPendingTrackTarget();
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
    const recovery = {
      status: this.state.status,
      positionSeconds: this.state.positionSeconds,
      volume: this.state.volume,
      muted: this.state.muted,
      paused: this.state.paused,
    };
    this.controller = null;
    this.unsubscribeMpv?.();
    this.unsubscribeMpv = null;
    for (const listener of this.audioOutputPropertyListeners)
      listener("audio-device-list", undefined);
    for (const listener of this.audioOutputPropertyListeners)
      listener("current-ao", null);
    if (this.shuttingDown) return;
    const canRestart = !this.restartAttempted && this.executable !== null;
    this.update({
      status: canRestart ? "loading" : "unavailable",
      mpvAvailable: false,
      error: { code: "MPV_EXITED", message: "MPV stopped unexpectedly." },
    });
    if (!canRestart) return;
    this.restartAttempted = true;
    try {
      await this.startController();
      this.properties.clear();
      this.executionReconcileGeneration += 1;
      this.plannerNavigationPending = false;
      this.preparingPlaylist = false;
      this.resetLocalState();
      this.update({
        mpvAvailable: true,
        status: "loading",
        error: null,
      });
      const controller = this.requireController();
      const current = this.playbackPlanSnapshot.current;
      const resumePlayback = recovery.status === "playing" && !recovery.paused;
      if (
        current?.item.availability === "available" &&
        recovery.status !== "stopped"
      ) {
        await this.applyPlannerDecision(
          {
            kind: "start",
            reason: "context-resume",
            current,
          },
          { autoplay: false, reloadCurrent: true },
        );
        await controller.setProperty("volume", recovery.volume);
        await controller.setProperty("mute", recovery.muted);
        if (recovery.positionSeconds > 0.05)
          await controller.seekWhenReady(recovery.positionSeconds);
        if (resumePlayback) {
          await this.beforePlayback();
          await controller.setProperty("pause", false);
        }
        this.commandIntents.observeVolume(recovery.volume);
        this.commandIntents.observeMute(recovery.muted);
        this.commandIntents.observePaused(!resumePlayback);
        this.update({
          status: resumePlayback ? "playing" : "paused",
          positionSeconds: recovery.positionSeconds,
          volume: recovery.volume,
          muted: recovery.muted,
          paused: !resumePlayback,
          error: null,
        });
      } else {
        this.update({
          status:
            current || this.playbackPlanSnapshot.explicitQueue.length > 0
              ? "stopped"
              : "idle",
          positionSeconds: current ? recovery.positionSeconds : 0,
          volume: recovery.volume,
          muted: recovery.muted,
          paused: true,
          error: null,
        });
      }
      const [deviceList, device, currentAo] = await Promise.all([
        controller.getProperty("audio-device-list"),
        controller.getProperty("audio-device"),
        controller.getProperty("current-ao"),
      ]);
      for (const listener of this.audioOutputPropertyListeners) {
        listener("audio-device-list", deviceList);
        listener("audio-device", device);
        listener("current-ao", currentAo);
      }
    } catch (error) {
      const failedController = this.controller as MpvController | null;
      const failedUnsubscribe = this.unsubscribeMpv as (() => void) | null;
      failedUnsubscribe?.();
      this.unsubscribeMpv = null;
      this.controller = null;
      await failedController?.stop().catch(() => undefined);
      this.update({
        status: "unavailable",
        mpvAvailable: false,
        error: {
          code: "MPV_RESTART_FAILED",
          message: "MPV could not be restarted automatically.",
        },
      });
      console.error("[player] controlled MPV restart failed", error);
    }
  }

  private handleMpvMessage(message: MpvResponse): void {
    if (
      message.event === "property-change" &&
      typeof message.name === "string"
    ) {
      this.properties.set(message.name, message.data);
      this.propertyVersions.set(
        message.name,
        (this.propertyVersions.get(message.name) ?? 0) + 1,
      );
      if (
        message.name === "audio-device" ||
        message.name === "audio-device-list" ||
        message.name === "current-ao"
      )
        for (const listener of this.audioOutputPropertyListeners)
          listener(message.name, message.data);
      if (message.name === "audio-device" || message.name === "current-ao")
        this.reapplyPendingLevelsAfterOutputChange();
      if (message.name === "volume") {
        this.update({
          volume: this.commandIntents.observeVolume(
            Math.max(
              0,
              Math.min(100, this.asNumber(message.data, this.state.volume)),
            ),
          ),
        });
      } else if (message.name === "mute") {
        this.update({
          muted: this.commandIntents.observeMute(
            this.asBoolean(message.data, this.state.muted),
          ),
        });
      } else if (message.name === "pause") {
        this.flushPosition();
        this.update({
          paused: this.commandIntents.observePaused(
            this.asBoolean(message.data, this.state.paused),
          ),
        });
      }
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
        this.deriveStateFromProperties();
      }
      return;
    }
    switch (message.event) {
      case "start-file":
        if (this.preparingPlaylist) break;
        this.commandIntents.record("navigation", "start-file");
        this.beginTrackTransition();
        break;
      case "file-loaded":
        if (this.preparingPlaylist) break;
        this.commandIntents.record("navigation", "file-loaded");
        this.queuePlannerTransition(() => this.handlePlannerFileLoaded());
        break;
      case "playback-restart":
        if (this.preparingPlaylist) break;
        this.commandIntents.record("navigation", "playback-restart");
        void this.refreshProperties();
        break;
      case "end-file":
        if ((message as { reason?: unknown }).reason === "error")
          this.updateError("PLAYBACK_FAILED", "MPV could not play this file.");
        else {
          this.flushPosition();
          if ((message as { reason?: unknown }).reason === "eof") {
            for (const listener of this.naturalEndListeners)
              listener(this.state);
            if (this.playbackPlanSnapshot.repeatMode !== "one")
              this.queuePlannerTransition(() => this.handlePlannerNaturalEnd());
          }
        }
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

  private queuePlannerTransition(operation: () => Promise<void>): void {
    const next = this.plannerTransitionChain.then(operation);
    this.plannerTransitionChain = next.catch((error: unknown) => {
      console.warn("[playback-plan] transition reconciliation failed", error);
    });
  }

  private async handlePlannerNaturalEnd(): Promise<void> {
    if (!this.playbackPlanSnapshot.current) return;
    this.hydrateCurrentPrimaryArtistIdentity();
    const attempt = this.beginPlaybackPlanAttempt();
    try {
      const before = this.playbackPlanner.serialize();
      const decision = this.playbackPlanner.advance();
      this.syncPlaybackPlan();
      if (decision.kind === "start") {
        this.hydrateCurrentPrimaryArtistIdentity();
        this.capturePlaybackPlanMutation(attempt, before);
        const existingIndex = this.playlistItemIds.indexOf(
          decision.current.executionEntryId,
        );
        if (existingIndex >= 0) {
          this.plannerNavigationPending = true;
          return;
        }
      } else this.capturePlaybackPlanMutation(attempt, before);
      await this.applyPlannerDecision(decision, {
        autoplay: true,
        reloadCurrent: decision.kind === "start",
        attempt,
      });
    } catch (error) {
      await this.restorePlaybackPlanAfterFailedDecision(attempt);
      throw error;
    } finally {
      this.finishPlaybackPlanAttempt(attempt);
    }
  }

  private async handlePlannerFileLoaded(): Promise<void> {
    const controller = this.controller;
    if (!controller) return;
    const playlistIndex = Math.trunc(
      this.asNumber(await controller.getProperty("playlist-pos"), -1),
    );
    const actualExecutionId = this.playlistItemIds[playlistIndex] ?? null;
    let expectedExecutionId =
      this.playbackPlanSnapshot.current?.executionEntryId ?? null;
    if (
      actualExecutionId &&
      expectedExecutionId &&
      actualExecutionId !== expectedExecutionId &&
      !this.plannerNavigationPending
    ) {
      this.hydrateCurrentPrimaryArtistIdentity();
      const previousPlan = this.playbackPlanner.serialize();
      const decision = this.playbackPlanner.advance();
      this.syncPlaybackPlan();
      if (
        decision.kind !== "start" ||
        decision.current.executionEntryId !== actualExecutionId
      ) {
        this.playbackPlanner.restore(previousPlan);
        this.syncPlaybackPlan();
      } else this.hydrateCurrentPrimaryArtistIdentity();
      expectedExecutionId =
        this.playbackPlanSnapshot.current?.executionEntryId ?? null;
    }
    this.plannerNavigationPending = false;
    await this.refreshProperties();
    if (actualExecutionId && actualExecutionId === expectedExecutionId)
      await this.queueExecutionReconciliation();
  }

  private async refreshProperties(): Promise<void> {
    const controller = this.controller;
    if (!controller) return;
    const refreshGeneration = ++this.refreshGeneration;
    const transitionGeneration = this.transitionGeneration;
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
      "idle-active",
    ];
    const versions = names.map((name) => this.propertyVersions.get(name) ?? 0);
    const values = await Promise.all(
      names.map(async (name) => {
        try {
          return await controller.getProperty(name, "background");
        } catch {
          return undefined;
        }
      }),
    );
    if (
      refreshGeneration !== this.refreshGeneration ||
      transitionGeneration !== this.transitionGeneration
    ) {
      this.commandIntents.record("navigation", "stale-discarded");
      return;
    }
    names.forEach((name, index) => {
      if ((this.propertyVersions.get(name) ?? 0) === versions[index])
        this.properties.set(name, values[index]);
      else this.commandIntents.record("navigation", "stale-discarded");
    });
    this.transitionPending = false;
    this.deriveStateFromProperties();
  }

  private beginTrackTransition(): void {
    this.transitionGeneration += 1;
    this.commandIntents.record("navigation", "transition-start");
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
    const pause = this.commandIntents.observePaused(
      this.asBoolean(this.properties.get("pause"), this.state.paused),
    );
    const idle = this.asBoolean(this.properties.get("idle-active"), false);
    const duration = this.asNumber(this.properties.get("duration"));
    const path = this.asString(this.properties.get("path"));
    const playlistIndex = Math.trunc(
      this.asNumber(this.properties.get("playlist-pos"), -1),
    );
    const queue = this.createQueue(
      this.properties.get("playlist"),
      playlistIndex,
      duration,
    );
    const queueStructureChanged =
      queue.length !== this.state.queue.length ||
      queue.some((item, index) => item.id !== this.state.queue[index]?.id);
    const currentQueueItemId = this.playlistItemIds[playlistIndex] ?? null;
    const previousQueueItemId =
      this.state.queue[this.state.currentQueueIndex]?.id ?? null;
    const occurrenceChanged = currentQueueItemId !== previousQueueItemId;
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
    }
    if (path && (trackChanged || occurrenceChanged))
      this.trackTransitionId += 1;
    const currentTrack = path ? this.createTrack(path, duration) : null;
    this.commandIntents.confirmNavigation(currentQueueItemId);
    if (currentQueueItemId === this.pendingTrackTargetId)
      this.clearPendingTrackTarget();
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
      queueRevision: queueStructureChanged
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
      volume: this.commandIntents.observeVolume(
        Math.max(
          0,
          Math.min(
            100,
            this.asNumber(this.properties.get("volume"), this.state.volume),
          ),
        ),
      ),
      muted: this.commandIntents.observeMute(
        this.asBoolean(this.properties.get("mute"), this.state.muted),
      ),
      audioDevice: this.formatAudioDevice(this.properties.get("audio-device")),
      error: null,
    });
    if (trackChanged && path) {
      const nextPath = queue[playlistIndex + 1]?.path ?? null;
      const previousPath = queue[playlistIndex - 1]?.path ?? null;
      this.scheduleCurrentEnrichment(path, nextPath, previousPath);
    }
  }

  private createQueue(
    value: unknown,
    currentIndex: number,
    currentDurationSeconds: number,
  ): QueueItem[] {
    if (!Array.isArray(value)) return this.state.queue as QueueItem[];
    const next = value.flatMap((entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const playlistEntry = entry as MpvPlaylistEntry;
      const path = this.asString(playlistEntry.filename);
      if (!path) return [];
      const filename = basename(path);
      const key = this.pathKey(path);
      const preferredId = this.playlistItemIds[index];
      const previousById = preferredId
        ? this.state.queue.find((item) => item.id === preferredId)
        : undefined;
      const previousAtIndex = this.state.queue[index];
      const previous =
        previousById ??
        (previousAtIndex && this.pathKey(previousAtIndex.path) === key
          ? previousAtIndex
          : undefined);
      const origin =
        (preferredId ? this.executionOrigins.get(preferredId) : undefined) ??
        this.queueOrigins.get(key);
      let id = preferredId ?? this.itemIds.get(key);
      if (!id) {
        id = `queue-${randomUUID()}`;
        this.itemIds.set(key, id);
        this.playlistItemIds[index] = id;
      }
      const playbackInstanceId =
        id === this.playbackPlanSnapshot.current?.executionEntryId
          ? this.playbackPlanSnapshot.current.playbackInstanceId
          : undefined;
      return [
        {
          id,
          ...(playbackInstanceId ? { playbackInstanceId } : {}),
          index,
          path,
          filename,
          displayTitle:
            this.asString(playlistEntry.title) ??
            filename.replace(/\.[^.]+$/, ""),
          durationSeconds:
            index === currentIndex && currentDurationSeconds > 0
              ? currentDurationSeconds
              : previous?.durationSeconds,
          artwork: previous?.artwork ?? null,
          isCurrent:
            index === currentIndex ||
            playlistEntry.current === true ||
            playlistEntry.playing === true,
          available:
            origin?.kind === "removable"
              ? (this.removableAvailability.get(origin.deviceId) ?? true)
              : origin?.kind === "smb"
                ? (this.smbAvailability.get(origin.connectionId) ?? true)
                : origin?.kind === "folders"
                  ? (this.folderSourceAvailability.get(origin.sourceId) ?? true)
                  : true,
          ...(origin?.kind === "folders" && origin.libraryTrackId
            ? { libraryTrackId: origin.libraryTrackId }
            : {}),
        },
      ];
    });
    if (
      next.length === this.state.queue.length &&
      next.every((item, index) => {
        const previous = this.state.queue[index];
        return (
          previous?.id === item.id &&
          previous.playbackInstanceId === item.playbackInstanceId &&
          previous.index === item.index &&
          previous.path === item.path &&
          previous.filename === item.filename &&
          previous.displayTitle === item.displayTitle &&
          previous.durationSeconds === item.durationSeconds &&
          previous.artwork?.id === item.artwork?.id &&
          previous.libraryTrackId === item.libraryTrackId &&
          previous.available === item.available &&
          previous.isCurrent === item.isCurrent
        );
      })
    )
      return this.state.queue as QueueItem[];
    return next;
  }

  private capturePlaylistIdentities(
    paths: readonly string[],
    ids: readonly string[],
  ): Map<string, string[]> {
    const identities = new Map<string, string[]>();
    paths.forEach((path, index) => {
      const id = ids[index];
      if (!id) return;
      const key = this.pathKey(path);
      const matches = identities.get(key);
      if (matches) matches.push(id);
      else identities.set(key, [id]);
    });
    return identities;
  }

  private alignPlaylistItemIds(
    value: unknown,
    identities: ReadonlyMap<string, readonly string[]>,
  ): void {
    if (!Array.isArray(value)) return;
    const occurrences = new Map<string, number>();
    this.playlistItemIds = value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const path = this.asString((entry as MpvPlaylistEntry).filename);
      if (!path) return [];
      const key = this.pathKey(path);
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      return [identities.get(key)?.[occurrence] ?? `queue-${randomUUID()}`];
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
        if (!names.some((name) => key.toLowerCase() === name.toLowerCase()))
          continue;
        const normalized = normalizeMetadataText(value);
        if (normalized) return normalized;
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
    const playlistIndex = Math.trunc(
      this.asNumber(this.properties.get("playlist-pos"), -1),
    );
    const executionEntryId = this.playlistItemIds[playlistIndex];
    const origin =
      (executionEntryId
        ? this.executionOrigins.get(executionEntryId)
        : undefined) ?? this.queueOrigins.get(this.pathKey(path));
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
      source:
        origin?.kind === "smb"
          ? "Network Share"
          : origin?.kind === "folders" && origin.smb
            ? "Network Share"
            : origin?.kind === "removable" ||
                (origin?.kind === "folders" && origin.removable)
              ? "USB Storage"
              : "Local File",
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
          const queue = this.withQueueEnrichment(
            path,
            result.metadata.durationSeconds,
            result.artwork,
          );
          this.update({
            currentTrack: mergeTrackMetadata(
              current,
              result.metadata,
              result.artwork,
            ),
            queue,
            queueRevision: this.state.queueRevision,
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
          queue = this.withQueueEnrichment(
            nextPath,
            next.metadata.durationSeconds,
            next.artwork,
            queue,
          );
        }
        if (previousPath) {
          if (!this.canApplyGeneration(generation)) return;
          const previous = await this.resolveEnrichment(previousPath);
          if (!this.canApplyGeneration(generation)) return;
          this.rememberPreloaded(previousPath, previous);
          queue = this.withQueueEnrichment(
            previousPath,
            previous.metadata.durationSeconds,
            previous.artwork,
            queue,
          );
        }
        if (queue !== this.state.queue)
          this.update({
            queue,
            queueRevision: this.state.queueRevision,
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

  private withQueueEnrichment(
    path: string,
    durationSeconds: number | null,
    artwork: ArtworkRef | null,
    source: readonly QueueItem[] = this.state.queue,
  ): readonly QueueItem[] {
    const key = this.pathKey(path);
    const queue = source.map((item) => {
      if (this.pathKey(item.path) !== key) return item;
      const duration =
        typeof durationSeconds === "number" && durationSeconds > 0
          ? durationSeconds
          : item.durationSeconds;
      if (item.artwork?.id === artwork?.id && item.durationSeconds === duration)
        return item;
      return { ...item, artwork, durationSeconds: duration };
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

  private publishCommandState(commands: PlayerCommandState): void {
    const volume =
      commands.volume.phase === "pending" ||
      commands.volume.phase === "acknowledged" ||
      commands.volume.phase === "failed"
        ? commands.volume.target
        : this.state.volume;
    const muted =
      commands.mute.phase === "pending" ||
      commands.mute.phase === "acknowledged" ||
      commands.mute.phase === "failed"
        ? commands.mute.target
        : this.state.muted;
    const paused =
      commands.transport.phase === "pending" ||
      commands.transport.phase === "acknowledged" ||
      commands.transport.phase === "failed"
        ? commands.transport.target
        : this.state.paused;
    this.update({ commands, volume, muted, paused });
  }

  private async setPausedIntent(
    targetPaused: boolean,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    if (!targetPaused) this.preparePlaybackWithoutBlocking();
    const intent = this.commandIntents.beginTransport(targetPaused, metadata);
    if (!intent.accepted) return;
    const controller = this.requireController();
    this.commandIntents.record("transport", "ipc-sent", intent.generation);
    try {
      if (
        !targetPaused &&
        this.state.status === "stopped" &&
        this.playbackPlanSnapshot.current
      )
        await this.loadPlannerExecutionPlan(true);
      else await controller.setProperty("pause", targetPaused);
      this.commandIntents.acknowledge("transport", intent.generation);
      const confirmed = await controller
        .getProperty("pause")
        .catch(() => undefined);
      if (typeof confirmed === "boolean")
        this.update({
          paused: this.commandIntents.observePaused(confirmed),
        });
    } catch (error) {
      this.commandIntents.fail("transport", intent.generation);
      throw error;
    }
  }

  private async navigateToIndex(
    targetIndex: number,
    metadata?: PlayerCommandRequestMetadata,
  ): Promise<void> {
    const target = this.state.queue[targetIndex];
    if (!target)
      throw new PlayerError(
        "INVALID_QUEUE_INDEX",
        "Queue index is out of range.",
      );
    const intent = this.commandIntents.beginNavigation(target.id, metadata);
    if (!intent.accepted) return;
    this.pendingTrackTargetId = target.id;
    this.pendingTrackTargetExpiresAt = performance.now() + 10_000;
    this.transitionGeneration += 1;
    const controller = this.requireController();
    this.commandIntents.record("navigation", "ipc-sent", intent.generation);
    try {
      await controller.setProperty("playlist-pos", targetIndex);
      this.commandIntents.acknowledge("navigation", intent.generation);
    } catch (error) {
      this.clearPendingTrackTarget();
      this.commandIntents.fail("navigation", intent.generation);
      throw error;
    }
  }

  private acknowledgeNavigationNoop(
    metadata?: PlayerCommandRequestMetadata,
  ): void {
    const currentId =
      this.state.queue[this.state.currentQueueIndex]?.id ?? null;
    const intent = this.commandIntents.beginNavigation(currentId, metadata);
    if (!intent.accepted) return;
    this.commandIntents.acknowledge("navigation", intent.generation);
  }

  private pendingTargetIndex(): number {
    if (
      this.pendingTrackTargetId &&
      performance.now() <= this.pendingTrackTargetExpiresAt
    ) {
      const pendingIndex = this.state.queue.findIndex(
        (item) => item.id === this.pendingTrackTargetId,
      );
      if (pendingIndex >= 0) return pendingIndex;
    }
    this.clearPendingTrackTarget();
    return this.state.currentQueueIndex;
  }

  private clearPendingTrackTarget(): void {
    this.pendingTrackTargetId = null;
    this.pendingTrackTargetExpiresAt = 0;
  }

  private preparePlaybackWithoutBlocking(): void {
    void this.beforePlayback().catch(() => {
      console.warn("[audio-output] non-blocking playback preparation failed");
    });
  }

  private reapplyPendingLevelsAfterOutputChange(): void {
    const controller = this.controller;
    if (!controller) return;
    const volume = this.commandIntents.pendingVolume();
    if (
      volume &&
      volume.generation !== this.lastOutputVolumeReapplyGeneration
    ) {
      this.lastOutputVolumeReapplyGeneration = volume.generation;
      this.commandIntents.record("volume", "ipc-sent", volume.generation);
      void controller
        .setProperty("volume", volume.target)
        .then(() => {
          this.commandIntents.acknowledge("volume", volume.generation);
        })
        .catch(() => {
          this.commandIntents.fail("volume", volume.generation);
        });
    }
    const mute = this.commandIntents.pendingMute();
    if (mute && mute.generation !== this.lastOutputMuteReapplyGeneration) {
      this.lastOutputMuteReapplyGeneration = mute.generation;
      this.commandIntents.record("mute", "ipc-sent", mute.generation);
      void controller
        .setProperty("mute", mute.target)
        .then(() => {
          this.commandIntents.acknowledge("mute", mute.generation);
        })
        .catch(() => {
          this.commandIntents.fail("mute", mute.generation);
        });
    }
  }

  private update(patch: Partial<PlayerState>): void {
    this.state = Object.freeze({ ...this.state, ...patch });
    if (this.commandIntents.hasPendingIntent())
      this.commandIntents.record("navigation", "state-published");
    for (const listener of this.listeners) listener(this.state);
    this.notifyLibraryPriorityWaiters();
  }

  private hasLibraryPriorityWork(): boolean {
    return (
      this.state.status === "loading" ||
      this.transitionPending ||
      this.preparingPlaylist ||
      this.pendingTrackTargetId !== null ||
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

  private requirePlayableQueue(): void {
    this.requireController();
    if (
      !this.playbackPlanSnapshot.current &&
      this.playbackPlanSnapshot.explicitQueue.length === 0
    )
      throw new PlayerError("NO_TRACK", "No track is loaded.", 409);
  }

  private playbackSeed(
    path: string,
    origin: PersistedQueueOrigin | undefined,
    overrides: { readonly libraryTrackId?: string } = {},
  ): PlaybackItemSeed {
    const filename = basename(path);
    const normalizedOrigin =
      origin ?? ({ kind: "direct", nativePath: path } as const);
    return {
      nativePath: path,
      filename,
      title: filename.replace(/\.[^.]+$/, ""),
      libraryTrackId:
        overrides.libraryTrackId ??
        (normalizedOrigin.kind === "folders"
          ? (normalizedOrigin.libraryTrackId ?? null)
          : null),
      availability: this.originAvailable(normalizedOrigin)
        ? "available"
        : "unavailable",
      origin: this.playbackOrigin(normalizedOrigin),
    };
  }

  private playbackOrigin(origin: PersistedQueueOrigin): PlaybackItemOrigin {
    if (origin.kind === "direct") return { kind: "direct" };
    if (origin.kind === "removable")
      return {
        kind: "removable",
        sourceId: origin.deviceId,
        relativePath: origin.relativePath,
        entryId: origin.entryId,
      };
    if (origin.kind === "smb")
      return {
        kind: "smb",
        sourceId: origin.connectionId,
        relativePath: origin.relativePath,
        entryId: origin.entryId,
      };
    return {
      kind: "folder",
      sourceId: origin.sourceId,
      relativePath: origin.relativePath,
      ...(origin.removable ? { removable: true } : {}),
      ...(origin.smb ? { smb: true } : {}),
    };
  }

  private persistedOrigin(
    entry: PlaybackExecutionPlanEntry,
  ): PersistedQueueOrigin {
    const origin = entry.item.origin;
    if (origin.kind === "removable")
      return {
        kind: "removable",
        deviceId: origin.sourceId ?? "usb-unavailable",
        relativePath: origin.relativePath ?? "",
        entryId: origin.entryId ?? "entry-unavailable",
      };
    if (origin.kind === "smb")
      return {
        kind: "smb",
        connectionId: origin.sourceId ?? "smb-unavailable",
        relativePath: origin.relativePath ?? "",
        entryId: origin.entryId ?? "entry-unavailable",
      };
    if (origin.kind === "folder" || origin.kind === "library")
      return {
        kind: "folders",
        sourceId: origin.sourceId ?? "00000000-0000-0000-0000-000000000000",
        relativePath: origin.relativePath ?? "",
        ...(entry.item.libraryTrackId
          ? { libraryTrackId: entry.item.libraryTrackId }
          : {}),
        ...(origin.removable ? { removable: true } : {}),
        ...(origin.smb ? { smb: true } : {}),
      };
    return { kind: "direct", nativePath: entry.item.nativePath };
  }

  private originForInput(
    path: string,
    inputPaths: readonly string[],
    origins: readonly PersistedQueueOrigin[] | undefined,
    fallbackIndex: number,
  ): PersistedQueueOrigin {
    const aligned = origins?.[fallbackIndex];
    if (aligned) return aligned;
    const inputIndex = inputPaths.findIndex(
      (candidate) => this.pathKey(candidate) === this.pathKey(path),
    );
    return (
      origins?.[inputIndex] ?? ({ kind: "direct", nativePath: path } as const)
    );
  }

  private inferPlaybackContext(
    paths: readonly string[],
    origins: readonly PersistedQueueOrigin[],
    selectedIndex: number,
  ): PlaybackContextDescriptor {
    const selectedPath = paths[selectedIndex] ?? paths[0] ?? "Music";
    const first = origins[0];
    if (first?.kind === "folders")
      return {
        kind: "folder",
        title: basename(dirname(selectedPath)) || "Library tracks",
        entityId: first.sourceId,
        source: {
          label: first.smb
            ? "Network share"
            : first.removable
              ? "USB storage"
              : "Library",
          sourceId: first.sourceId,
          relativePath: first.relativePath,
        },
      };
    if (first?.kind === "removable")
      return {
        kind: "folder",
        title: basename(dirname(selectedPath)) || "USB storage",
        entityId: first.deviceId,
        source: {
          label: "USB storage",
          sourceId: first.deviceId,
          relativePath: first.relativePath,
        },
      };
    if (first?.kind === "smb")
      return {
        kind: "folder",
        title: basename(dirname(selectedPath)) || "Network share",
        entityId: first.connectionId,
        source: {
          label: "Network share",
          sourceId: first.connectionId,
          relativePath: first.relativePath,
        },
      };
    return {
      kind: "direct-folder",
      title: basename(dirname(selectedPath)) || "Files",
      source: { label: "Files" },
    };
  }

  private originAvailable(origin: PersistedQueueOrigin): boolean {
    if (origin.kind === "removable")
      return this.removableAvailability.get(origin.deviceId) ?? true;
    if (origin.kind === "smb")
      return this.smbAvailability.get(origin.connectionId) ?? true;
    if (origin.kind === "folders")
      return this.folderSourceAvailability.get(origin.sourceId) ?? true;
    return true;
  }

  private updatePlannerAvailability(
    matches: (origin: PlaybackItemOrigin) => boolean,
    available: boolean,
  ): void {
    const availability = available ? "available" : "unavailable";
    const snapshot = this.playbackPlanSnapshot;
    for (const entry of snapshot.history.entries)
      if (matches(entry.item.origin))
        this.playbackPlanner.setHistoryAvailability(
          entry.historyEntryId,
          availability,
        );
    if (snapshot.current && matches(snapshot.current.item.origin))
      this.playbackPlanner.setCurrentAvailability(availability);
    for (const entry of snapshot.explicitQueue)
      if (matches(entry.item.origin))
        this.playbackPlanner.setExplicitAvailability(
          entry.explicitQueueEntryId,
          availability,
        );
    for (const entry of snapshot.context?.originalItems ?? [])
      if (matches(entry.item.origin))
        this.playbackPlanner.setContextItemAvailability(
          entry.contextItemId,
          availability,
        );
    this.syncPlaybackPlan();
  }

  private plannedItemByPublicId(queueItemId: string): {
    readonly executionEntryId: string;
    readonly item: PlaybackItemSeed;
  } | null {
    const snapshot = this.playbackPlanSnapshot;
    if (
      snapshot.current &&
      (snapshot.current.playbackInstanceId === queueItemId ||
        snapshot.current.executionEntryId === queueItemId)
    )
      return snapshot.current;
    const explicit = snapshot.explicitQueue.find(
      (entry) =>
        entry.explicitQueueEntryId === queueItemId ||
        entry.playbackInstanceId === queueItemId ||
        entry.executionEntryId === queueItemId,
    );
    if (explicit) return explicit;
    for (const item of snapshot.context?.originalItems ?? [])
      if (item.executionEntryId === queueItemId) return item;
    const history = snapshot.history.entries.find(
      (entry) =>
        entry.playbackInstanceId === queueItemId ||
        entry.executionEntryId === queueItemId,
    );
    return history ?? null;
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
