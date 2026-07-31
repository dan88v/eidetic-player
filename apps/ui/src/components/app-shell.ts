import { isSupportedAudioPath } from "../../../../packages/shared/src/audio";
import type { PlayerState } from "../../../../packages/shared/src/player";
import {
  developmentBuildInfo,
  defaultSystemCapabilities,
  type BuildInfo,
  type SystemCapabilities,
} from "../../../../packages/shared/src/system";
import type {
  IndexedLibrarySnapshot,
  RemovableDevice,
  RemovableDeviceListResponse,
} from "../../../../packages/shared/src/library";
import { PlayerApiClient } from "../api/player-api-client";
import { FoldersApiClient } from "../api/folders-api-client";
import { RemovableStorageApiClient } from "../api/removable-storage-api-client";
import { LibraryApiClient } from "../api/library-api-client";
import { NetworkApiClient } from "../api/network-api-client";
import { RemoteAccessApiClient } from "../api/remote-access-api-client";
import { SmbApiClient } from "../api/smb-api-client";
import { SystemApiClient } from "../api/system-api-client";
import { AudioOutputApiClient } from "../api/audio-output-api-client";
import { UpdateApiClient } from "../api/update-api-client";
import {
  defaultSoftwareUpdateSnapshot,
  type SoftwareUpdateSnapshot,
} from "../../../../packages/shared/src/update";
import {
  disconnectedAudioOutputState,
  type AudioOutputState,
} from "../../../../packages/shared/src/audio-output";
import {
  emptyNetworkSnapshot,
  type NetworkSnapshot,
} from "../../../../packages/shared/src/network";
import {
  emptySmbSnapshot,
  type SmbConnection,
  type SmbSnapshot,
} from "../../../../packages/shared/src/smb";
import { t } from "../i18n";
import { getNavigationItem, isSettingsRoute } from "../navigation/routes";
import type { PlatformBridge } from "../platform";
import { runSingleAudioFileSelection } from "../platform/audio-file-selection";
import { createScreen } from "../screens";
import { disconnectedPlayerState, PlayerStore } from "../state/player-store";
import type { AppStore } from "../state/store";
import type { ScreenId } from "../state/types";
import { TrackTransitionCoordinator } from "../state/track-transition-coordinator";
import { createReliableTouchScroller } from "../utils/reliable-touch-scroll";
import { foldersSession } from "../state/folders-session";
import { usbStorageSession } from "../state/folders-session";
import {
  FavoriteAlbumStore,
  FavoriteArtistStore,
  FavoriteTrackStore,
} from "../state/favorite-track-store";
import {
  loadPlaybackPreferences,
  saveAnimationsEnabled,
  saveMutedPreference,
  saveRepeatPreference,
  saveShufflePreference,
  saveTimelineStyle,
  saveTimelineTimeMode,
  saveVolumePreference,
  saveVisualizerMode,
  saveMainPlayerMode,
  saveMusicBrowsingVisibility,
  saveReturnToNowPlayingSeconds,
  saveOnScreenKeyboardMode,
} from "../utils/storage";
import { createEideticKeyboardAdapter } from "./eidetic-keyboard-adapter";
import { createMiniPlayer, type MiniPlayer } from "./mini-player";
import { ArtworkPreloader } from "./artwork";
import { createQueueDrawer } from "./queue-drawer";
import { createSideMenu } from "./side-menu";
import { createTopBar } from "./top-bar";
import { createToastHost } from "./toast-host";
import type { ComponentView } from "./types";
import { createVolumePopover } from "./volume-popover";
import { createPlaylistPicker } from "./playlist-picker";
import { createRemovableDevicePicker } from "./removable-device-picker";
import { createPowerMenu } from "./power-menu";
import type { PreferencesController } from "../state/preferences-controller";
import type { AudioProcessingState } from "../../../../packages/shared/src/audio-processing";
import {
  defaultDisplaySnapshot,
  type DisplaySnapshot,
} from "../../../../packages/shared/src/display";
import { DisplayApiClient } from "../api/display-api-client";
import { DisplayIdleController } from "../display/display-idle-controller";

export interface MountedApp {
  destroy(): void;
  showSettingsWarning(message: string): void;
}

function playbackKeepsDisplayActive(state: PlayerState): boolean {
  return (
    !state.paused && (state.status === "loading" || state.status === "playing")
  );
}

export function mountApp(
  root: HTMLElement,
  store: AppStore,
  platform: PlatformBridge,
  initialPlayerState: PlayerState = disconnectedPlayerState,
  initialAudioOutputState: AudioOutputState = disconnectedAudioOutputState,
  systemCapabilities: SystemCapabilities = defaultSystemCapabilities,
  buildInfo: BuildInfo = developmentBuildInfo,
  preferencesController?: PreferencesController,
  initialDisplaySnapshot: DisplaySnapshot = defaultDisplaySnapshot,
): MountedApp {
  const api = new PlayerApiClient();
  const foldersApi = new FoldersApiClient();
  const removableApi = new RemovableStorageApiClient();
  const libraryApi = new LibraryApiClient();
  const networkApi = new NetworkApiClient();
  const remoteAccessApi = new RemoteAccessApiClient();
  const smbApi = new SmbApiClient();
  const systemApi = new SystemApiClient();
  const audioOutputApi = new AudioOutputApiClient();
  const updateApi = new UpdateApiClient();
  const displayApi = new DisplayApiClient();
  if (systemCapabilities.hidePointerWhenInactive)
    root.dataset.pointerPolicy = "hide-when-inactive";
  const favorites = new FavoriteTrackStore(libraryApi);
  const favoriteAlbums = new FavoriteAlbumStore(libraryApi);
  const favoriteArtists = new FavoriteArtistStore(libraryApi);
  let pendingLibraryEntity: {
    readonly kind: "album" | "artist";
    readonly id: string;
  } | null = null;
  const playerStore = new PlayerStore(initialPlayerState, {
    onConfirmed: (kind, target) => {
      if (kind === "volume" && typeof target === "number") {
        saveVolumePreference(target);
        void preferencesController?.flush();
      } else if (kind === "mute" && typeof target === "boolean") {
        saveMutedPreference(target);
        void preferencesController?.flush();
      }
    },
    onFailed: () => {
      showMessage(t("playback.commandFailed"));
    },
  });
  const trackTransitions = new TrackTransitionCoordinator();
  const preferences = loadPlaybackPreferences();
  const dropOverlay = document.createElement("div");
  dropOverlay.className = "drop-overlay";
  dropOverlay.innerHTML = `<strong>${t("drop.title")}</strong><span>${t("drop.description")}</span>`;
  let nativeDialogOpen = false;
  const showMessage = (
    message: string,
    tone: "error" | "success" | "neutral" = "error",
  ): void => {
    toastHost.show(message, tone);
  };
  const run = (operation: Promise<void>): void => {
    void operation.catch((error: unknown) => {
      showMessage(error instanceof Error ? error.message : t("error.generic"));
    });
  };
  const runIntent = (
    kind: "volume" | "mute" | "transport" | "navigation",
    metadata: ReturnType<PlayerStore["beginVolumeIntent"]>,
    operation: Promise<void>,
  ): void => {
    void operation.catch(() => {
      playerStore.failIntent(kind, metadata);
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
  let currentScreen: ComponentView | null = null;
  const navigate = (screen: ScreenId): void => {
    if (
      screen !== store.getState().activeScreen &&
      currentScreen?.requestLeave?.(() => {
        navigate(screen);
      })
    )
      return;
    closeOverlays();
    store.setActiveScreen(screen);
  };
  const toastHost = createToastHost();
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
  const powerMenuRef: {
    current: ReturnType<typeof createPowerMenu> | null;
  } = { current: null };
  const sideMenu = createSideMenu({
    buildInfo,
    onClose: () => {
      store.setMenuOpen(false);
    },
    onNavigate: navigate,
    showPower: systemCapabilities.availablePowerActions.length > 0,
    onPower: (trigger) => {
      store.setMenuOpen(false);
      powerMenuRef.current?.open(trigger);
    },
  });
  sideMenu.setMusicBrowsingVisibility(store.getState().musicBrowsingVisibility);
  const playlistPicker = createPlaylistPicker({
    api: libraryApi,
    showToast: showMessage,
  });
  const removablePicker = createRemovableDevicePicker();
  const queueDrawer = createQueueDrawer({
    onClose: () => {
      store.setQueueOpen(false);
    },
    onPlay: (index, queueItemId) => {
      trackTransitions.noteTrackCommand();
      const metadata = playerStore.beginNavigationIntent(queueItemId);
      runIntent(
        "navigation",
        metadata,
        api.playQueue(index, queueItemId, metadata),
      );
    },
    onClear: () => {
      run(api.clearQueue());
    },
    onRemove: (queueItemId) => {
      run(api.removeQueueItem(queueItemId));
    },
    onReorder: (queueItemId, toIndex) => {
      return api
        .reorderQueueItem(queueItemId, toIndex)
        .catch((error: unknown) => {
          showMessage(
            error instanceof Error ? error.message : t("error.generic"),
          );
          throw error;
        });
    },
    onAddToPlaylist: (trackIds, trigger) => {
      playlistPicker.open(trackIds, trigger);
    },
  });
  const volumePopover = createVolumePopover({
    onClose: () => {
      store.setVolumeOpen(false);
    },
    onVolume: (volume) => {
      const metadata = playerStore.beginVolumeIntent(volume);
      runIntent("volume", metadata, api.volume(volume, metadata));
    },
    onVolumeCommit: () => {
      void preferencesController?.flush();
    },
    onMute: (muted) => {
      const metadata = playerStore.beginMuteIntent(muted);
      runIntent("mute", metadata, api.mute(muted, metadata));
    },
  });
  let latestAudioProcessingState: AudioProcessingState | null = null;
  const applyAudioLevelPolicy = (state: AudioProcessingState): void => {
    latestAudioProcessingState = state;
    const locked = state.preferences.outputLevelMode === "fixed";
    root.dataset.audioLevelMode = state.preferences.outputLevelMode;
    volumePopover.setPolicy(locked, state.preferences.maximumSoftwareVolume);
    for (const trigger of root.querySelectorAll<HTMLButtonElement>(
      '[data-control="volume"]',
    )) {
      trigger.hidden = locked;
      trigger.disabled = locked;
      trigger.setAttribute("aria-disabled", String(locked));
    }
    if (locked) store.setVolumeOpen(false);
  };
  const onAudioProcessing = (event: Event): void => {
    const detail = (event as CustomEvent<AudioProcessingState>).detail;
    applyAudioLevelPolicy(detail);
  };
  window.addEventListener("eidetic-audio-processing", onAudioProcessing);
  const audioLevelPolicyReady = audioOutputApi
    .processingState()
    .then((state) => {
      applyAudioLevelPolicy(state);
      return state;
    })
    .catch(() => null);
  const contentShell = document.createElement("div");
  contentShell.className = "content-shell";
  const screenRegion = document.createElement("main");
  screenRegion.className = "screen-region";
  screenRegion.id = "main-content";
  const screenTouchScroller = createReliableTouchScroller(screenRegion);
  contentShell.append(screenRegion);
  const applyingUpdate = document.createElement("section");
  applyingUpdate.className = "applying-update";
  applyingUpdate.hidden = true;
  applyingUpdate.setAttribute("role", "status");
  applyingUpdate.innerHTML =
    "<strong>Applying update…</strong><span>Eidetic Player will restart in a moment.</span>";
  const powerMenu = createPowerMenu({
    actions: systemCapabilities.availablePowerActions,
    onOpenChange: (open) => {
      root.dataset.powerOpen = String(open);
      screenRegion.inert = open;
      document.body.classList.toggle("overlay-open", open);
    },
    onAction: async (action) => {
      if (
        ["queued", "running", "activating", "restarting", "verifying"].includes(
          softwareUpdateState.job.state,
        )
      ) {
        throw new Error(
          "Power actions are unavailable while an update is in progress.",
        );
      }
      await preferencesController?.flush();
      if (
        action === "quit" ||
        action === "restart-app" ||
        action === "maintenance"
      )
        await displayController.prepareForTransition();
      await systemApi.requestPowerAction(action);
      if (action === "quit")
        await platform.quit().catch((error: unknown) => {
          console.error(
            "[platform] accepted Quit could not close the app",
            error,
          );
        });
    },
  });
  powerMenuRef.current = powerMenu;
  root.className = "app-root";
  root.dataset.animations = String(store.getState().animationsEnabled);
  root.append(
    topBar.element,
    contentShell,
    sideMenu.backdrop,
    sideMenu.element,
    queueDrawer.backdrop,
    queueDrawer.element,
    playlistPicker.backdrop,
    playlistPicker.element,
    playlistPicker.nameDialog.backdrop,
    playlistPicker.nameDialog.element,
    removablePicker.backdrop,
    removablePicker.element,
    volumePopover.backdrop,
    volumePopover.element,
    powerMenu.backdrop,
    powerMenu.element,
    applyingUpdate,
    dropOverlay,
    toastHost.element,
  );
  const keyboardAdapter = createEideticKeyboardAdapter(root, {
    mode: store.getState().onScreenKeyboardMode,
    animationsEnabled: store.getState().animationsEnabled,
  });
  let miniPlayer: MiniPlayer | null = null;
  const artworkPreloader = new ArtworkPreloader();
  let cassetteFallbackNotified = false;
  let cassetteAssetFallbackNotified = false;
  let currentLibrarySnapshot: IndexedLibrarySnapshot | null = null;
  let removableDevices: RemovableDeviceListResponse = {
    revision: 0,
    devices: [],
  };
  let selectedRemovableDevice: RemovableDevice | null = null;
  let networkSnapshot: NetworkSnapshot = emptyNetworkSnapshot;
  let audioOutputState = initialAudioOutputState;
  let smbSnapshot: SmbSnapshot = emptySmbSnapshot;
  let softwareUpdateState: SoftwareUpdateSnapshot =
    defaultSoftwareUpdateSnapshot;
  let softwareUpdateReceived = false;
  let selectedSmbConnection: SmbConnection | null = null;
  let smbReturnScreen: ScreenId = "sources";
  let usbReturnScreen: ScreenId = "nowPlaying";
  let displaySnapshot = initialDisplaySnapshot;
  const displayPreferences = preferencesController?.getPreferences();
  const displayController = new DisplayIdleController({
    root,
    api: displayApi,
    initialSnapshot: displaySnapshot,
    preferences: {
      screenDimTimeoutSeconds: displayPreferences?.screenDimTimeoutSeconds ?? 0,
      screenDimLevelPercent: displayPreferences?.screenDimLevelPercent ?? 20,
      screenStandbyTimeoutSeconds:
        displayPreferences?.screenStandbyTimeoutSeconds ?? 0,
    },
    animationsEnabled: store.getState().animationsEnabled,
    onSnapshot: (snapshot) => {
      displaySnapshot = snapshot;
      currentScreen?.updateDisplayState?.(snapshot);
    },
    onError: (message) => {
      showMessage(message, "error");
    },
  });
  displayController.setHdmiAudioActive(
    audioOutputState.selectedPhysicalOutputId === "hdmi",
  );
  displayController.setPlaybackActive(
    playbackKeepsDisplayActive(playerStore.getState()),
  );
  const actions = {
    openFiles,
    retryMpv: () => api.retryMpv(),
    playPause: () => {
      const targetPaused = !playerStore.getState().paused;
      const metadata = playerStore.beginTransportIntent(targetPaused);
      runIntent("transport", metadata, api.playPause(metadata));
    },
    previous: () => {
      trackTransitions.noteTrackCommand();
      const state = playerStore.getState();
      const pendingTarget = playerStore.pendingNavigationTarget();
      const pendingIndex =
        pendingTarget === undefined
          ? -1
          : state.queue.findIndex((item) => item.id === pendingTarget);
      const baseIndex =
        pendingIndex >= 0 ? pendingIndex : state.currentQueueIndex;
      const targetId =
        pendingTarget === undefined && state.positionSeconds > 3
          ? (state.queue[state.currentQueueIndex]?.id ?? null)
          : (state.queue[baseIndex - 1]?.id ?? null);
      const metadata = playerStore.beginNavigationIntent(targetId);
      runIntent("navigation", metadata, api.previous(targetId, metadata));
    },
    next: () => {
      trackTransitions.noteTrackCommand();
      const state = playerStore.getState();
      const pendingTarget = playerStore.pendingNavigationTarget();
      const pendingIndex =
        pendingTarget === undefined
          ? -1
          : state.queue.findIndex((item) => item.id === pendingTarget);
      const baseIndex =
        pendingIndex >= 0 ? pendingIndex : state.currentQueueIndex;
      const targetId =
        state.queue[baseIndex + 1]?.id ??
        (state.repeatMode === "all" ? (state.queue[0]?.id ?? null) : null);
      const metadata = playerStore.beginNavigationIntent(targetId);
      runIntent("navigation", metadata, api.next(targetId, metadata));
    },
    seek: (positionSeconds: number) => {
      run(api.seek(positionSeconds));
    },
    shuffle: (enabled: boolean) => {
      run(
        api.shuffle(enabled).then(() => {
          saveShufflePreference(enabled);
        }),
      );
    },
    repeat: (mode: PlayerState["repeatMode"]) => {
      run(
        api.repeat(mode).then(() => {
          saveRepeatPreference(mode);
        }),
      );
    },
  };
  const openUsbDevice = (
    device: RemovableDevice,
    returnScreen: ScreenId = store.getState().activeScreen,
  ): void => {
    selectedRemovableDevice = device;
    if (returnScreen !== "usbStorage") usbReturnScreen = returnScreen;
    usbStorageSession.openSource(device.id);
    navigate("usbStorage");
  };
  const openUsbStorage = (trigger?: HTMLElement): void => {
    const readable = removableDevices.devices.filter(
      (device) => device.readable,
    );
    if (readable.length === 0) {
      showMessage("No USB storage connected.", "neutral");
      return;
    }
    if (readable.length === 1) {
      const onlyDevice = readable[0];
      if (onlyDevice) openUsbDevice(onlyDevice);
      return;
    }
    closeOverlays();
    removablePicker.open(
      readable,
      (device) => {
        openUsbDevice(device);
      },
      trigger,
    );
  };
  const openSmbConnection = (
    connection: SmbConnection,
    returnScreen: ScreenId = store.getState().activeScreen,
  ): void => {
    if (!connection.readable) {
      showMessage("Network share is unavailable.", "neutral");
      return;
    }
    selectedSmbConnection = connection;
    if (returnScreen !== "smbBrowse") smbReturnScreen = returnScreen;
    navigate("smbBrowse");
  };
  function renderScreen(screen: ScreenId): void {
    keyboardAdapter.hide();
    currentScreen?.destroy();
    const state = store.getState();
    topBar.setDetailActions(null, null);
    topBar.setTitle(t(getNavigationItem(screen).titleKey));
    currentScreen = createScreen(screen, {
      state,
      playerState: playerStore.getState(),
      playerActions: actions,
      foldersApi,
      removableApi,
      networkApi,
      remoteAccessApi,
      networkSnapshot,
      audioOutputApi,
      audioOutputState,
      updateApi,
      softwareUpdateState,
      displaySnapshot,
      screenDimTimeoutSeconds:
        preferencesController?.getPreferences().screenDimTimeoutSeconds ?? 0,
      screenDimLevelPercent:
        preferencesController?.getPreferences().screenDimLevelPercent ?? 20,
      screenStandbyTimeoutSeconds:
        preferencesController?.getPreferences().screenStandbyTimeoutSeconds ??
        0,
      smbApi,
      smbSnapshot,
      selectedSmbConnection,
      openSmbConnection: (connection) => {
        openSmbConnection(connection, "sources");
      },
      backFromSmb: () => {
        navigate(smbReturnScreen);
      },
      openSystemNetworkSettings: () =>
        platform.openNetworkSettings
          ? platform.openNetworkSettings()
          : Promise.reject(
              new Error("Opening system settings is unavailable."),
            ),
      removableDevices,
      selectedRemovableDevice,
      openUsbStorage,
      openUsbStorageForDevice: (device) => {
        openUsbDevice(device, "sources");
      },
      backFromUsbStorage: () => {
        navigate(usbReturnScreen);
      },
      libraryApi,
      favorites,
      favoriteAlbums,
      favoriteArtists,
      initialLibraryEntity: pendingLibraryEntity,
      openLibraryEntity: (kind, id) => {
        pendingLibraryEntity = { kind, id };
        navigate("library");
      },
      librarySnapshot: currentLibrarySnapshot,
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
      noteTrackCommand: () => {
        trackTransitions.noteTrackCommand();
      },
      setScreenTitle: (title) => {
        topBar.setTitle(title);
      },
      openPlaylistPicker: (trackIds, trigger) => {
        playlistPicker.open(trackIds, trigger);
      },
      setHeaderActions: (back, more) => {
        topBar.setDetailActions(back, more);
      },
      setAnimationsEnabled: (enabled) => {
        const previous = store.getState().animationsEnabled;
        store.setAnimationsEnabled(enabled);
        if (!saveAnimationsEnabled(enabled)) {
          store.setAnimationsEnabled(previous);
          showMessage(t("settings.saveError"));
          return false;
        }
        displayController.setAnimationsEnabled(enabled);
        return true;
      },
      setVisualizerMode: (mode) => {
        const previous = store.getState().visualizerMode;
        store.setVisualizerMode(mode);
        if (!saveVisualizerMode(mode)) {
          store.setVisualizerMode(previous);
          showMessage(t("settings.saveError"));
          return false;
        }
        return true;
      },
      setMainPlayerMode: (mode) => {
        const previous = store.getState().mainPlayerMode;
        store.setMainPlayerMode(mode);
        if (!saveMainPlayerMode(mode)) {
          store.setMainPlayerMode(previous);
          showMessage(t("settings.saveError"));
          return false;
        }
        return true;
      },
      handleCassetteError: () => {
        queueMicrotask(() => {
          if (store.getState().mainPlayerMode !== "cassette") return;
          store.setMainPlayerMode("default");
          saveMainPlayerMode("default");
          if (!cassetteFallbackNotified) {
            cassetteFallbackNotified = true;
            showMessage(t("cassette.unavailable"), "neutral");
          }
        });
      },
      handleCassetteAssetError: () => {
        if (cassetteAssetFallbackNotified) return;
        cassetteAssetFallbackNotified = true;
        showMessage(t("cassette.premiumUnavailable"), "neutral");
      },
      setTimelineStyle: (style) => {
        const previous = store.getState().timelineStyle;
        store.setTimelineStyle(style);
        if (!saveTimelineStyle(style)) {
          store.setTimelineStyle(previous);
          showMessage(t("settings.saveError"));
          return false;
        }
        return true;
      },
      setTimelineTimeMode: (mode) => {
        const previous = store.getState().timelineTimeMode;
        store.setTimelineTimeMode(mode);
        if (!saveTimelineTimeMode(mode)) {
          store.setTimelineTimeMode(previous);
          showMessage(t("settings.saveError"));
          return false;
        }
        return true;
      },
      setMusicBrowsingVisibility: (value) => {
        const previous = store.getState().musicBrowsingVisibility;
        store.setMusicBrowsingVisibility(value);
        if (!saveMusicBrowsingVisibility(value)) {
          store.setMusicBrowsingVisibility(previous);
          showMessage(t("settings.saveError"));
          return false;
        }
        return true;
      },
      setReturnToNowPlayingSeconds: (value) => {
        const previous = store.getState().returnToNowPlayingSeconds;
        store.setReturnToNowPlayingSeconds(value);
        if (!saveReturnToNowPlayingSeconds(value)) {
          store.setReturnToNowPlayingSeconds(previous);
          showMessage(t("settings.saveError"));
          return false;
        }
        return true;
      },
      setOnScreenKeyboardMode: (value) => {
        const previous = store.getState().onScreenKeyboardMode;
        store.setOnScreenKeyboardMode(value);
        if (!saveOnScreenKeyboardMode(value)) {
          store.setOnScreenKeyboardMode(previous);
          showMessage(t("settings.saveError"));
          return false;
        }
        return true;
      },
      systemCapabilities,
      enterMaintenanceMode: async () => {
        closeOverlays();
        await displayController.prepareForTransition();
        await api.pause().catch(() => undefined);
        await systemApi.enterMaintenanceMode();
      },
      setDisplayPreferences: (changes) => {
        const current = preferencesController?.getPreferences();
        if (!current) return false;
        preferencesController?.update(changes);
        displayController.updatePreferences({
          screenDimTimeoutSeconds:
            changes.screenDimTimeoutSeconds ?? current.screenDimTimeoutSeconds,
          screenDimLevelPercent:
            changes.screenDimLevelPercent ?? current.screenDimLevelPercent,
          screenStandbyTimeoutSeconds:
            changes.screenStandbyTimeoutSeconds ??
            current.screenStandbyTimeoutSeconds,
        });
        return true;
      },
      testDisplayDim: () => displayController.testDim(),
      testDisplayStandby: () => displayController.testStandby(),
      showToast: (message, tone = "neutral") => {
        showMessage(message, tone);
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
    if (screen === "library") pendingLibraryEntity = null;
    screenRegion.replaceChildren(currentScreen.element);
    if (latestAudioProcessingState)
      applyAudioLevelPolicy(latestAudioProcessingState);
    sideMenu.setActiveScreen(screen);
    if (import.meta.env.DEV && screen === "nowPlaying")
      queueMicrotask(() => {
        void import("../utils/layout-diagnostics").then(
          ({ recordNowPlayingLayout }) => {
            recordNowPlayingLayout(root);
          },
        );
      });
    const showMiniPlayer =
      screen !== "nowPlaying" || state.mainPlayerMode === "cassette";
    contentShell.classList.toggle(
      "content-shell--with-mini-player",
      showMiniPlayer,
    );
    root.classList.toggle("app-root--with-mini-player", showMiniPlayer);
    if (showMiniPlayer && !miniPlayer) {
      miniPlayer = createMiniPlayer(
        () => {
          navigate("nowPlaying");
        },
        actions.playPause,
        actions.previous,
        actions.next,
        actions.seek,
        (positionSeconds) => {
          currentScreen?.updateSeekPreview?.(positionSeconds);
        },
        favorites,
      );
      miniPlayer.update(playerStore.getState());
      miniPlayer.setSurfaceDisabled(
        state.mainPlayerMode === "cassette" &&
          playerStore.getState().queue.length === 0,
      );
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
      root.dataset.keyboardOpen === "true" ||
      screenRegion.querySelector('[data-settings-subscreen="true"]') !== null ||
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
    );
  };
  function scheduleInactivity(): void {
    window.clearTimeout(inactivityTimer);
    inactivityTimer = 0;
    const seconds = store.getState().returnToNowPlayingSeconds;
    const activeScreen = store.getState().activeScreen;
    if (
      seconds === 0 ||
      activeScreen === "nowPlaying" ||
      isSettingsRoute(activeScreen)
    )
      return;
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
  let pointerTimer = 0;
  const revealPointer = (): void => {
    if (!systemCapabilities.hidePointerWhenInactive) return;
    root.classList.remove("app-root--pointer-hidden");
    window.clearTimeout(pointerTimer);
    pointerTimer = window.setTimeout(() => {
      root.classList.add("app-root--pointer-hidden");
    }, 2_500);
  };
  document.addEventListener("pointermove", revealPointer, { passive: true });
  revealPointer();
  scheduleInactivity();

  let recoveryNoticeHandled = false;
  let favoriteCatalogGeneration = "";
  let appDestroyed = false;
  const receiveRemovableDevices = (
    snapshot: RemovableDeviceListResponse,
  ): void => {
    if (appDestroyed || snapshot.revision < removableDevices.revision) return;
    const previousIds = new Set(
      removableDevices.devices.map((device) => device.id),
    );
    const currentQueueItem =
      playerStore.getState().queue[playerStore.getState().currentQueueIndex];
    const disconnectedDeviceIds = [...previousIds].filter(
      (deviceId) => !snapshot.devices.some((device) => device.id === deviceId),
    );
    const disconnectedCurrent =
      disconnectedDeviceIds.some((deviceId) =>
        currentQueueItem?.path.startsWith(`removable://${deviceId}/`),
      ) ||
      (disconnectedDeviceIds.length > 0 &&
        currentQueueItem?.path.startsWith("library-source://"));
    removableDevices = snapshot;
    if (selectedRemovableDevice) {
      selectedRemovableDevice =
        snapshot.devices.find(
          (device) => device.id === selectedRemovableDevice?.id,
        ) ?? selectedRemovableDevice;
    }
    currentScreen?.updateRemovableDevices?.(snapshot);
    if (removablePicker.update(snapshot.devices))
      showMessage("No USB storage connected.", "neutral");
    if (disconnectedCurrent)
      showMessage("USB storage disconnected.", "neutral");
  };
  let unsubscribeRemovable = (): void => undefined;
  void removableApi
    .devices()
    .then(receiveRemovableDevices)
    .catch((error: unknown) => {
      console.warn("[removable-storage] initial snapshot unavailable", error);
    })
    .finally(() => {
      if (appDestroyed) return;
      unsubscribeRemovable = removableApi.subscribe(
        receiveRemovableDevices,
        () => {
          // EventSource reconnects automatically; the last snapshot remains.
        },
      );
    });
  let networkRecoveryNoticeShown = false;
  const receiveNetworkSnapshot = (snapshot: NetworkSnapshot): void => {
    if (appDestroyed || snapshot.revision < networkSnapshot.revision) return;
    networkSnapshot = snapshot;
    topBar.updateNetwork(snapshot);
    currentScreen?.updateNetworkSnapshot?.(snapshot);
    if (
      !networkRecoveryNoticeShown &&
      snapshot.configurationTransaction?.state === "recovery-required"
    ) {
      networkRecoveryNoticeShown = true;
      showMessage(
        "Network recovery requires attention. Open Settings → Network.",
        "error",
      );
    }
  };
  let unsubscribeNetwork = (): void => undefined;
  void networkApi
    .state()
    .then(receiveNetworkSnapshot)
    .catch((error: unknown) => {
      console.warn("[network] initial snapshot unavailable", error);
    })
    .finally(() => {
      if (appDestroyed) return;
      unsubscribeNetwork = networkApi.subscribe(receiveNetworkSnapshot, () => {
        // EventSource reconnects automatically; the last snapshot remains.
      });
    });
  const receiveSoftwareUpdate = (snapshot: SoftwareUpdateSnapshot): void => {
    if (appDestroyed) return;
    const previousState = softwareUpdateState.job.state;
    const previousActive = [
      "queued",
      "running",
      "activating",
      "restarting",
      "verifying",
    ].includes(previousState);
    const completedAt = snapshot.job.completedAt
      ? Date.parse(snapshot.job.completedAt)
      : Number.NaN;
    const recentTerminal =
      !softwareUpdateReceived &&
      Number.isFinite(completedAt) &&
      Date.now() - completedAt >= 0 &&
      Date.now() - completedAt <= 5 * 60_000;
    softwareUpdateReceived = true;
    softwareUpdateState = snapshot;
    displayController.setInhibited(
      ["queued", "running", "activating", "restarting", "verifying"].includes(
        snapshot.job.state,
      ),
    );
    topBar.updateSoftwareUpdate(snapshot);
    currentScreen?.updateSoftwareUpdateState?.(snapshot);
    const applying = ["activating", "restarting"].includes(snapshot.job.state);
    applyingUpdate.hidden = !applying;
    applyingUpdate.inert = !applying;
    if (applying && !["activating", "restarting"].includes(previousState)) {
      closeOverlays();
      void preferencesController?.flush();
    }
    if (
      (previousActive || recentTerminal) &&
      previousState !== snapshot.job.state &&
      snapshot.job.state === "succeeded"
    )
      showMessage(
        `Update completed. Build ${snapshot.job.targetCommitSha?.slice(0, 7) ?? "verified"}.`,
        "success",
      );
    if (
      (previousActive || recentTerminal) &&
      previousState !== snapshot.job.state
    ) {
      if (snapshot.job.state === "rolled-back")
        showMessage(
          "Update failed. The previous build was restored and verified.",
          "error",
        );
      else if (snapshot.job.state === "interrupted")
        showMessage(
          "Update interrupted. Check Software update before trying again.",
          "error",
        );
      else if (snapshot.job.state === "failed")
        showMessage(
          snapshot.job.rollback === "failed"
            ? "Update failed and automatic recovery could not be verified."
            : "Update failed before activation.",
          "error",
        );
    }
  };
  topBar.updateSoftwareUpdate(softwareUpdateState);
  let unsubscribeSoftwareUpdate = (): void => undefined;
  void updateApi
    .state()
    .then(receiveSoftwareUpdate)
    .catch((error: unknown) => {
      console.warn("[software-update] initial snapshot unavailable", error);
    })
    .finally(() => {
      if (appDestroyed) return;
      unsubscribeSoftwareUpdate = updateApi.subscribe(
        receiveSoftwareUpdate,
        () => {
          // EventSource reconnects after the expected backend restart.
        },
      );
    });
  let lastAudioOutputNoticeRevision = audioOutputState.noticeRevision;
  const receiveAudioOutputState = (snapshot: AudioOutputState): void => {
    if (appDestroyed || snapshot.revision < audioOutputState.revision) return;
    audioOutputState = snapshot;
    displayController.setHdmiAudioActive(
      snapshot.selectedPhysicalOutputId === "hdmi",
    );
    topBar.updateAudioOutput(snapshot);
    currentScreen?.updateAudioOutputState?.(snapshot);
    if (snapshot.noticeRevision > lastAudioOutputNoticeRevision) {
      lastAudioOutputNoticeRevision = snapshot.noticeRevision;
      if (snapshot.notice === "preferred-unavailable")
        showMessage(
          "Preferred audio output unavailable. Using System default.",
          "neutral",
        );
    }
  };
  topBar.updateAudioOutput(audioOutputState);
  const receiveSmbSnapshot = (snapshot: SmbSnapshot): void => {
    if (appDestroyed || snapshot.revision < smbSnapshot.revision) return;
    const previouslyReadable = new Set(
      smbSnapshot.connections
        .filter((connection) => connection.readable)
        .map((connection) => connection.id),
    );
    const disconnected = snapshot.connections.filter(
      (connection) =>
        previouslyReadable.has(connection.id) && !connection.readable,
    );
    const current =
      playerStore.getState().queue[playerStore.getState().currentQueueIndex];
    smbSnapshot = snapshot;
    if (selectedSmbConnection) {
      selectedSmbConnection =
        snapshot.connections.find(
          (connection) => connection.id === selectedSmbConnection?.id,
        ) ?? selectedSmbConnection;
    }
    topBar.updateSmb(snapshot);
    currentScreen?.updateSmbSnapshot?.(snapshot);
    if (
      disconnected.some((connection) =>
        current?.path.startsWith(`smb://${connection.id}/`),
      )
    )
      showMessage("Network share disconnected.", "neutral");
  };
  let unsubscribeSmb = (): void => undefined;
  void smbApi
    .connections()
    .then(receiveSmbSnapshot)
    .catch((error: unknown) => {
      console.warn("[smb] initial snapshot unavailable", error);
    })
    .finally(() => {
      if (appDestroyed) return;
      unsubscribeSmb = smbApi.subscribe(receiveSmbSnapshot, () => {
        // EventSource reconnects automatically; the last snapshot remains.
      });
    });
  const receiveLibrarySnapshot = (snapshot: IndexedLibrarySnapshot): void => {
    if (appDestroyed) return;
    currentLibrarySnapshot = snapshot;
    const completed = snapshot.status.latestScan;
    const nextFavoriteCatalogGeneration =
      completed?.status === "completed"
        ? `${completed.sourceId}:${String(completed.generation)}`
        : favoriteCatalogGeneration;
    if (
      favoriteCatalogGeneration !== "" &&
      nextFavoriteCatalogGeneration !== favoriteCatalogGeneration
    ) {
      favorites.invalidate();
      favoriteAlbums.invalidate();
      favoriteArtists.invalidate();
    }
    favoriteCatalogGeneration = nextFavoriteCatalogGeneration;
    toastHost.updateLibrary(snapshot);
    currentScreen?.updateLibrarySnapshot?.(snapshot);
    if (
      !recoveryNoticeHandled &&
      snapshot.status.recoveryNotice === "database-rebuilt"
    ) {
      recoveryNoticeHandled = true;
      showMessage(t("library.databaseRebuilt"), "neutral");
      void libraryApi.acknowledgeRecovery().catch((error: unknown) => {
        console.warn("[library] recovery acknowledgement failed", error);
      });
    }
  };
  let unsubscribeLibrary = (): void => undefined;
  void libraryApi
    .snapshot()
    .then(receiveLibrarySnapshot)
    .catch((error: unknown) => {
      console.warn("[library] initial snapshot unavailable", error);
    })
    .finally(() => {
      if (appDestroyed) return;
      unsubscribeLibrary = libraryApi.subscribe(receiveLibrarySnapshot, () => {
        // EventSource reconnects automatically; the last snapshot remains.
      });
    });

  const unsubscribeApp = store.subscribe((state, previousState) => {
    if (
      state.activeScreen !== previousState.activeScreen ||
      (state.activeScreen === "nowPlaying" &&
        (state.mainPlayerMode !== previousState.mainPlayerMode ||
          state.animationsEnabled !== previousState.animationsEnabled))
    ) {
      renderScreen(state.activeScreen);
      scheduleInactivity();
    }
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
      keyboardAdapter.setAnimationsEnabled(state.animationsEnabled);
    }
    if (state.onScreenKeyboardMode !== previousState.onScreenKeyboardMode)
      keyboardAdapter.setMode(state.onScreenKeyboardMode);
    if (
      state.musicBrowsingVisibility !== previousState.musicBrowsingVisibility
    ) {
      sideMenu.setMusicBrowsingVisibility(state.musicBrowsingVisibility);
      if (
        state.activeScreen === "folders" &&
        state.musicBrowsingVisibility === "library"
      )
        navigate("library");
      else if (
        (state.activeScreen === "library" ||
          state.activeScreen === "favorites" ||
          state.activeScreen === "recentlyPlayed") &&
        state.musicBrowsingVisibility === "folders"
      )
        navigate("folders");
    }
    if (
      state.returnToNowPlayingSeconds !==
      previousState.returnToNowPlayingSeconds
    ) {
      scheduleInactivity();
    }
  });
  const unsubscribePlayer = playerStore.subscribe((state) => {
    displayController.setPlaybackActive(playbackKeepsDisplayActive(state));
    currentScreen?.updatePlayerState?.(state);
    miniPlayer?.update(state);
    miniPlayer?.setSurfaceDisabled(
      store.getState().activeScreen === "nowPlaying" &&
        store.getState().mainPlayerMode === "cassette" &&
        state.queue.length === 0,
    );
    queueDrawer.update(state);
    artworkPreloader.preload([
      state.currentTrack?.artwork ?? null,
      state.queue[state.currentQueueIndex + 1]?.artwork ?? null,
      state.queue[state.currentQueueIndex - 1]?.artwork ?? null,
    ]);
    volumePopover.setState(state.volume, state.muted);
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
    receiveAudioOutputState,
    (state) => {
      remoteAccessApi.receiveState(state);
    },
  );
  void Promise.resolve(initialPlayerState)
    .then(async (state) => {
      if (!state.mpvAvailable) return;
      const processingState = await audioLevelPolicyReady;
      const variableLevelCommands =
        processingState?.preferences.outputLevelMode === "fixed"
          ? []
          : [api.volume(preferences.volume), api.mute(preferences.muted)];
      await Promise.all([
        ...variableLevelCommands,
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
    if (powerMenu.handleKeydown(event)) return;
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
    showSettingsWarning(message) {
      showMessage(message, "error");
    },
    destroy() {
      appDestroyed = true;
      unsubscribeEvents();
      unsubscribeLibrary();
      unsubscribeRemovable();
      unsubscribeNetwork();
      unsubscribeSmb();
      unsubscribeSoftwareUpdate();
      unsubscribeDrops();
      unsubscribePlayer();
      unsubscribeApp();
      currentScreen?.destroy();
      miniPlayer?.destroy();
      queueDrawer.destroy();
      sideMenu.destroy();
      powerMenu.destroy();
      playlistPicker.destroy();
      removablePicker.destroy();
      artworkPreloader.destroy();
      topBar.destroy();
      toastHost.destroy();
      keyboardAdapter.destroy();
      screenTouchScroller.destroy();
      preferencesController?.destroy();
      displayController.destroy();
      window.removeEventListener("eidetic-audio-processing", onAudioProcessing);
      window.clearTimeout(inactivityTimer);
      window.clearTimeout(pointerTimer);
      for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"])
        document.removeEventListener(eventName, noteActivity);
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("pointermove", revealPointer);
      window.removeEventListener("dragenter", showDrop);
      window.removeEventListener("dragover", showDrop);
      window.removeEventListener("dragleave", hideDrop);
      window.removeEventListener("drop", hideDrop);
      root.replaceChildren();
    },
  };
}
