import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";
import { resolveAppDirectories } from "../platform/app-directories.js";
import type { SourceConfig, StoredSource } from "./filesystem-types.js";

function isStoredSource(value: unknown): value is StoredSource {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredSource>;
  return (
    typeof record.id === "string" &&
    /^[0-9a-f-]{36}$/i.test(record.id) &&
    record.type === "local" &&
    typeof record.displayName === "string" &&
    record.displayName.trim().length > 0 &&
    typeof record.nativeRoot === "string" &&
    record.nativeRoot.length > 0 &&
    typeof record.canonicalRoot === "string" &&
    record.canonicalRoot.length > 0 &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

export function sourcesConfigPath(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const platformPath = platform === "win32" ? win32 : posix;
  return platformPath.join(
    resolveAppDirectories(platform, environment, home ?? undefined).config,
    "sources.json",
  );
}

export class SourceRepository {
  private records: StoredSource[] | null = null;

  constructor(readonly configPath = sourcesConfigPath()) {}

  async list(): Promise<readonly StoredSource[]> {
    await this.ensureLoaded();
    return [...(this.records ?? [])];
  }

  async replace(records: readonly StoredSource[]): Promise<void> {
    const next = [...records];
    await this.writeAtomic({ version: 1, sources: next });
    this.records = next;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.records) return;
    let text: string;
    try {
      text = await readFile(this.configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.records = [];
        return;
      }
      throw error;
    }
    try {
      const parsed = JSON.parse(text) as Partial<SourceConfig>;
      const candidates = Array.isArray(parsed.sources) ? parsed.sources : [];
      this.records = candidates.filter(isStoredSource);
    } catch {
      const backup = `${this.configPath}.corrupt-${String(Date.now())}`;
      await copyFile(this.configPath, backup).catch(() => undefined);
      this.records = [];
    }
  }

  private async writeAtomic(config: SourceConfig): Promise<void> {
    const directory = dirname(this.configPath);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.configPath}.${String(process.pid)}-${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.configPath);
  }
}
