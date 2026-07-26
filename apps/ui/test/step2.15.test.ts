import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

void test("Settings nests always-open Output selection under Audio without a modal", async () => {
  const settings = await readFile("apps/ui/src/screens/settings.ts", "utf8");
  assert.match(settings, /\| "audio"/);
  assert.match(settings, /\| "audio-output"/);
  assert.match(settings, /audioTitle\.textContent = "Audio"/);
  assert.match(
    settings,
    /audioDetails\.textContent = "Playback and output settings"/,
  );
  assert.match(settings, /audioButton\.addEventListener\("click"/);
  assert.match(settings, /page = "audio"/);
  assert.match(settings, /outputTitle\.textContent = "Output"/);
  assert.match(settings, /outputButton\.addEventListener\("click"/);
  assert.match(settings, /page = "audio-output"/);
  assert.match(settings, /if \(page === "audio-output"\) page = "audio"/);
  assert.match(settings, /page === "audio-output"/);
  assert.doesNotMatch(
    settings,
    /audioOutputState\.devices\.length\s*>\s*1|options\.length\s*>\s*1/,
  );
  const audioSection = settings.slice(
    settings.lastIndexOf('if (page === "audio-output")'),
    settings.indexOf('if (page === "system")'),
  );
  assert.doesNotMatch(audioSection, /showModal\(\)/);
});

void test("Audio Output renders System default first with safe device text and distinct state indicators", async () => {
  const settings = await readFile("apps/ui/src/screens/settings.ts", "utf8");
  assert.match(settings, /id: "auto"/);
  assert.match(settings, /description: "System default"/);
  assert.match(settings, /description\.textContent = device\.description/);
  assert.match(settings, /identifier\.textContent = device\.id/);
  assert.match(settings, /✓ Preferred/);
  assert.match(settings, /effective\.textContent = "In use"/);
  assert.match(settings, /status\.textContent = "Unavailable"/);
  assert.doesNotMatch(settings, /device\.description[^;]*innerHTML/);
});

void test("Audio Output refresh and selection use the existing toast callback", async () => {
  const [settings, shell, toast] = await Promise.all([
    readFile("apps/ui/src/screens/settings.ts", "utf8"),
    readFile("apps/ui/src/components/app-shell.ts", "utf8"),
    readFile("apps/ui/src/components/toast-host.ts", "utf8"),
  ]);
  assert.match(settings, /aria-label", "Refresh audio outputs"/);
  assert.match(settings, /Audio outputs refreshed\./);
  assert.match(settings, /Audio outputs could not be refreshed\./);
  assert.match(settings, /Audio output changed\./);
  assert.match(settings, /Using System default\./);
  assert.match(settings, /Audio output could not be changed\./);
  assert.match(settings, /options\.showToast/);
  assert.match(shell, /toastHost\.show\(message, tone\)/);
  assert.equal((shell.match(/createToastHost\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(settings, /alert\(|confirm\(/);
  assert.match(toast, /transientMessage\.textContent = message/);
});

void test("Audio Output shares the player SSE connection and hot-unplug notice is revision gated", async () => {
  const [client, playerClient, shell, service, hub] = await Promise.all([
    readFile("apps/ui/src/api/audio-output-api-client.ts", "utf8"),
    readFile("apps/ui/src/api/player-api-client.ts", "utf8"),
    readFile("apps/ui/src/components/app-shell.ts", "utf8"),
    readFile("apps/backend/src/audio-output/audio-output-service.ts", "utf8"),
    readFile("apps/backend/src/api/sse-hub.ts", "utf8"),
  ]);
  assert.doesNotMatch(client, /new EventSource\(/);
  assert.match(playerClient, /addEventListener\("audio-output"/);
  assert.match(hub, /broadcastNamed\("audio-output"/);
  assert.match(
    shell,
    /snapshot\.noticeRevision > lastAudioOutputNoticeRevision/,
  );
  assert.match(
    shell,
    /Preferred audio output unavailable\. Using System default\./,
  );
  assert.doesNotMatch(service, /setInterval|setTimeout\([^,]+,\s*[1-9]\d{3,}/);
});

void test("Audio Output backend routes validate closed request bodies", async () => {
  const backend = await readFile("apps/backend/src/index.ts", "utf8");
  assert.match(backend, /\/api\/audio-output\/state/);
  assert.match(backend, /\/api\/audio-output\/select/);
  assert.match(backend, /keys\.length !== 1/);
  assert.match(backend, /keys\[0\] !== "deviceId"/);
  assert.match(backend, /\/api\/audio-output\/refresh/);
  assert.match(backend, /Object\.keys\(body\)\.length !== 0/);
  assert.match(backend, /error instanceof AudioOutputError/);
});

void test("bootstrap prepares audio output before player session restore", async () => {
  const backend = await readFile("apps/backend/src/index.ts", "utf8");
  assert.match(
    backend,
    /await prepareAudioOutputForSessionRestore\(\s*audioOutput,\s*process\.platform,\s*installationMode,\s*\);\s+const restore = await playerSession\.restore\(\)/,
  );
  assert.match(
    backend,
    /player\.setBeforePlaybackHook\(\(\) => audioOutput\.prepareForPlayback\(\)\)/,
  );
  const bootstrap = await readFile(
    "apps/backend/src/audio-output/audio-output-bootstrap.ts",
    "utf8",
  );
  assert.match(
    bootstrap,
    /await service\.initialize\(\);\s+const status = await service\.waitForInitialEnumeration\(\s*shouldWaitForInitialAudioEnumeration\(platform, installationMode\),\s*\);\s+await service\.applyInitialPreference\(\)/,
  );
  assert.match(
    bootstrap,
    /platform === "linux" && installationMode === "appliance"/,
  );
});
