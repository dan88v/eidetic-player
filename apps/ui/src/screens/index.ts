import type { ComponentView } from "../components/types";
import type { AppStore } from "../state/store";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type { PlayerActions } from "./now-playing";
import type { LibraryApiClient } from "../api/library-api-client";
import type { AddLocalSourceResponse } from "../../../../packages/shared/src/library";
import type {
  AppState,
  ScreenId,
  TimelineStyle,
  VisualizerMode,
} from "../state/types";
import { createLibraryScreen } from "./library";
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
  readonly openQueue: (trigger: HTMLButtonElement) => void;
  readonly openLibrary: () => void;
  readonly toggleVolume: (trigger: HTMLButtonElement) => void;
  readonly playerState: PlayerState;
  readonly playerActions: PlayerActions;
  readonly libraryApi: LibraryApiClient;
  readonly addLocalFolder: () => Promise<AddLocalSourceResponse | null>;
  readonly openLibrarySource: (sourceId: string) => void;
  readonly openLibraryEntry: (
    sourceId: string,
    entryId: string,
  ) => Promise<void>;
  readonly removeLibrarySource: (sourceId: string) => void;
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
        timelineTimeMode: context.state.timelineTimeMode,
        onVisualizerModeChange: context.setVisualizerMode,
        onTimelineTimeModeChange: context.setTimelineTimeMode,
        onOpenQueue: context.openQueue,
        onOpenLibrary: context.openLibrary,
        onToggleVolume: context.toggleVolume,
        initialPlayerState: context.playerState,
        actions: context.playerActions,
      });
    case "library":
      return createLibraryScreen({
        api: context.libraryApi,
        addFolder: context.addLocalFolder,
        openEntry: context.openLibraryEntry,
        initialPlayerState: context.playerState,
      });
    case "sources":
      return createSourcesScreen({
        api: context.libraryApi,
        addFolder: context.addLocalFolder,
        openSource: context.openLibrarySource,
        onSourceRemoved: context.removeLibrarySource,
      });
    case "queue":
      return staticView(createQueueScreen());
    case "settings":
      return createSettingsScreen({
        animationsEnabled: context.state.animationsEnabled,
        visualizerMode: context.state.visualizerMode,
        timelineStyle: context.state.timelineStyle,
        onAnimationsChange: context.setAnimationsEnabled,
        onVisualizerModeChange: context.setVisualizerMode,
        onTimelineStyleChange: context.setTimelineStyle,
      });
  }
}
