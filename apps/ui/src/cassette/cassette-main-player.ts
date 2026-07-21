import type { PlayerState } from "../../../../packages/shared/src/player";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";
import { CassetteAnimationController } from "./cassette-animation-controller";
import { createCassetteSnapshot } from "./cassette-snapshot";

export interface CassetteMainPlayerOptions {
  readonly initialPlayerState: PlayerState;
  readonly animationsEnabled: boolean;
  readonly onError: () => void;
}

const reelMarkup = (side: "source" | "destination", x: number): string => `
  <g class="cassette-scene__tape-mass cassette-scene__tape-mass--${side}" style="transform-origin:${String(x)}px 280px">
    <circle cx="${String(x)}" cy="280" r="72" class="cassette-scene__tape"/>
  </g>
  <g class="cassette-scene__reel cassette-scene__reel--${side}" style="transform-origin:${String(x)}px 280px">
    <circle cx="${String(x)}" cy="280" r="43" class="cassette-scene__reel-ring"/>
    <path d="M ${String(x - 26)} 280 h52 M ${String(x)} 254 v52 M ${String(x - 18)} 262 l36 36 M ${String(x + 18)} 262 l-36 36"/>
    <circle cx="${String(x)}" cy="280" r="17" class="cassette-scene__hub"/>
  </g>`;

export function createCassetteMainPlayer(
  options: CassetteMainPlayerOptions,
): ComponentView {
  let playerState = options.initialPlayerState;
  let previewPositionSeconds: number | null = null;
  const section = document.createElement("section");
  section.className = "screen cassette-player";
  section.setAttribute("aria-label", t("cassette.description"));
  section.innerHTML = `
    <h1 class="visually-hidden">${t("screen.nowPlaying.title")}</h1>
    <svg class="cassette-scene" viewBox="0 0 1000 560" role="img" aria-label="${t("cassette.description")}">
      <defs aria-hidden="true">
        <linearGradient id="cassette-shell-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#465157"/><stop offset="1" stop-color="#1a2226"/>
        </linearGradient>
        <pattern id="cassette-grain" width="18" height="18" patternUnits="userSpaceOnUse">
          <path d="M0 4h18M0 13h18M4 0v18M13 0v18" stroke="#fff" stroke-opacity=".035" stroke-width="1"/>
        </pattern>
      </defs>
      <g aria-hidden="true">
        <rect x="45" y="42" width="910" height="475" rx="52" class="cassette-scene__shell"/>
        <rect x="51" y="48" width="898" height="463" rx="47" fill="url(#cassette-grain)"/>
        <circle cx="82" cy="78" r="17" class="cassette-scene__screw"/><circle cx="918" cy="78" r="17" class="cassette-scene__screw"/>
        <circle cx="82" cy="482" r="17" class="cassette-scene__screw"/><circle cx="918" cy="482" r="17" class="cassette-scene__screw"/>
        <rect x="104" y="113" width="792" height="352" rx="26" class="cassette-scene__label"/>
        <path d="M104 209h792v170H104z" class="cassette-scene__band"/>
        <text x="151" y="161" class="cassette-scene__microcopy">TYPE I / NORMAL POSITION</text>
        <text x="151" y="195" class="cassette-scene__side">SIDE <tspan>A</tspan></text>
        <text x="776" y="185" class="cassette-scene__grade"><tspan>C</tspan>60</text>
        <path d="M260 221h480a82 82 0 0 1 0 164H260a82 82 0 0 1 0-164z" class="cassette-scene__window"/>
        <path d="M285 280H715" class="cassette-scene__tape-path"/>
        <path d="M294 273q206-42 412 0" class="cassette-scene__loop cassette-scene__loop--upper"/>
        <path d="M294 290q206 45 412 0" class="cassette-scene__loop cassette-scene__loop--lower"/>
        ${reelMarkup("destination", 330)}
        ${reelMarkup("source", 670)}
        <rect x="432" y="241" width="136" height="78" rx="9" class="cassette-scene__center-window"/>
        <path d="M452 280h96" class="cassette-scene__window-tape"/>
        <g class="cassette-scene__mechanism">
          <path d="M450 190l18 38h64l18-38" class="cassette-scene__head"/>
          <g class="cassette-scene__capstan" style="transform-origin:574px 211px"><circle cx="574" cy="211" r="12"/><path d="M566 211h16M574 203v16"/></g>
          <circle cx="608" cy="211" r="14" class="cassette-scene__pinch"/>
        </g>
        <text x="151" y="421" class="cassette-scene__brand">EIDETIC</text>
        <text x="153" y="444" class="cassette-scene__brand-sub">PLAYER</text>
        <path d="M803 412h42M803 426h42M803 440h42" class="cassette-scene__mark"/>
      </g>
    </svg>`;
  const required = (selector: string): SVGGraphicsElement => {
    const element = section.querySelector<SVGGraphicsElement>(selector);
    if (!element) throw new Error(`Cassette layer missing: ${selector}`);
    return element;
  };
  const controller = new CassetteAnimationController(
    {
      root: section,
      sourceTape: required(".cassette-scene__tape-mass--source"),
      destinationTape: required(".cassette-scene__tape-mass--destination"),
      sourceReel: required(".cassette-scene__reel--source"),
      destinationReel: required(".cassette-scene__reel--destination"),
      capstan: required(".cassette-scene__capstan"),
      mechanism: required(".cassette-scene__mechanism"),
      tapePath: required(".cassette-scene__tape-path"),
    },
    options.animationsEnabled &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    options.onError,
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
  return {
    element: section,
    updatePlayerState: update,
    updateSeekPreview(positionSeconds) {
      previewPositionSeconds = positionSeconds;
      controller.update(createCassetteSnapshot(playerState, positionSeconds));
    },
    destroy() {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controller.destroy();
    },
  };
}
