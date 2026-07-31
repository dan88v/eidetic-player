import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveAppDirectories } from "../platform/app-directories.js";

const SCHEMA_VERSION = 1;
const DEVICE_ID_PATTERN = /^remote-device-[0-9a-f]{32}$/u;
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface StoredRemoteDevice {
  readonly id: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly [key: string]: unknown;
}

export interface RemoteAccessStoreDocument {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly enabled: boolean;
  readonly devices: readonly StoredRemoteDevice[];
  readonly [key: string]: unknown;
}

export interface RemoteAccessStoreSnapshot {
  readonly document: RemoteAccessStoreDocument;
  readonly readOnly: boolean;
}

function defaultDocument(): RemoteAccessStoreDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    enabled: false,
    devices: [],
  };
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function normalizeRemoteDeviceName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Device name must be text.");
  const normalized = value.normalize("NFC").trim();
  let hasControlCharacter = false;
  for (const character of normalized) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      hasControlCharacter = true;
      break;
    }
  }
  if (normalized.length < 1 || normalized.length > 40 || hasControlCharacter)
    throw new Error("Device name must contain 1 to 40 safe characters.");
  return normalized;
}

function parseDevice(value: unknown): StoredRemoteDevice {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Remote Access device is invalid.");
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !DEVICE_ID_PATTERN.test(record.id) ||
    typeof record.tokenHash !== "string" ||
    !TOKEN_HASH_PATTERN.test(record.tokenHash) ||
    !validTimestamp(record.createdAt) ||
    !validTimestamp(record.lastSeenAt) ||
    !validTimestamp(record.expiresAt)
  )
    throw new Error("Remote Access device is invalid.");
  return {
    ...record,
    id: record.id,
    name: normalizeRemoteDeviceName(record.name),
    tokenHash: record.tokenHash,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    expiresAt: record.expiresAt,
  };
}

function parseDocument(value: unknown): RemoteAccessStoreSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Remote Access store is malformed.");
  const record = value as Record<string, unknown>;
  if (
    typeof record.schemaVersion !== "number" ||
    !Number.isSafeInteger(record.schemaVersion) ||
    record.schemaVersion < 1
  )
    throw new Error("Remote Access schema version is invalid.");
  if (record.schemaVersion > SCHEMA_VERSION)
    return {
      document: defaultDocument(),
      readOnly: true,
    };
  if (
    typeof record.revision !== "number" ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 1 ||
    typeof record.enabled !== "boolean" ||
    !Array.isArray(record.devices) ||
    record.devices.length > 8
  )
    throw new Error("Remote Access store is malformed.");
  return {
    document: {
      ...record,
      schemaVersion: SCHEMA_VERSION,
      revision: record.revision,
      enabled: record.enabled,
      devices: record.devices.map(parseDevice),
    },
    readOnly: false,
  };
}

async function assertSafeOwner(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink())
    throw new Error("Remote Access store cannot use symbolic links.");
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    stats.uid !== process.getuid()
  )
    throw new Error("Remote Access store has an unexpected owner.");
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

export class RemoteAccessStore {
  readonly path: string;

  constructor(
    path = process.env.EIDETIC_REMOTE_ACCESS_STORE_PATH ??
      join(resolveAppDirectories().config, "remote-access.json"),
  ) {
    this.path = path;
  }

  async load(): Promise<RemoteAccessStoreSnapshot> {
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
        return { document: defaultDocument(), readOnly: false };
      throw error;
    }
    const parsed = parseDocument(
      JSON.parse(await readFile(this.path, "utf8")) as unknown,
    );
    if (process.platform !== "win32") await chmod(this.path, 0o600);
    return parsed;
  }

  async save(document: RemoteAccessStoreDocument): Promise<void> {
    const parsed = parseDocument(document);
    if (parsed.readOnly)
      throw new Error("A future Remote Access store is read-only.");
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
      `.remote-access.${String(process.pid)}.${crypto.randomUUID()}.tmp`,
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
