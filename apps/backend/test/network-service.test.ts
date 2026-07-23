import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  AdapterNetworkState,
  NetworkAdapter,
} from "../src/network/network-adapter.js";
import {
  NetworkAdapterError,
  sortAndDeduplicateNetworks,
} from "../src/network/network-adapter.js";
import {
  NetworkService,
  opaqueNetworkId,
} from "../src/network/network-service.js";
import { FixtureNetworkAdapter } from "../src/network/fixture-network-adapter.js";

const state = (): AdapterNetworkState => ({
  connectivity: "internet",
  wiredAdapters: [
    {
      id: opaqueNetworkId("wired:test"),
      type: "wired",
      displayName: "Ethernet",
      present: true,
      enabled: true,
      connected: true,
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

void test("NetworkService deduplicates unchanged monitor snapshots", async () => {
  const service = new NetworkService(
    new FixtureNetworkAdapter(state()),
    60_000,
  );
  await service.refresh();
  const initial = service.snapshot().revision;
  await service.refresh();
  assert.equal(service.snapshot().revision, initial);
  assert.equal(service.snapshot().wiredAdapters[0]?.ipv4Address, "192.0.2.20");
  await service.close();
});

void test("NetworkService recovers when NetworkManager becomes available after bootstrap", async () => {
  const fixture = new FixtureNetworkAdapter(state());
  let reads = 0;
  const adapter: NetworkAdapter = {
    readState: () => {
      reads += 1;
      return reads === 1
        ? Promise.reject(
            new NetworkAdapterError(
              "unsupported",
              "NetworkManager is restarting",
            ),
          )
        : fixture.readState();
    },
    scan: (id) => fixture.scan(id),
    setRadio: (id, enabled) => fixture.setRadio(id, enabled),
    connect: (id, network, password) => fixture.connect(id, network, password),
    connectHidden: (id, ssid, security, password) =>
      fixture.connectHidden(id, ssid, security, password),
    disconnect: (id) => fixture.disconnect(id),
    forgetManagedProfile: (id) => fixture.forgetManagedProfile(id),
    close: () => fixture.close(),
  };
  const service = new NetworkService(adapter, 60_000);
  await service.refresh();
  assert.equal(service.snapshot().permissionState, "unsupported");
  await service.refresh();
  assert.equal(service.snapshot().permissionState, "granted");
  assert.equal(service.snapshot().wiredAdapters.length, 1);
  assert.equal(service.snapshot().lastError, null);
  await service.close();
});

void test("NetworkService serializes adapter operations", async () => {
  let release = (): void => undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = new FixtureNetworkAdapter(state());
  const adapter: NetworkAdapter = {
    readState: () => fixture.readState(),
    scan: () => blocked,
    setRadio: (id, enabled) => fixture.setRadio(id, enabled),
    connect: (id, network, password) => fixture.connect(id, network, password),
    connectHidden: (id, ssid, security, password) =>
      fixture.connectHidden(id, ssid, security, password),
    disconnect: (id) => fixture.disconnect(id),
    forgetManagedProfile: (id) => fixture.forgetManagedProfile(id),
    close: () => fixture.close(),
  };
  const service = new NetworkService(adapter, 60_000);
  await service.refresh();
  const first = service.scan("adapter");
  await assert.rejects(
    service.scan("adapter"),
    (error: unknown) =>
      error instanceof NetworkAdapterError &&
      error.code === "operation-conflict",
  );
  release();
  await first;
  await service.close();
});

void test("NetworkService delegates every Wi-Fi mutation without publishing secrets", async () => {
  const calls: unknown[][] = [];
  let closed = false;
  const fixture = new FixtureNetworkAdapter(state());
  const adapter: NetworkAdapter = {
    readState: () => fixture.readState(),
    scan: (adapterId) => {
      calls.push(["scan", adapterId]);
      return Promise.resolve();
    },
    setRadio: (adapterId, enabled) => {
      calls.push(["radio", adapterId, enabled]);
      return Promise.resolve();
    },
    connect: (adapterId, networkId, password) => {
      calls.push(["connect", adapterId, networkId, password]);
      return Promise.resolve();
    },
    connectHidden: (adapterId, ssid, security, password) => {
      calls.push(["hidden", adapterId, ssid, security, password]);
      return Promise.resolve();
    },
    disconnect: (adapterId) => {
      calls.push(["disconnect", adapterId]);
      return Promise.resolve();
    },
    forgetManagedProfile: (adapterId) => {
      calls.push(["forget", adapterId]);
      return Promise.resolve();
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
  const service = new NetworkService(adapter, 60_000);
  await service.refresh();
  await service.setRadio("adapter", true);
  await service.connect("adapter", "network", "private-password");
  await service.connectHidden(
    "adapter",
    "Hidden network",
    "wpa3-personal",
    "other-private-password",
  );
  await service.disconnect("adapter");
  await service.forgetManagedProfile("adapter");
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["radio", "connect", "hidden", "disconnect", "forget"],
  );
  assert.doesNotMatch(
    JSON.stringify(service.snapshot()),
    /private-password|other-private-password/u,
  );
  await service.close();
  assert.equal(closed, true);
});

void test("permission denial becomes a persistent safe public state", async () => {
  const fixture = new FixtureNetworkAdapter(state());
  const adapter: NetworkAdapter = {
    readState: () =>
      Promise.reject(
        new NetworkAdapterError(
          "permission-required",
          "native detail must not escape",
        ),
      ),
    scan: (id) => fixture.scan(id),
    setRadio: (id, enabled) => fixture.setRadio(id, enabled),
    connect: (id, network, password) => fixture.connect(id, network, password),
    connectHidden: (id, ssid, security, password) =>
      fixture.connectHidden(id, ssid, security, password),
    disconnect: (id) => fixture.disconnect(id),
    forgetManagedProfile: (id) => fixture.forgetManagedProfile(id),
    close: () => fixture.close(),
  };
  const service = new NetworkService(adapter, 60_000);
  await service.refresh();
  assert.equal(service.snapshot().permissionState, "permission-required");
  assert.equal(service.snapshot().lastError?.code, "permission-required");
  assert.doesNotMatch(
    service.snapshot().lastError?.message ?? "",
    /native detail/u,
  );
  await service.close();
});

void test("Wi-Fi networks are aggregated and sorted without BSSID", () => {
  const networks = sortAndDeduplicateNetworks([
    {
      id: "weak",
      ssid: "Cafe",
      signalPercent: 20,
      security: "wpa2-personal",
      connected: false,
      supported: true,
    },
    {
      id: "strong",
      ssid: "Cafe",
      signalPercent: 80,
      security: "wpa2-personal",
      connected: false,
      supported: true,
    },
    {
      id: "current",
      ssid: "Home",
      signalPercent: 40,
      security: "wpa3-personal",
      connected: true,
      supported: true,
    },
  ]);
  assert.deepEqual(
    networks.map((network) => network.id),
    ["current", "strong"],
  );
  assert.doesNotMatch(JSON.stringify(networks), /bssid|mac|guid|uuid/iu);
});

void test("platform adapters keep secrets out of argv and avoid a shell", () => {
  const runner = readFileSync(
    new URL("../src/network/bounded-process.ts", import.meta.url),
    "utf8",
  );
  const linux = readFileSync(
    new URL("../src/network/network-manager-adapter.ts", import.meta.url),
    "utf8",
  );
  const windows = readFileSync(
    new URL("../src/network/windows-network-adapter.ts", import.meta.url),
    "utf8",
  );
  const windowsHelper = readFileSync(
    new URL("../src/network/windows-native-wifi-helper.ts", import.meta.url),
    "utf8",
  );
  assert.match(runner, /shell: false/);
  assert.match(runner, /windowsHide: true/);
  assert.match(linux, /--passwd-file/);
  assert.match(linux, /\/dev\/stdin/);
  assert.doesNotMatch(linux, /exec\(|sudo|wpa_supplicant|dhcpcd\.conf/u);
  assert.match(windows, /input: JSON\.stringify\(request\)/);
  assert.doesNotMatch(windows, /netsh/u);
  assert.match(linux, /ipv4\.method/);
  assert.match(
    linux,
    /IPv4 is read-only for Wi-Fi profiles managed by the system/,
  );
  assert.doesNotMatch(linux, /\/etc\/|connection\.uuid/u);
  assert.match(windows, /action: "ipv4"/);
  assert.match(windowsHelper, /Start-Process[\s\S]*-Verb RunAs/);
  assert.match(windowsHelper, /finally[\s\S]*Remove-Item/);
});
