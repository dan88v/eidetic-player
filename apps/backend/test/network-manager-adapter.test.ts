import assert from "node:assert/strict";
import test from "node:test";
import type { runBoundedProcess } from "../src/network/bounded-process.js";
import { NetworkManagerAdapter } from "../src/network/network-manager-adapter.js";

void test("NetworkManager reads IPv4 methods from active connection profiles", async () => {
  const calls: readonly string[][] = [];
  const mutableCalls = calls as string[][];
  const runner: typeof runBoundedProcess = (
    executable,
    arguments_,
    options,
  ) => {
    assert.equal(executable, "nmcli");
    assert.equal(options?.env?.LC_ALL, "C");
    mutableCalls.push([...arguments_]);
    assert.equal(
      arguments_.some((argument) => argument.includes("IP4.METHOD")),
      false,
    );

    const joined = arguments_.join("\u0000");
    let stdout = "";
    if (joined.includes("DEVICE,TYPE,STATE,CONNECTION"))
      stdout =
        "eth0:ethernet:connected:Fixture Wired\n" +
        "wlan0:wifi:connected:Fixture\\: Wi-Fi";
    else if (joined.includes("device\u0000show\u0000eth0"))
      stdout =
        "GENERAL.MTU:1500\nGENERAL.STATE:100 (connected)\n" +
        "GENERAL.CONNECTION:Fixture Wired\nIP4.ADDRESS[1]:192.0.2.20/24\n" +
        "IP4.GATEWAY:192.0.2.1\nIP4.DNS[1]:192.0.2.1";
    else if (joined.includes("device\u0000show\u0000wlan0"))
      stdout =
        "GENERAL.MTU:1500\nGENERAL.STATE:100 (connected)\n" +
        "GENERAL.CONNECTION:Fixture\\: Wi-Fi\nIP4.ADDRESS[1]:198.51.100.20/24\n" +
        "IP4.GATEWAY:198.51.100.1\nIP4.DNS[1]:198.51.100.1";
    else if (
      joined ===
      "-g\u0000ipv4.method\u0000connection\u0000show\u0000Fixture Wired"
    )
      stdout = "auto";
    else if (
      joined ===
      "-g\u0000ipv4.method\u0000connection\u0000show\u0000Fixture: Wi-Fi"
    )
      stdout = "manual";
    else if (joined === "radio\u0000wifi") stdout = "enabled";
    else if (joined === "networking\u0000connectivity") stdout = "full";
    else assert.fail(`Unexpected nmcli invocation: ${joined}`);
    return Promise.resolve({ stdout, stderr: "", exitCode: 0 });
  };

  const snapshot = await new NetworkManagerAdapter(runner).readState();
  assert.equal(snapshot.wiredAdapters[0]?.ipv4Method, "dhcp");
  assert.equal(snapshot.wifiAdapters[0]?.ipv4Method, "manual");
  assert.equal(snapshot.activeRouteType, "wired");
  assert.equal(snapshot.connectivity, "internet");
  assert.deepEqual(
    calls
      .filter((arguments_) => arguments_[0] === "-g")
      .map((arguments_) => arguments_.at(-1)),
    ["Fixture Wired", "Fixture: Wi-Fi"],
  );
});
