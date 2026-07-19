import test from "node:test";
import assert from "node:assert/strict";
import {
  AudioAnalysisEngine,
  FFT_SIZE,
  fftMagnitudes,
  hannWindow,
  zeroFrame,
} from "../src/analysis/audio-analysis-engine.js";
import { PcmStreamParser } from "../src/analysis/pcm-stream-parser.js";

void test("PCM parser preserves partial float32 chunks", () => {
  const bytes = Buffer.alloc(12);
  bytes.writeFloatLE(0.25, 0);
  bytes.writeFloatLE(-0.5, 4);
  bytes.writeFloatLE(1, 8);
  const parser = new PcmStreamParser();
  assert.deepEqual([...parser.push(bytes.subarray(0, 7))], [0.25]);
  assert.deepEqual([...parser.push(bytes.subarray(7))], [-0.5, 1]);
});

void test("Hann window reaches zero at both ends", () => {
  const window = hannWindow(FFT_SIZE);
  assert.equal(window[0], 0);
  assert.ok(Math.abs(window[FFT_SIZE - 1] ?? 1) < 1e-6);
  assert.ok((window[FFT_SIZE / 2] ?? 0) > 0.99);
});

void test("radix-2 FFT finds a known tone", () => {
  const bin = 16;
  const samples = Float32Array.from({ length: FFT_SIZE }, (_, index) =>
    Math.sin((2 * Math.PI * bin * index) / FFT_SIZE),
  );
  const magnitudes = fftMagnitudes(samples);
  const peak = [...magnitudes].reduce(
    (best, value, index) => (value > best.value ? { value, index } : best),
    { value: 0, index: -1 },
  );
  assert.equal(peak.index, bin);
});

void test("analysis produces finite meter and 32/16+16 spectrum bands", () => {
  const engine = new AudioAnalysisEngine();
  const samples = new Float32Array(FFT_SIZE * 2);
  for (let index = 0; index < FFT_SIZE; index += 1) {
    samples[index * 2] = Math.sin((2 * Math.PI * 12 * index) / FFT_SIZE) * 0.8;
    samples[index * 2 + 1] =
      Math.sin((2 * Math.PI * 80 * index) / FFT_SIZE) * 0.3;
  }
  const frame = engine.push(samples, "queue-1", 0, 0)[0];
  assert.ok(frame);
  assert.equal(frame.monoBands.length, 32);
  assert.equal(frame.leftBands.length, 16);
  assert.equal(frame.rightBands.length, 16);
  const values = [
    ...frame.monoBands,
    ...frame.leftBands,
    ...frame.rightBands,
    ...Object.values(frame.meter),
  ];
  assert.ok(
    values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
  );
  assert.ok(frame.meter.leftPeak > frame.meter.rightPeak);
});

void test("analysis timestamps advance by consumed hops across input chunks", () => {
  const engine = new AudioAnalysisEngine();
  const first = engine.push(new Float32Array(FFT_SIZE * 2), "queue-1", 10, 3);
  const second = engine.push(new Float32Array(FFT_SIZE * 2), "queue-1", 10, 3);
  assert.ok(first.length > 0);
  assert.ok(second.length > 0);
  assert.ok(
    (second[0]?.positionSeconds ?? 0) > (first.at(-1)?.positionSeconds ?? 0),
  );
  assert.equal(second[0]?.trackTransitionId, 3);
});

void test("zero frame has exact dimensions and no NaN", () => {
  const frame = zeroFrame(null);
  assert.deepEqual(Object.values(frame.meter), [0, 0, 0, 0]);
  assert.equal(frame.monoBands.length, 32);
  assert.equal(frame.leftBands.length, 16);
  assert.equal(frame.rightBands.length, 16);
});
