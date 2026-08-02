import type { RepeatMode } from "./player.js";
import {
  defaultEqualizerBands,
  isEqualizerBandForIndex,
  maximumSoftwareVolumeChoices,
  type AudioProcessingPreferences,
} from "./audio-processing.js";
import {
  isScreenDimLevelPercent,
  isScreenDimTimeoutSeconds,
  isScreenStandbyTimeoutSeconds,
  type ScreenDimLevelPercent,
  type ScreenDimTimeoutSeconds,
  type ScreenStandbyTimeoutSeconds,
} from "./display.js";

export const uiPreferenceKeys = [
  "animationsEnabled",
  "visualizerMode",
  "mainPlayerMode",
  "timelineStyle",
  "timelineTimeMode",
  "volume",
  "muted",
  "shuffleEnabled",
  "repeatMode",
  "folderViewMode",
  "folderSortMode",
  "musicBrowsingVisibility",
  "returnToNowPlayingSeconds",
  "librarySegment",
  "libraryAlbumViewMode",
  "favoriteSegment",
  "favoriteAlbumViewMode",
  "onScreenKeyboardMode",
  "outputLevelMode",
  "lastVariableVolume",
  "maximumSoftwareVolume",
  "audioProcessingEnabled",
  "channelMode",
  "balanceDb",
  "equalizerEnabled",
  "equalizerBands",
  "headroomMode",
  "manualPreampDb",
  "screenDimTimeoutSeconds",
  "screenDimLevelPercent",
  "screenStandbyTimeoutSeconds",
  "continuePlaybackMode",
  "externalPlaybackEndPolicy",
] as const;

export type UiPreferenceKey = (typeof uiPreferenceKeys)[number];

export type ContinuePlaybackMode = "off" | "same-artist";
export type ExternalPlaybackEndPolicy = "keep-paused" | "resume-interrupted";

export interface UiPreferences extends AudioProcessingPreferences {
  readonly animationsEnabled: boolean;
  readonly visualizerMode:
    "meter" | "spectrumMono" | "spectrumStereo" | "technical" | "none";
  readonly mainPlayerMode: "default" | "cassette";
  readonly timelineStyle: "waveform" | "line";
  readonly timelineTimeMode: "total" | "remaining";
  readonly volume: number;
  readonly muted: boolean;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: RepeatMode;
  readonly folderViewMode: "list" | "grid";
  readonly folderSortMode:
    "name-asc" | "name-desc" | "files-desc" | "files-asc";
  readonly musicBrowsingVisibility: "both" | "folders" | "library";
  readonly returnToNowPlayingSeconds: 0 | 10 | 30 | 60 | 120;
  readonly librarySegment: "albums" | "artists" | "tracks";
  readonly libraryAlbumViewMode: "list" | "grid";
  readonly favoriteSegment: "tracks" | "albums" | "artists";
  readonly favoriteAlbumViewMode: "list" | "grid";
  readonly onScreenKeyboardMode: "auto" | "always" | "off";
  readonly screenDimTimeoutSeconds: ScreenDimTimeoutSeconds;
  readonly screenDimLevelPercent: ScreenDimLevelPercent;
  readonly screenStandbyTimeoutSeconds: ScreenStandbyTimeoutSeconds;
  readonly continuePlaybackMode: ContinuePlaybackMode;
  readonly externalPlaybackEndPolicy: ExternalPlaybackEndPolicy;
}

export const defaultUiPreferences: UiPreferences = Object.freeze({
  animationsEnabled: true,
  visualizerMode: "spectrumMono",
  mainPlayerMode: "default",
  timelineStyle: "waveform",
  timelineTimeMode: "total",
  volume: 100,
  muted: false,
  shuffleEnabled: false,
  repeatMode: "off",
  folderViewMode: "grid",
  folderSortMode: "name-asc",
  musicBrowsingVisibility: "both",
  returnToNowPlayingSeconds: 0,
  librarySegment: "albums",
  libraryAlbumViewMode: "grid",
  favoriteSegment: "tracks",
  favoriteAlbumViewMode: "grid",
  onScreenKeyboardMode: "auto",
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
  screenDimTimeoutSeconds: 0,
  screenDimLevelPercent: 20,
  screenStandbyTimeoutSeconds: 0,
  continuePlaybackMode: "off",
  externalPlaybackEndPolicy: "keep-paused",
});

export type PreferencesPersistence =
  "persisted" | "defaults" | "recovered" | "degraded";

export type LegacyPreferencesImport =
  "required" | "imported" | "not-found" | "manual-required" | "manual";

export interface PreferencesSnapshot {
  readonly schemaVersion: 4;
  readonly revision: number;
  readonly preferences: UiPreferences;
  readonly persistence: PreferencesPersistence;
  readonly legacyImport: LegacyPreferencesImport;
  readonly warning: boolean;
}

export interface PreferencesPatch {
  readonly expectedRevision?: number;
  readonly changes: Partial<UiPreferences>;
}

export interface LegacyPreferencesMigration {
  readonly preferences: Partial<UiPreferences>;
  readonly sourceAvailable: boolean;
  readonly confirmOverwrite?: boolean;
}

export function isUiPreferenceKey(value: string): value is UiPreferenceKey {
  return (uiPreferenceKeys as readonly string[]).includes(value);
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function isValidUiPreferenceValue<K extends UiPreferenceKey>(
  key: K,
  value: unknown,
): value is UiPreferences[K] {
  switch (key) {
    case "animationsEnabled":
    case "muted":
    case "shuffleEnabled":
    case "audioProcessingEnabled":
    case "equalizerEnabled":
      return typeof value === "boolean";
    case "visualizerMode":
      return isOneOf(value, [
        "meter",
        "spectrumMono",
        "spectrumStereo",
        "technical",
        "none",
      ]);
    case "mainPlayerMode":
      return isOneOf(value, ["default", "cassette"]);
    case "timelineStyle":
      return isOneOf(value, ["waveform", "line"]);
    case "timelineTimeMode":
      return isOneOf(value, ["total", "remaining"]);
    case "repeatMode":
      return isOneOf(value, ["off", "all", "one"]);
    case "continuePlaybackMode":
      return isOneOf(value, ["off", "same-artist"]);
    case "externalPlaybackEndPolicy":
      return isOneOf(value, ["keep-paused", "resume-interrupted"]);
    case "folderViewMode":
    case "libraryAlbumViewMode":
    case "favoriteAlbumViewMode":
      return isOneOf(value, ["list", "grid"]);
    case "folderSortMode":
      return isOneOf(value, [
        "name-asc",
        "name-desc",
        "files-desc",
        "files-asc",
      ]);
    case "musicBrowsingVisibility":
      return isOneOf(value, ["both", "folders", "library"]);
    case "returnToNowPlayingSeconds":
      return (
        value === 0 ||
        value === 10 ||
        value === 30 ||
        value === 60 ||
        value === 120
      );
    case "librarySegment":
      return isOneOf(value, ["albums", "artists", "tracks"]);
    case "favoriteSegment":
      return isOneOf(value, ["tracks", "albums", "artists"]);
    case "onScreenKeyboardMode":
      return isOneOf(value, ["auto", "always", "off"]);
    case "volume":
    case "lastVariableVolume":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 100
      );
    case "maximumSoftwareVolume":
      return maximumSoftwareVolumeChoices.includes(
        value as (typeof maximumSoftwareVolumeChoices)[number],
      );
    case "outputLevelMode":
      return isOneOf(value, ["variable", "fixed"]);
    case "channelMode":
      return isOneOf(value, [
        "stereo",
        "mono",
        "left-to-both",
        "right-to-both",
        "swap",
      ]);
    case "balanceDb":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= -12 &&
        value <= 12
      );
    case "equalizerBands":
      return (
        Array.isArray(value) &&
        value.length === 6 &&
        value.every((band, index) => isEqualizerBandForIndex(band, index))
      );
    case "headroomMode":
      return isOneOf(value, ["auto", "manual", "off"]);
    case "manualPreampDb":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= -12 &&
        value <= 0
      );
    case "screenDimTimeoutSeconds":
      return isScreenDimTimeoutSeconds(value);
    case "screenDimLevelPercent":
      return isScreenDimLevelPercent(value);
    case "screenStandbyTimeoutSeconds":
      return isScreenStandbyTimeoutSeconds(value);
  }
}
