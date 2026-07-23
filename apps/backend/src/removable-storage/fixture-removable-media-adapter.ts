import {
  RemovableMediaOperationError,
  type RemovableMediaAdapter,
  type RemovableMediaCapabilities,
  type RemovableMediaFailureCode,
  type RemovableMediaTarget,
} from "./removable-media-adapter.js";

export interface FixtureRemovableMediaOptions {
  readonly capabilities?: Partial<RemovableMediaCapabilities>;
  readonly mountFailure?: RemovableMediaFailureCode;
  readonly removalFailure?: RemovableMediaFailureCode;
  readonly removalFailureAfterUnmounts?: number;
  readonly waitForAbort?: boolean;
}

export class FixtureRemovableMediaAdapter implements RemovableMediaAdapter {
  readonly platform = "fixture" as const;
  readonly calls: {
    readonly kind: "mount" | "unmount" | "eject";
    readonly reference: string;
  }[] = [];
  activeOperations = 0;
  maximumConcurrentOperations = 0;
  closed = false;

  constructor(private options: FixtureRemovableMediaOptions = {}) {}

  configure(options: FixtureRemovableMediaOptions): void {
    this.options = options;
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  capabilities(target: RemovableMediaTarget): RemovableMediaCapabilities {
    if (target.system || target.boot)
      return {
        canMount: false,
        canUnmount: false,
        canEject: false,
        canSafelyRemove: false,
      };
    return {
      canMount: this.options.capabilities?.canMount ?? true,
      canUnmount: this.options.capabilities?.canUnmount ?? true,
      canEject: this.options.capabilities?.canEject ?? true,
      canSafelyRemove: this.options.capabilities?.canSafelyRemove ?? true,
    };
  }

  async mount(
    target: RemovableMediaTarget,
    signal: AbortSignal,
  ): Promise<void> {
    await this.operation(async () => {
      await this.maybeWaitForAbort(signal);
      this.throwIfAborted(signal);
      this.calls.push({ kind: "mount", reference: target.volume });
      if (this.options.mountFailure)
        throw this.failure(this.options.mountFailure);
    });
  }

  async safelyRemove(
    targets: readonly RemovableMediaTarget[],
    signal: AbortSignal,
    onState: (state: "unmounting" | "ejecting") => void,
  ): Promise<void> {
    await this.operation(async () => {
      await this.maybeWaitForAbort(signal);
      onState("unmounting");
      let unmounted = 0;
      for (const target of targets
        .filter((candidate) => candidate.mounted)
        .sort((left, right) => left.volume.localeCompare(right.volume))) {
        this.throwIfAborted(signal);
        this.calls.push({ kind: "unmount", reference: target.volume });
        unmounted += 1;
        if (
          this.options.removalFailure &&
          unmounted >= (this.options.removalFailureAfterUnmounts ?? 1)
        )
          throw this.failure(this.options.removalFailure);
      }
      if (this.options.removalFailure && unmounted === 0)
        throw this.failure(this.options.removalFailure);
      onState("ejecting");
      this.calls.push({
        kind: "eject",
        reference: targets[0]?.physicalDevice ?? "",
      });
    });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  private async operation(run: () => Promise<void>): Promise<void> {
    this.activeOperations += 1;
    this.maximumConcurrentOperations = Math.max(
      this.maximumConcurrentOperations,
      this.activeOperations,
    );
    try {
      await Promise.resolve();
      await run();
    } finally {
      this.activeOperations -= 1;
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted)
      throw new RemovableMediaOperationError(
        "device-not-found",
        "USB storage is no longer available.",
      );
  }

  private async maybeWaitForAbort(signal: AbortSignal): Promise<void> {
    if (!this.options.waitForAbort) return;
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
    });
  }

  private failure(
    code: RemovableMediaFailureCode,
  ): RemovableMediaOperationError {
    const messages: Record<RemovableMediaFailureCode, string> = {
      "device-busy": "Device is busy.",
      "authorization-required": "Permission required.",
      "device-not-found": "USB storage is no longer available.",
      unsupported: "Safe removal is not supported.",
      timeout: "USB operation timed out.",
      failed: "Unable to safely remove USB storage.",
    };
    return new RemovableMediaOperationError(code, messages[code]);
  }
}
