const MINIMUM_MEASUREMENT_SECONDS = 0.4;
const SHORT_TERM_WINDOW_SECONDS = 3;
const ABSOLUTE_SILENCE_ENERGY = 1e-12;

interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(private readonly coefficients: BiquadCoefficients) {}

  process(value: number): number {
    const { b0, b1, b2, a1, a2 } = this.coefficients;
    const output =
      b0 * value + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = value;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }

  reset(): void {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }
}

function highShelfCoefficients(sampleRate: number): BiquadCoefficients {
  const gainDb = 3.999_843_853_973_347;
  const quality = 0.707_175_236_955_419_6;
  const frequency = 1_681.974_450_955_533;
  const k = Math.tan((Math.PI * frequency) / sampleRate);
  const vh = 10 ** (gainDb / 20);
  const vb = vh ** 0.499_666_774_154_541_6;
  const denominator = 1 + k / quality + k * k;
  return {
    b0: (vh + (vb * k) / quality + k * k) / denominator,
    b1: (2 * (k * k - vh)) / denominator,
    b2: (vh - (vb * k) / quality + k * k) / denominator,
    a1: (2 * (k * k - 1)) / denominator,
    a2: (1 - k / quality + k * k) / denominator,
  };
}

function highPassCoefficients(sampleRate: number): BiquadCoefficients {
  const quality = 0.500_327_037_323_877_3;
  const frequency = 38.135_470_876_024_44;
  const k = Math.tan((Math.PI * frequency) / sampleRate);
  const denominator = 1 + k / quality + k * k;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / denominator,
    a2: (1 - k / quality + k * k) / denominator,
  };
}

class KWeightingChannel {
  private readonly shelf: Biquad;
  private readonly highPass: Biquad;

  constructor(sampleRate: number) {
    this.shelf = new Biquad(highShelfCoefficients(sampleRate));
    this.highPass = new Biquad(highPassCoefficients(sampleRate));
  }

  process(value: number): number {
    return this.highPass.process(this.shelf.process(value));
  }

  reset(): void {
    this.shelf.reset();
    this.highPass.reset();
  }
}

export class ShortTermLoudnessMeter {
  readonly windowSamples: number;
  readonly minimumSamples: number;
  private readonly energyWindow: Float64Array;
  private readonly left: KWeightingChannel;
  private readonly right: KWeightingChannel;
  private writeIndex = 0;
  private sampleCount = 0;
  private energySum = 0;

  constructor(readonly sampleRate: number) {
    this.windowSamples = Math.round(sampleRate * SHORT_TERM_WINDOW_SECONDS);
    this.minimumSamples = Math.round(sampleRate * MINIMUM_MEASUREMENT_SECONDS);
    this.energyWindow = new Float64Array(this.windowSamples);
    this.left = new KWeightingChannel(sampleRate);
    this.right = new KWeightingChannel(sampleRate);
  }

  push(interleaved: Float32Array): number | null {
    for (let index = 0; index + 1 < interleaved.length; index += 2)
      this.pushStereo(interleaved[index] ?? 0, interleaved[index + 1] ?? 0);
    return this.value();
  }

  pushStereo(leftSample: number, rightSample: number): void {
    const left = this.left.process(leftSample);
    const right = this.right.process(rightSample);
    const energy = left * left + right * right;
    if (this.sampleCount === this.windowSamples)
      this.energySum -= this.energyWindow[this.writeIndex] ?? 0;
    else this.sampleCount += 1;
    this.energyWindow[this.writeIndex] = energy;
    this.energySum += energy;
    this.writeIndex = (this.writeIndex + 1) % this.windowSamples;
  }

  value(): number | null {
    if (
      this.sampleCount < this.minimumSamples ||
      this.energySum <= ABSOLUTE_SILENCE_ENERGY
    )
      return null;
    return -0.691 + 10 * Math.log10(this.energySum / this.sampleCount);
  }

  reset(): void {
    this.energyWindow.fill(0);
    this.left.reset();
    this.right.reset();
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.energySum = 0;
  }

  get memoryBytes(): number {
    return this.energyWindow.byteLength;
  }

  get samplesInWindow(): number {
    return this.sampleCount;
  }
}
