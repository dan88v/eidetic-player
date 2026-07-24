import type {
  SmbAuthMode,
  SmbConnectionState,
  SmbErrorCode,
} from "../../../../packages/shared/src/smb.js";

export interface SmbConnectionRecord {
  readonly id: string;
  readonly displayName: string;
  readonly server: string;
  readonly share: string;
  readonly authMode: SmbAuthMode;
  readonly username?: string;
  readonly domain?: string;
  readonly credentialReference?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SmbCredential {
  readonly username: string;
  readonly password: string;
  readonly domain?: string;
  readonly filePath?: string;
}

export interface SmbRuntimeState {
  readonly state: SmbConnectionState;
  readonly readable: boolean;
  readonly retryable: boolean;
  readonly lastError?: SmbErrorCode;
  readonly connectedAt?: string;
  readonly root?: string;
}

export interface SmbAdapterConnection {
  readonly root: string;
}

export class SmbError extends Error {
  constructor(
    readonly code: SmbErrorCode | "invalid-request" | "duplicate",
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = "SmbError";
  }
}
