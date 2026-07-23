import { createHash, randomUUID } from "node:crypto";
import type {
  Ipv4Draft,
  Ipv4ValidationResult,
  NetworkConfigurationTransaction,
  NetworkOperation,
  NetworkSnapshot,
  WifiSecurity,
} from "../../../../packages/shared/src/network.js";
import { validateIpv4Draft } from "../../../../packages/shared/src/network.js";
import type { NetworkAdapter } from "./network-adapter.js";
import { NetworkAdapterError } from "./network-adapter.js";
import {
  NetworkTransactionRepository,
  type PendingNetworkTransaction,
} from "./network-transaction-repository.js";

type Listener = (snapshot: NetworkSnapshot) => void;

const publicMessage: Record<NetworkAdapterError["code"], string> = {
  unsupported: "Network management is unavailable on this system.",
  "no-adapter": "No Wi-Fi adapter is available.",
  "wifi-hardware-off": "Wi-Fi is disabled by a hardware control.",
  "permission-required":
    "Location permission is required to scan Wi-Fi networks.",
  "authorization-required": "System authorization is required.",
  "invalid-credentials": "The Wi-Fi credentials were not accepted.",
  "network-not-found": "The Wi-Fi network is no longer available.",
  "connection-timeout": "The Wi-Fi connection timed out.",
  "profile-error": "The Eidetic Wi-Fi profile could not be updated.",
  "elevation-cancelled": "System authorization was cancelled.",
  "access-denied": "The system denied the network change.",
  "adapter-not-found": "The selected network adapter is no longer available.",
  "address-conflict": "The IPv4 address conflicts with another configuration.",
  "invalid-configuration": "The IPv4 configuration is invalid.",
  "operation-timeout": "The network operation timed out.",
  "rollback-failed": "The previous network settings could not be restored.",
  "operation-conflict": "Another network operation is already in progress.",
  "generic-failure": "The network action could not be completed.",
};

export class NetworkService {
  private listeners = new Set<Listener>();
  private revision = 0;
  private operation: NetworkOperation = "idle";
  private timer: NodeJS.Timeout | null = null;
  private transactionTimer: NodeJS.Timeout | null = null;
  private pending: PendingNetworkTransaction | null = null;
  private transaction: NetworkConfigurationTransaction | null = null;
  private readonly ready: Promise<void>;
  private closed = false;
  private refreshing: Promise<void> | null = null;
  private comparable = "";
  private snapshotValue: NetworkSnapshot = {
    revision: 0,
    connectivity: "unknown",
    wiredAdapters: [],
    wifiAdapters: [],
    activeRouteType: null,
    operationState: "idle",
    permissionState: "unsupported",
    wifi: {
      softwareRadio: "unknown",
      hardwareRadio: "unknown",
      currentNetwork: null,
      managedByEidetic: false,
      availableNetworks: [],
      scanState: "unsupported",
    },
    configurationTransaction: null,
    lastError: null,
  };

  constructor(
    private readonly adapter: NetworkAdapter,
    monitorIntervalMs = 5_000,
    private readonly transactionRepository = new NetworkTransactionRepository(),
    private readonly confirmationWindowMs = 30_000,
  ) {
    this.ready = this.recoverPendingTransaction();
    void this.ready.then(() => this.refresh());
    this.timer = setInterval(() => void this.refresh(), monitorIntervalMs);
    this.timer.unref();
  }

  snapshot(): NetworkSnapshot {
    return this.snapshotValue;
  }
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.ready
      .then(() => this.adapter.readState())
      .then((state) => {
        this.publish({
          connectivity: state.connectivity,
          wiredAdapters: state.wiredAdapters,
          wifiAdapters: state.wifiAdapters,
          activeRouteType: state.activeRouteType,
          operationState: this.operation,
          permissionState: state.permissionState,
          wifi: {
            softwareRadio: state.softwareRadio,
            hardwareRadio: state.hardwareRadio,
            currentNetwork: state.currentNetwork,
            managedByEidetic: state.managedByEidetic,
            availableNetworks: state.availableNetworks,
            scanState: state.scanState,
          },
          configurationTransaction: this.transaction,
          lastError: null,
        });
      })
      .catch((error: unknown) => {
        this.publishError(error);
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  scan(adapterId: string): Promise<void> {
    return this.mutate("scanning", () => this.adapter.scan(adapterId));
  }
  setRadio(adapterId: string, enabled: boolean): Promise<void> {
    return this.mutate("changing-radio", () =>
      this.adapter.setRadio(adapterId, enabled),
    );
  }
  connect(
    adapterId: string,
    networkId: string,
    password: string | undefined,
  ): Promise<void> {
    return this.mutate("connecting", () =>
      this.adapter.connect(adapterId, networkId, password),
    );
  }
  connectHidden(
    adapterId: string,
    ssid: string,
    security: Exclude<WifiSecurity, "unsupported">,
    password: string | undefined,
  ): Promise<void> {
    return this.mutate("connecting", () =>
      this.adapter.connectHidden(adapterId, ssid, security, password),
    );
  }
  disconnect(adapterId: string): Promise<void> {
    return this.mutate("disconnecting", () =>
      this.adapter.disconnect(adapterId),
    );
  }
  forgetManagedProfile(adapterId: string): Promise<void> {
    return this.mutate("forgetting", () =>
      this.adapter.forgetManagedProfile(adapterId),
    );
  }

  validateIpv4(draft: Ipv4Draft): Ipv4ValidationResult {
    return validateIpv4Draft(draft);
  }

  async applyIpv4(adapterId: string, draft: Ipv4Draft): Promise<void> {
    await this.ready;
    const validation = validateIpv4Draft(draft);
    if (!validation.valid)
      throw new NetworkAdapterError(
        "invalid-configuration",
        "The IPv4 configuration is invalid.",
      );
    if (
      this.operation !== "idle" ||
      this.transaction !== null ||
      !this.adapter.captureIpv4 ||
      !this.adapter.applyIpv4 ||
      !this.adapter.restoreIpv4
    )
      throw new NetworkAdapterError(
        this.adapter.applyIpv4 ? "operation-conflict" : "unsupported",
        publicMessage[
          this.adapter.applyIpv4 ? "operation-conflict" : "unsupported"
        ],
      );
    this.setTransaction({
      adapterId,
      state: "validating",
      configuration: validation.normalized,
      secondsRemaining: null,
      message: null,
    });
    let persisted = false;
    try {
      const liveState = await this.adapter.readState();
      if (
        ![...liveState.wiredAdapters, ...liveState.wifiAdapters].some(
          (adapter) => adapter.id === adapterId && adapter.present,
        )
      )
        throw new NetworkAdapterError(
          "adapter-not-found",
          "The selected adapter is no longer available.",
        );
      const rollback = await this.adapter.captureIpv4(adapterId);
      const createdAt = new Date();
      const pending: PendingNetworkTransaction = {
        version: 1,
        transactionId: randomUUID(),
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(
          createdAt.getTime() + this.confirmationWindowMs,
        ).toISOString(),
        adapterId,
        configuration: validation.normalized,
        rollback,
      };
      await this.transactionRepository.write(pending);
      this.pending = pending;
      persisted = true;
      this.setTransaction({
        transactionId: pending.transactionId,
        adapterId,
        state: "applying",
        configuration: validation.normalized,
        startedAt: pending.createdAt,
        expiresAt: pending.expiresAt,
        previousSummary: rollback.configuration,
        requestedSummary: validation.normalized,
        secondsRemaining: null,
        remainingSeconds: null,
        canConfirm: false,
        canRollback: true,
        message: null,
      });
      await this.adapter.applyIpv4(adapterId, validation.normalized);
      const state = await this.adapter.readState();
      if (!this.configurationMatches(state, adapterId, validation.normalized))
        throw new NetworkAdapterError(
          "generic-failure",
          "The applied IPv4 configuration could not be verified.",
        );
      this.setTransaction({
        adapterId,
        state: "awaiting-confirmation",
        configuration: validation.normalized,
        transactionId: pending.transactionId,
        startedAt: pending.createdAt,
        expiresAt: pending.expiresAt,
        previousSummary: rollback.configuration,
        requestedSummary: validation.normalized,
        secondsRemaining: Math.ceil(this.confirmationWindowMs / 1_000),
        remainingSeconds: Math.ceil(this.confirmationWindowMs / 1_000),
        canConfirm: true,
        canRollback: true,
        message: null,
      });
      this.startTransactionTimer();
      await this.refresh();
    } catch (error) {
      if (persisted)
        await this.rollbackPending("Apply failed; settings restored.");
      else this.setTransaction(null);
      throw error;
    }
  }

  async confirmIpv4(): Promise<void> {
    await this.ready;
    const pending = this.pending;
    if (this.transaction?.state !== "awaiting-confirmation" || !pending)
      throw new NetworkAdapterError(
        "operation-conflict",
        "No network configuration is awaiting confirmation.",
      );
    this.stopTransactionTimer();
    this.setTransaction({ ...this.transaction, state: "confirming" });
    try {
      await this.transactionRepository.remove();
      this.pending = null;
      this.setTransaction(null);
      await this.refresh();
    } catch (error) {
      const remaining = Math.max(
        0,
        Math.ceil((Date.parse(pending.expiresAt) - Date.now()) / 1_000),
      );
      this.setTransaction({
        ...this.transaction,
        state: "awaiting-confirmation",
        secondsRemaining: remaining,
        remainingSeconds: remaining,
        canConfirm: true,
        canRollback: true,
      });
      this.startTransactionTimer();
      throw error;
    }
  }

  async rollbackIpv4(): Promise<void> {
    await this.ready;
    if (!this.pending || this.transaction?.state !== "awaiting-confirmation")
      throw new NetworkAdapterError(
        "operation-conflict",
        "No network configuration can be reverted.",
      );
    const restored = await this.rollbackPending("Previous settings restored.");
    if (!restored)
      throw new NetworkAdapterError(
        "rollback-failed",
        "The previous network settings could not be restored.",
      );
  }

  async retryIpv4Recovery(): Promise<void> {
    await this.ready;
    if (this.transaction?.state !== "recovery-required" || !this.pending)
      throw new NetworkAdapterError(
        "operation-conflict",
        "No automatic network recovery can be retried.",
      );
    const restored = await this.rollbackPending(
      "Retrying automatic network recovery.",
    );
    if (!restored)
      throw new NetworkAdapterError(
        "rollback-failed",
        "The previous network settings could not be restored.",
      );
  }

  private async mutate(
    operation: Exclude<NetworkOperation, "idle">,
    action: () => Promise<void>,
  ): Promise<void> {
    await this.ready;
    if (this.operation !== "idle" || this.transaction !== null)
      throw new NetworkAdapterError(
        "operation-conflict",
        publicMessage["operation-conflict"],
      );
    this.operation = operation;
    this.publish({ ...this.snapshotValue, operationState: operation });
    try {
      await action();
    } catch (error) {
      this.publishError(error);
      throw error;
    } finally {
      this.operation = "idle";
      this.publish({ ...this.snapshotValue, operationState: "idle" });
      await this.refresh();
    }
  }

  private configurationMatches(
    state: Awaited<ReturnType<NetworkAdapter["readState"]>>,
    adapterId: string,
    configuration: Ipv4Draft,
  ): boolean {
    const adapter = [...state.wiredAdapters, ...state.wifiAdapters].find(
      (candidate) => candidate.id === adapterId,
    );
    if (adapter?.ipv4Method !== configuration.method) return false;
    if (configuration.method === "dhcp") return true;
    return (
      adapter.ipv4Address === configuration.address &&
      adapter.subnetMask === configuration.subnetMask &&
      (adapter.gateway ?? "") === configuration.gateway &&
      (adapter.dnsServers[0] ?? "") === configuration.dns1 &&
      (adapter.dnsServers[1] ?? "") === configuration.dns2
    );
  }

  private setTransaction(
    transaction: NetworkConfigurationTransaction | null,
  ): void {
    this.transaction = transaction;
    this.publish({
      ...this.snapshotValue,
      configurationTransaction: transaction,
    });
  }

  private startTransactionTimer(): void {
    this.stopTransactionTimer();
    this.transactionTimer = setInterval(
      () => {
        if (
          !this.pending ||
          this.transaction?.state !== "awaiting-confirmation"
        )
          return;
        const remaining = Math.max(
          0,
          Math.ceil((Date.parse(this.pending.expiresAt) - Date.now()) / 1_000),
        );
        if (remaining === 0) {
          this.stopTransactionTimer();
          void this.rollbackPending(
            "Confirmation timed out; settings restored.",
          );
        } else if (remaining !== this.transaction.secondsRemaining)
          this.setTransaction({
            ...this.transaction,
            secondsRemaining: remaining,
            remainingSeconds: remaining,
          });
      },
      Math.min(1_000, this.confirmationWindowMs),
    );
    this.transactionTimer.unref();
  }

  private stopTransactionTimer(): void {
    if (this.transactionTimer) clearInterval(this.transactionTimer);
    this.transactionTimer = null;
  }

  private async rollbackPending(message: string): Promise<boolean> {
    const pending = this.pending;
    if (!pending || !this.adapter.restoreIpv4) return false;
    this.stopTransactionTimer();
    this.setTransaction({
      adapterId: pending.adapterId,
      state: "rolling-back",
      configuration: pending.configuration,
      secondsRemaining: null,
      message,
    });
    try {
      await this.adapter.restoreIpv4(pending.rollback);
      const state = await this.adapter.readState();
      if (
        !this.configurationMatches(
          state,
          pending.adapterId,
          pending.rollback.configuration,
        )
      )
        throw new Error("Rollback verification failed.");
      await this.transactionRepository.remove();
      this.pending = null;
      this.setTransaction(null);
      await this.refresh();
      return true;
    } catch {
      this.setTransaction({
        adapterId: pending.adapterId,
        state: "recovery-required",
        configuration: pending.configuration,
        secondsRemaining: null,
        message:
          "Automatic recovery failed. Restore the previous network settings manually.",
      });
      return false;
    }
  }

  private async recoverPendingTransaction(): Promise<void> {
    const stored = await this.transactionRepository.read();
    if (stored.status === "none") return;
    if (stored.status === "invalid" || !this.adapter.restoreIpv4) {
      this.setTransaction({
        adapterId: "",
        state: "recovery-required",
        configuration: {
          method: "dhcp",
          address: "",
          subnetMask: "",
          gateway: "",
          dns1: "",
          dns2: "",
        },
        secondsRemaining: null,
        message:
          "A pending network recovery could not be read. Restore network settings manually.",
      });
      return;
    }
    this.pending = stored.transaction;
    this.setTransaction({
      adapterId: stored.transaction.adapterId,
      state: "rolling-back",
      configuration: stored.transaction.configuration,
      secondsRemaining: null,
      message: "Recovering the previous network configuration.",
    });
    try {
      await this.adapter.restoreIpv4(stored.transaction.rollback);
      const state = await this.adapter.readState();
      if (
        !this.configurationMatches(
          state,
          stored.transaction.adapterId,
          stored.transaction.rollback.configuration,
        )
      )
        throw new Error("Startup rollback verification failed.");
      await this.transactionRepository.remove();
      this.pending = null;
      this.setTransaction(null);
    } catch {
      this.setTransaction({
        adapterId: stored.transaction.adapterId,
        state: "recovery-required",
        configuration: stored.transaction.configuration,
        secondsRemaining: null,
        message:
          "Automatic startup recovery failed. Restore network settings manually.",
      });
    }
  }

  private publish(
    value: Omit<NetworkSnapshot, "revision"> | NetworkSnapshot,
  ): void {
    const { revision, ...withoutRevision } = value as NetworkSnapshot;
    void revision;
    const comparable = JSON.stringify(withoutRevision);
    if (comparable === this.comparable) return;
    this.comparable = comparable;
    this.snapshotValue = {
      ...withoutRevision,
      revision: ++this.revision,
    };
    for (const listener of this.listeners) listener(this.snapshotValue);
  }

  private publishError(error: unknown): void {
    const code =
      error instanceof NetworkAdapterError ? error.code : "generic-failure";
    const message = publicMessage[code];
    this.publish({
      ...this.snapshotValue,
      operationState: this.operation,
      permissionState:
        code === "permission-required"
          ? "permission-required"
          : code === "authorization-required"
            ? "authorization-required"
            : this.snapshotValue.permissionState,
      lastError: { code, message },
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.stopTransactionTimer();
    this.timer = null;
    await this.refreshing?.catch(() => undefined);
    await this.adapter.close();
    this.listeners.clear();
  }
}

export function opaqueNetworkId(value: string): string {
  return `network-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}
