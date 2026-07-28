export const maximumSoftwareVolumeChoices = [60, 70, 80, 90, 95, 100] as const;
export type MaximumSoftwareVolume =
  (typeof maximumSoftwareVolumeChoices)[number];

export type OutputLevelMode = "variable" | "fixed";
export type AudioChannelMode =
  "stereo" | "mono" | "left-to-both" | "right-to-both" | "swap";
export type HeadroomMode = "auto" | "manual" | "off";
export type EqualizerFilterType = "peaking" | "low-shelf" | "high-shelf";

export interface EqualizerBand {
  readonly enabled: boolean;
  readonly frequencyHz: number;
  readonly gainDb: number;
  readonly q: number;
  readonly filterType?: EqualizerFilterType;
}

export const defaultEqualizerBands: readonly EqualizerBand[] = Object.freeze(
  [60, 150, 400, 1_000, 3_000, 10_000].map((frequencyHz, index) =>
    Object.freeze({
      enabled: true,
      frequencyHz,
      gainDb: 0,
      q: 1,
      filterType:
        index === 0 ? "low-shelf" : index === 5 ? "high-shelf" : "peaking",
    } satisfies EqualizerBand),
  ),
);

export function resolveEqualizerFilterType(
  band: EqualizerBand,
  index: number,
): EqualizerFilterType {
  return (
    band.filterType ??
    (index === 0 ? "low-shelf" : index === 5 ? "high-shelf" : "peaking")
  );
}

export interface AudioProcessingPreferences {
  readonly outputLevelMode: OutputLevelMode;
  readonly lastVariableVolume: number;
  readonly maximumSoftwareVolume: MaximumSoftwareVolume;
  readonly audioProcessingEnabled: boolean;
  readonly channelMode: AudioChannelMode;
  readonly balanceDb: number;
  readonly equalizerEnabled: boolean;
  readonly equalizerBands: readonly EqualizerBand[];
  readonly headroomMode: HeadroomMode;
  readonly manualPreampDb: number;
}

export interface AudioSignalPath {
  readonly outputLevel: OutputLevelMode;
  readonly softwareVolume: number;
  readonly maximumSoftwareVolume: MaximumSoftwareVolume;
  readonly processing: "active" | "bypassed";
  readonly channels: AudioChannelMode;
  readonly balanceDb: number;
  readonly equalizer: "active" | "flat" | "bypassed";
  readonly headroomMode: HeadroomMode;
  readonly preampDb: number;
  readonly projectedPeakGainDb: number;
  readonly filterLabel: string;
  readonly warning: "positive-gain" | null;
}

export interface AudioProcessingState {
  readonly preferences: AudioProcessingPreferences;
  readonly signalPath: AudioSignalPath;
  readonly fixedOutputConfirmationRequired: boolean;
  readonly revision: number;
}

export interface AudioProcessingPatch {
  readonly changes: Partial<AudioProcessingPreferences>;
  readonly confirmFixedOutput?: boolean;
}

export interface AudioProcessingPatchResult {
  readonly state: AudioProcessingState;
  readonly pausedForFixedOutput: boolean;
}

export const defaultAudioProcessingPreferences: AudioProcessingPreferences =
  Object.freeze({
    outputLevelMode: "variable",
    lastVariableVolume: 100,
    maximumSoftwareVolume: 100,
    audioProcessingEnabled: false,
    channelMode: "stereo",
    balanceDb: 0,
    equalizerEnabled: false,
    equalizerBands: defaultEqualizerBands,
    headroomMode: "auto",
    manualPreampDb: 0,
  });

export const disconnectedAudioProcessingState: AudioProcessingState = {
  preferences: defaultAudioProcessingPreferences,
  signalPath: {
    outputLevel: "variable",
    softwareVolume: 100,
    maximumSoftwareVolume: 100,
    processing: "bypassed",
    channels: "stereo",
    balanceDb: 0,
    equalizer: "bypassed",
    headroomMode: "auto",
    preampDb: 0,
    projectedPeakGainDb: 0,
    filterLabel: "eidetic-dsp",
    warning: null,
  },
  fixedOutputConfirmationRequired: true,
  revision: 0,
};

export function isEqualizerBand(value: unknown): value is EqualizerBand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const band = value as Partial<EqualizerBand>;
  const filterType = (value as { readonly filterType?: unknown }).filterType;
  return (
    typeof band.enabled === "boolean" &&
    typeof band.frequencyHz === "number" &&
    Number.isFinite(band.frequencyHz) &&
    band.frequencyHz >= 20 &&
    band.frequencyHz <= 20_000 &&
    typeof band.gainDb === "number" &&
    Number.isFinite(band.gainDb) &&
    band.gainDb >= -12 &&
    band.gainDb <= 12 &&
    typeof band.q === "number" &&
    Number.isFinite(band.q) &&
    band.q >= 0.3 &&
    band.q <= 10 &&
    (filterType === undefined ||
      filterType === "peaking" ||
      filterType === "low-shelf" ||
      filterType === "high-shelf")
  );
}

export function isEqualizerBandForIndex(
  value: unknown,
  index: number,
): value is EqualizerBand {
  if (!isEqualizerBand(value)) return false;
  if (value.filterType === undefined || value.filterType === "peaking")
    return true;
  return (
    (index === 0 && value.filterType === "low-shelf") ||
    (index === 5 && value.filterType === "high-shelf")
  );
}
