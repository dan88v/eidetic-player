import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

void test("bootstrap splash is tied to the backend barrier and reduced motion", async () => {
  const [html, main, api] = await Promise.all([
    readFile("apps/ui/index.html", "utf8"),
    readFile("apps/ui/src/main.ts", "utf8"),
    readFile("apps/ui/src/api/player-api-client.ts", "utf8"),
  ]);
  assert.match(html, /id="app-splash"/);
  assert.match(html, /id="app-splash__title">Eidetic Player/);
  assert.match(html, /id="app-splash__progress"/);
  assert.match(html, /@keyframes app-splash-progress/);
  assert.doesNotMatch(html, /app-splash__mark|content: "E"/);
  assert.match(main, /700 - \(performance\.now\(\) - startedAt\)/);
  assert.match(main, /5_000/);
  assert.match(main, /prefers-reduced-motion: reduce/);
  assert.match(api, /\/api\/bootstrap/);
});

void test("Interface settings use selection screens for multi-choice values", async () => {
  const settings = await readFile("apps/ui/src/screens/settings.ts", "utf8");
  assert.match(settings, /"root" \| "interface" \| "browsing"/);
  assert.match(settings, /page = "visualizer"/);
  assert.match(settings, /page = "inactivity"/);
  assert.match(settings, /createSegmentedControl<TimelineStyle>/);
  assert.doesNotMatch(
    settings,
    /createSegmentedControl<(MusicBrowsingVisibility|VisualizerMode)>/,
  );
});

void test("music browsing visibility and inactivity are persistent global preferences", async () => {
  const [shell, storage] = await Promise.all([
    readFile("apps/ui/src/components/app-shell.ts", "utf8"),
    readFile("apps/ui/src/utils/storage.ts", "utf8"),
  ]);
  assert.match(shell, /setMusicBrowsingVisibility/);
  assert.match(shell, /scheduleInactivity/);
  assert.match(shell, /nativeDialogOpen/);
  assert.match(shell, /data-settings-subscreen/);
  assert.match(storage, /eidetic-player\.interface\.music-browsing/);
  assert.match(storage, /eidetic-player\.interface\.return-to-now-playing/);
});

void test("visualizer remount state is bounded outside the component", async () => {
  const [component, snapshots] = await Promise.all([
    readFile("apps/ui/src/components/visualizer.ts", "utf8"),
    readFile("apps/ui/src/visualizer/visualizer-snapshot-store.ts", "utf8"),
  ]);
  assert.match(component, /readVisualizerSnapshot/);
  assert.match(component, /saveVisualizerSnapshot/);
  assert.match(snapshots, /while \(snapshots\.size > 8\)/);
  assert.match(snapshots, /trackTransitionId/);
});
