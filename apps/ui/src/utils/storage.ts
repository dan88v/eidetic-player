import type { RepeatMode } from "../../../../packages/shared/src/player";
import {
  defaultUiPreferences,
  type ContinuePlaybackMode,
  type ExternalPlaybackEndPolicy,
  type UiPreferences,
} from "../../../../packages/shared/src/preferences";
import type {
  FavoriteSegment,
  FolderSortMode,
  FolderViewMode,
  LibraryAlbumViewMode,
  LibrarySegment,
  MainPlayerMode,
  MusicBrowsingVisibility,
  OnScreenKeyboardMode,
  ReturnToNowPlayingSeconds,
  TimelineStyle,
  TimelineTimeMode,
  VisualizerMode,
} from "../state/types";

export const legacyPreferenceStorageKeys = {
  animationsEnabled: "eidetic-player.interface.animations-enabled",
  visualizerMode: "eidetic-player.interface.visualizer-mode",
  mainPlayerMode: "eidetic-player.interface.main-player-mode",
  timelineStyle: "eidetic-player.interface.timeline-style",
  timelineTimeMode: "eidetic-player.interface.timeline-time-mode",
  volume: "eidetic-player.player.volume",
  muted: "eidetic-player.player.muted",
  shuffleEnabled: "eidetic-player.player.shuffle",
  repeatMode: "eidetic-player.player.repeat",
  folderViewMode: "eidetic-player.interface.folder-view",
  legacyLibraryFolderView: "eidetic-player.interface.library-folder-view",
  folderSortMode: "eidetic-player.interface.folder-sort",
  musicBrowsingVisibility: "eidetic-player.interface.music-browsing",
  returnToNowPlayingSeconds: "eidetic-player.interface.return-to-now-playing",
  librarySegment: "eidetic-player.interface.library-segment",
  libraryAlbumViewMode: "eidetic-player.interface.library-album-view",
  favoriteSegment: "eidetic-player.interface.favorite-segment",
  favoriteAlbumViewMode: "eidetic-player.interface.favorite-album-view",
  onScreenKeyboardMode: "eidetic-player.interface.on-screen-keyboard",
} as const;

export interface PreferencesPersistenceAdapter {
  getPreferences(): UiPreferences;
  update(changes: Partial<UiPreferences>): void;
}

export interface LegacyPreferencesRead {
  readonly preferences: Partial<UiPreferences>;
  readonly sourceAvailable: boolean;
  readonly foundKeyCount: number;
  readonly readKeyCount: number;
}

type MutableUiPreferences = {
  -readonly [Key in keyof UiPreferences]?: UiPreferences[Key];
};

let currentPreferences: UiPreferences = defaultUiPreferences;
let persistenceAdapter: PreferencesPersistenceAdapter | null = null;

export function initializePreferenceStorage(
  preferences: UiPreferences,
  adapter: PreferencesPersistenceAdapter,
): void {
  currentPreferences = Object.freeze({ ...preferences });
  persistenceAdapter = adapter;
}

export function resetPreferenceStorageForTests(): void {
  currentPreferences = defaultUiPreferences;
  persistenceAdapter = null;
}

function current(): UiPreferences {
  return persistenceAdapter?.getPreferences() ?? currentPreferences;
}

function save(changes: Partial<UiPreferences>): boolean {
  currentPreferences = Object.freeze({ ...current(), ...changes });
  persistenceAdapter?.update(changes);
  return true;
}

function legacyRead(
  storage: Storage,
  key: string,
  state: { count: number },
): string | null {
  state.count += 1;
  return storage.getItem(key);
}

function legacyBoolean(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function readLegacyPreferences(
  storage: Storage = window.localStorage,
): LegacyPreferencesRead {
  const preferences: MutableUiPreferences = {};
  const state = { count: 0 };
  let foundKeyCount = 0;
  const read = (key: string): string | null => {
    const value = legacyRead(storage, key, state);
    if (value !== null) foundKeyCount += 1;
    return value;
  };
  try {
    const animationsEnabled = legacyBoolean(
      read(legacyPreferenceStorageKeys.animationsEnabled),
    );
    if (animationsEnabled !== undefined)
      preferences.animationsEnabled = animationsEnabled;

    const visualizer = read(legacyPreferenceStorageKeys.visualizerMode);
    if (visualizer === "spectrum") preferences.visualizerMode = "spectrumMono";
    else if (
      visualizer === "meter" ||
      visualizer === "spectrumMono" ||
      visualizer === "spectrumStereo" ||
      visualizer === "technical" ||
      visualizer === "none"
    )
      preferences.visualizerMode = visualizer;

    const mainPlayer = read(legacyPreferenceStorageKeys.mainPlayerMode);
    if (mainPlayer === "default" || mainPlayer === "cassette")
      preferences.mainPlayerMode = mainPlayer;

    const timeline = read(legacyPreferenceStorageKeys.timelineStyle);
    if (timeline === "waveform" || timeline === "line")
      preferences.timelineStyle = timeline;

    const timeMode = read(legacyPreferenceStorageKeys.timelineTimeMode);
    if (timeMode === "total" || timeMode === "remaining")
      preferences.timelineTimeMode = timeMode;

    const rawVolume = read(legacyPreferenceStorageKeys.volume);
    if (rawVolume !== null && rawVolume.trim().length > 0) {
      const volume = Number(rawVolume);
      if (Number.isFinite(volume) && volume >= 0 && volume <= 100)
        preferences.volume = volume;
    }

    const muted = legacyBoolean(read(legacyPreferenceStorageKeys.muted));
    if (muted !== undefined) preferences.muted = muted;
    const shuffle = legacyBoolean(
      read(legacyPreferenceStorageKeys.shuffleEnabled),
    );
    if (shuffle !== undefined) preferences.shuffleEnabled = shuffle;

    const repeat = read(legacyPreferenceStorageKeys.repeatMode);
    if (repeat === "off" || repeat === "all" || repeat === "one")
      preferences.repeatMode = repeat;

    const folderView =
      read(legacyPreferenceStorageKeys.folderViewMode) ??
      read(legacyPreferenceStorageKeys.legacyLibraryFolderView);
    if (folderView === "list" || folderView === "grid")
      preferences.folderViewMode = folderView;

    const folderSort = read(legacyPreferenceStorageKeys.folderSortMode);
    if (
      folderSort === "name-asc" ||
      folderSort === "name-desc" ||
      folderSort === "files-desc" ||
      folderSort === "files-asc"
    )
      preferences.folderSortMode = folderSort;

    const browsing = read(legacyPreferenceStorageKeys.musicBrowsingVisibility);
    if (browsing === "both" || browsing === "folders" || browsing === "library")
      preferences.musicBrowsingVisibility = browsing;

    const rawReturnSeconds = read(
      legacyPreferenceStorageKeys.returnToNowPlayingSeconds,
    );
    if (rawReturnSeconds !== null && rawReturnSeconds.trim().length > 0) {
      const returnSeconds = Number(rawReturnSeconds);
      if (
        returnSeconds === 0 ||
        returnSeconds === 10 ||
        returnSeconds === 30 ||
        returnSeconds === 60 ||
        returnSeconds === 120
      )
        preferences.returnToNowPlayingSeconds = returnSeconds;
    }

    const librarySegment = read(legacyPreferenceStorageKeys.librarySegment);
    if (
      librarySegment === "albums" ||
      librarySegment === "artists" ||
      librarySegment === "tracks"
    )
      preferences.librarySegment = librarySegment;

    const libraryView = read(legacyPreferenceStorageKeys.libraryAlbumViewMode);
    if (libraryView === "list" || libraryView === "grid")
      preferences.libraryAlbumViewMode = libraryView;

    const favoriteSegment = read(legacyPreferenceStorageKeys.favoriteSegment);
    if (
      favoriteSegment === "tracks" ||
      favoriteSegment === "albums" ||
      favoriteSegment === "artists"
    )
      preferences.favoriteSegment = favoriteSegment;

    const favoriteView = read(
      legacyPreferenceStorageKeys.favoriteAlbumViewMode,
    );
    if (favoriteView === "list" || favoriteView === "grid")
      preferences.favoriteAlbumViewMode = favoriteView;

    const keyboard = read(legacyPreferenceStorageKeys.onScreenKeyboardMode);
    if (keyboard === "auto" || keyboard === "always" || keyboard === "off")
      preferences.onScreenKeyboardMode = keyboard;
  } catch {
    return {
      preferences: {},
      sourceAvailable: false,
      foundKeyCount: 0,
      readKeyCount: state.count,
    };
  }
  return {
    preferences,
    sourceAvailable: true,
    foundKeyCount,
    readKeyCount: state.count,
  };
}

export function loadAnimationsEnabled(): boolean {
  return current().animationsEnabled;
}
export function saveAnimationsEnabled(value: boolean): boolean {
  return save({ animationsEnabled: value });
}
export function loadVisualizerMode(): VisualizerMode {
  return current().visualizerMode;
}
export function saveVisualizerMode(value: VisualizerMode): boolean {
  return save({ visualizerMode: value });
}
export function loadMainPlayerMode(): MainPlayerMode {
  return current().mainPlayerMode;
}
export function saveMainPlayerMode(value: MainPlayerMode): boolean {
  return save({ mainPlayerMode: value });
}
export function loadTimelineStyle(): TimelineStyle {
  return current().timelineStyle;
}
export function saveTimelineStyle(value: TimelineStyle): boolean {
  return save({ timelineStyle: value });
}
export function loadTimelineTimeMode(): TimelineTimeMode {
  return current().timelineTimeMode;
}
export function saveTimelineTimeMode(value: TimelineTimeMode): boolean {
  return save({ timelineTimeMode: value });
}
export function loadFolderViewMode(): FolderViewMode {
  return current().folderViewMode;
}
export function saveFolderViewMode(value: FolderViewMode): boolean {
  return save({ folderViewMode: value });
}
export function loadFolderSortMode(): FolderSortMode {
  return current().folderSortMode;
}
export function saveFolderSortMode(value: FolderSortMode): boolean {
  return save({ folderSortMode: value });
}
export function loadMusicBrowsingVisibility(): MusicBrowsingVisibility {
  return current().musicBrowsingVisibility;
}
export function saveMusicBrowsingVisibility(
  value: MusicBrowsingVisibility,
): boolean {
  return save({ musicBrowsingVisibility: value });
}
export function loadReturnToNowPlayingSeconds(): ReturnToNowPlayingSeconds {
  return current().returnToNowPlayingSeconds;
}
export function saveReturnToNowPlayingSeconds(
  value: ReturnToNowPlayingSeconds,
): boolean {
  return save({ returnToNowPlayingSeconds: value });
}
export function loadLibrarySegment(): LibrarySegment {
  return current().librarySegment;
}
export function saveLibrarySegment(value: LibrarySegment): boolean {
  return save({ librarySegment: value });
}
export function loadLibraryAlbumViewMode(): LibraryAlbumViewMode {
  return current().libraryAlbumViewMode;
}
export function saveLibraryAlbumViewMode(value: LibraryAlbumViewMode): boolean {
  return save({ libraryAlbumViewMode: value });
}
export function loadFavoriteSegment(): FavoriteSegment {
  return current().favoriteSegment;
}
export function saveFavoriteSegment(value: FavoriteSegment): boolean {
  return save({ favoriteSegment: value });
}
export function loadFavoriteAlbumViewMode(): LibraryAlbumViewMode {
  return current().favoriteAlbumViewMode;
}
export function saveFavoriteAlbumViewMode(
  value: LibraryAlbumViewMode,
): boolean {
  return save({ favoriteAlbumViewMode: value });
}
export function loadOnScreenKeyboardMode(): OnScreenKeyboardMode {
  return current().onScreenKeyboardMode;
}
export function saveOnScreenKeyboardMode(value: OnScreenKeyboardMode): boolean {
  return save({ onScreenKeyboardMode: value });
}

export function loadContinuePlaybackMode(): ContinuePlaybackMode {
  return current().continuePlaybackMode;
}

export function saveContinuePlaybackMode(value: ContinuePlaybackMode): boolean {
  return save({ continuePlaybackMode: value });
}

export function saveExternalPlaybackEndPolicy(
  value: ExternalPlaybackEndPolicy,
): boolean {
  return save({ externalPlaybackEndPolicy: value });
}

export interface PlaybackPreferences {
  readonly volume: number;
  readonly muted: boolean;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: RepeatMode;
}

export function loadPlaybackPreferences(): PlaybackPreferences {
  const preferences = current();
  return {
    volume: preferences.volume,
    muted: preferences.muted,
    shuffleEnabled: preferences.shuffleEnabled,
    repeatMode: preferences.repeatMode,
  };
}

export function savePlaybackPreferences(
  preferences: PlaybackPreferences,
): boolean {
  return save(preferences);
}

export function saveVolumePreference(volume: number): boolean {
  return save({ volume });
}

export function saveMutedPreference(muted: boolean): boolean {
  return save({ muted });
}

export function saveShufflePreference(shuffleEnabled: boolean): boolean {
  return save({ shuffleEnabled });
}

export function saveRepeatPreference(repeatMode: RepeatMode): boolean {
  return save({ repeatMode });
}
