import { randomUUID } from "node:crypto";
import type {
  AddLocalSourceResponse,
  AddRemovableLibrarySourceResponse,
  LibrarySource,
  RemovableLibraryCoverage,
} from "../../../../packages/shared/src/library.js";
import type { FilesystemProvider } from "./filesystem-provider.js";
import { FilesystemError } from "./filesystem-errors.js";
import { PathService } from "./path-service.js";
import { SourceRepository } from "./source-repository.js";
import {
  type ResolvedSource,
  type StoredRemovableSource,
  type StoredSource,
  toPublicSource,
} from "./filesystem-types.js";

export interface RemovableSourceResolver {
  describeDirectory(
    deviceId: string,
    logicalRelativeRoot: string,
  ): Promise<{
    readonly stableIdentity: string;
    readonly logicalRelativeRoot: string;
    readonly displayName: string;
    readonly nativeRoot: string;
    readonly canonicalRoot: string;
  }>;
  resolvePersistentDirectory(
    stableIdentity: string,
    logicalRelativeRoot: string,
  ): Promise<{
    readonly nativeRoot: string;
    readonly canonicalRoot: string;
  }>;
  isIdentityAvailable(stableIdentity: string): boolean;
}

export interface SourceAvailabilityChange {
  readonly sourceId: string;
  readonly available: boolean;
}

export class SourceService {
  private readonly availability = new Map<
    string,
    "available" | "unavailable" | "checking"
  >();
  private removableMutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly provider: FilesystemProvider,
    private readonly paths: PathService,
    private readonly repository: SourceRepository,
    private readonly removable?: RemovableSourceResolver,
  ) {}

  async list(): Promise<readonly LibrarySource[]> {
    const records = await this.repository.list();
    return Promise.all(
      records.map(async (record) => {
        const availability = await this.check(record);
        return toPublicSource(record, availability);
      }),
    );
  }

  async addLocal(nativePath: string): Promise<AddLocalSourceResponse> {
    const normalized = this.paths.normalizeNativePath(nativePath);
    let canonical: string;
    try {
      const link = await this.provider.lstat(normalized);
      if (link.isSymbolicLink() || !link.isDirectory())
        throw new FilesystemError(
          "INVALID_SOURCE",
          "Select a readable local folder.",
        );
      await this.provider.access(normalized);
      canonical = await this.paths.canonicalizePath(normalized);
    } catch (error) {
      if (error instanceof FilesystemError) throw error;
      throw new FilesystemError(
        "UNREADABLE_SOURCE",
        "Unable to read the selected folder.",
        422,
      );
    }
    const records = await this.repository.list();
    const key = this.paths.pathKey(canonical);
    const existing = records.find(
      (record) =>
        record.type === "local" &&
        this.paths.pathKey(record.canonicalRoot) === key,
    );
    if (existing) {
      this.availability.set(existing.id, "available");
      return {
        source: toPublicSource(existing, "available"),
        duplicate: true,
      };
    }
    const now = new Date().toISOString();
    const record: StoredSource = {
      id: randomUUID(),
      type: "local",
      displayName: this.paths.basenameForDisplay(canonical),
      nativeRoot: normalized,
      canonicalRoot: canonical,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.replace([...records, record]);
    this.availability.set(record.id, "available");
    return {
      source: toPublicSource(record, "available"),
      duplicate: false,
    };
  }

  async removableCoverage(
    deviceId: string,
    logicalRelativeRoot: string,
  ): Promise<RemovableLibraryCoverage> {
    const removable = this.requireRemovable();
    const descriptor = await removable.describeDirectory(
      deviceId,
      logicalRelativeRoot,
    );
    const records = (await this.repository.list()).filter(
      (record): record is StoredRemovableSource =>
        record.type === "removable" &&
        record.stableIdentity === descriptor.stableIdentity,
    );
    const requested = this.logicalSegments(descriptor.logicalRelativeRoot);
    for (const record of records) {
      const existing = this.logicalSegments(record.logicalRelativeRoot);
      if (this.sameSegments(existing, requested))
        return {
          state: "exact",
          source: toPublicSource(
            record,
            removable.isIdentityAvailable(record.stableIdentity)
              ? "available"
              : "unavailable",
          ),
        };
      if (this.isSegmentAncestor(existing, requested))
        return {
          state: "covered-by-parent",
          source: toPublicSource(
            record,
            removable.isIdentityAvailable(record.stableIdentity)
              ? "available"
              : "unavailable",
          ),
        };
      if (this.isSegmentAncestor(requested, existing))
        return {
          state: "overlaps-child",
          source: toPublicSource(
            record,
            removable.isIdentityAvailable(record.stableIdentity)
              ? "available"
              : "unavailable",
          ),
        };
    }
    return { state: "none", source: null };
  }

  async addRemovable(
    deviceId: string,
    logicalRelativeRoot: string,
  ): Promise<AddRemovableLibrarySourceResponse> {
    const operation = this.removableMutation.then(() =>
      this.addRemovableNow(deviceId, logicalRelativeRoot),
    );
    this.removableMutation = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async addRemovableNow(
    deviceId: string,
    logicalRelativeRoot: string,
  ): Promise<AddRemovableLibrarySourceResponse> {
    const resolver = this.requireRemovable();
    const descriptor = await resolver.describeDirectory(
      deviceId,
      logicalRelativeRoot,
    );
    const coverage = await this.removableCoverage(
      deviceId,
      descriptor.logicalRelativeRoot,
    );
    if (coverage.state !== "none")
      throw new FilesystemError(
        coverage.state === "exact"
          ? "REMOVABLE_SOURCE_EXISTS"
          : "REMOVABLE_SOURCE_OVERLAP",
        coverage.state === "exact"
          ? "This USB folder is already in Library."
          : "This USB folder overlaps an existing Library source.",
        409,
      );
    const records = await this.repository.list();
    await resolver.describeDirectory(deviceId, descriptor.logicalRelativeRoot);
    const now = new Date().toISOString();
    const record: StoredRemovableSource = {
      id: randomUUID(),
      type: "removable",
      displayName: descriptor.displayName.trim() || "USB Storage",
      stableIdentity: descriptor.stableIdentity,
      logicalRelativeRoot: descriptor.logicalRelativeRoot,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.replace([...records, record]);
    this.availability.set(record.id, "available");
    return {
      source: toPublicSource(record, "available"),
      scanQueued: true,
      coverage: {
        state: "exact",
        source: toPublicSource(record, "available"),
      },
    };
  }

  async rename(sourceId: string, displayName: string): Promise<LibrarySource> {
    const normalized = displayName.trim();
    if (!normalized || normalized.length > 80)
      throw new FilesystemError(
        "INVALID_DISPLAY_NAME",
        "Enter a source name between 1 and 80 characters.",
      );
    const records = await this.repository.list();
    const index = records.findIndex((record) => record.id === sourceId);
    const existing = records[index];
    if (!existing)
      throw new FilesystemError("SOURCE_NOT_FOUND", "Source not found.", 404);
    const updated: StoredSource = {
      ...existing,
      displayName: normalized,
      updatedAt: new Date().toISOString(),
    };
    const next = [...records];
    next[index] = updated;
    await this.repository.replace(next);
    return toPublicSource(
      updated,
      this.availability.get(sourceId) ?? "unavailable",
    );
  }

  async remove(sourceId: string): Promise<void> {
    const records = await this.repository.list();
    if (!records.some((record) => record.id === sourceId))
      throw new FilesystemError("SOURCE_NOT_FOUND", "Source not found.", 404);
    await this.repository.replace(
      records.filter((record) => record.id !== sourceId),
    );
    this.availability.delete(sourceId);
  }

  async retry(sourceId: string): Promise<LibrarySource> {
    const record = await this.getRecord(sourceId);
    this.availability.set(sourceId, "checking");
    const availability = await this.check(record);
    return toPublicSource(record, availability);
  }

  async getInternal(sourceId: string): Promise<ResolvedSource> {
    const record = await this.getRecord(sourceId);
    if (record.type === "local") return record;
    const resolved = await this.requireRemovable().resolvePersistentDirectory(
      record.stableIdentity,
      record.logicalRelativeRoot,
    );
    return {
      id: record.id,
      type: "removable",
      displayName: record.displayName,
      nativeRoot: resolved.nativeRoot,
      canonicalRoot: resolved.canonicalRoot,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async getRecord(sourceId: string): Promise<StoredSource> {
    if (!/^[0-9a-f-]{36}$/i.test(sourceId))
      throw new FilesystemError("SOURCE_NOT_FOUND", "Source not found.", 404);
    const record = (await this.repository.list()).find(
      (candidate) => candidate.id === sourceId,
    );
    if (!record)
      throw new FilesystemError("SOURCE_NOT_FOUND", "Source not found.", 404);
    return record;
  }

  async availabilityOf(sourceId: string): Promise<"available" | "unavailable"> {
    return this.check(await this.getRecord(sourceId));
  }

  getDiagnostics() {
    return {
      configPath: this.repository.configPath,
      sourceCount: this.availability.size,
    };
  }

  async refreshRemovableAvailability(): Promise<
    readonly SourceAvailabilityChange[]
  > {
    const resolver = this.removable;
    if (!resolver) return [];
    const records = await this.repository.list();
    const changes: SourceAvailabilityChange[] = [];
    for (const record of records) {
      if (record.type !== "removable") continue;
      const available = resolver.isIdentityAvailable(record.stableIdentity);
      const next = available ? "available" : "unavailable";
      if (this.availability.get(record.id) !== next)
        changes.push({ sourceId: record.id, available });
      this.availability.set(record.id, next);
    }
    return changes;
  }

  private async check(
    record: StoredSource,
  ): Promise<"available" | "unavailable"> {
    if (record.type === "removable") {
      const available =
        this.removable?.isIdentityAvailable(record.stableIdentity) === true;
      this.availability.set(record.id, available ? "available" : "unavailable");
      return available ? "available" : "unavailable";
    }
    try {
      const details = await this.provider.lstat(record.canonicalRoot);
      if (details.isSymbolicLink() || !details.isDirectory())
        throw new Error("not a directory");
      await this.provider.access(record.canonicalRoot);
      this.availability.set(record.id, "available");
      return "available";
    } catch {
      this.availability.set(record.id, "unavailable");
      console.warn(`[sources] source ${record.id} is unavailable`);
      return "unavailable";
    }
  }

  private requireRemovable(): RemovableSourceResolver {
    if (!this.removable)
      throw new FilesystemError(
        "REMOVABLE_STORAGE_UNAVAILABLE",
        "USB storage integration is unavailable.",
        503,
      );
    return this.removable;
  }

  private logicalSegments(value: string): readonly string[] {
    const valid = this.paths.validateLogicalRelativePath(value);
    return valid
      ? valid
          .split("/")
          .map((segment) =>
            this.paths.platform === "win32"
              ? segment.toLocaleLowerCase("en")
              : segment,
          )
      : [];
  }

  private sameSegments(
    left: readonly string[],
    right: readonly string[],
  ): boolean {
    return (
      left.length === right.length &&
      left.every((segment, index) => segment === right[index])
    );
  }

  private isSegmentAncestor(
    ancestor: readonly string[],
    descendant: readonly string[],
  ): boolean {
    return (
      ancestor.length < descendant.length &&
      ancestor.every((segment, index) => segment === descendant[index])
    );
  }
}
