export type NetworkConnectivity =
  "disconnected" | "local-network" | "internet" | "unknown";
export type NetworkAdapterType = "wired" | "wifi";
export type Ipv4Method = "dhcp" | "manual" | "unknown";
export type NetworkOperation =
  | "idle"
  | "scanning"
  | "changing-radio"
  | "connecting"
  | "disconnecting"
  | "forgetting";
export type NetworkPermissionState =
  "granted" | "permission-required" | "authorization-required" | "unsupported";
export type NetworkErrorCode =
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
  | "generic-failure";
export type WifiSecurity =
  "open" | "wpa2-personal" | "wpa3-personal" | "unsupported";
export type WifiScanState =
  | "idle"
  | "scanning"
  | "results"
  | "no-networks"
  | "permission-required"
  | "wifi-off"
  | "unsupported"
  | "failed";

export interface NetworkAdapterSnapshot {
  readonly id: string;
  readonly type: NetworkAdapterType;
  readonly displayName: string;
  readonly present: boolean;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly linkSpeed?: string;
  readonly ipv4Method: Ipv4Method;
  readonly ipv4Address: string | null;
  readonly subnetMask: string | null;
  readonly gateway: string | null;
  readonly dnsServers: readonly string[];
  readonly ipv6Summary?: string;
}

export interface WifiNetwork {
  readonly id: string;
  readonly ssid: string;
  readonly signalPercent: number;
  readonly security: WifiSecurity;
  readonly connected: boolean;
  readonly supported: boolean;
  readonly frequencyBand?: "2.4 GHz" | "5 GHz" | "6 GHz";
}

export interface WifiState {
  readonly softwareRadio: "on" | "off" | "unknown";
  readonly hardwareRadio: "on" | "off" | "unknown";
  readonly currentNetwork: WifiNetwork | null;
  readonly managedByEidetic: boolean;
  readonly availableNetworks: readonly WifiNetwork[];
  readonly scanState: WifiScanState;
}

export interface NetworkPublicError {
  readonly code: NetworkErrorCode;
  readonly message: string;
}

export interface NetworkSnapshot {
  readonly revision: number;
  readonly connectivity: NetworkConnectivity;
  readonly wiredAdapters: readonly NetworkAdapterSnapshot[];
  readonly wifiAdapters: readonly NetworkAdapterSnapshot[];
  readonly activeRouteType: NetworkAdapterType | null;
  readonly operationState: NetworkOperation;
  readonly permissionState: NetworkPermissionState;
  readonly wifi: WifiState;
  readonly lastError: NetworkPublicError | null;
}

export interface WifiConnectRequest {
  readonly adapterId: string;
  readonly networkId: string;
  readonly password?: string;
}

export interface WifiHiddenConnectRequest {
  readonly adapterId: string;
  readonly ssid: string;
  readonly security: Exclude<WifiSecurity, "unsupported">;
  readonly password?: string;
}

export interface WifiAdapterRequest {
  readonly adapterId: string;
}

export interface WifiRadioRequest extends WifiAdapterRequest {
  readonly enabled: boolean;
}

export const emptyNetworkSnapshot: NetworkSnapshot = {
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
