import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyNetworkSnapshot } from "../../../packages/shared/src/network";
import { disconnectedAudioOutputState } from "../../../packages/shared/src/audio-output";
import { networkSummary } from "../src/screens/network-settings-panel";
import {
  audioOutputStatusCopy,
  wifiStatusCopy,
} from "../src/components/top-bar";

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

void test("top-bar exposes connected network detail without another stream", () => {
  const topBar = readFileSync(
    new URL("../src/components/top-bar.ts", import.meta.url),
    "utf8",
  );
  assert.match(topBar, /data-network-indicator="wired"/);
  assert.match(topBar, /data-status-trigger="wifi"/);
  assert.match(topBar, /wiredIndicator\.hidden = !wiredConnected/);
  assert.match(topBar, /adapter\.ipv4Address/);
  assert.match(topBar, /network\.signalPercent/);
  assert.doesNotMatch(topBar, /EventSource|setTimeout|requestAnimationFrame/);
});

void test("top-bar Wi-Fi copy includes SSID, IPv4 address, and signal", () => {
  const copy = wifiStatusCopy({
    ...emptyNetworkSnapshot,
    wifiAdapters: [
      {
        id: "wifi-1",
        type: "wifi",
        displayName: "Wi-Fi",
        present: true,
        enabled: true,
        connected: true,
        ipv4Method: "dhcp",
        ipv4Address: "10.0.0.112",
        subnetMask: "255.255.255.0",
        gateway: "10.0.0.1",
        dnsServers: ["10.0.0.1"],
      },
    ],
    wifi: {
      ...emptyNetworkSnapshot.wifi,
      currentNetwork: {
        id: "wifi-network-1",
        ssid: "Listening Room",
        signalPercent: 73,
        security: "wpa2-personal",
        connected: true,
        supported: true,
      },
    },
  });
  assert.equal(copy.summary, "Wi-Fi · Listening Room");
  assert.equal(copy.detail, "10.0.0.112 · Signal 73%");
});

void test("top-bar audio copy identifies physical output and effective interface", () => {
  const copy = audioOutputStatusCopy({
    ...disconnectedAudioOutputState,
    mpvAvailable: true,
    effectiveDeviceId: "alsa/sysdefault:CARD=sndrpirpidac",
    selectedPhysicalOutputId: "gpio-i2s-dac",
    canonicalOutputs: [
      {
        id: "gpio-i2s-dac",
        description: "GPIO / I2S DAC",
        available: true,
        routes: [
          {
            id: "alsa/sysdefault:CARD=sndrpirpidac",
            description: "snd_rpi_rpi_dac",
            kind: "alsa",
            available: true,
          },
        ],
      },
    ],
  });
  assert.equal(copy.summary, "Audio · GPIO / I2S DAC");
  assert.equal(copy.detail, "ALSA · snd_rpi_rpi_dac");
});

void test("Network uses canonical navigation rows for Wired, Wi-Fi, and AirPlay", () => {
  const settings = readFileSync(
    new URL("../src/screens/settings.ts", import.meta.url),
    "utf8",
  );
  assert.match(settings, /network-settings-header/);
  assert.match(settings, /header\.prepend\(back\)/);
  assert.match(
    settings,
    /navigationRow\("Wired", wiredSummary, "network-wired"\)/,
  );
  assert.match(
    settings,
    /navigationRow\("Wi-Fi", wifiSummary, "network-wifi"\)/,
  );
  assert.match(settings, /"AirPlay",[\s\S]*"airplay"/u);
  assert.doesNotMatch(
    settings,
    /header\.append\(networkPanel\.selectorElement\)/,
  );
  assert.match(settings, /options\.setHeaderActions\(null, null\)/);
  assert.doesNotMatch(settings, /setHeaderActions\(navigateBack/);
});

void test("AirPlay settings stay minimal and use the dedicated revisioned API", () => {
  const settings = readFileSync(
    new URL("../src/screens/settings.ts", import.meta.url),
    "utf8",
  );
  const client = readFileSync(
    new URL("../src/api/airplay-api-client.ts", import.meta.url),
    "utf8",
  );
  assert.match(settings, /label: "AirPlay receiver"/);
  assert.match(settings, /nameLabel\.textContent = "Receiver name"/);
  assert.match(settings, /statusLabel\.textContent = "Status"/);
  assert.match(settings, /outputLabel\.textContent = "Output"/);
  assert.match(
    settings,
    /Anyone on this local network can stream while AirPlay is enabled\./,
  );
  assert.match(settings, /title: "Stop AirPlay\?"/);
  assert.match(settings, /confirmLabel: "Stop AirPlay"/);
  assert.match(settings, /playbackSource\.activeSource === "airplay"/);
  assert.match(
    settings,
    /snapshot\.providerState !== playbackSource\.providerState/,
  );
  assert.match(settings, /\? "Playing"/);
  assert.match(settings, /\? "Paused"/);
  assert.match(settings, /\? "Available"/);
  assert.match(settings, /expectedRevision: airPlayState\.revision/);
  assert.doesNotMatch(settings, /Shairport|NQPTP|UDP 319|UDP 320/u);
  assert.match(client, /\/api\/airplay\/state/);
  assert.match(client, /\/api\/airplay\/settings/);
  assert.match(client, /AbortSignal\.timeout\(8_000\)/);
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

void test("standalone network details preserve the panel content margins", () => {
  const styles = readFileSync(
    new URL("../src/styles/screens.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /\.network-panel > \.network-details\s*\{\s*padding: var\(--space-4\) var\(--space-6\);/,
  );
});
