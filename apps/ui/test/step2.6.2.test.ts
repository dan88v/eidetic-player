import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deriveAngularVelocity,
  deriveReelGeometry,
  integrateAngle,
  CASSETTE_CORE_RADIUS,
  CASSETTE_FULL_RADIUS,
  CASSETTE_MAX_ANGULAR_SPEED,
} from "../src/cassette/cassette-physics";
import { deriveCassetteProgress } from "../src/cassette/cassette-progress";

void test("queue tape progress is exact when every duration is known", () => {
  const result = deriveCassetteProgress({
    queue: [
      { id: "one", durationSeconds: 100 },
      { id: "two", durationSeconds: 200 },
      { id: "three", durationSeconds: 300 },
    ],
    currentQueueIndex: 1,
    positionSeconds: 50,
    currentDurationSeconds: 200,
  });
  assert.equal(result.confidence, "exact");
  assert.equal(result.value, 0.25);
});

void test("queue tape progress estimates queues with no known duration by index", () => {
  const result = deriveCassetteProgress({
    queue: [{ id: "one" }, { id: "two" }, { id: "three" }],
    currentQueueIndex: 1,
    positionSeconds: 50,
    currentDurationSeconds: 100,
  });
  assert.equal(result.confidence, "estimated");
  assert.equal(result.value, 0.5);
});

void test("partial duration estimates use the median and remain bounded", () => {
  const result = deriveCassetteProgress({
    queue: [
      { id: "one", durationSeconds: 100 },
      { id: "two" },
      { id: "three", durationSeconds: 300 },
    ],
    currentQueueIndex: 2,
    positionSeconds: Number.POSITIVE_INFINITY,
    currentDurationSeconds: 300,
  });
  assert.equal(result.confidence, "estimated");
  assert.ok(Number.isFinite(result.value));
  assert.ok(result.value >= 0 && result.value <= 1);
});

void test("seek preview affects tape mass without changing queue data", () => {
  const queue = [{ id: "one", durationSeconds: 100 }] as const;
  const regular = deriveCassetteProgress({
    queue,
    currentQueueIndex: 0,
    positionSeconds: 10,
    currentDurationSeconds: 100,
  });
  const preview = deriveCassetteProgress({
    queue,
    currentQueueIndex: 0,
    positionSeconds: 10,
    currentDurationSeconds: 100,
    previewPositionSeconds: 80,
  });
  assert.equal(regular.value, 0.1);
  assert.equal(preview.value, 0.8);
  assert.equal(queue[0].durationSeconds, 100);
});

void test("reel radii preserve tape area at start, middle and end", () => {
  const tapeArea = CASSETTE_FULL_RADIUS ** 2 - CASSETTE_CORE_RADIUS ** 2;
  for (const progress of [0, 0.5, 1]) {
    const geometry = deriveReelGeometry(progress);
    const area =
      geometry.sourceRadius ** 2 -
      CASSETTE_CORE_RADIUS ** 2 +
      geometry.destinationRadius ** 2 -
      CASSETTE_CORE_RADIUS ** 2;
    assert.ok(Math.abs(area - tapeArea) < 0.000_001);
  }
  assert.equal(deriveReelGeometry(0).sourceRadius, CASSETTE_FULL_RADIUS);
  assert.equal(deriveReelGeometry(1).destinationRadius, CASSETTE_FULL_RADIUS);
});

void test("angular velocity is radius-derived, capped and angle integration bounded", () => {
  const velocity = deriveAngularVelocity(10_000, deriveReelGeometry(0.5));
  assert.equal(velocity.source, CASSETTE_MAX_ANGULAR_SPEED);
  assert.equal(velocity.destination, CASSETTE_MAX_ANGULAR_SPEED);
  const angle = integrateAngle(Math.PI * 2 - 0.01, 5, 20);
  assert.ok(angle >= 0 && angle < Math.PI * 2);
});

void test("Cassette integration is scoped and excludes Default visualizer creation", async () => {
  const [host, cassette, animation, css, shell, miniPlayer, settings, storage] =
    await Promise.all([
      readFile(
        new URL("../src/main-player/main-player-host.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/cassette/cassette-main-player.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/cassette/cassette-animation-controller.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../src/styles/cassette-player.css", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/components/app-shell.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/components/mini-player.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/screens/settings.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/utils/storage.ts", import.meta.url), "utf8"),
    ]);
  assert.match(host, /mode === "default"/);
  assert.match(host, /createNowPlayingScreen/);
  assert.match(host, /createCassetteMainPlayer/);
  assert.doesNotMatch(
    cassette,
    /createVisualizer|VisualizerStream|EventSource/,
  );
  assert.match(cassette, /cassette-scene__mechanism/);
  assert.match(cassette, /cassette-scene__loop--upper/);
  assert.match(cassette, /cassette-scene__loop--lower/);
  assert.match(cassette, /cassette-scene__tape-mass--source/);
  assert.match(css, /\.cassette-player \.cassette-scene/);
  assert.doesNotMatch(css, /^\s*(svg|circle|path|rect|text)\s*\{/m);
  assert.match(shell, /state\.mainPlayerMode === "cassette"/);
  assert.match(miniPlayer, /onSeekPreview\?\./);
  assert.equal(animation.match(/requestAnimationFrame/g)?.length, 1);
  assert.doesNotMatch(animation, /setInterval/);
  assert.match(animation, /1_000 \/ 30/);
  assert.match(settings, /createSegmentedControl<MainPlayerMode>/);
  assert.match(storage, /interface\.main-player-mode/);
  assert.match(
    storage,
    /=== "cassette"[\s\S]{0,40}\? "cassette"[\s\S]{0,40}: "default"/,
  );
});
