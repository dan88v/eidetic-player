import type { CanvasSize } from "../visualizer/canvas";

function waveformLevel(index: number): number {
  return (
    0.24 +
    Math.abs(Math.sin(index * 0.73) * 0.54 + Math.sin(index * 0.19) * 0.2)
  );
}

export function renderWaveform(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  progress: number,
): number {
  const { width, height } = size;
  const bars = Math.max(160, Math.min(240, Math.round(width / 5)));
  const gap = 1.5;
  const barWidth = Math.max(1, (width - gap * (bars - 1)) / bars);
  const center = height / 2;
  for (let index = 0; index < bars; index += 1) {
    const x = index * (barWidth + gap);
    const barHeight = Math.max(5, waveformLevel(index) * (height - 8));
    context.fillStyle = x / width <= progress ? "#2f7dff" : "#394253";
    context.fillRect(x, center - barHeight / 2, barWidth, barHeight);
  }
  drawPlayhead(context, size, progress);
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
