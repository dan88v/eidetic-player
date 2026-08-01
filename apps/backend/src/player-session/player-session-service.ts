import { isSupportedAudioPath } from "../../../../packages/shared/src/audio.js";
import type { PlayerState } from "../../../../packages/shared/src/player.js";
import type { FilesystemProvider } from "../filesystem/filesystem-provider.js";
import { PathService } from "../filesystem/path-service.js";
import { SourceService } from "../filesystem/source-service.js";
import type {
  CurrentPlaybackItem,
  ExplicitQueueEntry,
  PlaybackContextSnapshot,
  PlaybackHistoryEntry,
  PlaybackHistorySnapshot,
  PlaybackItemSnapshot,
  PlaybackPlanSnapshot,
} from "../playback-plan/playback-plan-types.js";
import type { PlayerService } from "../player/player-service.js";
import type { RemovableStorageService } from "../removable-storage/removable-storage-service.js";
import type { SmbConnectionService } from "../smb/smb-connection-service.js";
import {
  PlayerSessionRepository,
  migrateLegacyPlayerSession,
  playbackPlanFromPlayerSession,
  playerSessionFromPlaybackPlan,
  projectPlayerSessionV2,
} from "./player-session-repository.js";
import type {
  PersistedPlayerSession,
  PersistedPlayerSessionV3,
  PersistedQueueItem,
  PersistedQueueOrigin,
  PlayerRestoreResult,
  PlayerSessionSnapshot,
  ResolvedQueueItem,
} from "./player-session-types.js";

const SAVE_DEBOUNCE_MS = 120;
const RESTORE_VERIFY_CONCURRENCY = 8;
const COMPATIBILITY_QUEUE_ID = /^queue-[0-9a-f-]{36}$/iu;
const COMPATIBILITY_TRACK_ID = /^track-[0-9a-f]{32}$/u;
const COMPATIBILITY_ENTRY_ID = /^entry-[0-9a-f]{32}$/u;
const COMPATIBILITY_USB_ID = /^usb-[0-9a-f]{32}$/u;
const COMPATIBILITY_SMB_ID = /^smb-[0-9a-f]{32}$/u;
const COMPATIBILITY_SOURCE_ID = /^[0-9a-f-]{36}$/iu;

interface PendingSessionWrite {
  readonly session: PersistedPlayerSessionV3 | null;
  readonly compatibility: PersistedPlayerSession | null;
}

interface SanitizedSession {
  readonly session: PersistedPlayerSessionV3;
  readonly savedCount: number;
  readonly restoredCount: number;
  readonly currentPreserved: boolean;
}

type ResolutionCache = Map<string, Promise<PlaybackItemSnapshot | null>>;

export class PlayerSessionService {
  private unsubscribe: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private signature = "";
  private pending: PendingSessionWrite | undefined;
  private writeChain: Promise<void> = Promise.resolve();
  private writes = 0;
  private readOnlySession = false;
  private preserveExistingUntilMutation = false;
  private lastObservedHint = "";
  private lastObservedPosition = 0;
  private capturedCurrentId = "";

  constructor(
    private readonly repository: PlayerSessionRepository,
    private readonly provider: FilesystemProvider,
    private readonly paths: PathService,
    private readonly sources: SourceService,
    private readonly player: PlayerService,
    private readonly removableStorage?: RemovableStorageService,
    private readonly smb?: SmbConnectionService,
  ) {}

  async restore(): Promise<PlayerRestoreResult> {
    if (!this.player.getState().mpvAvailable) {
      this.preserveExistingUntilMutation = true;
      console.warn(
        "[player-session] restore deferred because MPV is unavailable",
      );
      return this.emptyResult(0, 0, 0, 0);
    }

    const readStart = performance.now();
    const read = await this.repository.readPlaybackSession();
    const readMilliseconds = performance.now() - readStart;
    if (read.status === "empty") {
      this.preserveExistingUntilMutation = false;
      return this.emptyResult(readMilliseconds, 0, 0, 0);
    }
    if (read.status === "future") {
      this.readOnlySession = true;
      this.preserveExistingUntilMutation = true;
      return this.emptyResult(readMilliseconds, 0, 0, 0);
    }
    if (read.status === "invalid") {
      this.preserveExistingUntilMutation = true;
      this.captureBaselineSignature();
      return this.emptyResult(readMilliseconds, 0, 0, 0);
    }

    const verifyStart = performance.now();
    let sourceSession = read.session;
    let cache: ResolutionCache = new Map();
    let legacySavedCount: number | null = null;
    let legacyRestoredCount: number | null = null;
    if (read.status === "migrated") {
      const resolvedNativePaths = new Map<string, string>();
      const resolved = await this.mapBounded(read.legacySession.queue, (item) =>
        this.resolveItem(item),
      );
      for (let index = 0; index < read.legacySession.queue.length; index += 1) {
        const legacy = read.legacySession.queue[index];
        const candidate = resolved[index];
        if (legacy && candidate)
          resolvedNativePaths.set(legacy.id, candidate.path);
      }
      legacySavedCount = read.legacySession.queue.length;
      legacyRestoredCount = resolvedNativePaths.size;
      sourceSession = migrateLegacyPlayerSession(
        read.legacySession,
        resolvedNativePaths,
      );
      cache = this.legacyResolutionCache(
        read.legacySession.queue,
        sourceSession,
        resolvedNativePaths,
      );
    }

    const sanitized = await this.sanitizeSession(sourceSession, cache);
    const verificationMilliseconds = performance.now() - verifyStart;
    const savedCount = legacySavedCount ?? sanitized.savedCount;
    const restoredCount = legacyRestoredCount ?? sanitized.restoredCount;
    const discardedCount = Math.max(0, savedCount - restoredCount);
    if (!this.hasRestorableState(sanitized.session)) {
      this.preserveExistingUntilMutation = true;
      this.captureBaselineSignature();
      return this.emptyResult(
        readMilliseconds,
        verificationMilliseconds,
        savedCount,
        discardedCount,
      );
    }

    const prepareStart = performance.now();
    await this.player.restorePlaybackPlan(
      playbackPlanFromPlayerSession(sanitized.session),
      {
        positionSeconds: sanitized.currentPreserved
          ? sanitized.session.positionSeconds
          : 0,
        volume: sanitized.session.volume,
        muted: sanitized.session.muted,
      },
    );
    const prepareMilliseconds = performance.now() - prepareStart;
    this.readOnlySession = false;
    this.preserveExistingUntilMutation = false;
    this.captureBaselineSignature();
    this.pending = this.captureWrite();
    await this.saveNow();
    return {
      status: "restored",
      savedCount,
      restoredCount,
      discardedCount,
      readMilliseconds,
      verificationMilliseconds,
      prepareMilliseconds,
    };
  }

  start(): void {
    if (this.unsubscribe) return;
    this.captureBaselineSignature();
    this.unsubscribe = this.player.subscribe((state) => {
      this.handleState(state);
    });
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.readOnlySession) {
      await this.writeChain;
      return;
    }
    const state = this.player.getState();
    const plan = this.player.getPlaybackPlanSnapshot();
    const currentSignature = this.snapshotSignature(plan, state);
    if (
      this.preserveExistingUntilMutation &&
      (this.signature === "" || currentSignature === this.signature)
    ) {
      await this.writeChain;
      return;
    }
    this.preserveExistingUntilMutation = false;
    this.signature = currentSignature;
    const currentId = plan.current?.playbackInstanceId ?? "";
    const currentChanged = currentId !== this.capturedCurrentId;
    this.capturedCurrentId = currentId;
    this.pending = this.captureWrite(
      plan,
      state,
      currentChanged ? 0 : undefined,
    );
    await this.saveNow();
    await this.writeChain;
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  diagnostics() {
    return {
      configPath: this.repository.configPath,
      v3ConfigPath: this.repository.v3ConfigPath,
      writes: this.writes,
      timerActive: this.timer !== null,
      readOnly: this.readOnlySession,
    };
  }

  private captureBaselineSignature(): void {
    const state = this.player.getState();
    const plan = this.player.getPlaybackPlanSnapshot();
    this.signature = this.snapshotSignature(plan, state);
    this.lastObservedHint = this.stateHint(state);
    this.lastObservedPosition = state.positionSeconds;
    this.capturedCurrentId = plan.current?.playbackInstanceId ?? "";
  }

  private handleState(state: PlayerState): void {
    if (this.readOnlySession) return;
    const hint = this.stateHint(state);
    const hintChanged = hint !== this.lastObservedHint;
    const positionChanged = state.positionSeconds !== this.lastObservedPosition;
    this.lastObservedHint = hint;
    this.lastObservedPosition = state.positionSeconds;
    if (!hintChanged && positionChanged) return;

    const plan = this.player.getPlaybackPlanSnapshot();
    const signature = this.snapshotSignature(plan, state);
    if (signature === this.signature) return;
    this.signature = signature;
    this.preserveExistingUntilMutation = false;
    const currentId = plan.current?.playbackInstanceId ?? "";
    const currentChanged = currentId !== this.capturedCurrentId;
    this.capturedCurrentId = currentId;
    this.pending = this.captureWrite(
      plan,
      state,
      currentChanged ? 0 : undefined,
    );
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow().catch(() => undefined);
    }, SAVE_DEBOUNCE_MS);
  }

  private async saveNow(): Promise<void> {
    if (this.readOnlySession) return;
    const pending = this.pending ?? this.captureWrite();
    this.pending = undefined;
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        if (pending.session)
          await this.repository.writePlaybackSession(
            pending.session,
            pending.compatibility,
          );
        else await this.repository.clearPlaybackSession();
        this.writes += 1;
      });
    await this.writeChain;
  }

  private captureWrite(
    plan = this.player.getPlaybackPlanSnapshot(),
    state = this.player.getState(),
    positionSeconds = state.positionSeconds,
  ): PendingSessionWrite {
    if (!this.hasPlanState(plan)) return { session: null, compatibility: null };
    const session = playerSessionFromPlaybackPlan(plan, {
      positionSeconds,
      volume: state.volume,
      muted: state.muted,
    });
    const compatibility = this.compatibilitySession(
      this.player.getSessionSnapshot(),
    );
    return {
      session,
      compatibility: compatibility
        ? {
            ...compatibility,
            positionSeconds: session.positionSeconds,
            volume: session.volume,
            muted: session.muted,
            shuffleEnabled: session.shuffleEnabled,
            repeatMode: session.repeatMode,
          }
        : projectPlayerSessionV2(session),
    };
  }

  private compatibilitySession(
    snapshot: PlayerSessionSnapshot,
  ): PersistedPlayerSession | null {
    const currentId = snapshot.currentQueueItemId;
    if (
      !currentId ||
      !COMPATIBILITY_QUEUE_ID.test(currentId) ||
      snapshot.queue.length === 0 ||
      !snapshot.queue.some((item) => item.id === currentId) ||
      new Set(snapshot.queue.map((item) => item.id)).size !==
        snapshot.queue.length ||
      !snapshot.queue.every((item) => this.isCompatibilityQueueItem(item))
    )
      return null;
    return {
      version: 2,
      currentQueueItemId: currentId,
      queue: snapshot.queue,
      positionSeconds: snapshot.positionSeconds,
      volume: snapshot.volume,
      muted: snapshot.muted,
      shuffleEnabled: snapshot.shuffleEnabled,
      repeatMode: snapshot.repeatMode,
    };
  }

  private isCompatibilityQueueItem(item: PersistedQueueItem): boolean {
    return (
      COMPATIBILITY_QUEUE_ID.test(item.id) &&
      item.filename.length > 0 &&
      item.filename.length <= 512 &&
      item.displayTitle.length <= 512 &&
      this.isCompatibilityOrigin(item.origin)
    );
  }

  private isCompatibilityOrigin(origin: PersistedQueueOrigin): boolean {
    if (origin.kind === "direct") return origin.nativePath.length > 0;
    if (origin.kind === "removable")
      return (
        COMPATIBILITY_USB_ID.test(origin.deviceId) &&
        origin.relativePath.length > 0 &&
        COMPATIBILITY_ENTRY_ID.test(origin.entryId)
      );
    if (origin.kind === "smb")
      return (
        COMPATIBILITY_SMB_ID.test(origin.connectionId) &&
        origin.relativePath.length > 0 &&
        COMPATIBILITY_ENTRY_ID.test(origin.entryId)
      );
    return (
      COMPATIBILITY_SOURCE_ID.test(origin.sourceId) &&
      origin.relativePath.length > 0 &&
      (origin.libraryTrackId === undefined ||
        COMPATIBILITY_TRACK_ID.test(origin.libraryTrackId))
    );
  }

  private snapshotSignature(
    plan: PlaybackPlanSnapshot,
    state: PlayerState,
  ): string {
    const revisions = plan.revisions;
    return [
      revisions.state,
      revisions.current,
      revisions.context,
      revisions.explicitQueue,
      revisions.history,
      revisions.execution,
      revisions.availability,
      plan.current?.playbackInstanceId ?? "",
      plan.context?.contextId ?? "",
      plan.context?.resumeCursor ?? -1,
      plan.explicitQueue.length,
      plan.history.entries.length,
      plan.history.cursor,
      plan.artistRadio?.bagCycle ?? -1,
      plan.pendingContinuation?.requestId ?? "",
      state.volume,
      state.muted ? 1 : 0,
      plan.shuffleEnabled ? 1 : 0,
      plan.repeatMode,
      plan.continuePlayback,
    ].join(":");
  }

  private stateHint(state: PlayerState): string {
    return [
      state.playerSessionId,
      state.trackTransitionId,
      state.queueRevision,
      state.currentQueueIndex,
      state.queue.length,
      state.volume,
      state.muted ? 1 : 0,
      state.shuffleEnabled ? 1 : 0,
      state.repeatMode,
    ].join(":");
  }

  private hasPlanState(plan: PlaybackPlanSnapshot): boolean {
    return (
      plan.current !== null ||
      plan.context !== null ||
      plan.explicitQueue.length > 0 ||
      plan.history.entries.length > 0 ||
      plan.artistRadio !== null ||
      plan.pendingContinuation !== null
    );
  }

  private hasRestorableState(session: PersistedPlayerSessionV3): boolean {
    return this.hasPlanState(playbackPlanFromPlayerSession(session));
  }

  private async sanitizeSession(
    session: PersistedPlayerSessionV3,
    cache: ResolutionCache,
  ): Promise<SanitizedSession> {
    const savedCount = this.sessionItemCount(session);
    const resolvedCurrent = session.current
      ? await this.resolvePlaybackItem(session.current.item, cache)
      : null;

    const contextResults = session.context
      ? await this.mapBounded(session.context.originalItems, (entry) =>
          this.resolvePlaybackItem(entry.item, cache),
        )
      : [];
    const context = session.context
      ? this.sanitizeContext(session.context, contextResults)
      : null;

    const explicitResults = await this.mapBounded(
      session.explicitQueue,
      (entry) => this.resolvePlaybackItem(entry.item, cache),
    );
    const explicitQueue: ExplicitQueueEntry[] = [];
    for (let index = 0; index < session.explicitQueue.length; index += 1) {
      const entry = session.explicitQueue[index];
      const item = explicitResults[index];
      if (entry && item) explicitQueue.push({ ...entry, item });
    }

    const historyResults = await this.mapBounded(
      session.history.entries,
      (entry) => this.resolvePlaybackItem(entry.item, cache),
    );
    const history = this.sanitizeHistory(session.history, historyResults);
    let current: CurrentPlaybackItem | null =
      session.current && resolvedCurrent
        ? { ...session.current, item: resolvedCurrent }
        : null;

    if (current?.historyEntryId) {
      const historyIds = new Set(
        history.snapshot.entries.map((entry) => entry.historyEntryId),
      );
      if (!historyIds.has(current.historyEntryId))
        current = { ...current, historyEntryId: null };
    }
    if (
      session.current &&
      !current &&
      history.snapshot.entries.length > 0 &&
      history.retainedBeforeOrAtCursor === 0
    ) {
      const first = history.snapshot.entries[0];
      if (first)
        current = {
          playbackInstanceId: first.playbackInstanceId,
          executionEntryId: first.executionEntryId,
          source: "history",
          relationId: first.historyEntryId,
          contextId: first.contextId,
          historyEntryId: first.historyEntryId,
          item: first.item,
          startedSequence: first.startedSequence,
        };
    }

    const sanitized: PersistedPlayerSessionV3 = {
      ...session,
      current,
      context,
      explicitQueue,
      history: history.snapshot,
      artistRadio:
        context?.kind === "artist-radio" &&
        session.artistRadio?.contextId === context.contextId
          ? session.artistRadio
          : null,
    };
    return {
      session: sanitized,
      savedCount,
      restoredCount: this.sessionItemCount(sanitized),
      currentPreserved: Boolean(session.current && resolvedCurrent && current),
    };
  }

  private sanitizeContext(
    context: PlaybackContextSnapshot,
    results: readonly (PlaybackItemSnapshot | null)[],
  ): PlaybackContextSnapshot | null {
    const originalItems = context.originalItems.flatMap((entry, index) => {
      const item = results[index];
      return item ? [{ ...entry, item }] : [];
    });
    if (originalItems.length === 0) return null;
    const retained = new Set(originalItems.map((entry) => entry.contextItemId));
    const playOrder = context.playOrder.filter((id) => retained.has(id));
    const resumeCursor = context.playOrder
      .slice(0, context.resumeCursor)
      .filter((id) => retained.has(id)).length;
    return {
      ...context,
      originalItems,
      playOrder,
      resumeCursor: Math.min(resumeCursor, playOrder.length),
    };
  }

  private sanitizeHistory(
    history: PlaybackHistorySnapshot,
    results: readonly (PlaybackItemSnapshot | null)[],
  ): {
    readonly snapshot: PlaybackHistorySnapshot;
    readonly retainedBeforeOrAtCursor: number;
  } {
    const retained: {
      readonly entry: PlaybackHistoryEntry;
      readonly index: number;
    }[] = [];
    for (let index = 0; index < history.entries.length; index += 1) {
      const entry = history.entries[index];
      const item = results[index];
      if (entry && item) retained.push({ entry: { ...entry, item }, index });
    }
    if (retained.length === 0)
      return {
        snapshot: { entries: [], cursor: -1 },
        retainedBeforeOrAtCursor: 0,
      };
    const retainedBeforeOrAtCursor = retained.filter(
      ({ index }) => index <= history.cursor,
    ).length;
    return {
      snapshot: {
        entries: retained.map(({ entry }) => entry),
        cursor: retainedBeforeOrAtCursor > 0 ? retainedBeforeOrAtCursor - 1 : 0,
      },
      retainedBeforeOrAtCursor,
    };
  }

  private sessionItemCount(session: PersistedPlayerSessionV3): number {
    return (
      (session.current ? 1 : 0) +
      (session.context?.originalItems.length ?? 0) +
      session.explicitQueue.length +
      session.history.entries.length
    );
  }

  private legacyResolutionCache(
    legacyQueue: readonly PersistedQueueItem[],
    migrated: PersistedPlayerSessionV3,
    resolvedNativePaths: ReadonlyMap<string, string>,
  ): ResolutionCache {
    const cache: ResolutionCache = new Map();
    const contextItems = migrated.context?.originalItems ?? [];
    for (let index = 0; index < legacyQueue.length; index += 1) {
      const legacy = legacyQueue[index];
      const contextItem = contextItems[index];
      if (!legacy || !contextItem) continue;
      const path = resolvedNativePaths.get(legacy.id);
      cache.set(
        this.playbackResolutionKey(contextItem.item),
        Promise.resolve(
          path
            ? {
                ...contextItem.item,
                nativePath: path,
                availability: "available" as const,
              }
            : null,
        ),
      );
    }
    return cache;
  }

  private resolvePlaybackItem(
    item: PlaybackItemSnapshot,
    cache: ResolutionCache,
  ): Promise<PlaybackItemSnapshot | null> {
    const key = this.playbackResolutionKey(item);
    const existing = cache.get(key);
    if (existing) return existing;
    const operation = (async (): Promise<PlaybackItemSnapshot | null> => {
      const origin = this.persistedPlaybackOrigin(item);
      const resolved = await this.resolveItem({
        id: "queue-00000000-0000-4000-8000-000000000000",
        origin,
        filename: item.filename,
        displayTitle: item.title,
      });
      return resolved
        ? {
            ...item,
            nativePath: resolved.path,
            availability: "available",
          }
        : null;
    })();
    cache.set(key, operation);
    return operation;
  }

  private playbackResolutionKey(item: PlaybackItemSnapshot): string {
    const origin = item.origin;
    return [
      origin.kind,
      origin.sourceId ?? "",
      origin.relativePath ?? "",
      origin.entryId ?? "",
      origin.removable ? 1 : 0,
      origin.smb ? 1 : 0,
      item.nativePath,
    ].join("\0");
  }

  private persistedPlaybackOrigin(
    item: PlaybackItemSnapshot,
  ): PersistedQueueOrigin {
    const origin = item.origin;
    if (
      origin.kind === "removable" &&
      origin.sourceId &&
      COMPATIBILITY_USB_ID.test(origin.sourceId) &&
      origin.relativePath &&
      origin.entryId &&
      COMPATIBILITY_ENTRY_ID.test(origin.entryId)
    )
      return {
        kind: "removable",
        deviceId: origin.sourceId,
        relativePath: origin.relativePath,
        entryId: origin.entryId,
      };
    if (
      origin.kind === "smb" &&
      origin.sourceId &&
      COMPATIBILITY_SMB_ID.test(origin.sourceId) &&
      origin.relativePath &&
      origin.entryId &&
      COMPATIBILITY_ENTRY_ID.test(origin.entryId)
    )
      return {
        kind: "smb",
        connectionId: origin.sourceId,
        relativePath: origin.relativePath,
        entryId: origin.entryId,
      };
    if (
      (origin.kind === "folder" || origin.kind === "library") &&
      origin.sourceId &&
      COMPATIBILITY_SOURCE_ID.test(origin.sourceId) &&
      origin.relativePath
    )
      return {
        kind: "folders",
        sourceId: origin.sourceId,
        relativePath: origin.relativePath,
        ...(item.libraryTrackId &&
        COMPATIBILITY_TRACK_ID.test(item.libraryTrackId)
          ? { libraryTrackId: item.libraryTrackId }
          : {}),
        ...(origin.removable ? { removable: true } : {}),
        ...(origin.smb ? { smb: true } : {}),
      };
    return { kind: "direct", nativePath: item.nativePath };
  }

  private async mapBounded<T, Result>(
    values: readonly T[],
    operation: (value: T) => Promise<Result>,
  ): Promise<Result[]> {
    const results = new Array<Result>(values.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        const value = values[index];
        if (value !== undefined) results[index] = await operation(value);
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(RESTORE_VERIFY_CONCURRENCY, values.length),
        },
        () => worker(),
      ),
    );
    return results;
  }

  private async resolveItem(
    item: PersistedQueueItem,
  ): Promise<ResolvedQueueItem | null> {
    try {
      const nativePath =
        item.origin.kind === "direct"
          ? this.paths.normalizeNativePath(item.origin.nativePath)
          : item.origin.kind === "removable"
            ? await this.resolveRemovableOrigin(item.origin)
            : item.origin.kind === "smb"
              ? await this.resolveSmbOrigin(item.origin)
              : await this.resolveFoldersOrigin(item.origin);
      const details = await this.provider.lstat(nativePath);
      if (
        details.isSymbolicLink() ||
        !details.isFile() ||
        !isSupportedAudioPath(nativePath)
      )
        return null;
      await this.provider.access(nativePath);
      return {
        id: item.id,
        path: await this.paths.canonicalizePath(nativePath),
        origin: item.origin,
      };
    } catch {
      return null;
    }
  }

  private async resolveFoldersOrigin(
    origin: Extract<PersistedQueueOrigin, { kind: "folders" }>,
  ): Promise<string> {
    const source = await this.sources.getInternal(origin.sourceId);
    if ((await this.sources.availabilityOf(origin.sourceId)) !== "available")
      throw new Error("source unavailable");
    return this.paths.resolveWithinSource(
      source.canonicalRoot,
      origin.relativePath,
    );
  }

  private async resolveRemovableOrigin(
    origin: Extract<PersistedQueueOrigin, { kind: "removable" }>,
  ): Promise<string> {
    if (!this.removableStorage) throw new Error("removable unavailable");
    return this.removableStorage.resolveLogicalPath(
      origin.deviceId,
      origin.relativePath,
    );
  }

  private async resolveSmbOrigin(
    origin: Extract<PersistedQueueOrigin, { kind: "smb" }>,
  ): Promise<string> {
    if (!this.smb) throw new Error("SMB unavailable");
    return this.smb.resolveLogicalPath(
      origin.connectionId,
      origin.relativePath,
    );
  }

  private emptyResult(
    readMilliseconds: number,
    verificationMilliseconds: number,
    savedCount: number,
    discardedCount: number,
  ): PlayerRestoreResult {
    return {
      status: "empty",
      savedCount,
      restoredCount: 0,
      discardedCount,
      readMilliseconds,
      verificationMilliseconds,
      prepareMilliseconds: 0,
    };
  }
}
