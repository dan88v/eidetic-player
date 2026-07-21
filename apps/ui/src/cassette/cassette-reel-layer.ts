import type { CassetteAnimationElements } from "./cassette-animation-controller";
import {
  CASSETTE_CENTER_WINDOW_POINT_LIST,
  CASSETTE_FULL_RADIUS,
  CASSETTE_LEFT_REEL,
  CASSETTE_RIGHT_REEL,
  CASSETTE_VIEWBOX_HEIGHT,
  CASSETTE_VIEWBOX_WIDTH,
} from "./cassette-geometry";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export interface CassetteReelLayer {
  readonly element: SVGSVGElement;
  readonly animationElements: CassetteAnimationElements;
}

const reelMarkup = (
  side: "left" | "right",
  reel: typeof CASSETTE_LEFT_REEL | typeof CASSETTE_RIGHT_REEL,
  idSuffix: string,
): string => `
  <g class="cassette-player__tape-mass cassette-player__tape-mass--${side}"
     data-role="${reel.role}"
     style="transform-origin:${String(reel.centerX)}px ${String(reel.centerY)}px">
    <circle cx="${String(reel.centerX)}" cy="${String(reel.centerY)}" r="${String(CASSETTE_FULL_RADIUS)}" class="cassette-player__tape-disc" style="fill:url(#cassette-tape-${idSuffix})"/>
    <circle cx="${String(reel.centerX)}" cy="${String(reel.centerY)}" r="46" class="cassette-player__tape-groove"/>
    <circle cx="${String(reel.centerX)}" cy="${String(reel.centerY)}" r="36" class="cassette-player__tape-groove"/>
  </g>
  <g class="cassette-player__reel cassette-player__reel--${side}"
     data-role="${reel.role}"
     style="transform-origin:${String(reel.centerX)}px ${String(reel.centerY)}px">
    <circle cx="${String(reel.centerX)}" cy="${String(reel.centerY)}" r="43" class="cassette-player__reel-ring" style="fill:url(#cassette-hub-${idSuffix})"/>
    <path class="cassette-player__reel-spokes" d="M ${String(reel.centerX - 29)} ${String(reel.centerY)} h58 M ${String(reel.centerX)} ${String(reel.centerY - 29)} v58 M ${String(reel.centerX - 21)} ${String(reel.centerY - 21)} l42 42 M ${String(reel.centerX + 21)} ${String(reel.centerY - 21)} l-42 42"/>
    <circle cx="${String(reel.centerX)}" cy="${String(reel.centerY)}" r="20" class="cassette-player__reel-center"/>
    <circle cx="${String(reel.centerX)}" cy="${String(reel.centerY)}" r="8" class="cassette-player__reel-cap"/>
  </g>`;

export function createCassetteReelLayer(idSuffix: string): CassetteReelLayer {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.classList.add("cassette-player__dynamic-layer");
  svg.setAttribute(
    "viewBox",
    `0 0 ${String(CASSETTE_VIEWBOX_WIDTH)} ${String(CASSETTE_VIEWBOX_HEIGHT)}`,
  );
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <defs>
      <radialGradient id="cassette-tape-${idSuffix}" cx="44%" cy="38%" r="66%">
        <stop offset="0" stop-color="#443127"/>
        <stop offset=".58" stop-color="#251a16"/>
        <stop offset="1" stop-color="#100d0c"/>
      </radialGradient>
      <radialGradient id="cassette-hub-${idSuffix}" cx="38%" cy="32%" r="70%">
        <stop offset="0" stop-color="#737a7c"/>
        <stop offset=".35" stop-color="#343a3d"/>
        <stop offset="1" stop-color="#111517"/>
      </radialGradient>
      <clipPath id="cassette-window-${idSuffix}">
        <polygon points="${CASSETTE_CENTER_WINDOW_POINT_LIST}"/>
      </clipPath>
    </defs>
    <g class="cassette-player__reel-bed">
      ${reelMarkup("left", CASSETTE_LEFT_REEL, idSuffix)}
      ${reelMarkup("right", CASSETTE_RIGHT_REEL, idSuffix)}
    </g>
    <g clip-path="url(#cassette-window-${idSuffix})" class="cassette-player__center-window-layer">
      <rect x="390" y="312" width="296" height="158" class="cassette-player__center-tape-bed"/>
      <g class="cassette-player__center-tape">
        <path d="M365 326v130 M377 326v130 M389 326v130 M401 326v130 M413 326v130 M425 326v130 M437 326v130 M449 326v130 M461 326v130 M473 326v130 M485 326v130 M497 326v130 M509 326v130 M521 326v130 M533 326v130 M545 326v130 M557 326v130 M569 326v130 M581 326v130 M593 326v130 M605 326v130 M617 326v130 M629 326v130 M641 326v130 M653 326v130 M665 326v130 M677 326v130 M689 326v130 M701 326v130"/>
      </g>
    </g>`;
  const required = (selector: string): SVGGraphicsElement => {
    const element = svg.querySelector<SVGGraphicsElement>(selector);
    if (!element)
      throw new Error(`Cassette dynamic layer missing: ${selector}`);
    return element;
  };
  return {
    element: svg,
    animationElements: {
      sourceTape: required(".cassette-player__tape-mass--right"),
      destinationTape: required(".cassette-player__tape-mass--left"),
      sourceReel: required(".cassette-player__reel--right"),
      destinationReel: required(".cassette-player__reel--left"),
      centerTape: required(".cassette-player__center-tape"),
    },
  };
}
