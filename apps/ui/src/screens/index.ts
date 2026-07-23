import type { ComponentView } from "../components/types";
import type { AppStore } from "../state/store";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type { PlayerActions } from "./now-playing";
import type { FoldersApiClient } from "../api/folders-api-client";
import type { LibraryApiClient } from "../api/library-api-client";
import type {
  AddLocalSourceResponse,
  DirectoryQueueResponse,
  IndexedLibrarySnapshot,
} from "../../../../packages/shared/src/library";
import type {
  AppState,
  ScreenId,
  TimelineStyle,
  VisualizerMode,
  MainPlayerMode,
  OnScreenKeyboardMode,
} from "../state/types";
import { createFoldersScreen } from "./folders";
import { createLibraryScreen } from "./library";
import { createFavoritesScreen } from "./favorites";
import { createRecentlyPlayedScreen } from "./recently-played";
import type {
  FavoriteAlbumStore,
  FavoriteArtistStore,
  FavoriteTrackStore,
} from "../state/favorite-track-store";
import { createMainPlayerHost } from "../main-player/main-player-host";
import { createQueueScreen } from "./queue";
import { createSettingsScreen } from "./settings";
import { createSourcesScreen } from "./sources";
import { createPlaylistsScreen } from "./playlists";

export interface ScreenContext {
  readonly state: AppState;
  readonly setAnimationsEnabled: (enabled: boolean) => boolean;
  readonly setVisualizerMode: (mode: VisualizerMode) => boolean;
  readonly setMainPlayerMode: (mode: MainPlayerMode) => boolean;
  readonly handleCassetteError: () => void;
  readonly handleCassetteAssetError: () => void;
  readonly setTimelineStyle: (style: TimelineStyle) => boolean;
  readonly setTimelineTimeMode: (
    mode: Parameters<AppStore["setTimelineTimeMode"]>[0],
  ) => boolean;
  readonly setMusicBrowsingVisibility: (
    value: Parameters<AppStore["setMusicBrowsingVisibility"]>[0],
  ) => boolean;
  readonly setReturnToNowPlayingSeconds: (
    value: Parameters<AppStore["setReturnToNowPlayingSeconds"]>[0],
  ) => boolean;
  readonly setOnScreenKeyboardMode: (value: OnScreenKeyboardMode) => boolean;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
  readonly openQueue: (trigger: HTMLButtonElement) => void;
  readonly openLibrary: () => void;
  readonly openFolders: () => void;
  readonly toggleVolume: (trigger: HTMLButtonElement) => void;
  readonly playerState: PlayerState;
  readonly playerActions: PlayerActions;
  readonly foldersApi: FoldersApiClient;
  readonly libraryApi: LibraryApiClient;
  readonly favorites: FavoriteTrackStore;
  readonly favoriteAlbums: FavoriteAlbumStore;
  readonly favoriteArtists: FavoriteArtistStore;
  readonly initialLibraryEntity: {
    readonly kind: "album" | "artist";
    readonly id: string;
  } | null;
  readonly openLibraryEntity: (kind: "album" | "artist", id: string) => void;
  readonly librarySnapshot: IndexedLibrarySnapshot | null;
  readonly addLocalFolder: () => Promise<AddLocalSourceResponse | null>;
  readonly openFolderSource: (sourceId: string) => void;
  readonly openFolderEntry: (
    sourceId: string,
    entryId: string,
  ) => Promise<void>;
  readonly playFolderDirectory: (
    sourceId: string,
    relativePath: string,
  ) => Promise<DirectoryQueueResponse>;
  readonly openSources: () => void;
  readonly removeFolderSource: (sourceId: string) => void;
  readonly noteTrackCommand: () => void;
  readonly setScreenTitle: (title: string) => void;
  readonly openPlaylistPicker: (
    trackIds: readonly string[],
    trigger?: HTMLElement,
  ) => void;
  readonly setHeaderActions: (
    back: (() => void) | null,
    more: ((trigger: HTMLButtonElement) => void) | null,
  ) => void;
}

function staticView(element: HTMLElement): ComponentView {
  return {
    element,
    destroy() {
      // Static placeholder screens own no external resources.
    },
  };
}

export function createScreen(
  screen: ScreenId,
  context: ScreenContext,
): ComponentView {
  switch (screen) {
    case "nowPlaying":
      return createMainPlayerHost({
        mode: context.state.mainPlayerMode,
        animationsEnabled: context.state.animationsEnabled,
        visualizerMode: context.state.visualizerMode,
        timelineStyle: context.state.timelineStyle,
        musicBrowsingVisibility: context.state.musicBrowsingVisibility,
        timelineTimeMode: context.state.timelineTimeMode,
        onVisualizerModeChange: context.setVisualizerMode,
        onTimelineTimeModeChange: context.setTimelineTimeMode,
        onOpenQueue: context.openQueue,
        onOpenLibrary: context.openLibrary,
        onOpenFolders: context.openFolders,
        onToggleVolume: context.toggleVolume,
        initialPlayerState: context.playerState,
        actions: context.playerActions,
        favorites: context.favorites,
        onCassetteError: context.handleCassetteError,
        onCassetteAssetError: context.handleCassetteAssetError,
      });
    case "folders":
      return createFoldersScreen({
        api: context.foldersApi,
        openSources: context.openSources,
        openEntry: context.openFolderEntry,
        playDirectory: context.playFolderDirectory,
        initialPlayerState: context.playerState,
        showToast: context.showToast,
      });
    case "library":
      return createLibraryScreen({
        api: context.libraryApi,
        initialSnapshot: context.librarySnapshot,
        openSources: context.openSources,
        noteTrackCommand: context.noteTrackCommand,
        setTitle: context.setScreenTitle,
        showToast: context.showToast,
        favorites: context.favorites,
        favoriteAlbums: context.favoriteAlbums,
        favoriteArtists: context.favoriteArtists,
        openPlaylistPicker: context.openPlaylistPicker,
        ...(context.initialLibraryEntity
          ? { initialEntity: context.initialLibraryEntity }
          : {}),
      });
    case "favorites":
      return createFavoritesScreen({
        api: context.libraryApi,
        favorites: context.favorites,
        favoriteAlbums: context.favoriteAlbums,
        favoriteArtists: context.favoriteArtists,
        openLibraryEntity: context.openLibraryEntity,
        noteTrackCommand: context.noteTrackCommand,
        showToast: context.showToast,
        openPlaylistPicker: context.openPlaylistPicker,
      });
    case "playlists":
      return createPlaylistsScreen({
        api: context.libraryApi,
        setTitle: context.setScreenTitle,
        showToast: context.showToast,
        openPlaylistPicker: context.openPlaylistPicker,
        noteTrackCommand: context.noteTrackCommand,
        favorites: context.favorites,
        setHeaderActions: context.setHeaderActions,
      });
    case "recentlyPlayed":
      return createRecentlyPlayedScreen({
        api: context.libraryApi,
        favorites: context.favorites,
        initialSnapshot: context.librarySnapshot,
        noteTrackCommand: context.noteTrackCommand,
        showToast: context.showToast,
        openPlaylistPicker: context.openPlaylistPicker,
      });
    case "sources":
      return createSourcesScreen({
        api: context.foldersApi,
        libraryApi: context.libraryApi,
        initialLibrarySnapshot: context.librarySnapshot,
        addFolder: context.addLocalFolder,
        openSource: context.openFolderSource,
        onSourceRemoved: context.removeFolderSource,
        showToast: context.showToast,
      });
    case "queue":
      return staticView(createQueueScreen());
    case "settings":
      return createSettingsScreen({
        animationsEnabled: context.state.animationsEnabled,
        mainPlayerMode: context.state.mainPlayerMode,
        visualizerMode: context.state.visualizerMode,
        timelineStyle: context.state.timelineStyle,
        musicBrowsingVisibility: context.state.musicBrowsingVisibility,
        returnToNowPlayingSeconds: context.state.returnToNowPlayingSeconds,
        onScreenKeyboardMode: context.state.onScreenKeyboardMode,
        onAnimationsChange: context.setAnimationsEnabled,
        onMainPlayerModeChange: context.setMainPlayerMode,
        onVisualizerModeChange: context.setVisualizerMode,
        onTimelineStyleChange: context.setTimelineStyle,
        onMusicBrowsingVisibilityChange: context.setMusicBrowsingVisibility,
        onReturnToNowPlayingSecondsChange: context.setReturnToNowPlayingSeconds,
        onScreenKeyboardModeChange: context.setOnScreenKeyboardMode,
      });
  }
}
