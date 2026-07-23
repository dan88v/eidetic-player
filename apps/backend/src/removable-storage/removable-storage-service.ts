import { createHash } from "node:crypto";
import type {
  RemovableDevice,
  RemovableDeviceListResponse,
} from "../../../../packages/shared/src/library.js";
import { FilesystemError } from "../filesystem/filesystem-errors.js";
import type { FilesystemProvider } from "../filesystem/filesystem-provider.js";
import type {
  DirectorySourceCatalog,
  ResolvedSource,
} from "../filesystem/filesystem-types.js";
import { PathService } from "../filesystem/path-service.js";
import { LinuxRemovableStorageProvider } from "./linux-removable-storage-provider.js";
import type {
  RemovableStorageProvider,
  RemovableVolumeCandidate,
} from "./removable-storage-provider.js";
import { WindowsRemovableStorageProvider } from "./windows-removable-storage-provider.js";

export interface RemovableStorageChange {
  readonly snapshot: RemovableDeviceListResponse;
  readonly connectedIds: readonly string[];
  readonly disconnectedIds: readonly string[];
  readonly changedIds: readonly string[];
}

type ChangeListener = (change: RemovableStorageChange) => void;

interface ActiveVolume {
  readonly identity: string;
  readonly source: ResolvedSource;
  readonly device: RemovableDevice;
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

  constructor(
    private readonly provider: RemovableStorageProvider,
    private readonly filesystem: FilesystemProvider,
    private readonly paths: PathService,
    private readonly pollIntervalMilliseconds = 2_500,
  ) {}

  async start(): Promise<void> {
    if (this.closed || this.timer) return;
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
    if (!volume)
      throw new FilesystemError(
        "REMOVABLE_DEVICE_UNAVAILABLE",
        "USB storage is no longer connected.",
        409,
      );
    return Promise.resolve(volume.source);
  }

  async describeDirectory(
    deviceId: string,
    logicalRelativeRoot: string,
  ): Promise<RemovableDirectoryDescriptor> {
    const volume = this.requireActive(deviceId);
    if (!volume.device.readable)
      throw new FilesystemError(
        "REMOVABLE_DEVICE_UNREADABLE",
        "USB storage is not readable.",
        409,
      );
    const logical = this.paths.validateLogicalRelativePath(logicalRelativeRoot);
    const canonicalRoot = await this.paths.resolveWithinSource(
      volume.source.canonicalRoot,
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
        volume.source.nativeRoot,
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
    return volume?.device.readable === true;
  }

  identityForDevice(deviceId: string): string {
    return this.requireActive(deviceId).identity;
  }

  availabilityOf(deviceId: string): Promise<"available" | "unavailable"> {
    const volume = this.active.get(deviceId);
    return Promise.resolve(
      volume?.device.readable ? "available" : "unavailable",
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
    this.active.clear();
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
    for (const candidate of candidates) {
      const volume = await this.validateCandidate(candidate).catch(() => null);
      if (volume) next.set(volume.device.id, volume);
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
        previous !== undefined &&
        current !== undefined &&
        this.paths.pathKey(previous.source.canonicalRoot) !==
          this.paths.pathKey(current.source.canonicalRoot)
      );
    });
    const devices = [...next.values()]
      .map((volume) => volume.device)
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
      !candidate.nativeRoot ||
      candidate.stableIdentity.includes("\0") ||
      candidate.nativeRoot.includes("\0")
    )
      return null;
    const nativeRoot = this.paths.normalizeNativePath(candidate.nativeRoot);
    const details = await this.filesystem.lstat(nativeRoot);
    if (details.isSymbolicLink() || !details.isDirectory()) return null;
    const canonicalRoot = await this.paths.canonicalizePath(nativeRoot);
    const id = this.idForIdentity(candidate.stableIdentity);
    const connectedAt =
      this.connectedAtByIdentity.get(candidate.stableIdentity) ??
      new Date().toISOString();
    this.connectedAtByIdentity.set(candidate.stableIdentity, connectedAt);
    const timestamp = connectedAt;
    const readable = candidate.readable;
    const device: RemovableDevice = {
      id,
      displayName: candidate.displayName.trim() || "USB Storage",
      state: readable ? "readable" : "unavailable",
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
      capabilities: {
        canMount: false,
        canUnmount: false,
        canEject: false,
      },
    };
    return {
      identity: candidate.stableIdentity,
      source: {
        id,
        type: "removable",
        displayName: device.displayName,
        nativeRoot,
        canonicalRoot,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
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

  private isClosed(): boolean {
    return this.closed;
  }
}
