export const screenIds = [
  "nowPlaying",
  "folders",
  "library",
  "sources",
  "queue",
  "settings",
] as const;

export type ScreenId = (typeof screenIds)[number];
export type VisualizerMode =
  "meter" | "spectrumMono" | "spectrumStereo" | "none";
export type TimelineStyle = "waveform" | "line";
export type TimelineTimeMode = "total" | "remaining";
export type FolderViewMode = "list" | "grid";
export type FolderSortMode =
  "name-asc" | "name-desc" | "files-desc" | "files-asc";
export type MusicBrowsingVisibility = "both" | "folders" | "library";
export type ReturnToNowPlayingSeconds = 0 | 10 | 30 | 60 | 120;

export interface AppState {
  readonly activeScreen: ScreenId;
  readonly menuOpen: boolean;
  readonly queueOpen: boolean;
  readonly volumeOpen: boolean;
  readonly animationsEnabled: boolean;
  readonly visualizerMode: VisualizerMode;
  readonly timelineStyle: TimelineStyle;
  readonly timelineTimeMode: TimelineTimeMode;
  readonly musicBrowsingVisibility: MusicBrowsingVisibility;
  readonly returnToNowPlayingSeconds: ReturnToNowPlayingSeconds;
}
