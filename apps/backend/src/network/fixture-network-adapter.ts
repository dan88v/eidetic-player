import type {
  Ipv4Configuration,
  NetworkAdapterSnapshot,
  WifiNetwork,
  WifiSecurity,
} from "../../../../packages/shared/src/network.js";
import {
  NetworkAdapterError,
  type AdapterIpv4RollbackState,
  type AdapterNetworkState,
  type NetworkAdapter,
} from "./network-adapter.js";

export class FixtureNetworkAdapter implements NetworkAdapter {
  constructor(private state: AdapterNetworkState) {}

  readState(): Promise<AdapterNetworkState> {
    return Promise.resolve(this.state);
  }
  scan(adapterId: string): Promise<void> {
    this.findWifi(adapterId);
    if (this.state.softwareRadio === "off")
      throw new NetworkAdapterError(
        "wifi-hardware-off",
        "Wi-Fi is switched off.",
      );
    this.state = {
      ...this.state,
      scanState:
        this.state.availableNetworks.length > 0 ? "results" : "no-networks",
    };
    return Promise.resolve();
  }
  setRadio(adapterId: string, enabled: boolean): Promise<void> {
    this.findWifi(adapterId);
    const wifiAdapters = this.state.wifiAdapters.map((adapter) =>
      adapter.id === adapterId
        ? {
            ...adapter,
            enabled,
            connected: enabled ? adapter.connected : false,
          }
        : adapter,
    );
    this.state = {
      ...this.state,
      wifiAdapters,
      softwareRadio: enabled ? "on" : "off",
      scanState: enabled ? "idle" : "wifi-off",
      currentNetwork: enabled ? this.state.currentNetwork : null,
      availableNetworks: enabled
        ? this.state.availableNetworks
        : this.state.availableNetworks.map((network) => ({
            ...network,
            connected: false,
          })),
    };
    return Promise.resolve();
  }
  connect(
    adapterId: string,
    networkId: string,
    password: string | undefined,
  ): Promise<void> {
    this.ensureRadio(adapterId);
    const network = this.state.availableNetworks.find(
      (candidate) => candidate.id === networkId,
    );
    if (!network)
      throw new NetworkAdapterError("network-not-found", "Network not found.");
    if (!network.supported || network.security === "unsupported")
      throw new NetworkAdapterError(
        "unsupported",
        "This Wi-Fi security mode is unsupported.",
      );
    if (network.security !== "open" && !password)
      throw new NetworkAdapterError(
        "invalid-credentials",
        "A password is required.",
      );
    this.connectNetwork(adapterId, network);
    return Promise.resolve();
  }
  connectHidden(
    adapterId: string,
    ssid: string,
    security: Exclude<WifiSecurity, "unsupported">,
    password: string | undefined,
  ): Promise<void> {
    this.ensureRadio(adapterId);
    if (!ssid.trim())
      throw new NetworkAdapterError(
        "network-not-found",
        "A network name is required.",
      );
    if (security !== "open" && !password)
      throw new NetworkAdapterError(
        "invalid-credentials",
        "A password is required.",
      );
    this.connectNetwork(adapterId, {
      id: "network-5555555555555555",
      ssid: ssid.trim(),
      signalPercent: 0,
      security,
      connected: true,
      supported: true,
    });
    return Promise.resolve();
  }
  disconnect(adapterId: string): Promise<void> {
    this.findWifi(adapterId);
    this.setWifiConnection(adapterId, false);
    return Promise.resolve();
  }
  forgetManagedProfile(adapterId: string): Promise<void> {
    this.findWifi(adapterId);
    if (!this.state.managedByEidetic)
      throw new NetworkAdapterError(
        "profile-error",
        "No Eidetic-managed Wi-Fi profile exists.",
      );
    this.setWifiConnection(adapterId, false, false);
    return Promise.resolve();
  }
  captureIpv4(adapterId: string): Promise<AdapterIpv4RollbackState> {
    const adapter = this.find(adapterId);
    return Promise.resolve({
      version: 1,
      adapterId,
      nativeAdapterId: `fixture:${adapterId}`,
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
    this.replace(adapterId, configuration);
    return Promise.resolve();
  }
  restoreIpv4(state: AdapterIpv4RollbackState): Promise<void> {
    this.replace(state.adapterId, state.configuration);
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }

  private find(adapterId: string): NetworkAdapterSnapshot {
    const adapter = [
      ...this.state.wiredAdapters,
      ...this.state.wifiAdapters,
    ].find((candidate) => candidate.id === adapterId);
    if (!adapter) throw new Error("Fixture adapter not found.");
    return adapter;
  }

  private findWifi(adapterId: string): NetworkAdapterSnapshot {
    const adapter = this.find(adapterId);
    if (adapter.type !== "wifi")
      throw new NetworkAdapterError(
        "adapter-not-found",
        "Wi-Fi adapter not found.",
      );
    return adapter;
  }

  private ensureRadio(adapterId: string): void {
    this.findWifi(adapterId);
    if (this.state.softwareRadio !== "on")
      throw new NetworkAdapterError(
        "wifi-hardware-off",
        "Wi-Fi is switched off.",
      );
  }

  private connectNetwork(adapterId: string, selected: WifiNetwork): void {
    const current = { ...selected, connected: true };
    this.state = {
      ...this.state,
      wifiAdapters: this.state.wifiAdapters.map((adapter) =>
        adapter.id === adapterId
          ? {
              ...adapter,
              enabled: true,
              connected: true,
              ipv4Method: "dhcp",
              ipv4Address: "198.51.100.20",
              subnetMask: "255.255.255.0",
              gateway: "198.51.100.1",
              dnsServers: ["198.51.100.1"],
            }
          : adapter,
      ),
      currentNetwork: current,
      managedByEidetic: true,
      availableNetworks: this.state.availableNetworks.map((network) => ({
        ...network,
        connected: network.id === selected.id,
      })),
    };
  }

  private setWifiConnection(
    adapterId: string,
    connected: boolean,
    managedByEidetic = this.state.managedByEidetic,
  ): void {
    this.state = {
      ...this.state,
      wifiAdapters: this.state.wifiAdapters.map((adapter) =>
        adapter.id === adapterId ? { ...adapter, connected } : adapter,
      ),
      currentNetwork: connected ? this.state.currentNetwork : null,
      managedByEidetic,
      availableNetworks: this.state.availableNetworks.map((network) => ({
        ...network,
        connected: connected && network.id === this.state.currentNetwork?.id,
      })),
    };
  }

  private replace(adapterId: string, configuration: Ipv4Configuration): void {
    const update = (
      adapters: readonly NetworkAdapterSnapshot[],
    ): readonly NetworkAdapterSnapshot[] =>
      adapters.map((adapter) =>
        adapter.id === adapterId
          ? {
              ...adapter,
              ipv4Method: configuration.method,
              ipv4Address:
                configuration.method === "manual"
                  ? configuration.address
                  : "192.0.2.20",
              subnetMask:
                configuration.method === "manual"
                  ? configuration.subnetMask
                  : "255.255.255.0",
              gateway:
                configuration.method === "manual"
                  ? configuration.gateway
                  : "192.0.2.1",
              dnsServers:
                configuration.method === "manual"
                  ? [configuration.dns1, configuration.dns2].filter(Boolean)
                  : ["192.0.2.1"],
            }
          : adapter,
      );
    this.state = {
      ...this.state,
      wiredAdapters: update(this.state.wiredAdapters),
      wifiAdapters: update(this.state.wifiAdapters),
    };
  }
}
