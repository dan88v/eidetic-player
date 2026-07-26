import assert from "node:assert/strict";
import test from "node:test";
import { createPlatformNetworkAdapter } from "../src/network/platform-network-adapter.js";

const wifiAdapterId = "network-fedcba9876543210";

void test("development network fixture covers safe Wi-Fi lifecycle without retaining secrets", async () => {
  const adapter = createPlatformNetworkAdapter("win32", {
    EIDETIC_NETWORK_FIXTURE: "1",
  });
  const initial = await adapter.readState();
  assert.equal(initial.wiredAdapters.length, 1);
  assert.equal(initial.wifiAdapters.length, 1);
  assert.equal(initial.activeRouteType, "wired");
  assert.deepEqual(
    initial.availableNetworks.map((network) => network.security),
    ["open", "wpa2-personal", "wpa3-personal", "unsupported"],
  );
  assert.equal(
    initial.availableNetworks.every((network) =>
      /^network-[0-9a-f]{16}$/u.test(network.id),
    ),
    true,
  );

  await adapter.scan(wifiAdapterId);
  assert.equal((await adapter.readState()).scanState, "results");

  const secret = "fixture-secret-must-not-persist";
  await adapter.connect(wifiAdapterId, "network-2222222222222222", secret);
  let state = await adapter.readState();
  assert.equal(state.currentNetwork?.ssid, "Fixture WPA2");
  assert.equal(state.managedByEidetic, true);
  assert.equal(state.activeRouteType, "wired");
  assert.equal(JSON.stringify(state).includes(secret), false);

  await adapter.disconnect(wifiAdapterId);
  state = await adapter.readState();
  assert.equal(state.currentNetwork, null);
  assert.equal(state.managedByEidetic, true);

  await adapter.connectHidden(
    wifiAdapterId,
    "Fixture Hidden",
    "wpa3-personal",
    secret,
  );
  assert.equal(
    (await adapter.readState()).currentNetwork?.ssid,
    "Fixture Hidden",
  );
  await adapter.forgetManagedProfile(wifiAdapterId);
  assert.equal((await adapter.readState()).managedByEidetic, false);

  await adapter.setRadio(wifiAdapterId, false);
  state = await adapter.readState();
  assert.equal(state.softwareRadio, "off");
  assert.equal(state.wifiAdapters[0]?.connected, false);
  assert.equal(state.scanState, "wifi-off");
  await adapter.setRadio(wifiAdapterId, true);
  assert.equal((await adapter.readState()).softwareRadio, "on");
});
