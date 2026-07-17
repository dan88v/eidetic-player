import { t } from "../i18n";
import type { TimelineStyle } from "../state/types";
import { renderLine, renderWaveform } from "../timeline/timeline-renderer";
import { prepareCanvas } from "../visualizer/canvas";
import type { ComponentView } from "./types";

export interface TimelineView extends ComponentView {
  readonly position: number;
  setPlayback(positionSeconds: number, durationSeconds: number): void;
  setEnabled(enabled: boolean): void;
}

export function formatTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  if (hours > 0)
    return `${String(hours)}:${String(minutes).padStart(2, "0")}:${String(
      remainder,
    ).padStart(2, "0")}`;
  return `${String(minutes)}:${String(remainder).padStart(2, "0")}`;
}

export function createTimeline(options: {
  readonly style: TimelineStyle;
  readonly durationSeconds: number;
  readonly initialProgress: number;
  readonly onSeek: (positionSeconds: number) => void;
}): TimelineView {
  let progress = options.initialProgress;
  let durationSeconds = options.durationSeconds;
  let enabled = durationSeconds > 0;
  let dragging = false;
  const element = document.createElement("section");
  element.className = "timeline";
  const elapsed = document.createElement("time");
  elapsed.className = "timeline__time";
  const remaining = document.createElement("time");
  remaining.className = "timeline__time timeline__time--remaining";
  const slider = document.createElement("div");
  slider.className = `timeline__slider timeline__slider--${options.style}`;
  slider.tabIndex = 0;
  slider.setAttribute("role", "slider");
  slider.setAttribute("aria-label", t("timeline.label"));
  slider.setAttribute("aria-valuemin", "0");
  slider.setAttribute("aria-valuemax", "100");
  const canvas = document.createElement("canvas");
  canvas.className = "timeline__canvas";
  slider.append(canvas);
  element.append(elapsed, slider, remaining);

  function draw(): void {
    const size = prepareCanvas(canvas);
    const context = canvas.getContext("2d");
    if (!size || !context) return;
    if (options.style === "waveform") {
      canvas.dataset.barCount = String(renderWaveform(context, size, progress));
    } else {
      delete canvas.dataset.barCount;
      renderLine(context, size, progress);
    }
  }

  function setProgress(value: number): void {
    progress = Math.max(0, Math.min(1, value));
    const elapsedSeconds = durationSeconds * progress;
    elapsed.textContent = formatTime(elapsedSeconds);
    elapsed.dateTime = `PT${String(Math.floor(elapsedSeconds))}S`;
    remaining.textContent = formatTime(durationSeconds);
    remaining.dateTime = `PT${String(Math.floor(durationSeconds))}S`;
    slider.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
    slider.setAttribute(
      "aria-valuetext",
      `${formatTime(elapsedSeconds)} of ${formatTime(durationSeconds)}`,
    );
    draw();
  }

  function updateFromPointer(event: PointerEvent): void {
    const bounds = slider.getBoundingClientRect();
    setProgress((event.clientX - bounds.left) / bounds.width);
  }

  slider.addEventListener("pointerdown", (event) => {
    if (!enabled) return;
    dragging = true;
    slider.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  });
  slider.addEventListener("pointermove", (event) => {
    if (slider.hasPointerCapture(event.pointerId)) updateFromPointer(event);
  });
  slider.addEventListener("pointerup", (event) => {
    if (slider.hasPointerCapture(event.pointerId)) {
      updateFromPointer(event);
      slider.releasePointerCapture(event.pointerId);
      dragging = false;
      options.onSeek(durationSeconds * progress);
    }
  });
  slider.addEventListener("pointercancel", (event) => {
    if (slider.hasPointerCapture(event.pointerId))
      slider.releasePointerCapture(event.pointerId);
    dragging = false;
  });
  slider.addEventListener("keydown", (event) => {
    if (!enabled) return;
    let handled = true;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setProgress(progress - 0.01);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setProgress(progress + 0.01);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setProgress(progress - 0.1);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      setProgress(progress + 0.1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setProgress(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setProgress(1);
    } else handled = false;
    if (handled) options.onSeek(durationSeconds * progress);
  });

  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  setProgress(progress);
  return {
    element,
    get position() {
      return progress;
    },
    setPlayback(position, duration) {
      durationSeconds = Math.max(0, duration);
      enabled = durationSeconds > 0;
      slider.setAttribute("aria-disabled", String(!enabled));
      if (!dragging)
        setProgress(durationSeconds ? position / durationSeconds : 0);
    },
    setEnabled(nextEnabled) {
      enabled = nextEnabled && durationSeconds > 0;
      slider.tabIndex = enabled ? 0 : -1;
      slider.setAttribute("aria-disabled", String(!enabled));
    },
    destroy() {
      observer.disconnect();
    },
  };
}
