import type {
  Ipv4Configuration,
  NetworkAdapterSnapshot,
  WifiSecurity,
} from "../../../../packages/shared/src/network.js";
import type {
  AdapterIpv4RollbackState,
  AdapterNetworkState,
  NetworkAdapter,
} from "./network-adapter.js";

export class FixtureNetworkAdapter implements NetworkAdapter {
  constructor(private state: AdapterNetworkState) {}

  readState(): Promise<AdapterNetworkState> {
    return Promise.resolve(this.state);
  }
  scan(adapterId: string): Promise<void> {
    void adapterId;
    return Promise.resolve();
  }
  setRadio(_adapterId: string, enabled: boolean): Promise<void> {
    this.state = {
      ...this.state,
      softwareRadio: enabled ? "on" : "off",
      scanState: enabled ? "idle" : "wifi-off",
    };
    return Promise.resolve();
  }
  connect(
    adapterId: string,
    networkId: string,
    password: string | undefined,
  ): Promise<void> {
    void adapterId;
    void networkId;
    void password;
    return Promise.resolve();
  }
  connectHidden(
    adapterId: string,
    ssid: string,
    security: Exclude<WifiSecurity, "unsupported">,
    password: string | undefined,
  ): Promise<void> {
    void adapterId;
    void ssid;
    void security;
    void password;
    return Promise.resolve();
  }
  disconnect(adapterId: string): Promise<void> {
    void adapterId;
    return Promise.resolve();
  }
  forgetManagedProfile(adapterId: string): Promise<void> {
    void adapterId;
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
