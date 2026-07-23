import type {
  Ipv4Configuration,
  NetworkAdapterSnapshot,
  WifiNetwork,
  WifiSecurity,
} from "../../../../packages/shared/src/network.js";
import { runBoundedProcess } from "./bounded-process.js";
import {
  EIDETIC_WIFI_PROFILE,
  NetworkAdapterError,
  sortAndDeduplicateNetworks,
  type AdapterNetworkState,
  type AdapterIpv4RollbackState,
  type NetworkAdapter,
} from "./network-adapter.js";
import { opaqueNetworkId } from "./network-service.js";

function splitEscaped(line: string): string[] {
  const result: string[] = [];
  let value = "";
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === "\\") escaped = true;
    else if (character === ":") {
      result.push(value);
      value = "";
    } else value += character;
  }
  result.push(value);
  return result;
}

function securityOf(value: string): WifiSecurity {
  const upper = value.toUpperCase();
  if (!upper || upper === "--") return "open";
  if (upper.includes("WPA3") || upper.includes("SAE")) return "wpa3-personal";
  if (upper.includes("WPA2")) return "wpa2-personal";
  return "unsupported";
}

function prefixToMask(prefix: number): string {
  const bits = Math.max(0, Math.min(32, prefix));
  return [0, 8, 16, 24]
    .map((offset) => {
      const remaining = Math.max(0, Math.min(8, bits - offset));
      return String(remaining === 0 ? 0 : 256 - 2 ** (8 - remaining));
    })
    .join(".");
}

export class NetworkManagerAdapter implements NetworkAdapter {
  private nativeById = new Map<string, string>();
  private connectionById = new Map<string, string>();
  private pendingIpv4ById = new Map<string, AdapterIpv4RollbackState>();
  private networkById = new Map<
    string,
    { ssid: string; security: WifiSecurity }
  >();
  private networks: readonly WifiNetwork[] = [];
  private scanState: AdapterNetworkState["scanState"] = "idle";

  private async nmcli(
    args: readonly string[],
    input?: string,
    timeoutMs = 12_000,
  ): Promise<string> {
    let result;
    try {
      result = await runBoundedProcess("nmcli", args, {
        ...(input === undefined ? {} : { input }),
        timeoutMs,
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new NetworkAdapterError(
          "unsupported",
          "NetworkManager is unavailable.",
        );
      throw new NetworkAdapterError(
        "generic-failure",
        "Network action failed.",
      );
    }
    if (result.exitCode !== 0) {
      const detail = result.stderr.toLowerCase();
      if (detail.includes("not authorized") || detail.includes("permission"))
        throw new NetworkAdapterError(
          "authorization-required",
          "System authorization is required.",
        );
      if (detail.includes("secrets") || detail.includes("password"))
        throw new NetworkAdapterError(
          "invalid-credentials",
          "Credentials were not accepted.",
        );
      if (detail.includes("not found"))
        throw new NetworkAdapterError(
          "network-not-found",
          "Network not found.",
        );
      throw new NetworkAdapterError(
        "generic-failure",
        "Network action failed.",
      );
    }
    return result.stdout.trim();
  }

  async readState(): Promise<AdapterNetworkState> {
    const status = await this.nmcli([
      "-t",
      "-e",
      "yes",
      "-f",
      "DEVICE,TYPE,STATE,CONNECTION",
      "device",
      "status",
    ]);
    const wiredAdapters: NetworkAdapterSnapshot[] = [];
    const wifiAdapters: NetworkAdapterSnapshot[] = [];
    this.nativeById.clear();
    this.connectionById.clear();
    for (const line of status.split(/\r?\n/u).filter(Boolean)) {
      const [native = "", type = "", state = "", connection = ""] =
        splitEscaped(line);
      if (type !== "ethernet" && type !== "wifi") continue;
      const id = opaqueNetworkId(`${type}:${native}`);
      this.nativeById.set(id, native);
      this.connectionById.set(id, connection === "--" ? "" : connection);
      const details = await this.nmcli([
        "-t",
        "-e",
        "yes",
        "-f",
        "GENERAL.MTU,GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,IP4.METHOD",
        "device",
        "show",
        native,
      ]);
      const fields = new Map<string, string[]>();
      for (const detail of details.split(/\r?\n/u).filter(Boolean)) {
        const separator = detail.indexOf(":");
        const key = detail.slice(0, separator).replace(/\[\d+\]$/u, "");
        const value = splitEscaped(detail.slice(separator + 1)).join(":");
        fields.set(key, [...(fields.get(key) ?? []), value]);
      }
      const addressRaw = fields.get("IP4.ADDRESS")?.[0] ?? "";
      const [address = "", prefix = ""] = addressRaw.split("/");
      const connected = state.toLowerCase().startsWith("connected");
      const snapshot: NetworkAdapterSnapshot = {
        id,
        type: type === "wifi" ? "wifi" : "wired",
        displayName: native,
        present: true,
        enabled: state !== "unavailable",
        connected,
        ipv4Method:
          fields.get("IP4.METHOD")?.[0] === "auto"
            ? "dhcp"
            : fields.get("IP4.METHOD")?.[0] === "manual"
              ? "manual"
              : "unknown",
        ipv4Address: address || null,
        subnetMask: prefix ? prefixToMask(Number(prefix)) : null,
        gateway: fields.get("IP4.GATEWAY")?.[0] ?? null,
        dnsServers: (fields.get("IP4.DNS") ?? []).slice(0, 2),
      };
      (type === "wifi" ? wifiAdapters : wiredAdapters).push(snapshot);
      if (
        type === "wifi" &&
        connected &&
        connection &&
        connection !== "--" &&
        !this.networks.some((candidate) => candidate.connected)
      ) {
        const current: WifiNetwork = {
          id: opaqueNetworkId(`wifi:${connection}:unknown`),
          ssid: connection,
          signalPercent: 0,
          security: "unsupported",
          connected: true,
          supported: false,
        };
        this.networks = [current, ...this.networks];
      }
    }
    const radio = await this.nmcli(["radio", "wifi"]);
    const connectivityRaw = await this.nmcli(["networking", "connectivity"]);
    const connectivity =
      connectivityRaw === "full"
        ? "internet"
        : connectivityRaw === "limited"
          ? "local-network"
          : connectivityRaw === "none"
            ? "disconnected"
            : "unknown";
    const currentNetwork =
      this.networks.find((candidate) => candidate.connected) ?? null;
    const managedByEidetic = status.includes(EIDETIC_WIFI_PROFILE);
    return {
      connectivity,
      wiredAdapters,
      wifiAdapters,
      activeRouteType: wiredAdapters.some((item) => item.connected)
        ? "wired"
        : wifiAdapters.some((item) => item.connected)
          ? "wifi"
          : null,
      permissionState: "granted",
      softwareRadio: radio === "enabled" ? "on" : "off",
      hardwareRadio: wifiAdapters.some((item) => item.enabled)
        ? "on"
        : "unknown",
      currentNetwork,
      managedByEidetic,
      availableNetworks: this.networks,
      scanState: radio === "enabled" ? this.scanState : "wifi-off",
    };
  }

  async scan(adapterId: string): Promise<void> {
    const native = this.native(adapterId);
    this.scanState = "scanning";
    try {
      const output = await this.nmcli(
        [
          "-t",
          "-e",
          "yes",
          "-f",
          "SSID,SIGNAL,SECURITY,FREQ,IN-USE",
          "device",
          "wifi",
          "list",
          "--rescan",
          "yes",
          "ifname",
          native,
        ],
        undefined,
        20_000,
      );
      this.networkById.clear();
      const networks = output
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line): WifiNetwork | null => {
          const [
            ssid = "",
            signal = "0",
            rawSecurity = "",
            frequency = "",
            active = "",
          ] = splitEscaped(line);
          if (!ssid) return null;
          const security = securityOf(rawSecurity);
          const id = opaqueNetworkId(`wifi:${ssid}:${security}`);
          this.networkById.set(id, { ssid, security });
          const mhz = Number(frequency);
          return {
            id,
            ssid,
            signalPercent: Math.max(0, Math.min(100, Number(signal) || 0)),
            security,
            connected: active === "*",
            supported: security !== "unsupported",
            ...(mhz
              ? {
                  frequencyBand:
                    mhz >= 5925 ? "6 GHz" : mhz >= 4900 ? "5 GHz" : "2.4 GHz",
                }
              : {}),
          };
        })
        .filter((item): item is WifiNetwork => item !== null);
      this.networks = sortAndDeduplicateNetworks(networks);
      this.scanState = this.networks.length ? "results" : "no-networks";
    } catch (error) {
      this.scanState = "failed";
      throw error;
    }
  }

  setRadio(adapterId: string, enabled: boolean): Promise<void> {
    this.native(adapterId);
    return this.nmcli(["radio", "wifi", enabled ? "on" : "off"]).then(
      () => undefined,
    );
  }

  async connect(
    adapterId: string,
    networkId: string,
    password: string | undefined,
  ): Promise<void> {
    const network = this.networkById.get(networkId);
    if (!network)
      throw new NetworkAdapterError("network-not-found", "Network not found.");
    if (network.security === "unsupported")
      throw new NetworkAdapterError(
        "unsupported",
        "This Wi-Fi security mode is unsupported.",
      );
    await this.connectSsid(
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

  private async connectSsid(
    adapterId: string,
    ssid: string,
    security: Exclude<WifiSecurity, "unsupported">,
    hidden: boolean,
    password: string | undefined,
  ): Promise<void> {
    const native = this.native(adapterId);
    const temporary = `${EIDETIC_WIFI_PROFILE} pending`;
    await this.nmcli(["connection", "delete", temporary]).catch(
      () => undefined,
    );
    const args = [
      "--wait",
      "20",
      ...(password ? ["--passwd-file", "/dev/stdin"] : []),
      "device",
      "wifi",
      "connect",
      ssid,
      "ifname",
      native,
      "name",
      temporary,
      ...(hidden ? ["hidden", "yes"] : []),
    ];
    const secret =
      security === "open" || !password
        ? undefined
        : `802-11-wireless-security.psk:${password}\n`;
    try {
      await this.nmcli(args, secret, 25_000);
      await this.nmcli(["connection", "delete", EIDETIC_WIFI_PROFILE]).catch(
        () => undefined,
      );
      await this.nmcli([
        "connection",
        "modify",
        temporary,
        "connection.id",
        EIDETIC_WIFI_PROFILE,
      ]);
    } catch (error) {
      await this.nmcli(["connection", "delete", temporary]).catch(
        () => undefined,
      );
      throw error;
    }
  }

  disconnect(adapterId: string): Promise<void> {
    return this.nmcli(["device", "disconnect", this.native(adapterId)]).then(
      () => undefined,
    );
  }
  forgetManagedProfile(adapterId: string): Promise<void> {
    this.native(adapterId);
    return this.nmcli(["connection", "delete", EIDETIC_WIFI_PROFILE]).then(
      () => undefined,
    );
  }

  async captureIpv4(adapterId: string): Promise<AdapterIpv4RollbackState> {
    const native = this.native(adapterId);
    const current = this.connectionById.get(adapterId) ?? "";
    if (!current)
      throw new NetworkAdapterError(
        "profile-error",
        "The adapter has no active NetworkManager profile.",
      );
    const state = await this.readState();
    const adapter = [...state.wiredAdapters, ...state.wifiAdapters].find(
      (candidate) => candidate.id === adapterId,
    );
    if (!adapter)
      throw new NetworkAdapterError("no-adapter", "Adapter not found.");
    if (adapter.type === "wifi" && current !== EIDETIC_WIFI_PROFILE)
      throw new NetworkAdapterError(
        "profile-error",
        "IPv4 is read-only for Wi-Fi profiles managed by the system.",
      );
    const managed =
      adapter.type === "wifi"
        ? EIDETIC_WIFI_PROFILE
        : `Eidetic Player IPv4 ${adapterId.slice(-6)}`;
    const rollback: AdapterIpv4RollbackState = {
      version: 1,
      adapterId,
      nativeAdapterId: native,
      configuration: {
        method: adapter.ipv4Method === "manual" ? "manual" : "dhcp",
        address: adapter.ipv4Address ?? "",
        subnetMask: adapter.subnetMask ?? "",
        gateway: adapter.gateway ?? "",
        dns1: adapter.dnsServers[0] ?? "",
        dns2: adapter.dnsServers[1] ?? "",
      },
      nativeState: {
        previousConnection: current,
        managedConnection: managed,
      },
    };
    this.pendingIpv4ById.set(adapterId, rollback);
    return rollback;
  }

  async applyIpv4(
    adapterId: string,
    configuration: Ipv4Configuration,
  ): Promise<void> {
    const rollback = this.pendingIpv4ById.get(adapterId);
    const managed = rollback?.nativeState?.managedConnection;
    const previous = rollback?.nativeState?.previousConnection;
    if (typeof managed !== "string" || typeof previous !== "string")
      throw new NetworkAdapterError(
        "profile-error",
        "The managed IPv4 profile is unavailable.",
      );
    if (managed !== previous) {
      await this.nmcli(["connection", "delete", managed]).catch(
        () => undefined,
      );
      await this.nmcli(["connection", "clone", previous, managed]);
    }
    const prefix = maskToPrefix(configuration.subnetMask);
    const properties =
      configuration.method === "dhcp"
        ? [
            "ipv4.method",
            "auto",
            "ipv4.addresses",
            "",
            "ipv4.gateway",
            "",
            "ipv4.dns",
            "",
          ]
        : [
            "ipv4.method",
            "manual",
            "ipv4.addresses",
            `${configuration.address}/${String(prefix)}`,
            "ipv4.gateway",
            configuration.gateway,
            "ipv4.dns",
            [configuration.dns1, configuration.dns2].filter(Boolean).join(","),
          ];
    await this.nmcli(["connection", "modify", managed, ...properties]);
    await this.nmcli([
      "--wait",
      "20",
      "connection",
      "up",
      managed,
      "ifname",
      this.native(adapterId),
    ]);
  }

  async restoreIpv4(state: AdapterIpv4RollbackState): Promise<void> {
    const previous = state.nativeState?.previousConnection;
    const managed = state.nativeState?.managedConnection;
    if (typeof previous !== "string" || previous.length === 0)
      throw new NetworkAdapterError(
        "profile-error",
        "The previous NetworkManager profile is unavailable.",
      );
    if (managed === previous) {
      const configuration = state.configuration;
      const properties =
        configuration.method === "dhcp"
          ? [
              "ipv4.method",
              "auto",
              "ipv4.addresses",
              "",
              "ipv4.gateway",
              "",
              "ipv4.dns",
              "",
            ]
          : [
              "ipv4.method",
              "manual",
              "ipv4.addresses",
              `${configuration.address}/${String(maskToPrefix(configuration.subnetMask))}`,
              "ipv4.gateway",
              configuration.gateway,
              "ipv4.dns",
              [configuration.dns1, configuration.dns2]
                .filter(Boolean)
                .join(","),
            ];
      await this.nmcli(["connection", "modify", previous, ...properties]);
    }
    await this.nmcli([
      "--wait",
      "20",
      "connection",
      "up",
      previous,
      "ifname",
      state.nativeAdapterId,
    ]);
    if (typeof managed === "string" && managed !== previous)
      await this.nmcli(["connection", "delete", managed]).catch(
        () => undefined,
      );
    this.pendingIpv4ById.delete(state.adapterId);
  }
  close(): Promise<void> {
    this.nativeById.clear();
    this.networkById.clear();
    this.connectionById.clear();
    this.pendingIpv4ById.clear();
    return Promise.resolve();
  }

  private native(adapterId: string): string {
    const native = this.nativeById.get(adapterId);
    if (!native)
      throw new NetworkAdapterError("no-adapter", "Wi-Fi adapter not found.");
    return native;
  }
}

function maskToPrefix(mask: string): number {
  return mask
    .split(".")
    .map(Number)
    .reduce(
      (total, octet) =>
        total + octet.toString(2).padStart(8, "0").replaceAll("0", "").length,
      0,
    );
}
