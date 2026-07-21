import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  CASSETTE_CORE_RADIUS,
  CASSETTE_FULL_RADIUS,
  CASSETTE_MAX_ANGULAR_SPEED,
  CASSETTE_REEL_DIRECTION,
  CASSETTE_TAPE_LINEAR_SPEED,
  deriveAngularVelocity,
  deriveReelGeometry,
  integrateAngle,
} from "../src/cassette/cassette-physics";
import { deriveCassetteProgress } from "../src/cassette/cassette-progress";
import {
  CASSETTE_LEFT_REEL,
  CASSETTE_RIGHT_REEL,
} from "../src/cassette/cassette-geometry";
import { advanceCassetteProgress } from "../src/cassette/cassette-animation-controller";

const repositoryRoot = new URL("../../../", import.meta.url);
const temporalQueue = [
  { id: "a", durationSeconds: 60 },
  { id: "b", durationSeconds: 180 },
  { id: "c", durationSeconds: 360 },
] as const;

const progressAt = (
  currentQueueIndex: number,
  positionSeconds: number,
  currentDurationSeconds: number,
) =>
  deriveCassetteProgress({
    queue: temporalQueue,
    currentQueueIndex,
    positionSeconds,
    currentDurationSeconds,
  });

void test("right is source, left is destination and both speeds are counterclockwise", () => {
  assert.equal(CASSETTE_RIGHT_REEL.role, "source");
  assert.equal(CASSETTE_LEFT_REEL.role, "destination");
  assert.equal(CASSETTE_REEL_DIRECTION, -1);

  for (const progress of [0, 0.5, 1]) {
    const velocity = deriveAngularVelocity(
      CASSETTE_TAPE_LINEAR_SPEED,
      deriveReelGeometry(progress),
    );
    assert.ok(velocity.source < 0);
    assert.ok(velocity.destination < 0);
  }

  const nextAngle = integrateAngle(0, -1, 0.1);
  assert.ok(nextAngle > Math.PI);
});

void test("empty reels are faster than full reels at Queue endpoints", () => {
  const startGeometry = deriveReelGeometry(0);
  const middleGeometry = deriveReelGeometry(0.5);
  const endGeometry = deriveReelGeometry(1);
  const start = deriveAngularVelocity(
    CASSETTE_TAPE_LINEAR_SPEED,
    startGeometry,
  );
  const middle = deriveAngularVelocity(
    CASSETTE_TAPE_LINEAR_SPEED,
    middleGeometry,
  );
  const end = deriveAngularVelocity(CASSETTE_TAPE_LINEAR_SPEED, endGeometry);

  assert.deepEqual(startGeometry, {
    sourceRadius: CASSETTE_FULL_RADIUS,
    destinationRadius: CASSETTE_CORE_RADIUS,
  });
  assert.ok(Math.abs(start.destination) > Math.abs(start.source));
  assert.equal(middleGeometry.sourceRadius, middleGeometry.destinationRadius);
  assert.equal(middle.source, middle.destination);
  assert.deepEqual(endGeometry, {
    sourceRadius: CASSETTE_CORE_RADIUS,
    destinationRadius: CASSETTE_FULL_RADIUS,
  });
  assert.ok(Math.abs(end.source) > Math.abs(end.destination));
  assert.ok(Math.abs(start.destination) <= CASSETTE_MAX_ANGULAR_SPEED);
  assert.ok(Math.abs(end.source) <= CASSETTE_MAX_ANGULAR_SPEED);
});

void test("angular speed is linear speed divided by the live radius before clamp", () => {
  const linearSpeed = 100;
  const geometry = deriveReelGeometry(0.25);
  const velocity = deriveAngularVelocity(linearSpeed, geometry);
  assert.equal(Math.abs(velocity.source), linearSpeed / geometry.sourceRadius);
  assert.equal(
    Math.abs(velocity.destination),
    linearSpeed / geometry.destinationRadius,
  );
});

void test("the two tape masses conserve area and move in opposite radius directions", () => {
  const tapeArea = CASSETTE_FULL_RADIUS ** 2 - CASSETTE_CORE_RADIUS ** 2;
  let previousSource = Number.POSITIVE_INFINITY;
  let previousDestination = 0;
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    const geometry = deriveReelGeometry(progress);
    assert.ok(geometry.sourceRadius <= previousSource);
    assert.ok(geometry.destinationRadius >= previousDestination);
    const totalArea =
      geometry.sourceRadius ** 2 -
      CASSETTE_CORE_RADIUS ** 2 +
      geometry.destinationRadius ** 2 -
      CASSETTE_CORE_RADIUS ** 2;
    assert.ok(Math.abs(totalArea - tapeArea) < 0.000_001);
    previousSource = geometry.sourceRadius;
    previousDestination = geometry.destinationRadius;
  }
});

void test("60/180/360 Queue progress follows elapsed time rather than index", () => {
  assert.deepEqual(progressAt(0, 60, 60), {
    value: 0.1,
    confidence: "exact",
  });
  assert.deepEqual(progressAt(1, 0, 180), {
    value: 0.1,
    confidence: "exact",
  });
  assert.deepEqual(progressAt(1, 90, 180), {
    value: 0.25,
    confidence: "exact",
  });
  assert.deepEqual(progressAt(1, 180, 180), {
    value: 0.4,
    confidence: "exact",
  });
  assert.deepEqual(progressAt(2, 0, 360), {
    value: 0.4,
    confidence: "exact",
  });
  assert.deepEqual(progressAt(2, 60, 360), {
    value: 0.5,
    confidence: "exact",
  });
  assert.notEqual(progressAt(1, 0, 180).value, 1 / 3);
});

void test("partial metadata becomes exact without changing temporal semantics", () => {
  const partial = deriveCassetteProgress({
    queue: [
      { id: "a", durationSeconds: 60 },
      { id: "b" },
      { id: "c", durationSeconds: 360 },
    ],
    currentQueueIndex: 1,
    positionSeconds: 90,
    currentDurationSeconds: 180,
  });
  const exact = progressAt(1, 90, 180);
  assert.equal(partial.confidence, "exact");
  assert.equal(partial.value, exact.value);

  const estimated = deriveCassetteProgress({
    queue: [
      { id: "a", durationSeconds: 60 },
      { id: "b", durationSeconds: 180 },
      { id: "c" },
    ],
    currentQueueIndex: 1,
    positionSeconds: 90,
    currentDurationSeconds: 180,
  });
  assert.equal(estimated.confidence, "estimated");
  assert.ok(Number.isFinite(estimated.value));
  assert.notEqual(estimated.value, exact.value);

  const firstFrame = advanceCassetteProgress(estimated.value, exact.value, 0.1);
  assert.ok(firstFrame < estimated.value);
  assert.ok(firstFrame > exact.value);
  let settled = firstFrame;
  for (let index = 0; index < 40; index += 1)
    settled = advanceCassetteProgress(settled, exact.value, 0.1);
  assert.equal(settled, exact.value);
});

void test("append, remove, replace and invalid values recalculate bounded targets", () => {
  const append = deriveCassetteProgress({
    queue: temporalQueue,
    currentQueueIndex: 1,
    positionSeconds: 90,
    currentDurationSeconds: 180,
  });
  const remove = deriveCassetteProgress({
    queue: temporalQueue.slice(1),
    currentQueueIndex: 0,
    positionSeconds: 90,
    currentDurationSeconds: 180,
  });
  const replace = deriveCassetteProgress({
    queue: [
      { id: "x", durationSeconds: 120 },
      { id: "y", durationSeconds: 120 },
    ],
    currentQueueIndex: 0,
    positionSeconds: 60,
    currentDurationSeconds: 120,
  });
  assert.equal(append.value, 0.25);
  assert.equal(remove.value, 1 / 6);
  assert.equal(replace.value, 0.25);

  for (const invalid of [0, Number.NaN]) {
    const result = deriveCassetteProgress({
      queue: [{ id: "invalid", durationSeconds: invalid }],
      currentQueueIndex: Number.NaN,
      positionSeconds: Number.POSITIVE_INFINITY,
      currentDurationSeconds: invalid,
    });
    assert.ok(Number.isFinite(result.value));
    assert.ok(result.value >= 0 && result.value <= 1);
  }
});

void test("renderer reveals two radius-driven masses through static glass", async () => {
  const [layer, controller, premium, cassetteFiles] = await Promise.all([
    readFile(
      new URL("apps/ui/src/cassette/cassette-reel-layer.ts", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL(
        "apps/ui/src/cassette/cassette-animation-controller.ts",
        repositoryRoot,
      ),
      "utf8",
    ),
    readFile(
      new URL("apps/ui/src/cassette/cassette-premium-scene.ts", repositoryRoot),
      "utf8",
    ),
    readdir(new URL("apps/ui/src/cassette/", repositoryRoot)),
  ]);

  assert.equal(layer.match(/tapeMassMarkup\("/g)?.length, 2);
  assert.equal(layer.match(/tapeWindingGradientMarkup\("/g)?.length, 2);
  assert.match(layer, /center-window-glass/);
  assert.match(layer, /clip-path="url\(#cassette-window-/);
  assert.match(layer, /r="2" spreadMethod="repeat"/);
  assert.ok(
    layer.indexOf('class="cassette-player__center-window-layer"') <
      layer.indexOf('tapeMassMarkup("left"'),
  );
  assert.ok(
    layer.indexOf('tapeMassMarkup("right"') <
      layer.indexOf('class="cassette-player__center-window-glass"'),
  );
  assert.doesNotMatch(layer, /center-tape|translate|animate|setInterval/i);
  assert.ok(
    layer.indexOf('tapeMassMarkup("left"') < layer.indexOf('reelMarkup("left"'),
  );
  assert.ok(
    layer.indexOf('tapeMassMarkup("right"') <
      layer.indexOf('reelMarkup("left"'),
  );
  assert.match(layer, /cassette-player__reel-spokes/);
  assert.match(layer, /cassette-player__reel-center/);
  assert.doesNotMatch(layer, /head|capstan|pinch|mechanism/i);
  assert.match(controller, /sourceTape\.r\.baseVal\.value/);
  assert.match(controller, /destinationTape\.r\.baseVal\.value/);
  assert.match(controller, /advanceCassetteProgress/);
  assert.doesNotMatch(controller, /centerTape|center-tape|translateX/);
  assert.equal(controller.match(/requestAnimationFrame/g)?.length, 1);
  assert.doesNotMatch(controller, /EventSource|FFmpeg|setInterval/);
  assert.match(premium, /append\(dynamicLayer\.element, frame\)/);
  assert.equal(
    cassetteFiles.filter((name) => /reel.*\.(?:png|jpe?g|webp)$/i.test(name))
      .length,
    0,
  );
});
