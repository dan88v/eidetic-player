import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

void test("Playback is ordered between Audio and Network without moving Remote access", async () => {
  const settings = await readFile("apps/ui/src/screens/settings.ts", "utf8");
  assert.match(
    settings,
    /panel\.append\(\s*interfaceButton,\s*audioButton,\s*playbackButton,\s*networkButton,\s*remoteAccessButton,\s*\)/u,
  );
  assert.match(settings, /panel\.append\(systemButton\);/u);
  assert.match(
    settings,
    /playbackButton\.innerHTML = `<span><strong>Playback<\/strong><small>Queue and playback continuation\.<\/small><\/span>/u,
  );
  assert.match(settings, /page = "playback";/u);
});

void test("Playback uses the canonical navigation and described selection pages", async () => {
  const settings = await readFile("apps/ui/src/screens/settings.ts", "utf8");
  assert.match(settings, /if \(page === "playback"\)/u);
  assert.match(
    settings,
    /<strong>Continue playback<\/strong><small>\$\{continuePlayback === "off" \? "Off" : "Same artist"\}<\/small>/u,
  );
  assert.match(settings, /page = "playback-continue";/u);
  assert.match(settings, /title: "Continue playback"/u);
  assert.match(settings, /"Stop when the current context and queue end\."/u);
  assert.match(
    settings,
    /"Continue with random tracks by the same artist after the current context and queue end\."/u,
  );
  assert.match(
    settings,
    /if \(!options\.onContinuePlaybackModeChange\(value\)\) return false;\s*continuePlayback = value;\s*return true;/u,
  );
  assert.match(settings, /"playback",\s*description,/u);
  assert.match(settings, /check\.textContent = selected \? "✓" : "";/u);
  assert.match(
    settings,
    /button\.setAttribute\("aria-pressed", String\(selected\)\);/u,
  );
  assert.match(settings, /button\.type = "button";/u);
  assert.match(
    settings,
    /back\.setAttribute\("aria-label", t\("common\.back"\)\);/u,
  );
  assert.doesNotMatch(settings, /segmentedSettingRow[^;]*Continue playback/su);
});

void test("Playback preference is wired from bootstrap state through the existing controller", async () => {
  const [preferences, screens, shell, storage, backend] = await Promise.all([
    readFile("packages/shared/src/preferences.ts", "utf8"),
    readFile("apps/ui/src/screens/index.ts", "utf8"),
    readFile("apps/ui/src/components/app-shell.ts", "utf8"),
    readFile("apps/ui/src/utils/storage.ts", "utf8"),
    readFile("apps/backend/src/index.ts", "utf8"),
  ]);
  assert.match(
    preferences,
    /export type ContinuePlaybackMode = "off" \| "same-artist";/u,
  );
  assert.match(preferences, /continuePlaybackMode: "off"/u);
  assert.match(screens, /continuePlaybackMode: context\.continuePlaybackMode/u);
  assert.match(
    screens,
    /onContinuePlaybackModeChange: context\.setContinuePlaybackMode/u,
  );
  assert.match(
    shell,
    /preferencesController\?\.getPreferences\(\)\.continuePlaybackMode \?\? "off"/u,
  );
  assert.match(shell, /saveContinuePlaybackMode\(value\)/u);
  assert.match(storage, /return save\(\{ continuePlaybackMode: value \}\);/u);
  const legacyKeys = storage.slice(
    storage.indexOf("export const legacyPreferenceStorageKeys"),
    storage.indexOf("} as const;") + "} as const;".length,
  );
  assert.doesNotMatch(legacyKeys, /continuePlaybackMode/u);
  const recoveryBootstrap = backend.slice(
    backend.indexOf("const playerRecovery"),
    backend.indexOf("const coreBootstrapPromise"),
  );
  assert.match(
    recoveryBootstrap,
    /lastRestoreResult = await playerSession\.restore\(\);\s*await player\.setContinuePlaybackMode\(\s*preferences\.snapshot\(\)\.preferences\.continuePlaybackMode,\s*\);/u,
  );
  const normalBootstrap = backend.slice(
    backend.indexOf("const bootstrapPromise"),
    backend.indexOf("function sendJson"),
  );
  assert.match(
    normalBootstrap,
    /const restore = await playerSession\.restore\(\);\s*lastRestoreResult = restore;\s*await player\.setContinuePlaybackMode\(\s*preferences\.snapshot\(\)\.preferences\.continuePlaybackMode,\s*\);/u,
  );
});
