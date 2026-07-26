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
import type { RepeatMode } from "../../../../packages/shared/src/player.js";
