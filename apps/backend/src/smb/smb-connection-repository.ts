import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";
import { resolveAppDirectories } from "../platform/app-directories.js";
import type { SmbConnectionRecord } from "./smb-types.js";

interface SmbConfig {
  readonly version: 1;
  readonly connections: readonly SmbConnectionRecord[];
}

function validRecord(value: unknown): value is SmbConnectionRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    !("password" in item) &&
    !("nativeRoot" in item) &&
    !("mountPoint" in item) &&
    typeof item.id === "string" &&
    /^smb-[0-9a-f]{32}$/u.test(item.id) &&
    typeof item.displayName === "string" &&
    typeof item.server === "string" &&
    typeof item.share === "string" &&
    (item.authMode === "account" || item.authMode === "guest") &&
    (item.username === undefined || typeof item.username === "string") &&
    (item.domain === undefined || typeof item.domain === "string") &&
    (item.credentialReference === undefined ||
      typeof item.credentialReference === "string") &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

export function smbConnectionsPath(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const path = platform === "win32" ? win32 : posix;
  return path.join(
    resolveAppDirectories(platform, environment, home).config,
    "smb-connections.json",
  );
}

export class SmbConnectionRepository {
  private records: SmbConnectionRecord[] | null = null;

  constructor(readonly configPath = smbConnectionsPath()) {}

  async list(): Promise<readonly SmbConnectionRecord[]> {
    await this.load();
    return [...(this.records ?? [])];
  }

  async replace(records: readonly SmbConnectionRecord[]): Promise<void> {
    const next = [...records];
    const folder = dirname(this.configPath);
    await mkdir(folder, { recursive: true });
    const temporary = `${this.configPath}.${String(process.pid)}-${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify({ version: 1, connections: next } satisfies SmbConfig, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporary, this.configPath);
    this.records = next;
  }

  private async load(): Promise<void> {
    if (this.records) return;
    try {
      const parsed = JSON.parse(
        await readFile(this.configPath, "utf8"),
      ) as Partial<SmbConfig>;
      this.records = Array.isArray(parsed.connections)
        ? parsed.connections.filter(validRecord)
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.records = [];
        return;
      }
      await copyFile(
        this.configPath,
        `${this.configPath}.corrupt-${String(Date.now())}`,
      ).catch(() => undefined);
      this.records = [];
    }
  }
}
