import type { CanvasSize } from "./canvas";

export interface MeterGeometry {
  readonly barHeight: number;
  readonly rowGap: number;
  readonly labelWidth: number;
  readonly startY: number;
  readonly graphicBottom: number;
}

const gradients = new WeakMap<
  CanvasRenderingContext2D,
  {
    readonly width: number;
    readonly labelWidth: number;
    readonly value: CanvasGradient;
  }
>();

export function getMeterGeometry(size: CanvasSize): MeterGeometry {
  const barHeight = Math.max(28, Math.min(56, Math.round(size.height * 0.34)));
  const rowGap = Math.max(14, Math.round(size.height * 0.11));
  const labelWidth = 38;
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
  levels: ArrayLike<number> = [0.74, 0.61],
): MeterGeometry {
  const { width } = size;
  const geometry = getMeterGeometry(size);
  const { barHeight, labelWidth, rowGap, startY } = geometry;
  const meterWidth = width - labelWidth;
  let gradient = gradients.get(context);
  const gradientMatches =
    gradient?.width === width && gradient.labelWidth === labelWidth;
  if (!gradientMatches) {
    const value = context.createLinearGradient(labelWidth, 0, width, 0);
    value.addColorStop(0, "#2f7dff");
    value.addColorStop(0.76, "#50b6ff");
    value.addColorStop(0.92, "#f5c451");
    value.addColorStop(1, "#ff6577");
    gradient = { width, labelWidth, value };
    gradients.set(context, gradient);
  }
  context.font = "600 20px system-ui";
  context.textBaseline = "middle";

  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index] ?? 0;
    const y = startY + index * (barHeight + rowGap);
    context.fillStyle = "#9ca6b7";
    context.fillText(index === 0 ? "L" : "R", 0, y + barHeight / 2);
    context.fillStyle = "#242b38";
    context.fillRect(labelWidth, y, meterWidth, barHeight);
    context.fillStyle = gradient?.value ?? "#2f7dff";
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
  }
  return geometry;
}
