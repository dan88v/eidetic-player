import type { ComponentView } from "../components/types";
import { createCassetteMainPlayer } from "../cassette/cassette-main-player";
import {
  createNowPlayingScreen,
  type NowPlayingOptions,
} from "../screens/now-playing";
import type { MainPlayerMode } from "../state/types";

export interface MainPlayerHostOptions extends NowPlayingOptions {
  readonly mode: MainPlayerMode;
  readonly animationsEnabled: boolean;
  readonly onCassetteError: () => void;
}

export function createMainPlayerHost(
  options: MainPlayerHostOptions,
): ComponentView {
  const activate = (view: ComponentView): ComponentView => {
    view.element.hidden = false;
    view.element.inert = false;
    view.element.setAttribute("aria-hidden", "false");
    view.element.dataset.mainPlayerSurface = options.mode;
    return view;
  };
  if (options.mode === "default")
    return activate(createNowPlayingScreen(options));
  try {
    return activate(
      createCassetteMainPlayer({
        initialPlayerState: options.initialPlayerState,
        animationsEnabled: options.animationsEnabled,
        onError: options.onCassetteError,
      }),
    );
  } catch (error) {
    console.error("[cassette] main player initialization failed", error);
    options.onCassetteError();
    return activate(createNowPlayingScreen(options));
  }
}
