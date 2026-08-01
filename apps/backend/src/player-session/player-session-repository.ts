import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";
import {
  MAX_EXPLICIT_QUEUE_ITEMS,
  MAX_PLAYBACK_CONTEXT_ITEMS,
  MAX_PLAYBACK_HISTORY_ITEMS,
  PLAYBACK_PLAN_SCHEMA_VERSION,
  type ArtistRadioSnapshot,
  type CurrentPlaybackItem,
  type ExplicitQueueEntry,
  type PendingContinuation,
  type PlaybackContextId,
  type PlaybackContextItem,
  type PlaybackContextItemId,
  type PlaybackContextKind,
  type PlaybackContextSnapshot,
  type PlaybackHistoryEntry,
  type PlaybackHistoryEntryId,
  type PlaybackHistorySnapshot,
  type PlaybackIdPrefix,
  type PlaybackInstanceId,
  type PlaybackItemOrigin,
  type PlaybackItemSnapshot,
  type PlaybackPlanRevisions,
  type PlaybackPlanSnapshot,
} from "../playback-plan/playback-plan-types.js";
import { resolveAppDirectories } from "../platform/app-directories.js";
import {
  PLAYER_SESSION_VERSION,
  type PersistedPlayerSession,
  type PersistedPlayerSessionV3,
  type PersistedQueueItem,
  type PersistedQueueOrigin,
  type PlayerSessionPlaybackSnapshot,
  type PlayerSessionV3ReadResult,
} from "./player-session-types.js";

const MAX_NATIVE_PATH_LENGTH = 32_768;
const MAX_TEXT_LENGTH = 512;
const MAX_ID_LENGTH = 256;
const MAX_SESSION_FILE_CHARACTERS = 64 * 1024 * 1024;
const MAX_PENDING_RECENT_ITEMS = MAX_PLAYBACK_HISTORY_ITEMS;

const CONTEXT_KINDS = new Set<PlaybackContextKind>([
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

const ORIGIN_KINDS = new Set<PlaybackItemOrigin["kind"]>([
  "library",
  "folder",
  "direct",
  "removable",
  "smb",
  "legacy",
]);

type ParsedDocument<T> =
  | { readonly status: "valid"; readonly value: T }
  | { readonly status: "future"; readonly version: number }
  | { readonly status: "invalid" };

interface ParsedLegacySession {
  readonly session: PersistedPlayerSession;
  readonly sourceVersion: 1 | 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  maximum = MAX_TEXT_LENGTH,
): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : null;
}

function optionalBoundedString(
  value: unknown,
  maximum = MAX_TEXT_LENGTH,
): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : boundedString(value, maximum);
}

function boundedInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
      return true;
  }
  return false;
}

function prefixedId<Prefix extends PlaybackIdPrefix>(
  value: unknown,
  prefix: Prefix,
): `${Prefix}-${string}` | null {
  return typeof value === "string" &&
    value.startsWith(`${prefix}-`) &&
    value.length > prefix.length + 1 &&
    value.length <= MAX_ID_LENGTH &&
    !hasControlCharacter(value)
    ? (value as `${Prefix}-${string}`)
    : null;
}

function parseOrigin(value: unknown): PlaybackItemOrigin | null {
  if (
    !isRecord(value) ||
    !ORIGIN_KINDS.has(value.kind as PlaybackItemOrigin["kind"])
  )
    return null;
  const kind = value.kind as PlaybackItemOrigin["kind"];
  const sourceId = optionalBoundedString(value.sourceId, MAX_ID_LENGTH);
  const relativePath = optionalBoundedString(
    value.relativePath,
    MAX_NATIVE_PATH_LENGTH,
  );
  const entryId = optionalBoundedString(value.entryId, MAX_ID_LENGTH);
  return {
    kind,
    ...(sourceId ? { sourceId } : {}),
    ...(relativePath ? { relativePath } : {}),
    ...(entryId ? { entryId } : {}),
    ...(typeof value.removable === "boolean"
      ? { removable: value.removable }
      : {}),
    ...(typeof value.smb === "boolean" ? { smb: value.smb } : {}),
  };
}

function parseItem(value: unknown): PlaybackItemSnapshot | null {
  if (!isRecord(value)) return null;
  const nativePath = boundedString(value.nativePath, MAX_NATIVE_PATH_LENGTH);
  const filename = boundedString(value.filename);
  const title = boundedString(value.title);
  const origin = parseOrigin(value.origin);
  if (!nativePath || !filename || !title || !origin) return null;
  const durationSeconds =
    typeof value.durationSeconds === "number" &&
    Number.isFinite(value.durationSeconds) &&
    value.durationSeconds >= 0
      ? value.durationSeconds
      : null;
  const primaryArtistId =
    typeof value.primaryArtistId === "string" &&
    /^artist-[0-9a-f]{32}$/u.test(value.primaryArtistId)
      ? value.primaryArtistId
      : null;
  return {
    nativePath,
    filename,
    title,
    artist: optionalBoundedString(value.artist),
    album: optionalBoundedString(value.album),
    durationSeconds,
    libraryTrackId: optionalBoundedString(value.libraryTrackId, MAX_ID_LENGTH),
    ...(primaryArtistId ? { primaryArtistId } : {}),
    availability:
      value.availability === "available" ? "available" : "unavailable",
    origin,
  };
}

function parseContextItem(value: unknown): PlaybackContextItem | null {
  if (!isRecord(value)) return null;
  const contextItemId = prefixedId(value.contextItemId, "context-item");
  const executionEntryId = prefixedId(value.executionEntryId, "execution");
  const item = parseItem(value.item);
  return contextItemId && executionEntryId && item
    ? { contextItemId, executionEntryId, item }
    : null;
}

function parseContext(value: unknown): PlaybackContextSnapshot | null {
  if (!isRecord(value)) return null;
  const contextId = prefixedId(value.contextId, "context");
  const title = boundedString(value.title);
  if (
    !contextId ||
    !title ||
    !CONTEXT_KINDS.has(value.kind as PlaybackContextKind) ||
    !isRecord(value.source) ||
    !Array.isArray(value.originalItems)
  )
    return null;
  const label = boundedString(value.source.label);
  if (!label) return null;

  const originalItems: PlaybackContextItem[] = [];
  const itemIds = new Set<string>();
  const executionIds = new Set<string>();
  for (const candidate of value.originalItems.slice(
    0,
    MAX_PLAYBACK_CONTEXT_ITEMS,
  )) {
    const item = parseContextItem(candidate);
    if (
      !item ||
      itemIds.has(item.contextItemId) ||
      executionIds.has(item.executionEntryId)
    )
      continue;
    itemIds.add(item.contextItemId);
    executionIds.add(item.executionEntryId);
    originalItems.push(item);
  }
  if (originalItems.length === 0) return null;

  const playOrder: PlaybackContextItemId[] = [];
  const orderedIds = new Set<string>();
  if (Array.isArray(value.playOrder)) {
    for (const candidate of value.playOrder.slice(
      0,
      MAX_PLAYBACK_CONTEXT_ITEMS,
    )) {
      if (
        typeof candidate !== "string" ||
        !itemIds.has(candidate) ||
        orderedIds.has(candidate)
      )
        continue;
      orderedIds.add(candidate);
      playOrder.push(candidate as PlaybackContextItemId);
    }
  }
  for (const item of originalItems) {
    if (orderedIds.has(item.contextItemId)) continue;
    orderedIds.add(item.contextItemId);
    playOrder.push(item.contextItemId);
  }

  const sourceId = optionalBoundedString(value.source.sourceId, MAX_ID_LENGTH);
  const relativePath = optionalBoundedString(
    value.source.relativePath,
    MAX_NATIVE_PATH_LENGTH,
  );
  const requestedCursor = boundedInteger(value.resumeCursor);
  return {
    contextId,
    kind: value.kind as PlaybackContextKind,
    title,
    entityId: optionalBoundedString(value.entityId, MAX_ID_LENGTH),
    continuationArtistId: optionalBoundedString(
      value.continuationArtistId,
      MAX_ID_LENGTH,
    ),
    source: {
      label,
      ...(sourceId ? { sourceId } : {}),
      ...(relativePath ? { relativePath } : {}),
    },
    originalItems,
    playOrder,
    resumeCursor: Math.min(requestedCursor, playOrder.length),
    shuffleCycle: boundedInteger(value.shuffleCycle),
    repeatCycle: boundedInteger(value.repeatCycle),
    availabilityRevision: boundedInteger(value.availabilityRevision),
  };
}

function parseExplicitEntry(value: unknown): ExplicitQueueEntry | null {
  if (!isRecord(value)) return null;
  const explicitQueueEntryId = prefixedId(
    value.explicitQueueEntryId,
    "explicit",
  );
  const playbackInstanceId = prefixedId(
    value.playbackInstanceId,
    "playback-item",
  );
  const executionEntryId = prefixedId(value.executionEntryId, "execution");
  const item = parseItem(value.item);
  if (
    !explicitQueueEntryId ||
    !playbackInstanceId ||
    !executionEntryId ||
    !item ||
    !Number.isSafeInteger(value.addedSequence) ||
    (value.addedSequence as number) < 0
  )
    return null;
  return {
    explicitQueueEntryId,
    playbackInstanceId,
    executionEntryId,
    item,
    addedSequence: value.addedSequence as number,
  };
}

function parseExplicitQueue(value: unknown): readonly ExplicitQueueEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ExplicitQueueEntry[] = [];
  const primaryIds = new Set<string>();
  const playbackIds = new Set<string>();
  const executionIds = new Set<string>();
  for (const candidate of value.slice(0, MAX_EXPLICIT_QUEUE_ITEMS)) {
    const entry = parseExplicitEntry(candidate);
    if (
      !entry ||
      primaryIds.has(entry.explicitQueueEntryId) ||
      playbackIds.has(entry.playbackInstanceId) ||
      executionIds.has(entry.executionEntryId)
    )
      continue;
    primaryIds.add(entry.explicitQueueEntryId);
    playbackIds.add(entry.playbackInstanceId);
    executionIds.add(entry.executionEntryId);
    entries.push(entry);
  }
  return entries;
}

function parseHistoryEntry(value: unknown): PlaybackHistoryEntry | null {
  if (!isRecord(value)) return null;
  const historyEntryId = prefixedId(value.historyEntryId, "history");
  const playbackInstanceId = prefixedId(
    value.playbackInstanceId,
    "playback-item",
  );
  const executionEntryId = prefixedId(value.executionEntryId, "execution");
  const contextId =
    value.contextId === null ? null : prefixedId(value.contextId, "context");
  const originalRelationId = boundedString(
    value.originalRelationId,
    MAX_ID_LENGTH,
  );
  const item = parseItem(value.item);
  if (
    !historyEntryId ||
    !playbackInstanceId ||
    !executionEntryId ||
    (value.contextId !== null && !contextId) ||
    !originalRelationId ||
    !item ||
    (value.originalSource !== "context" &&
      value.originalSource !== "explicit-queue" &&
      value.originalSource !== "continuation") ||
    !Number.isSafeInteger(value.startedSequence) ||
    (value.startedSequence as number) < 0
  )
    return null;
  return {
    historyEntryId,
    playbackInstanceId,
    executionEntryId,
    originalSource: value.originalSource,
    originalRelationId,
    contextId,
    item,
    startedSequence: value.startedSequence as number,
  };
}

function parseHistory(value: unknown): PlaybackHistorySnapshot {
  if (!isRecord(value) || !Array.isArray(value.entries))
    return { entries: [], cursor: -1 };
  const rawEntries = value.entries;
  const retained: {
    readonly entry: PlaybackHistoryEntry;
    readonly index: number;
  }[] = [];
  const primaryIds = new Set<string>();
  const playbackIds = new Set<string>();
  for (let index = rawEntries.length - 1; index >= 0; index -= 1) {
    if (retained.length >= MAX_PLAYBACK_HISTORY_ITEMS) break;
    const entry = parseHistoryEntry(rawEntries[index]);
    if (
      !entry ||
      primaryIds.has(entry.historyEntryId) ||
      playbackIds.has(entry.playbackInstanceId)
    )
      continue;
    primaryIds.add(entry.historyEntryId);
    playbackIds.add(entry.playbackInstanceId);
    retained.push({ entry, index });
  }
  retained.reverse();
  if (retained.length === 0) return { entries: [], cursor: -1 };

  const requestedCursor =
    typeof value.cursor === "number" && Number.isInteger(value.cursor)
      ? value.cursor
      : rawEntries.length - 1;
  let cursor = retained.findLastIndex(
    (candidate) => candidate.index <= requestedCursor,
  );
  if (cursor < 0) cursor = 0;
  return {
    entries: retained.map(({ entry }) => entry),
    cursor,
  };
}

function parseCurrent(value: unknown): CurrentPlaybackItem | null {
  if (!isRecord(value)) return null;
  const playbackInstanceId = prefixedId(
    value.playbackInstanceId,
    "playback-item",
  );
  const executionEntryId = prefixedId(value.executionEntryId, "execution");
  const relationId = boundedString(value.relationId, MAX_ID_LENGTH);
  const contextId =
    value.contextId === null ? null : prefixedId(value.contextId, "context");
  const historyEntryId =
    value.historyEntryId === null
      ? null
      : prefixedId(value.historyEntryId, "history");
  const item = parseItem(value.item);
  if (
    !playbackInstanceId ||
    !executionEntryId ||
    !relationId ||
    (value.contextId !== null && !contextId) ||
    (value.historyEntryId !== null && !historyEntryId) ||
    !item ||
    (value.source !== "context" &&
      value.source !== "explicit-queue" &&
      value.source !== "history" &&
      value.source !== "continuation") ||
    !Number.isSafeInteger(value.startedSequence) ||
    (value.startedSequence as number) < 0
  )
    return null;
  return {
    playbackInstanceId,
    executionEntryId,
    source: value.source,
    relationId: relationId as CurrentPlaybackItem["relationId"],
    contextId,
    historyEntryId,
    item,
    startedSequence: value.startedSequence as number,
  };
}

function parseArtistRadio(
  value: unknown,
  context: PlaybackContextSnapshot | null,
): ArtistRadioSnapshot | null {
  if (!isRecord(value)) return null;
  const contextId = prefixedId(value.contextId, "context");
  const artistId = boundedString(value.artistId, MAX_ID_LENGTH);
  if (
    !contextId ||
    !artistId ||
    !Number.isSafeInteger(value.bagCycle) ||
    (value.bagCycle as number) < 0 ||
    context?.kind !== "artist-radio" ||
    context.contextId !== contextId
  )
    return null;
  return {
    contextId,
    artistId,
    bagCycle: value.bagCycle as number,
  };
}

function parsePendingContinuation(value: unknown): PendingContinuation | null {
  if (!isRecord(value)) return null;
  const requestId = prefixedId(value.requestId, "continuation");
  const artistId = boundedString(value.artistId, MAX_ID_LENGTH);
  const previousLibraryTrackId = boundedString(
    value.previousLibraryTrackId,
    MAX_ID_LENGTH,
  );
  if (
    !requestId ||
    !artistId ||
    !previousLibraryTrackId ||
    !Array.isArray(value.recentLibraryTrackIds)
  )
    return null;
  const recentLibraryTrackIds: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value.recentLibraryTrackIds.slice(
    0,
    MAX_PENDING_RECENT_ITEMS,
  )) {
    const id = boundedString(candidate, MAX_ID_LENGTH);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    recentLibraryTrackIds.push(id);
  }
  return { requestId, artistId, previousLibraryTrackId, recentLibraryTrackIds };
}

function parseRevisions(value: unknown): PlaybackPlanRevisions {
  const record = isRecord(value) ? value : {};
  return {
    state: boundedInteger(record.state),
    current: boundedInteger(record.current),
    context: boundedInteger(record.context),
    explicitQueue: boundedInteger(record.explicitQueue),
    history: boundedInteger(record.history),
    execution: boundedInteger(record.execution),
    availability: boundedInteger(record.availability),
  };
}

function parseV3Document(
  value: unknown,
): ParsedDocument<PersistedPlayerSessionV3> {
  if (!isRecord(value)) return { status: "invalid" };
  if (
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  )
    return { status: "invalid" };
  if (value.version > PLAYER_SESSION_VERSION)
    return { status: "future", version: value.version };
  if (value.version !== PLAYER_SESSION_VERSION) return { status: "invalid" };
  if (
    typeof value.planSchemaVersion !== "number" ||
    !Number.isSafeInteger(value.planSchemaVersion) ||
    value.planSchemaVersion < 1
  )
    return { status: "invalid" };
  if (value.planSchemaVersion > PLAYBACK_PLAN_SCHEMA_VERSION)
    return { status: "future", version: value.planSchemaVersion };
  if (value.planSchemaVersion !== PLAYBACK_PLAN_SCHEMA_VERSION)
    return { status: "invalid" };

  const context = parseContext(value.context);
  return {
    status: "valid",
    value: {
      version: PLAYER_SESSION_VERSION,
      planSchemaVersion: PLAYBACK_PLAN_SCHEMA_VERSION,
      current: parseCurrent(value.current),
      context,
      explicitQueue: parseExplicitQueue(value.explicitQueue),
      history: parseHistory(value.history),
      artistRadio: parseArtistRadio(value.artistRadio, context),
      pendingContinuation: parsePendingContinuation(value.pendingContinuation),
      positionSeconds:
        typeof value.positionSeconds === "number" &&
        Number.isFinite(value.positionSeconds)
          ? Math.max(0, value.positionSeconds)
          : 0,
      volume:
        typeof value.volume === "number" && Number.isFinite(value.volume)
          ? Math.max(0, Math.min(100, value.volume))
          : 100,
      muted: value.muted === true,
      shuffleEnabled: value.shuffleEnabled === true,
      repeatMode:
        value.repeatMode === "all" || value.repeatMode === "one"
          ? value.repeatMode
          : "off",
      continuePlayback:
        value.continuePlayback === "same-artist" ? "same-artist" : "off",
      sequence: boundedInteger(value.sequence),
      revisions: parseRevisions(value.revisions),
    },
  };
}

function isLegacyOrigin(value: unknown): value is PersistedQueueOrigin {
  if (!isRecord(value)) return false;
  if (value.kind === "direct")
    return boundedString(value.nativePath, MAX_NATIVE_PATH_LENGTH) !== null;
  if (value.kind === "removable")
    return (
      typeof value.deviceId === "string" &&
      /^usb-[0-9a-f]{32}$/u.test(value.deviceId) &&
      boundedString(value.relativePath, MAX_NATIVE_PATH_LENGTH) !== null &&
      typeof value.entryId === "string" &&
      /^entry-[0-9a-f]{32}$/u.test(value.entryId)
    );
  if (value.kind === "smb")
    return (
      typeof value.connectionId === "string" &&
      /^smb-[0-9a-f]{32}$/u.test(value.connectionId) &&
      boundedString(value.relativePath, MAX_NATIVE_PATH_LENGTH) !== null &&
      typeof value.entryId === "string" &&
      /^entry-[0-9a-f]{32}$/u.test(value.entryId)
    );
  return (
    value.kind === "folders" &&
    typeof value.sourceId === "string" &&
    /^[0-9a-f-]{36}$/iu.test(value.sourceId) &&
    boundedString(value.relativePath, MAX_NATIVE_PATH_LENGTH) !== null &&
    (value.removable === undefined || typeof value.removable === "boolean") &&
    (value.smb === undefined || typeof value.smb === "boolean") &&
    (value.libraryTrackId === undefined ||
      (typeof value.libraryTrackId === "string" &&
        /^track-[0-9a-f]{32}$/u.test(value.libraryTrackId)))
  );
}

function isLegacyItem(value: unknown): value is PersistedQueueItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    /^queue-[0-9a-f-]{36}$/iu.test(value.id) &&
    isLegacyOrigin(value.origin) &&
    boundedString(value.filename) !== null &&
    typeof value.displayTitle === "string" &&
    value.displayTitle.length <= MAX_TEXT_LENGTH
  );
}

function parseLegacyDocument(
  value: unknown,
): ParsedDocument<ParsedLegacySession> {
  if (!isRecord(value)) return { status: "invalid" };
  if (
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  )
    return { status: "invalid" };
  if (value.version > 2) return { status: "future", version: value.version };
  if (
    (value.version !== 1 && value.version !== 2) ||
    typeof value.currentQueueItemId !== "string" ||
    !Array.isArray(value.queue) ||
    value.queue.length === 0 ||
    value.queue.length > MAX_PLAYBACK_CONTEXT_ITEMS ||
    !value.queue.every(isLegacyItem) ||
    new Set(value.queue.map((item) => item.id)).size !== value.queue.length ||
    !value.queue.some((item) => item.id === value.currentQueueItemId)
  )
    return { status: "invalid" };
  const sourceVersion = value.version;
  return {
    status: "valid",
    value: {
      sourceVersion,
      session: {
        version: 2,
        currentQueueItemId: value.currentQueueItemId,
        queue: value.queue,
        positionSeconds:
          sourceVersion === 2 &&
          typeof value.positionSeconds === "number" &&
          Number.isFinite(value.positionSeconds)
            ? Math.max(0, value.positionSeconds)
            : 0,
        volume:
          sourceVersion === 2 &&
          typeof value.volume === "number" &&
          Number.isFinite(value.volume)
            ? Math.max(0, Math.min(100, value.volume))
            : 100,
        muted: sourceVersion === 2 && value.muted === true,
        shuffleEnabled: sourceVersion === 2 && value.shuffleEnabled === true,
        repeatMode:
          sourceVersion === 2 &&
          (value.repeatMode === "all" || value.repeatMode === "one")
            ? value.repeatMode
            : "off",
      },
    },
  };
}

function legacyNativePath(origin: PersistedQueueOrigin): string {
  return origin.kind === "direct" ? origin.nativePath : origin.relativePath;
}

function legacyPlaybackOrigin(
  origin: PersistedQueueOrigin,
): PlaybackItemOrigin {
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
    ...(typeof origin.removable === "boolean"
      ? { removable: origin.removable }
      : {}),
    ...(typeof origin.smb === "boolean" ? { smb: origin.smb } : {}),
  };
}

function legacyPlaybackItem(
  item: PersistedQueueItem,
  resolvedNativePath?: string,
): PlaybackItemSnapshot {
  return {
    nativePath:
      boundedString(resolvedNativePath, MAX_NATIVE_PATH_LENGTH) ??
      legacyNativePath(item.origin),
    filename: item.filename,
    title: item.displayTitle || item.filename,
    artist: null,
    album: null,
    durationSeconds: null,
    libraryTrackId:
      item.origin.kind === "folders"
        ? (item.origin.libraryTrackId ?? null)
        : null,
    availability: "available",
    origin: legacyPlaybackOrigin(item.origin),
  };
}

export function migrateLegacyPlayerSession(
  session: PersistedPlayerSession,
  resolvedNativePaths: ReadonlyMap<string, string> = new Map(),
): PersistedPlayerSessionV3 {
  const currentIndex = session.queue.findIndex(
    (item) => item.id === session.currentQueueItemId,
  );
  if (currentIndex < 0 || session.queue.length === 0)
    throw new Error("Legacy Player Session has no current item.");

  const contextId = deterministicPlaybackId(
    "context",
    `legacy-context:${session.currentQueueItemId}`,
  ) as PlaybackContextId;
  const originalItems: PlaybackContextItem[] = session.queue.map((legacy) => ({
    contextItemId: deterministicPlaybackId(
      "context-item",
      `legacy-context-item:${legacy.id}`,
    ) as PlaybackContextItem["contextItemId"],
    executionEntryId: deterministicPlaybackId(
      "execution",
      `legacy-execution:${legacy.id}`,
    ) as PlaybackContextItem["executionEntryId"],
    item: legacyPlaybackItem(legacy, resolvedNativePaths.get(legacy.id)),
  }));
  const selected = originalItems[currentIndex];
  if (!selected)
    throw new Error("Legacy Player Session current item is invalid.");

  const playbackInstanceId = deterministicPlaybackId(
    "playback-item",
    `legacy-playback:${session.currentQueueItemId}`,
  ) as PlaybackInstanceId;
  const historyEntryId = deterministicPlaybackId(
    "history",
    `legacy-history:${session.currentQueueItemId}`,
  ) as PlaybackHistoryEntryId;
  const historyEntry: PlaybackHistoryEntry = {
    historyEntryId,
    playbackInstanceId,
    executionEntryId: selected.executionEntryId,
    originalSource: "context",
    originalRelationId: selected.contextItemId,
    contextId,
    item: selected.item,
    startedSequence: 1,
  };
  return {
    version: PLAYER_SESSION_VERSION,
    planSchemaVersion: PLAYBACK_PLAN_SCHEMA_VERSION,
    current: {
      playbackInstanceId,
      executionEntryId: selected.executionEntryId,
      source: "context",
      relationId: selected.contextItemId,
      contextId,
      historyEntryId,
      item: selected.item,
      startedSequence: 1,
    },
    context: {
      contextId,
      kind: "legacy-session",
      title: "Previous queue",
      entityId: null,
      continuationArtistId: null,
      source: { label: "Previous queue" },
      originalItems,
      playOrder: originalItems.map((item) => item.contextItemId),
      resumeCursor: Math.min(currentIndex + 1, originalItems.length),
      shuffleCycle: 0,
      repeatCycle: 0,
      availabilityRevision: 0,
    },
    explicitQueue: [],
    history: { entries: [historyEntry], cursor: 0 },
    artistRadio: null,
    pendingContinuation: null,
    positionSeconds: session.positionSeconds,
    volume: session.volume,
    muted: session.muted,
    shuffleEnabled: session.shuffleEnabled,
    repeatMode: session.repeatMode,
    continuePlayback: "off",
    sequence: 1,
    revisions: {
      state: 1,
      current: 1,
      context: 1,
      explicitQueue: 0,
      history: 1,
      execution: 1,
      availability: 0,
    },
  };
}

export function playbackPlanFromPlayerSession(
  session: PersistedPlayerSessionV3,
): PlaybackPlanSnapshot {
  return {
    schemaVersion: session.planSchemaVersion,
    current: session.current,
    context: session.context,
    explicitQueue: session.explicitQueue,
    history: session.history,
    artistRadio: session.artistRadio,
    pendingContinuation: session.pendingContinuation,
    shuffleEnabled: session.shuffleEnabled,
    repeatMode: session.repeatMode,
    continuePlayback: session.continuePlayback,
    sequence: session.sequence,
    revisions: session.revisions,
  };
}

export function playerSessionFromPlaybackPlan(
  plan: PlaybackPlanSnapshot,
  playback: PlayerSessionPlaybackSnapshot,
): PersistedPlayerSessionV3 {
  return {
    version: PLAYER_SESSION_VERSION,
    planSchemaVersion: plan.schemaVersion,
    current: plan.current,
    context: plan.context,
    explicitQueue: plan.explicitQueue,
    history: plan.history,
    artistRadio: plan.artistRadio,
    pendingContinuation: plan.pendingContinuation,
    positionSeconds: playback.positionSeconds,
    volume: playback.volume,
    muted: playback.muted,
    shuffleEnabled: plan.shuffleEnabled,
    repeatMode: plan.repeatMode,
    continuePlayback: plan.continuePlayback,
    sequence: plan.sequence,
    revisions: plan.revisions,
  };
}

function deterministicUuid(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function deterministicPlaybackId(
  prefix: PlaybackIdPrefix,
  key: string,
): string {
  return `${prefix}-${deterministicUuid(key)}`;
}

function hashedLegacyQueueId(key: string): string {
  return `queue-${deterministicUuid(key)}`;
}

function generatedEntryId(key: string): string {
  return `entry-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function legacyProjectionOrigin(
  item: PlaybackItemSnapshot,
): PersistedQueueOrigin {
  const { origin } = item;
  if (
    (origin.kind === "folder" ||
      origin.kind === "library" ||
      origin.kind === "legacy") &&
    origin.sourceId &&
    /^[0-9a-f-]{36}$/iu.test(origin.sourceId) &&
    origin.relativePath
  ) {
    const libraryTrackId =
      item.libraryTrackId && /^track-[0-9a-f]{32}$/u.test(item.libraryTrackId)
        ? item.libraryTrackId
        : null;
    return {
      kind: "folders",
      sourceId: origin.sourceId,
      relativePath: origin.relativePath,
      ...(libraryTrackId ? { libraryTrackId } : {}),
      ...(typeof origin.removable === "boolean"
        ? { removable: origin.removable }
        : {}),
      ...(typeof origin.smb === "boolean" ? { smb: origin.smb } : {}),
    };
  }
  if (
    origin.kind === "removable" &&
    origin.sourceId &&
    /^usb-[0-9a-f]{32}$/u.test(origin.sourceId) &&
    origin.relativePath
  )
    return {
      kind: "removable",
      deviceId: origin.sourceId,
      relativePath: origin.relativePath,
      entryId:
        origin.entryId && /^entry-[0-9a-f]{32}$/u.test(origin.entryId)
          ? origin.entryId
          : generatedEntryId(
              `${origin.sourceId}\0${origin.relativePath}\0${item.nativePath}`,
            ),
    };
  if (
    origin.kind === "smb" &&
    origin.sourceId &&
    /^smb-[0-9a-f]{32}$/u.test(origin.sourceId) &&
    origin.relativePath
  )
    return {
      kind: "smb",
      connectionId: origin.sourceId,
      relativePath: origin.relativePath,
      entryId:
        origin.entryId && /^entry-[0-9a-f]{32}$/u.test(origin.entryId)
          ? origin.entryId
          : generatedEntryId(
              `${origin.sourceId}\0${origin.relativePath}\0${item.nativePath}`,
            ),
    };
  return { kind: "direct", nativePath: item.nativePath };
}

/**
 * Best-effort rollback projection for binaries that only understand v2. The
 * order is Current -> forward History -> Explicit Queue -> remaining Context.
 * Occurrence IDs, not paths, are hashed so duplicate paths remain independent
 * queue entries.
 */
export function projectPlayerSessionV2(
  session: PersistedPlayerSessionV3,
): PersistedPlayerSession | null {
  const occurrences: {
    readonly key: string;
    readonly item: PlaybackItemSnapshot;
  }[] = [];
  const seen = new Set<string>();
  const add = (key: string, item: PlaybackItemSnapshot): void => {
    if (seen.has(key)) return;
    seen.add(key);
    occurrences.push({ key, item });
  };
  if (session.current)
    add(`current:${session.current.playbackInstanceId}`, session.current.item);
  for (const entry of session.history.entries.slice(session.history.cursor + 1))
    add(`history:${entry.playbackInstanceId}`, entry.item);
  for (const entry of session.explicitQueue)
    add(`explicit:${entry.playbackInstanceId}`, entry.item);
  if (session.context) {
    const byId = new Map(
      session.context.originalItems.map((entry) => [
        entry.contextItemId,
        entry,
      ]),
    );
    for (const contextItemId of session.context.playOrder.slice(
      session.context.resumeCursor,
    )) {
      if (
        session.current?.source === "context" &&
        session.current.relationId === contextItemId
      )
        continue;
      const entry = byId.get(contextItemId);
      if (entry) add(`context:${entry.contextItemId}`, entry.item);
    }
  }
  if (occurrences.length === 0) return null;
  const queue: PersistedQueueItem[] = occurrences.map(({ key, item }) => ({
    id: hashedLegacyQueueId(key),
    origin: legacyProjectionOrigin(item),
    filename: item.filename,
    displayTitle: item.title,
  }));
  const first = queue[0];
  if (!first) return null;
  return {
    version: 2,
    currentQueueItemId: first.id,
    queue,
    positionSeconds: session.current ? session.positionSeconds : 0,
    volume: session.volume,
    muted: session.muted,
    shuffleEnabled: session.shuffleEnabled,
    repeatMode: session.repeatMode,
  };
}

export function playerSessionConfigPath(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const platformPath = platform === "win32" ? win32 : posix;
  return platformPath.join(
    resolveAppDirectories(platform, environment, home ?? undefined).config,
    "player-session.json",
  );
}

export function playerSessionV3ConfigPath(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const platformPath = platform === "win32" ? win32 : posix;
  return platformPath.join(
    resolveAppDirectories(platform, environment, home ?? undefined).config,
    "player-session-v3.json",
  );
}

async function readText(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, "utf8");
    return text.length <= MAX_SESSION_FILE_CHARACTERS ? text : "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = `${path}.${String(process.pid)}-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class PlayerSessionRepository {
  readonly v3ConfigPath: string;
  private legacyReadOnly = false;
  private v3ReadOnly = false;

  constructor(
    readonly configPath = playerSessionConfigPath(),
    v3ConfigPath = join(dirname(configPath), "player-session-v3.json"),
  ) {
    this.v3ConfigPath = v3ConfigPath;
  }

  /** Legacy v1/v2 API retained until PlayerService integration is complete. */
  async read(): Promise<PersistedPlayerSession | null> {
    const text = await readText(this.configPath);
    if (text === null) return null;
    try {
      const result = parseLegacyDocument(JSON.parse(text) as unknown);
      if (result.status === "valid") return result.value.session;
      if (result.status === "future") {
        this.legacyReadOnly = true;
        return null;
      }
    } catch {
      // Preserved below using the established legacy recovery behavior.
    }
    await this.preserveCorrupt(this.configPath, true);
    return null;
  }

  async write(session: PersistedPlayerSession): Promise<void> {
    if (this.legacyReadOnly)
      throw new Error("A future Player Session is read-only.");
    const parsed = parseLegacyDocument(session);
    if (parsed.status !== "valid")
      throw new Error("Player Session v2 projection is invalid.");
    await atomicWrite(this.configPath, parsed.value.session);
  }

  async clear(): Promise<void> {
    if (this.legacyReadOnly)
      throw new Error("A future Player Session is read-only.");
    await rm(this.configPath, { force: true });
  }

  /**
   * Reads the authoritative sidecar first. Legacy data is migrated in memory
   * and deliberately left on disk as the rollback projection.
   */
  async readPlaybackSession(): Promise<PlayerSessionV3ReadResult> {
    const v3Text = await readText(this.v3ConfigPath);
    let recoveredFromInvalidV3 = false;
    if (v3Text !== null) {
      let parsed: ParsedDocument<PersistedPlayerSessionV3> = {
        status: "invalid",
      };
      try {
        parsed = parseV3Document(JSON.parse(v3Text) as unknown);
      } catch {
        // Invalid JSON is preserved, then the rollback projection is tried.
      }
      if (parsed.status === "valid")
        return { status: "loaded", source: "v3", session: parsed.value };
      if (parsed.status === "future") {
        this.v3ReadOnly = true;
        return {
          status: "future",
          source: "v3",
          version: parsed.version,
        };
      }
      recoveredFromInvalidV3 = true;
      await this.preserveCorrupt(this.v3ConfigPath, false);
    }

    const legacyText = await readText(this.configPath);
    if (legacyText === null)
      return recoveredFromInvalidV3
        ? { status: "invalid", source: "v3" }
        : { status: "empty" };
    let legacy: ParsedDocument<ParsedLegacySession> = { status: "invalid" };
    try {
      legacy = parseLegacyDocument(JSON.parse(legacyText) as unknown);
    } catch {
      // Invalid JSON is retained and copied as evidence below.
    }
    if (legacy.status === "future") {
      this.legacyReadOnly = true;
      return {
        status: "future",
        source: "legacy",
        version: legacy.version,
      };
    }
    if (legacy.status === "invalid") {
      await this.preserveCorrupt(this.configPath, false);
      return { status: "invalid", source: "legacy" };
    }
    return {
      status: "migrated",
      source: legacy.value.sourceVersion === 1 ? "legacy-v1" : "legacy-v2",
      session: migrateLegacyPlayerSession(legacy.value.session),
      legacySession: legacy.value.session,
      recoveredFromInvalidV3,
    };
  }

  /** Writes v3 first, then atomically refreshes the independent v2 rollback file. */
  async writePlaybackSession(
    session: PersistedPlayerSessionV3,
    compatibilityProjection?: PersistedPlayerSession | null,
  ): Promise<void> {
    if (this.v3ReadOnly || this.legacyReadOnly)
      throw new Error("A future Player Session is read-only.");
    const parsed = parseV3Document(session);
    if (parsed.status !== "valid")
      throw new Error("Player Session v3 snapshot is invalid.");
    const compatibility =
      compatibilityProjection === undefined
        ? projectPlayerSessionV2(parsed.value)
        : compatibilityProjection;
    if (compatibility) {
      const parsedCompatibility = parseLegacyDocument(compatibility);
      if (parsedCompatibility.status !== "valid")
        throw new Error("Player Session v2 projection is invalid.");
    }

    await atomicWrite(this.v3ConfigPath, parsed.value);
    if (compatibility) await atomicWrite(this.configPath, compatibility);
    else await rm(this.configPath, { force: true });
  }

  async clearPlaybackSession(): Promise<void> {
    if (this.v3ReadOnly || this.legacyReadOnly)
      throw new Error("A future Player Session is read-only.");
    await rm(this.v3ConfigPath, { force: true });
    await rm(this.configPath, { force: true });
  }

  private async preserveCorrupt(
    path: string,
    removeOriginal: boolean,
  ): Promise<void> {
    const backup = `${path}.corrupt-${String(Date.now())}-${randomUUID()}`;
    await copyFile(path, backup).catch(() => undefined);
    if (removeOriginal) await rm(path, { force: true }).catch(() => undefined);
  }
}
