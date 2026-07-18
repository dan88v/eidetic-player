import type {
  AppState,
  ScreenId,
  TimelineStyle,
  TimelineTimeMode,
  VisualizerMode,
} from "./types";

type StateListener = (state: AppState, previousState: AppState) => void;

export interface AppStore {
  getState(): AppState;
  setActiveScreen(screen: ScreenId): void;
  setMenuOpen(open: boolean): void;
  setQueueOpen(open: boolean): void;
  setVolumeOpen(open: boolean): void;
  setAnimationsEnabled(enabled: boolean): void;
  setVisualizerMode(mode: VisualizerMode): void;
  setTimelineStyle(style: TimelineStyle): void;
  setTimelineTimeMode(mode: TimelineTimeMode): void;
  subscribe(listener: StateListener): () => void;
}

export function createAppStore(initialState: AppState): AppStore {
  let state = Object.freeze({ ...initialState });
  const listeners = new Set<StateListener>();

  function update(patch: Partial<AppState>): void {
    const nextState = Object.freeze({ ...state, ...patch });
    if (
      nextState.activeScreen === state.activeScreen &&
      nextState.menuOpen === state.menuOpen &&
      nextState.queueOpen === state.queueOpen &&
      nextState.volumeOpen === state.volumeOpen &&
      nextState.animationsEnabled === state.animationsEnabled &&
      nextState.visualizerMode === state.visualizerMode &&
      nextState.timelineStyle === state.timelineStyle &&
      nextState.timelineTimeMode === state.timelineTimeMode
    ) {
      return;
    }

    const previousState = state;
    state = nextState;
    for (const listener of listeners) listener(state, previousState);
  }

  return {
    getState: () => state,
    setActiveScreen: (activeScreen) => {
      update({ activeScreen });
    },
    setMenuOpen: (menuOpen) => {
      update({ menuOpen });
    },
    setQueueOpen: (queueOpen) => {
      update({ queueOpen });
    },
    setVolumeOpen: (volumeOpen) => {
      update({ volumeOpen });
    },
    setAnimationsEnabled: (animationsEnabled) => {
      update({ animationsEnabled });
    },
    setVisualizerMode: (visualizerMode) => {
      update({ visualizerMode });
    },
    setTimelineStyle: (timelineStyle) => {
      update({ timelineStyle });
    },
    setTimelineTimeMode: (timelineTimeMode) => {
      update({ timelineTimeMode });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
