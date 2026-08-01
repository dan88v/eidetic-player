import { randomUUID } from "node:crypto";
import {
  DEFAULT_EXECUTION_PLAN_LIMIT,
  MAX_EXPLICIT_QUEUE_ITEMS,
  MAX_PLAYBACK_CONTEXT_ITEMS,
  MAX_PLAYBACK_HISTORY_ITEMS,
  PLAYBACK_PLAN_SCHEMA_VERSION,
  type ArtistRadioSnapshot,
  type ContinuePlaybackPolicy,
  type CurrentPlaybackItem,
  type CurrentPlaybackSource,
  type ExplicitQueueEntry,
  type ExplicitQueueEntryId,
  type PendingContinuation,
  type PlaybackAvailability,
  type PlaybackContextId,
  type PlaybackContextItem,
  type PlaybackContextItemId,
  type PlaybackContextKind,
  type PlaybackContextSeed,
  type PlaybackContextSnapshot,
  type PlaybackDecision,
  type PlaybackExecutionEntryId,
  type PlaybackExecutionPlanEntry,
  type PlaybackExecutionPlanProjection,
  type PlaybackHistoryEntry,
  type PlaybackHistoryEntryId,
  type PlaybackHistorySnapshot,
  type PlaybackIdPrefix,
  type PlaybackInstanceId,
  type PlaybackItemOrigin,
  type PlaybackItemSeed,
  type PlaybackItemSnapshot,
  type PlaybackPlanRevisions,
  type PlaybackPlanSnapshot,
  type PlaybackPlannerOptions,
  type PlaybackRepeatMode,
  type PlaybackStartReason,
} from "./playback-plan-types.js";

const MAX_NATIVE_PATH_LENGTH = 32_768;
const MAX_TEXT_LENGTH = 512;
const MAX_ID_LENGTH = 256;
const MAX_EXECUTION_PROJECTION_LIMIT = 512;
const DEFAULT_RECENT_HISTORY_AVOIDANCE = 12;

const contextKinds = new Set<PlaybackContextKind>([
  "album",
  "artist",
  "playlist",
  "folder",
  "direct-folder",
  "favorites",
  "recently-played",
  "most-played",
  "search",
  "tracks",
  "legacy-session",
  "artist-radio",
]);

const originKinds = new Set<PlaybackItemOrigin["kind"]>([
  "library",
  "folder",
  "direct",
  "removable",
  "smb",
  "legacy",
]);

export class PlaybackPlanError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlaybackPlanError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  field: string,
  maximum = MAX_TEXT_LENGTH,
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum)
    throw new PlaybackPlanError(
      "INVALID_PLAYBACK_ITEM",
      `${field} must be a non-empty bounded string.`,
    );
  return value;
}

function optionalBoundedString(
  value: unknown,
  field: string,
  maximum = MAX_TEXT_LENGTH,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return boundedString(value, field, maximum);
}

function normalizedOrigin(origin: PlaybackItemOrigin): PlaybackItemOrigin {
  const candidate: unknown = origin;
  if (
    !isRecord(candidate) ||
    !originKinds.has(candidate.kind as PlaybackItemOrigin["kind"])
  )
    throw new PlaybackPlanError(
      "INVALID_PLAYBACK_ORIGIN",
      "Playback item origin is invalid.",
    );
  const kind = candidate.kind as PlaybackItemOrigin["kind"];
  const sourceId = optionalBoundedString(
    candidate.sourceId,
    "origin.sourceId",
    MAX_ID_LENGTH,
  );
  const relativePath = optionalBoundedString(
    candidate.relativePath,
    "origin.relativePath",
    MAX_NATIVE_PATH_LENGTH,
  );
  const entryId = optionalBoundedString(
    candidate.entryId,
    "origin.entryId",
    MAX_ID_LENGTH,
  );
  if (
    candidate.removable !== undefined &&
    typeof candidate.removable !== "boolean"
  )
    throw new PlaybackPlanError(
      "INVALID_PLAYBACK_ORIGIN",
      "origin.removable must be a boolean when present.",
    );
  if (candidate.smb !== undefined && typeof candidate.smb !== "boolean")
    throw new PlaybackPlanError(
      "INVALID_PLAYBACK_ORIGIN",
      "origin.smb must be a boolean when present.",
    );
  return {
    kind,
    ...(sourceId ? { sourceId } : {}),
    ...(relativePath ? { relativePath } : {}),
    ...(entryId ? { entryId } : {}),
    ...(candidate.removable === undefined
      ? {}
      : { removable: candidate.removable }),
    ...(candidate.smb === undefined ? {} : { smb: candidate.smb }),
  };
}

function normalizedItem(seed: PlaybackItemSeed): PlaybackItemSnapshot {
  const duration = seed.durationSeconds;
  if (
    duration !== undefined &&
    duration !== null &&
    (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0)
  )
    throw new PlaybackPlanError(
      "INVALID_PLAYBACK_ITEM",
      "durationSeconds must be finite and non-negative.",
    );
  const rawAvailability: unknown = seed.availability;
  const availability = rawAvailability ?? "available";
  if (availability !== "available" && availability !== "unavailable")
    throw new PlaybackPlanError(
      "INVALID_PLAYBACK_ITEM",
      "Playback availability is invalid.",
    );
  const primaryArtistId = optionalBoundedString(
    seed.primaryArtistId,
    "primaryArtistId",
    MAX_ID_LENGTH,
  );
  if (primaryArtistId && !/^artist-[0-9a-f]{32}$/u.test(primaryArtistId))
    throw new PlaybackPlanError(
      "INVALID_PLAYBACK_ITEM",
      "primaryArtistId must be a stable Library artist ID.",
    );
  return {
    nativePath: boundedString(
      seed.nativePath,
      "nativePath",
      MAX_NATIVE_PATH_LENGTH,
    ),
    filename: boundedString(seed.filename, "filename"),
    title: boundedString(seed.title, "title"),
    artist: optionalBoundedString(seed.artist, "artist"),
    album: optionalBoundedString(seed.album, "album"),
    durationSeconds: duration ?? null,
    libraryTrackId: optionalBoundedString(
      seed.libraryTrackId,
      "libraryTrackId",
      MAX_ID_LENGTH,
    ),
    ...(primaryArtistId ? { primaryArtistId } : {}),
    availability,
    origin: normalizedOrigin(seed.origin),
  };
}

function emptyRevisions(): PlaybackPlanRevisions {
  return {
    state: 0,
    current: 0,
    context: 0,
    explicitQueue: 0,
    history: 0,
    execution: 0,
    availability: 0,
  };
}

/**
 * Pure authoritative playback model. It never talks to MPV, a repository, or
 * a UI; callers execute returned decisions and reconcile the bounded plan.
 */
export class PlaybackPlanner {
  private current: CurrentPlaybackItem | null = null;
  private context: PlaybackContextSnapshot | null = null;
  private explicitQueue: ExplicitQueueEntry[] = [];
  private history: PlaybackHistorySnapshot = { entries: [], cursor: -1 };
  private artistRadio: ArtistRadioSnapshot | null = null;
  private pendingContinuation: PendingContinuation | null = null;
  private shuffleEnabled = false;
  private repeatMode: PlaybackRepeatMode = "off";
  private continuePlayback: ContinuePlaybackPolicy = "off";
  private sequence = 0;
  private revisions = emptyRevisions();
  private readonly random: () => number;
  private readonly idFactory: (prefix: PlaybackIdPrefix) => string;
  private readonly executionPlanLimit: number;
  private readonly recentHistoryAvoidance: number;

  constructor(options: PlaybackPlannerOptions = {}) {
    this.random = options.random ?? Math.random;
    this.idFactory =
      options.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.executionPlanLimit = this.boundedProjectionLimit(
      options.executionPlanLimit ?? DEFAULT_EXECUTION_PLAN_LIMIT,
    );
    const recent =
      options.recentHistoryAvoidance ?? DEFAULT_RECENT_HISTORY_AVOIDANCE;
    if (
      !Number.isInteger(recent) ||
      recent < 0 ||
      recent > MAX_PLAYBACK_HISTORY_ITEMS
    )
      throw new PlaybackPlanError(
        "INVALID_PLAYBACK_PLAN_OPTIONS",
        "recentHistoryAvoidance is out of range.",
      );
    this.recentHistoryAvoidance = recent;
  }

  snapshot(): PlaybackPlanSnapshot {
    return clone({
      schemaVersion: PLAYBACK_PLAN_SCHEMA_VERSION,
      current: this.current,
      context: this.context,
      explicitQueue: this.explicitQueue,
      history: this.history,
      artistRadio: this.artistRadio,
      pendingContinuation: this.pendingContinuation,
      shuffleEnabled: this.shuffleEnabled,
      repeatMode: this.repeatMode,
      continuePlayback: this.continuePlayback,
      sequence: this.sequence,
      revisions: this.revisions,
    });
  }

  serialize(): PlaybackPlanSnapshot {
    return this.snapshot();
  }

  restore(value: unknown): void {
    if (!isPlaybackPlanSnapshot(value))
      throw new PlaybackPlanError(
        "INVALID_PLAYBACK_PLAN_SNAPSHOT",
        "Playback plan snapshot is invalid.",
      );
    const snapshot = clone(value);
    this.current = snapshot.current;
    this.context = snapshot.context;
    this.explicitQueue = [...snapshot.explicitQueue];
    this.history = snapshot.history;
    this.artistRadio = snapshot.artistRadio;
    this.pendingContinuation = snapshot.pendingContinuation;
    this.shuffleEnabled = snapshot.shuffleEnabled;
    this.repeatMode = snapshot.repeatMode;
    this.continuePlayback = snapshot.continuePlayback;
    this.sequence = snapshot.sequence;
    this.revisions = snapshot.revisions;
  }

  static fromSnapshot(
    value: unknown,
    options: PlaybackPlannerOptions = {},
  ): PlaybackPlanner {
    const planner = new PlaybackPlanner(options);
    planner.restore(value);
    return planner;
  }

  startContext(seed: PlaybackContextSeed): PlaybackDecision {
    if (seed.kind === "artist-radio")
      throw new PlaybackPlanError(
        "INVALID_PLAYBACK_CONTEXT",
        "Artist radio must be installed through installArtistRadio().",
      );
    const context = this.createContext(seed);
    const selectedIndex = seed.selectedIndex ?? 0;
    this.context = this.prepareInitialContextOrder(context, selectedIndex);
    this.artistRadio = null;
    this.pendingContinuation = null;
    this.bump("context", "execution");
    const decision = this.takeContext("context-selected");
    return decision ?? this.stop("context-empty");
  }

  enqueueExplicit(
    items: readonly PlaybackItemSeed[],
  ): readonly ExplicitQueueEntry[] {
    if (items.length === 0) return [];
    if (this.explicitQueue.length + items.length > MAX_EXPLICIT_QUEUE_ITEMS)
      throw new PlaybackPlanError(
        "EXPLICIT_QUEUE_TOO_LARGE",
        "Explicit Queue exceeds its bounded item limit.",
      );
    const added = items.map<ExplicitQueueEntry>((seed) => ({
      explicitQueueEntryId: this.id("explicit"),
      playbackInstanceId: this.id("playback-item"),
      executionEntryId: this.id("execution"),
      item: normalizedItem(seed),
      addedSequence: ++this.sequence,
    }));
    this.explicitQueue = [...this.explicitQueue, ...added];
    this.bump("explicitQueue", "execution");
    return clone(added);
  }

  start(): PlaybackDecision {
    if (this.current) return { kind: "none", reason: "already-playing" };
    const forward = this.takeForwardHistory();
    if (forward) return forward;
    const explicit = this.takeExplicit("explicit-queue");
    if (explicit) return explicit;
    const context = this.takeContext(
      this.context?.kind === "artist-radio" ? "artist-radio" : "context-resume",
    );
    if (context) return context;
    if (this.pendingContinuation)
      return {
        kind: "continuation-needed",
        request: clone(this.pendingContinuation),
      };
    return this.finishBoundary(null);
  }

  next(): PlaybackDecision {
    return this.advance();
  }

  canAdvance(): boolean {
    const current = this.current;
    if (!current) return false;
    if (this.repeatMode === "one") return true;
    if (this.availableHistoryIndex(this.history.cursor + 1, 1) !== null)
      return true;
    if (
      this.explicitQueue.some(
        (entry) => entry.item.availability !== "unavailable",
      )
    )
      return true;
    const context = this.context;
    if (context) {
      const availableIds = new Set(
        context.originalItems
          .filter((entry) => entry.item.availability !== "unavailable")
          .map((entry) => entry.contextItemId),
      );
      for (
        let index = context.resumeCursor;
        index < context.playOrder.length;
        index += 1
      ) {
        const contextItemId = context.playOrder[index];
        if (contextItemId && availableIds.has(contextItemId)) return true;
      }
    }
    if (
      this.repeatMode === "all" &&
      context?.originalItems.some(
        (entry) => entry.item.availability === "available",
      )
    )
      return true;
    return (
      this.continuePlayback === "same-artist" &&
      this.continuationArtistId(current) !== null &&
      current.item.libraryTrackId !== null
    );
  }

  advance(): PlaybackDecision {
    const ending = this.current;
    if (ending && this.repeatMode === "one") return this.repeatCurrent(ending);

    const forward = this.takeForwardHistory();
    if (forward) return forward;
    const explicit = this.takeExplicit("explicit-queue");
    if (explicit) return explicit;
    const context = this.takeContext(
      this.context?.kind === "artist-radio" ? "artist-radio" : "context-resume",
    );
    if (context) return context;

    if (this.repeatMode === "all" && this.context) {
      this.resetContextCycle();
      const repeated = this.takeContext("repeat-all");
      if (repeated) return repeated;
    }

    if (
      this.context?.kind === "artist-radio" &&
      this.artistRadio &&
      this.continuePlayback === "same-artist"
    ) {
      if (this.resetArtistRadioBag(ending?.item.libraryTrackId ?? null)) {
        const radio = this.takeContext("artist-radio");
        if (radio) return radio;
      }
      return this.stop("no-continuation-candidate");
    }
    return this.finishBoundary(ending);
  }

  previous(positionSeconds: number): PlaybackDecision {
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0)
      throw new PlaybackPlanError(
        "INVALID_PLAYBACK_POSITION",
        "Playback position must be finite and non-negative.",
      );
    if (!this.current) return { kind: "none", reason: "history-start" };
    if (positionSeconds > 3)
      return {
        kind: "restart-current",
        playbackInstanceId: this.current.playbackInstanceId,
      };
    const previousIndex = this.availableHistoryIndex(
      this.history.cursor - 1,
      -1,
    );
    return previousIndex === null
      ? { kind: "none", reason: "history-start" }
      : this.startHistoryAt(previousIndex, "history-previous");
  }

  selectExplicit(entryId: ExplicitQueueEntryId): PlaybackDecision {
    const selectedIndex = this.explicitQueue.findIndex(
      (entry) => entry.explicitQueueEntryId === entryId,
    );
    if (selectedIndex < 0) return { kind: "none", reason: "not-found" };
    const selected = this.explicitQueue[selectedIndex];
    this.explicitQueue = this.explicitQueue.slice(selectedIndex + 1);
    this.bump("explicitQueue", "execution");
    if (!selected || selected.item.availability === "unavailable") {
      const next = this.takeExplicit("explicit-queue");
      if (next) return next;
      const context = this.takeContext("context-resume");
      return context ?? this.finishBoundary(this.current);
    }
    return this.startExplicit(selected, "explicit-selected");
  }

  clearExplicitQueue(): number {
    const count = this.explicitQueue.length;
    if (count === 0) return 0;
    this.explicitQueue = [];
    this.bump("explicitQueue", "execution");
    return count;
  }

  clearContext(): boolean {
    if (!this.context) return false;
    this.context = null;
    this.artistRadio = null;
    this.pendingContinuation = null;
    this.bump("context", "execution");
    return true;
  }

  removeExplicit(entryId: ExplicitQueueEntryId): boolean {
    const index = this.explicitQueue.findIndex(
      (entry) => entry.explicitQueueEntryId === entryId,
    );
    if (index < 0) return false;
    this.explicitQueue = this.explicitQueue.filter(
      (_, itemIndex) => itemIndex !== index,
    );
    this.bump("explicitQueue", "execution");
    return true;
  }

  reorderExplicit(entryId: ExplicitQueueEntryId, toIndex: number): boolean {
    if (
      !Number.isInteger(toIndex) ||
      toIndex < 0 ||
      toIndex >= this.explicitQueue.length
    )
      throw new PlaybackPlanError(
        "INVALID_EXPLICIT_QUEUE_INDEX",
        "Explicit Queue target index is out of range.",
      );
    const fromIndex = this.explicitQueue.findIndex(
      (entry) => entry.explicitQueueEntryId === entryId,
    );
    if (fromIndex < 0) return false;
    if (fromIndex === toIndex) return true;
    const next = [...this.explicitQueue];
    const [entry] = next.splice(fromIndex, 1);
    if (!entry) return false;
    next.splice(toIndex, 0, entry);
    this.explicitQueue = next;
    this.bump("explicitQueue", "execution");
    return true;
  }

  setShuffle(enabled: boolean): void {
    if (enabled === this.shuffleEnabled) return;
    this.shuffleEnabled = enabled;
    const context = this.context;
    if (context && context.kind !== "artist-radio") {
      const consumed = context.playOrder.slice(0, context.resumeCursor);
      const consumedSet = new Set(consumed);
      const remaining = context.originalItems
        .map((item) => item.contextItemId)
        .filter((id) => !consumedSet.has(id));
      this.context = {
        ...context,
        playOrder: [
          ...consumed,
          ...(enabled ? this.shuffled(remaining) : remaining),
        ],
        resumeCursor: consumed.length,
        shuffleCycle: context.shuffleCycle + (enabled ? 1 : 0),
      };
      this.bump("context", "execution");
      return;
    }
    this.bump();
  }

  setRepeatMode(mode: PlaybackRepeatMode): void {
    const candidate: unknown = mode;
    if (candidate !== "off" && candidate !== "all" && candidate !== "one")
      throw new PlaybackPlanError(
        "INVALID_REPEAT_MODE",
        "Repeat mode is invalid.",
      );
    if (candidate === this.repeatMode) return;
    this.repeatMode = candidate;
    this.bump("execution");
  }

  setContinuePlayback(policy: ContinuePlaybackPolicy): void {
    const candidate: unknown = policy;
    if (candidate !== "off" && candidate !== "same-artist")
      throw new PlaybackPlanError(
        "INVALID_CONTINUE_PLAYBACK",
        "Continue playback policy is invalid.",
      );
    if (candidate === this.continuePlayback) return;
    this.continuePlayback = candidate;
    this.pendingContinuation = null;
    if (candidate === "off" && this.context?.kind === "artist-radio") {
      this.context = null;
      this.artistRadio = null;
      this.bump("context", "execution");
      return;
    }
    this.bump("execution");
  }

  installArtistRadio(
    artistId: string,
    candidates: readonly PlaybackItemSeed[],
    artistName?: string | null,
  ): PlaybackDecision {
    const stableArtistId = boundedString(artistId, "artistId", MAX_ID_LENGTH);
    const stableArtistName = artistName
      ? boundedString(artistName, "artistName")
      : "Same artist";
    const request = this.pendingContinuation;
    if (request?.artistId !== stableArtistId)
      throw new PlaybackPlanError(
        "STALE_CONTINUATION",
        "Artist-radio candidates do not match the pending continuation.",
      );
    if (candidates.length > MAX_PLAYBACK_CONTEXT_ITEMS)
      throw new PlaybackPlanError(
        "PLAYBACK_CONTEXT_TOO_LARGE",
        "Artist-radio candidate set exceeds its bounded limit.",
      );
    const seen = new Set<string>();
    const seeds = candidates.filter((candidate) => {
      const libraryTrackId = candidate.libraryTrackId;
      if (!libraryTrackId || seen.has(libraryTrackId)) return false;
      seen.add(libraryTrackId);
      return true;
    });
    if (seeds.length === 0) {
      this.pendingContinuation = null;
      return this.stop("no-continuation-candidate");
    }
    const created = this.createContext({
      kind: "artist-radio",
      title: stableArtistName,
      entityId: stableArtistId,
      continuationArtistId: stableArtistId,
      source: { label: "Same artist", sourceId: stableArtistId },
      items: seeds,
      selectedIndex: 0,
    });
    this.context = { ...created, resumeCursor: 0, playOrder: [] };
    this.artistRadio = {
      contextId: created.contextId,
      artistId: stableArtistId,
      bagCycle: 0,
    };
    this.pendingContinuation = null;
    if (!this.resetArtistRadioBag(request.previousLibraryTrackId)) {
      this.context = null;
      this.artistRadio = null;
      this.bump("context", "execution");
      return this.stop("no-continuation-candidate");
    }
    const explicit = this.takeExplicit("explicit-queue");
    if (explicit) return explicit;
    return (
      this.takeContext("artist-radio") ?? this.stop("no-continuation-candidate")
    );
  }

  setExplicitAvailability(
    entryId: ExplicitQueueEntryId,
    availability: PlaybackAvailability,
  ): boolean {
    this.requireAvailability(availability);
    const index = this.explicitQueue.findIndex(
      (entry) => entry.explicitQueueEntryId === entryId,
    );
    const entry = this.explicitQueue[index];
    if (!entry) return false;
    if (entry.item.availability === availability) return true;
    this.explicitQueue = this.explicitQueue.map((candidate, itemIndex) =>
      itemIndex === index
        ? { ...candidate, item: { ...candidate.item, availability } }
        : candidate,
    );
    this.bump("explicitQueue", "execution", "availability");
    return true;
  }

  setContextItemAvailability(
    contextItemId: PlaybackContextItemId,
    availability: PlaybackAvailability,
  ): boolean {
    this.requireAvailability(availability);
    const context = this.context;
    if (!context) return false;
    const index = context.originalItems.findIndex(
      (entry) => entry.contextItemId === contextItemId,
    );
    const item = context.originalItems[index];
    if (!item) return false;
    if (item.item.availability === availability) return true;
    this.context = {
      ...context,
      originalItems: context.originalItems.map((candidate, itemIndex) =>
        itemIndex === index
          ? { ...candidate, item: { ...candidate.item, availability } }
          : candidate,
      ),
      availabilityRevision: context.availabilityRevision + 1,
    };
    this.bump("context", "execution", "availability");
    return true;
  }

  setHistoryAvailability(
    entryId: PlaybackHistoryEntryId,
    availability: PlaybackAvailability,
  ): boolean {
    this.requireAvailability(availability);
    const index = this.history.entries.findIndex(
      (entry) => entry.historyEntryId === entryId,
    );
    const entry = this.history.entries[index];
    if (!entry) return false;
    const currentMatches = this.current?.historyEntryId === entryId;
    const historyChanged = entry.item.availability !== availability;
    const currentChanged =
      currentMatches && this.current?.item.availability !== availability;
    if (!historyChanged && !currentChanged) return true;
    if (historyChanged)
      this.history = {
        ...this.history,
        entries: this.history.entries.map((candidate, itemIndex) =>
          itemIndex === index
            ? { ...candidate, item: { ...candidate.item, availability } }
            : candidate,
        ),
      };
    if (currentChanged && this.current)
      this.current = {
        ...this.current,
        item: { ...this.current.item, availability },
      };
    if (currentChanged)
      this.bump("current", "history", "execution", "availability");
    else this.bump("history", "execution", "availability");
    return true;
  }

  setCurrentAvailability(availability: PlaybackAvailability): boolean {
    this.requireAvailability(availability);
    if (!this.current) return false;
    if (this.current.item.availability === availability) return true;
    this.current = {
      ...this.current,
      item: { ...this.current.item, availability },
    };
    this.bump("current", "availability");
    return true;
  }

  setCurrentPrimaryArtistId(primaryArtistId: string): boolean {
    const stableArtistId = boundedString(
      primaryArtistId,
      "primaryArtistId",
      MAX_ID_LENGTH,
    );
    if (!/^artist-[0-9a-f]{32}$/u.test(stableArtistId))
      throw new PlaybackPlanError(
        "INVALID_PLAYBACK_ITEM",
        "primaryArtistId must be a stable Library artist ID.",
      );
    const current = this.current;
    if (!current || current.item.primaryArtistId === stableArtistId)
      return current !== null;
    const item = { ...current.item, primaryArtistId: stableArtistId };
    this.current = { ...current, item };
    this.history = {
      ...this.history,
      entries: this.history.entries.map((entry) =>
        entry.historyEntryId === current.historyEntryId
          ? { ...entry, item }
          : entry,
      ),
    };
    this.bump("current", "history");
    return true;
  }

  projectExecutionPlan(
    limit = this.executionPlanLimit,
  ): PlaybackExecutionPlanProjection {
    const boundedLimit = this.boundedProjectionLimit(limit);
    const future: PlaybackExecutionPlanEntry[] = [];
    let availableFutureCount = 0;
    const collect = (
      executionEntryId: PlaybackExecutionEntryId,
      source: CurrentPlaybackSource,
      relationId: string,
      playbackInstanceId: PlaybackInstanceId | null,
      item: PlaybackItemSnapshot,
    ): void => {
      availableFutureCount += 1;
      if (future.length >= boundedLimit) return;
      future.push({
        executionEntryId,
        source,
        relationId,
        playbackInstanceId,
        item,
      });
    };
    for (
      let index = this.history.cursor + 1;
      index < this.history.entries.length;
      index += 1
    ) {
      const entry = this.history.entries[index];
      if (!entry || entry.item.availability === "unavailable") continue;
      collect(
        entry.executionEntryId,
        "history",
        entry.historyEntryId,
        entry.playbackInstanceId,
        entry.item,
      );
    }
    for (const entry of this.explicitQueue) {
      if (entry.item.availability === "unavailable") continue;
      collect(
        entry.executionEntryId,
        "explicit-queue",
        entry.explicitQueueEntryId,
        entry.playbackInstanceId,
        entry.item,
      );
    }
    const context = this.context;
    if (context) {
      const byId = new Map(
        context.originalItems.map((item) => [item.contextItemId, item]),
      );
      for (
        let index = context.resumeCursor;
        index < context.playOrder.length;
        index += 1
      ) {
        const id = context.playOrder[index];
        if (!id) continue;
        const entry = byId.get(id);
        if (!entry || entry.item.availability === "unavailable") continue;
        collect(
          entry.executionEntryId,
          context.kind === "artist-radio" ? "continuation" : "context",
          entry.contextItemId,
          null,
          entry.item,
        );
      }
    }
    return clone({
      revision: this.revisions.execution,
      current: this.current
        ? {
            executionEntryId: this.current.executionEntryId,
            source: this.current.source,
            relationId: this.current.relationId,
            playbackInstanceId: this.current.playbackInstanceId,
            item: this.current.item,
          }
        : null,
      future,
      hiddenEntryCount: availableFutureCount - future.length,
      truncated: availableFutureCount > future.length,
      boundary:
        this.current && this.repeatMode === "one"
          ? "repeat-one"
          : this.repeatMode === "all" && this.context
            ? "repeat-all-context"
            : this.continuePlayback === "same-artist" &&
                this.continuationArtistId(this.current)
              ? "same-artist"
              : "stop",
    });
  }

  private finishBoundary(ending: CurrentPlaybackItem | null): PlaybackDecision {
    if (this.pendingContinuation)
      return {
        kind: "continuation-needed",
        request: clone(this.pendingContinuation),
      };
    const artistId = this.continuationArtistId(ending);
    const previousLibraryTrackId = ending?.item.libraryTrackId;
    if (
      this.continuePlayback === "same-artist" &&
      artistId &&
      previousLibraryTrackId
    ) {
      const request: PendingContinuation = {
        requestId: this.id("continuation"),
        artistId,
        previousLibraryTrackId,
        recentLibraryTrackIds: this.recentLibraryTrackIds(),
      };
      this.current = null;
      this.pendingContinuation = request;
      this.bump("current", "execution");
      return { kind: "continuation-needed", request: clone(request) };
    }
    return this.stop(
      this.continuePlayback === "same-artist" &&
        (!artistId || !previousLibraryTrackId)
        ? "no-continuation-identity"
        : "no-future-item",
    );
  }

  private continuationArtistId(
    ending: CurrentPlaybackItem | null,
  ): string | null {
    const context = this.context;
    if (context?.kind === "artist")
      return context.entityId ?? context.continuationArtistId;
    if (context?.kind === "album") return context.continuationArtistId;
    return ending?.item.primaryArtistId ?? null;
  }

  private stop(
    reason:
      | "no-future-item"
      | "context-empty"
      | "no-continuation-identity"
      | "no-continuation-candidate",
  ): PlaybackDecision {
    if (this.current) {
      this.current = null;
      this.bump("current", "execution");
    }
    return { kind: "stop", reason };
  }

  private createContext(seed: PlaybackContextSeed): PlaybackContextSnapshot {
    if (!contextKinds.has(seed.kind))
      throw new PlaybackPlanError(
        "INVALID_PLAYBACK_CONTEXT",
        "Playback context kind is invalid.",
      );
    if (
      seed.items.length === 0 ||
      seed.items.length > MAX_PLAYBACK_CONTEXT_ITEMS
    )
      throw new PlaybackPlanError(
        "PLAYBACK_CONTEXT_SIZE",
        "Playback context must contain a bounded non-empty item list.",
      );
    const selectedIndex = seed.selectedIndex ?? 0;
    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= seed.items.length
    )
      throw new PlaybackPlanError(
        "INVALID_PLAYBACK_CONTEXT_INDEX",
        "Selected context item is out of range.",
      );
    const originalItems = seed.items.map<PlaybackContextItem>((item) => ({
      contextItemId: this.id("context-item"),
      executionEntryId: this.id("execution"),
      item: normalizedItem(item),
    }));
    const sourceId = optionalBoundedString(
      seed.source.sourceId,
      "context.source.sourceId",
      MAX_ID_LENGTH,
    );
    const relativePath = optionalBoundedString(
      seed.source.relativePath,
      "context.source.relativePath",
      MAX_NATIVE_PATH_LENGTH,
    );
    return {
      contextId: this.id("context"),
      kind: seed.kind,
      title: boundedString(seed.title, "context.title"),
      entityId: optionalBoundedString(
        seed.entityId,
        "context.entityId",
        MAX_ID_LENGTH,
      ),
      continuationArtistId: optionalBoundedString(
        seed.continuationArtistId,
        "context.continuationArtistId",
        MAX_ID_LENGTH,
      ),
      source: {
        label: boundedString(seed.source.label, "context.source.label"),
        ...(sourceId ? { sourceId } : {}),
        ...(relativePath ? { relativePath } : {}),
      },
      originalItems,
      playOrder: originalItems.map((item) => item.contextItemId),
      resumeCursor: selectedIndex,
      shuffleCycle: 0,
      repeatCycle: 0,
      availabilityRevision: 0,
    };
  }

  private prepareInitialContextOrder(
    context: PlaybackContextSnapshot,
    selectedIndex: number,
  ): PlaybackContextSnapshot {
    if (!this.shuffleEnabled)
      return { ...context, resumeCursor: selectedIndex };
    const selected = context.originalItems[selectedIndex];
    if (!selected) return context;
    const remaining = context.originalItems
      .filter((_, index) => index !== selectedIndex)
      .map((item) => item.contextItemId);
    return {
      ...context,
      playOrder: [selected.contextItemId, ...this.shuffled(remaining)],
      resumeCursor: 0,
      shuffleCycle: 1,
    };
  }

  private takeExplicit(reason: PlaybackStartReason): PlaybackDecision | null {
    let changed = false;
    while (this.explicitQueue.length > 0) {
      const [entry, ...remaining] = this.explicitQueue;
      this.explicitQueue = remaining;
      changed = true;
      if (!entry || entry.item.availability === "unavailable") continue;
      this.bump("explicitQueue", "execution");
      return this.startExplicit(entry, reason);
    }
    if (changed) this.bump("explicitQueue", "execution");
    return null;
  }

  private startExplicit(
    entry: ExplicitQueueEntry,
    reason: PlaybackStartReason,
  ): PlaybackDecision {
    return this.startNewCurrent(
      {
        playbackInstanceId: entry.playbackInstanceId,
        executionEntryId: entry.executionEntryId,
        source: "explicit-queue",
        relationId: entry.explicitQueueEntryId,
        contextId: this.context?.contextId ?? null,
        historyEntryId: null,
        item: entry.item,
        startedSequence: ++this.sequence,
      },
      reason,
    );
  }

  private takeContext(reason: PlaybackStartReason): PlaybackDecision | null {
    const context = this.context;
    if (!context) return null;
    const byId = new Map(
      context.originalItems.map((item) => [item.contextItemId, item]),
    );
    let cursor = context.resumeCursor;
    while (cursor < context.playOrder.length) {
      const id = context.playOrder[cursor];
      cursor += 1;
      const contextItem = id ? byId.get(id) : undefined;
      this.context = { ...context, resumeCursor: cursor };
      if (!contextItem || contextItem.item.availability === "unavailable")
        continue;
      const source: CurrentPlaybackSource =
        context.kind === "artist-radio" ? "continuation" : "context";
      return this.startNewCurrent(
        {
          playbackInstanceId: this.id("playback-item"),
          executionEntryId: contextItem.executionEntryId,
          source,
          relationId: contextItem.contextItemId,
          contextId: context.contextId,
          historyEntryId: null,
          item: contextItem.item,
          startedSequence: ++this.sequence,
        },
        reason,
        true,
      );
    }
    if (cursor !== context.resumeCursor) {
      this.context = { ...context, resumeCursor: cursor };
      this.bump("context", "execution");
    }
    return null;
  }

  private startNewCurrent(
    candidate: CurrentPlaybackItem,
    reason: PlaybackStartReason,
    contextChanged = false,
  ): PlaybackDecision {
    const historyEntryId = this.id("history");
    const original = this.originalSource(candidate);
    const entry: PlaybackHistoryEntry = {
      historyEntryId,
      playbackInstanceId: candidate.playbackInstanceId,
      executionEntryId: candidate.executionEntryId,
      originalSource: original.source,
      originalRelationId: original.relationId,
      contextId: candidate.contextId,
      item: candidate.item,
      startedSequence: candidate.startedSequence,
    };
    let entries = [
      ...this.history.entries.slice(0, this.history.cursor + 1),
      entry,
    ];
    if (entries.length > MAX_PLAYBACK_HISTORY_ITEMS)
      entries = entries.slice(entries.length - MAX_PLAYBACK_HISTORY_ITEMS);
    this.history = { entries, cursor: entries.length - 1 };
    this.current = { ...candidate, historyEntryId };
    this.pendingContinuation = null;
    this.bump(
      "current",
      "history",
      "execution",
      ...(contextChanged ? (["context"] as const) : []),
    );
    return { kind: "start", reason, current: clone(this.current) };
  }

  private startHistoryAt(
    index: number,
    reason: "history-previous" | "history-forward",
  ): PlaybackDecision {
    const entry = this.history.entries[index];
    if (!entry) return { kind: "none", reason: "history-start" };
    this.history = { ...this.history, cursor: index };
    this.current = {
      playbackInstanceId: entry.playbackInstanceId,
      // A History entry is already a distinct playback occurrence. Reuse its
      // technical identity so MPV can advance into a projected forward entry
      // without reloading the same track under a freshly generated ID.
      executionEntryId: entry.executionEntryId,
      source: "history",
      relationId: entry.historyEntryId,
      contextId: entry.contextId,
      historyEntryId: entry.historyEntryId,
      item: entry.item,
      startedSequence: ++this.sequence,
    };
    this.pendingContinuation = null;
    this.bump("current", "history", "execution");
    return { kind: "start", reason, current: clone(this.current) };
  }

  private takeForwardHistory(): PlaybackDecision | null {
    const forwardIndex = this.availableHistoryIndex(this.history.cursor + 1, 1);
    return forwardIndex === null
      ? null
      : this.startHistoryAt(forwardIndex, "history-forward");
  }

  private availableHistoryIndex(
    startIndex: number,
    direction: -1 | 1,
  ): number | null {
    let index = startIndex;
    for (
      let inspected = 0;
      inspected < MAX_PLAYBACK_HISTORY_ITEMS &&
      index >= 0 &&
      index < this.history.entries.length;
      inspected += 1
    ) {
      const entry = this.history.entries[index];
      if (entry && entry.item.availability !== "unavailable") return index;
      index += direction;
    }
    return null;
  }

  private repeatCurrent(current: CurrentPlaybackItem): PlaybackDecision {
    return {
      kind: "restart-current",
      playbackInstanceId: current.playbackInstanceId,
    };
  }

  private originalSource(current: CurrentPlaybackItem): {
    readonly source: Exclude<CurrentPlaybackSource, "history">;
    readonly relationId: string;
  } {
    if (current.source !== "history")
      return { source: current.source, relationId: current.relationId };
    const historyEntry = this.history.entries.find(
      (entry) => entry.historyEntryId === current.relationId,
    );
    return historyEntry
      ? {
          source: historyEntry.originalSource,
          relationId: historyEntry.originalRelationId,
        }
      : { source: "context", relationId: current.relationId };
  }

  private resetContextCycle(): void {
    const context = this.context;
    if (!context) return;
    if (context.kind === "artist-radio") {
      this.resetArtistRadioBag(this.current?.item.libraryTrackId ?? null);
      return;
    }
    const items = context.originalItems.map((item) => ({
      ...item,
      executionEntryId: this.id("execution"),
    }));
    let order = items.map((item) => item.contextItemId);
    if (this.shuffleEnabled) {
      order = this.shuffled(order);
      order = this.avoidImmediateContextRepeat(
        order,
        items,
        this.current?.item.libraryTrackId ?? null,
      );
    }
    this.context = {
      ...context,
      originalItems: items,
      playOrder: order,
      resumeCursor: 0,
      shuffleCycle: context.shuffleCycle + (this.shuffleEnabled ? 1 : 0),
      repeatCycle: context.repeatCycle + 1,
    };
    this.bump("context", "execution");
  }

  private resetArtistRadioBag(immediateLibraryTrackId: string | null): boolean {
    const context = this.context;
    const radio = this.artistRadio;
    if (context?.kind !== "artist-radio" || !radio) return false;
    const recent = new Set(this.recentLibraryTrackIds());
    const eligible = context.originalItems.filter(
      (candidate) =>
        candidate.item.availability === "available" &&
        candidate.item.libraryTrackId !== null &&
        candidate.item.libraryTrackId !== immediateLibraryTrackId,
    );
    const fresh = eligible.filter(
      (candidate) => !recent.has(candidate.item.libraryTrackId ?? ""),
    );
    const recentCandidates = eligible.filter((candidate) =>
      recent.has(candidate.item.libraryTrackId ?? ""),
    );
    const ordered = [
      ...this.shuffled(fresh),
      ...this.shuffled(recentCandidates),
    ];
    if (ordered.length === 0) return false;
    const ids = new Set(ordered.map((item) => item.contextItemId));
    const items = context.originalItems.map((item) =>
      ids.has(item.contextItemId)
        ? {
            ...item,
            executionEntryId: this.id("execution"),
          }
        : item,
    );
    this.context = {
      ...context,
      originalItems: items,
      playOrder: ordered.map((item) => item.contextItemId),
      resumeCursor: 0,
      shuffleCycle: context.shuffleCycle + 1,
    };
    this.artistRadio = { ...radio, bagCycle: radio.bagCycle + 1 };
    this.bump("context", "execution");
    return true;
  }

  private avoidImmediateContextRepeat(
    order: PlaybackContextItemId[],
    items: readonly PlaybackContextItem[],
    immediateLibraryTrackId: string | null,
  ): PlaybackContextItemId[] {
    if (!immediateLibraryTrackId || order.length < 2) return order;
    const byId = new Map(items.map((item) => [item.contextItemId, item]));
    if (
      byId.get(order[0] ?? ("" as PlaybackContextItemId))?.item
        .libraryTrackId !== immediateLibraryTrackId
    )
      return order;
    const replacement = order.findIndex(
      (id) => byId.get(id)?.item.libraryTrackId !== immediateLibraryTrackId,
    );
    if (replacement <= 0) return order;
    const next = [...order];
    const first = next[0];
    const alternate = next[replacement];
    if (first && alternate) {
      next[0] = alternate;
      next[replacement] = first;
    }
    return next;
  }

  private recentLibraryTrackIds(): readonly string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (let index = this.history.entries.length - 1; index >= 0; index -= 1) {
      const id = this.history.entries[index]?.item.libraryTrackId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= this.recentHistoryAvoidance) break;
    }
    return ids;
  }

  private shuffled<T>(source: readonly T[]): T[] {
    const result = [...source];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const sample = this.random();
      const normalized = Number.isFinite(sample)
        ? Math.max(0, Math.min(0.9999999999999999, sample))
        : 0;
      const target = Math.floor(normalized * (index + 1));
      const value = result[index];
      const replacement = result[target];
      if (value !== undefined && replacement !== undefined) {
        result[index] = replacement;
        result[target] = value;
      }
    }
    return result;
  }

  private requireAvailability(availability: PlaybackAvailability): void {
    const candidate: unknown = availability;
    if (candidate !== "available" && candidate !== "unavailable")
      throw new PlaybackPlanError(
        "INVALID_PLAYBACK_AVAILABILITY",
        "Playback availability is invalid.",
      );
  }

  private boundedProjectionLimit(value: number): number {
    if (
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_EXECUTION_PROJECTION_LIMIT
    )
      throw new PlaybackPlanError(
        "INVALID_EXECUTION_PLAN_LIMIT",
        "Execution plan projection limit is out of range.",
      );
    return value;
  }

  private id(prefix: "playback-item"): PlaybackInstanceId;
  private id(prefix: "explicit"): ExplicitQueueEntryId;
  private id(prefix: "context"): PlaybackContextId;
  private id(prefix: "context-item"): PlaybackContextItemId;
  private id(prefix: "history"): PlaybackHistoryEntryId;
  private id(prefix: "execution"): PlaybackExecutionEntryId;
  private id(prefix: "continuation"): PendingContinuation["requestId"];
  private id(prefix: PlaybackIdPrefix): `${PlaybackIdPrefix}-${string}` {
    const generated = this.idFactory(prefix);
    const value = generated.startsWith(`${prefix}-`)
      ? generated
      : `${prefix}-${generated}`;
    if (value.length > MAX_ID_LENGTH)
      throw new PlaybackPlanError(
        "INVALID_PLAYBACK_ID",
        "Generated playback ID is too long.",
      );
    return value as `${PlaybackIdPrefix}-${string}`;
  }

  private bump(
    ...keys: readonly (
      | "current"
      | "context"
      | "explicitQueue"
      | "history"
      | "execution"
      | "availability"
    )[]
  ): void {
    const selected = new Set(keys);
    this.revisions = {
      state: this.revisions.state + 1,
      current: this.revisions.current + (selected.has("current") ? 1 : 0),
      context: this.revisions.context + (selected.has("context") ? 1 : 0),
      explicitQueue:
        this.revisions.explicitQueue + (selected.has("explicitQueue") ? 1 : 0),
      history: this.revisions.history + (selected.has("history") ? 1 : 0),
      execution: this.revisions.execution + (selected.has("execution") ? 1 : 0),
      availability:
        this.revisions.availability + (selected.has("availability") ? 1 : 0),
    };
  }
}

function hasPrefixedId(value: unknown, prefix: PlaybackIdPrefix): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(`${prefix}-`) &&
    value.length > prefix.length + 1 &&
    value.length <= MAX_ID_LENGTH
  );
}

function isAvailability(value: unknown): value is PlaybackAvailability {
  return value === "available" || value === "unavailable";
}

function isOrigin(value: unknown): value is PlaybackItemOrigin {
  if (
    !isRecord(value) ||
    !originKinds.has(value.kind as PlaybackItemOrigin["kind"])
  )
    return false;
  return (
    (value.sourceId === undefined ||
      (typeof value.sourceId === "string" &&
        value.sourceId.length <= MAX_ID_LENGTH)) &&
    (value.relativePath === undefined ||
      (typeof value.relativePath === "string" &&
        value.relativePath.length <= MAX_NATIVE_PATH_LENGTH)) &&
    (value.entryId === undefined ||
      (typeof value.entryId === "string" &&
        value.entryId.length > 0 &&
        value.entryId.length <= MAX_ID_LENGTH)) &&
    (value.removable === undefined || typeof value.removable === "boolean") &&
    (value.smb === undefined || typeof value.smb === "boolean")
  );
}

function isItem(value: unknown): value is PlaybackItemSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.nativePath === "string" &&
    value.nativePath.length > 0 &&
    value.nativePath.length <= MAX_NATIVE_PATH_LENGTH &&
    typeof value.filename === "string" &&
    value.filename.length > 0 &&
    value.filename.length <= MAX_TEXT_LENGTH &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    value.title.length <= MAX_TEXT_LENGTH &&
    (value.artist === null ||
      (typeof value.artist === "string" &&
        value.artist.length <= MAX_TEXT_LENGTH)) &&
    (value.album === null ||
      (typeof value.album === "string" &&
        value.album.length <= MAX_TEXT_LENGTH)) &&
    (value.durationSeconds === null ||
      (typeof value.durationSeconds === "number" &&
        Number.isFinite(value.durationSeconds) &&
        value.durationSeconds >= 0)) &&
    (value.libraryTrackId === null ||
      (typeof value.libraryTrackId === "string" &&
        value.libraryTrackId.length > 0 &&
        value.libraryTrackId.length <= MAX_ID_LENGTH)) &&
    (value.primaryArtistId === undefined ||
      value.primaryArtistId === null ||
      (typeof value.primaryArtistId === "string" &&
        /^artist-[0-9a-f]{32}$/u.test(value.primaryArtistId))) &&
    isAvailability(value.availability) &&
    isOrigin(value.origin)
  );
}

function isContext(value: unknown): value is PlaybackContextSnapshot {
  if (!isRecord(value) || !hasPrefixedId(value.contextId, "context"))
    return false;
  if (!contextKinds.has(value.kind as PlaybackContextKind)) return false;
  if (
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    value.title.length > MAX_TEXT_LENGTH ||
    (value.entityId !== null && typeof value.entityId !== "string") ||
    (value.continuationArtistId !== null &&
      typeof value.continuationArtistId !== "string") ||
    !isRecord(value.source) ||
    typeof value.source.label !== "string" ||
    !Array.isArray(value.originalItems) ||
    value.originalItems.length === 0 ||
    value.originalItems.length > MAX_PLAYBACK_CONTEXT_ITEMS ||
    !Array.isArray(value.playOrder)
  )
    return false;
  const ids = new Set<string>();
  for (const candidate of value.originalItems) {
    if (
      !isRecord(candidate) ||
      !hasPrefixedId(candidate.contextItemId, "context-item") ||
      !hasPrefixedId(candidate.executionEntryId, "execution") ||
      !isItem(candidate.item) ||
      ids.has(candidate.contextItemId as string)
    )
      return false;
    ids.add(candidate.contextItemId as string);
  }
  if (
    value.playOrder.length > value.originalItems.length ||
    !value.playOrder.every((id) => typeof id === "string" && ids.has(id)) ||
    new Set(value.playOrder).size !== value.playOrder.length ||
    !Number.isInteger(value.resumeCursor) ||
    (value.resumeCursor as number) < 0 ||
    (value.resumeCursor as number) > value.playOrder.length
  )
    return false;
  return [
    value.shuffleCycle,
    value.repeatCycle,
    value.availabilityRevision,
  ].every(
    (revision) => Number.isSafeInteger(revision) && (revision as number) >= 0,
  );
}

function isExplicitEntry(value: unknown): value is ExplicitQueueEntry {
  return (
    isRecord(value) &&
    hasPrefixedId(value.explicitQueueEntryId, "explicit") &&
    hasPrefixedId(value.playbackInstanceId, "playback-item") &&
    hasPrefixedId(value.executionEntryId, "execution") &&
    isItem(value.item) &&
    Number.isSafeInteger(value.addedSequence) &&
    (value.addedSequence as number) >= 0
  );
}

function isHistoryEntry(value: unknown): value is PlaybackHistoryEntry {
  return (
    isRecord(value) &&
    hasPrefixedId(value.historyEntryId, "history") &&
    hasPrefixedId(value.playbackInstanceId, "playback-item") &&
    hasPrefixedId(value.executionEntryId, "execution") &&
    (value.originalSource === "context" ||
      value.originalSource === "explicit-queue" ||
      value.originalSource === "continuation") &&
    typeof value.originalRelationId === "string" &&
    (value.contextId === null || hasPrefixedId(value.contextId, "context")) &&
    isItem(value.item) &&
    Number.isSafeInteger(value.startedSequence) &&
    (value.startedSequence as number) >= 0
  );
}

function isCurrent(value: unknown): value is CurrentPlaybackItem {
  return (
    isRecord(value) &&
    hasPrefixedId(value.playbackInstanceId, "playback-item") &&
    hasPrefixedId(value.executionEntryId, "execution") &&
    (value.source === "context" ||
      value.source === "explicit-queue" ||
      value.source === "history" ||
      value.source === "continuation") &&
    typeof value.relationId === "string" &&
    (value.contextId === null || hasPrefixedId(value.contextId, "context")) &&
    (value.historyEntryId === null ||
      hasPrefixedId(value.historyEntryId, "history")) &&
    isItem(value.item) &&
    Number.isSafeInteger(value.startedSequence) &&
    (value.startedSequence as number) >= 0
  );
}

function isRevisions(value: unknown): value is PlaybackPlanRevisions {
  if (!isRecord(value)) return false;
  return [
    "state",
    "current",
    "context",
    "explicitQueue",
    "history",
    "execution",
    "availability",
  ].every(
    (key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0,
  );
}

export function isPlaybackPlanSnapshot(
  value: unknown,
): value is PlaybackPlanSnapshot {
  if (!isRecord(value) || value.schemaVersion !== PLAYBACK_PLAN_SCHEMA_VERSION)
    return false;
  if (
    (value.current !== null && !isCurrent(value.current)) ||
    (value.context !== null && !isContext(value.context)) ||
    !Array.isArray(value.explicitQueue) ||
    value.explicitQueue.length > MAX_EXPLICIT_QUEUE_ITEMS ||
    !value.explicitQueue.every(isExplicitEntry) ||
    !isRecord(value.history) ||
    !Array.isArray(value.history.entries) ||
    value.history.entries.length > MAX_PLAYBACK_HISTORY_ITEMS ||
    !value.history.entries.every(isHistoryEntry) ||
    !Number.isInteger(value.history.cursor) ||
    (value.history.entries.length === 0
      ? value.history.cursor !== -1
      : (value.history.cursor as number) < 0 ||
        (value.history.cursor as number) >= value.history.entries.length) ||
    typeof value.shuffleEnabled !== "boolean" ||
    (value.repeatMode !== "off" &&
      value.repeatMode !== "all" &&
      value.repeatMode !== "one") ||
    (value.continuePlayback !== "off" &&
      value.continuePlayback !== "same-artist") ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    !isRevisions(value.revisions)
  )
    return false;
  if (value.artistRadio !== null) {
    if (
      !isRecord(value.artistRadio) ||
      !hasPrefixedId(value.artistRadio.contextId, "context") ||
      typeof value.artistRadio.artistId !== "string" ||
      !Number.isSafeInteger(value.artistRadio.bagCycle) ||
      (value.artistRadio.bagCycle as number) < 0 ||
      !isRecord(value.context) ||
      value.context.kind !== "artist-radio" ||
      value.context.contextId !== value.artistRadio.contextId
    )
      return false;
  }
  if (value.pendingContinuation !== null) {
    if (
      !isRecord(value.pendingContinuation) ||
      !hasPrefixedId(value.pendingContinuation.requestId, "continuation") ||
      typeof value.pendingContinuation.artistId !== "string" ||
      typeof value.pendingContinuation.previousLibraryTrackId !== "string" ||
      !Array.isArray(value.pendingContinuation.recentLibraryTrackIds) ||
      !value.pendingContinuation.recentLibraryTrackIds.every(
        (id) => typeof id === "string" && id.length <= MAX_ID_LENGTH,
      )
    )
      return false;
  }
  return true;
}
