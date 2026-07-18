import type { VisualizerFrame } from "../../../../packages/shared/src/visualizer.js";
import { analysisConfig } from "./analysis-config.js";

export const ANALYSIS_SAMPLE_RATE = analysisConfig.sampleRate;
export const FFT_SIZE = 1_024;
export const HOP_SIZE = 512;

const clamp = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export function hannWindow(size: number): Float32Array {
  return Float32Array.from({ length: size }, (_, index) =>
    size <= 1 ? 1 : 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1))),
  );
}

export function fftMagnitudes(samples: Float32Array): Float32Array {
  const size = samples.length;
  const real = Float64Array.from(samples);
  const imaginary = new Float64Array(size);
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed)
      [real[index], real[reversed]] = [real[reversed] ?? 0, real[index] ?? 0];
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    for (let offset = 0; offset < size; offset += length) {
      for (let index = 0; index < length / 2; index += 1) {
        const cosine = Math.cos(angle * index);
        const sine = Math.sin(angle * index);
        const even = offset + index;
        const odd = even + length / 2;
        const oddReal =
          (real[odd] ?? 0) * cosine - (imaginary[odd] ?? 0) * sine;
        const oddImaginary =
          (real[odd] ?? 0) * sine + (imaginary[odd] ?? 0) * cosine;
        const evenReal = real[even] ?? 0;
        const evenImaginary = imaginary[even] ?? 0;
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
      }
    }
  }
  return Float32Array.from({ length: size / 2 }, (_, index) =>
    Math.hypot(real[index] ?? 0, imaginary[index] ?? 0),
  );
}

function logarithmicBands(magnitudes: Float32Array, count: number): number[] {
  const minimumBin = 1;
  const maximumBin = magnitudes.length - 1;
  return Array.from({ length: count }, (_, band) => {
    const start = Math.max(
      minimumBin,
      Math.floor(minimumBin * (maximumBin / minimumBin) ** (band / count)),
    );
    const end = Math.max(
      start + 1,
      Math.ceil(minimumBin * (maximumBin / minimumBin) ** ((band + 1) / count)),
    );
    let peak = 0;
    for (
      let index = start;
      index < Math.min(end, magnitudes.length);
      index += 1
    )
      peak = Math.max(peak, magnitudes[index] ?? 0);
    const db = 20 * Math.log10(Math.max(peak / (FFT_SIZE / 2), 1e-12));
    return clamp((db + 72) / 72);
  });
}

export class AudioAnalysisEngine {
  private left: number[] = [];
  private right: number[] = [];
  private readonly window = hannWindow(FFT_SIZE);
  private sequence = 0;
  private displayedMeter = [0, 0, 0, 0];

  push(
    interleaved: Float32Array,
    trackId: string,
    startPosition: number,
    samplesReceived: number,
  ): VisualizerFrame[] {
    for (let index = 0; index + 1 < interleaved.length; index += 2) {
      this.left.push(clampSigned(interleaved[index] ?? 0));
      this.right.push(clampSigned(interleaved[index + 1] ?? 0));
    }
    const frames: VisualizerFrame[] = [];
    while (this.left.length >= FFT_SIZE && this.right.length >= FFT_SIZE) {
      frames.push(
        this.analyze(
          trackId,
          startPosition + samplesReceived / ANALYSIS_SAMPLE_RATE,
        ),
      );
      this.left.splice(0, HOP_SIZE);
      this.right.splice(0, HOP_SIZE);
      samplesReceived += HOP_SIZE;
    }
    return frames;
  }

  reset(): void {
    this.left = [];
    this.right = [];
    this.displayedMeter = [0, 0, 0, 0];
  }

  private analyze(trackId: string, positionSeconds: number): VisualizerFrame {
    const left = Float32Array.from(this.left.slice(0, FFT_SIZE));
    const right = Float32Array.from(this.right.slice(0, FFT_SIZE));
    const meterSize = Math.min(
      Math.round(ANALYSIS_SAMPLE_RATE * 0.05),
      FFT_SIZE,
    );
    const meter = (samples: Float32Array): { peak: number; rms: number } => {
      let peak = 0;
      let energy = 0;
      for (
        let index = samples.length - meterSize;
        index < samples.length;
        index += 1
      ) {
        const value = samples[index] ?? 0;
        peak = Math.max(peak, Math.abs(value));
        energy += value * value;
      }
      return { peak: clamp(peak), rms: clamp(Math.sqrt(energy / meterSize)) };
    };
    const leftMeter = meter(left);
    const rightMeter = meter(right);
    const rawMeter = [
      leftMeter.peak,
      leftMeter.rms,
      rightMeter.peak,
      rightMeter.rms,
    ];
    this.displayedMeter = rawMeter.map((value, index) => {
      const previous = this.displayedMeter[index] ?? 0;
      return value >= previous ? value : previous * 0.82 + value * 0.18;
    });
    const leftWindowed = Float32Array.from(
      left,
      (value, index) => value * (this.window[index] ?? 0),
    );
    const rightWindowed = Float32Array.from(
      right,
      (value, index) => value * (this.window[index] ?? 0),
    );
    const leftMagnitudes = fftMagnitudes(leftWindowed);
    const rightMagnitudes = fftMagnitudes(rightWindowed);
    const monoMagnitudes = Float32Array.from(leftMagnitudes, (value, index) =>
      Math.sqrt((value * value + (rightMagnitudes[index] ?? 0) ** 2) / 2),
    );
    return {
      trackId,
      positionSeconds,
      sequence: ++this.sequence,
      meter: {
        leftPeak: clamp(this.displayedMeter[0] ?? 0),
        leftRms: clamp(this.displayedMeter[1] ?? 0),
        rightPeak: clamp(this.displayedMeter[2] ?? 0),
        rightRms: clamp(this.displayedMeter[3] ?? 0),
      },
      monoBands: logarithmicBands(monoMagnitudes, 32),
      leftBands: logarithmicBands(leftMagnitudes, 16),
      rightBands: logarithmicBands(rightMagnitudes, 16),
      source: "live",
    };
  }
}

function clampSigned(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

export function zeroFrame(
  trackId: string | null,
  sequence = 0,
): VisualizerFrame {
  return {
    trackId,
    positionSeconds: 0,
    sequence,
    meter: { leftPeak: 0, leftRms: 0, rightPeak: 0, rightRms: 0 },
    monoBands: Array(32).fill(0) as number[],
    leftBands: Array(16).fill(0) as number[],
    rightBands: Array(16).fill(0) as number[],
    source: "fallback",
  };
}
