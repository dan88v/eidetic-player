import type {
  ArtistRadioSnapshot,
  ContinuePlaybackPolicy,
  CurrentPlaybackItem,
  ExplicitQueueEntry,
  PendingContinuation,
  PlaybackContextSnapshot,
  PlaybackHistorySnapshot,
  PlaybackPlanRevisions,
  PlaybackPlanSnapshot,
  PlaybackRepeatMode,
} from "../playback-plan/playback-plan-types.js";
import type { RepeatMode } from "../../../../packages/shared/src/player.js";

export type PersistedQueueOrigin =
  | {
      readonly kind: "folders";
      readonly sourceId: string;
      readonly relativePath: string;
      readonly libraryTrackId?: string;
      readonly removable?: boolean;
      readonly smb?: boolean;
    }
  | {
      readonly kind: "direct";
      readonly nativePath: string;
    }
  | {
      readonly kind: "removable";
      readonly deviceId: string;
      readonly relativePath: string;
      readonly entryId: string;
    }
  | {
      readonly kind: "smb";
      readonly connectionId: string;
      readonly relativePath: string;
      readonly entryId: string;
    };

export interface PersistedQueueItem {
  readonly id: string;
  readonly origin: PersistedQueueOrigin;
  readonly filename: string;
  readonly displayTitle: string;
}

export interface PersistedPlayerSession {
  readonly version: 2;
  readonly currentQueueItemId: string;
  readonly queue: readonly PersistedQueueItem[];
  readonly positionSeconds: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: RepeatMode;
}

export const PLAYER_SESSION_VERSION = 3 as const;

/**
 * The current session is intentionally projected as independent top-level
 * sections. A malformed optional section can therefore be discarded without
 * making the remaining playback state unrestorable.
 */
export interface PersistedPlayerSessionV3 {
  readonly version: typeof PLAYER_SESSION_VERSION;
  readonly planSchemaVersion: PlaybackPlanSnapshot["schemaVersion"];
  readonly current: CurrentPlaybackItem | null;
  readonly context: PlaybackContextSnapshot | null;
  readonly explicitQueue: readonly ExplicitQueueEntry[];
  readonly history: PlaybackHistorySnapshot;
  readonly artistRadio: ArtistRadioSnapshot | null;
  readonly pendingContinuation: PendingContinuation | null;
  readonly positionSeconds: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: PlaybackRepeatMode;
  readonly continuePlayback: ContinuePlaybackPolicy;
  readonly sequence: number;
  readonly revisions: PlaybackPlanRevisions;
}

export interface PlayerSessionPlaybackSnapshot {
  readonly positionSeconds: number;
  readonly volume: number;
  readonly muted: boolean;
}

export type PlayerSessionV3ReadResult =
  | {
      readonly status: "loaded";
      readonly source: "v3";
      readonly session: PersistedPlayerSessionV3;
    }
  | {
      readonly status: "migrated";
      readonly source: "legacy-v1" | "legacy-v2";
      readonly session: PersistedPlayerSessionV3;
      /** Kept so the integration layer can resolve legacy logical origins. */
      readonly legacySession: PersistedPlayerSession;
      readonly recoveredFromInvalidV3: boolean;
    }
  | {
      readonly status: "empty";
    }
  | {
      readonly status: "invalid";
      readonly source: "v3" | "legacy";
    }
  | {
      readonly status: "future";
      readonly source: "v3" | "legacy";
      readonly version: number;
    };

export interface PlayerSessionSnapshot {
  readonly currentQueueItemId: string | null;
  readonly queue: readonly PersistedQueueItem[];
  readonly positionSeconds: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: RepeatMode;
}

export interface ResolvedQueueItem {
  readonly id: string;
  readonly path: string;
  readonly origin: PersistedQueueOrigin;
}

export interface PlayerRestoreResult {
  readonly status: "empty" | "restored";
  readonly savedCount: number;
  readonly restoredCount: number;
  readonly discardedCount: number;
  readonly readMilliseconds: number;
  readonly verificationMilliseconds: number;
  readonly prepareMilliseconds: number;
}
