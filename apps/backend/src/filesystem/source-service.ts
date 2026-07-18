import { randomUUID } from "node:crypto";
import type {
  AddLocalSourceResponse,
  LibrarySource,
} from "../../../../packages/shared/src/library.js";
import type { FilesystemProvider } from "./filesystem-provider.js";
import { FilesystemError } from "./filesystem-errors.js";
import { PathService } from "./path-service.js";
import { SourceRepository } from "./source-repository.js";
import { type StoredSource, toPublicSource } from "./filesystem-types.js";

export class SourceService {
  private readonly availability = new Map<
    string,
    "available" | "unavailable" | "checking"
  >();

  constructor(
    private readonly provider: FilesystemProvider,
    private readonly paths: PathService,
    private readonly repository: SourceRepository,
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
      (record) => this.paths.pathKey(record.canonicalRoot) === key,
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
    const record = await this.getInternal(sourceId);
    this.availability.set(sourceId, "checking");
    const availability = await this.check(record);
    return toPublicSource(record, availability);
  }

  async getInternal(sourceId: string): Promise<StoredSource> {
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
    return this.check(await this.getInternal(sourceId));
  }

  getDiagnostics() {
    return {
      configPath: this.repository.configPath,
      sourceCount: this.availability.size,
    };
  }

  private async check(
    record: StoredSource,
  ): Promise<"available" | "unavailable"> {
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
}
