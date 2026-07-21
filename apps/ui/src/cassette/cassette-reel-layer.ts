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

const tapeMassMarkup = (
  side: "left" | "right",
  reel: typeof CASSETTE_LEFT_REEL | typeof CASSETTE_RIGHT_REEL,
  idSuffix: string,
): string => `
  <circle cx="${String(reel.centerX)}" cy="${String(reel.centerY)}" r="${String(CASSETTE_FULL_RADIUS)}"
    class="cassette-player__tape-mass cassette-player__tape-mass--${side}"
    data-role="${reel.role}" style="fill:url(#cassette-tape-${side}-${idSuffix})"/>`;

const tapeWindingGradientMarkup = (
  side: "left" | "right",
  reel: typeof CASSETTE_LEFT_REEL | typeof CASSETTE_RIGHT_REEL,
  idSuffix: string,
): string => `
  <radialGradient id="cassette-tape-${side}-${idSuffix}"
    gradientUnits="userSpaceOnUse" cx="${String(reel.centerX)}" cy="${String(reel.centerY)}"
    r="2" spreadMethod="repeat">
    <stop offset="0" stop-color="#2b1d18"/>
    <stop offset=".5" stop-color="#2b1d18"/>
    <stop offset=".5" stop-color="#38251d"/>
    <stop offset="1" stop-color="#38251d"/>
  </radialGradient>`;

const reelMarkup = (
  side: "left" | "right",
  reel: typeof CASSETTE_LEFT_REEL | typeof CASSETTE_RIGHT_REEL,
  idSuffix: string,
): string => `
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
      ${tapeWindingGradientMarkup("left", CASSETTE_LEFT_REEL, idSuffix)}
      ${tapeWindingGradientMarkup("right", CASSETTE_RIGHT_REEL, idSuffix)}
      <radialGradient id="cassette-hub-${idSuffix}" cx="38%" cy="32%" r="70%">
        <stop offset="0" stop-color="#737a7c"/>
        <stop offset=".35" stop-color="#343a3d"/>
        <stop offset="1" stop-color="#111517"/>
      </radialGradient>
      <clipPath id="cassette-window-${idSuffix}">
        <polygon points="${CASSETTE_CENTER_WINDOW_POINT_LIST}"/>
      </clipPath>
    </defs>
    <g clip-path="url(#cassette-window-${idSuffix})" class="cassette-player__center-window-layer">
      ${tapeMassMarkup("left", CASSETTE_LEFT_REEL, idSuffix)}
      ${tapeMassMarkup("right", CASSETTE_RIGHT_REEL, idSuffix)}
      <rect x="390" y="312" width="296" height="158" class="cassette-player__center-window-glass"/>
    </g>
    <g class="cassette-player__reel-bed">
      ${reelMarkup("left", CASSETTE_LEFT_REEL, idSuffix)}
      ${reelMarkup("right", CASSETTE_RIGHT_REEL, idSuffix)}
    </g>
    `;
  const requiredCircle = (selector: string): SVGCircleElement => {
    const element = svg.querySelector<SVGCircleElement>(selector);
    if (!element)
      throw new Error(`Cassette dynamic layer missing: ${selector}`);
    return element;
  };
  const requiredGraphics = (selector: string): SVGGraphicsElement => {
    const element = svg.querySelector<SVGGraphicsElement>(selector);
    if (!element)
      throw new Error(`Cassette dynamic layer missing: ${selector}`);
    return element;
  };
  return {
    element: svg,
    animationElements: {
      sourceTape: requiredCircle(".cassette-player__tape-mass--right"),
      destinationTape: requiredCircle(".cassette-player__tape-mass--left"),
      sourceReel: requiredGraphics(".cassette-player__reel--right"),
      destinationReel: requiredGraphics(".cassette-player__reel--left"),
    },
  };
}
