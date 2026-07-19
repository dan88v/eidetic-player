import { isSupportedAudioPath } from "../../../../packages/shared/src/audio";
import type { PlayerState } from "../../../../packages/shared/src/player";
import { PlayerApiClient } from "../api/player-api-client";
import { FoldersApiClient } from "../api/folders-api-client";
import { t } from "../i18n";
import { getNavigationItem } from "../navigation/routes";
import type { PlatformBridge } from "../platform";
import { runSingleAudioFileSelection } from "../platform/audio-file-selection";
import { createScreen } from "../screens";
import { disconnectedPlayerState, PlayerStore } from "../state/player-store";
import type { AppStore } from "../state/store";
import type { ScreenId } from "../state/types";
import { TrackTransitionCoordinator } from "../state/track-transition-coordinator";
import { foldersSession } from "../state/folders-session";
import {
  loadPlaybackPreferences,
  saveAnimationsEnabled,
  savePlaybackPreferences,
  saveTimelineStyle,
  saveTimelineTimeMode,
  saveVisualizerMode,
  saveMusicBrowsingVisibility,
  saveReturnToNowPlayingSeconds,
} from "../utils/storage";
import { createMiniPlayer, type MiniPlayer } from "./mini-player";
import { ArtworkPreloader } from "./artwork";
import { createQueueDrawer } from "./queue-drawer";
import { createSideMenu } from "./side-menu";
import { createTopBar } from "./top-bar";
import type { ComponentView } from "./types";
import { createVolumePopover } from "./volume-popover";

export interface MountedApp {
  destroy(): void;
}

export function mountApp(
  root: HTMLElement,
  store: AppStore,
  platform: PlatformBridge,
  initialPlayerState: PlayerState = disconnectedPlayerState,
): MountedApp {
  const api = new PlayerApiClient();
  const foldersApi = new FoldersApiClient();
  const playerStore = new PlayerStore(initialPlayerState);
  const trackTransitions = new TrackTransitionCoordinator();
  const preferences = loadPlaybackPreferences();
  const toast = document.createElement("div");
  toast.className = "app-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  const dropOverlay = document.createElement("div");
  dropOverlay.className = "drop-overlay";
  dropOverlay.innerHTML = `<strong>${t("drop.title")}</strong><span>${t("drop.description")}</span>`;
  let toastTimer = 0;
  let nativeDialogOpen = false;
  const showMessage = (message: string): void => {
    toast.textContent = message;
    toast.classList.add("app-toast--visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("app-toast--visible");
    }, 4_500);
  };
  const run = (operation: Promise<void>): void => {
    void operation.catch((error: unknown) => {
      showMessage(error instanceof Error ? error.message : t("error.generic"));
    });
  };
  const handlePaths = (paths: readonly string[]): void => {
    dropOverlay.classList.remove("drop-overlay--visible");
    const supported = paths.filter(isSupportedAudioPath);
    if (paths.length > 0 && supported.length === 0) {
      showMessage(t("error.unsupportedFiles"));
      return;
    }
    if (supported.length < paths.length)
      showMessage(t("error.someUnsupportedFiles"));
    if (supported.length > 0) {
      trackTransitions.noteTrackCommand();
      run(api.open(supported));
    }
  };
  const openFiles = (): void => {
    nativeDialogOpen = true;
    void runSingleAudioFileSelection(platform, handlePaths)
      .catch((error: unknown) => {
        showMessage(
          error instanceof Error ? error.message : t("error.nativeDialog"),
        );
      })
      .finally(() => {
        nativeDialogOpen = false;
        scheduleInactivity();
      });
  };
  const closeOverlays = (): void => {
    store.setMenuOpen(false);
    store.setQueueOpen(false);
    store.setVolumeOpen(false);
  };
  const navigate = (screen: ScreenId): void => {
    closeOverlays();
    store.setActiveScreen(screen);
  };
  const addLocalFolder = async () => {
    nativeDialogOpen = true;
    try {
      const nativePath = await platform.openFolder();
      if (!nativePath) return null;
      return await foldersApi.addLocalSource(nativePath);
    } finally {
      nativeDialogOpen = false;
      scheduleInactivity();
    }
  };

  const topBar = createTopBar(() => {
    const open = !store.getState().menuOpen;
    closeOverlays();
    store.setMenuOpen(open);
  });
  const sideMenu = createSideMenu({
    onClose: () => {
      store.setMenuOpen(false);
    },
    onNavigate: navigate,
  });
  sideMenu.setMusicBrowsingVisibility(store.getState().musicBrowsingVisibility);
  const queueDrawer = createQueueDrawer({
    onClose: () => {
      store.setQueueOpen(false);
    },
    onPlay: (index) => {
      trackTransitions.noteTrackCommand();
      run(api.playQueue(index));
    },
    onAdd: () => {
      nativeDialogOpen = true;
      void platform
        .openAudioFiles({ multiple: true })
        .then((paths) => {
          const supported = paths.filter(isSupportedAudioPath);
          if (supported.length > 0) run(api.appendQueue(supported));
        })
        .catch((error: unknown) => {
          showMessage(
            error instanceof Error ? error.message : t("error.nativeDialog"),
          );
        })
        .finally(() => {
          nativeDialogOpen = false;
          scheduleInactivity();
        });
    },
    onClear: () => {
      run(api.clearQueue());
    },
    onRemove: (queueItemId) => {
      run(api.removeQueueItem(queueItemId));
    },
  });
  const volumePopover = createVolumePopover({
    onClose: () => {
      store.setVolumeOpen(false);
    },
    onVolume: (volume) => {
      run(api.volume(volume));
    },
    onMute: (muted) => {
      run(api.mute(muted));
    },
  });
  const contentShell = document.createElement("div");
  contentShell.className = "content-shell";
  const screenRegion = document.createElement("main");
  screenRegion.className = "screen-region";
  screenRegion.id = "main-content";
  contentShell.append(screenRegion);
  root.className = "app-root";
  root.dataset.animations = String(store.getState().animationsEnabled);
  root.append(
    topBar.element,
    contentShell,
    sideMenu.backdrop,
    sideMenu.element,
    queueDrawer.backdrop,
    queueDrawer.element,
    volumePopover.backdrop,
    volumePopover.element,
    dropOverlay,
    toast,
  );
  let miniPlayer: MiniPlayer | null = null;
  const artworkPreloader = new ArtworkPreloader();
  let currentScreen: ComponentView | null = null;
  const actions = {
    openFiles,
    playPause: () => {
      run(api.playPause());
    },
    previous: () => {
      trackTransitions.noteTrackCommand();
      run(api.previous());
    },
    next: () => {
      trackTransitions.noteTrackCommand();
      run(api.next());
    },
    seek: (positionSeconds: number) => {
      run(api.seek(positionSeconds));
    },
    shuffle: (enabled: boolean) => {
      run(api.shuffle(enabled));
    },
    repeat: (mode: PlayerState["repeatMode"]) => {
      run(api.repeat(mode));
    },
  };
  function renderScreen(screen: ScreenId): void {
    currentScreen?.destroy();
    const state = store.getState();
    currentScreen = createScreen(screen, {
      state,
      playerState: playerStore.getState(),
      playerActions: actions,
      foldersApi,
      addLocalFolder,
      openFolderSource: (sourceId) => {
        foldersSession.openSource(sourceId);
        navigate("folders");
      },
      openFolderEntry: async (sourceId, entryId) => {
        trackTransitions.noteTrackCommand();
        await foldersApi.openEntry(sourceId, entryId);
      },
      playFolderDirectory: async (sourceId, relativePath) => {
        trackTransitions.noteTrackCommand();
        const result = await foldersApi.playDirectory(sourceId, relativePath);
        return result;
      },
      openSources: () => {
        navigate("sources");
      },
      removeFolderSource: (sourceId) => {
        foldersSession.removeSource(sourceId);
      },
      setAnimationsEnabled: (enabled) => {
        store.setAnimationsEnabled(enabled);
      },
      setVisualizerMode: (mode) => {
        store.setVisualizerMode(mode);
      },
      setTimelineStyle: (style) => {
        store.setTimelineStyle(style);
      },
      setTimelineTimeMode: (mode) => {
        store.setTimelineTimeMode(mode);
      },
      setMusicBrowsingVisibility: (value) => {
        store.setMusicBrowsingVisibility(value);
      },
      setReturnToNowPlayingSeconds: (value) => {
        store.setReturnToNowPlayingSeconds(value);
      },
      openQueue: (trigger) => {
        queueDrawer.setReturnFocus(trigger);
        store.setMenuOpen(false);
        store.setVolumeOpen(false);
        store.setQueueOpen(true);
      },
      openLibrary: () => {
        navigate("library");
      },
      openFolders: () => {
        navigate("folders");
      },
      toggleVolume: (trigger) => {
        const open = !store.getState().volumeOpen;
        closeOverlays();
        if (open) {
          volumePopover.setReturnFocus(trigger);
          trigger.setAttribute("aria-expanded", "true");
          store.setVolumeOpen(true);
        }
      },
    });
    screenRegion.replaceChildren(currentScreen.element);
    topBar.setTitle(t(getNavigationItem(screen).titleKey));
    sideMenu.setActiveScreen(screen);
    if (import.meta.env.DEV && screen === "nowPlaying")
      queueMicrotask(() => {
        void import("../utils/layout-diagnostics").then(
          ({ recordNowPlayingLayout }) => {
            recordNowPlayingLayout(root);
          },
        );
      });
    const showMiniPlayer = screen !== "nowPlaying";
    contentShell.classList.toggle(
      "content-shell--with-mini-player",
      showMiniPlayer,
    );
    if (showMiniPlayer && !miniPlayer) {
      miniPlayer = createMiniPlayer(
        () => {
          navigate("nowPlaying");
        },
        actions.playPause,
        actions.previous,
        actions.next,
        actions.seek,
      );
      miniPlayer.update(playerStore.getState());
      contentShell.append(miniPlayer.element);
    } else if (!showMiniPlayer && miniPlayer) {
      miniPlayer.destroy();
      miniPlayer.element.remove();
      miniPlayer = null;
    }
  }
  renderScreen(store.getState().activeScreen);
  sideMenu.setOpen(false);
  queueDrawer.setOpen(false);
  volumePopover.setOpen(false);

  let inactivityTimer = 0;
  const inactivitySuspended = (): boolean => {
    const state = store.getState();
    const active = document.activeElement;
    return (
      state.menuOpen ||
      state.queueOpen ||
      state.volumeOpen ||
      nativeDialogOpen ||
      dropOverlay.classList.contains("drop-overlay--visible") ||
      screenRegion.querySelector('[data-settings-subscreen="true"]') !== null ||
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
    );
  };
  function scheduleInactivity(): void {
    window.clearTimeout(inactivityTimer);
    const seconds = store.getState().returnToNowPlayingSeconds;
    if (seconds === 0) return;
    inactivityTimer = window.setTimeout(() => {
      if (inactivitySuspended()) {
        scheduleInactivity();
        return;
      }
      closeOverlays();
      if (store.getState().activeScreen !== "nowPlaying")
        store.setActiveScreen("nowPlaying");
    }, seconds * 1_000);
  }
  const noteActivity = (): void => {
    scheduleInactivity();
  };
  for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"])
    document.addEventListener(eventName, noteActivity, { passive: true });
  scheduleInactivity();

  const unsubscribeApp = store.subscribe((state, previousState) => {
    if (state.activeScreen !== previousState.activeScreen)
      renderScreen(state.activeScreen);
    const overlayOpen = state.menuOpen || state.queueOpen || state.volumeOpen;
    screenRegion.inert = overlayOpen;
    document.body.classList.toggle("overlay-open", overlayOpen);
    if (state.menuOpen !== previousState.menuOpen) {
      sideMenu.setOpen(state.menuOpen);
      topBar.menuButton.setAttribute("aria-expanded", String(state.menuOpen));
      topBar.menuButton.setAttribute(
        "aria-label",
        t(state.menuOpen ? "nav.closeMenu" : "nav.openMenu"),
      );
      if (state.menuOpen) sideMenu.focusInitialControl();
      else if (!state.queueOpen && !state.volumeOpen) topBar.menuButton.focus();
    }
    if (state.queueOpen !== previousState.queueOpen)
      queueDrawer.setOpen(state.queueOpen);
    if (state.volumeOpen !== previousState.volumeOpen) {
      volumePopover.setOpen(state.volumeOpen);
    }
    if (state.animationsEnabled !== previousState.animationsEnabled) {
      root.dataset.animations = String(state.animationsEnabled);
      saveAnimationsEnabled(state.animationsEnabled);
    }
    if (state.visualizerMode !== previousState.visualizerMode)
      saveVisualizerMode(state.visualizerMode);
    if (state.timelineStyle !== previousState.timelineStyle)
      saveTimelineStyle(state.timelineStyle);
    if (state.timelineTimeMode !== previousState.timelineTimeMode)
      saveTimelineTimeMode(state.timelineTimeMode);
    if (
      state.musicBrowsingVisibility !== previousState.musicBrowsingVisibility
    ) {
      saveMusicBrowsingVisibility(state.musicBrowsingVisibility);
      sideMenu.setMusicBrowsingVisibility(state.musicBrowsingVisibility);
      if (
        state.activeScreen === "folders" &&
        state.musicBrowsingVisibility === "library"
      )
        navigate("library");
      else if (
        state.activeScreen === "library" &&
        state.musicBrowsingVisibility === "folders"
      )
        navigate("folders");
    }
    if (
      state.returnToNowPlayingSeconds !==
      previousState.returnToNowPlayingSeconds
    ) {
      saveReturnToNowPlayingSeconds(state.returnToNowPlayingSeconds);
      scheduleInactivity();
    }
  });
  const unsubscribePlayer = playerStore.subscribe((state) => {
    currentScreen?.updatePlayerState?.(state);
    miniPlayer?.update(state);
    queueDrawer.update(state);
    artworkPreloader.preload([
      state.currentTrack?.artwork ?? null,
      state.queue[state.currentQueueIndex + 1]?.artwork ?? null,
      state.queue[state.currentQueueIndex - 1]?.artwork ?? null,
    ]);
    volumePopover.setState(state.volume, state.muted);
    if (state.mpvAvailable)
      savePlaybackPreferences({
        volume: state.volume,
        muted: state.muted,
        shuffleEnabled: state.shuffleEnabled,
        repeatMode: state.repeatMode,
      });
    if (state.error && state.status === "error")
      showMessage(state.error.message);
  });
  queueDrawer.update(playerStore.getState());
  const unsubscribeEvents = api.subscribe(
    (state) => {
      playerStore.setState(trackTransitions.accept(state));
    },
    () => {
      // EventSource retries automatically; the last valid state remains visible.
    },
  );
  void Promise.resolve(initialPlayerState)
    .then(async (state) => {
      if (!state.mpvAvailable) return;
      await Promise.all([
        api.volume(preferences.volume),
        api.mute(preferences.muted),
        api.shuffle(preferences.shuffleEnabled),
        api.repeat(preferences.repeatMode),
      ]);
    })
    .catch((error: unknown) => {
      showMessage(
        error instanceof Error ? error.message : t("error.backendUnavailable"),
      );
    });

  const unsubscribeDrops = platform.subscribeToDroppedFiles(handlePaths);
  const showDrop = (event: DragEvent): void => {
    event.preventDefault();
    dropOverlay.classList.add("drop-overlay--visible");
  };
  const hideDrop = (event: DragEvent): void => {
    event.preventDefault();
    if (event.type === "drop" || event.relatedTarget === null)
      dropOverlay.classList.remove("drop-overlay--visible");
  };
  window.addEventListener("dragenter", showDrop);
  window.addEventListener("dragover", showDrop);
  window.addEventListener("dragleave", hideDrop);
  window.addEventListener("drop", hideDrop);
  const handleKeydown = (event: KeyboardEvent): void => {
    const state = store.getState();
    if (state.volumeOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        store.setVolumeOpen(false);
      } else volumePopover.containFocus(event);
    } else if (state.queueOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!queueDrawer.dismissConfirmation()) store.setQueueOpen(false);
      } else queueDrawer.containFocus(event);
    } else if (state.menuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        store.setMenuOpen(false);
      } else sideMenu.containFocus(event);
    }
  };
  document.addEventListener("keydown", handleKeydown);
  return {
    destroy() {
      unsubscribeEvents();
      unsubscribeDrops();
      unsubscribePlayer();
      unsubscribeApp();
      currentScreen?.destroy();
      miniPlayer?.destroy();
      queueDrawer.destroy();
      artworkPreloader.destroy();
      topBar.destroy();
      window.clearTimeout(toastTimer);
      window.clearTimeout(inactivityTimer);
      for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"])
        document.removeEventListener(eventName, noteActivity);
      document.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("dragenter", showDrop);
      window.removeEventListener("dragover", showDrop);
      window.removeEventListener("dragleave", hideDrop);
      window.removeEventListener("drop", hideDrop);
      root.replaceChildren();
    },
  };
}
