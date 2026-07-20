import type { ComponentView } from "../components/types";
import type { AppStore } from "../state/store";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type { PlayerActions } from "./now-playing";
import type { FoldersApiClient } from "../api/folders-api-client";
import type { LibraryApiClient } from "../api/library-api-client";
import type {
  AddLocalSourceResponse,
  DirectoryQueueResponse,
} from "../../../../packages/shared/src/library";
import type {
  AppState,
  ScreenId,
  TimelineStyle,
  VisualizerMode,
} from "../state/types";
import { createFoldersScreen } from "./folders";
import { createLibraryScreen } from "./library";
import { createNowPlayingScreen } from "./now-playing";
import { createQueueScreen } from "./queue";
import { createSettingsScreen } from "./settings";
import { createSourcesScreen } from "./sources";

export interface ScreenContext {
  readonly state: AppState;
  readonly setAnimationsEnabled: (enabled: boolean) => boolean;
  readonly setVisualizerMode: (mode: VisualizerMode) => boolean;
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
      return createNowPlayingScreen({
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
        openSources: context.openSources,
        noteTrackCommand: context.noteTrackCommand,
        setTitle: context.setScreenTitle,
        showToast: context.showToast,
      });
    case "sources":
      return createSourcesScreen({
        api: context.foldersApi,
        libraryApi: context.libraryApi,
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
        visualizerMode: context.state.visualizerMode,
        timelineStyle: context.state.timelineStyle,
        musicBrowsingVisibility: context.state.musicBrowsingVisibility,
        returnToNowPlayingSeconds: context.state.returnToNowPlayingSeconds,
        onAnimationsChange: context.setAnimationsEnabled,
        onVisualizerModeChange: context.setVisualizerMode,
        onTimelineStyleChange: context.setTimelineStyle,
        onMusicBrowsingVisibilityChange: context.setMusicBrowsingVisibility,
        onReturnToNowPlayingSecondsChange: context.setReturnToNowPlayingSeconds,
      });
  }
}
