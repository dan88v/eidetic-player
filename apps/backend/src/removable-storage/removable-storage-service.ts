import { createHash } from "node:crypto";
import type {
  RemovableDevice,
  RemovableDeviceListResponse,
  RemovableDeviceUsage,
  RemovableOperationResponse,
  RemovableOperationStatus,
} from "../../../../packages/shared/src/library.js";
import { FilesystemError } from "../filesystem/filesystem-errors.js";
import type { FilesystemProvider } from "../filesystem/filesystem-provider.js";
import type {
  DirectorySourceCatalog,
  ResolvedSource,
} from "../filesystem/filesystem-types.js";
import { PathService } from "../filesystem/path-service.js";
import { LinuxRemovableStorageProvider } from "./linux-removable-storage-provider.js";
import { LinuxRemovableMediaAdapter } from "./linux-removable-media-adapter.js";
import {
  noRemovableMediaCapabilities,
  RemovableMediaOperationError,
  type RemovableMediaAdapter,
  type RemovableMediaTarget,
} from "./removable-media-adapter.js";
import type {
  RemovableStorageProvider,
  RemovableVolumeCandidate,
} from "./removable-storage-provider.js";
import { WindowsRemovableStorageProvider } from "./windows-removable-storage-provider.js";
import { WindowsRemovableMediaAdapter } from "./windows-removable-media-adapter.js";

export interface RemovableStorageChange {
  readonly snapshot: RemovableDeviceListResponse;
  readonly connectedIds: readonly string[];
  readonly disconnectedIds: readonly string[];
  readonly changedIds: readonly string[];
}

type ChangeListener = (change: RemovableStorageChange) => void;

interface ActiveVolume {
  readonly identity: string;
  readonly physicalIdentity: string;
  readonly source: ResolvedSource | null;
  readonly target: RemovableMediaTarget | null;
  readonly device: RemovableDevice;
}

export interface RemovableOperationHooks {
  usage(
    deviceIds: readonly string[],
    stableVolumeIdentities: readonly string[],
  ): Promise<RemovableDeviceUsage>;
  prepareRemoval(
    deviceIds: readonly string[],
    stableVolumeIdentities: readonly string[],
  ): Promise<void>;
}

export interface RemovableDirectoryDescriptor {
  readonly stableIdentity: string;
  readonly logicalRelativeRoot: string;
  readonly displayName: string;
  readonly nativeRoot: string;
  readonly canonicalRoot: string;
}

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function createPlatformRemovableStorageProvider(
  platform = process.platform,
): RemovableStorageProvider {
  return platform === "win32"
    ? new WindowsRemovableStorageProvider()
    : new LinuxRemovableStorageProvider();
}

export function createPlatformRemovableMediaAdapter(
  platform = process.platform,
): RemovableMediaAdapter {
  return platform === "win32"
    ? new WindowsRemovableMediaAdapter()
    : new LinuxRemovableMediaAdapter();
}

const idleOperation = (): RemovableOperationStatus => ({
  state: "idle",
  errorCode: null,
  affectedVolumeCount: 0,
  retryAvailable: false,
});

const unsupportedAdapter: RemovableMediaAdapter = {
  platform: "fixture",
  start: () => Promise.resolve(),
  capabilities: () => noRemovableMediaCapabilities,
  mount: () =>
    Promise.reject(
      new RemovableMediaOperationError(
        "unsupported",
        "Mount is not supported.",
      ),
    ),
  safelyRemove: () =>
    Promise.reject(
      new RemovableMediaOperationError(
        "unsupported",
        "Safe removal is not supported.",
      ),
    ),
  close: () => Promise.resolve(),
};

export class RemovableStorageService implements DirectorySourceCatalog {
  private readonly listeners = new Set<ChangeListener>();
  private readonly idsByIdentity = new Map<string, string>();
  private readonly connectedAtByIdentity = new Map<string, string>();
  private active = new Map<string, ActiveVolume>();
  private snapshotValue: RemovableDeviceListResponse = {
    revision: 0,
    devices: [],
  };
  private timer: NodeJS.Timeout | null = null;
  private refreshPromise: Promise<void> | null = null;
  private closed = false;
  private refreshCount = 0;
  private initialEnumerationMilliseconds: number | null = null;
  private maximumEnumerationMilliseconds = 0;
  private readonly operationByPhysicalIdentity = new Map<
    string,
    RemovableOperationStatus
  >();
  private readonly activeOperations = new Map<
    string,
    {
      readonly kind: "mount" | "safe-remove";
      readonly controller: AbortController;
      readonly promise: Promise<RemovableOperationResponse>;
    }
  >();
  private operationHooks: RemovableOperationHooks | null = null;

  constructor(
    private readonly provider: RemovableStorageProvider,
    private readonly filesystem: FilesystemProvider,
    private readonly paths: PathService,
    private readonly pollIntervalMilliseconds = 2_500,
    private readonly mediaAdapter: RemovableMediaAdapter = unsupportedAdapter,
  ) {}

  async start(): Promise<void> {
    if (this.closed || this.timer) return;
    await this.mediaAdapter.start();
    await this.refresh();
    if (this.isClosed()) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.pollIntervalMilliseconds);
    this.timer.unref();
  }

  snapshot(): RemovableDeviceListResponse {
    return this.snapshotValue;
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  configureOperations(hooks: RemovableOperationHooks): void {
    this.operationHooks = hooks;
  }

  async refresh(): Promise<void> {
    if (this.closed) return;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  getInternal(deviceId: string): Promise<ResolvedSource> {
    this.validateDeviceId(deviceId);
    const volume = this.active.get(deviceId);
    if (!volume?.source)
      throw new FilesystemError(
        "REMOVABLE_DEVICE_UNAVAILABLE",
        "USB storage is no longer connected.",
        409,
      );
    this.ensureIoAllowed(volume);
    return Promise.resolve(volume.source);
  }

  async describeDirectory(
    deviceId: string,
    logicalRelativeRoot: string,
  ): Promise<RemovableDirectoryDescriptor> {
    const volume = this.requireActive(deviceId);
    const source = await this.getInternal(deviceId);
    if (!volume.device.readable)
      throw new FilesystemError(
        "REMOVABLE_DEVICE_UNREADABLE",
        "USB storage is not readable.",
        409,
      );
    const logical = this.paths.validateLogicalRelativePath(logicalRelativeRoot);
    const canonicalRoot = await this.paths.resolveWithinSource(
      source.canonicalRoot,
      logical,
    );
    const details = await this.filesystem.lstat(canonicalRoot);
    if (details.isSymbolicLink() || !details.isDirectory())
      throw new FilesystemError(
        "REMOVABLE_DIRECTORY_UNAVAILABLE",
        "This USB folder is unavailable.",
        409,
      );
    await this.filesystem.access(canonicalRoot);
    return {
      stableIdentity: volume.identity,
      logicalRelativeRoot: logical,
      displayName:
        logical === ""
          ? volume.device.displayName
          : (logical.split("/").at(-1) ?? "USB Storage"),
      nativeRoot: this.paths.fromLogicalRelativePath(
        source.nativeRoot,
        logical,
      ),
      canonicalRoot,
    };
  }

  async resolvePersistentDirectory(
    stableIdentity: string,
    logicalRelativeRoot: string,
  ): Promise<RemovableDirectoryDescriptor> {
    const volume = [...this.active.values()].find(
      (candidate) => candidate.identity === stableIdentity,
    );
    if (!volume)
      throw new FilesystemError(
        "REMOVABLE_DEVICE_UNAVAILABLE",
        "USB storage is no longer connected.",
        409,
      );
    return this.describeDirectory(volume.device.id, logicalRelativeRoot);
  }

  isIdentityAvailable(stableIdentity: string): boolean {
    const volume = [...this.active.values()].find(
      (candidate) => candidate.identity === stableIdentity,
    );
    return volume?.device.readable === true && this.ioAllowed(volume);
  }

  identityForDevice(deviceId: string): string {
    return this.requireActive(deviceId).identity;
  }

  async usage(deviceId: string): Promise<RemovableDeviceUsage> {
    const volume = this.requireActive(deviceId);
    const group = this.physicalGroup(volume.physicalIdentity);
    const fallback: RemovableDeviceUsage = {
      inUse: false,
      playbackWillStop: false,
      queueContainsItems: false,
      scanWillCancel: false,
      mountedVolumeCount: group.filter(
        (candidate) => candidate.target?.mounted === true,
      ).length,
    };
    return this.operationHooks
      ? this.operationHooks.usage(
          group.map((candidate) => candidate.device.id),
          group.map((candidate) => candidate.identity),
        )
      : fallback;
  }

  mount(deviceId: string): Promise<RemovableOperationResponse> {
    const volume = this.requireActive(deviceId);
    const target = volume.target;
    if (!target || !volume.device.capabilities.canMount)
      throw new FilesystemError(
        "REMOVABLE_MOUNT_UNSUPPORTED",
        "Mount is not supported.",
        409,
      );
    return this.runOperation(volume, "mount", async (controller, affected) => {
      this.setOperation(volume.physicalIdentity, {
        state: "mounting",
        errorCode: null,
        affectedVolumeCount: affected,
        retryAvailable: false,
      });
      await this.mediaAdapter.mount(target, controller.signal);
      await this.refresh();
      return this.setOperation(volume.physicalIdentity, idleOperation());
    });
  }

  async safelyRemove(
    deviceId: string,
    confirmed: boolean,
  ): Promise<RemovableOperationResponse> {
    const volume = this.requireActive(deviceId);
    const group = this.physicalGroup(volume.physicalIdentity);
    const targets = group.flatMap((candidate) =>
      candidate.target ? [candidate.target] : [],
    );
    if (targets.length === 0 || !volume.device.capabilities.canSafelyRemove)
      throw new FilesystemError(
        "REMOVABLE_SAFE_REMOVE_UNSUPPORTED",
        "Safe removal is not supported.",
        409,
      );
    const usage = await this.usage(deviceId);
    if (usage.inUse && !confirmed)
      throw new FilesystemError(
        "REMOVABLE_CONFIRMATION_REQUIRED",
        "Confirm safe removal while USB storage is in use.",
        409,
      );
    return this.runOperation(
      volume,
      "safe-remove",
      async (controller, affected) => {
        this.setOperation(volume.physicalIdentity, {
          state: "preparing-removal",
          errorCode: null,
          affectedVolumeCount: affected,
          retryAvailable: false,
        });
        if (this.operationHooks)
          await this.operationHooks.prepareRemoval(
            group.map((candidate) => candidate.device.id),
            group.map((candidate) => candidate.identity),
          );
        await this.mediaAdapter.safelyRemove(
          targets,
          controller.signal,
          (state) => {
            this.setOperation(volume.physicalIdentity, {
              state,
              errorCode: null,
              affectedVolumeCount: affected,
              retryAvailable: false,
            });
          },
        );
        return this.setOperation(volume.physicalIdentity, {
          state: "safe-to-remove",
          errorCode: null,
          affectedVolumeCount: affected,
          retryAvailable: false,
        });
      },
    );
  }

  availabilityOf(deviceId: string): Promise<"available" | "unavailable"> {
    const volume = this.active.get(deviceId);
    return Promise.resolve(
      volume?.device.readable && this.ioAllowed(volume)
        ? "available"
        : "unavailable",
    );
  }

  async resolveLogicalPath(
    deviceId: string,
    relativePath: string,
  ): Promise<string> {
    const source = await this.getInternal(deviceId);
    if ((await this.availabilityOf(deviceId)) !== "available")
      throw new FilesystemError(
        "REMOVABLE_DEVICE_UNREADABLE",
        "USB storage is not readable.",
        409,
      );
    const nativePath = await this.paths.resolveWithinSource(
      source.canonicalRoot,
      relativePath,
    );
    const details = await this.filesystem.lstat(nativePath);
    if (
      details.isSymbolicLink() ||
      !details.isFile() ||
      !(await this.paths
        .canonicalizePath(nativePath)
        .then((canonical) =>
          this.paths.isWithinSource(source.canonicalRoot, canonical),
        ))
    )
      throw new FilesystemError(
        "REMOVABLE_ENTRY_UNAVAILABLE",
        "This USB audio file is unavailable.",
        409,
      );
    await this.filesystem.access(nativePath);
    return this.paths.canonicalizePath(nativePath);
  }

  diagnostics() {
    return {
      provider: this.provider.platform,
      activeDevices: this.active.size,
      refreshCount: this.refreshCount,
      pollIntervalMilliseconds: this.pollIntervalMilliseconds,
      timerActive: this.timer !== null,
      activeOperations: this.activeOperations.size,
      initialEnumerationMilliseconds: this.initialEnumerationMilliseconds,
      maximumEnumerationMilliseconds: this.maximumEnumerationMilliseconds,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.refreshPromise?.catch(() => undefined);
    this.listeners.clear();
    for (const operation of this.activeOperations.values())
      operation.controller.abort();
    await Promise.allSettled(
      [...this.activeOperations.values()].map((operation) => operation.promise),
    );
    this.activeOperations.clear();
    this.active.clear();
    await this.mediaAdapter.close();
    await this.provider.close();
  }

  private async performRefresh(): Promise<void> {
    const started = performance.now();
    let candidates: readonly RemovableVolumeCandidate[];
    try {
      candidates = await this.provider.enumerate();
    } catch (error) {
      console.warn("[removable-storage] enumeration failed", error);
      return;
    } finally {
      const elapsed = performance.now() - started;
      this.initialEnumerationMilliseconds ??= elapsed;
      this.maximumEnumerationMilliseconds = Math.max(
        this.maximumEnumerationMilliseconds,
        elapsed,
      );
      this.refreshCount += 1;
    }
    if (this.closed) return;
    const next = new Map<string, ActiveVolume>();
    const reconnectedIds = new Set<string>();
    for (const candidate of candidates) {
      const physicalIdentity =
        candidate.physicalIdentity ?? candidate.stableIdentity;
      const priorOperation =
        this.operationByPhysicalIdentity.get(physicalIdentity);
      const reconnectedAfterRemoval =
        priorOperation?.state === "safe-to-remove" &&
        !this.activeOperations.has(physicalIdentity);
      if (
        (reconnectedAfterRemoval ||
          ![...this.active.values()].some(
            (volume) => volume.physicalIdentity === physicalIdentity,
          )) &&
        !this.activeOperations.has(physicalIdentity)
      )
        this.operationByPhysicalIdentity.delete(physicalIdentity);
      const volume = await this.validateCandidate(candidate).catch(() => null);
      if (volume) {
        next.set(volume.device.id, volume);
        if (reconnectedAfterRemoval) reconnectedIds.add(volume.device.id);
      }
    }
    for (const [deviceId, previous] of this.active) {
      if (
        !next.has(deviceId) &&
        (this.activeOperations.has(previous.physicalIdentity) ||
          this.operationByPhysicalIdentity.get(previous.physicalIdentity)
            ?.state === "safe-to-remove")
      )
        next.set(deviceId, previous);
    }
    const previousIds = new Set(this.active.keys());
    const connectedIds = [...next.keys()].filter(
      (deviceId) => !previousIds.has(deviceId),
    );
    const disconnectedIds = [...previousIds].filter(
      (deviceId) => !next.has(deviceId),
    );
    const changedIds = [...next.keys()].filter((deviceId) => {
      const previous = this.active.get(deviceId);
      const current = next.get(deviceId);
      return (
        reconnectedIds.has(deviceId) ||
        (previous !== undefined &&
          current !== undefined &&
          ((previous.source === null) !== (current.source === null) ||
            (previous.source !== null &&
              current.source !== null &&
              this.paths.pathKey(previous.source.canonicalRoot) !==
                this.paths.pathKey(current.source.canonicalRoot))))
      );
    });
    const devices = [...next.values()]
      .map((volume) => this.deviceWithCurrentOperation(volume))
      .sort(
        (left, right) =>
          collator.compare(left.displayName, right.displayName) ||
          left.id.localeCompare(right.id),
      );
    const signature = JSON.stringify(devices);
    if (
      signature === JSON.stringify(this.snapshotValue.devices) &&
      changedIds.length === 0
    ) {
      this.active = next;
      return;
    }
    this.active = next;
    this.snapshotValue = Object.freeze({
      revision: this.snapshotValue.revision + 1,
      devices: Object.freeze(devices),
    });
    const change = {
      snapshot: this.snapshotValue,
      connectedIds,
      disconnectedIds,
      changedIds,
    };
    for (const listener of this.listeners) listener(change);
  }

  private async validateCandidate(
    candidate: RemovableVolumeCandidate,
  ): Promise<ActiveVolume | null> {
    if (
      !candidate.stableIdentity ||
      candidate.stableIdentity.includes("\0") ||
      candidate.nativeRoot?.includes("\0") ||
      candidate.physicalIdentity?.includes("\0") ||
      candidate.operationReference?.physicalDevice.includes("\0") ||
      candidate.operationReference?.volume.includes("\0")
    )
      return null;
    const mounted = candidate.mounted ?? Boolean(candidate.nativeRoot);
    let source: ResolvedSource | null = null;
    if (mounted) {
      if (!candidate.nativeRoot) return null;
      const nativeRoot = this.paths.normalizeNativePath(candidate.nativeRoot);
      const details = await this.filesystem.lstat(nativeRoot);
      if (details.isSymbolicLink() || !details.isDirectory()) return null;
      const canonicalRoot = await this.paths.canonicalizePath(nativeRoot);
      source = {
        id: "",
        type: "removable",
        displayName: "",
        nativeRoot,
        canonicalRoot,
        createdAt: "",
        updatedAt: "",
      };
    }
    const id = this.idForIdentity(candidate.stableIdentity);
    const connectedAt =
      this.connectedAtByIdentity.get(candidate.stableIdentity) ??
      new Date().toISOString();
    this.connectedAtByIdentity.set(candidate.stableIdentity, connectedAt);
    const timestamp = connectedAt;
    const readable = mounted && candidate.readable;
    const physicalIdentity =
      candidate.physicalIdentity ?? candidate.stableIdentity;
    const target = candidate.operationReference
      ? {
          physicalIdentity,
          stableVolumeIdentity: candidate.stableIdentity,
          physicalDevice: candidate.operationReference.physicalDevice,
          volume: candidate.operationReference.volume,
          mounted,
          system: candidate.system === true,
          boot: candidate.boot === true,
        }
      : null;
    const capabilities = target
      ? this.mediaAdapter.capabilities(target)
      : noRemovableMediaCapabilities;
    const device: RemovableDevice = {
      id,
      displayName: candidate.displayName.trim() || "USB Storage",
      state: readable ? "readable" : mounted ? "unavailable" : "connected",
      readable,
      readOnly: candidate.readOnly,
      ...(candidate.filesystemType
        ? { filesystemType: candidate.filesystemType }
        : {}),
      ...(candidate.capacityBytes === undefined
        ? {}
        : { capacityBytes: candidate.capacityBytes }),
      ...(candidate.availableBytes === undefined
        ? {}
        : { availableBytes: candidate.availableBytes }),
      connectedAt,
      capabilities,
      operation:
        this.operationByPhysicalIdentity.get(physicalIdentity) ??
        idleOperation(),
    };
    if (source)
      source = {
        ...source,
        id,
        displayName: device.displayName,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    return {
      identity: candidate.stableIdentity,
      physicalIdentity,
      source,
      target,
      device,
    };
  }

  private idForIdentity(identity: string): string {
    const existing = this.idsByIdentity.get(identity);
    if (existing) return existing;
    const id = `usb-${createHash("sha256")
      .update(`eidetic-removable-v1\0${identity}`)
      .digest("hex")
      .slice(0, 32)}`;
    this.idsByIdentity.set(identity, id);
    return id;
  }

  private validateDeviceId(deviceId: string): void {
    if (!/^usb-[0-9a-f]{32}$/.test(deviceId))
      throw new FilesystemError(
        "REMOVABLE_DEVICE_NOT_FOUND",
        "USB storage was not found.",
        404,
      );
  }

  private requireActive(deviceId: string): ActiveVolume {
    this.validateDeviceId(deviceId);
    const volume = this.active.get(deviceId);
    if (!volume)
      throw new FilesystemError(
        "REMOVABLE_DEVICE_UNAVAILABLE",
        "USB storage is no longer connected.",
        409,
      );
    return volume;
  }

  private physicalGroup(physicalIdentity: string): ActiveVolume[] {
    return [...this.active.values()].filter(
      (volume) => volume.physicalIdentity === physicalIdentity,
    );
  }

  private deviceWithCurrentOperation(volume: ActiveVolume): RemovableDevice {
    const readable = volume.device.readable && this.ioAllowed(volume);
    return {
      ...volume.device,
      readable,
      state:
        volume.device.readable && !readable
          ? "unavailable"
          : volume.device.state,
      operation:
        this.operationByPhysicalIdentity.get(volume.physicalIdentity) ??
        idleOperation(),
    };
  }

  private ioAllowed(volume: ActiveVolume): boolean {
    const state =
      this.operationByPhysicalIdentity.get(volume.physicalIdentity)?.state ??
      "idle";
    return ![
      "mounting",
      "preparing-removal",
      "unmounting",
      "ejecting",
      "safe-to-remove",
    ].includes(state);
  }

  private ensureIoAllowed(volume: ActiveVolume): void {
    if (!this.ioAllowed(volume))
      throw new FilesystemError(
        "REMOVABLE_OPERATION_IN_PROGRESS",
        "USB storage is preparing for safe removal.",
        409,
      );
  }

  private setOperation(
    physicalIdentity: string,
    operation: RemovableOperationStatus,
  ): RemovableOperationResponse {
    this.operationByPhysicalIdentity.set(physicalIdentity, operation);
    const group = this.physicalGroup(physicalIdentity);
    const devices = [...this.active.values()]
      .map((volume) => this.deviceWithCurrentOperation(volume))
      .sort(
        (left, right) =>
          collator.compare(left.displayName, right.displayName) ||
          left.id.localeCompare(right.id),
      );
    if (
      JSON.stringify(devices) !== JSON.stringify(this.snapshotValue.devices)
    ) {
      this.snapshotValue = Object.freeze({
        revision: this.snapshotValue.revision + 1,
        devices: Object.freeze(devices),
      });
      const change = {
        snapshot: this.snapshotValue,
        connectedIds: [],
        disconnectedIds: [],
        changedIds: group.map((volume) => volume.device.id),
      };
      for (const listener of this.listeners) listener(change);
    }
    return {
      deviceId: group[0]?.device.id ?? "",
      operation,
    };
  }

  private runOperation(
    volume: ActiveVolume,
    kind: "mount" | "safe-remove",
    run: (
      controller: AbortController,
      affectedVolumeCount: number,
    ) => Promise<RemovableOperationResponse>,
  ): Promise<RemovableOperationResponse> {
    const existing = this.activeOperations.get(volume.physicalIdentity);
    if (existing) {
      if (existing.kind === kind) return existing.promise;
      throw new FilesystemError(
        "REMOVABLE_OPERATION_CONFLICT",
        "Another USB operation is already in progress.",
        409,
      );
    }
    const controller = new AbortController();
    const affectedVolumeCount = this.physicalGroup(
      volume.physicalIdentity,
    ).length;
    const promise = run(controller, affectedVolumeCount)
      .catch((error: unknown) => {
        const operationError =
          error instanceof RemovableMediaOperationError
            ? error
            : new RemovableMediaOperationError(
                "failed",
                "Unable to safely remove USB storage.",
              );
        this.setOperation(volume.physicalIdentity, {
          state: operationError.code === "device-busy" ? "busy" : "failed",
          errorCode: operationError.code,
          affectedVolumeCount,
          retryAvailable: !["unsupported", "device-not-found"].includes(
            operationError.code,
          ),
        });
        throw new FilesystemError(
          `REMOVABLE_${operationError.code.replaceAll("-", "_").toUpperCase()}`,
          operationError.message,
          operationError.code === "authorization-required" ? 403 : 409,
        );
      })
      .finally(() => {
        this.activeOperations.delete(volume.physicalIdentity);
      });
    this.activeOperations.set(volume.physicalIdentity, {
      kind,
      controller,
      promise,
    });
    return promise;
  }

  private isClosed(): boolean {
    return this.closed;
  }
}
