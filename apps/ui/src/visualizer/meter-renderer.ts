import type { CanvasSize } from "./canvas";

export interface MeterGeometry {
  readonly barHeight: number;
  readonly rowGap: number;
  readonly labelWidth: number;
  readonly startY: number;
  readonly graphicBottom: number;
}

export function getMeterGeometry(size: CanvasSize): MeterGeometry {
  const barHeight = 16;
  const rowGap = 10;
  const labelWidth = 34;
  return {
    barHeight,
    rowGap,
    labelWidth,
    startY: size.height - (barHeight * 2 + rowGap),
    graphicBottom: size.height,
  };
}

export function renderMeter(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
): MeterGeometry {
  const { width } = size;
  const geometry = getMeterGeometry(size);
  const { barHeight, labelWidth, rowGap, startY } = geometry;
  const meterWidth = width - labelWidth;
  const levels = [0.74, 0.61];
  context.font = "600 18px system-ui";
  context.textBaseline = "middle";

  levels.forEach((level, index) => {
    const y = startY + index * (barHeight + rowGap);
    context.fillStyle = "#9ca6b7";
    context.fillText(index === 0 ? "L" : "R", 0, y + barHeight / 2);
    context.fillStyle = "#242b38";
    context.fillRect(labelWidth, y, meterWidth, barHeight);
    const gradient = context.createLinearGradient(labelWidth, 0, width, 0);
    gradient.addColorStop(0, "#2f7dff");
    gradient.addColorStop(0.76, "#50b6ff");
    gradient.addColorStop(0.92, "#f5c451");
    gradient.addColorStop(1, "#ff6577");
    context.fillStyle = gradient;
    context.fillRect(labelWidth, y, meterWidth * level, barHeight);

    context.strokeStyle = "rgb(10 12 16 / 38%)";
    context.lineWidth = 1;
    for (let marker = 1; marker < 12; marker += 1) {
      const x = labelWidth + (meterWidth * marker) / 12;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, y + barHeight);
      context.stroke();
    }
  });
  return geometry;
}
