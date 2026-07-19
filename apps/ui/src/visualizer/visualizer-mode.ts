import type { VisualizerMode } from "../state/types";

export function nextVisualizerMode(mode: VisualizerMode): VisualizerMode {
  return mode === "spectrumMono"
    ? "spectrumStereo"
    : mode === "spectrumStereo"
      ? "meter"
      : mode === "meter"
        ? "technical"
        : mode === "technical"
          ? "none"
          : "spectrumMono";
}
