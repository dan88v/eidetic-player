import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { resolveAppDirectories } from "../platform/app-directories.js";
import { LibraryFutureVersionError, LibraryError } from "./library-errors.js";
import {
  LIBRARY_SCHEMA_VERSION,
  migrateLibraryDatabase,
} from "./library-migrations.js";
import type { LibraryDatabaseDiagnostics } from "./library-types.js";
import { normalizeLibrarySearchKey } from "./library-normalization.js";

const BUSY_TIMEOUT_MILLISECONDS = 2_500;

export function libraryDatabasePath(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const platformPath = platform === "win32" ? win32 : posix;
  return platformPath.join(
    resolveAppDirectories(platform, environment, home ?? undefined).data,
    "library.db",
  );
}

function scalarText(
  database: DatabaseSync,
  query: string,
  field: string,
): string {
  const row = database.prepare(query).get() as
    Record<string, unknown> | undefined;
  const value = row?.[field];
  return typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "bigint"
      ? String(value)
      : "";
}

function scalarNumber(
  database: DatabaseSync,
  query: string,
  field: string,
): number {
  const row = database.prepare(query).get() as
    Record<string, unknown> | undefined;
  const value = row?.[field];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function integrityIsValid(database: DatabaseSync): boolean {
  return scalarText(database, "PRAGMA quick_check", "quick_check") === "ok";
}

async function preserveCorruptDatabase(path: string): Promise<string> {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backup = join(dirname(path), `library.corrupt-${timestamp}.db`);
  await rename(path, backup);
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${path}${suffix}`;
    if (existsSync(sidecar))
      await rename(sidecar, `${backup}${suffix}`).catch(() => undefined);
  }
  return backup;
}

export class LibraryDatabase {
  readonly connection: DatabaseSync;
  readonly diagnostics: LibraryDatabaseDiagnostics;
  private closed = false;
  private maximumTransactionMilliseconds = 0;
  private totalTransactionMilliseconds = 0;
  private transactionCount = 0;

  private constructor(
    readonly path: string,
    connection: DatabaseSync,
    diagnostics: LibraryDatabaseDiagnostics,
  ) {
    this.connection = connection;
    this.diagnostics = diagnostics;
  }

  static async open(path = libraryDatabasePath()): Promise<LibraryDatabase> {
    const openedAt = performance.now();
    await mkdir(dirname(path), { recursive: true });
    let recoveredCorruptPath: string | null = null;
    let connection: DatabaseSync | null = null;
    const existed = existsSync(path);

    try {
      connection = new DatabaseSync(path);
      if (existed && !integrityIsValid(connection))
        throw new LibraryError(
          "LIBRARY_DATABASE_CORRUPT",
          "The Library database failed its integrity check.",
          500,
        );
    } catch (error) {
      try {
        connection?.close();
      } catch {
        // A failed open may not own a usable handle.
      }
      if (error instanceof LibraryFutureVersionError || !existsSync(path))
        throw error;
      recoveredCorruptPath = await preserveCorruptDatabase(path);
      console.warn(
        `[library] corrupt database preserved as ${recoveredCorruptPath}`,
      );
      connection = new DatabaseSync(path);
    }

    connection.exec("PRAGMA foreign_keys = ON");
    connection.exec(
      `PRAGMA busy_timeout = ${String(BUSY_TIMEOUT_MILLISECONDS)}`,
    );
    connection.exec("PRAGMA journal_mode = WAL");
    connection.exec("PRAGMA synchronous = NORMAL");
    connection.exec("PRAGMA wal_autocheckpoint = 1000");
    connection.function(
      "library_search_key",
      { deterministic: true, directOnly: true },
      (value: unknown) =>
        normalizeLibrarySearchKey(typeof value === "string" ? value : ""),
    );
    const migrationStarted = performance.now();
    let schemaVersion: number;
    try {
      schemaVersion = migrateLibraryDatabase(connection);
    } catch (error) {
      connection.close();
      throw error;
    }
    const migrationMilliseconds = performance.now() - migrationStarted;
    if (!integrityIsValid(connection)) {
      connection.close();
      throw new LibraryError(
        "LIBRARY_DATABASE_CORRUPT",
        "The rebuilt Library database failed its integrity check.",
        500,
      );
    }
    const diagnostics: LibraryDatabaseDiagnostics = {
      path,
      sqliteVersion: scalarText(
        connection,
        "SELECT sqlite_version() AS version",
        "version",
      ),
      schemaVersion,
      journalMode: scalarText(
        connection,
        "PRAGMA journal_mode",
        "journal_mode",
      ),
      synchronous: scalarNumber(
        connection,
        "PRAGMA synchronous",
        "synchronous",
      ),
      foreignKeys:
        scalarNumber(connection, "PRAGMA foreign_keys", "foreign_keys") === 1,
      busyTimeoutMilliseconds: scalarNumber(
        connection,
        "PRAGMA busy_timeout",
        "timeout",
      ),
      openedInMilliseconds: performance.now() - openedAt,
      migrationMilliseconds,
      recoveredCorruptPath,
    };
    return new LibraryDatabase(path, connection, diagnostics);
  }

  transaction<T>(operation: () => T): T {
    this.ensureOpen();
    const startedAt = performance.now();
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    } finally {
      const elapsed = performance.now() - startedAt;
      this.maximumTransactionMilliseconds = Math.max(
        this.maximumTransactionMilliseconds,
        elapsed,
      );
      this.totalTransactionMilliseconds += elapsed;
      this.transactionCount += 1;
    }
  }

  integrityCheck(): boolean {
    this.ensureOpen();
    return integrityIsValid(this.connection);
  }

  getTransactionDiagnostics(): {
    readonly maximumMilliseconds: number;
    readonly averageMilliseconds: number;
    readonly count: number;
  } {
    return {
      maximumMilliseconds: this.maximumTransactionMilliseconds,
      averageMilliseconds:
        this.transactionCount === 0
          ? 0
          : this.totalTransactionMilliseconds / this.transactionCount,
      count: this.transactionCount,
    };
  }

  close(): void {
    if (this.closed) return;
    this.connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.connection.close();
    this.closed = true;
  }

  private ensureOpen(): void {
    if (this.closed)
      throw new LibraryError(
        "LIBRARY_DATABASE_CLOSED",
        "The Library database is closed.",
        503,
      );
  }
}

export { BUSY_TIMEOUT_MILLISECONDS, LIBRARY_SCHEMA_VERSION };
