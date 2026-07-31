import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { networkInterfaces } from "node:os";
import type {
  RemoteAccessDevice,
  RemoteAccessPairingState,
  RemoteAccessState,
} from "../../../../packages/shared/src/remote-access.js";
import {
  REMOTE_ACCESS_DEVICE_INACTIVITY_DAYS,
  REMOTE_ACCESS_MAX_DEVICES,
  REMOTE_ACCESS_PORT,
} from "../../../../packages/shared/src/remote-access.js";
import {
  normalizeRemoteDeviceName,
  RemoteAccessStore,
  type RemoteAccessStoreDocument,
  type StoredRemoteDevice,
} from "./remote-access-store.js";

const PAIRING_LIFETIME_MILLISECONDS = 5 * 60 * 1_000;
const SESSION_LIFETIME_MILLISECONDS =
  REMOTE_ACCESS_DEVICE_INACTIVITY_DAYS * 24 * 60 * 60 * 1_000;
const LAST_SEEN_WRITE_INTERVAL_MILLISECONDS = 60 * 60 * 1_000;
const PAIRING_ATTEMPT_LIMIT = 5;
const RATE_LIMIT_ENTRY_MAXIMUM = 256;

interface ActivePairing {
  readonly code: string;
  readonly expiresAtMilliseconds: number;
  attemptsRemaining: number;
  readonly attemptsByAddress: Map<string, number>;
}

export interface AuthenticatedRemoteDevice {
  readonly device: RemoteAccessDevice;
  readonly csrfToken: string;
}

export interface PairingResult extends AuthenticatedRemoteDevice {
  readonly token: string;
}

type Listener = (state: RemoteAccessState) => void;
type RevokeListener = (deviceId: string | null) => void;

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

export function hashRemoteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function publicDevice(device: StoredRemoteDevice): RemoteAccessDevice {
  return {
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    expiresAt: device.expiresAt,
  };
}

export function privateIpv4Addresses(): readonly string[] {
  const addresses = new Set<string>();
  for (const records of Object.values(networkInterfaces())) {
    for (const record of records ?? []) {
      if (
        record.family === "IPv4" &&
        !record.internal &&
        isPrivateOrLinkLocalIpv4(record.address)
      )
        addresses.add(record.address);
    }
  }
  return [...addresses].sort();
}

export function isPrivateOrLinkLocalIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  )
    return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}

export function remoteIpv4(
  address: string | undefined,
  allowLoopback: boolean,
): string | null {
  if (!address) return null;
  const normalized = address.startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
  if (
    allowLoopback &&
    (normalized === "127.0.0.1" || normalized === "127.0.0.2")
  )
    return normalized;
  return isPrivateOrLinkLocalIpv4(normalized) ? normalized : null;
}

export class RemoteAccessService {
  private document: RemoteAccessStoreDocument = {
    schemaVersion: 1,
    revision: 1,
    enabled: false,
    devices: [],
  };
  private initialized = false;
  private readOnly = false;
  private pairing: ActivePairing | null = null;
  private status: RemoteAccessState["status"] = "unavailable";
  private reasonCode: RemoteAccessState["reasonCode"] = null;
  private revision = 0;
  private readonly listeners = new Set<Listener>();
  private readonly revokeListeners = new Set<RevokeListener>();
  private readonly csrfTokens = new Map<string, string>();
  private lifecycle: {
    start(): Promise<void>;
    stop(): Promise<void>;
  } | null = null;

  constructor(
    private readonly available: boolean,
    readonly developmentFixture: boolean,
    private readonly store = new RemoteAccessStore(),
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.available) {
      this.status = "unavailable";
      this.publish();
      return;
    }
    try {
      const loaded = await this.store.load();
      this.document = loaded.document;
      this.readOnly = loaded.readOnly;
      await this.removeExpiredDevices();
      this.status = this.document.enabled ? "starting" : "disabled";
    } catch {
      this.status = "error";
      this.reasonCode = "listener-failed";
    }
    this.publish();
  }

  attachLifecycle(lifecycle: {
    start(): Promise<void>;
    stop(): Promise<void>;
  }): void {
    this.lifecycle = lifecycle;
  }

  async startStoredPreference(): Promise<void> {
    await this.initialize();
    if (this.document.enabled && !this.readOnly) await this.startListener();
  }

  snapshot(includePairingCode = false): RemoteAccessState {
    this.expirePairingIfNeeded();
    const pairing =
      includePairingCode && this.pairing
        ? this.pairingSnapshot(this.pairing)
        : null;
    return {
      available: this.available,
      enabled: this.document.enabled,
      status: this.status,
      reasonCode: this.reasonCode,
      addresses: privateIpv4Addresses().map(
        (address) => `http://${address}:${String(REMOTE_ACCESS_PORT)}`,
      ),
      hostnameAddress: null,
      pairing,
      devices: this.document.devices.map(publicDevice),
      securityNotice: "Trusted local networks only. Traffic is not encrypted.",
      readOnly: this.readOnly,
      revision: this.revision,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onRevoke(listener: RevokeListener): () => void {
    this.revokeListeners.add(listener);
    return () => {
      this.revokeListeners.delete(listener);
    };
  }

  async enable(): Promise<RemoteAccessState> {
    await this.assertWritable();
    if (!this.document.enabled) {
      await this.replaceDocument({ enabled: true });
    }
    await this.startListener();
    return this.snapshot(true);
  }

  async disable(): Promise<RemoteAccessState> {
    await this.assertWritable();
    this.cancelPairing();
    await this.lifecycle?.stop();
    if (this.document.enabled) await this.replaceDocument({ enabled: false });
    this.status = "disabled";
    this.reasonCode = null;
    this.revokeListeners.forEach((listener) => {
      listener(null);
    });
    this.publish();
    return this.snapshot(true);
  }

  async retry(): Promise<RemoteAccessState> {
    await this.assertWritable();
    if (!this.document.enabled)
      throw new Error("Enable Remote access before retrying.");
    await this.lifecycle?.stop();
    await this.startListener();
    return this.snapshot(true);
  }

  createPairingCode(): RemoteAccessPairingState {
    if (
      !this.available ||
      !this.document.enabled ||
      this.status !== "listening"
    )
      throw new Error("Remote access must be listening before pairing.");
    if (this.document.devices.length >= REMOTE_ACCESS_MAX_DEVICES)
      throw new Error("The maximum of eight paired devices has been reached.");
    this.pairing = {
      code: String(randomInt(0, 1_000_000)).padStart(6, "0"),
      expiresAtMilliseconds: Date.now() + PAIRING_LIFETIME_MILLISECONDS,
      attemptsRemaining: PAIRING_ATTEMPT_LIMIT,
      attemptsByAddress: new Map(),
    };
    this.publish();
    return this.pairingSnapshot(this.pairing);
  }

  cancelPairing(): void {
    if (!this.pairing) return;
    this.pairing = null;
    this.publish();
  }

  async pair(
    codeValue: unknown,
    nameValue: unknown,
    remoteAddress: string,
  ): Promise<PairingResult> {
    this.expirePairingIfNeeded();
    const pairing = this.pairing;
    if (!pairing) throw new Error("The pairing code has expired.");
    const attempts = pairing.attemptsByAddress.get(remoteAddress) ?? 0;
    if (attempts >= PAIRING_ATTEMPT_LIMIT || pairing.attemptsRemaining <= 0)
      throw new Error("Too many pairing attempts.");
    if (pairing.attemptsByAddress.size >= RATE_LIMIT_ENTRY_MAXIMUM) {
      const oldestAddress = pairing.attemptsByAddress.keys().next().value;
      if (oldestAddress !== undefined)
        pairing.attemptsByAddress.delete(oldestAddress);
    }
    pairing.attemptsByAddress.set(remoteAddress, attempts + 1);
    pairing.attemptsRemaining -= 1;
    const code =
      typeof codeValue === "string" ? codeValue.replaceAll(/\s/gu, "") : "";
    const validCode =
      /^[0-9]{6}$/u.test(code) &&
      timingSafeEqual(Buffer.from(code), Buffer.from(pairing.code));
    if (!validCode) {
      if (pairing.attemptsRemaining <= 0) this.pairing = null;
      this.publish();
      throw new Error("The pairing code is invalid.");
    }
    if (this.document.devices.length >= REMOTE_ACCESS_MAX_DEVICES)
      throw new Error("The maximum of eight paired devices has been reached.");
    const name = normalizeRemoteDeviceName(nameValue);
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const stored: StoredRemoteDevice = {
      id: `remote-device-${randomUUID().replaceAll("-", "")}`,
      name,
      tokenHash: hashRemoteToken(token),
      createdAt: iso(now),
      lastSeenAt: iso(now),
      expiresAt: iso(now + SESSION_LIFETIME_MILLISECONDS),
    };
    await this.replaceDocument(
      {
        devices: [...this.document.devices, stored],
      },
      false,
    );
    this.pairing = null;
    const csrfToken = randomBytes(32).toString("base64url");
    this.csrfTokens.set(stored.id, csrfToken);
    this.publish();
    return { token, csrfToken, device: publicDevice(stored) };
  }

  async authenticate(
    token: string | null,
  ): Promise<AuthenticatedRemoteDevice | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const tokenHash = hashRemoteToken(token);
    const now = Date.now();
    const stored = this.document.devices.find(
      (device) =>
        Date.parse(device.expiresAt) > now &&
        safeHashEqual(device.tokenHash, tokenHash),
    );
    if (!stored) return null;
    let csrfToken = this.csrfTokens.get(stored.id);
    if (!csrfToken) {
      csrfToken = randomBytes(32).toString("base64url");
      this.csrfTokens.set(stored.id, csrfToken);
    }
    if (
      now - Date.parse(stored.lastSeenAt) >=
      LAST_SEEN_WRITE_INTERVAL_MILLISECONDS
    ) {
      const next = this.document.devices.map((device) =>
        device.id === stored.id
          ? {
              ...device,
              lastSeenAt: iso(now),
              expiresAt: iso(now + SESSION_LIFETIME_MILLISECONDS),
            }
          : device,
      );
      await this.replaceDocument({ devices: next }).catch(() => undefined);
    }
    const current =
      this.document.devices.find((device) => device.id === stored.id) ?? stored;
    return { device: publicDevice(current), csrfToken };
  }

  validateCsrf(deviceId: string, value: string | undefined): boolean {
    const expected = this.csrfTokens.get(deviceId);
    return Boolean(
      expected &&
      value &&
      safeHashEqual(hashRemoteToken(expected), hashRemoteToken(value)),
    );
  }

  async revoke(deviceId: string): Promise<void> {
    await this.assertWritable();
    const next = this.document.devices.filter(
      (device) => device.id !== deviceId,
    );
    if (next.length === this.document.devices.length)
      throw new Error("Paired device not found.");
    await this.replaceDocument({ devices: next });
    this.csrfTokens.delete(deviceId);
    this.revokeListeners.forEach((listener) => {
      listener(deviceId);
    });
  }

  async revokeAll(): Promise<void> {
    await this.assertWritable();
    await this.replaceDocument({ devices: [] });
    this.csrfTokens.clear();
    this.revokeListeners.forEach((listener) => {
      listener(null);
    });
  }

  listenerStarted(): void {
    this.status = "listening";
    this.reasonCode = null;
    this.publish();
  }

  listenerFailed(reason: "port-unavailable" | "listener-failed"): void {
    this.status = "error";
    this.reasonCode = reason;
    this.publish();
  }

  async close(): Promise<void> {
    this.pairing = null;
    this.csrfTokens.clear();
    await this.lifecycle?.stop();
  }

  private async startListener(): Promise<void> {
    if (!this.lifecycle) throw new Error("Remote gateway is unavailable.");
    this.status = "starting";
    this.reasonCode = null;
    this.publish();
    try {
      await this.lifecycle.start();
      this.listenerStarted();
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : null;
      this.listenerFailed(
        code === "EADDRINUSE" ? "port-unavailable" : "listener-failed",
      );
    }
  }

  private async assertWritable(): Promise<void> {
    await this.initialize();
    if (!this.available) throw new Error("Remote access is unavailable.");
    if (this.readOnly)
      throw new Error("Remote access is read-only for this store version.");
  }

  private pairingSnapshot(pairing: ActivePairing): RemoteAccessPairingState {
    return {
      code: pairing.code,
      displayCode: `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}`,
      expiresAt: iso(pairing.expiresAtMilliseconds),
      attemptsRemaining: pairing.attemptsRemaining,
    };
  }

  private expirePairingIfNeeded(): void {
    if (this.pairing && Date.now() >= this.pairing.expiresAtMilliseconds) {
      this.pairing = null;
      this.publish();
    }
  }

  private async removeExpiredDevices(): Promise<void> {
    if (this.readOnly) return;
    const now = Date.now();
    const devices = this.document.devices.filter(
      (device) => Date.parse(device.expiresAt) > now,
    );
    if (devices.length !== this.document.devices.length)
      await this.replaceDocument({ devices });
  }

  private async replaceDocument(
    patch: Partial<Pick<RemoteAccessStoreDocument, "enabled" | "devices">>,
    publish = true,
  ): Promise<void> {
    const next: RemoteAccessStoreDocument = {
      ...this.document,
      ...patch,
      schemaVersion: 1,
      revision: this.document.revision + 1,
    };
    await this.store.save(next);
    this.document = next;
    if (publish) this.publish();
  }

  private publish(): void {
    this.revision += 1;
    const snapshot = this.snapshot(true);
    this.listeners.forEach((listener) => {
      listener(snapshot);
    });
  }
}
