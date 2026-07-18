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
  levels: ArrayLike<number> = spectrum,
): void {
  const { width, height } = size;
  const gap = Math.max(2, Math.min(5, width / 230));
  const barWidth = (width - gap * (levels.length - 1)) / levels.length;
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index] ?? 0;
    const x = index * (barWidth + gap);
    const barHeight = Math.max(4, height * level);
    context.fillStyle = index > 25 ? "#5695ff" : "#2f7dff";
    context.fillRect(x, height - barHeight, barWidth, barHeight);
  }
}

export function renderStereoSpectrum(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  left: ArrayLike<number> = spectrum.slice(0, 16),
  right: ArrayLike<number> = spectrum.slice(16),
): void {
  const { width, height } = size;
  const bandCount = Math.min(left.length, right.length);
  if (bandCount === 0) return;
  const center = width / 2;
  const centerGap = Math.max(4, Math.min(10, width / 100));
  const gap = Math.max(2, Math.min(5, width / 230));
  const sideWidth = (width - centerGap) / 2;
  const barWidth = Math.max(1, (sideWidth - gap * (bandCount - 1)) / bandCount);
  const stride = barWidth + gap;
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const rightX = center + centerGap / 2 + bandIndex * stride;
    const leftX = center - centerGap / 2 - barWidth - bandIndex * stride;
    const leftHeight = Math.max(4, height * (left[bandIndex] ?? 0));
    const rightHeight = Math.max(4, height * (right[bandIndex] ?? 0));
    context.fillStyle =
      bandIndex >= Math.max(0, bandCount - 6) ? "#5695ff" : "#2f7dff";
    context.fillRect(leftX, height - leftHeight, barWidth, leftHeight);
    context.fillRect(rightX, height - rightHeight, barWidth, rightHeight);
  }
}
