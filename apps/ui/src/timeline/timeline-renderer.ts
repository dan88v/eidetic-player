import type { CanvasSize } from "../visualizer/canvas";

export function renderWaveform(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  progress: number,
  points?: readonly number[],
): number {
  const { width, height } = size;
  const bars = Math.max(160, Math.min(240, Math.round(width / 5)));
  const gap = 1.5;
  const barWidth = Math.max(1, (width - gap * (bars - 1)) / bars);
  const center = height / 2;
  const hasWaveform = Boolean(points?.length);
  for (let index = 0; index < bars; index += 1) {
    const x = index * (barWidth + gap);
    const pointIndex =
      points && points.length > 0
        ? Math.round((index * (points.length - 1)) / Math.max(1, bars - 1))
        : -1;
    const level = pointIndex >= 0 ? (points?.[pointIndex] ?? 0) : 0;
    const barHeight = hasWaveform ? Math.max(5, level * (height - 8)) : 3;
    context.fillStyle = hasWaveform
      ? x / width <= progress
        ? "#2f7dff"
        : "#394253"
      : "#242b38";
    context.fillRect(x, center - barHeight / 2, barWidth, barHeight);
  }
  if (hasWaveform) drawPlayhead(context, size, progress);
  return bars;
}

export function renderLine(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  progress: number,
): void {
  const { width, height } = size;
  const trackHeight = 10;
  const y = (height - trackHeight) / 2;
  context.fillStyle = "#394253";
  context.fillRect(0, y, width, trackHeight);
  context.fillStyle = "#2f7dff";
  context.fillRect(0, y, width * progress, trackHeight);
  drawPlayhead(context, size, progress);
}

function drawPlayhead(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  progress: number,
): void {
  const x = Math.max(7, Math.min(size.width - 7, size.width * progress));
  context.beginPath();
  context.arc(x, size.height / 2, 7, 0, Math.PI * 2);
  context.fillStyle = "#f5f7fb";
  context.fill();
  context.strokeStyle = "#2f7dff";
  context.lineWidth = 3;
  context.stroke();
}
