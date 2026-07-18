import type { AppConfig } from "../../../../packages/config/src/index";

export function correctInitialViewportOnce(config: AppConfig): void {
  const widthDifference = config.targetViewportWidth - window.innerWidth;
  const heightDifference = config.targetViewportHeight - window.innerHeight;
  if (widthDifference !== 0 || heightDifference !== 0) {
    window.resizeBy(widthDifference, heightDifference);
  }
}
