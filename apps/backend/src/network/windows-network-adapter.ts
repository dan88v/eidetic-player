import type {
  Ipv4Configuration,
  NetworkAdapterSnapshot,
  WifiNetwork,
  WifiSecurity,
} from "../../../../packages/shared/src/network.js";
import { runBoundedProcess } from "./bounded-process.js";
import {
  NetworkAdapterError,
  sortAndDeduplicateNetworks,
  type AdapterNetworkState,
  type AdapterIpv4RollbackState,
  type NetworkAdapter,
} from "./network-adapter.js";
import { opaqueNetworkId } from "./network-service.js";
import { WINDOWS_NATIVE_WIFI_HELPER } from "./windows-native-wifi-helper.js";

interface HelperState {
  readonly adapters: readonly {
    readonly nativeId: string;
    readonly name: string;
    readonly type: "wired" | "wifi";
    readonly enabled: boolean;
    readonly connected: boolean;
    readonly speed: string | null;
    readonly method: "dhcp" | "manual";
    readonly address: string | null;
    readonly prefix: number | null;
    readonly gateway: string | null;
    readonly dns: readonly string[];
  }[];
  readonly nativeWifi: readonly {
    readonly id: string;
    readonly name: string;
    readonly state: number;
    readonly radio: {
      readonly Software: "on" | "off";
      readonly Hardware: "on" | "off";
    };
    readonly networks: readonly {
      readonly Ssid: string;
      readonly Signal: number;
      readonly Auth: number;
      readonly Connected: boolean;
      readonly Profile: string;
    }[];
  }[];
  readonly managed: boolean;
  readonly connectivity: "disconnected" | "local-network" | "internet";
}

function prefixToMask(prefix: number | null): string | null {
  if (prefix === null) return null;
  return [0, 8, 16, 24]
    .map((offset) => {
      const remaining = Math.max(0, Math.min(8, prefix - offset));
      return String(remaining === 0 ? 0 : 256 - 2 ** (8 - remaining));
    })
    .join(".");
}
function securityOf(auth: number): WifiSecurity {
  if (auth === 1) return "open";
  if (auth === 7 || auth === 3) return "wpa2-personal";
  if (auth === 8 || auth === 9) return "wpa3-personal";
  return "unsupported";
}

export class WindowsNetworkAdapter implements NetworkAdapter {
  private nativeById = new Map<string, string>();
  private snapshotById = new Map<string, NetworkAdapterSnapshot>();
  private networkById = new Map<
    string,
    { ssid: string; security: WifiSecurity }
  >();
  private networks: readonly WifiNetwork[] = [];
  private scanState: AdapterNetworkState["scanState"] = "idle";

  private async helper(request: Record<string, unknown>): Promise<string> {
    let result;
    try {
      result = await runBoundedProcess(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          WINDOWS_NATIVE_WIFI_HELPER,
        ],
        {
          input: JSON.stringify(request),
          timeoutMs: request.action === "ipv4" ? 45_000 : 20_000,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("timed out"))
        throw new NetworkAdapterError(
          "operation-timeout",
          "Network helper timed out.",
        );
      throw new NetworkAdapterError(
        "generic-failure",
        "Network helper failed.",
      );
    }
    if (result.exitCode !== 0) {
      const detail = result.stderr.toLowerCase();
      if (
        request.action !== "ipv4" &&
        (detail.includes("access is denied") ||
          detail.includes("native-wifi-5"))
      )
        throw new NetworkAdapterError(
          "permission-required",
          "Location permission is required.",
        );
      if (
        detail.includes("operation was canceled") ||
        detail.includes("authorization-required")
      )
        throw new NetworkAdapterError(
          "elevation-cancelled",
          "System authorization was cancelled.",
        );
      if (
        detail.includes("access is denied") ||
        detail.includes("native-wifi-5")
      )
        throw new NetworkAdapterError("access-denied", "Access was denied.");
      if (detail.includes("already exists") || detail.includes("conflict"))
        throw new NetworkAdapterError(
          "address-conflict",
          "The address conflicts with an existing configuration.",
        );
      if (detail.includes("adapter-not-found"))
        throw new NetworkAdapterError(
          "adapter-not-found",
          "Adapter not found.",
        );
      throw new NetworkAdapterError(
        "generic-failure",
        "Network action failed.",
      );
    }
    return result.stdout.trim();
  }

  async readState(): Promise<AdapterNetworkState> {
    const raw = await this.helper({ action: "state" });
    const state = JSON.parse(raw) as HelperState;
    this.nativeById.clear();
    this.snapshotById.clear();
    const wiredAdapters: NetworkAdapterSnapshot[] = [];
    const wifiAdapters: NetworkAdapterSnapshot[] = [];
    for (const adapter of state.adapters) {
      const nativeWifi = state.nativeWifi.find(
        (candidate) =>
          candidate.id.toLowerCase() === adapter.nativeId.toLowerCase(),
      );
      const nativeId = nativeWifi?.id ?? adapter.nativeId;
      const id = opaqueNetworkId(`${adapter.type}:${nativeId}`);
      this.nativeById.set(id, nativeId);
      const item: NetworkAdapterSnapshot = {
        id,
        type: adapter.type,
        displayName:
          adapter.name.trim() !== ""
            ? adapter.name
            : (nativeWifi?.name ?? adapter.type),
        present: true,
        enabled: adapter.enabled,
        connected: adapter.connected,
        ...(adapter.speed ? { linkSpeed: adapter.speed } : {}),
        ipv4Method: adapter.method,
        ipv4Address: adapter.address,
        subnetMask: prefixToMask(adapter.prefix),
        gateway: adapter.gateway,
        dnsServers: adapter.dns.slice(0, 2),
      };
      this.snapshotById.set(id, item);
      (adapter.type === "wifi" ? wifiAdapters : wiredAdapters).push(item);
    }
    this.networkById.clear();
    const networks = state.nativeWifi.flatMap((adapter) =>
      adapter.networks.map((network): WifiNetwork => {
        const security = securityOf(network.Auth);
        const id = opaqueNetworkId(`wifi:${network.Ssid}:${security}`);
        this.networkById.set(id, { ssid: network.Ssid, security });
        return {
          id,
          ssid: network.Ssid,
          signalPercent: Math.max(0, Math.min(100, network.Signal)),
          security,
          connected: network.Connected,
          supported: security !== "unsupported",
        };
      }),
    );
    this.networks = sortAndDeduplicateNetworks(networks);
    const radio = state.nativeWifi[0]?.radio;
    return {
      connectivity: state.connectivity,
      wiredAdapters,
      wifiAdapters,
      activeRouteType: wiredAdapters.some((adapter) => adapter.connected)
        ? "wired"
        : wifiAdapters.some((adapter) => adapter.connected)
          ? "wifi"
          : null,
      permissionState: "granted",
      softwareRadio: radio?.Software ?? "unknown",
      hardwareRadio: radio?.Hardware ?? "unknown",
      currentNetwork:
        this.networks.find((network) => network.connected) ?? null,
      managedByEidetic: state.managed,
      availableNetworks: this.networks,
      scanState: radio?.Software === "off" ? "wifi-off" : this.scanState,
    };
  }

  async scan(adapterId: string): Promise<void> {
    this.scanState = "scanning";
    try {
      await this.helper({ action: "scan", nativeId: this.native(adapterId) });
      this.scanState = "results";
    } catch (error) {
      this.scanState =
        error instanceof NetworkAdapterError &&
        error.code === "permission-required"
          ? "permission-required"
          : "failed";
      throw error;
    }
  }
  setRadio(adapterId: string, enabled: boolean): Promise<void> {
    return this.helper({
      action: "radio",
      nativeId: this.native(adapterId),
      enabled,
    }).then(() => undefined);
  }
  connect(
    adapterId: string,
    networkId: string,
    password: string | undefined,
  ): Promise<void> {
    const network = this.networkById.get(networkId);
    if (!network)
      throw new NetworkAdapterError("network-not-found", "Network not found.");
    return this.connectSsid(
      adapterId,
      network.ssid,
      network.security,
      false,
      password,
    );
  }
  connectHidden(
    adapterId: string,
    ssid: string,
    security: Exclude<WifiSecurity, "unsupported">,
    password: string | undefined,
  ): Promise<void> {
    return this.connectSsid(adapterId, ssid, security, true, password);
  }
  private connectSsid(
    adapterId: string,
    ssid: string,
    security: WifiSecurity,
    hidden: boolean,
    password: string | undefined,
  ): Promise<void> {
    return this.helper({
      action: "connect",
      nativeId: this.native(adapterId),
      ssid,
      security,
      password: password ?? "",
      hidden,
    }).then(() => undefined);
  }
  disconnect(adapterId: string): Promise<void> {
    return this.helper({
      action: "disconnect",
      nativeId: this.native(adapterId),
    }).then(() => undefined);
  }
  forgetManagedProfile(adapterId: string): Promise<void> {
    return this.helper({
      action: "forget",
      nativeId: this.native(adapterId),
    }).then(() => undefined);
  }
  captureIpv4(adapterId: string): Promise<AdapterIpv4RollbackState> {
    const adapter = this.snapshotById.get(adapterId);
    if (!adapter)
      throw new NetworkAdapterError("no-adapter", "Adapter not found.");
    return Promise.resolve({
      version: 1,
      adapterId,
      nativeAdapterId: this.native(adapterId),
      configuration: {
        method: adapter.ipv4Method === "manual" ? "manual" : "dhcp",
        address: adapter.ipv4Address ?? "",
        subnetMask: adapter.subnetMask ?? "",
        gateway: adapter.gateway ?? "",
        dns1: adapter.dnsServers[0] ?? "",
        dns2: adapter.dnsServers[1] ?? "",
      },
    });
  }
  applyIpv4(
    adapterId: string,
    configuration: Ipv4Configuration,
  ): Promise<void> {
    return this.helper({
      action: "ipv4",
      nativeId: this.native(adapterId),
      configuration,
    }).then(() => undefined);
  }
  restoreIpv4(state: AdapterIpv4RollbackState): Promise<void> {
    return this.helper({
      action: "ipv4",
      nativeId: state.nativeAdapterId,
      configuration: state.configuration,
    }).then(() => undefined);
  }
  close(): Promise<void> {
    this.nativeById.clear();
    this.snapshotById.clear();
    this.networkById.clear();
    return Promise.resolve();
  }
  private native(adapterId: string): string {
    const native = this.nativeById.get(adapterId);
    if (!native)
      throw new NetworkAdapterError("no-adapter", "Wi-Fi adapter not found.");
    return native;
  }
}
