import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  defaultUiPreferences,
  isUiPreferenceKey,
  isValidUiPreferenceValue,
  uiPreferenceKeys,
  type LegacyPreferencesImport,
  type LegacyPreferencesMigration,
  type PreferencesPatch,
  type PreferencesPersistence,
  type PreferencesSnapshot,
  type UiPreferences,
} from "../../../../packages/shared/src/preferences.js";
import { displayTimeoutsAreCompatible } from "../../../../packages/shared/src/display.js";
import { resolveAppDirectories } from "../platform/app-directories.js";

const schemaVersion = 3 as const;
const preferencesFilename = "preferences.json";
const backupFilename = "preferences.json.bak";

type JsonObject = Record<string, unknown>;

interface StoredPreferencesDocument extends JsonObject {
  schemaVersion: 3;
  revision: number;
  preferences: JsonObject;
  migration: JsonObject;
}

export class PreferencesError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 500,
  ) {
    super(message);
    this.name = "PreferencesError";
  }
}

interface LoadedDocument {
  readonly raw: StoredPreferencesDocument;
  readonly preferences: UiPreferences;
  readonly invalidFields: readonly string[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrationState(raw: JsonObject): LegacyPreferencesImport {
  const value = raw.legacyLocalStorage;
  if (
    value === "imported" ||
    value === "not-found" ||
    value === "manual-required" ||
    value === "manual"
  )
    return value;
  return "required";
}

function storedMigrationState(
  value: LegacyPreferencesImport,
): "pending" | "imported" | "not-found" | "manual-required" | "manual" {
  return value === "required" ? "pending" : value;
}

function runtimePreferences(value: JsonObject): {
  readonly preferences: UiPreferences;
  readonly invalidFields: readonly string[];
} {
  const preferences = { ...defaultUiPreferences };
  const invalidFields: string[] = [];
  for (const key of uiPreferenceKeys) {
    if (!(key in value)) continue;
    const candidate = value[key];
    if (isValidUiPreferenceValue(key, candidate))
      Object.assign(preferences, { [key]: candidate });
    else invalidFields.push(key);
  }
  if (
    !displayTimeoutsAreCompatible(
      preferences.screenDimTimeoutSeconds,
      preferences.screenStandbyTimeoutSeconds,
    )
  ) {
    preferences.screenStandbyTimeoutSeconds =
      defaultUiPreferences.screenStandbyTimeoutSeconds;
    invalidFields.push("screenStandbyTimeoutSeconds");
  }
  return { preferences, invalidFields };
}

function parseDocument(value: unknown): LoadedDocument {
  if (!isObject(value))
    throw new PreferencesError(
      "PREFERENCES_CORRUPT",
      "Settings storage is invalid.",
    );
  if (
    value.schemaVersion === 0 ||
    value.schemaVersion === 1 ||
    value.schemaVersion === 2
  ) {
    const sourceSchema = value.schemaVersion;
    const legacyPreferences = isObject(value.preferences)
      ? value.preferences
      : value;
    value = {
      ...value,
      schemaVersion,
      revision:
        Number.isSafeInteger(value.revision) && Number(value.revision) >= 0
          ? value.revision
          : 0,
      preferences: legacyPreferences,
      migration: {
        ...(isObject(value.migration) ? value.migration : {}),
        legacyLocalStorage:
          sourceSchema === 0
            ? "imported"
            : isObject(value.migration)
              ? (value.migration.legacyLocalStorage ?? "pending")
              : "pending",
        sourceSchema,
      },
    };
  }
  if (!isObject(value)) throw new Error("unreachable");
  if (
    typeof value.schemaVersion === "number" &&
    value.schemaVersion > schemaVersion
  )
    throw new PreferencesError(
      "PREFERENCES_FUTURE_SCHEMA",
      "Settings were created by a newer application version.",
      409,
    );
  if (
    value.schemaVersion !== schemaVersion ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !isObject(value.preferences) ||
    !isObject(value.migration)
  )
    throw new PreferencesError(
      "PREFERENCES_CORRUPT",
      "Settings storage is invalid.",
    );
  const parsed = runtimePreferences(value.preferences);
  return {
    raw: value as StoredPreferencesDocument,
    ...parsed,
  };
}

function defaultDocument(): StoredPreferencesDocument {
  return {
    schemaVersion,
    revision: 0,
    preferences: { ...defaultUiPreferences },
    migration: {
      legacyLocalStorage: "pending",
      sourceSchema: 3,
    },
  };
}

export class PreferencesStore {
  private readonly configRoot: string;
  private readonly filePath: string;
  private readonly backupPath: string;
  private raw = defaultDocument();
  private current = defaultUiPreferences;
  private persistence: PreferencesPersistence = "defaults";
  private legacyImport: LegacyPreferencesImport = "required";
  private warning = false;
  private readOnly = false;
  private initialized = false;
  private legacyFallbackRequired = false;
  private operation: Promise<void> = Promise.resolve();

  constructor(configRoot = resolveAppDirectories().config) {
    this.configRoot = resolve(configRoot);
    this.filePath = resolve(this.configRoot, preferencesFilename);
    this.backupPath = resolve(this.configRoot, backupFilename);
    if (
      dirname(this.filePath) !== this.configRoot ||
      dirname(this.backupPath) !== this.configRoot
    )
      throw new PreferencesError(
        "PREFERENCES_PATH_INVALID",
        "Settings storage path is invalid.",
      );
  }

  async initialize(): Promise<PreferencesSnapshot> {
    try {
      return await this.initializeNow();
    } catch {
      this.persistence = "degraded";
      this.legacyImport = "manual-required";
      this.warning = true;
      this.readOnly = true;
      this.initialized = true;
      console.warn("[preferences] settings storage is unavailable");
      return this.snapshot();
    }
  }

  private async initializeNow(): Promise<PreferencesSnapshot> {
    this.legacyFallbackRequired =
      (await readdir(this.configRoot).catch(() => [] as string[])).length > 0;
    await this.ensureConfigRoot();
    const main = await this.readStored(this.filePath);
    if (main.kind === "valid") {
      this.accept(main.value, "persisted");
    } else if (main.kind === "future") {
      this.readOnly = true;
      this.persistence = "degraded";
      this.warning = true;
      console.warn("[preferences] future schema preserved; writes disabled");
    } else if (main.kind === "invalid") {
      const backup = await this.readStored(this.backupPath);
      if (backup.kind === "valid") {
        this.accept(backup.value, "recovered");
        this.warning = true;
        console.warn("[preferences] using last-known-good backup");
      } else {
        this.persistence = "degraded";
        this.legacyImport = "manual-required";
        this.warning = true;
        this.readOnly = true;
        console.warn(
          "[preferences] settings files preserved for manual review",
        );
      }
    }
    this.initialized = true;
    return this.snapshot();
  }

  snapshot(): PreferencesSnapshot {
    return {
      schemaVersion,
      revision: this.raw.revision,
      preferences: { ...this.current },
      persistence: this.persistence,
      legacyImport: this.legacyImport,
      warning: this.warning,
    };
  }

  patch(patch: PreferencesPatch): Promise<PreferencesSnapshot> {
    return this.serialize(() => this.patchNow(patch));
  }

  migrateLegacy(
    migration: LegacyPreferencesMigration,
  ): Promise<PreferencesSnapshot> {
    return this.serialize(() => this.migrateLegacyNow(migration));
  }

  private async patchNow(
    patch: PreferencesPatch,
  ): Promise<PreferencesSnapshot> {
    this.assertWritable();
    if (
      patch.expectedRevision !== undefined &&
      patch.expectedRevision !== this.raw.revision
    )
      throw new PreferencesError(
        "PREFERENCES_REVISION_CONFLICT",
        "Settings changed in another request.",
        409,
      );
    const changes = this.validateChanges(patch.changes);
    if (Object.keys(changes).length === 0) return this.snapshot();
    const legacyImport =
      this.legacyImport === "required" ? "manual-required" : this.legacyImport;
    await this.commit(changes, legacyImport);
    return this.snapshot();
  }

  private async migrateLegacyNow(
    migration: LegacyPreferencesMigration,
  ): Promise<PreferencesSnapshot> {
    this.assertWritable();
    if (
      this.legacyImport !== "required" &&
      this.legacyImport !== "manual-required"
    )
      return this.snapshot();
    if (
      this.legacyImport === "manual-required" &&
      migration.confirmOverwrite !== true
    )
      throw new PreferencesError(
        "PREFERENCES_MIGRATION_CONFIRMATION_REQUIRED",
        "Confirm the manual settings import.",
        409,
      );
    const changes = this.validateChanges(migration.preferences);
    const hasChanges = Object.keys(changes).length > 0;
    const nextState: LegacyPreferencesImport =
      migration.confirmOverwrite === true && hasChanges
        ? "manual"
        : migration.sourceAvailable && hasChanges
          ? "imported"
          : !migration.sourceAvailable || this.legacyFallbackRequired
            ? "manual-required"
            : "not-found";
    await this.commit(changes, nextState);
    return this.snapshot();
  }

  private validateChanges(value: unknown): Partial<UiPreferences> {
    if (!isObject(value))
      throw new PreferencesError(
        "INVALID_PREFERENCES_PATCH",
        "Settings changes are invalid.",
        400,
      );
    const changes: Partial<UiPreferences> = {};
    for (const [key, candidate] of Object.entries(value)) {
      if (!isUiPreferenceKey(key) || !isValidUiPreferenceValue(key, candidate))
        throw new PreferencesError(
          "INVALID_PREFERENCES_PATCH",
          "Settings changes are invalid.",
          400,
        );
      Object.assign(changes, { [key]: candidate });
    }
    const next = { ...this.current, ...changes };
    if (
      !displayTimeoutsAreCompatible(
        next.screenDimTimeoutSeconds,
        next.screenStandbyTimeoutSeconds,
      )
    )
      throw new PreferencesError(
        "INVALID_PREFERENCES_PATCH",
        "Display standby must be later than the Dim timeout.",
        400,
      );
    return changes;
  }

  private async commit(
    changes: Partial<UiPreferences>,
    legacyImport: LegacyPreferencesImport,
  ): Promise<void> {
    const next: StoredPreferencesDocument = {
      ...this.raw,
      schemaVersion,
      revision: this.raw.revision + 1,
      preferences: { ...this.raw.preferences, ...changes },
      migration: {
        ...this.raw.migration,
        legacyLocalStorage: storedMigrationState(legacyImport),
        sourceSchema: 3,
      },
    };
    if (this.persistence === "persisted" || this.persistence === "recovered")
      await this.atomicWrite(this.backupPath, this.raw);
    await this.atomicWrite(this.filePath, next);
    const verified = parseDocument(
      JSON.parse(await readFile(this.filePath, "utf8")) as unknown,
    );
    if (verified.raw.revision !== next.revision)
      throw new PreferencesError(
        "PREFERENCES_VERIFY_FAILED",
        "Settings could not be verified.",
      );
    this.accept(verified, "persisted");
    this.legacyImport = legacyImport;
    this.warning = legacyImport === "manual-required";
  }

  private accept(
    loaded: LoadedDocument,
    persistence: PreferencesPersistence,
  ): void {
    this.raw = loaded.raw;
    this.current = loaded.preferences;
    this.persistence = persistence;
    this.legacyImport = migrationState(loaded.raw.migration);
    this.warning =
      loaded.invalidFields.length > 0 ||
      persistence === "recovered" ||
      this.legacyImport === "manual-required";
    for (const field of loaded.invalidFields)
      console.warn(`[preferences] invalid value ignored for ${field}`);
  }

  private async readStored(
    path: string,
  ): Promise<
    | { readonly kind: "missing" }
    | { readonly kind: "invalid" }
    | { readonly kind: "future" }
    | { readonly kind: "valid"; readonly value: LoadedDocument }
  > {
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if (
        isObject(error) &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      )
        return { kind: "missing" };
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile()) return { kind: "invalid" };
    if (process.platform !== "win32") {
      if (
        typeof process.getuid === "function" &&
        stats.uid !== process.getuid()
      )
        return { kind: "invalid" };
      if ((stats.mode & 0o077) !== 0) await chmod(path, 0o600);
    }
    try {
      return {
        kind: "valid",
        value: parseDocument(
          JSON.parse(await readFile(path, "utf8")) as unknown,
        ),
      };
    } catch (error) {
      if (
        error instanceof PreferencesError &&
        error.code === "PREFERENCES_FUTURE_SCHEMA"
      )
        return { kind: "future" };
      return { kind: "invalid" };
    }
  }

  private async ensureConfigRoot(): Promise<void> {
    await mkdir(this.configRoot, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.configRoot);
    if (stats.isSymbolicLink() || !stats.isDirectory())
      throw new PreferencesError(
        "PREFERENCES_PATH_INVALID",
        "Settings storage directory is invalid.",
      );
    const canonical = await realpath(this.configRoot);
    if (resolve(canonical) !== this.configRoot)
      throw new PreferencesError(
        "PREFERENCES_PATH_INVALID",
        "Settings storage directory is invalid.",
      );
    if (process.platform !== "win32") {
      if (
        typeof process.getuid === "function" &&
        stats.uid !== process.getuid()
      )
        throw new PreferencesError(
          "PREFERENCES_OWNER_INVALID",
          "Settings storage ownership is invalid.",
        );
      await chmod(this.configRoot, 0o700);
    }
  }

  private async atomicWrite(
    destination: string,
    document: StoredPreferencesDocument,
  ): Promise<void> {
    const temporary = resolve(
      this.configRoot,
      `.${preferencesFilename}.${String(process.pid)}.${randomUUID()}.tmp`,
    );
    if (dirname(temporary) !== this.configRoot)
      throw new PreferencesError(
        "PREFERENCES_PATH_INVALID",
        "Settings storage path is invalid.",
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
      if (process.platform !== "win32") await chmod(temporary, 0o600);
      await rename(temporary, destination);
      if (process.platform !== "win32") {
        await chmod(destination, 0o600);
        const directory = await open(this.configRoot, constants.O_RDONLY);
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error instanceof PreferencesError
        ? error
        : new PreferencesError(
            "PREFERENCES_WRITE_FAILED",
            "Settings could not be saved.",
          );
    }
  }

  private assertWritable(): void {
    if (!this.initialized)
      throw new PreferencesError(
        "PREFERENCES_NOT_READY",
        "Settings storage is not ready.",
        503,
      );
    if (this.readOnly)
      throw new PreferencesError(
        "PREFERENCES_READ_ONLY",
        "Settings storage is read-only.",
        409,
      );
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
