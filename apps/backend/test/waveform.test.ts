import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAndResample } from "../src/analysis/waveform-service.js";

void test("waveform silence returns exactly 512 finite zero buckets", () => {
  const points = normalizeAndResample(Array(1_000).fill(0) as number[], 512);
  assert.equal(points.length, 512);
  assert.ok(points.every((point) => point === 0));
});

void test("waveform robust normalization retains shape around an impulse", () => {
  const input = Array(2_048).fill(0.1) as number[];
  input[1_000] = 1;
  const points = normalizeAndResample(input, 512);
  assert.equal(points.length, 512);
  assert.ok(
    points.every((point) => Number.isFinite(point) && point >= 0 && point <= 1),
  );
  assert.ok(points.some((point) => point > 0.9));
  assert.ok(points.filter((point) => point > 0.2).length > 400);
});

void test("waveform handles a long simulated stream deterministically", () => {
  const input = Array.from({ length: 100_000 }, (_, index) =>
    Math.abs(Math.sin(index * 0.01)),
  );
  assert.deepEqual(
    normalizeAndResample(input, 512),
    normalizeAndResample(input, 512),
  );
});
