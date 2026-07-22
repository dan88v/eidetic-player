export const screenIds = [
  "nowPlaying",
  "folders",
  "library",
  "favorites",
  "recentlyPlayed",
  "sources",
  "queue",
  "settings",
] as const;

export type ScreenId = (typeof screenIds)[number];
export type VisualizerMode =
  "meter" | "spectrumMono" | "spectrumStereo" | "technical" | "none";
export type MainPlayerMode = "default" | "cassette";
export type TimelineStyle = "waveform" | "line";
export type TimelineTimeMode = "total" | "remaining";
export type FolderViewMode = "list" | "grid";
export type LibrarySegment = "albums" | "artists" | "tracks";
export type LibraryAlbumViewMode = "list" | "grid";
export type FavoriteSegment = "tracks" | "albums" | "artists";
export type FolderSortMode =
  "name-asc" | "name-desc" | "files-desc" | "files-asc";
export type MusicBrowsingVisibility = "both" | "folders" | "library";
export type ReturnToNowPlayingSeconds = 0 | 10 | 30 | 60 | 120;
export type OnScreenKeyboardMode = "auto" | "always" | "off";

export interface AppState {
  readonly activeScreen: ScreenId;
  readonly menuOpen: boolean;
  readonly queueOpen: boolean;
  readonly volumeOpen: boolean;
  readonly animationsEnabled: boolean;
  readonly visualizerMode: VisualizerMode;
  readonly mainPlayerMode: MainPlayerMode;
  readonly timelineStyle: TimelineStyle;
  readonly timelineTimeMode: TimelineTimeMode;
  readonly musicBrowsingVisibility: MusicBrowsingVisibility;
  readonly returnToNowPlayingSeconds: ReturnToNowPlayingSeconds;
  readonly onScreenKeyboardMode: OnScreenKeyboardMode;
}
