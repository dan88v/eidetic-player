import type {
  TimelineStyle,
  TimelineTimeMode,
  VisualizerMode,
} from "../state/types";
import type { RepeatMode } from "../../../../packages/shared/src/player";

const storageKeys = {
  animationsEnabled: "eidetic-player.interface.animations-enabled",
  visualizerMode: "eidetic-player.interface.visualizer-mode",
  timelineStyle: "eidetic-player.interface.timeline-style",
  timelineTimeMode: "eidetic-player.interface.timeline-time-mode",
  volume: "eidetic-player.player.volume",
  muted: "eidetic-player.player.muted",
  shuffle: "eidetic-player.player.shuffle",
  repeat: "eidetic-player.player.repeat",
} as const;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The in-memory state remains valid when storage is unavailable.
  }
}

export function loadAnimationsEnabled(): boolean {
  const storedValue = read(storageKeys.animationsEnabled);
  return storedValue === null ? true : storedValue === "true";
}

export function saveAnimationsEnabled(enabled: boolean): void {
  write(storageKeys.animationsEnabled, String(enabled));
}

export function loadVisualizerMode(): VisualizerMode {
  const value = read(storageKeys.visualizerMode);
  if (value === "spectrum") return "spectrumMono";
  return value === "meter" ||
    value === "spectrumMono" ||
    value === "spectrumStereo" ||
    value === "none"
    ? value
    : "meter";
}

export function saveVisualizerMode(mode: VisualizerMode): void {
  write(storageKeys.visualizerMode, mode);
}

export function loadTimelineStyle(): TimelineStyle {
  return read(storageKeys.timelineStyle) === "line" ? "line" : "waveform";
}

export function saveTimelineStyle(style: TimelineStyle): void {
  write(storageKeys.timelineStyle, style);
}

export function loadTimelineTimeMode(): TimelineTimeMode {
  return read(storageKeys.timelineTimeMode) === "remaining"
    ? "remaining"
    : "total";
}

export function saveTimelineTimeMode(mode: TimelineTimeMode): void {
  write(storageKeys.timelineTimeMode, mode);
}

export interface PlaybackPreferences {
  readonly volume: number;
  readonly muted: boolean;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: RepeatMode;
}

export function loadPlaybackPreferences(): PlaybackPreferences {
  const volume = Number(read(storageKeys.volume));
  const repeat = read(storageKeys.repeat);
  return {
    volume:
      Number.isFinite(volume) && volume >= 0 && volume <= 100 ? volume : 100,
    muted: read(storageKeys.muted) === "true",
    shuffleEnabled: read(storageKeys.shuffle) === "true",
    repeatMode: repeat === "all" || repeat === "one" ? repeat : "off",
  };
}

export function savePlaybackPreferences(
  preferences: PlaybackPreferences,
): void {
  write(storageKeys.volume, String(preferences.volume));
  write(storageKeys.muted, String(preferences.muted));
  write(storageKeys.shuffle, String(preferences.shuffleEnabled));
  write(storageKeys.repeat, preferences.repeatMode);
}
