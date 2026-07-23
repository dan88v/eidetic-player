export interface RemovableVolumeCandidate {
  readonly stableIdentity: string;
  readonly physicalIdentity?: string;
  readonly nativeRoot?: string;
  readonly displayName: string;
  readonly readable: boolean;
  readonly readOnly: boolean;
  readonly mounted?: boolean;
  readonly system?: boolean;
  readonly boot?: boolean;
  readonly operationReference?: {
    readonly physicalDevice: string;
    readonly volume: string;
  };
  readonly filesystemType?: string;
  readonly capacityBytes?: number;
  readonly availableBytes?: number;
}

export interface RemovableStorageProvider {
  readonly platform: "win32" | "linux" | "fixture";
  enumerate(): Promise<readonly RemovableVolumeCandidate[]>;
  close(): Promise<void>;
}
