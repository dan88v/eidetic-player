import type { RepeatMode } from "./player.js";

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
] as const;

export type UiPreferenceKey = (typeof uiPreferenceKeys)[number];

export interface UiPreferences {
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
}

export const defaultUiPreferences: UiPreferences = Object.freeze({
  animationsEnabled: true,
  visualizerMode: "meter",
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
});

export type PreferencesPersistence =
  "persisted" | "defaults" | "recovered" | "degraded";

export type LegacyPreferencesImport =
  "required" | "imported" | "not-found" | "manual-required" | "manual";

export interface PreferencesSnapshot {
  readonly schemaVersion: 1;
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
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 100
      );
  }
}
