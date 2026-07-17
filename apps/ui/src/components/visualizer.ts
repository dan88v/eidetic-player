import { t } from "../i18n";
import type { VisualizerMode } from "../state/types";
import { prepareCanvas } from "../visualizer/canvas";
import { renderMeter } from "../visualizer/meter-renderer";
import {
  renderSpectrum,
  SPECTRUM_BAND_COUNT,
} from "../visualizer/spectrum-renderer";
import type { ComponentView } from "./types";

export function createVisualizer(options: {
  readonly mode: VisualizerMode;
  readonly onModeChange: (mode: VisualizerMode) => void;
}): ComponentView {
  let mode = options.mode;
  const element = document.createElement("div");
  element.className = "visualizer";
  element.setAttribute("role", "button");
  element.tabIndex = 0;
  const canvas = document.createElement("canvas");
  canvas.className = "visualizer__canvas";
  canvas.setAttribute("aria-hidden", "true");
  element.append(canvas);

  function updateAccessibleState(): void {
    const nextKey =
      mode === "meter"
        ? "visualizer.switchToSpectrum"
        : "visualizer.switchToMeter";
    element.dataset.mode = mode;
    element.setAttribute("aria-label", t(nextKey));
    canvas.dataset.bands =
      mode === "spectrum" ? String(SPECTRUM_BAND_COUNT) : "0";
  }

  function draw(): void {
    const size = prepareCanvas(canvas);
    const context = canvas.getContext("2d");
    if (!size || !context) return;
    if (mode === "meter") {
      const geometry = renderMeter(context, size);
      if (import.meta.env.DEV) {
        canvas.dataset.meterBarHeight = String(geometry.barHeight);
        canvas.dataset.meterRowGap = String(geometry.rowGap);
        canvas.dataset.meterGraphicBottomOffset = String(
          size.height - geometry.graphicBottom,
        );
      }
    } else {
      delete canvas.dataset.meterBarHeight;
      delete canvas.dataset.meterRowGap;
      delete canvas.dataset.meterGraphicBottomOffset;
      renderSpectrum(context, size);
    }
  }

  function toggleMode(): void {
    mode = mode === "meter" ? "spectrum" : "meter";
    updateAccessibleState();
    draw();
    options.onModeChange(mode);
  }

  element.addEventListener("click", toggleMode);
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleMode();
  });

  updateAccessibleState();
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  return {
    element,
    destroy() {
      observer.disconnect();
    },
  };
}
