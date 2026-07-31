import type { AudioOutputStatus } from "./audio-output.js";
import type { IndexedLibrarySummary, LibrarySource } from "./library.js";
import type { PlayerState, PlayerTrack, QueueItem } from "./player.js";

export const REMOTE_ACCESS_PORT = 8080;
export const REMOTE_ACCESS_MAX_DEVICES = 8;
export const REMOTE_ACCESS_DEVICE_INACTIVITY_DAYS = 90;

export type RemoteAccessStatus =
  "unavailable" | "disabled" | "starting" | "listening" | "error";

export interface RemoteAccessDevice {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
}

export interface RemoteAccessPairingState {
  readonly code: string;
  readonly displayCode: string;
  readonly expiresAt: string;
  readonly attemptsRemaining: number;
}

export interface RemoteAccessState {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly status: RemoteAccessStatus;
  readonly reasonCode: "port-unavailable" | "listener-failed" | null;
  readonly addresses: readonly string[];
  readonly hostnameAddress: string | null;
  readonly pairing: RemoteAccessPairingState | null;
  readonly devices: readonly RemoteAccessDevice[];
  readonly securityNotice: string;
  readonly readOnly: boolean;
  readonly revision: number;
}

export interface RemotePairRequest {
  readonly code: string;
  readonly deviceName: string;
}

export interface RemoteCommandMetadata {
  readonly clientSessionId: string;
  readonly intentId: number;
}

export type RemotePlayerTrack = Omit<PlayerTrack, "path">;
export type RemoteQueueItem = Omit<QueueItem, "path">;
export type RemotePlayerState = Pick<
  PlayerState,
  | "trackTransitionId"
  | "status"
  | "mpvAvailable"
  | "positionSeconds"
  | "durationSeconds"
  | "paused"
  | "volume"
  | "muted"
  | "shuffleEnabled"
  | "repeatMode"
  | "currentQueueIndex"
  | "queueRevision"
  | "error"
> & {
  readonly currentTrack: RemotePlayerTrack | null;
  readonly queue: readonly RemoteQueueItem[];
};

export interface RemoteAudioOutputState {
  readonly mpvAvailable: boolean;
  readonly status: AudioOutputStatus;
  readonly currentOutput: string;
  readonly revision: number;
}

export interface RemoteBootstrap {
  readonly device: RemoteAccessDevice;
  readonly buildId: string;
  readonly player: RemotePlayerState;
  readonly audioOutput: RemoteAudioOutputState;
  readonly outputLevelMode: "fixed" | "variable";
  readonly maximumSoftwareVolume: number;
  readonly sources: readonly LibrarySource[];
  readonly library: IndexedLibrarySummary;
  readonly capabilities: {
    readonly player: boolean;
    readonly queue: true;
    readonly library: true;
    readonly browse: true;
    readonly wakeDisplay: boolean;
  };
  readonly csrfToken: string;
  readonly eventRevision: number;
}

export type RemoteEventName =
  | "snapshot"
  | "player"
  | "queue"
  | "audio-output"
  | "source-availability"
  | "library-scan"
  | "library-invalidated"
  | "connection";

export interface RemoteEventEnvelope<T = unknown> {
  readonly revision: number;
  readonly type: RemoteEventName;
  readonly data: T;
}
