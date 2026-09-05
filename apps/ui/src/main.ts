import "./styles/index.css";
import { mountApp, type MountedApp } from "./components/app-shell";
import { config } from "./config";
import { t } from "./i18n";
import { initializePlatform } from "./platform";
import { createAppStore } from "./state/store";
import {
  initializePreferenceStorage,
  readLegacyPreferences,
} from "./utils/storage";
import { correctInitialViewportOnce } from "./utils/viewport";
import { PlayerApiClient } from "./api/player-api-client";
import { disconnectedPlayerState } from "./state/player-store";
import {
  defaultSystemCapabilities,
  developmentBuildInfo,
} from "../../../packages/shared/src/system";
import { disconnectedAudioOutputState } from "../../../packages/shared/src/audio-output";
import {
  defaultUiPreferences,
  type PreferencesSnapshot,
} from "../../../packages/shared/src/preferences";
import { PreferencesApiClient } from "./api/preferences-api-client";
import { PreferencesController } from "./state/preferences-controller";
import { loadAuthoritativeBootstrap } from "./bootstrap/backend-bootstrap";
import { defaultDisplaySnapshot } from "../../../packages/shared/src/display";
import {
  defaultPlaybackSourceSnapshot,
  type PlaybackSourceSnapshot,
} from "../../../packages/shared/src/playback-source";
import { startupSettingsWarning } from "./preferences/startup-settings-warning";

const applicationRoot = document.querySelector<HTMLElement>("#app");
if (!applicationRoot) throw new Error("Application root is missing");
const root = applicationRoot;

function showPlatformInitializationError(error: unknown): void {
  console.error("[platform] Neutralino initialization failed", error);
  root.className = "app-root platform-initialization-error";
  const heading = document.createElement("h1");
  heading.textContent = t("platform.initializationErrorTitle");
  const description = document.createElement("p");
  description.textContent = t("platform.initializationErrorDescription");
  root.replaceChildren(heading, description);
  document.querySelector("#app-splash")?.remove();
}

async function bootstrap(): Promise<void> {
  const startedAt = performance.now();
  document.title = config.appName;
  let platform;
  try {
    platform = await initializePlatform();
  } catch (error) {
    showPlatformInitializationError(error);
    return;
  }
  if (config.development) {
    const { platformBridge, nlMode, neutralinoAvailable, openDialogAvailable } =
      platform.diagnostics;
    console.info("[platform]", {
      platformBridge,
      nlMode,
      neutralinoAvailable,
      openDialogAvailable,
    });
  }

  const immediateSplash = document.querySelector<HTMLElement>("#app-splash");
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-accent")
    .trim();
  if (immediateSplash && accent)
    immediateSplash.style.setProperty("--color-accent", accent);
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  let playerState = disconnectedPlayerState;
  let audioOutputState = disconnectedAudioOutputState;
  let systemCapabilities = defaultSystemCapabilities;
  let buildInfo = developmentBuildInfo;
  let preferencesSnapshot: PreferencesSnapshot = {
    schemaVersion: 4,
    revision: 0,
    preferences: defaultUiPreferences,
    persistence: "degraded",
    legacyImport: "manual-required",
    warning: true,
  };
  let displaySnapshot = defaultDisplaySnapshot;
  let playbackSourceSnapshot: PlaybackSourceSnapshot =
    defaultPlaybackSourceSnapshot;
  let migrationFailed = false;
  let legacyMigrationAttempted = false;
  let bootstrapAvailable = false;
  const preferencesApi = new PreferencesApiClient();
  const playerApi = new PlayerApiClient();
  try {
    const initial = config.development
      ? await playerApi.bootstrap(AbortSignal.timeout(5_000))
      : await loadAuthoritativeBootstrap(
          (signal) => playerApi.bootstrap(signal),
          {
            onFailure: (error, attempt) => {
              console.error(
                `[bootstrap] backend initialization attempt ${String(attempt)} failed`,
                error,
              );
              immediateSplash?.setAttribute(
                "aria-label",
                "Connecting to Eidetic Player",
              );
            },
          },
        );
    bootstrapAvailable = true;
    playerState = initial.playerState;
    audioOutputState = initial.audioOutput;
    systemCapabilities = initial.system;
    buildInfo = initial.buildInfo;
    preferencesSnapshot = initial.preferences;
    displaySnapshot = initial.display;
    playbackSourceSnapshot = initial.playbackSource;
    if (preferencesSnapshot.legacyImport === "required") {
      legacyMigrationAttempted = true;
      const legacy = readLegacyPreferences();
      try {
        preferencesSnapshot = await preferencesApi.migrateLegacy(
          {
            preferences: legacy.preferences,
            sourceAvailable: legacy.sourceAvailable,
          },
          AbortSignal.timeout(5_000),
        );
      } catch (error) {
        migrationFailed = true;
        console.error("[preferences] legacy import failed", error);
      }
    }
  } catch (error) {
    console.error("[bootstrap] backend initialization failed", error);
  }
  if (!config.development && !bootstrapAvailable) return;
  let mountedApp: MountedApp | null = null;
  const preferencesController = new PreferencesController(
    preferencesSnapshot,
    preferencesApi,
    {
      onWarning: () => {
        mountedApp?.showSettingsWarning(t("settings.persistenceWarning"));
      },
    },
  );
  initializePreferenceStorage(
    preferencesSnapshot.preferences,
    preferencesController,
  );
  const animationsEnabled = preferencesSnapshot.preferences.animationsEnabled;
  if (!animationsEnabled || reducedMotion)
    immediateSplash?.setAttribute("data-motion", "reduced");
  const minimumRemaining = 700 - (performance.now() - startedAt);
  if (minimumRemaining > 0)
    await new Promise<void>((resolve) =>
      window.setTimeout(resolve, minimumRemaining),
    );

  const store = createAppStore({
    activeScreen: "nowPlaying",
    menuOpen: false,
    queueOpen: false,
    volumeOpen: false,
    animationsEnabled,
    visualizerMode: preferencesSnapshot.preferences.visualizerMode,
    mainPlayerMode: preferencesSnapshot.preferences.mainPlayerMode,
    timelineStyle: preferencesSnapshot.preferences.timelineStyle,
    timelineTimeMode: preferencesSnapshot.preferences.timelineTimeMode,
    musicBrowsingVisibility:
      preferencesSnapshot.preferences.musicBrowsingVisibility,
    returnToNowPlayingSeconds:
      preferencesSnapshot.preferences.returnToNowPlayingSeconds,
    onScreenKeyboardMode: preferencesSnapshot.preferences.onScreenKeyboardMode,
  });
  mountedApp = mountApp(
    root,
    store,
    platform.bridge,
    playerState,
    audioOutputState,
    systemCapabilities,
    buildInfo,
    preferencesController,
    displaySnapshot,
    playbackSourceSnapshot,
  );
  const settingsWarning = startupSettingsWarning(
    preferencesSnapshot,
    legacyMigrationAttempted,
    migrationFailed,
  );
  if (settingsWarning === "migration")
    mountedApp.showSettingsWarning(t("settings.migrationWarning"));
  else if (settingsWarning === "persistence")
    mountedApp.showSettingsWarning(t("settings.persistenceWarning"));
  const splash = document.querySelector<HTMLElement>("#app-splash");
  if (splash) {
    if (!animationsEnabled || reducedMotion) {
      splash.style.transition = "none";
      splash.dataset.motion = "reduced";
    }
    splash.setAttribute("aria-hidden", "true");
    const remove = () => {
      splash.remove();
    };
    if (!animationsEnabled || reducedMotion) remove();
    else window.setTimeout(remove, 160);
  }
  const flushPreferences = (): void => {
    void preferencesController.flush();
  };
  const handleVisibility = (): void => {
    if (document.visibilityState === "hidden") flushPreferences();
  };
  window.addEventListener("pagehide", flushPreferences);
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener(
    "beforeunload",
    () => {
      flushPreferences();
      mountedApp.destroy();
    },
    { once: true },
  );
  window.setTimeout(() => {
    correctInitialViewportOnce(config);
  }, 0);
}

void bootstrap();
