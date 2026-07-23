import type { NetworkAdapter } from "./network-adapter.js";
import { NetworkManagerAdapter } from "./network-manager-adapter.js";
import { WindowsNetworkAdapter } from "./windows-network-adapter.js";

export function createPlatformNetworkAdapter(
  platform: NodeJS.Platform = process.platform,
): NetworkAdapter {
  return platform === "win32"
    ? new WindowsNetworkAdapter()
    : new NetworkManagerAdapter();
}
