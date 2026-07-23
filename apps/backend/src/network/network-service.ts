import { createHash } from "node:crypto";
import type {
  NetworkOperation,
  NetworkSnapshot,
  WifiSecurity,
} from "../../../../packages/shared/src/network.js";
import type { NetworkAdapter } from "./network-adapter.js";
import { NetworkAdapterError } from "./network-adapter.js";

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
  "operation-conflict": "Another network operation is already in progress.",
  "generic-failure": "The network action could not be completed.",
};

export class NetworkService {
  private listeners = new Set<Listener>();
  private revision = 0;
  private operation: NetworkOperation = "idle";
  private timer: NodeJS.Timeout | null = null;
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
    lastError: null,
  };

  constructor(
    private readonly adapter: NetworkAdapter,
    monitorIntervalMs = 5_000,
  ) {
    void this.refresh();
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
    this.refreshing = this.adapter
      .readState()
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

  private async mutate(
    operation: Exclude<NetworkOperation, "idle">,
    action: () => Promise<void>,
  ): Promise<void> {
    if (this.operation !== "idle")
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
    this.timer = null;
    await this.refreshing?.catch(() => undefined);
    await this.adapter.close();
    this.listeners.clear();
  }
}

export function opaqueNetworkId(value: string): string {
  return `network-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}
