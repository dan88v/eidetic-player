import "./styles/index.css";
import { mountApp } from "./components/app-shell";
import { config } from "./config";
import { t } from "./i18n";
import { initializePlatform } from "./platform";
import { createAppStore } from "./state/store";
import {
  loadAnimationsEnabled,
  loadTimelineStyle,
  loadTimelineTimeMode,
  loadVisualizerMode,
  loadMainPlayerMode,
  loadMusicBrowsingVisibility,
  loadReturnToNowPlayingSeconds,
  loadOnScreenKeyboardMode,
} from "./utils/storage";
import { correctInitialViewportOnce } from "./utils/viewport";
import { PlayerApiClient } from "./api/player-api-client";
import { disconnectedPlayerState } from "./state/player-store";

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

  const animationsEnabled = loadAnimationsEnabled();
  const immediateSplash = document.querySelector<HTMLElement>("#app-splash");
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-accent")
    .trim();
  if (immediateSplash && accent)
    immediateSplash.style.setProperty("--color-accent", accent);
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (!animationsEnabled || reducedMotion)
    immediateSplash?.setAttribute("data-motion", "reduced");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, 5_000);
  let playerState = disconnectedPlayerState;
  try {
    playerState = await new PlayerApiClient().bootstrap(controller.signal);
  } catch (error) {
    console.error("[bootstrap] backend initialization failed", error);
  } finally {
    window.clearTimeout(timeout);
  }
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
    visualizerMode: loadVisualizerMode(),
    mainPlayerMode: loadMainPlayerMode(),
    timelineStyle: loadTimelineStyle(),
    timelineTimeMode: loadTimelineTimeMode(),
    musicBrowsingVisibility: loadMusicBrowsingVisibility(),
    returnToNowPlayingSeconds: loadReturnToNowPlayingSeconds(),
    onScreenKeyboardMode: loadOnScreenKeyboardMode(),
  });
  const app = mountApp(root, store, platform.bridge, playerState);
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
  window.addEventListener(
    "beforeunload",
    () => {
      app.destroy();
    },
    { once: true },
  );
  window.setTimeout(() => {
    correctInitialViewportOnce(config);
  }, 0);
}

void bootstrap();
