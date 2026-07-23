export type NetworkConnectivity =
  "disconnected" | "local-network" | "internet" | "unknown";
export type NetworkAdapterType = "wired" | "wifi";
export type Ipv4Method = "dhcp" | "manual" | "unknown";
export type ConfigurableIpv4Method = Exclude<Ipv4Method, "unknown">;
export type Ipv4Field = "address" | "subnetMask" | "gateway" | "dns1" | "dns2";
export interface Ipv4Configuration {
  readonly method: ConfigurableIpv4Method;
  readonly address: string;
  readonly subnetMask: string;
  readonly gateway: string;
  readonly dns1: string;
  readonly dns2: string;
}
export type Ipv4Draft = Ipv4Configuration;
export interface Ipv4ValidationResult {
  readonly valid: boolean;
  readonly normalized: Ipv4Draft;
  readonly errors: Readonly<Partial<Record<Ipv4Field, string>>>;
}
export type NetworkConfigurationTransactionState =
  | "validating"
  | "applying"
  | "awaiting-confirmation"
  | "confirming"
  | "rolling-back"
  | "rolled-back"
  | "confirmed"
  | "failed"
  | "recovery-required";
export interface NetworkConfigurationTransaction {
  readonly transactionId?: string;
  readonly adapterId: string;
  readonly state: NetworkConfigurationTransactionState;
  readonly configuration: Ipv4Configuration;
  readonly startedAt?: string;
  readonly expiresAt?: string;
  readonly previousSummary?: Ipv4Configuration;
  readonly requestedSummary?: Ipv4Configuration;
  readonly secondsRemaining: number | null;
  readonly remainingSeconds?: number | null;
  readonly canConfirm?: boolean;
  readonly canRollback?: boolean;
  readonly message: string | null;
  readonly error?: string;
}
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
  | "elevation-cancelled"
  | "access-denied"
  | "adapter-not-found"
  | "address-conflict"
  | "invalid-configuration"
  | "operation-timeout"
  | "rollback-failed"
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
  readonly configurationTransaction: NetworkConfigurationTransaction | null;
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
  configurationTransaction: null,
  lastError: null,
};

function parseIpv4(value: string): readonly number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return octets.every(
    (part, index) =>
      Number.isInteger(part) &&
      part >= 0 &&
      part <= 255 &&
      String(part) === parts[index],
  )
    ? octets
    : null;
}

function numericIpv4(value: readonly number[]): number {
  return (
    ((value[0] ?? 0) * 0x1000000 +
      (value[1] ?? 0) * 0x10000 +
      (value[2] ?? 0) * 0x100 +
      (value[3] ?? 0)) >>>
    0
  );
}

function isMulticast(value: readonly number[]): boolean {
  const first = value[0] ?? 0;
  return first >= 224 && first <= 239;
}

function isUnspecifiedOrBroadcast(value: readonly number[]): boolean {
  const numeric = numericIpv4(value);
  return numeric === 0 || numeric === 0xffffffff;
}

export function subnetMaskPrefix(value: string): number | null {
  const octets = parseIpv4(value);
  if (!octets) return null;
  const mask = numericIpv4(octets);
  let seenZero = false;
  let prefix = 0;
  for (let bit = 31; bit >= 0; bit -= 1) {
    const set = (mask & (2 ** bit)) !== 0;
    if (!set) seenZero = true;
    else if (seenZero) return null;
    else prefix += 1;
  }
  return prefix > 0 && prefix < 32 ? prefix : null;
}

export function validateIpv4Draft(draft: Ipv4Draft): Ipv4ValidationResult {
  const normalized: Ipv4Draft = {
    method: draft.method,
    address: draft.address.trim(),
    subnetMask: draft.subnetMask.trim(),
    gateway: draft.gateway.trim(),
    dns1: draft.dns1.trim(),
    dns2: draft.dns2.trim(),
  };
  const errors: Partial<Record<Ipv4Field, string>> = {};
  if (normalized.method === "manual") {
    const address = parseIpv4(normalized.address);
    const gateway = normalized.gateway ? parseIpv4(normalized.gateway) : null;
    const dns1 = normalized.dns1 ? parseIpv4(normalized.dns1) : null;
    const dns2 = normalized.dns2 ? parseIpv4(normalized.dns2) : null;
    const prefix = subnetMaskPrefix(normalized.subnetMask);
    if (
      !address ||
      isUnspecifiedOrBroadcast(address) ||
      isMulticast(address) ||
      (address[0] ?? 0) === 127
    )
      errors.address = "Enter a usable IPv4 address.";
    if (prefix === null) errors.subnetMask = "Enter a contiguous subnet mask.";
    if (normalized.gateway && !gateway)
      errors.gateway = "Enter a valid IPv4 gateway.";
    if (normalized.dns1 && !dns1)
      errors.dns1 = "Enter a valid primary DNS server.";
    if (normalized.dns2 && !dns2)
      errors.dns2 = "Enter a valid secondary DNS server.";
    if (address && prefix !== null) {
      const mask = numericIpv4(parseIpv4(normalized.subnetMask) ?? []);
      const host = numericIpv4(address);
      const network = (host & mask) >>> 0;
      const broadcast = (network | (~mask >>> 0)) >>> 0;
      if (host === network || host === broadcast)
        errors.address = "Address cannot be the network or broadcast address.";
      if (gateway) {
        const gatewayValue = numericIpv4(gateway);
        if (gatewayValue === host)
          errors.gateway = "Gateway must differ from the IP address.";
        else if (gatewayValue === network || gatewayValue === broadcast)
          errors.gateway = "Gateway cannot be a network or broadcast address.";
        else if ((gatewayValue & mask) >>> 0 !== network)
          errors.gateway = "Gateway must be on the same subnet.";
      }
    }
    for (const [field, server] of [
      ["dns1", dns1],
      ["dns2", dns2],
    ] as const)
      if (server && (isUnspecifiedOrBroadcast(server) || isMulticast(server)))
        errors[field] = "Enter a usable DNS server.";
    if (normalized.dns2 && !normalized.dns1)
      errors.dns2 = "Enter DNS 1 before DNS 2.";
    if (
      normalized.dns1 &&
      normalized.dns2 &&
      normalized.dns1 === normalized.dns2
    )
      errors.dns2 = "DNS servers must be different.";
  }
  return {
    valid: Object.keys(errors).length === 0,
    normalized,
    errors,
  };
}

export function ipv4ConfigurationOf(
  adapter: NetworkAdapterSnapshot,
): Ipv4Configuration {
  return {
    method: adapter.ipv4Method === "manual" ? "manual" : "dhcp",
    address: adapter.ipv4Address ?? "",
    subnetMask: adapter.subnetMask ?? "",
    gateway: adapter.gateway ?? "",
    dns1: adapter.dnsServers[0] ?? "",
    dns2: adapter.dnsServers[1] ?? "",
  };
}
