import type {
  NetworkAdapterSnapshot,
  NetworkConnectivity,
  NetworkPermissionState,
  WifiNetwork,
  WifiScanState,
  WifiSecurity,
} from "../../../../packages/shared/src/network.js";

export const EIDETIC_WIFI_PROFILE = "Eidetic Player Wi-Fi";

export interface AdapterNetworkState {
  readonly connectivity: NetworkConnectivity;
  readonly wiredAdapters: readonly NetworkAdapterSnapshot[];
  readonly wifiAdapters: readonly NetworkAdapterSnapshot[];
  readonly activeRouteType: "wired" | "wifi" | null;
  readonly permissionState: NetworkPermissionState;
  readonly softwareRadio: "on" | "off" | "unknown";
  readonly hardwareRadio: "on" | "off" | "unknown";
  readonly currentNetwork: WifiNetwork | null;
  readonly managedByEidetic: boolean;
  readonly availableNetworks: readonly WifiNetwork[];
  readonly scanState: WifiScanState;
}

export interface NetworkAdapter {
  readState(): Promise<AdapterNetworkState>;
  scan(adapterId: string): Promise<void>;
  setRadio(adapterId: string, enabled: boolean): Promise<void>;
  connect(
    adapterId: string,
    networkId: string,
    password: string | undefined,
  ): Promise<void>;
  connectHidden(
    adapterId: string,
    ssid: string,
    security: Exclude<WifiSecurity, "unsupported">,
    password: string | undefined,
  ): Promise<void>;
  disconnect(adapterId: string): Promise<void>;
  forgetManagedProfile(adapterId: string): Promise<void>;
  close(): Promise<void>;
}

export class NetworkAdapterError extends Error {
  constructor(
    readonly code:
      | "unsupported"
      | "no-adapter"
      | "wifi-hardware-off"
      | "permission-required"
      | "authorization-required"
      | "invalid-credentials"
      | "network-not-found"
      | "connection-timeout"
      | "profile-error"
      | "operation-conflict"
      | "generic-failure",
    message: string,
  ) {
    super(message);
  }
}

export function sortAndDeduplicateNetworks(
  networks: readonly WifiNetwork[],
): readonly WifiNetwork[] {
  const byKey = new Map<string, WifiNetwork>();
  for (const network of networks) {
    const key = `${network.ssid.normalize("NFKC").toLocaleLowerCase()}\u0000${network.security}`;
    const previous = byKey.get(key);
    if (!previous || network.signalPercent > previous.signalPercent)
      byKey.set(key, network);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      Number(right.connected) - Number(left.connected) ||
      right.signalPercent - left.signalPercent ||
      left.ssid.localeCompare(right.ssid, undefined, { sensitivity: "base" }) ||
      left.security.localeCompare(right.security),
  );
}
