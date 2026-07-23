export interface RemovableMediaTarget {
  readonly physicalIdentity: string;
  readonly stableVolumeIdentity: string;
  readonly physicalDevice: string;
  readonly volume: string;
  readonly mounted: boolean;
  readonly system: boolean;
  readonly boot: boolean;
}

export interface RemovableMediaCapabilities {
  readonly canMount: boolean;
  readonly canUnmount: boolean;
  readonly canEject: boolean;
  readonly canSafelyRemove: boolean;
}

export type RemovableMediaFailureCode =
  | "device-busy"
  | "authorization-required"
  | "device-not-found"
  | "unsupported"
  | "timeout"
  | "failed";

export class RemovableMediaOperationError extends Error {
  constructor(
    readonly code: RemovableMediaFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "RemovableMediaOperationError";
  }
}

export interface RemovableMediaAdapter {
  readonly platform: "win32" | "linux" | "fixture";
  start(): Promise<void>;
  capabilities(target: RemovableMediaTarget): RemovableMediaCapabilities;
  mount(target: RemovableMediaTarget, signal: AbortSignal): Promise<void>;
  safelyRemove(
    targets: readonly RemovableMediaTarget[],
    signal: AbortSignal,
    onState: (state: "unmounting" | "ejecting") => void,
  ): Promise<void>;
  close(): Promise<void>;
}

export const noRemovableMediaCapabilities: RemovableMediaCapabilities = {
  canMount: false,
  canUnmount: false,
  canEject: false,
  canSafelyRemove: false,
};
