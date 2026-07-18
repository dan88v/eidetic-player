export const screenIds = [
  "nowPlaying",
  "library",
  "sources",
  "queue",
  "settings",
] as const;

export type ScreenId = (typeof screenIds)[number];
export type VisualizerMode =
  "meter" | "spectrumMono" | "spectrumStereo" | "none";
export type TimelineStyle = "waveform" | "line";

export interface AppState {
  readonly activeScreen: ScreenId;
  readonly menuOpen: boolean;
  readonly queueOpen: boolean;
  readonly volumeOpen: boolean;
  readonly animationsEnabled: boolean;
  readonly visualizerMode: VisualizerMode;
  readonly timelineStyle: TimelineStyle;
}
