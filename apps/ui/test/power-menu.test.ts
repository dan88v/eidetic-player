import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { finalPowerActionFixtures } from "../../../packages/shared/src/system.js";

const read = (path: string) => readFileSync(path, "utf8");
const menu = read("apps/ui/src/components/power-menu.ts");
const drawer = read("apps/ui/src/components/side-menu.ts");
const shell = read("apps/ui/src/components/app-shell.ts");
const styles = read("apps/ui/src/styles/components.css");

void test("drawer footer preserves MODERN HI-FI and adds one accessible power icon", () => {
  assert.match(drawer, /side-menu__footer/);
  assert.match(drawer, /t\("app\.theme"\)/);
  assert.match(drawer, /aria-label="Power" title="Power"/);
  assert.equal((drawer.match(/side-menu__power/g) ?? []).length, 2);
  assert.match(
    styles,
    /\.side-menu__footer[\s\S]*justify-content: space-between/u,
  );
  assert.match(styles, /\.side-menu__power[\s\S]*touch-action: manipulation/u);
});

void test("Power renders exclusively from authoritative capabilities", () => {
  assert.match(shell, /actions: systemCapabilities\.availablePowerActions/u);
  assert.match(
    shell,
    /showPower: systemCapabilities\.availablePowerActions\.length > 0/u,
  );
  assert.doesNotMatch(shell, /installationMode.*power|process\.platform/u);
  assert.deepEqual(finalPowerActionFixtures.development, ["quit"]);
  assert.deepEqual(finalPowerActionFixtures.standard, [
    "quit",
    "reboot",
    "shutdown",
  ]);
  assert.deepEqual(finalPowerActionFixtures.appliance, [
    "restart-app",
    "maintenance",
    "reboot",
    "shutdown",
  ]);
  assert.equal(finalPowerActionFixtures.appliance.includes("quit"), false);
});

void test("all actions have exact labels, descriptions, confirmations and progress", () => {
  for (const text of [
    "Quit Eidetic Player",
    "Close the application.",
    "Restart Eidetic Player",
    "Restart the player application and services.",
    "Maintenance",
    "Close the player and open maintenance tools.",
    "Restart device",
    "Restart the operating system.",
    "Shut down device",
    "Safely power off the device.",
    "Playback will stop and the current session will be saved.",
    "Playback will stop briefly and the current session will be restored.",
    "Playback will stop and the maintenance terminal will open.",
    "Playback will stop and the device will restart.",
    "Playback will stop and the device will power off.",
    "Closing Eidetic Player…",
    "Restarting Eidetic Player…",
    "Entering maintenance mode…",
    "Restarting device…",
    "Shutting down…",
    "Cancel",
  ])
    assert.ok(menu.includes(text), `missing power copy: ${text}`);
  assert.doesNotMatch(menu, /countdown|setTimeout/u);
});

void test("modal is centered, trapped, dismissible before acceptance and blocking after", () => {
  assert.match(styles, /\.power-dialog[\s\S]*width: min\(480px/u);
  assert.match(
    styles,
    /\.power-dialog[\s\S]*transform: translate\(-50%, -50%\)/u,
  );
  assert.match(menu, /aria-modal/);
  assert.match(menu, /aria-labelledby/);
  assert.match(menu, /aria-describedby/);
  assert.match(menu, /event\.key === "Escape" && state !== "progress"/u);
  assert.match(menu, /if \(state === "progress"\) return/u);
  assert.match(menu, /aria-live="assertive"/u);
  assert.match(menu, /trigger\?\.focus\(\)/u);
  assert.match(menu, /document\.activeElement === first/u);
  assert.match(menu, /description\.textContent = message/u);
  assert.doesNotMatch(menu, /\$\{message\}/u);
});
