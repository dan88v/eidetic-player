import type { VisualizerFrame } from "../../../../packages/shared/src/visualizer";
import { t } from "../i18n";
import type { VisualizerMode } from "../state/types";
import { prepareCanvas, type CanvasSize } from "../visualizer/canvas";
import { renderMeter } from "../visualizer/meter-renderer";
import {
  renderSpectrum,
  renderStereoSpectrum,
  SPECTRUM_BAND_COUNT,
} from "../visualizer/spectrum-renderer";
import { VisualizerStreamClient } from "../visualizer/visualizer-stream-client";
import type { ComponentView } from "./types";

const TARGET_FRAME_INTERVAL = 1_000 / 30;

function smooth(displayed: Float32Array, target: Float32Array): boolean {
  let changing = false;
  for (let index = 0; index < displayed.length; index += 1) {
    const current = displayed[index] ?? 0;
    const requested = target[index] ?? 0;
    const factor = requested > current ? 0.68 : 0.2;
    const next =
      Math.abs(requested - current) < 0.002
        ? requested
        : current + (requested - current) * factor;
    displayed[index] = next;
    if (Math.abs(requested - next) >= 0.002) changing = true;
  }
  return changing;
}

function copy(source: readonly number[], target: Float32Array): void {
  for (let index = 0; index < target.length; index += 1)
    target[index] = source[index] ?? 0;
}

export function createVisualizer(options: {
  readonly mode: VisualizerMode;
  readonly onModeChange: (mode: VisualizerMode) => void;
}): ComponentView {
  let mode = options.mode;
  let size: CanvasSize | null = null;
  let animationFrame = 0;
  let lastRenderTime = 0;
  let needsRender = true;
  let hasFrame = false;
  const meterTarget = new Float32Array(2);
  const meterDisplayed = new Float32Array(2);
  const monoTarget = new Float32Array(32);
  const monoDisplayed = new Float32Array(32);
  const leftTarget = new Float32Array(16);
  const leftDisplayed = new Float32Array(16);
  const rightTarget = new Float32Array(16);
  const rightDisplayed = new Float32Array(16);
  const stream = new VisualizerStreamClient();
  const element = document.createElement("div");
  element.className = "visualizer";
  element.setAttribute("role", "button");
  element.tabIndex = 0;
  const canvas = document.createElement("canvas");
  canvas.className = "visualizer__canvas";
  canvas.setAttribute("aria-hidden", "true");
  element.append(canvas);

  const stopLoop = (): void => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (import.meta.env.DEV) canvas.dataset.rafActive = "0";
  };

  const draw = (): void => {
    const context = canvas.getContext("2d");
    if (!size || !context || mode === "none") return;
    context.clearRect(0, 0, size.width, size.height);
    if (!hasFrame) return;
    if (mode === "meter") {
      const geometry = renderMeter(context, size, meterDisplayed);
      if (import.meta.env.DEV) {
        canvas.dataset.meterBarHeight = String(geometry.barHeight);
        canvas.dataset.meterRowGap = String(geometry.rowGap);
        canvas.dataset.meterGraphicBottomOffset = String(
          size.height - geometry.graphicBottom,
        );
      }
    } else if (mode === "spectrumMono") {
      renderSpectrum(context, size, monoDisplayed);
    } else {
      renderStereoSpectrum(context, size, leftDisplayed, rightDisplayed);
    }
    if (import.meta.env.DEV)
      canvas.dataset.draws = String(Number(canvas.dataset.draws ?? "0") + 1);
  };

  const tick = (timestamp: number): void => {
    animationFrame = 0;
    if (mode === "none") return;
    if (timestamp - lastRenderTime < TARGET_FRAME_INTERVAL) {
      animationFrame = requestAnimationFrame(tick);
      return;
    }
    lastRenderTime = timestamp;
    let changing = false;
    if (hasFrame) {
      if (mode === "meter") changing = smooth(meterDisplayed, meterTarget);
      else if (mode === "spectrumMono")
        changing = smooth(monoDisplayed, monoTarget);
      else {
        const leftChanging = smooth(leftDisplayed, leftTarget);
        const rightChanging = smooth(rightDisplayed, rightTarget);
        changing = leftChanging || rightChanging;
      }
    }
    if (needsRender || changing) {
      needsRender = false;
      draw();
    }
    if (changing) {
      animationFrame = requestAnimationFrame(tick);
      if (import.meta.env.DEV) canvas.dataset.rafActive = "1";
    } else if (import.meta.env.DEV) canvas.dataset.rafActive = "0";
  };

  const startLoop = (): void => {
    if (animationFrame || mode === "none") return;
    animationFrame = requestAnimationFrame(tick);
    if (import.meta.env.DEV) canvas.dataset.rafActive = "1";
  };

  const receiveLatestFrame = (): void => {
    const frame: VisualizerFrame | null = stream.takeLatest();
    if (!frame) return;
    meterTarget[0] = frame.meter.leftPeak;
    meterTarget[1] = frame.meter.rightPeak;
    copy(frame.monoBands, monoTarget);
    copy(frame.leftBands, leftTarget);
    copy(frame.rightBands, rightTarget);
    hasFrame = true;
    needsRender = true;
    startLoop();
    if (import.meta.env.DEV)
      canvas.dataset.framesReceived = String(
        Number(canvas.dataset.framesReceived ?? "0") + 1,
      );
  };

  const updateAccessibleState = (): void => {
    const nextMode: VisualizerMode =
      mode === "meter"
        ? "spectrumMono"
        : mode === "spectrumMono"
          ? "spectrumStereo"
          : mode === "spectrumStereo"
            ? "none"
            : "meter";
    element.dataset.mode = mode;
    element.setAttribute("aria-label", `Show ${t(`visualizer.${nextMode}`)}`);
    canvas.dataset.bands =
      mode === "spectrumMono"
        ? String(SPECTRUM_BAND_COUNT)
        : mode === "spectrumStereo"
          ? "16+16"
          : "0";
    if (mode === "none") {
      stream.close();
      stopLoop();
      const context = canvas.getContext("2d");
      if (size && context) context.clearRect(0, 0, size.width, size.height);
    } else {
      stream.open(mode, receiveLatestFrame);
      needsRender = true;
      startLoop();
    }
  };

  const toggleMode = (): void => {
    mode =
      mode === "meter"
        ? "spectrumMono"
        : mode === "spectrumMono"
          ? "spectrumStereo"
          : mode === "spectrumStereo"
            ? "none"
            : "meter";
    updateAccessibleState();
    options.onModeChange(mode);
  };

  element.addEventListener("click", toggleMode);
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleMode();
  });

  const observer = new ResizeObserver(() => {
    size = prepareCanvas(canvas);
    needsRender = true;
    startLoop();
    if (import.meta.env.DEV)
      canvas.dataset.resizes = String(
        Number(canvas.dataset.resizes ?? "0") + 1,
      );
  });
  observer.observe(canvas);
  updateAccessibleState();
  return {
    element,
    destroy() {
      observer.disconnect();
      stream.close();
      stopLoop();
    },
  };
}
