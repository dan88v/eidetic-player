export const PLAYBACK_PLAN_SCHEMA_VERSION = 1 as const;
export const MAX_PLAYBACK_CONTEXT_ITEMS = 10_000;
export const MAX_EXPLICIT_QUEUE_ITEMS = 10_000;
export const MAX_PLAYBACK_HISTORY_ITEMS = 100;
export const DEFAULT_EXECUTION_PLAN_LIMIT = 128;

export type PlaybackContextKind =
  | "album"
  | "artist"
  | "playlist"
  | "folder"
  | "direct-folder"
  | "favorites"
  | "recently-played"
  | "most-played"
  | "search"
  | "tracks"
  | "legacy-session"
  | "artist-radio";

export type PlaybackRepeatMode = "off" | "all" | "one";
export type ContinuePlaybackPolicy = "off" | "same-artist";
export type PlaybackAvailability = "available" | "unavailable";

export type PlaybackIdPrefix =
  | "playback-item"
  | "explicit"
  | "context"
  | "context-item"
  | "history"
  | "execution"
  | "continuation";

export type PlaybackInstanceId = `playback-item-${string}`;
export type ExplicitQueueEntryId = `explicit-${string}`;
export type PlaybackContextId = `context-${string}`;
export type PlaybackContextItemId = `context-item-${string}`;
export type PlaybackHistoryEntryId = `history-${string}`;
export type PlaybackExecutionEntryId = `execution-${string}`;
export type PlaybackContinuationRequestId = `continuation-${string}`;

export interface PlaybackItemOrigin {
  readonly kind:
    "library" | "folder" | "direct" | "removable" | "smb" | "legacy";
  readonly sourceId?: string;
  readonly relativePath?: string;
  /** Stable removable/SMB directory-entry identity when one exists. */
  readonly entryId?: string;
  /** Folder-library source capability flags, preserved across sessions. */
  readonly removable?: boolean;
  readonly smb?: boolean;
}

export interface PlaybackItemSeed {
  readonly nativePath: string;
  readonly filename: string;
  readonly title: string;
  readonly artist?: string | null;
  readonly album?: string | null;
  readonly durationSeconds?: number | null;
  readonly libraryTrackId?: string | null;
  /** Stable indexed Library artist identity for this specific track. */
  readonly primaryArtistId?: string | null;
  readonly availability?: PlaybackAvailability;
  readonly origin: PlaybackItemOrigin;
}

export interface PlaybackItemSnapshot {
  readonly nativePath: string;
  readonly filename: string;
  readonly title: string;
  readonly artist: string | null;
  readonly album: string | null;
  readonly durationSeconds: number | null;
  readonly libraryTrackId: string | null;
  /** Optional for backward-compatible session restore. */
  readonly primaryArtistId?: string | null;
  readonly availability: PlaybackAvailability;
  readonly origin: PlaybackItemOrigin;
}

export interface PlaybackContextSourceSummary {
  readonly label: string;
  readonly sourceId?: string;
  readonly relativePath?: string;
}

export interface PlaybackContextSeed {
  readonly kind: PlaybackContextKind;
  readonly title: string;
  readonly entityId?: string | null;
  /** Stable Library artist identity selected by the resolver. */
  readonly continuationArtistId?: string | null;
  readonly source: PlaybackContextSourceSummary;
  readonly items: readonly PlaybackItemSeed[];
  readonly selectedIndex?: number;
}

export interface PlaybackContextItem {
  readonly contextItemId: PlaybackContextItemId;
  readonly executionEntryId: PlaybackExecutionEntryId;
  readonly item: PlaybackItemSnapshot;
}

export interface PlaybackContextSnapshot {
  readonly contextId: PlaybackContextId;
  readonly kind: PlaybackContextKind;
  readonly title: string;
  readonly entityId: string | null;
  readonly continuationArtistId: string | null;
  readonly source: PlaybackContextSourceSummary;
  readonly originalItems: readonly PlaybackContextItem[];
  readonly playOrder: readonly PlaybackContextItemId[];
  /** Index of the next unconsumed item in playOrder. */
  readonly resumeCursor: number;
  readonly shuffleCycle: number;
  readonly repeatCycle: number;
  readonly availabilityRevision: number;
}

export interface ExplicitQueueEntry {
  readonly explicitQueueEntryId: ExplicitQueueEntryId;
  /** Stable while the future entry moves into Current. */
  readonly playbackInstanceId: PlaybackInstanceId;
  readonly executionEntryId: PlaybackExecutionEntryId;
  readonly item: PlaybackItemSnapshot;
  readonly addedSequence: number;
}

export type CurrentPlaybackSource =
  "context" | "explicit-queue" | "history" | "continuation";

export interface CurrentPlaybackItem {
  readonly playbackInstanceId: PlaybackInstanceId;
  readonly executionEntryId: PlaybackExecutionEntryId;
  readonly source: CurrentPlaybackSource;
  readonly relationId:
    PlaybackContextItemId | ExplicitQueueEntryId | PlaybackHistoryEntryId;
  readonly contextId: PlaybackContextId | null;
  readonly historyEntryId: PlaybackHistoryEntryId | null;
  readonly item: PlaybackItemSnapshot;
  readonly startedSequence: number;
}

export interface PlaybackHistoryEntry {
  readonly historyEntryId: PlaybackHistoryEntryId;
  readonly playbackInstanceId: PlaybackInstanceId;
  readonly executionEntryId: PlaybackExecutionEntryId;
  readonly originalSource: Exclude<CurrentPlaybackSource, "history">;
  readonly originalRelationId: string;
  readonly contextId: PlaybackContextId | null;
  readonly item: PlaybackItemSnapshot;
  readonly startedSequence: number;
}

export interface PlaybackHistorySnapshot {
  readonly entries: readonly PlaybackHistoryEntry[];
  readonly cursor: number;
}

export interface ArtistRadioSnapshot {
  readonly contextId: PlaybackContextId;
  readonly artistId: string;
  readonly bagCycle: number;
}

export interface PendingContinuation {
  readonly requestId: PlaybackContinuationRequestId;
  readonly artistId: string;
  readonly previousLibraryTrackId: string;
  readonly recentLibraryTrackIds: readonly string[];
}

export interface PlaybackPlanRevisions {
  readonly state: number;
  readonly current: number;
  readonly context: number;
  readonly explicitQueue: number;
  readonly history: number;
  readonly execution: number;
  readonly availability: number;
}

export interface PlaybackPlanSnapshot {
  readonly schemaVersion: typeof PLAYBACK_PLAN_SCHEMA_VERSION;
  readonly current: CurrentPlaybackItem | null;
  readonly context: PlaybackContextSnapshot | null;
  readonly explicitQueue: readonly ExplicitQueueEntry[];
  readonly history: PlaybackHistorySnapshot;
  readonly artistRadio: ArtistRadioSnapshot | null;
  readonly pendingContinuation: PendingContinuation | null;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: PlaybackRepeatMode;
  readonly continuePlayback: ContinuePlaybackPolicy;
  readonly sequence: number;
  readonly revisions: PlaybackPlanRevisions;
}

export type PlaybackStartReason =
  | "context-selected"
  | "context-resume"
  | "explicit-queue"
  | "explicit-selected"
  | "history-previous"
  | "history-forward"
  | "repeat-one"
  | "repeat-all"
  | "artist-radio";

export type PlaybackStopReason =
  | "no-future-item"
  | "context-empty"
  | "no-continuation-identity"
  | "no-continuation-candidate";

export type PlaybackDecision =
  | {
      readonly kind: "start";
      readonly reason: PlaybackStartReason;
      readonly current: CurrentPlaybackItem;
    }
  | {
      readonly kind: "restart-current";
      readonly playbackInstanceId: PlaybackInstanceId;
    }
  | {
      readonly kind: "continuation-needed";
      readonly request: PendingContinuation;
    }
  | { readonly kind: "stop"; readonly reason: PlaybackStopReason }
  | {
      readonly kind: "none";
      readonly reason: "already-playing" | "history-start" | "not-found";
    };

export interface PlaybackExecutionPlanEntry {
  readonly executionEntryId: PlaybackExecutionEntryId;
  readonly source: CurrentPlaybackSource;
  readonly relationId: string;
  readonly playbackInstanceId: PlaybackInstanceId | null;
  readonly item: PlaybackItemSnapshot;
}

export interface PlaybackExecutionPlanProjection {
  readonly revision: number;
  readonly current: PlaybackExecutionPlanEntry | null;
  readonly future: readonly PlaybackExecutionPlanEntry[];
  readonly hiddenEntryCount: number;
  readonly truncated: boolean;
  readonly boundary:
    "repeat-one" | "repeat-all-context" | "same-artist" | "stop";
}

export interface PlaybackPlannerOptions {
  readonly random?: () => number;
  readonly idFactory?: (prefix: PlaybackIdPrefix) => string;
  readonly executionPlanLimit?: number;
  readonly recentHistoryAvoidance?: number;
}
