import { randomBytes } from "node:crypto";
import type {
  AddSmbConnectionRequest,
  EditSmbConnectionRequest,
  SmbConnection,
  SmbConnectionState,
  SmbErrorCode,
  SmbSnapshot,
} from "../../../../packages/shared/src/smb.js";
import type { ResolvedSource } from "../filesystem/filesystem-types.js";
import type { FilesystemProvider } from "../filesystem/filesystem-provider.js";
import { PathService } from "../filesystem/path-service.js";
import { LimitedConcurrency } from "../utils/limited-concurrency.js";
import { SmbConnectionRepository } from "./smb-connection-repository.js";
import type { SmbCredentialStore } from "./smb-credential-store.js";
import {
  LinuxSmbCredentialStore,
  MemorySmbCredentialStore,
  WindowsSmbCredentialStore,
} from "./smb-credential-store.js";
import type { SmbPlatformAdapter } from "./smb-platform-adapter.js";
import type {
  SmbConnectionRecord,
  SmbCredential,
  SmbRuntimeState,
} from "./smb-types.js";
import { SmbError } from "./smb-types.js";

const retryDelays = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
const idPattern = /^smb-[0-9a-f]{32}$/u;
const hostnamePattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;
const ipv4Pattern =
  /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/u;

type SnapshotListener = (snapshot: SmbSnapshot) => void;

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function publicStateForError(code: SmbErrorCode): SmbConnectionState {
  if (code === "authentication-required" || code === "credential-conflict")
    return "authentication-required";
  if (code === "permission-required") return "permission-required";
  if (code === "unsupported") return "unsupported";
  if (code === "access-denied") return "mount-failed";
  return "offline";
}

function retryableError(code: SmbErrorCode): boolean {
  return ![
    "authentication-required",
    "credential-conflict",
    "permission-required",
    "unsupported",
  ].includes(code);
}

export class SmbConnectionService {
  private records: SmbConnectionRecord[] = [];
  private readonly states = new Map<string, SmbRuntimeState>();
  private readonly listeners = new Set<SnapshotListener>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly concurrency = new LimitedConcurrency(2);
  private readonly retryAttempts = new Map<string, number>();
  private readonly retryDue = new Map<string, number>();
  private retryTimer: NodeJS.Timeout | null = null;
  private revision = 0;
  private signature = "";
  private initialized = false;
  private closing = false;
  private hasDependentLibrarySources:
    ((connectionId: string) => Promise<boolean>) | null = null;

  constructor(
    private readonly provider: FilesystemProvider,
    private readonly paths: PathService,
    private readonly repository = new SmbConnectionRepository(),
    private readonly credentialStore: SmbCredentialStore = process.platform ===
    "win32"
      ? new WindowsSmbCredentialStore()
      : new LinuxSmbCredentialStore(),
    private readonly adapter: SmbPlatformAdapter,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.records = [...(await this.repository.list())];
    for (const record of this.records)
      this.states.set(record.id, {
        state: "connecting",
        readable: false,
        retryable: false,
      });
    this.publish();
    await Promise.allSettled(
      this.records.map((record) => this.connect(record)),
    );
  }

  configureLibraryDependencies(
    hasDependentLibrarySources: (connectionId: string) => Promise<boolean>,
  ): void {
    this.hasDependentLibrarySources = hasDependentLibrarySources;
  }

  snapshot(): SmbSnapshot {
    const connections = this.records.map((record) =>
      this.toPublic(record, this.states.get(record.id)),
    );
    return {
      revision: this.revision,
      configuredCount: connections.length,
      connectedCount: connections.filter(
        (connection) => connection.state === "connected" && connection.readable,
      ).length,
      connectingCount: connections.filter(
        (connection) => connection.state === "connecting",
      ).length,
      unavailableCount: connections.filter(
        (connection) =>
          connection.state !== "connected" && connection.state !== "connecting",
      ).length,
      connections,
    };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async add(input: AddSmbConnectionRequest): Promise<SmbConnection> {
    await this.ensureReady();
    const validated = this.validateAdd(input);
    this.assertUnique(validated.displayName, validated.server, validated.share);
    this.assertWindowsIdentity(validated.server, validated);
    const now = new Date().toISOString();
    const record: SmbConnectionRecord = {
      id: `smb-${randomBytes(16).toString("hex")}`,
      displayName: validated.displayName,
      server: validated.server,
      share: validated.share,
      authMode: validated.authMode,
      ...(validated.username ? { username: validated.username } : {}),
      ...(validated.domain ? { domain: validated.domain } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const credential = this.credentialFor(validated);
    let reference: string | undefined;
    let root: string | undefined;
    try {
      if (credential)
        reference = await this.credentialStore.write(record.id, credential);
      const stagedRecord = reference
        ? { ...record, credentialReference: reference }
        : record;
      const material = reference
        ? await this.credentialStore.read(reference)
        : null;
      const connection = await this.adapter.connect(stagedRecord, material);
      root = await this.verifyRoot(connection.root);
      const saved = reference
        ? { ...record, credentialReference: reference }
        : record;
      await this.repository.replace([...this.records, saved]);
      this.records.push(saved);
      this.states.set(saved.id, {
        state: "connected",
        readable: true,
        retryable: false,
        connectedAt: new Date().toISOString(),
        root,
      });
      this.publish();
      return this.toPublic(saved, this.states.get(saved.id));
    } catch (error) {
      await this.adapter.disconnect(record, root).catch(() => undefined);
      if (reference)
        await this.credentialStore.remove(reference).catch(() => undefined);
      throw this.asSmbError(error);
    }
  }

  async edit(
    id: string,
    input: EditSmbConnectionRequest,
  ): Promise<SmbConnection> {
    await this.ensureReady();
    const previous = this.requireRecord(id);
    const validated = this.validateEdit(input);
    this.assertUnique(
      validated.displayName,
      previous.server,
      previous.share,
      id,
    );
    this.assertWindowsIdentity(previous.server, validated, id);
    const identityChanged =
      previous.authMode !== validated.authMode ||
      (previous.username ?? "") !== (validated.username ?? "") ||
      (previous.domain ?? "") !== (validated.domain ?? "");
    if (
      validated.authMode === "account" &&
      identityChanged &&
      !validated.password
    )
      throw new SmbError(
        "invalid-request",
        "Enter the password for the changed account.",
        400,
      );
    const existingCredential = previous.credentialReference
      ? await this.credentialStore.read(previous.credentialReference)
      : null;
    const nextCredential =
      validated.authMode === "guest"
        ? null
        : validated.password
          ? this.credentialFor(validated)
          : existingCredential;
    if (validated.authMode === "account" && !nextCredential)
      throw new SmbError(
        "authentication-required",
        "SMB credentials are required.",
        400,
      );
    const candidate: SmbConnectionRecord = {
      ...previous,
      displayName: validated.displayName,
      authMode: validated.authMode,
      ...(validated.username ? { username: validated.username } : {}),
      ...(validated.domain ? { domain: validated.domain } : {}),
      updatedAt: new Date().toISOString(),
    };
    let temporaryReference: string | undefined;
    let candidateRoot: string | undefined;
    try {
      if (nextCredential)
        temporaryReference = await this.credentialStore.write(
          candidate.id,
          nextCredential,
        );
      const connectedRecord = temporaryReference
        ? { ...candidate, credentialReference: temporaryReference }
        : candidate;
      const material = temporaryReference
        ? await this.credentialStore.read(temporaryReference)
        : null;
      const result = await this.adapter.connect(connectedRecord, material);
      candidateRoot = result.root;
      const root = await this.verifyRoot(result.root);
      candidateRoot = root;
      const reference = temporaryReference ?? previous.credentialReference;
      if (validated.authMode === "account" && !reference)
        throw new SmbError(
          "authentication-required",
          "SMB credentials are required.",
        );
      let saved: SmbConnectionRecord;
      if (validated.authMode === "guest")
        saved = this.withoutAccount(candidate);
      else {
        if (!reference)
          throw new SmbError(
            "authentication-required",
            "SMB credentials are required.",
          );
        saved = { ...candidate, credentialReference: reference };
      }
      await this.repository.replace(
        this.records.map((record) => (record.id === id ? saved : record)),
      );
      if (
        validated.authMode === "guest" &&
        previous.credentialReference !== undefined
      )
        await this.credentialStore
          .remove(previous.credentialReference)
          .catch(() => undefined);
      this.records = this.records.map((record) =>
        record.id === id ? saved : record,
      );
      this.states.set(id, {
        state: "connected",
        readable: true,
        retryable: false,
        connectedAt: new Date().toISOString(),
        root,
      });
      this.retryAttempts.delete(id);
      this.retryDue.delete(id);
      this.publish();
      return this.toPublic(saved, this.states.get(id));
    } catch (error) {
      if (candidateRoot)
        await this.adapter
          .disconnect(candidate, candidateRoot)
          .catch(() => undefined);
      if (
        temporaryReference &&
        previous.credentialReference &&
        existingCredential
      ) {
        await this.credentialStore
          .write(previous.id, existingCredential)
          .catch(() => undefined);
      }
      if (candidateRoot) {
        const restoredCredential = previous.credentialReference
          ? await this.credentialStore
              .read(previous.credentialReference)
              .catch(() => null)
          : null;
        await this.adapter
          .connect(previous, restoredCredential)
          .then(async (restored) => {
            const root = await this.verifyRoot(restored.root);
            this.states.set(previous.id, {
              state: "connected",
              readable: true,
              retryable: false,
              connectedAt: new Date().toISOString(),
              root,
            });
            this.publish();
          })
          .catch(() => undefined);
      }
      throw this.asSmbError(error);
    }
  }

  async remove(id: string): Promise<void> {
    await this.ensureReady();
    const record = this.requireRecord(id);
    if (await this.hasDependentLibrarySources?.(id))
      throw new SmbError(
        "invalid-request",
        "Remove the related Library sources first.",
        409,
      );
    await this.serial(id, async () => {
      const root = this.states.get(id)?.root;
      await this.adapter.disconnect(record, root).catch(() => undefined);
      await this.repository.replace(
        this.records.filter((candidate) => candidate.id !== id),
      );
      if (record.credentialReference)
        await this.credentialStore
          .remove(record.credentialReference)
          .catch(() => undefined);
      this.records = this.records.filter((candidate) => candidate.id !== id);
      this.states.delete(id);
      this.retryAttempts.delete(id);
      this.retryDue.delete(id);
      this.schedule();
      this.publish();
    });
  }

  async retry(id: string): Promise<SmbConnection> {
    await this.ensureReady();
    const record = this.requireRecord(id);
    this.retryAttempts.delete(id);
    this.retryDue.delete(id);
    await this.connect(record);
    return this.toPublic(record, this.states.get(id));
  }

  async networkAvailable(): Promise<void> {
    await this.ensureReady();
    const retryable = this.records.filter(
      (record) => this.states.get(record.id)?.retryable === true,
    );
    for (const record of retryable) {
      this.retryAttempts.delete(record.id);
      this.retryDue.delete(record.id);
    }
    await Promise.allSettled(retryable.map((record) => this.connect(record)));
  }

  reportUnavailable(id: string): Promise<void> {
    const record = this.requireRecord(id);
    const previous = this.states.get(id);
    if (previous?.state !== "connected") return Promise.resolve();
    this.states.set(id, {
      state: "offline",
      readable: false,
      retryable: true,
      lastError: "network-unavailable",
    });
    this.publish();
    this.queueRetry(record.id);
    return Promise.resolve();
  }

  async getInternal(id: string): Promise<ResolvedSource<"smb">> {
    await this.ensureReady();
    const record = this.requireRecord(id);
    const state = this.states.get(id);
    if (!state?.readable || !state.root)
      throw new SmbError(
        "network-unavailable",
        "This network share is unavailable.",
      );
    return {
      id: record.id,
      type: "smb",
      displayName: record.displayName,
      nativeRoot: state.root,
      canonicalRoot: state.root,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async availabilityOf(id: string): Promise<"available" | "unavailable"> {
    await this.ensureReady();
    return this.states.get(id)?.readable === true ? "available" : "unavailable";
  }

  async resolveLogicalPath(id: string, relativePath: string): Promise<string> {
    const source = await this.getInternal(id);
    return this.paths.resolveWithinSource(source.canonicalRoot, relativePath);
  }

  async describeDirectory(
    connectionId: string,
    logicalRelativeRoot: string,
  ): Promise<{
    readonly connectionId: string;
    readonly logicalRelativeRoot: string;
    readonly displayName: string;
    readonly nativeRoot: string;
    readonly canonicalRoot: string;
  }> {
    const record = this.requireRecord(connectionId);
    const logicalRoot =
      this.paths.validateLogicalRelativePath(logicalRelativeRoot);
    const resolved = await this.resolvePersistentDirectory(
      connectionId,
      logicalRoot,
    );
    return {
      connectionId,
      logicalRelativeRoot: logicalRoot,
      displayName: logicalRoot
        ? (logicalRoot.split("/").at(-1) ?? record.displayName)
        : record.displayName,
      ...resolved,
    };
  }

  async resolvePersistentDirectory(
    connectionId: string,
    logicalRelativeRoot: string,
  ): Promise<{
    readonly nativeRoot: string;
    readonly canonicalRoot: string;
  }> {
    const connection = await this.getInternal(connectionId);
    const logicalRoot =
      this.paths.validateLogicalRelativePath(logicalRelativeRoot);
    const canonicalRoot = await this.paths.resolveWithinSource(
      connection.canonicalRoot,
      logicalRoot,
    );
    try {
      const details = await this.provider.lstat(canonicalRoot);
      if (details.isSymbolicLink() || !details.isDirectory())
        throw new Error("not a directory");
      await this.provider.access(canonicalRoot);
    } catch {
      throw new SmbError(
        "network-unavailable",
        "This network folder is unavailable.",
      );
    }
    return { nativeRoot: canonicalRoot, canonicalRoot };
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryDue.clear();
    await Promise.allSettled(
      this.records.map((record) =>
        this.adapter.disconnect(record, this.states.get(record.id)?.root),
      ),
    );
    await this.adapter.close();
    this.listeners.clear();
  }

  diagnostics() {
    return {
      configured: this.records.length,
      schedulerActive: this.retryTimer !== null,
      pendingRetries: this.retryDue.size,
      operations: this.operations.size,
    };
  }

  private async connect(record: SmbConnectionRecord): Promise<void> {
    await this.serial(record.id, () =>
      this.concurrency.run(async () => {
        if (this.closing) return;
        this.states.set(record.id, {
          state: "connecting",
          readable: false,
          retryable: false,
        });
        this.publish();
        try {
          const credential = record.credentialReference
            ? await this.credentialStore.read(record.credentialReference)
            : null;
          if (record.authMode === "account" && !credential)
            throw new SmbError(
              "authentication-required",
              "SMB credentials are required.",
            );
          const connected = await this.adapter.connect(record, credential);
          const root = await this.verifyRoot(connected.root);
          this.states.set(record.id, {
            state: "connected",
            readable: true,
            retryable: false,
            connectedAt: new Date().toISOString(),
            root,
          });
          this.retryAttempts.delete(record.id);
          this.retryDue.delete(record.id);
          this.schedule();
          this.publish();
        } catch (error) {
          const smbError = this.asSmbError(error);
          const retryable = retryableError(smbError.code as SmbErrorCode);
          this.states.set(record.id, {
            state: publicStateForError(smbError.code as SmbErrorCode),
            readable: false,
            retryable,
            lastError: smbError.code as SmbErrorCode,
          });
          this.publish();
          if (retryable) this.queueRetry(record.id);
        }
      }),
    );
  }

  private serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.operations.set(id, next);
    void next.finally(() => {
      if (this.operations.get(id) === next) this.operations.delete(id);
    });
    return next;
  }

  private queueRetry(id: string): void {
    const attempt = this.retryAttempts.get(id) ?? 0;
    const delay =
      retryDelays[Math.min(attempt, retryDelays.length - 1)] ?? 60_000;
    this.retryAttempts.set(id, attempt + 1);
    this.retryDue.set(id, Date.now() + delay);
    this.schedule();
  }

  private schedule(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.closing || this.retryDue.size === 0) return;
    const due = Math.min(...this.retryDue.values());
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null;
        const now = Date.now();
        const ids = [...this.retryDue.entries()]
          .filter(([, timestamp]) => timestamp <= now)
          .map(([id]) => id);
        for (const id of ids) this.retryDue.delete(id);
        void Promise.allSettled(
          ids.map(async (id) => {
            const record = this.records.find(
              (candidate) => candidate.id === id,
            );
            if (record) await this.connect(record);
          }),
        ).finally(() => {
          this.schedule();
        });
      },
      Math.max(0, due - Date.now()),
    );
    this.retryTimer.unref();
  }

  private publish(): void {
    const before = this.revision;
    const snapshot = this.snapshot();
    const signature = JSON.stringify({
      ...snapshot,
      revision: 0,
    });
    if (signature === this.signature) return;
    this.signature = signature;
    this.revision = before + 1;
    const published = this.snapshot();
    for (const listener of this.listeners) listener(published);
  }

  private toPublic(
    record: SmbConnectionRecord,
    state?: SmbRuntimeState,
  ): SmbConnection {
    return {
      id: record.id,
      displayName: record.displayName,
      server: record.server,
      share: record.share,
      authMode: record.authMode,
      ...(record.username ? { username: record.username } : {}),
      ...(record.domain ? { domain: record.domain } : {}),
      state: state?.state ?? "offline",
      readable: state?.readable ?? false,
      retryable: state?.retryable ?? true,
      ...(state?.lastError ? { lastError: state.lastError } : {}),
      ...(state?.connectedAt ? { connectedAt: state.connectedAt } : {}),
    };
  }

  private validateAdd(input: AddSmbConnectionRequest): AddSmbConnectionRequest {
    return this.validateIdentity(input, true);
  }

  private validateEdit(
    input: EditSmbConnectionRequest,
  ): EditSmbConnectionRequest {
    return this.validateIdentity(input, false);
  }

  private validateIdentity(
    input: AddSmbConnectionRequest,
    add: true,
  ): AddSmbConnectionRequest;
  private validateIdentity(
    input: EditSmbConnectionRequest,
    add: false,
  ): EditSmbConnectionRequest;
  private validateIdentity(
    input: AddSmbConnectionRequest | EditSmbConnectionRequest,
    add: boolean,
  ): AddSmbConnectionRequest | EditSmbConnectionRequest {
    if (
      typeof input.displayName !== "string" ||
      (input.username !== undefined && typeof input.username !== "string") ||
      (input.password !== undefined && typeof input.password !== "string") ||
      (input.domain !== undefined && typeof input.domain !== "string")
    )
      throw new SmbError(
        "invalid-request",
        "Network share fields are invalid.",
        400,
      );
    const displayName = normalizeSpace(input.displayName);
    if (!displayName || displayName.length > 80)
      throw new SmbError(
        "invalid-request",
        "Name must contain 1 to 80 characters.",
        400,
      );
    const authMode: unknown = input.authMode;
    if (authMode !== "account" && authMode !== "guest")
      throw new SmbError(
        "invalid-request",
        "Select Account or Guest authentication.",
        400,
      );
    const username = normalizeSpace(input.username ?? "");
    const domain = normalizeSpace(input.domain ?? "");
    if (
      username.length > 255 ||
      domain.length > 255 ||
      username.includes("\0") ||
      domain.includes("\0")
    )
      throw new SmbError(
        "invalid-request",
        "Account or domain is invalid.",
        400,
      );
    if (
      input.password?.includes("\0") ||
      input.password?.includes("\n") ||
      input.password?.includes("\r")
    )
      throw new SmbError(
        "invalid-request",
        "Password contains unsupported control characters.",
        400,
      );
    const common: EditSmbConnectionRequest = {
      displayName,
      authMode,
      ...(authMode === "account" && username ? { username } : {}),
      ...(authMode === "account" && domain ? { domain } : {}),
      ...(authMode === "account" && input.password
        ? { password: input.password }
        : {}),
    };
    if (authMode === "account" && !username)
      throw new SmbError(
        "invalid-request",
        "Username is required for Account authentication.",
        400,
      );
    if (!add) return common;
    const source = input as AddSmbConnectionRequest;
    if (typeof source.server !== "string" || typeof source.share !== "string")
      throw new SmbError(
        "invalid-request",
        "Server and Share are required.",
        400,
      );
    const server = source.server.trim().toLowerCase();
    const share = source.share.trim();
    if (
      !server ||
      server.includes("/") ||
      server.includes("\\") ||
      (!hostnamePattern.test(server) && !ipv4Pattern.test(server))
    )
      throw new SmbError(
        "invalid-request",
        "Enter a hostname, FQDN, or IPv4 server without slashes.",
        400,
      );
    if (
      !share ||
      share.length > 255 ||
      /[\\/:\0]/u.test(share) ||
      share === "." ||
      share === ".."
    )
      throw new SmbError("invalid-request", "Enter only the share name.", 400);
    if (source.authMode === "account" && !source.password)
      throw new SmbError(
        "invalid-request",
        "Password is required for Account authentication.",
        400,
      );
    return { ...common, server, share };
  }

  private assertUnique(
    displayName: string,
    server: string,
    share: string,
    excluding?: string,
  ): void {
    const foldedName = normalizeSpace(displayName).toLocaleLowerCase("en");
    if (
      this.records.some(
        (record) =>
          record.id !== excluding &&
          normalizeSpace(record.displayName).toLocaleLowerCase("en") ===
            foldedName,
      )
    )
      throw new SmbError(
        "duplicate",
        "A network share already uses this name.",
      );
    if (
      this.records.some(
        (record) =>
          record.id !== excluding &&
          record.server.toLocaleLowerCase("en") ===
            server.toLocaleLowerCase("en") &&
          record.share.toLocaleLowerCase("en") ===
            share.toLocaleLowerCase("en"),
      )
    )
      throw new SmbError(
        "duplicate",
        "This server and share are already configured.",
      );
  }

  private assertWindowsIdentity(
    server: string,
    identity: {
      readonly authMode: "account" | "guest";
      readonly username?: string;
      readonly domain?: string;
    },
    excluding?: string,
  ): void {
    if (process.platform !== "win32") return;
    const conflict = this.records.some(
      (record) =>
        record.id !== excluding &&
        record.server.toLocaleLowerCase("en") ===
          server.toLocaleLowerCase("en") &&
        (record.authMode !== identity.authMode ||
          (record.username ?? "").toLocaleLowerCase("en") !==
            (identity.username ?? "").toLocaleLowerCase("en") ||
          (record.domain ?? "").toLocaleLowerCase("en") !==
            (identity.domain ?? "").toLocaleLowerCase("en")),
    );
    if (conflict)
      throw new SmbError(
        "credential-conflict",
        "This server is already connected with different credentials.",
      );
  }

  private credentialFor(input: {
    readonly authMode: "account" | "guest";
    readonly username?: string;
    readonly password?: string;
    readonly domain?: string;
  }): SmbCredential | null {
    if (input.authMode === "guest") return null;
    if (!input.username || !input.password)
      throw new SmbError(
        "authentication-required",
        "SMB credentials are required.",
        400,
      );
    return {
      username: input.username,
      password: input.password,
      ...(input.domain ? { domain: input.domain } : {}),
    };
  }

  private withoutAccount(record: SmbConnectionRecord): SmbConnectionRecord {
    return {
      id: record.id,
      displayName: record.displayName,
      server: record.server,
      share: record.share,
      authMode: "guest",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private requireRecord(id: string): SmbConnectionRecord {
    if (!idPattern.test(id))
      throw new SmbError("invalid-request", "Invalid connection.", 400);
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record)
      throw new SmbError("invalid-request", "Network share not found.", 404);
    return record;
  }

  private async verifyRoot(root: string): Promise<string> {
    const canonical = await this.paths.canonicalizePath(root);
    const details = await this.provider.lstat(canonical);
    if (details.isSymbolicLink() || !details.isDirectory())
      throw new SmbError(
        "access-denied",
        "The SMB share root is not readable.",
      );
    await this.provider.access(canonical);
    return canonical;
  }

  private asSmbError(error: unknown): SmbError {
    if (error instanceof SmbError) return error;
    return new SmbError(
      "generic-failure",
      "Unable to connect to this network share.",
    );
  }

  private async ensureReady(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }
}

export function createPlatformSmbCredentialStore(): SmbCredentialStore {
  if (process.env.EIDETIC_SMB_FIXTURE === "1")
    return new MemorySmbCredentialStore();
  return process.platform === "win32"
    ? new WindowsSmbCredentialStore()
    : new LinuxSmbCredentialStore();
}
