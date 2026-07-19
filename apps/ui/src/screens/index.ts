import type { ComponentView } from "../components/types";
import type { AppStore } from "../state/store";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type { PlayerActions } from "./now-playing";
import type { FoldersApiClient } from "../api/folders-api-client";
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
import { createPlaceholderScreen } from "./placeholder";
import { t } from "../i18n";
import { createNowPlayingScreen } from "./now-playing";
import { createQueueScreen } from "./queue";
import { createSettingsScreen } from "./settings";
import { createSourcesScreen } from "./sources";

export interface ScreenContext {
  readonly state: AppState;
  readonly setAnimationsEnabled: (enabled: boolean) => void;
  readonly setVisualizerMode: (mode: VisualizerMode) => void;
  readonly setTimelineStyle: (style: TimelineStyle) => void;
  readonly setTimelineTimeMode: AppStore["setTimelineTimeMode"];
  readonly setMusicBrowsingVisibility: AppStore["setMusicBrowsingVisibility"];
  readonly setReturnToNowPlayingSeconds: AppStore["setReturnToNowPlayingSeconds"];
  readonly openQueue: (trigger: HTMLButtonElement) => void;
  readonly openLibrary: () => void;
  readonly openFolders: () => void;
  readonly toggleVolume: (trigger: HTMLButtonElement) => void;
  readonly playerState: PlayerState;
  readonly playerActions: PlayerActions;
  readonly foldersApi: FoldersApiClient;
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
      });
    case "library":
      return staticView(
        createPlaceholderScreen(
          t("screen.library.title"),
          t("screen.library.description"),
          "library",
        ),
      );
    case "sources":
      return createSourcesScreen({
        api: context.foldersApi,
        addFolder: context.addLocalFolder,
        openSource: context.openFolderSource,
        onSourceRemoved: context.removeFolderSource,
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
