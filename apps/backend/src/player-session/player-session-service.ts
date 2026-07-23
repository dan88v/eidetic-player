import { isSupportedAudioPath } from "../../../../packages/shared/src/audio.js";
import type { FilesystemProvider } from "../filesystem/filesystem-provider.js";
import { PathService } from "../filesystem/path-service.js";
import { SourceService } from "../filesystem/source-service.js";
import type { PlayerService } from "../player/player-service.js";
import { PlayerSessionRepository } from "./player-session-repository.js";
import type { RemovableStorageService } from "../removable-storage/removable-storage-service.js";
import type {
  PersistedPlayerSession,
  PersistedQueueItem,
  PersistedQueueOrigin,
  PlayerRestoreResult,
  ResolvedQueueItem,
} from "./player-session-types.js";

const SAVE_DEBOUNCE_MS = 120;

export class PlayerSessionService {
  private unsubscribe: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private signature = "";
  private pending: PersistedPlayerSession | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private writes = 0;

  constructor(
    private readonly repository: PlayerSessionRepository,
    private readonly provider: FilesystemProvider,
    private readonly paths: PathService,
    private readonly sources: SourceService,
    private readonly player: PlayerService,
    private readonly removableStorage?: RemovableStorageService,
  ) {}

  async restore(): Promise<PlayerRestoreResult> {
    const readStart = performance.now();
    const session = await this.repository.read();
    const readMilliseconds = performance.now() - readStart;
    if (!session) return this.emptyResult(readMilliseconds, 0, 0, 0);

    const verifyStart = performance.now();
    const current = session.queue.find(
      (item) => item.id === session.currentQueueItemId,
    );
    if (!current) {
      await this.repository.clear();
      return this.emptyResult(
        readMilliseconds,
        performance.now() - verifyStart,
        session.queue.length,
        session.queue.length,
      );
    }
    const resolvedCurrent = await this.resolveItem(current);
    if (!resolvedCurrent) {
      console.warn("[player-session] saved current track is unavailable");
      await this.repository.clear();
      return this.emptyResult(
        readMilliseconds,
        performance.now() - verifyStart,
        session.queue.length,
        session.queue.length,
      );
    }
    const resolved: ResolvedQueueItem[] = [];
    for (const item of session.queue) {
      if (item.id === current.id) resolved.push(resolvedCurrent);
      else {
        const candidate = await this.resolveItem(item);
        if (candidate) resolved.push(candidate);
      }
    }
    const currentIndex = resolved.findIndex((item) => item.id === current.id);
    const verificationMilliseconds = performance.now() - verifyStart;
    const prepareStart = performance.now();
    await this.player.restoreResolvedQueue(resolved, currentIndex);
    const prepareMilliseconds = performance.now() - prepareStart;
    this.signature = this.snapshotSignature();
    await this.saveNow();
    return {
      status: "restored",
      savedCount: session.queue.length,
      restoredCount: resolved.length,
      discardedCount: session.queue.length - resolved.length,
      readMilliseconds,
      verificationMilliseconds,
      prepareMilliseconds,
    };
  }

  start(): void {
    if (this.unsubscribe) return;
    this.signature = this.snapshotSignature();
    this.unsubscribe = this.player.subscribe(() => {
      this.handleState();
    });
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.saveNow();
    await this.writeChain;
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  diagnostics() {
    return {
      configPath: this.repository.configPath,
      writes: this.writes,
      timerActive: this.timer !== null,
    };
  }

  private handleState(): void {
    const signature = this.snapshotSignature();
    if (signature === this.signature) return;
    this.signature = signature;
    this.pending = this.toPersistedSession();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  private async saveNow(): Promise<void> {
    const session = this.pending ?? this.toPersistedSession();
    this.pending = null;
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        if (session) await this.repository.write(session);
        else await this.repository.clear();
        this.writes += 1;
      });
    await this.writeChain;
  }

  private toPersistedSession(): PersistedPlayerSession | null {
    const snapshot = this.player.getSessionSnapshot();
    if (!snapshot.currentQueueItemId || snapshot.queue.length === 0)
      return null;
    return {
      version: 1,
      currentQueueItemId: snapshot.currentQueueItemId,
      queue: snapshot.queue,
    };
  }

  private snapshotSignature(): string {
    const snapshot = this.player.getSessionSnapshot();
    return `${snapshot.currentQueueItemId ?? ""}\0${snapshot.queue
      .map((item) => `${item.id}:${this.originKey(item.origin)}`)
      .join("\0")}`;
  }

  private originKey(origin: PersistedQueueOrigin): string {
    if (origin.kind === "direct") return `direct:${origin.nativePath}`;
    if (origin.kind === "removable")
      return `removable:${origin.deviceId}:${origin.relativePath}:${origin.entryId}`;
    return `folders:${origin.sourceId}:${origin.relativePath}:${origin.libraryTrackId ?? ""}`;
  }

  private async resolveItem(
    item: PersistedQueueItem,
  ): Promise<ResolvedQueueItem | null> {
    try {
      const nativePath =
        item.origin.kind === "direct"
          ? this.paths.normalizeNativePath(item.origin.nativePath)
          : item.origin.kind === "removable"
            ? await this.resolveRemovableOrigin(item.origin)
            : await this.resolveFoldersOrigin(item.origin);
      const details = await this.provider.lstat(nativePath);
      if (
        details.isSymbolicLink() ||
        !details.isFile() ||
        !isSupportedAudioPath(nativePath)
      )
        return null;
      await this.provider.access(nativePath);
      return {
        id: item.id,
        path: await this.paths.canonicalizePath(nativePath),
        origin: item.origin,
      };
    } catch {
      return null;
    }
  }

  private async resolveFoldersOrigin(
    origin: Extract<PersistedQueueOrigin, { kind: "folders" }>,
  ): Promise<string> {
    const source = await this.sources.getInternal(origin.sourceId);
    if ((await this.sources.availabilityOf(origin.sourceId)) !== "available")
      throw new Error("source unavailable");
    return this.paths.resolveWithinSource(
      source.canonicalRoot,
      origin.relativePath,
    );
  }

  private async resolveRemovableOrigin(
    origin: Extract<PersistedQueueOrigin, { kind: "removable" }>,
  ): Promise<string> {
    if (!this.removableStorage) throw new Error("removable unavailable");
    return this.removableStorage.resolveLogicalPath(
      origin.deviceId,
      origin.relativePath,
    );
  }

  private emptyResult(
    readMilliseconds: number,
    verificationMilliseconds: number,
    savedCount: number,
    discardedCount: number,
  ): PlayerRestoreResult {
    return {
      status: "empty",
      savedCount,
      restoredCount: 0,
      discardedCount,
      readMilliseconds,
      verificationMilliseconds,
      prepareMilliseconds: 0,
    };
  }
}
