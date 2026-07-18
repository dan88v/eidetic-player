import type { ComponentView } from "../components/types";
import type { AppStore } from "../state/store";
import type { PlayerState } from "../../../../packages/shared/src/player";
import type { PlayerActions } from "./now-playing";
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
      return staticView(createLibraryScreen());
    case "sources":
      return createSourcesScreen(
        context.playerState,
        context.playerActions.openFiles,
      );
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
