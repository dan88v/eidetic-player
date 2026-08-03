import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const repository = resolve(import.meta.dirname, "../../..");

void test("local backend remains loopback and Remote UI has a separate build root", async () => {
  const config = await readFile(
    resolve(repository, "packages/config/src/index.ts"),
    "utf8",
  );
  const remoteConfig = await readFile(
    resolve(repository, "apps/remote-ui/vite.config.ts"),
    "utf8",
  );
  assert.match(config, /127\.0\.0\.1/u);
  assert.match(config, /4310/u);
  assert.match(remoteConfig, /dist\/remote-ui|dist", "remote-ui/u);
  assert.doesNotMatch(remoteConfig, /apps\/ui/u);
});

void test("appliance AppShell changes are limited to Remote access API plumbing", async () => {
  const shell = await readFile(
    resolve(repository, "apps/ui/src/components/app-shell.ts"),
    "utf8",
  );
  assert.match(shell, /RemoteAccessApiClient/u);
  assert.equal((shell.match(/RemoteAccessApiClient/gu) ?? []).length, 2);
  assert.doesNotMatch(shell, /EventSource.*remote|remote.*EventSource/iu);
  assert.doesNotMatch(shell, /remote-ui|remote-shell|bottom-nav/iu);
});

void test("local UI imports no Remote UI code or CSS", async () => {
  const files = [
    "apps/ui/src/main.ts",
    "apps/ui/src/components/app-shell.ts",
    "apps/ui/src/screens/settings.ts",
    "apps/ui/src/styles/index.css",
  ];
  for (const relative of files) {
    const content = await readFile(resolve(repository, relative), "utf8");
    assert.doesNotMatch(content, /apps\/remote-ui|remote-ui\/src/iu, relative);
  }
});

void test("unavailable Remote access is explicit and exposes no active-looking controls", async () => {
  const panel = await readFile(
    resolve(repository, "apps/ui/src/screens/remote-access-settings-panel.ts"),
    "utf8",
  );
  const settings = await readFile(
    resolve(repository, "apps/ui/src/screens/settings.ts"),
    "utf8",
  );
  assert.match(panel, /if \(!state\.available\)/u);
  assert.match(panel, /Remote access unavailable/u);
  assert.match(panel, /Remote access is Off\. No LAN listener is running/u);
  assert.match(panel, /EIDETIC_REMOTE_ACCESS_FIXTURE=1/u);
  assert.match(settings, /Unavailable in this build\./u);
  assert.match(settings, /remoteState\.status === "listening"\s*\? "On"/u);
  assert.match(
    settings,
    /\.state\(\)\s*\.catch\(\(\) => options\.remoteAccessApi\.state\(\)\)/u,
  );
});

void test("Remote access lives under Network and keeps its canonical action hierarchy", async () => {
  const panel = await readFile(
    resolve(repository, "apps/ui/src/screens/remote-access-settings-panel.ts"),
    "utf8",
  );
  const settings = await readFile(
    resolve(repository, "apps/ui/src/screens/settings.ts"),
    "utf8",
  );
  const rootBlock = settings.slice(
    settings.indexOf('if (page === "root")'),
    settings.indexOf('if (page === "network")'),
  );
  const networkBlock = settings.slice(
    settings.indexOf('if (page === "network")'),
    settings.indexOf('if (page === "airplay")'),
  );
  assert.doesNotMatch(rootBlock, /createRemoteAccessNavigation\(\)/u);
  assert.match(networkBlock, /createRemoteAccessNavigation\(\)/u);
  assert.match(settings, /page === "remote-access"\) page = "network"/u);
  assert.match(panel, /remote-access-primary-actions/u);
  assert.match(panel, /Pair new device/u);
  assert.match(panel, /remote-access-devices-panel/u);
  assert.match(panel, /remote-access-revoke-all/u);
  assert.doesNotMatch(panel, /securityNotice/u);
});

void test("pair completion reuses the player SSE and updates the local panel", async () => {
  const sseHub = await readFile(
    resolve(repository, "apps/backend/src/api/sse-hub.ts"),
    "utf8",
  );
  const backend = await readFile(
    resolve(repository, "apps/backend/src/index.ts"),
    "utf8",
  );
  const playerApi = await readFile(
    resolve(repository, "apps/ui/src/api/player-api-client.ts"),
    "utf8",
  );
  const remoteApi = await readFile(
    resolve(repository, "apps/ui/src/api/remote-access-api-client.ts"),
    "utf8",
  );
  const panel = await readFile(
    resolve(repository, "apps/ui/src/screens/remote-access-settings-panel.ts"),
    "utf8",
  );
  assert.match(sseHub, /broadcastNamed\("remote-access"/u);
  assert.match(backend, /events\.attachRemoteAccess\(remoteAccess\)/u);
  assert.match(playerApi, /addEventListener\("remote-access"/u);
  assert.doesNotMatch(remoteApi, /new EventSource/u);
  assert.match(remoteApi, /receiveState/u);
  assert.match(panel, /Pairing completed\./u);
  assert.match(panel, /completedPairingDevice/u);
});
