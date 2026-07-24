export type SmbAuthMode = "account" | "guest";

export type SmbConnectionState =
  | "connecting"
  | "connected"
  | "offline"
  | "authentication-required"
  | "permission-required"
  | "mount-failed"
  | "unsupported";

export type SmbErrorCode =
  | "authentication-required"
  | "credential-conflict"
  | "host-not-found"
  | "share-not-found"
  | "access-denied"
  | "network-unavailable"
  | "permission-required"
  | "timeout"
  | "unsupported"
  | "generic-failure";

export interface SmbConnection {
  readonly id: string;
  readonly displayName: string;
  readonly server: string;
  readonly share: string;
  readonly authMode: SmbAuthMode;
  readonly username?: string;
  readonly domain?: string;
  readonly state: SmbConnectionState;
  readonly readable: boolean;
  readonly retryable: boolean;
  readonly lastError?: SmbErrorCode;
  readonly connectedAt?: string;
}

export interface SmbSnapshot {
  readonly revision: number;
  readonly configuredCount: number;
  readonly connectedCount: number;
  readonly connectingCount: number;
  readonly unavailableCount: number;
  readonly connections: readonly SmbConnection[];
}

export interface AddSmbConnectionRequest {
  readonly displayName: string;
  readonly server: string;
  readonly share: string;
  readonly authMode: SmbAuthMode;
  readonly username?: string;
  readonly password?: string;
  readonly domain?: string;
}

export interface EditSmbConnectionRequest {
  readonly displayName: string;
  readonly authMode: SmbAuthMode;
  readonly username?: string;
  readonly password?: string;
  readonly domain?: string;
}

export const emptySmbSnapshot: SmbSnapshot = {
  revision: 0,
  configuredCount: 0,
  connectedCount: 0,
  connectingCount: 0,
  unavailableCount: 0,
  connections: [],
};
