export type PlayerStatus =
  | "unavailable"
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "stopped"
  | "error";

export type RepeatMode = "off" | "all" | "one";

export interface ArtworkRef {
  readonly id: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly sourceType: "embedded" | "folder";
  readonly revision: string;
}

export interface PlayerTrack {
  readonly path: string;
  readonly filename: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly artists: readonly string[];
  readonly albumArtist: string | null;
  readonly trackNumber: number | null;
  readonly trackTotal: number | null;
  readonly discNumber: number | null;
  readonly discTotal: number | null;
  readonly year: number | null;
  readonly genre: readonly string[];
  readonly durationSeconds: number;
  readonly format: string;
  readonly codec: string | null;
  readonly sampleRate: number | null;
  readonly bitDepth: number | null;
  readonly bitrate: number | null;
  readonly lossless: boolean | null;
  readonly container: string | null;
  readonly artwork: ArtworkRef | null;
  readonly source: "Local File" | "USB Storage" | "Network Share";
}

export interface QueueItem {
  readonly id: string;
  /** Public occurrence identity; `id` may remain the technical MPV entry ID. */
  readonly playbackInstanceId?: string;
  readonly index: number;
  readonly path: string;
  readonly filename: string;
  readonly displayTitle: string;
  readonly durationSeconds?: number | undefined;
  readonly artwork: ArtworkRef | null;
  readonly isCurrent: boolean;
  readonly available?: boolean;
  readonly libraryTrackId?: string;
}

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

export type CurrentPlaybackSource =
  "context" | "explicit-queue" | "history" | "continuation";

/** Atomic policy applied when a new playback Context replaces the current one. */
export interface PlaybackContextQueueDecision {
  readonly explicitQueuePolicy: "preserve" | "clear";
  readonly expectedQueueRevision: number;
}

/** Path-free playback occurrence exposed to local and Remote clients. */
export interface PublicPlaybackItem {
  readonly filename: string;
  readonly displayTitle: string;
  readonly artist: string | null;
  readonly album: string | null;
  readonly durationSeconds?: number | undefined;
  readonly artwork: ArtworkRef | null;
  readonly available: boolean;
  readonly libraryTrackId: string | null;
}

export interface CurrentPlaybackView {
  readonly playbackInstanceId: string;
  readonly source: CurrentPlaybackSource;
  readonly relationId: string;
  readonly contextId: string | null;
  readonly historyEntryId: string | null;
  readonly startedSequence: number;
  readonly item: PublicPlaybackItem;
}

export interface ExplicitQueueItem {
  readonly explicitQueueEntryId: string;
  readonly playbackInstanceId: string;
  readonly index: number;
  readonly item: PublicPlaybackItem;
}

export interface PlaybackContextSummary {
  readonly contextId: string;
  readonly kind: PlaybackContextKind;
  readonly entityId: string | null;
  readonly title: string;
  readonly sourceLabel: string;
  readonly nextItem: PublicPlaybackItem | null;
  readonly remainingCount: number;
  readonly totalCount: number;
  readonly cycle: number;
}

export interface PlaybackHistoryCapabilities {
  readonly entryCount: number;
  readonly cursor: number;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

export interface PlaybackContinuationSummary {
  readonly mode: "off" | "same-artist";
  readonly artistId: string | null;
  readonly artistName: string | null;
  readonly active: boolean;
}

/** Scalar delta used on the existing player SSE between structural snapshots. */
export interface PlayerProgressState {
  readonly playerSessionId: string;
  readonly trackTransitionId: number;
  readonly status: PlayerStatus;
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  readonly paused: boolean;
  readonly volume: number;
  readonly muted: boolean;
  readonly audioBufferSeconds?: number;
}

export interface PlayerErrorState {
  readonly code: string;
  readonly message: string;
}

export type PlayerCommandPhase =
  "pending" | "acknowledged" | "confirmed" | "failed";

export interface PlayerCommandRequestMetadata {
  readonly clientSessionId?: string;
  readonly intentId: number;
  readonly requestedAtMilliseconds: number;
}

export interface PlayerLevelCommandState {
  readonly generation: number;
  readonly clientSessionId: string | null;
  readonly clientIntentId: number;
  readonly phase: PlayerCommandPhase;
  readonly target: number;
}

export interface PlayerBooleanCommandState {
  readonly generation: number;
  readonly clientSessionId: string | null;
  readonly clientIntentId: number;
  readonly phase: PlayerCommandPhase;
  readonly target: boolean;
}

export interface PlayerNavigationCommandState {
  readonly generation: number;
  readonly clientSessionId: string | null;
  readonly clientIntentId: number;
  readonly phase: PlayerCommandPhase;
  readonly targetQueueItemId: string | null;
}

export interface PlayerCommandState {
  readonly volume: PlayerLevelCommandState;
  readonly mute: PlayerBooleanCommandState;
  readonly transport: PlayerBooleanCommandState;
  readonly navigation: PlayerNavigationCommandState;
  readonly failureRevision: number;
}

export interface PlayerState {
  readonly playerSessionId: string;
  readonly trackTransitionId: number;
  readonly status: PlayerStatus;
  readonly mpvAvailable: boolean;
  readonly mpvVersion: string | null;
  readonly currentTrack: PlayerTrack | null;
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  readonly paused: boolean;
  readonly volume: number;
  readonly muted: boolean;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: RepeatMode;
  readonly currentQueueIndex: number;
  readonly queue: readonly QueueItem[];
  readonly queueRevision: number;
  /** Authoritative path-free playback model. */
  readonly currentPlayback?: CurrentPlaybackView | null;
  readonly explicitQueue?: readonly ExplicitQueueItem[];
  readonly playbackContext?: PlaybackContextSummary | null;
  readonly playbackHistory?: PlaybackHistoryCapabilities;
  readonly playbackContinuation?: PlaybackContinuationSummary;
  readonly contextRevision?: number;
  /** Monotonic public Current emission revision; independent from MPV. */
  readonly playbackPlanRevision?: number;
  /** Authoritative capability for a manual Next command. */
  readonly canGoNext?: boolean;
  readonly audioDevice: string;
  readonly audioBufferSeconds?: number;
  readonly commands?: PlayerCommandState;
  readonly error: PlayerErrorState | null;
}

export interface ApiSuccess<T = undefined> {
  readonly ok: true;
  readonly data?: T;
}

export interface ApiFailure {
  readonly ok: false;
  readonly error: PlayerErrorState;
}

export type ApiResponse<T = undefined> = ApiSuccess<T> | ApiFailure;
