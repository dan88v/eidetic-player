import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string): Promise<string> => readFile(path, "utf8");

void test("System keeps Software update, Display, and Maintenance in order", async () => {
  const settings = await read("apps/ui/src/screens/settings.ts");
  const systemStart = settings.indexOf("const activeJob =");
  const displayStart = settings.indexOf('if (page === "display")', systemStart);
  const system = settings.slice(systemStart, displayStart);
  const update = system.indexOf("Software update");
  const display = system.indexOf('"Display"');
  const maintenance = system.indexOf("Maintenance mode");
  assert.ok(update >= 0);
  assert.ok(display > update);
  assert.ok(maintenance > display);
});

void test("Display reuses canonical selection rows, actions, and confirmation", async () => {
  const settings = await read("apps/ui/src/screens/settings.ts");
  assert.match(settings, /"display-dim-timeout"/u);
  assert.match(settings, /selectionRow\(/u);
  assert.match(settings, /settings-page-actions/u);
  assert.match(settings, /confirmationDialog\.open/u);
  assert.match(settings, /Test display standby\?/u);
  assert.match(settings, /confirmLabel: "Start test"/u);
  assert.match(settings, /Standby must be later than dim\./u);
  assert.match(settings, /Standby suspended by HDMI audio/u);
  assert.match(settings, /Dimming: Software fallback/u);
  assert.match(settings, /Standby: Unavailable/u);
});

void test("wake shield is fixed, non-layout, and above the app keyboard", async () => {
  const css = await read("apps/ui/src/styles/components.css");
  const controller = await read(
    "apps/ui/src/display/display-idle-controller.ts",
  );
  assert.match(css, /\.display-wake-shield[\s\S]*position: fixed/u);
  assert.match(css, /z-index: calc\(var\(--z-keyboard\) \+ 1\)/u);
  assert.match(css, /touch-action: none/u);
  assert.match(controller, /event\.stopImmediatePropagation\(\)/u);
  assert.match(controller, /event\.preventDefault\(\)/u);
  assert.match(controller, /suppressClickUntil/u);
  assert.doesNotMatch(controller, /touchstart/u);
});

void test("display control adds neither polling nor a permanent event stream", async () => {
  const controller = await read(
    "apps/ui/src/display/display-idle-controller.ts",
  );
  const api = await read("apps/ui/src/api/display-api-client.ts");
  assert.doesNotMatch(controller, /setInterval/u);
  assert.doesNotMatch(api, /EventSource/u);
  assert.doesNotMatch(api, /subscribe/u);
});
