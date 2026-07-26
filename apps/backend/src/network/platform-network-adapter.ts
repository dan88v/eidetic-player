import type { NetworkAdapter } from "./network-adapter.js";
import { FixtureNetworkAdapter } from "./fixture-network-adapter.js";
import { NetworkManagerAdapter } from "./network-manager-adapter.js";
import { WindowsNetworkAdapter } from "./windows-network-adapter.js";

export function createPlatformNetworkAdapter(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): NetworkAdapter {
  if (environment.EIDETIC_NETWORK_FIXTURE === "1")
    return new FixtureNetworkAdapter({
      connectivity: "internet",
      wiredAdapters: [
        {
          id: "network-0123456789abcdef",
          type: "wired",
          displayName: "Fixture Ethernet",
          present: true,
          enabled: true,
          connected: true,
          linkSpeed: "1 Gbps",
          ipv4Method: "dhcp",
          ipv4Address: "192.0.2.20",
          subnetMask: "255.255.255.0",
          gateway: "192.0.2.1",
          dnsServers: ["192.0.2.1"],
        },
      ],
      wifiAdapters: [
        {
          id: "network-fedcba9876543210",
          type: "wifi",
          displayName: "Fixture Wi-Fi",
          present: true,
          enabled: true,
          connected: false,
          linkSpeed: "300 Mbps",
          ipv4Method: "dhcp",
          ipv4Address: null,
          subnetMask: null,
          gateway: null,
          dnsServers: [],
        },
      ],
      activeRouteType: "wired",
      permissionState: "granted",
      softwareRadio: "on",
      hardwareRadio: "on",
      currentNetwork: null,
      managedByEidetic: false,
      availableNetworks: [
        {
          id: "network-1111111111111111",
          ssid: "Fixture Open",
          signalPercent: 88,
          security: "open",
          connected: false,
          supported: true,
          frequencyBand: "2.4 GHz",
        },
        {
          id: "network-2222222222222222",
          ssid: "Fixture WPA2",
          signalPercent: 76,
          security: "wpa2-personal",
          connected: false,
          supported: true,
          frequencyBand: "5 GHz",
        },
        {
          id: "network-3333333333333333",
          ssid: "Fixture WPA3",
          signalPercent: 64,
          security: "wpa3-personal",
          connected: false,
          supported: true,
          frequencyBand: "5 GHz",
        },
        {
          id: "network-4444444444444444",
          ssid: "Fixture Enterprise",
          signalPercent: 52,
          security: "unsupported",
          connected: false,
          supported: false,
          frequencyBand: "2.4 GHz",
        },
      ],
      scanState: "idle",
    });
  return platform === "win32"
    ? new WindowsNetworkAdapter()
    : new NetworkManagerAdapter();
}
