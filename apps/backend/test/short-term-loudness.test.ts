import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ShortTermLoudnessMeter } from "../src/analysis/short-term-loudness-meter.js";

function tone(
  sampleRate: number,
  seconds: number,
  amplitude: number,
  frequency = 1_000,
  rightAmplitude = amplitude,
): Float32Array {
  const frames = Math.round(sampleRate * seconds);
  const samples = new Float32Array(frames * 2);
  for (let index = 0; index < frames; index += 1) {
    const phase = (2 * Math.PI * frequency * index) / sampleRate;
    samples[index * 2] = Math.sin(phase) * amplitude;
    samples[index * 2 + 1] = Math.sin(phase) * rightAmplitude;
  }
  return samples;
}

for (const sampleRate of [44_100, 48_000]) {
  void test(`LUFS-S is finite after 400 ms at ${String(sampleRate)} Hz`, () => {
    const meter = new ShortTermLoudnessMeter(sampleRate);
    meter.push(tone(sampleRate, 0.399, 0.1));
    assert.equal(meter.value(), null);
    const value = meter.push(tone(sampleRate, 0.01, 0.1));
    assert.ok(value !== null && Number.isFinite(value));
  });
}

void test("LUFS-S applies K-weighting and stereo channel energy", () => {
  const sampleRate = 48_000;
  const reference = new ShortTermLoudnessMeter(sampleRate);
  const low = new ShortTermLoudnessMeter(sampleRate);
  const mono = new ShortTermLoudnessMeter(sampleRate);
  const referenceValue = reference.push(tone(sampleRate, 3, 0.1));
  const lowValue = low.push(tone(sampleRate, 3, 0.1, 20));
  const monoValue = mono.push(tone(sampleRate, 3, 0.1, 1_000, 0));
  assert.ok(referenceValue !== null);
  assert.ok(lowValue !== null);
  assert.ok(monoValue !== null);
  assert.ok(referenceValue - lowValue > 10);
  assert.ok(Math.abs(referenceValue - monoValue - 3.01) < 0.08);
});

void test("LUFS-S tracks amplitude and wraps its exact three-second window", () => {
  const sampleRate = 48_000;
  const quiet = new ShortTermLoudnessMeter(sampleRate);
  const loud = new ShortTermLoudnessMeter(sampleRate);
  const quietValue = quiet.push(tone(sampleRate, 3, 0.05));
  const loudValue = loud.push(tone(sampleRate, 3, 0.1));
  assert.ok(quietValue !== null && loudValue !== null);
  assert.ok(Math.abs(loudValue - quietValue - 6.0206) < 0.05);

  quiet.push(tone(sampleRate, 3, 0.1));
  const wrappedValue = quiet.value();
  assert.ok(wrappedValue !== null);
  assert.ok(Math.abs(wrappedValue - loudValue) < 0.02);
  assert.equal(quiet.samplesInWindow, sampleRate * 3);
});

void test("LUFS-S silence is neutral and reset prevents track contamination", () => {
  const meter = new ShortTermLoudnessMeter(48_000);
  assert.equal(meter.push(new Float32Array(48_000 * 2)), null);
  meter.push(tone(48_000, 1, 0.2));
  assert.ok(meter.value() !== null);
  meter.reset();
  assert.equal(meter.value(), null);
  assert.equal(meter.samplesInWindow, 0);
  assert.equal(meter.memoryBytes, 48_000 * 3 * Float64Array.BYTES_PER_ELEMENT);
});

void test("LUFS hot path does not allocate per sample", async () => {
  const source = await readFile(
    new URL("../src/analysis/short-term-loudness-meter.ts", import.meta.url),
    "utf8",
  );
  const hotPath = source.slice(
    source.indexOf("pushStereo("),
    source.indexOf("\n  value():"),
  );
  assert.doesNotMatch(hotPath, /\bnew\s+|Array\.from|\.map\(|\.slice\(/);
});
