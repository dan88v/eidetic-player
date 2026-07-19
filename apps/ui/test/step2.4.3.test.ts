import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { VisualizerFrame } from "../../../packages/shared/src/visualizer";
import {
  VisualizerFrameBuffer,
  VISUALIZER_SYNC_BUFFER_CAPACITY,
} from "../src/visualizer/visualizer-frame-buffer";

function frame(
  positionSeconds: number,
  sequence = Math.round(positionSeconds * 100),
  trackId = "track-a",
  trackTransitionId = 7,
): VisualizerFrame {
  return {
    trackId,
    trackTransitionId,
    positionSeconds,
    sequence,
    meter: { leftPeak: 0, leftRms: 0, rightPeak: 0, rightRms: 0 },
    monoBands: [],
    leftBands: [],
    rightBands: [],
    source: "live",
  };
}

void test("Settings suspends the one inactivity timer and restarts it on exit", async () => {
  const [shell, routes] = await Promise.all([
    readFile("apps/ui/src/components/app-shell.ts", "utf8"),
    readFile("apps/ui/src/navigation/routes.ts", "utf8"),
  ]);
  assert.match(shell, /isSettingsRoute\(activeScreen\)/);
  assert.match(shell, /clearTimeout\(inactivityTimer\)/);
  assert.match(
    shell,
    /state\.activeScreen !== previousState\.activeScreen[\s\S]*scheduleInactivity\(\)/,
  );
  assert.match(routes, /screenGroup: "settings"/);
});

void test("Settings choices persist before returning and booleans are segmented", async () => {
  const [settings, css, tokens] = await Promise.all([
    readFile("apps/ui/src/screens/settings.ts", "utf8"),
    readFile("apps/ui/src/styles/screens.css", "utf8"),
    readFile("apps/ui/src/styles/tokens.css", "utf8"),
  ]);
  assert.match(
    settings,
    /if \(!commit\(\)\) return;[\s\S]*render\(\);[\s\S]*page = "interface";/,
  );
  assert.match(settings, /createSegmentedControl<"on" \| "off">/);
  assert.doesNotMatch(
    settings,
    /role", "switch"|HTMLSelectElement|textContent = "›"/,
  );
  assert.match(settings, /icon\("chevronRight"\)/);
  assert.match(settings, /settings-row-base/);
  assert.match(css, /\.settings-row-base\s*{/);
  assert.match(tokens, /--settings-row-title-size: 1\.375rem/);
  assert.match(tokens, /--settings-row-min-height: 4\.5rem/);
  assert.match(tokens, /--settings-chevron-size: 1\.875rem/);
});

void test("splash and empty playback copy retain the corrective contract", async () => {
  const files = await Promise.all([
    readFile("apps/ui/index.html", "utf8"),
    readFile("apps/ui/src/main.ts", "utf8"),
    readFile("apps/ui/src/i18n/en.ts", "utf8"),
    readFile("apps/ui/src/screens/now-playing.ts", "utf8"),
    readFile("apps/ui/src/components/mini-player.ts", "utf8"),
  ]);
  const source = files.join("\n");
  const removedEmptyCopy = ["Choose a local audio", " file to begin"].join("");
  assert.match(files[0], /white-space: nowrap/);
  assert.match(files[0], /var\(--color-accent\)/);
  assert.match(files[1], /prefers-reduced-motion: reduce/);
  assert.equal(source.includes(removedEmptyCopy), false);
});

void test("queue selection always autoplays and preserves staged identities", async () => {
  const player = await readFile(
    "apps/backend/src/player/player-service.ts",
    "utf8",
  );
  assert.match(
    player,
    /async playQueueIndex[\s\S]*loadResolvedQueue\(staged, index,[\s\S]*autoplay: true,[\s\S]*origins:[\s\S]*itemIds:/,
  );
  assert.match(
    player,
    /setProperty\("playlist-pos", index\)[\s\S]*setProperty\("pause", false\)/,
  );
});

void test("visualizer buffer waits for future audio and remains bounded", () => {
  const buffer = new VisualizerFrameBuffer();
  buffer.push(frame(1));
  buffer.push(frame(1.2));
  assert.equal(buffer.takeForPosition("track-a", 7, 1.04)?.positionSeconds, 1);
  assert.equal(buffer.takeForPosition("track-a", 7, 1.1), null);
  assert.equal(buffer.takeForPosition("track-a", 7, 1.2)?.positionSeconds, 1.2);

  for (let index = 0; index < VISUALIZER_SYNC_BUFFER_CAPACITY + 9; index += 1)
    buffer.push(frame(index, index));
  assert.equal(buffer.size, VISUALIZER_SYNC_BUFFER_CAPACITY);
});

void test("visualizer discards stale track generations without extra streams", async () => {
  const [client, component] = await Promise.all([
    readFile("apps/ui/src/visualizer/visualizer-stream-client.ts", "utf8"),
    readFile("apps/ui/src/components/visualizer.ts", "utf8"),
  ]);
  assert.match(client, /private source: EventSource \| null = null/);
  assert.match(client, /private readonly buffer = new VisualizerFrameBuffer/);
  assert.match(component, /VISUALIZER_SEEK_DISCONTINUITY_SECONDS/);
  assert.match(
    component,
    /setPlaybackState\(positionSeconds, paused, audioBufferSeconds = 0\)/,
  );
  assert.match(
    component,
    /positionSeconds - Math\.max\(0, audioBufferSeconds\)/,
  );
});

void test("queue confirmations use the single deduplicated toast", async () => {
  const [folders, shell] = await Promise.all([
    readFile("apps/ui/src/screens/folders.ts", "utf8"),
    readFile("apps/ui/src/components/app-shell.ts", "utf8"),
  ]);
  assert.match(folders, /options\.showToast\(/);
  assert.doesNotMatch(
    folders,
    /status\.textContent = t\("folders\.trackAdded"\)/,
  );
  assert.match(shell, /lastToastMessage/);
  assert.equal(
    (shell.match(/toast\.className = "app-toast"/g) ?? []).length,
    1,
  );
});

void test("artwork decode failures remain retryable and sorting has one border", async () => {
  const [artwork, metadata, browser, css] = await Promise.all([
    readFile("apps/ui/src/components/artwork.ts", "utf8"),
    readFile("apps/backend/src/metadata/metadata-service.ts", "utf8"),
    readFile(
      "apps/backend/src/filesystem/directory-browser-service.ts",
      "utf8",
    ),
    readFile("apps/ui/src/styles/screens.css", "utf8"),
  ]);
  const implementation = `${artwork}\n${metadata}\n${browser}`;
  assert.doesNotMatch(implementation, /Taylor Swift|Midnights/);
  assert.match(
    artwork,
    /\.prepare\(artwork\)[\s\S]*\.catch\(\(\) => \{[\s\S]*\.prepare\(artwork\)/,
  );
  assert.doesNotMatch(metadata, /\.catch\([\s\S]*this\.cache\.set/);
  assert.match(browser, /this\.metadata\.invalidate/);
  const triggerRule =
    /\.folders-sort-trigger\s*{(?<rule>[\s\S]*?)}/.exec(css)?.groups?.rule ??
    "";
  assert.match(triggerRule, /border: 0;/);
  assert.match(triggerRule, /background: transparent;/);
  assert.match(triggerRule, /box-shadow: none;/);
  assert.match(css, /\.folders-sort-trigger:focus-visible[\s\S]*?inset/);
});

void test("rapid Folders row playback is latest-wins and always re-enables controls", async () => {
  const [folders, player, backend] = await Promise.all([
    readFile("apps/ui/src/screens/folders.ts", "utf8"),
    readFile("apps/backend/src/player/player-service.ts", "utf8"),
    readFile("apps/backend/src/index.ts", "utf8"),
  ]);
  assert.match(
    folders,
    /button\.addEventListener\("click", \(\) => \{[\s\S]*?runAudioAction\(/,
  );
  assert.match(folders, /playRequestGeneration !== audioPlayRequestGeneration/);
  assert.match(
    folders,
    /if \(trigger && !destroyed\) trigger\.disabled = false/,
  );
  assert.doesNotMatch(
    folders,
    /button\.disabled = true;[\s\S]*?options[\s\S]*?\.openEntry\(/,
  );
  assert.match(player, /private openRequestGeneration = 0/);
  assert.match(player, /private openRequestChain: Promise<void>/);
  assert.match(
    player,
    /if \(requestGeneration !== this\.openRequestGeneration\) return/,
  );
  assert.match(
    backend,
    /const openRequestGeneration = player\.reserveOpenRequest\(\);[\s\S]*?queueForEntry/,
  );
});

void test("mounted application feedback uses only the shared toast surface", async () => {
  const [folders, sources, shell, css] = await Promise.all([
    readFile("apps/ui/src/screens/folders.ts", "utf8"),
    readFile("apps/ui/src/screens/sources.ts", "utf8"),
    readFile("apps/ui/src/components/app-shell.ts", "utf8"),
    readFile("apps/ui/src/styles/screens.css", "utf8"),
  ]);
  assert.doesNotMatch(folders, /folders-status|status\.textContent/);
  assert.doesNotMatch(
    sources,
    /sources-feedback|setFeedback|feedback\.textContent/,
  );
  assert.doesNotMatch(css, /\.folders-status|\.sources-feedback/);
  assert.match(folders, /options\.showToast\(/);
  assert.match(sources, /options\.showToast\(/);
  assert.equal(
    (shell.match(/toast\.className = "app-toast"/g) ?? []).length,
    1,
  );
});

void test("Folders toasts are limited to queue feedback and errors", async () => {
  const folders = await readFile("apps/ui/src/screens/folders.ts", "utf8");
  assert.doesNotMatch(
    folders,
    /showToast\(t\("folders\.(startingFolder|startingTrack|loadingFolder|loadingRoot)"/,
  );
  assert.match(folders, /showToast\(t\("folders\.addingFolder"/);
  assert.match(folders, /showToast\(t\("folders\.addingTrack"/);
  assert.match(folders, /"error"/);
});
