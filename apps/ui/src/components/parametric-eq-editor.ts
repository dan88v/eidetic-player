import {
  resolveEqualizerFilterType,
  type EqualizerBand,
  type EqualizerFilterType,
  type HeadroomMode,
} from "../../../../packages/shared/src/audio-processing";
import {
  equalizerFrequencyFromPosition,
  equalizerFrequencyPosition,
  equalizerMagnitudeDb,
} from "../utils/equalizer-response";
import { createSegmentedControl } from "./segmented-control";

export interface ParametricEqEditorOptions {
  readonly bands: readonly EqualizerBand[];
  readonly selectedBand: number;
  readonly bypassed: boolean;
  readonly busy: boolean;
  readonly compensationDb: number;
  readonly headroomMode: HeadroomMode;
  readonly onSelectBand: (index: number) => void;
  readonly onUpdateBand: (
    index: number,
    changes: Partial<EqualizerBand>,
  ) => void;
}

export interface ParametricEqEditor {
  readonly element: HTMLElement;
  destroy(): void;
}

const GRAPH_MIN_DB = -12;
const GRAPH_MAX_DB = 12;
type LocalEqualizerBand = Omit<EqualizerBand, "filterType"> & {
  readonly filterType: EqualizerFilterType;
};

function formatFrequency(frequencyHz: number): string {
  return frequencyHz >= 1_000
    ? `${(frequencyHz / 1_000).toFixed(frequencyHz >= 10_000 ? 0 : 1)} kHz`
    : `${String(Math.round(frequencyHz))} Hz`;
}

export function createParametricEqEditor(
  options: ParametricEqEditorOptions,
): ParametricEqEditor {
  const element = document.createElement("section");
  element.className = "parametric-eq-editor";
  element.classList.toggle("parametric-eq-editor--bypassed", options.bypassed);
  const graphSurface = document.createElement("div");
  graphSurface.className = "parametric-eq-graph";
  const graphHeader = document.createElement("div");
  graphHeader.className = "parametric-eq-graph__header";
  const compensation = options.bypassed
    ? "Compensation inactive"
    : options.headroomMode === "off"
      ? "Compensation off"
      : `${options.headroomMode === "auto" ? "Auto compensation" : "Manual preamp"}: ${
          options.compensationDb === 0
            ? "0"
            : `${options.compensationDb < 0 ? "−" : "+"}${String(
                Math.abs(Math.round(options.compensationDb * 100) / 100),
              )}`
        } dB`;
  graphHeader.innerHTML = `<strong>Response</strong><span class="parametric-eq-graph__compensation">${compensation}</span>`;
  const canvas = document.createElement("canvas");
  canvas.className = "parametric-eq-graph__canvas";
  canvas.setAttribute("aria-label", "Parametric equalizer response graph");
  graphSurface.append(graphHeader, canvas);
  const bandSelector = document.createElement("div");
  bandSelector.className = "parametric-eq-bands";
  bandSelector.setAttribute("role", "tablist");
  bandSelector.setAttribute("aria-label", "Equalizer bands");
  const controls = document.createElement("section");
  controls.className = "parametric-eq-controls";
  const localBands: LocalEqualizerBand[] = options.bands.map((band, index) => ({
    ...band,
    filterType: resolveEqualizerFilterType(band, index),
  }));
  let selectedBand = Math.max(
    0,
    Math.min(localBands.length - 1, options.selectedBand),
  );
  const bandButtons: HTMLButtonElement[] = [];
  let frame = 0;
  const responsePoints = new Float32Array(256 * 2);

  const draw = (): void => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const styles = getComputedStyle(element);
    const grid = styles.getPropertyValue("--color-border").trim() || "#293140";
    const secondary =
      styles.getPropertyValue("--color-text-muted").trim() || "#77849a";
    const accent =
      styles.getPropertyValue("--color-accent").trim() || "#347dff";
    const text =
      styles.getPropertyValue("--color-text-secondary").trim() || "#a5b1c5";
    const left = 42;
    const right = bounds.width - 14;
    const top = 14;
    const bottom = bounds.height - 28;
    const plotWidth = Math.max(1, right - left);
    const plotHeight = Math.max(1, bottom - top);
    const yForDb = (value: number): number =>
      top +
      ((GRAPH_MAX_DB - Math.max(GRAPH_MIN_DB, Math.min(GRAPH_MAX_DB, value))) /
        (GRAPH_MAX_DB - GRAPH_MIN_DB)) *
        plotHeight;
    context.font = "12px Open Sans, sans-serif";
    context.lineWidth = 1;
    for (const db of [12, 6, 0, -6, -12]) {
      const y = yForDb(db);
      context.strokeStyle = db === 0 ? secondary : grid;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
      context.fillStyle = text;
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(`${db > 0 ? "+" : ""}${String(db)}`, left - 7, y);
    }
    for (const frequency of [
      20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000,
    ]) {
      const x = left + equalizerFrequencyPosition(frequency) * plotWidth;
      context.strokeStyle = grid;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
      if ([20, 100, 1_000, 10_000, 20_000].includes(frequency)) {
        context.fillStyle = text;
        context.textAlign =
          frequency === 20 ? "left" : frequency === 20_000 ? "right" : "center";
        context.textBaseline = "top";
        context.fillText(formatFrequency(frequency), x, bottom + 7);
      }
    }
    for (let index = 0; index < 256; index += 1) {
      const ratio = index / 255;
      const frequency = equalizerFrequencyFromPosition(ratio);
      responsePoints[index * 2] = left + ratio * plotWidth;
      responsePoints[index * 2 + 1] = yForDb(
        equalizerMagnitudeDb(localBands, frequency),
      );
    }
    context.beginPath();
    for (let index = 0; index < 256; index += 1) {
      const x = responsePoints[index * 2] ?? left;
      const y = responsePoints[index * 2 + 1] ?? yForDb(0);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.lineTo(right, yForDb(0));
    context.lineTo(left, yForDb(0));
    context.closePath();
    context.save();
    context.globalAlpha = options.bypassed ? 0.1 : 0.22;
    context.fillStyle = accent;
    context.fill();
    context.restore();
    context.beginPath();
    for (let index = 0; index < 256; index += 1) {
      const x = responsePoints[index * 2] ?? left;
      const y = responsePoints[index * 2 + 1] ?? yForDb(0);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = accent;
    context.lineWidth = 3;
    context.stroke();
    localBands.forEach((band, index) => {
      const x = left + equalizerFrequencyPosition(band.frequencyHz) * plotWidth;
      const y = yForDb(equalizerMagnitudeDb(localBands, band.frequencyHz));
      context.beginPath();
      context.arc(x, y, index === selectedBand ? 15 : 12, 0, Math.PI * 2);
      context.fillStyle = band.enabled ? accent : secondary;
      context.fill();
      context.lineWidth = index === selectedBand ? 3 : 1;
      context.strokeStyle = "#ffffff";
      context.stroke();
      context.fillStyle = "#ffffff";
      context.font = "700 12px Open Sans, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), x, y);
    });
  };

  const scheduleDraw = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };

  const setLocalBand = (
    index: number,
    changes: Partial<EqualizerBand>,
  ): void => {
    const band = localBands[index];
    if (!band) return;
    localBands[index] = {
      ...band,
      ...changes,
      filterType: changes.filterType ?? band.filterType,
    };
    scheduleDraw();
  };

  const renderControls = (): void => {
    controls.replaceChildren();
    const band = localBands[selectedBand];
    if (!band) return;
    const filterType = resolveEqualizerFilterType(band, selectedBand);
    const filterTypeLabel =
      filterType === "low-shelf"
        ? "Low Shelf"
        : filterType === "high-shelf"
          ? "High Shelf"
          : "Bell";
    const title = document.createElement("header");
    title.className = "parametric-eq-controls__header";
    title.innerHTML = `<span><strong>Band ${String(selectedBand + 1)}</strong><small>${filterTypeLabel} · ${formatFrequency(band.frequencyHz)} · ${band.gainDb > 0 ? "+" : ""}${String(band.gainDb)} dB · Q ${String(band.q)}</small></span>`;
    const enabled = createSegmentedControl({
      label: `Band ${String(selectedBand + 1)} state`,
      value: band.enabled ? "on" : "off",
      items: [
        { value: "on", label: "On" },
        { value: "off", label: "Bypass" },
      ],
      onChange: (value) => {
        const changes = { enabled: value === "on" };
        setLocalBand(selectedBand, changes);
        options.onUpdateBand(selectedBand, changes);
      },
    });
    enabled.element.classList.add("segmented-control--compact");
    title.append(enabled.element);
    controls.append(title);

    if (selectedBand === 0 || selectedBand === localBands.length - 1) {
      const typeRow = document.createElement("div");
      typeRow.className = "parametric-eq-type";
      const typeCopy = document.createElement("span");
      typeCopy.innerHTML =
        "<strong>Filter Type</strong><small>Choose a shelving or bell response.</small>";
      const typeControl = createSegmentedControl<"shelving" | "bell">({
        label: `Band ${String(selectedBand + 1)} filter type`,
        value: filterType === "peaking" ? "bell" : "shelving",
        items: [
          { value: "shelving", label: "Shelving" },
          { value: "bell", label: "Bell" },
        ],
        onChange: (value) => {
          const nextFilterType: EqualizerFilterType =
            value === "bell"
              ? "peaking"
              : selectedBand === 0
                ? "low-shelf"
                : "high-shelf";
          setLocalBand(selectedBand, { filterType: nextFilterType });
          options.onUpdateBand(selectedBand, {
            filterType: nextFilterType,
          });
        },
      });
      typeControl.element.classList.add("segmented-control--compact");
      typeRow.append(typeCopy, typeControl.element);
      controls.append(typeRow);
    }

    const slider = (
      label: string,
      valueLabel: (value: number) => string,
      minimum: number,
      maximum: number,
      step: number,
      value: number,
      toBandValue: (value: number) => number,
      key: "frequencyHz" | "gainDb" | "q",
    ): void => {
      const row = document.createElement("label");
      row.className = "parametric-eq-control";
      const copy = document.createElement("span");
      copy.innerHTML = `<strong>${label}</strong><output>${valueLabel(toBandValue(value))}</output>`;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(minimum);
      input.max = String(maximum);
      input.step = String(step);
      input.value = String(value);
      input.disabled = options.busy;
      input.addEventListener("input", () => {
        const bandValue = toBandValue(Number(input.value));
        const output = copy.querySelector("output");
        if (output) output.textContent = valueLabel(bandValue);
        setLocalBand(selectedBand, { [key]: bandValue });
      });
      input.addEventListener("change", () => {
        options.onUpdateBand(selectedBand, {
          [key]: toBandValue(Number(input.value)),
        });
      });
      row.append(copy, input);
      controls.append(row);
    };

    slider(
      "Frequency",
      formatFrequency,
      0,
      1_000,
      1,
      equalizerFrequencyPosition(band.frequencyHz) * 1_000,
      (value) =>
        Math.round(equalizerFrequencyFromPosition(value / 1_000) * 10) / 10,
      "frequencyHz",
    );
    slider(
      "Gain",
      (value) => `${value > 0 ? "+" : ""}${String(value)} dB`,
      -12,
      12,
      0.5,
      band.gainDb,
      (value) => value,
      "gainDb",
    );
    slider(
      "Q",
      (value) => value.toFixed(1),
      0.3,
      10,
      0.1,
      band.q,
      (value) => Math.round(value * 10) / 10,
      "q",
    );
  };

  const selectBand = (index: number): void => {
    if (index < 0 || index >= localBands.length || index === selectedBand)
      return;
    selectedBand = index;
    bandButtons.forEach((button, buttonIndex) => {
      const selected = buttonIndex === selectedBand;
      button.classList.toggle("parametric-eq-band--selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    renderControls();
    scheduleDraw();
    options.onSelectBand(index);
  };

  localBands.forEach((band, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "parametric-eq-band";
    button.classList.toggle(
      "parametric-eq-band--selected",
      index === selectedBand,
    );
    button.classList.toggle("parametric-eq-band--bypassed", !band.enabled);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === selectedBand));
    button.innerHTML = `<strong>${String(index + 1)}</strong><small>${formatFrequency(band.frequencyHz)}</small>`;
    button.addEventListener("click", () => {
      selectBand(index);
    });
    bandButtons.push(button);
    bandSelector.append(button);
  });

  let activePointerId: number | null = null;
  let draggedBandIndex: number | null = null;
  let dragOriginalBand: LocalEqualizerBand | null = null;

  const graphCoordinates = (
    event: PointerEvent,
  ): {
    readonly bounds: DOMRect;
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly x: number;
    readonly y: number;
  } => {
    const bounds = canvas.getBoundingClientRect();
    const left = 42;
    const right = bounds.width - 14;
    const top = 14;
    const bottom = bounds.height - 28;
    return {
      bounds,
      left,
      right,
      top,
      bottom,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  };

  const bandAtPointer = (event: PointerEvent): number | null => {
    const { left, right, top, bottom, x, y } = graphCoordinates(event);
    const plotWidth = Math.max(1, right - left);
    const plotHeight = Math.max(1, bottom - top);
    let nearest: number | null = null;
    let nearestDistance = 34;
    localBands.forEach((band, index) => {
      const nodeX =
        left + equalizerFrequencyPosition(band.frequencyHz) * plotWidth;
      const response = equalizerMagnitudeDb(localBands, band.frequencyHz);
      const nodeY =
        top +
        ((GRAPH_MAX_DB -
          Math.max(GRAPH_MIN_DB, Math.min(GRAPH_MAX_DB, response))) /
          (GRAPH_MAX_DB - GRAPH_MIN_DB)) *
          plotHeight;
      const distance = Math.hypot(nodeX - x, nodeY - y);
      if (distance <= nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    return nearest;
  };

  const updateDraggedBand = (event: PointerEvent): void => {
    if (draggedBandIndex === null) return;
    const { left, right, top, bottom, x, y } = graphCoordinates(event);
    const frequencyPosition = Math.max(
      0,
      Math.min(1, (x - left) / Math.max(1, right - left)),
    );
    const gainPosition = Math.max(
      0,
      Math.min(1, (y - top) / Math.max(1, bottom - top)),
    );
    setLocalBand(draggedBandIndex, {
      frequencyHz:
        Math.round(equalizerFrequencyFromPosition(frequencyPosition) * 10) / 10,
      gainDb:
        Math.round(
          (GRAPH_MAX_DB - gainPosition * (GRAPH_MAX_DB - GRAPH_MIN_DB)) * 2,
        ) / 2,
    });
  };

  const finishDrag = (event: PointerEvent, commit: boolean): void => {
    if (
      activePointerId === null ||
      event.pointerId !== activePointerId ||
      draggedBandIndex === null
    )
      return;
    const bandIndex = draggedBandIndex;
    const pointerId = activePointerId;
    activePointerId = null;
    draggedBandIndex = null;
    if (canvas.hasPointerCapture(pointerId))
      canvas.releasePointerCapture(pointerId);
    canvas.removeAttribute("data-dragging");
    if (!commit && dragOriginalBand) {
      localBands[bandIndex] = dragOriginalBand;
      scheduleDraw();
    } else if (commit) {
      const band = localBands[bandIndex];
      if (band)
        options.onUpdateBand(bandIndex, {
          frequencyHz: band.frequencyHz,
          gainDb: band.gainDb,
        });
    }
    dragOriginalBand = null;
    renderControls();
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (options.busy || activePointerId !== null) return;
    const bandIndex = bandAtPointer(event);
    if (bandIndex === null) return;
    const band = localBands[bandIndex];
    if (!band) return;
    event.preventDefault();
    selectBand(bandIndex);
    activePointerId = event.pointerId;
    draggedBandIndex = bandIndex;
    dragOriginalBand = { ...band };
    canvas.dataset.dragging = "true";
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    updateDraggedBand(event);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (event.pointerId !== activePointerId) return;
    updateDraggedBand(event);
    finishDrag(event, true);
  });
  canvas.addEventListener("pointercancel", (event) => {
    finishDrag(event, false);
  });
  canvas.addEventListener("lostpointercapture", (event) => {
    finishDrag(event, false);
  });

  element.append(graphSurface, bandSelector, controls);
  renderControls();
  const resizeObserver = new ResizeObserver(scheduleDraw);
  resizeObserver.observe(canvas);
  scheduleDraw();

  return {
    element,
    destroy() {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    },
  };
}
