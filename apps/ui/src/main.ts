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
} from "./utils/storage";
import { correctInitialViewportOnce } from "./utils/viewport";

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
}

async function bootstrap(): Promise<void> {
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

  const store = createAppStore({
    activeScreen: "nowPlaying",
    menuOpen: false,
    queueOpen: false,
    volumeOpen: false,
    animationsEnabled: loadAnimationsEnabled(),
    visualizerMode: loadVisualizerMode(),
    timelineStyle: loadTimelineStyle(),
    timelineTimeMode: loadTimelineTimeMode(),
  });
  const app = mountApp(root, store, platform.bridge);
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
