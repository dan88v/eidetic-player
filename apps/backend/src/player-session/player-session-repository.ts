import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";
import { resolveAppDirectories } from "../platform/app-directories.js";
import type {
  PersistedPlayerSession,
  PersistedQueueItem,
  PersistedQueueOrigin,
} from "./player-session-types.js";

function isOrigin(value: unknown): value is PersistedQueueOrigin {
  if (!value || typeof value !== "object") return false;
  const origin = value as Partial<PersistedQueueOrigin>;
  if (origin.kind === "direct")
    return (
      typeof origin.nativePath === "string" && origin.nativePath.length > 0
    );
  if (origin.kind === "removable")
    return (
      typeof origin.deviceId === "string" &&
      /^usb-[0-9a-f]{32}$/.test(origin.deviceId) &&
      typeof origin.relativePath === "string" &&
      typeof origin.entryId === "string" &&
      /^entry-[0-9a-f]{32}$/.test(origin.entryId)
    );
  return (
    origin.kind === "folders" &&
    typeof origin.sourceId === "string" &&
    /^[0-9a-f-]{36}$/i.test(origin.sourceId) &&
    typeof origin.relativePath === "string" &&
    (origin.libraryTrackId === undefined ||
      (typeof origin.libraryTrackId === "string" &&
        /^track-[0-9a-f]{32}$/.test(origin.libraryTrackId)))
  );
}

function isItem(value: unknown): value is PersistedQueueItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PersistedQueueItem>;
  return (
    typeof item.id === "string" &&
    /^queue-[0-9a-f-]{36}$/i.test(item.id) &&
    isOrigin(item.origin) &&
    typeof item.filename === "string" &&
    item.filename.length > 0 &&
    typeof item.displayTitle === "string"
  );
}

function parseSession(value: unknown): PersistedPlayerSession | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<PersistedPlayerSession>;
  if (
    session.version !== 1 ||
    typeof session.currentQueueItemId !== "string" ||
    !Array.isArray(session.queue) ||
    !session.queue.every(isItem) ||
    !session.queue.some((item) => item.id === session.currentQueueItemId)
  )
    return null;
  return {
    version: 1,
    currentQueueItemId: session.currentQueueItemId,
    queue: session.queue,
  };
}

export function playerSessionConfigPath(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const platformPath = platform === "win32" ? win32 : posix;
  return platformPath.join(
    resolveAppDirectories(platform, environment, home ?? undefined).config,
    "player-session.json",
  );
}

export class PlayerSessionRepository {
  constructor(readonly configPath = playerSessionConfigPath()) {}

  async read(): Promise<PersistedPlayerSession | null> {
    let text: string;
    try {
      text = await readFile(this.configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      const session = parseSession(JSON.parse(text) as unknown);
      if (!session) await this.preserveCorrupt();
      return session;
    } catch {
      await this.preserveCorrupt();
      return null;
    }
  }

  async write(session: PersistedPlayerSession): Promise<void> {
    const directory = dirname(this.configPath);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.configPath}.${String(process.pid)}-${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.configPath);
  }

  async clear(): Promise<void> {
    await rm(this.configPath, { force: true });
  }

  private async preserveCorrupt(): Promise<void> {
    const backup = `${this.configPath}.corrupt-${String(Date.now())}`;
    await copyFile(this.configPath, backup).catch(() => undefined);
    await rm(this.configPath, { force: true }).catch(() => undefined);
  }
}
