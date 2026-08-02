import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ExternalPlaybackEndPolicy,
  PlaybackSourceKind,
} from "../../../../packages/shared/src/playback-source.js";
import { resolveAppDirectories } from "../platform/app-directories.js";

const SCHEMA_VERSION = 1;
const ID_PATTERN = /^[a-z][a-z0-9-]{0,95}$/u;

export interface PlaybackArbitrationDocument {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly transitionGeneration: number;
  readonly activeSource: PlaybackSourceKind;
  readonly phase:
    | "local-idle"
    | "local-active"
    | "acquiring-external"
    | "external-active"
    | "releasing-external"
    | "acquiring-local"
    | "recovering"
    | "error";
  readonly providerSessionId: string | null;
  readonly localSuspensionId: string | null;
  readonly localSessionRevision: number | null;
  readonly localOccurrenceId: string | null;
  readonly localWasPlaying: boolean;
  readonly suspendedAt: string | null;
  readonly endPolicy: ExternalPlaybackEndPolicy;
  readonly lastTransitionResult: {
    readonly code: string;
    readonly success: boolean;
  } | null;
  readonly updatedAt: string;
}

export interface PlaybackArbitrationStoreSnapshot {
  readonly document: PlaybackArbitrationDocument;
  readonly readOnly: boolean;
  readonly degraded: boolean;
}

export function defaultPlaybackArbitrationDocument(): PlaybackArbitrationDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    transitionGeneration: 0,
    activeSource: "local",
    phase: "local-idle",
    providerSessionId: null,
    localSuspensionId: null,
    localSessionRevision: null,
    localOccurrenceId: null,
    localWasPlaying: false,
    suspendedAt: null,
    endPolicy: "keep-paused",
    lastTransitionResult: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function parseDocument(value: unknown): PlaybackArbitrationStoreSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Playback arbitration store is malformed.");
  const record = value as Record<string, unknown>;
  if (
    typeof record.schemaVersion !== "number" ||
    !Number.isSafeInteger(record.schemaVersion) ||
    record.schemaVersion < 1
  )
    throw new Error("Playback arbitration schema is invalid.");
  if (record.schemaVersion > SCHEMA_VERSION)
    return {
      document: defaultPlaybackArbitrationDocument(),
      readOnly: true,
      degraded: true,
    };
  const sources: readonly PlaybackSourceKind[] = [
    "local",
    "airplay",
    "spotify",
  ];
  const phases: readonly PlaybackArbitrationDocument["phase"][] = [
    "local-idle",
    "local-active",
    "acquiring-external",
    "external-active",
    "releasing-external",
    "acquiring-local",
    "recovering",
    "error",
  ];
  if (
    !Number.isSafeInteger(record.revision) ||
    Number(record.revision) < 0 ||
    !Number.isSafeInteger(record.transitionGeneration) ||
    Number(record.transitionGeneration) < 0 ||
    !sources.includes(record.activeSource as PlaybackSourceKind) ||
    !phases.includes(record.phase as PlaybackArbitrationDocument["phase"]) ||
    !(record.providerSessionId === null || isId(record.providerSessionId)) ||
    !(record.localSuspensionId === null || isId(record.localSuspensionId)) ||
    !(
      record.localSessionRevision === null ||
      (Number.isSafeInteger(record.localSessionRevision) &&
        Number(record.localSessionRevision) >= 0)
    ) ||
    !(record.localOccurrenceId === null || isId(record.localOccurrenceId)) ||
    typeof record.localWasPlaying !== "boolean" ||
    !(record.suspendedAt === null || isTimestamp(record.suspendedAt)) ||
    !(
      record.endPolicy === "keep-paused" ||
      record.endPolicy === "resume-interrupted"
    ) ||
    !isTimestamp(record.updatedAt)
  )
    throw new Error("Playback arbitration store is malformed.");
  let result: PlaybackArbitrationDocument["lastTransitionResult"] = null;
  if (record.lastTransitionResult !== null) {
    if (
      !record.lastTransitionResult ||
      typeof record.lastTransitionResult !== "object" ||
      Array.isArray(record.lastTransitionResult)
    )
      throw new Error("Playback arbitration transition result is invalid.");
    const candidate = record.lastTransitionResult as Record<string, unknown>;
    if (!isId(candidate.code) || typeof candidate.success !== "boolean")
      throw new Error("Playback arbitration transition result is invalid.");
    result = { code: candidate.code, success: candidate.success };
  }
  return {
    document: {
      schemaVersion: SCHEMA_VERSION,
      revision: Number(record.revision),
      transitionGeneration: Number(record.transitionGeneration),
      activeSource: record.activeSource as PlaybackSourceKind,
      phase: record.phase as PlaybackArbitrationDocument["phase"],
      providerSessionId: record.providerSessionId,
      localSuspensionId: record.localSuspensionId,
      localSessionRevision: record.localSessionRevision as number | null,
      localOccurrenceId: record.localOccurrenceId,
      localWasPlaying: record.localWasPlaying,
      suspendedAt: record.suspendedAt,
      endPolicy: record.endPolicy,
      lastTransitionResult: result,
      updatedAt: record.updatedAt,
    },
    readOnly: false,
    degraded: false,
  };
}

function defaultPath(): string {
  const override = process.env.EIDETIC_PLAYBACK_ARBITRATION_STORE_PATH;
  if (override) return override;
  if (process.platform === "win32")
    return join(resolveAppDirectories().config, "playback-arbitration.json");
  const root = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(root, "eidetic-player", "playback-arbitration.json");
}

async function assertSafeOwner(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink())
    throw new Error("Playback arbitration storage cannot use symbolic links.");
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    stats.uid !== process.getuid()
  )
    throw new Error("Playback arbitration storage has an unexpected owner.");
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EISDIR")
      )
    )
      throw error;
  } finally {
    await handle.close();
  }
}

export class PlaybackArbitrationStore {
  readonly path: string;
  private readOnly = false;

  constructor(path = defaultPath()) {
    this.path = path;
  }

  async load(): Promise<PlaybackArbitrationStoreSnapshot> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await assertSafeOwner(directory);
    if (process.platform !== "win32") await chmod(directory, 0o700);
    try {
      await assertSafeOwner(this.path);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return {
          document: defaultPlaybackArbitrationDocument(),
          readOnly: false,
          degraded: false,
        };
      throw error;
    }
    try {
      const parsed = parseDocument(
        JSON.parse(await readFile(this.path, "utf8")) as unknown,
      );
      this.readOnly = parsed.readOnly;
      if (process.platform !== "win32") await chmod(this.path, 0o600);
      return parsed;
    } catch {
      this.readOnly = true;
      return {
        document: defaultPlaybackArbitrationDocument(),
        readOnly: true,
        degraded: true,
      };
    }
  }

  async save(document: PlaybackArbitrationDocument): Promise<void> {
    if (this.readOnly)
      throw new Error("Playback arbitration storage is read-only.");
    const parsed = parseDocument(document);
    if (parsed.readOnly)
      throw new Error("A future playback arbitration store is read-only.");
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await assertSafeOwner(directory);
    if (process.platform !== "win32") await chmod(directory, 0o700);
    try {
      await assertSafeOwner(this.path);
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    const temporary = join(
      directory,
      `.playback-arbitration.${String(process.pid)}.${randomUUID()}.tmp`,
    );
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(parsed.document, null, 2)}\n`);
      await handle.sync();
      if (process.platform !== "win32") await handle.chmod(0o600);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    await handle.close();
    try {
      await rename(temporary, this.path);
      if (process.platform !== "win32") await chmod(this.path, 0o600);
      await syncDirectory(directory);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
