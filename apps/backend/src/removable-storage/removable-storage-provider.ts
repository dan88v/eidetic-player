export interface RemovableVolumeCandidate {
  readonly stableIdentity: string;
  readonly nativeRoot: string;
  readonly displayName: string;
  readonly readable: boolean;
  readonly readOnly: boolean;
  readonly filesystemType?: string;
  readonly capacityBytes?: number;
  readonly availableBytes?: number;
}

export interface RemovableStorageProvider {
  readonly platform: "win32" | "linux" | "fixture";
  enumerate(): Promise<readonly RemovableVolumeCandidate[]>;
  close(): Promise<void>;
}
