import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyNetworkSnapshot } from "../../../packages/shared/src/network";
import { networkSummary } from "../src/screens/network-settings-panel";

void test("Settings Network summary chooses the most informative stable value", () => {
  assert.equal(
    networkSummary({
      ...emptyNetworkSnapshot,
      connectivity: "disconnected",
    }),
    "Disconnected",
  );
  assert.equal(
    networkSummary({
      ...emptyNetworkSnapshot,
      wiredAdapters: [
        {
          id: "network-0000000000000000",
          type: "wired",
          displayName: "Ethernet",
          present: true,
          enabled: true,
          connected: true,
          ipv4Method: "dhcp",
          ipv4Address: null,
          subnetMask: null,
          gateway: null,
          dnsServers: [],
        },
      ],
    }),
    "Wired connected",
  );
});

void test("AppShell owns one global Network EventSource and updates the top bar", () => {
  const shell = readFileSync(
    new URL("../src/components/app-shell.ts", import.meta.url),
    "utf8",
  );
  const client = readFileSync(
    new URL("../src/api/network-api-client.ts", import.meta.url),
    "utf8",
  );
  assert.equal((shell.match(/networkApi\.subscribe/g) ?? []).length, 1);
  assert.match(shell, /topBar\.updateNetwork\(snapshot\)/);
  assert.match(shell, /unsubscribeNetwork\(\)/);
  assert.equal((client.match(/new EventSource/g) ?? []).length, 1);
  assert.doesNotMatch(client, /setInterval|setTimeout|requestAnimationFrame/);
});

void test("Network dialogs opt password fields into the reusable private profile", () => {
  const panel = readFileSync(
    new URL("../src/screens/network-settings-panel.ts", import.meta.url),
    "utf8",
  );
  assert.match(panel, /type="password"[^>]+data-onscreen-keyboard="password"/);
  assert.match(panel, /form\.password\.value = ""/);
  assert.match(panel, /password\.value = ""/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage|console\./);
});

void test("top-bar network indicators remain passive and geometry-stable", () => {
  const topBar = readFileSync(
    new URL("../src/components/top-bar.ts", import.meta.url),
    "utf8",
  );
  assert.match(topBar, /top-bar__system-icons" aria-hidden="true"/);
  assert.match(topBar, /data-network-indicator="wired"/);
  assert.match(topBar, /data-network-indicator="wifi"/);
});

void test("Network reuses the Interface content header and keeps the hamburger", () => {
  const settings = readFileSync(
    new URL("../src/screens/settings.ts", import.meta.url),
    "utf8",
  );
  assert.match(settings, /network-settings-header/);
  assert.match(settings, /header\.prepend\(back\)/);
  assert.match(settings, /header\.append\(networkPanel\.selectorElement\)/);
  assert.match(settings, /options\.setHeaderActions\(null, null\)/);
  assert.doesNotMatch(settings, /setHeaderActions\(navigateBack/);
});

void test("IPv4 editor is draft-only, touch-keyboard aware, and protects navigation", () => {
  const panel = readFileSync(
    new URL("../src/screens/network-settings-panel.ts", import.meta.url),
    "utf8",
  );
  const client = readFileSync(
    new URL("../src/api/network-api-client.ts", import.meta.url),
    "utf8",
  );
  const shell = readFileSync(
    new URL("../src/components/app-shell.ts", import.meta.url),
    "utf8",
  );
  assert.match(panel, /value: draft\.method/);
  assert.match(panel, /dataset\.onscreenKeyboard = "ipv4"/);
  assert.match(panel, /validateIpv4Draft/);
  assert.match(panel, /if \(draft\.method === "manual"\)/);
  assert.match(panel, /actions\.hidden = !isDirty\(adapter\)/);
  assert.doesNotMatch(
    panel,
    /Address, gateway and DNS servers are assigned automatically/,
  );
  assert.match(panel, /Discard network changes\?/);
  assert.match(panel, /Continue editing/);
  assert.match(panel, /Apply network settings\?/);
  assert.match(panel, /Keep settings/);
  assert.match(panel, /requestLeave\(leave\)/);
  assert.match(client, /\/api\/network\/ipv4\/validate/);
  assert.match(client, /\/api\/network\/ipv4\/apply/);
  assert.match(shell, /currentScreen\?\.requestLeave/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage|setInterval/);
});

void test("completed IPv4 transactions close the dialog and resync the draft", () => {
  const panel = readFileSync(
    new URL("../src/screens/network-settings-panel.ts", import.meta.url),
    "utf8",
  );
  assert.match(panel, /if \(transactionFinished\) drafts\.clear\(\)/);
  assert.match(
    panel,
    /element\.querySelector\("\.network-dialog"\)[\s\S]*?!next\.configurationTransaction[\s\S]*?closeDialog\(\);\s*render\(\)/,
  );
  assert.doesNotMatch(panel, /!next\.configurationTransaction\s*\)\s*return;/);
});
