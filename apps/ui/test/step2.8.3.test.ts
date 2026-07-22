import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(path, "utf8");
const shell = read("apps/ui/src/components/app-shell.ts");
const adapter = read("apps/ui/src/components/eidetic-keyboard-adapter.ts");
const settings = read("apps/ui/src/screens/settings.ts");
const storage = read("apps/ui/src/utils/storage.ts");
const library = read("apps/ui/src/screens/library.ts");
const sources = read("apps/ui/src/screens/sources.ts");
const controller = read(
  "packages/on-screen-keyboard/src/keyboard-controller.ts",
);
const css = read("packages/on-screen-keyboard/src/on-screen-keyboard.css");
const miniPlayer = read("apps/ui/src/components/mini-player.ts");
const defaultPlayer = read("apps/ui/src/screens/now-playing.ts");
const cassette = read("apps/ui/src/cassette/cassette-main-player.ts");

void test("Settings persists immediate Auto or Off with Auto as default", () => {
  assert.match(settings, /settings\.onScreenKeyboard/);
  assert.match(settings, /value: "auto"/);
  assert.match(settings, /value: "off"/);
  assert.match(storage, /=== "off" \? "off" : "auto"/);
  assert.match(shell, /saveOnScreenKeyboardMode/);
  assert.match(shell, /keyboardAdapter\.setEnabled/);
});

void test("Eidetic mounts one themed adapter and tears every listener down", () => {
  assert.equal(
    (shell.match(/createEideticKeyboardAdapter\(/g) ?? []).length,
    1,
  );
  assert.match(shell, /keyboardAdapter\.hide\(\);\s+currentScreen\?\.destroy/);
  assert.match(shell, /keyboardAdapter\.destroy\(\)/);
  assert.match(adapter, /preferNativeKeyboard: false/);
  assert.match(
    adapter,
    /document\.addEventListener\("pointerdown", register, true\)/,
  );
  assert.match(
    adapter,
    /document\.removeEventListener\("pointerdown", register, true\)/,
  );
  assert.match(adapter, /--osk-z-index/);
});

void test("Library Search and safe rename are explicit opt-in fields", () => {
  assert.match(library, /data-onscreen-keyboard="text"/);
  assert.match(library, /data-onscreen-keyboard-enter="search"/);
  assert.match(sources, /data-onscreen-keyboard="text"/);
  assert.equal((library.match(/data-onscreen-keyboard=/g) ?? []).length, 1);
  assert.equal((sources.match(/data-onscreen-keyboard=/g) ?? []).length, 1);
  assert.match(controller, /profile\.enterAction !== "search"/);
  assert.match(controller, /new KeyboardEvent\("keydown"/);
  assert.equal(
    (library.match(/SEARCH_DEBOUNCE_MILLISECONDS = 250/g) ?? []).length,
    1,
  );
});

void test("touch opens, mouse and physical focus do not, and Escape closes", () => {
  assert.match(controller, /const openAutomatically = shouldOpenAutomatically/);
  assert.match(controller, /event\.pointerType/);
  assert.match(adapter, /event\.pointerType === "touch"/);
  assert.match(adapter, /keyboard\.showFor\(input\)/);
  assert.match(controller, /event\.key !== "Escape"/);
  assert.match(controller, /api\.hide\(\)/);
});

void test("bottom sheet keeps the real input authoritative above the mini-player", () => {
  assert.doesNotMatch(controller, /on-screen-keyboard__preview/);
  assert.doesNotMatch(controller, /contenteditable|createElement\("input"\)/);
  assert.match(css, /position: fixed[\s\S]*bottom: 0/);
  assert.match(css, /z-index: var\(--osk-z-index, 80\)/);
  assert.match(shell, /root\.dataset\.keyboardOpen/);
});

void test("player surfaces remain outside keyboard integration", () => {
  for (const source of [miniPlayer, defaultPlayer, cassette]) {
    assert.doesNotMatch(source, /on-screen-keyboard|EideticKeyboard/);
  }
});
