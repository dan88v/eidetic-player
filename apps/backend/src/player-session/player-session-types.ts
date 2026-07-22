export type PersistedQueueOrigin =
  | {
      readonly kind: "folders";
      readonly sourceId: string;
      readonly relativePath: string;
      readonly libraryTrackId?: string;
    }
  | {
      readonly kind: "direct";
      readonly nativePath: string;
    };

export interface PersistedQueueItem {
  readonly id: string;
  readonly origin: PersistedQueueOrigin;
  readonly filename: string;
  readonly displayTitle: string;
}

export interface PersistedPlayerSession {
  readonly version: 1;
  readonly currentQueueItemId: string;
  readonly queue: readonly PersistedQueueItem[];
}

export interface PlayerSessionSnapshot {
  readonly currentQueueItemId: string | null;
  readonly queue: readonly PersistedQueueItem[];
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
