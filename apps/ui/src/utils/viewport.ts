import type { AppConfig } from "../../../../packages/config/src/index";

export function createViewportIndicator(
  config: AppConfig,
): HTMLOutputElement | null {
  if (!config.development) return null;

  const indicator = document.createElement("output");
  indicator.className = "viewport-indicator";
  indicator.setAttribute("aria-live", "polite");

  const update = (): void => {
    indicator.textContent = `Viewport: ${String(window.innerWidth)} × ${String(window.innerHeight)}`;
  };
  update();
  window.addEventListener("resize", update, { passive: true });

  return indicator;
}

export function correctInitialViewportOnce(config: AppConfig): void {
  const widthDifference = config.targetViewportWidth - window.innerWidth;
  const heightDifference = config.targetViewportHeight - window.innerHeight;
  if (widthDifference !== 0 || heightDifference !== 0) {
    window.resizeBy(widthDifference, heightDifference);
  }
}
