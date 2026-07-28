import {
  resolveEqualizerFilterType,
  type EqualizerBand,
} from "../../../../packages/shared/src/audio-processing";

function shelvingMagnitudeDb(
  frequencyHz: number,
  sampleFrequencyHz: number,
  band: EqualizerBand,
  type: "low-shelf" | "high-shelf",
): number {
  const amplitude = 10 ** (band.gainDb / 40);
  const omega = (2 * Math.PI * frequencyHz) / sampleFrequencyHz;
  const center = (2 * Math.PI * band.frequencyHz) / sampleFrequencyHz;
  const cosine = Math.cos(center);
  const alpha = Math.sin(center) / (2 * band.q);
  const common = 2 * Math.sqrt(amplitude) * alpha;
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  if (type === "low-shelf") {
    b0 = amplitude * (amplitude + 1 - (amplitude - 1) * cosine + common);
    b1 = 2 * amplitude * (amplitude - 1 - (amplitude + 1) * cosine);
    b2 = amplitude * (amplitude + 1 - (amplitude - 1) * cosine - common);
    a0 = amplitude + 1 + (amplitude - 1) * cosine + common;
    a1 = -2 * (amplitude - 1 + (amplitude + 1) * cosine);
    a2 = amplitude + 1 + (amplitude - 1) * cosine - common;
  } else {
    b0 = amplitude * (amplitude + 1 + (amplitude - 1) * cosine + common);
    b1 = -2 * amplitude * (amplitude - 1 + (amplitude + 1) * cosine);
    b2 = amplitude * (amplitude + 1 + (amplitude - 1) * cosine - common);
    a0 = amplitude + 1 - (amplitude - 1) * cosine + common;
    a1 = 2 * (amplitude - 1 - (amplitude + 1) * cosine);
    a2 = amplitude + 1 - (amplitude - 1) * cosine - common;
  }
  const cosineAtFrequency = Math.cos(omega);
  const sineAtFrequency = Math.sin(omega);
  const numeratorReal = b0 + b1 * cosineAtFrequency + b2 * Math.cos(2 * omega);
  const numeratorImaginary = -b1 * sineAtFrequency - b2 * Math.sin(2 * omega);
  const denominatorReal =
    a0 + a1 * cosineAtFrequency + a2 * Math.cos(2 * omega);
  const denominatorImaginary = -a1 * sineAtFrequency - a2 * Math.sin(2 * omega);
  const numerator =
    numeratorReal * numeratorReal + numeratorImaginary * numeratorImaginary;
  const denominator =
    denominatorReal * denominatorReal +
    denominatorImaginary * denominatorImaginary;
  return 10 * Math.log10(Math.max(Number.EPSILON, numerator / denominator));
}

export function equalizerMagnitudeDb(
  bands: readonly EqualizerBand[],
  frequencyHz: number,
  sampleFrequencyHz = 48_000,
): number {
  return bands.reduce((sum, band, index) => {
    if (!band.enabled || band.gainDb === 0) return sum;
    const filterType = resolveEqualizerFilterType(band, index);
    if (filterType !== "peaking")
      return (
        sum +
        shelvingMagnitudeDb(frequencyHz, sampleFrequencyHz, band, filterType)
      );
    const amplitude = 10 ** (band.gainDb / 40);
    const omega = (2 * Math.PI * frequencyHz) / sampleFrequencyHz;
    const center = (2 * Math.PI * band.frequencyHz) / sampleFrequencyHz;
    const alpha = Math.sin(center) / (2 * band.q);
    const cosCenter = Math.cos(center);
    const b0 = 1 + alpha * amplitude;
    const b1 = -2 * cosCenter;
    const b2 = 1 - alpha * amplitude;
    const a0 = 1 + alpha / amplitude;
    const a1 = -2 * cosCenter;
    const a2 = 1 - alpha / amplitude;
    const cos = Math.cos(omega);
    const sin = Math.sin(omega);
    const numeratorReal = b0 + b1 * cos + b2 * Math.cos(2 * omega);
    const numeratorImaginary = -b1 * sin - b2 * Math.sin(2 * omega);
    const denominatorReal = a0 + a1 * cos + a2 * Math.cos(2 * omega);
    const denominatorImaginary = -a1 * sin - a2 * Math.sin(2 * omega);
    const numerator =
      numeratorReal * numeratorReal + numeratorImaginary * numeratorImaginary;
    const denominator =
      denominatorReal * denominatorReal +
      denominatorImaginary * denominatorImaginary;
    return (
      sum + 10 * Math.log10(Math.max(Number.EPSILON, numerator / denominator))
    );
  }, 0);
}

export function equalizerFrequencyPosition(frequencyHz: number): number {
  const lower = Math.log(20);
  const upper = Math.log(20_000);
  return Math.max(
    0,
    Math.min(1, (Math.log(frequencyHz) - lower) / (upper - lower)),
  );
}

export function equalizerFrequencyFromPosition(position: number): number {
  const lower = Math.log(20);
  const upper = Math.log(20_000);
  return Math.exp(lower + (upper - lower) * Math.max(0, Math.min(1, position)));
}
