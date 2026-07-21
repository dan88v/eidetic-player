import type { PlayerState } from "../../../../packages/shared/src/player";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";
import {
  loadCassetteFrame,
  nextCassetteFallback,
  type CassetteRendererLevel,
} from "./cassette-assets";
import { CassetteAnimationController } from "./cassette-animation-controller";
import {
  CASSETTE_CENTER_WINDOW_POINT_LIST,
  CASSETTE_LEFT_REEL,
  CASSETTE_RIGHT_REEL,
  CASSETTE_VIEWBOX_HEIGHT,
  CASSETTE_VIEWBOX_WIDTH,
} from "./cassette-geometry";
import {
  createCassettePremiumScene,
  type CassettePremiumScene,
} from "./cassette-premium-scene";
import { createCassetteReelLayer } from "./cassette-reel-layer";
import { createCassetteSnapshot } from "./cassette-snapshot";

export interface CassetteMainPlayerOptions {
  readonly initialPlayerState: PlayerState;
  readonly animationsEnabled: boolean;
  readonly onAssetError: () => void;
  readonly onError: () => void;
}

interface CassettePrototypeScene {
  readonly element: HTMLElement;
  readonly animationElements: ReturnType<
    typeof createCassetteReelLayer
  >["animationElements"];
}

function createCassettePrototypeScene(): CassettePrototypeScene {
  const element = document.createElement("div");
  element.className = "cassette-player__prototype-scene";
  element.setAttribute("aria-hidden", "true");
  const dynamicLayer = createCassetteReelLayer("prototype");
  const frame = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  frame.classList.add("cassette-player__prototype-frame");
  frame.setAttribute(
    "viewBox",
    `0 0 ${String(CASSETTE_VIEWBOX_WIDTH)} ${String(CASSETTE_VIEWBOX_HEIGHT)}`,
  );
  frame.setAttribute("preserveAspectRatio", "xMidYMid meet");
  frame.setAttribute("aria-hidden", "true");
  frame.innerHTML = `
    <defs>
      <linearGradient id="cassette-prototype-shell" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#48545a"/><stop offset="1" stop-color="#172024"/>
      </linearGradient>
      <mask id="cassette-prototype-cutouts">
        <rect width="1070" height="710" fill="white"/>
        <circle cx="${String(CASSETTE_LEFT_REEL.centerX)}" cy="${String(CASSETTE_LEFT_REEL.centerY)}" r="59" fill="black"/>
        <circle cx="${String(CASSETTE_RIGHT_REEL.centerX)}" cy="${String(CASSETTE_RIGHT_REEL.centerY)}" r="59" fill="black"/>
        <polygon points="${CASSETTE_CENTER_WINDOW_POINT_LIST}" fill="black"/>
      </mask>
    </defs>
    <g mask="url(#cassette-prototype-cutouts)">
      <rect x="20" y="25" width="1030" height="660" rx="58" class="cassette-player__prototype-shell"/>
      <rect x="75" y="185" width="920" height="430" rx="28" class="cassette-player__prototype-label"/>
      <path d="M75 300h920v210H75z" class="cassette-player__prototype-band"/>
    </g>
    <circle cx="${String(CASSETTE_LEFT_REEL.centerX)}" cy="${String(CASSETTE_LEFT_REEL.centerY)}" r="60" class="cassette-player__prototype-reel-outline"/>
    <circle cx="${String(CASSETTE_RIGHT_REEL.centerX)}" cy="${String(CASSETTE_RIGHT_REEL.centerY)}" r="60" class="cassette-player__prototype-reel-outline"/>
    <polygon points="${CASSETTE_CENTER_WINDOW_POINT_LIST}" class="cassette-player__prototype-window-outline"/>
    <g class="cassette-player__prototype-copy">
      <text x="135" y="235">TYPE I / NORMAL POSITION</text>
      <text x="135" y="282" class="cassette-player__prototype-side">SIDE <tspan>A</tspan></text>
      <text x="510" y="252" class="cassette-player__prototype-dots">• • •</text>
      <text x="805" y="275" class="cassette-player__prototype-grade"><tspan>C</tspan>60</text>
      <text x="135" y="545" class="cassette-player__prototype-brand">EIDETIC</text>
      <text x="137" y="570" class="cassette-player__prototype-brand-sub">PLAYER</text>
      <path d="M135 592h790M135 620h790" class="cassette-player__prototype-lines"/>
      <path d="M890 532h42M890 548h42M890 564h42" class="cassette-player__prototype-mark"/>
    </g>`;
  element.append(dynamicLayer.element, frame);
  return {
    element,
    animationElements: dynamicLayer.animationElements,
  };
}

export function createCassetteMainPlayer(
  options: CassetteMainPlayerOptions,
): ComponentView {
  let playerState = options.initialPlayerState;
  let previewPositionSeconds: number | null = null;
  let destroyed = false;
  let renderer: CassetteRendererLevel = "prototype";
  let premiumScene: CassettePremiumScene | null = null;
  const section = document.createElement("section");
  section.className = "screen cassette-player";
  section.setAttribute("aria-label", t("cassette.description"));
  const heading = document.createElement("h1");
  heading.className = "visually-hidden";
  heading.textContent = t("screen.nowPlaying.title");
  const sceneStack = document.createElement("div");
  sceneStack.className = "cassette-player__scene-stack";
  const prototypeScene = createCassettePrototypeScene();
  sceneStack.append(prototypeScene.element);
  section.append(heading, sceneStack);
  section.dataset.cassetteRenderer = renderer;

  const activatePrototype = (): boolean => {
    renderer = nextCassetteFallback("premium");
    try {
      controller.setElements(prototypeScene.animationElements);
      if (premiumScene) {
        premiumScene.element.hidden = true;
        premiumScene.element.setAttribute("aria-hidden", "true");
      }
      prototypeScene.element.hidden = false;
      prototypeScene.element.setAttribute("aria-hidden", "true");
      section.dataset.cassetteRenderer = renderer;
      options.onAssetError();
      return true;
    } catch (error) {
      console.error("[cassette] prototype fallback failed", error);
      renderer = nextCassetteFallback(renderer);
      section.dataset.cassetteRenderer = renderer;
      options.onError();
      return false;
    }
  };

  const controller = new CassetteAnimationController(
    section,
    prototypeScene.animationElements,
    options.animationsEnabled &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => {
      if (renderer === "premium") return activatePrototype();
      renderer = nextCassetteFallback("prototype");
      section.dataset.cassetteRenderer = renderer;
      options.onError();
      return false;
    },
  );

  const update = (state: PlayerState): void => {
    playerState = state;
    controller.update(createCassetteSnapshot(state, previewPositionSeconds));
  };
  const onVisibilityChange = (): void => {
    controller.setVisible(!document.hidden);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  update(playerState);

  void loadCassetteFrame()
    .then((frame) => {
      if (destroyed) return;
      const nextScene = createCassettePremiumScene(frame);
      premiumScene = nextScene;
      sceneStack.append(nextScene.element);
      try {
        controller.setElements(nextScene.animationElements);
        renderer = "premium";
        prototypeScene.element.hidden = true;
        nextScene.element.hidden = false;
        nextScene.element.setAttribute("aria-hidden", "true");
        section.dataset.cassetteRenderer = renderer;
      } catch (error) {
        console.error("[cassette] premium scene commit failed", error);
        activatePrototype();
      }
    })
    .catch((error: unknown) => {
      if (destroyed) return;
      console.warn("[cassette] premium frame unavailable", error);
      options.onAssetError();
    });

  return {
    element: section,
    updatePlayerState: update,
    updateSeekPreview(positionSeconds) {
      previewPositionSeconds = positionSeconds;
      controller.update(createCassetteSnapshot(playerState, positionSeconds));
    },
    destroy() {
      destroyed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controller.destroy();
    },
  };
}
