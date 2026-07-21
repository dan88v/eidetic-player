import type { CassetteAnimationElements } from "./cassette-animation-controller";
import { createCassetteReelLayer } from "./cassette-reel-layer";

export interface CassettePremiumScene {
  readonly element: HTMLElement;
  readonly animationElements: CassetteAnimationElements;
}

export function createCassettePremiumScene(
  frame: HTMLImageElement,
): CassettePremiumScene {
  const element = document.createElement("div");
  element.className = "cassette-player__premium-scene";
  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
  const dynamicLayer = createCassetteReelLayer("premium");
  element.append(dynamicLayer.element, frame);
  return { element, animationElements: dynamicLayer.animationElements };
}
