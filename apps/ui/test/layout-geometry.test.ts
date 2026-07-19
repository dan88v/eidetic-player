import assert from "node:assert/strict";
import test from "node:test";
import { formatTime } from "../src/components/timeline";
import { renderWaveform } from "../src/timeline/timeline-renderer";
import {
  getMeterGeometry,
  linearPeakToMeterPosition,
  meterPositionForDb,
} from "../src/visualizer/meter-renderer";
import { renderStereoSpectrum } from "../src/visualizer/spectrum-renderer";

void test("timeline formats minute and hour durations without truncation", () => {
  assert.equal(formatTime(3), "0:03");
  assert.equal(formatTime(232), "3:52");
  assert.equal(formatTime(768), "12:48");
  assert.equal(formatTime(3_751), "1:02:31");
});

void test("meter geometry fills the visualizer and remains bottom anchored", () => {
  const size = { width: 640, height: 180, pixelRatio: 2 };
  const first = getMeterGeometry(size);
  const second = getMeterGeometry(size);

  assert.deepEqual(first, second);
  assert.equal(first.barHeight, 56);
  assert.equal(first.rowGap, 20);
  assert.ok(first.startY < size.height * 0.3);
  assert.equal(first.graphicBottom, size.height);
  assert.equal(first.startY + first.barHeight * 2 + first.rowGap, size.height);
});

void test("meter maps linear peaks onto a logarithmic decibel scale", () => {
  assert.equal(linearPeakToMeterPosition(0), 0);
  assert.equal(linearPeakToMeterPosition(1), 1);
  assert.ok(Math.abs(linearPeakToMeterPosition(0.1) - 2 / 3) < 0.000_001);
  assert.ok(Math.abs(linearPeakToMeterPosition(0.01) - 1 / 3) < 0.000_001);
  assert.equal(meterPositionForDb(-60), 0);
  assert.equal(meterPositionForDb(0), 1);
  assert.ok(linearPeakToMeterPosition(0.1) > 0.1);
});

void test("waveform without a track renders a quiet empty rail", () => {
  const rectangles: { readonly height: number; readonly fill: string }[] = [];
  let playheads = 0;
  let fillStyle = "";
  const context = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = typeof value === "string" ? value : "non-string-fill";
    },
    fillRect(_x: number, _y: number, _width: number, height: number) {
      rectangles.push({ height, fill: fillStyle });
    },
    beginPath() {
      playheads += 1;
    },
    arc() {
      return undefined;
    },
    fill() {
      return undefined;
    },
    stroke() {
      return undefined;
    },
  } as unknown as CanvasRenderingContext2D;
  const bars = renderWaveform(
    context,
    { width: 640, height: 48, pixelRatio: 1 },
    0,
  );
  assert.equal(rectangles.length, bars);
  assert.ok(rectangles.every((rectangle) => rectangle.height === 3));
  assert.ok(rectangles.every((rectangle) => rectangle.fill === "#242b38"));
  assert.equal(playheads, 0);
});

void test("stereo spectrum positions and colors mirror exactly around center", () => {
  const rectangles: {
    readonly x: number;
    readonly width: number;
    readonly fill: string;
  }[] = [];
  let fillStyle = "";
  const context = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = typeof value === "string" ? value : "non-string-fill";
    },
    fillRect(x: number, _y: number, width: number) {
      rectangles.push({ x, width, fill: fillStyle });
    },
  } as unknown as CanvasRenderingContext2D;
  const left = Float32Array.from({ length: 16 }, (_, index) => index / 16);
  const right = Float32Array.from(
    { length: 16 },
    (_, index) => (16 - index) / 16,
  );
  const canvasWidth = 640;
  renderStereoSpectrum(
    context,
    { width: canvasWidth, height: 180, pixelRatio: 1 },
    left,
    right,
  );
  assert.equal(rectangles.length, 32);
  for (let band = 0; band < 16; band += 1) {
    const leftBar = rectangles[band * 2];
    const rightBar = rectangles[band * 2 + 1];
    assert.ok(leftBar);
    assert.ok(rightBar);
    assert.ok(
      Math.abs(leftBar.x + rightBar.x + leftBar.width - canvasWidth) <
        0.000_001,
    );
    assert.equal(leftBar.width, rightBar.width);
    assert.equal(leftBar.fill, rightBar.fill);
  }
  assert.ok((rectangles[0]?.x ?? 0) > (rectangles[30]?.x ?? 0));
});
