import type {
  IndexedLibrarySnapshot,
  LibraryScanProgress,
  LibraryScanStatus,
} from "../../../../packages/shared/src/library.js";
import type { NormalizedMetadata } from "../metadata/types.js";

export interface LibraryDatabaseDiagnostics {
  readonly path: string;
  readonly sqliteVersion: string;
  readonly schemaVersion: number;
  readonly journalMode: string;
  readonly synchronous: number;
  readonly foreignKeys: boolean;
  readonly busyTimeoutMilliseconds: number;
  readonly openedInMilliseconds: number;
  readonly migrationMilliseconds: number;
  readonly recoveredCorruptPath: string | null;
}

export interface IndexedTrackIdentity {
  readonly id: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly available: boolean;
}

export interface IndexedTrackInput {
  readonly id: string;
  readonly sourceId: string;
  readonly relativePath: string;
  readonly filename: string;
  readonly extension: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly generation: number;
  readonly seenAt: string;
  readonly metadata: NormalizedMetadata;
  readonly metadataState: "parsed" | "failed";
  readonly metadataErrorCode: string | null;
  readonly artworkAvailable: boolean;
}

export interface ScanCounters {
  filesDiscovered: number;
  filesProcessed: number;
  filesUnchanged: number;
  filesNew: number;
  filesModified: number;
  filesUnavailable: number;
  filesFailed: number;
  totalFiles: number | null;
}

export interface ScanRunRecord extends ScanCounters {
  readonly scanId: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly generation: number;
  readonly status: LibraryScanStatus;
  readonly startedAt: string | null;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
}

export interface LibraryScanResult {
  readonly progress: LibraryScanProgress;
  readonly durationMilliseconds: number;
  readonly maximumTransactionMilliseconds: number;
  readonly averageTransactionMilliseconds: number;
  readonly transactionCount: number;
  readonly metadataParses: number;
}

export interface LibraryContextTrack {
  readonly id: string;
  readonly sourceId: string;
  readonly relativePath: string;
}

export type LibrarySnapshotListener = (
  snapshot: IndexedLibrarySnapshot,
) => void;
