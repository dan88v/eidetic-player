import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  validateIpv4Draft,
  type Ipv4Draft,
} from "../../../packages/shared/src/network.js";
import { FixtureNetworkAdapter } from "../src/network/fixture-network-adapter.js";
import type {
  AdapterNetworkState,
  NetworkAdapter,
} from "../src/network/network-adapter.js";
import { NetworkService } from "../src/network/network-service.js";
import { NetworkTransactionRepository } from "../src/network/network-transaction-repository.js";

const adapterId = "network-0123456789abcdef";
const dhcpState = (): AdapterNetworkState => ({
  connectivity: "internet",
  wiredAdapters: [
    {
      id: adapterId,
      type: "wired",
      displayName: "Fixture Ethernet",
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
const manual: Ipv4Draft = {
  method: "manual",
  address: "192.0.2.44",
  subnetMask: "255.255.255.0",
  gateway: "192.0.2.1",
  dns1: "1.1.1.1",
  dns2: "9.9.9.9",
};

void test("IPv4 validation rejects malformed masks and off-subnet gateways", () => {
  assert.deepEqual(validateIpv4Draft(manual).errors, {});
  assert.equal(
    validateIpv4Draft({ ...manual, subnetMask: "255.0.255.0" }).errors
      .subnetMask,
    "Enter a contiguous subnet mask.",
  );
  assert.equal(
    validateIpv4Draft({ ...manual, gateway: "198.51.100.1" }).errors.gateway,
    "Gateway must be on the same subnet.",
  );
  assert.equal(validateIpv4Draft({ ...manual, dns2: "" }).valid, true);
  assert.equal(
    validateIpv4Draft({
      ...manual,
      gateway: "",
      dns1: "",
      dns2: "",
    }).valid,
    true,
  );
  for (const address of [
    "0.0.0.0",
    "255.255.255.255",
    "127.0.0.1",
    "224.0.0.1",
    "192.0.2.0",
    "192.0.2.255",
  ])
    assert.equal(
      validateIpv4Draft({ ...manual, address }).valid,
      false,
      address,
    );
  assert.equal(
    validateIpv4Draft({ ...manual, subnetMask: "255.255.255.254" }).valid,
    false,
  );
  assert.equal(
    validateIpv4Draft({ ...manual, dns1: "", dns2: "9.9.9.9" }).errors.dns2,
    "Enter DNS 1 before DNS 2.",
  );
  assert.equal(
    validateIpv4Draft({ ...manual, dns2: manual.dns1 }).errors.dns2,
    "DNS servers must be different.",
  );
  assert.equal(
    validateIpv4Draft({
      ...manual,
      address: " 192.0.2.44 ",
      gateway: "",
      dns1: "",
      dns2: "",
    }).normalized.address,
    "192.0.2.44",
  );
  assert.equal(
    validateIpv4Draft({
      method: "dhcp",
      address: "invalid",
      subnetMask: "",
      gateway: "",
      dns1: "",
      dns2: "",
    }).valid,
    true,
  );
});

void test("safe IPv4 transaction can be confirmed and removes pending state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-ipv4-test-"));
  try {
    const repository = new NetworkTransactionRepository(
      join(directory, "pending.json"),
    );
    const service = new NetworkService(
      new FixtureNetworkAdapter(dhcpState()),
      60_000,
      repository,
      30_000,
    );
    await service.refresh();
    await service.applyIpv4(adapterId, manual);
    assert.equal(
      service.snapshot().configurationTransaction?.state,
      "awaiting-confirmation",
    );
    assert.equal(
      service.snapshot().wiredAdapters[0]?.ipv4Address,
      manual.address,
    );
    assert.equal((await repository.read()).status, "valid");
    await service.confirmIpv4();
    assert.equal(service.snapshot().configurationTransaction, null);
    assert.equal((await repository.read()).status, "none");
    await service.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("unconfirmed IPv4 transaction rolls back automatically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-ipv4-test-"));
  try {
    const repository = new NetworkTransactionRepository(
      join(directory, "pending.json"),
    );
    const service = new NetworkService(
      new FixtureNetworkAdapter(dhcpState()),
      60_000,
      repository,
      25,
    );
    await service.refresh();
    await service.applyIpv4(adapterId, manual);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(service.snapshot().configurationTransaction, null);
    assert.equal(service.snapshot().wiredAdapters[0]?.ipv4Method, "dhcp");
    assert.equal((await repository.read()).status, "none");
    await service.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("explicit Revert restores state and duplicate Apply is rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-ipv4-test-"));
  try {
    const repository = new NetworkTransactionRepository(
      join(directory, "pending.json"),
    );
    const service = new NetworkService(
      new FixtureNetworkAdapter(dhcpState()),
      60_000,
      repository,
      30_000,
    );
    await service.refresh();
    const publishedMethods: string[] = [];
    const unsubscribe = service.subscribe((snapshot) => {
      if (snapshot.configurationTransaction === null)
        publishedMethods.push(
          snapshot.wiredAdapters[0]?.ipv4Method ?? "missing",
        );
    });
    await service.applyIpv4(adapterId, manual);
    await assert.rejects(service.applyIpv4(adapterId, manual));
    await service.rollbackIpv4();
    assert.equal(service.snapshot().wiredAdapters[0]?.ipv4Method, "dhcp");
    assert.deepEqual(publishedMethods, ["dhcp"]);
    assert.equal((await repository.read()).status, "none");
    unsubscribe();
    await service.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("startup recovery restores a transaction left pending by shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-ipv4-test-"));
  try {
    const repository = new NetworkTransactionRepository(
      join(directory, "pending.json"),
    );
    const state = dhcpState();
    const firstAdapter = new FixtureNetworkAdapter(state);
    const first = new NetworkService(firstAdapter, 60_000, repository, 30_000);
    await first.refresh();
    await first.applyIpv4(adapterId, manual);
    await first.close();
    assert.equal((await repository.read()).status, "valid");

    const second = new NetworkService(firstAdapter, 60_000, repository, 30_000);
    await second.refresh();
    assert.equal(second.snapshot().wiredAdapters[0]?.ipv4Method, "dhcp");
    assert.equal(second.snapshot().configurationTransaction, null);
    assert.equal((await repository.read()).status, "none");
    await second.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rollback failure preserves pending state as recovery-required", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-ipv4-test-"));
  try {
    const repository = new NetworkTransactionRepository(
      join(directory, "pending.json"),
    );
    const fixture = new FixtureNetworkAdapter(dhcpState());
    const adapter: NetworkAdapter = {
      readState: () => fixture.readState(),
      scan: (id) => fixture.scan(id),
      setRadio: (id, enabled) => fixture.setRadio(id, enabled),
      connect: (id, network, password) =>
        fixture.connect(id, network, password),
      connectHidden: (id, ssid, security, password) =>
        fixture.connectHidden(id, ssid, security, password),
      disconnect: (id) => fixture.disconnect(id),
      forgetManagedProfile: (id) => fixture.forgetManagedProfile(id),
      captureIpv4: (id) => fixture.captureIpv4(id),
      applyIpv4: (id, configuration) => fixture.applyIpv4(id, configuration),
      restoreIpv4: () => Promise.reject(new Error("fixture rollback failure")),
      close: () => fixture.close(),
    };
    const service = new NetworkService(adapter, 60_000, repository, 30_000);
    await service.refresh();
    await service.applyIpv4(adapterId, manual);
    await assert.rejects(service.rollbackIpv4());
    assert.equal(
      service.snapshot().configurationTransaction?.state,
      "recovery-required",
    );
    assert.equal((await repository.read()).status, "valid");
    await service.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("corrupt pending state is preserved and reported as recovery-required", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eidetic-ipv4-test-"));
  try {
    const path = join(directory, "pending.json");
    await writeFile(path, "{not-json", "utf8");
    const repository = new NetworkTransactionRepository(path);
    const service = new NetworkService(
      new FixtureNetworkAdapter(dhcpState()),
      60_000,
      repository,
    );
    await service.refresh();
    assert.equal(
      service.snapshot().configurationTransaction?.state,
      "recovery-required",
    );
    assert.equal((await repository.read()).status, "invalid");
    await service.close();
    await writeFile(path, JSON.stringify({ version: 2 }), "utf8");
    assert.equal((await repository.read()).status, "invalid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
