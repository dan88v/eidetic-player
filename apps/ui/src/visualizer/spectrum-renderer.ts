import type { CanvasSize } from "./canvas";

export const SPECTRUM_BAND_COUNT = 32;
const spectrum = Array.from({ length: SPECTRUM_BAND_COUNT }, (_, index) => {
  const shaped =
    0.24 +
    Math.abs(Math.sin(index * 0.61) * 0.48 + Math.sin(index * 0.17) * 0.22);
  return Math.min(0.94, shaped);
});

export function renderSpectrum(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
): void {
  const { width, height } = size;
  const gap = Math.max(2, Math.min(5, width / 230));
  const barWidth =
    (width - gap * (SPECTRUM_BAND_COUNT - 1)) / SPECTRUM_BAND_COUNT;
  spectrum.forEach((level, index) => {
    const x = index * (barWidth + gap);
    const barHeight = Math.max(4, height * level);
    context.fillStyle = index > 25 ? "#5695ff" : "#2f7dff";
    context.fillRect(x, height - barHeight, barWidth, barHeight);
  });
}
