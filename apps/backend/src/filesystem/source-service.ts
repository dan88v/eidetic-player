import { randomUUID } from "node:crypto";
import type {
  AddLocalSourceResponse,
  AddRemovableLibrarySourceResponse,
  AddSmbLibrarySourceResponse,
  LibrarySource,
  RemovableLibraryCoverage,
  SmbLibraryCoverage,
} from "../../../../packages/shared/src/library.js";
import type { FilesystemProvider } from "./filesystem-provider.js";
import { FilesystemError } from "./filesystem-errors.js";
import { PathService } from "./path-service.js";
import { SourceRepository } from "./source-repository.js";
import {
  type ResolvedSource,
  type StoredRemovableSource,
  type StoredSmbSource,
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

export interface SmbSourceResolver {
  describeDirectory(
    connectionId: string,
    logicalRelativeRoot: string,
  ): Promise<{
    readonly connectionId: string;
    readonly logicalRelativeRoot: string;
    readonly displayName: string;
    readonly nativeRoot: string;
    readonly canonicalRoot: string;
  }>;
  resolvePersistentDirectory(
    connectionId: string,
    logicalRelativeRoot: string,
  ): Promise<{
    readonly nativeRoot: string;
    readonly canonicalRoot: string;
  }>;
}

export class SourceService {
  private readonly availability = new Map<
    string,
    "available" | "unavailable" | "checking"
  >();
  private removableMutation: Promise<void> = Promise.resolve();
  private smbMutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly provider: FilesystemProvider,
    private readonly paths: PathService,
    private readonly repository: SourceRepository,
    private readonly removable?: RemovableSourceResolver,
    private readonly smb?: SmbSourceResolver,
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

  async smbCoverage(
    connectionId: string,
    logicalRelativeRoot: string,
  ): Promise<SmbLibraryCoverage> {
    const smb = this.requireSmb();
    const descriptor = await smb.describeDirectory(
      connectionId,
      logicalRelativeRoot,
    );
    const records = (await this.repository.list()).filter(
      (record): record is StoredSmbSource =>
        record.type === "smb" &&
        record.connectionId === descriptor.connectionId,
    );
    return this.coverageForRecords(
      records,
      descriptor.logicalRelativeRoot,
      (record) => record.logicalRelativeRoot,
    );
  }

  async addSmb(
    connectionId: string,
    logicalRelativeRoot: string,
  ): Promise<AddSmbLibrarySourceResponse> {
    const operation = this.smbMutation.then(() =>
      this.addSmbNow(connectionId, logicalRelativeRoot),
    );
    this.smbMutation = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async addSmbNow(
    connectionId: string,
    logicalRelativeRoot: string,
  ): Promise<AddSmbLibrarySourceResponse> {
    const resolver = this.requireSmb();
    const descriptor = await resolver.describeDirectory(
      connectionId,
      logicalRelativeRoot,
    );
    const coverage = await this.smbCoverage(
      descriptor.connectionId,
      descriptor.logicalRelativeRoot,
    );
    if (coverage.state !== "none")
      throw new FilesystemError(
        coverage.state === "exact" ? "SMB_SOURCE_EXISTS" : "SMB_SOURCE_OVERLAP",
        coverage.state === "exact"
          ? "This network folder is already in Library."
          : "This network folder overlaps an existing Library source.",
        409,
      );
    const records = await this.repository.list();
    await resolver.describeDirectory(
      descriptor.connectionId,
      descriptor.logicalRelativeRoot,
    );
    const now = new Date().toISOString();
    const record: StoredSmbSource = {
      id: randomUUID(),
      type: "smb",
      displayName: descriptor.displayName.trim() || "Network Share",
      connectionId: descriptor.connectionId,
      logicalRelativeRoot: descriptor.logicalRelativeRoot,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.replace([...records, record]);
    try {
      await resolver.resolvePersistentDirectory(
        record.connectionId,
        record.logicalRelativeRoot,
      );
    } catch (error) {
      await this.repository.replace(records);
      throw error;
    }
    this.availability.set(record.id, "available");
    const source = toPublicSource(record, "available");
    return {
      source,
      scanQueued: true,
      coverage: { state: "exact", source },
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
    const resolved =
      record.type === "removable"
        ? await this.requireRemovable().resolvePersistentDirectory(
            record.stableIdentity,
            record.logicalRelativeRoot,
          )
        : await this.requireSmb().resolvePersistentDirectory(
            record.connectionId,
            record.logicalRelativeRoot,
          );
    return {
      id: record.id,
      type: record.type,
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

  async removableSourceIdsForIdentities(
    stableIdentities: readonly string[],
  ): Promise<readonly string[]> {
    const identities = new Set(stableIdentities);
    return (await this.repository.list())
      .filter(
        (record): record is StoredRemovableSource =>
          record.type === "removable" && identities.has(record.stableIdentity),
      )
      .map((record) => record.id);
  }

  async smbSourceIdsForConnections(
    connectionIds: readonly string[],
  ): Promise<readonly string[]> {
    const ids = new Set(connectionIds);
    return (await this.repository.list())
      .filter(
        (record): record is StoredSmbSource =>
          record.type === "smb" && ids.has(record.connectionId),
      )
      .map((record) => record.id);
  }

  async hasSmbSources(connectionId: string): Promise<boolean> {
    return (await this.repository.list()).some(
      (record) => record.type === "smb" && record.connectionId === connectionId,
    );
  }

  async refreshSmbAvailability(
    connectionIds?: readonly string[],
  ): Promise<readonly SourceAvailabilityChange[]> {
    if (!this.smb) return [];
    const filter = connectionIds ? new Set(connectionIds) : null;
    const records = await this.repository.list();
    const changes: SourceAvailabilityChange[] = [];
    for (const record of records) {
      if (record.type !== "smb" || (filter && !filter.has(record.connectionId)))
        continue;
      const next = await this.resolveSmbAvailability(record);
      if (this.availability.get(record.id) !== next)
        changes.push({
          sourceId: record.id,
          available: next === "available",
        });
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
    if (record.type === "smb") {
      const availability = await this.resolveSmbAvailability(record);
      this.availability.set(record.id, availability);
      return availability;
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

  private requireSmb(): SmbSourceResolver {
    if (!this.smb)
      throw new FilesystemError(
        "SMB_UNAVAILABLE",
        "Network share integration is unavailable.",
        503,
      );
    return this.smb;
  }

  private async resolveSmbAvailability(
    record: StoredSmbSource,
  ): Promise<"available" | "unavailable"> {
    try {
      await this.requireSmb().resolvePersistentDirectory(
        record.connectionId,
        record.logicalRelativeRoot,
      );
      return "available";
    } catch {
      return "unavailable";
    }
  }

  private async coverageForRecords<T>(
    records: readonly T[],
    requestedRoot: string,
    rootOf: (record: T) => string,
  ): Promise<SmbLibraryCoverage> {
    const requested = this.logicalSegments(requestedRoot);
    for (const record of records) {
      const existing = this.logicalSegments(rootOf(record));
      const sourceRecord = record as StoredSource;
      const source = toPublicSource(
        sourceRecord,
        await this.check(sourceRecord),
      );
      if (this.sameSegments(existing, requested))
        return { state: "exact", source };
      if (this.isSegmentAncestor(existing, requested))
        return { state: "covered-by-parent", source };
      if (this.isSegmentAncestor(requested, existing))
        return { state: "overlaps-child", source };
    }
    return { state: "none", source: null };
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
