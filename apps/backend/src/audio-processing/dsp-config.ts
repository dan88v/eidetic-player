import type {
  AudioProcessingPreferences,
  AudioSignalPath,
  EqualizerBand,
} from "../../../../packages/shared/src/audio-processing.js";
import { resolveEqualizerFilterType } from "../../../../packages/shared/src/audio-processing.js";

export const EIDETIC_DSP_FILTER_LABEL = "eidetic-dsp";

const LOG_GRID_POINTS = 384;

function peakingMagnitudeDb(
  frequencyHz: number,
  sampleFrequencyHz: number,
  band: EqualizerBand,
): number {
  if (!band.enabled || band.gainDb === 0) return 0;
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
  return 10 * Math.log10(Math.max(Number.EPSILON, numerator / denominator));
}

function shelvingMagnitudeDb(
  frequencyHz: number,
  sampleFrequencyHz: number,
  band: EqualizerBand,
  type: "low-shelf" | "high-shelf",
): number {
  if (!band.enabled || band.gainDb === 0) return 0;
  const amplitude = 10 ** (band.gainDb / 40);
  const omega = (2 * Math.PI * frequencyHz) / sampleFrequencyHz;
  const center = (2 * Math.PI * band.frequencyHz) / sampleFrequencyHz;
  const cosine = Math.cos(center);
  const alpha = Math.sin(center) / (2 * band.q);
  const rootAmplitude = Math.sqrt(amplitude);
  const common = 2 * rootAmplitude * alpha;
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

export function combinedEqualizerBoostDb(
  bands: readonly EqualizerBand[],
  sampleFrequencyHz = 48_000,
): number {
  let maximum = 0;
  const lower = Math.log(20);
  const upper = Math.log(Math.min(20_000, sampleFrequencyHz / 2 - 1));
  for (let index = 0; index < LOG_GRID_POINTS; index += 1) {
    const ratio = index / (LOG_GRID_POINTS - 1);
    const frequency = Math.exp(lower + (upper - lower) * ratio);
    const combined = bands.reduce((sum, band, bandIndex) => {
      const type = resolveEqualizerFilterType(band, bandIndex);
      return (
        sum +
        (type === "peaking"
          ? peakingMagnitudeDb(frequency, sampleFrequencyHz, band)
          : shelvingMagnitudeDb(frequency, sampleFrequencyHz, band, type))
      );
    }, 0);
    maximum = Math.max(maximum, combined);
  }
  return Math.max(0, Math.round(maximum * 100) / 100);
}

export function effectivePreampDb(
  preferences: AudioProcessingPreferences,
): number {
  if (!preferences.audioProcessingEnabled) return 0;
  if (preferences.headroomMode === "manual") return preferences.manualPreampDb;
  if (preferences.headroomMode === "off") return 0;
  const boost = preferences.equalizerEnabled
    ? combinedEqualizerBoostDb(preferences.equalizerBands)
    : 0;
  return Math.min(0, -boost);
}

function channelFilter(preferences: AudioProcessingPreferences): string | null {
  switch (preferences.channelMode) {
    case "mono":
      return "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1";
    case "left-to-both":
      return "pan=stereo|c0=c0|c1=c0";
    case "right-to-both":
      return "pan=stereo|c0=c1|c1=c1";
    case "swap":
      return "pan=stereo|c0=c1|c1=c0";
    case "stereo": {
      if (preferences.balanceDb === 0) return null;
      const left =
        preferences.balanceDb > 0 ? 10 ** (-preferences.balanceDb / 20) : 1;
      const right =
        preferences.balanceDb < 0 ? 10 ** (preferences.balanceDb / 20) : 1;
      return `pan=stereo|c0=${left.toFixed(6)}*c0|c1=${right.toFixed(6)}*c1`;
    }
  }
}

export function buildEideticDspFilter(
  preferences: AudioProcessingPreferences,
): string | null {
  if (!preferences.audioProcessingEnabled) return null;
  const filters: string[] = [];
  const channels = channelFilter(preferences);
  if (channels) filters.push(channels);
  if (preferences.equalizerEnabled) {
    for (const [index, band] of preferences.equalizerBands.entries()) {
      if (!band.enabled || band.gainDb === 0) continue;
      const type = resolveEqualizerFilterType(band, index);
      const filter =
        type === "low-shelf"
          ? "bass"
          : type === "high-shelf"
            ? "treble"
            : "equalizer";
      filters.push(
        `${filter}=f=${band.frequencyHz.toFixed(2)}:t=q:w=${band.q.toFixed(3)}:g=${band.gainDb.toFixed(2)}`,
      );
    }
  }
  const preamp = effectivePreampDb(preferences);
  if (preamp !== 0) filters.push(`volume=${preamp.toFixed(2)}dB`);
  if (filters.length === 0) return null;
  return `@${EIDETIC_DSP_FILTER_LABEL}:lavfi=[${filters.join(",")}]`;
}

export function buildAudioSignalPath(
  preferences: AudioProcessingPreferences,
  softwareVolume: number,
): AudioSignalPath {
  const boost =
    preferences.audioProcessingEnabled && preferences.equalizerEnabled
      ? combinedEqualizerBoostDb(preferences.equalizerBands)
      : 0;
  const preamp = effectivePreampDb(preferences);
  const projectedPeakGainDb = Math.round((boost + preamp) * 100) / 100;
  const equalizerActive =
    preferences.audioProcessingEnabled &&
    preferences.equalizerEnabled &&
    preferences.equalizerBands.some(
      (band) => band.enabled && band.gainDb !== 0,
    );
  return {
    outputLevel: preferences.outputLevelMode,
    softwareVolume,
    maximumSoftwareVolume: preferences.maximumSoftwareVolume,
    processing: preferences.audioProcessingEnabled ? "active" : "bypassed",
    channels: preferences.channelMode,
    balanceDb: preferences.channelMode === "stereo" ? preferences.balanceDb : 0,
    equalizer: !preferences.audioProcessingEnabled
      ? "bypassed"
      : equalizerActive
        ? "active"
        : "flat",
    headroomMode: preferences.headroomMode,
    preampDb: preamp,
    projectedPeakGainDb,
    filterLabel: EIDETIC_DSP_FILTER_LABEL,
    warning:
      preferences.headroomMode === "off" && projectedPeakGainDb > 0
        ? "positive-gain"
        : null,
  };
}
