import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  IndexedLibrarySnapshot,
  LibraryScanProgress,
} from "../../../packages/shared/src/library.js";
import {
  LibraryToastDismissal,
  resolveLibraryToast,
} from "../src/components/toast-host.js";
import {
  CREST_ATTACK_MS,
  CREST_RELEASE_MS,
  CrestDisplaySmoother,
} from "../src/visualizer/technical-renderer.js";
import { nextVisualizerMode } from "../src/visualizer/visualizer-mode.js";

const read = (path: string): Promise<string> =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

const scan: LibraryScanProgress = {
  scanId: "scan-1",
  sourceId: "source-1",
  sourceName: "Music",
  generation: 3,
  status: "scanning",
  filesDiscovered: 100,
  filesProcessed: 20,
  filesUnchanged: 0,
  filesNew: 20,
  filesModified: 0,
  filesUnavailable: 0,
  filesFailed: 0,
  totalFiles: 100,
  startedAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:01.000Z",
  completedAt: null,
  elapsedMilliseconds: 1_000,
  errorCode: null,
};

function snapshot(
  activeScan: LibraryScanProgress | null,
  latestScan: LibraryScanProgress | null = activeScan,
  queuedSourceIds: readonly string[] = [],
): IndexedLibrarySnapshot {
  return {
    summary: {
      trackCount: 0,
      availableTrackCount: 0,
      unavailableTrackCount: 0,
      albumCount: 0,
      artistCount: 0,
      sourceCount: 1,
      scanStatus: activeScan?.status ?? latestScan?.status ?? "idle",
      lastSuccessfulScan: null,
    },
    sources: [],
    status: {
      activeScan,
      latestScan,
      queuedSourceIds,
      recoveryNotice: null,
    },
  };
}

void test("Crest smoothing attacks quickly and releases over 1.8 seconds", () => {
  assert.equal(CREST_ATTACK_MS, 125);
  assert.equal(CREST_RELEASE_MS, 1_800);
  const attack = new CrestDisplaySmoother();
  assert.equal(attack.update(6, 0), 6);
  const attacked = attack.update(18, CREST_ATTACK_MS) ?? 0;
  assert.ok(attacked > 13 && attacked < 14);

  const release = new CrestDisplaySmoother();
  release.update(18, 0);
  let released = 18;
  for (let timestamp = 100; timestamp <= CREST_RELEASE_MS; timestamp += 100)
    released = release.update(6, timestamp) ?? 0;
  const expected = 18 + (6 - 18) * (1 - Math.exp(-1));
  assert.ok(Math.abs(released - expected) < 0.000_001);
  assert.ok(released > 10 && released < 11);
});

void test("Crest smoothing is frame-rate independent", () => {
  const fine = new CrestDisplaySmoother();
  const coarse = new CrestDisplaySmoother();
  fine.update(4, 0);
  coarse.update(4, 0);
  for (let timestamp = 20; timestamp <= 200; timestamp += 20)
    fine.update(16, timestamp);
  for (let timestamp = 50; timestamp <= 200; timestamp += 50)
    coarse.update(16, timestamp);
  assert.ok(
    Math.abs((fine.update(16, 200) ?? 0) - (coarse.update(16, 200) ?? 0)) <
      0.000_001,
  );
});

void test("Crest smoothing rejects invalid samples and bounds long gaps", () => {
  const smoother = new CrestDisplaySmoother();
  assert.equal(smoother.update(Number.NaN, 0), null);
  assert.equal(smoother.update(Number.POSITIVE_INFINITY, 10), null);
  assert.equal(smoother.update(10, 20), 10);
  assert.equal(smoother.update(null, 30), 10);
  assert.equal(smoother.update(20, 40, true), 10);
  const afterLongGap = smoother.update(0, 20_040) ?? 0;
  assert.ok(afterLongGap > 8.5);
  smoother.reset();
  assert.equal(smoother.update(7, 21_000), 7);
});

void test("Technical grows only Crest and LUFS-S values", async () => {
  const [renderer, visualizer] = await Promise.all([
    read("visualizer/technical-renderer.ts"),
    read("components/visualizer.ts"),
  ]);
  assert.match(renderer, /compact \? 48 : 56/);
  assert.match(renderer, /compact \? 50 : 58/);
  assert.match(renderer, /ui-monospace/);
  assert.match(renderer, /fillText\("CREST \(dB\)"/);
  assert.match(renderer, /fillText\("LUFS-S \(dB\)"/);
  assert.doesNotMatch(renderer, /fillText\("dB"/);
  assert.doesNotMatch(renderer, /fillText\("LUFS"/);
  assert.match(renderer, /Math\.max\([\s\S]*Math\.min/);
  assert.match(visualizer, /shortTermLufs = frame\.shortTermLufs/);
  assert.doesNotMatch(visualizer, /crestSmoother\.update\([^)]*shortTermLufs/);
  assert.deepEqual(
    [
      nextVisualizerMode("spectrumMono"),
      nextVisualizerMode("spectrumStereo"),
      nextVisualizerMode("meter"),
      nextVisualizerMode("technical"),
      nextVisualizerMode("none"),
    ],
    ["spectrumStereo", "meter", "technical", "none", "spectrumMono"],
  );
});

void test("dismissed Library run stays hidden through terminal state", () => {
  const dismissal = new LibraryToastDismissal();
  const active = snapshot(scan);
  assert.equal(dismissal.suppresses(active), false);
  dismissal.dismiss(active, "scan-1:source-1:3");
  assert.equal(dismissal.suppresses(active), true);
  const completed = {
    ...scan,
    status: "completed" as const,
    completedAt: "2026-07-22T10:00:05.000Z",
  };
  assert.equal(dismissal.suppresses(snapshot(null, completed)), true);
  assert.deepEqual(
    resolveLibraryToast(snapshot(null, completed), "scan-1:source-1:3", true),
    { kind: "terminal", scan: completed },
  );
});

void test("a new Library scan run is visible after dismiss", () => {
  const dismissal = new LibraryToastDismissal();
  dismissal.dismiss(snapshot(scan), "scan-1:source-1:3");
  const next = { ...scan, scanId: "scan-2", generation: 4 };
  assert.equal(dismissal.suppresses(snapshot(next)), false);
});

void test("toast host has one accessible dismiss per toast and clears timers", async () => {
  const [toast, css, shell] = await Promise.all([
    read("components/toast-host.ts"),
    read("styles/components.css"),
    read("components/app-shell.ts"),
  ]);
  assert.match(toast, /button\.type = "button"/);
  assert.match(toast, /t\("toast\.dismiss"\)/);
  assert.match(
    toast,
    /transientToast\.append\([\s\S]*createDismissButton\(hideTransient\)/,
  );
  assert.match(
    toast,
    /progressToast\.append\(createDismissButton\(dismissProgress\)\)/,
  );
  assert.match(toast, /clearTimeout\(transientTimer\)/);
  assert.match(toast, /clearTimeout\(terminalTimer\)/);
  assert.match(toast, /clearTimeout\(coalesceTimer\)/);
  assert.doesNotMatch(toast, /data-toast-action|Manage|Cancel|Retry/);
  assert.match(
    css,
    /\.app-toast__dismiss[\s\S]*width: 2\.5rem[\s\S]*height: 2\.5rem/,
  );
  assert.match(css, /\.app-toast__dismiss:focus-visible/);
  assert.equal((shell.match(/createToastHost\(/g) ?? []).length, 1);
  assert.equal((shell.match(/libraryApi\.subscribe\(/g) ?? []).length, 1);
});

void test("Queue Clear is the centered destructive footer after all rows", async () => {
  const [queue, css] = await Promise.all([
    read("components/queue-drawer.ts"),
    read("styles/components.css"),
  ]);
  assert.ok(
    queue.indexOf('<ol class="queue-list">') <
      queue.indexOf('class="queue-list__clear"'),
  );
  assert.doesNotMatch(queue, /class="queue-actions"/);
  assert.match(queue, /list\.insertBefore\(view\.row, clearRow\)/);
  assert.match(queue, /clearRow\.hidden = state\.queue\.length === 0/);
  assert.match(css, /\.queue-list__clear[\s\S]*justify-content: center/);
  assert.match(
    css,
    /\.queue-list__clear-button[\s\S]*background: var\(--color-danger, #c43d3d\)/,
  );
});
