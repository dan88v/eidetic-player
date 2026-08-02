import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  normalizeAirPlayReceiverName,
  type AirPlayReceiverNameOrigin,
} from "../../../../packages/shared/src/airplay.js";
import { resolveAppDirectories } from "../platform/app-directories.js";

const SCHEMA_VERSION = 1 as const;
const FILE_NAME = "airplay.json";
const SUFFIX_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const AIRPLAY_INTEGRATION_VERSION =
  "shairport-sync-5.2.1-eidetic.2+nqptp-1.2.8";

export interface AirPlayDocument extends Record<string, unknown> {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly enabled: boolean;
  readonly receiverName: string;
  readonly receiverNameOrigin: AirPlayReceiverNameOrigin;
  readonly generatedSuffix: string;
  readonly integrationVersion: string;
  readonly updatedAt: string;
}

export class AirPlayStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 500,
  ) {
    super(message);
    this.name = "AirPlayStoreError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function generatedSuffix(): string {
  const bytes = randomBytes(2);
  return `${SUFFIX_ALPHABET.charAt(bytes.readUInt8(0) % SUFFIX_ALPHABET.length)}${SUFFIX_ALPHABET.charAt(bytes.readUInt8(1) % SUFFIX_ALPHABET.length)}`;
}

function createDefault(): AirPlayDocument {
  const suffix = generatedSuffix();
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    enabled: true,
    receiverName: `Eidetic Player - ${suffix}`,
    receiverNameOrigin: "generated",
    generatedSuffix: suffix,
    integrationVersion: AIRPLAY_INTEGRATION_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

function parseDocument(value: unknown): AirPlayDocument {
  if (!isRecord(value))
    throw new AirPlayStoreError(
      "AIRPLAY_STORE_CORRUPT",
      "AirPlay settings are invalid.",
    );
  if (
    typeof value.schemaVersion === "number" &&
    value.schemaVersion > SCHEMA_VERSION
  )
    throw new AirPlayStoreError(
      "AIRPLAY_STORE_FUTURE_SCHEMA",
      "AirPlay settings were created by a newer version.",
      409,
    );
  const receiverName = normalizeAirPlayReceiverName(value.receiverName);
  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    typeof value.enabled !== "boolean" ||
    !receiverName ||
    (value.receiverNameOrigin !== "generated" &&
      value.receiverNameOrigin !== "user") ||
    typeof value.generatedSuffix !== "string" ||
    !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{2}$/u.test(value.generatedSuffix) ||
    typeof value.integrationVersion !== "string" ||
    typeof value.updatedAt !== "string"
  )
    throw new AirPlayStoreError(
      "AIRPLAY_STORE_CORRUPT",
      "AirPlay settings are invalid.",
    );
  return {
    ...value,
    schemaVersion: SCHEMA_VERSION,
    revision: Number(value.revision),
    enabled: value.enabled,
    receiverName,
    receiverNameOrigin: value.receiverNameOrigin,
    generatedSuffix: value.generatedSuffix,
    integrationVersion: value.integrationVersion,
    updatedAt: value.updatedAt,
  };
}

export class AirPlayStore {
  private readonly root: string;
  private readonly path: string;
  private document = createDefault();
  private readOnly = false;
  private operation: Promise<void> = Promise.resolve();

  constructor(root = resolveAppDirectories().config) {
    this.root = resolve(root);
    this.path = resolve(this.root, FILE_NAME);
    if (dirname(this.path) !== this.root)
      throw new AirPlayStoreError(
        "AIRPLAY_STORE_PATH_INVALID",
        "AirPlay settings path is invalid.",
      );
  }

  async initialize(): Promise<AirPlayDocument> {
    await this.ensureRoot();
    let stats;
    try {
      stats = await lstat(this.path);
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        await this.write(this.document);
        return this.snapshot();
      }
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      this.readOnly = true;
      throw new AirPlayStoreError(
        "AIRPLAY_STORE_CORRUPT",
        "AirPlay settings are invalid.",
      );
    }
    if (process.platform !== "win32") {
      if (
        typeof process.getuid === "function" &&
        stats.uid !== process.getuid()
      ) {
        this.readOnly = true;
        throw new AirPlayStoreError(
          "AIRPLAY_STORE_OWNER_INVALID",
          "AirPlay settings ownership is invalid.",
        );
      }
      if ((stats.mode & 0o077) !== 0) await chmod(this.path, 0o600);
    }
    try {
      this.document = parseDocument(
        JSON.parse(await readFile(this.path, "utf8")) as unknown,
      );
      if (this.document.integrationVersion !== AIRPLAY_INTEGRATION_VERSION) {
        const migrated: AirPlayDocument = {
          ...this.document,
          revision: this.document.revision + 1,
          integrationVersion: AIRPLAY_INTEGRATION_VERSION,
          updatedAt: new Date().toISOString(),
        };
        await this.write(migrated);
        this.document = parseDocument(
          JSON.parse(await readFile(this.path, "utf8")) as unknown,
        );
      }
    } catch (error) {
      this.readOnly = true;
      throw error;
    }
    return this.snapshot();
  }

  snapshot(): AirPlayDocument {
    return { ...this.document };
  }

  save(changes: {
    readonly enabled?: boolean;
    readonly receiverName?: string;
  }): Promise<AirPlayDocument> {
    const result = this.operation.then(() => this.saveNow(changes));
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  regenerateGeneratedName(): Promise<AirPlayDocument> {
    const result = this.operation.then(() => this.regenerateGeneratedNameNow());
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async regenerateGeneratedNameNow(): Promise<AirPlayDocument> {
    if (this.readOnly)
      throw new AirPlayStoreError(
        "AIRPLAY_STORE_READ_ONLY",
        "AirPlay settings are read-only.",
        409,
      );
    if (this.document.receiverNameOrigin !== "generated")
      return this.snapshot();
    const suffix = generatedSuffix();
    const next: AirPlayDocument = {
      ...this.document,
      revision: this.document.revision + 1,
      receiverName: `Eidetic Player - ${suffix}`,
      generatedSuffix: suffix,
      integrationVersion: AIRPLAY_INTEGRATION_VERSION,
      updatedAt: new Date().toISOString(),
    };
    await this.write(next);
    this.document = parseDocument(
      JSON.parse(await readFile(this.path, "utf8")) as unknown,
    );
    return this.snapshot();
  }

  private async saveNow(changes: {
    readonly enabled?: boolean;
    readonly receiverName?: string;
  }): Promise<AirPlayDocument> {
    if (this.readOnly)
      throw new AirPlayStoreError(
        "AIRPLAY_STORE_READ_ONLY",
        "AirPlay settings are read-only.",
        409,
      );
    const name =
      changes.receiverName === undefined
        ? this.document.receiverName
        : normalizeAirPlayReceiverName(changes.receiverName);
    if (!name)
      throw new AirPlayStoreError(
        "INVALID_AIRPLAY_NAME",
        "Enter a receiver name from 1 to 40 visible characters.",
        400,
      );
    const next: AirPlayDocument = {
      ...this.document,
      revision: this.document.revision + 1,
      enabled: changes.enabled ?? this.document.enabled,
      receiverName: name,
      receiverNameOrigin:
        changes.receiverName === undefined
          ? this.document.receiverNameOrigin
          : "user",
      integrationVersion: AIRPLAY_INTEGRATION_VERSION,
      updatedAt: new Date().toISOString(),
    };
    await this.write(next);
    const verified = parseDocument(
      JSON.parse(await readFile(this.path, "utf8")) as unknown,
    );
    if (verified.revision !== next.revision)
      throw new AirPlayStoreError(
        "AIRPLAY_STORE_VERIFY_FAILED",
        "AirPlay settings could not be verified.",
      );
    this.document = verified;
    return this.snapshot();
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.root);
    if (
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      resolve(await realpath(this.root)) !== this.root
    )
      throw new AirPlayStoreError(
        "AIRPLAY_STORE_PATH_INVALID",
        "AirPlay settings path is invalid.",
      );
    if (process.platform !== "win32") {
      if (
        typeof process.getuid === "function" &&
        stats.uid !== process.getuid()
      )
        throw new AirPlayStoreError(
          "AIRPLAY_STORE_OWNER_INVALID",
          "AirPlay settings ownership is invalid.",
        );
      await chmod(this.root, 0o700);
    }
  }

  private async write(document: AirPlayDocument): Promise<void> {
    const temporary = resolve(
      this.root,
      `.${FILE_NAME}.${String(process.pid)}.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await open(
        temporary,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
        0o600,
      );
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.path);
      if (process.platform !== "win32") {
        await chmod(this.path, 0o600);
        const directory = await open(this.root, constants.O_RDONLY);
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error instanceof AirPlayStoreError
        ? error
        : new AirPlayStoreError(
            "AIRPLAY_STORE_WRITE_FAILED",
            "AirPlay settings could not be saved.",
          );
    }
  }
}
