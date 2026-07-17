import assert from "node:assert/strict";
import test from "node:test";
import { formatTime } from "../src/components/timeline";
import { getMeterGeometry } from "../src/visualizer/meter-renderer";

void test("timeline formats minute and hour durations without truncation", () => {
  assert.equal(formatTime(3), "0:03");
  assert.equal(formatTime(232), "3:52");
  assert.equal(formatTime(768), "12:48");
  assert.equal(formatTime(3_751), "1:02:31");
});

void test("meter geometry is thin, deterministic, and bottom anchored", () => {
  const size = { width: 640, height: 180, pixelRatio: 2 };
  const first = getMeterGeometry(size);
  const second = getMeterGeometry(size);

  assert.deepEqual(first, second);
  assert.equal(first.barHeight, 16);
  assert.equal(first.rowGap, 10);
  assert.equal(first.graphicBottom, size.height);
  assert.equal(first.startY + first.barHeight * 2 + first.rowGap, size.height);
});
