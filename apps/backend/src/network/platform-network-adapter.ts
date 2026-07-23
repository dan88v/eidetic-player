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
      wifiAdapters: [],
      activeRouteType: "wired",
      permissionState: "granted",
      softwareRadio: "on",
      hardwareRadio: "on",
      currentNetwork: null,
      managedByEidetic: false,
      availableNetworks: [],
      scanState: "idle",
    });
  return platform === "win32"
    ? new WindowsNetworkAdapter()
    : new NetworkManagerAdapter();
}
