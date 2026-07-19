import type { CanvasSize } from "./canvas";

export const METER_MIN_DB = -60;

const meterScaleDb = [-60, -40, -20, -12, -6, -3, 0] as const;

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

export function meterPositionForDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - METER_MIN_DB) / -METER_MIN_DB));
}

export function linearPeakToMeterPosition(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const db = 20 * Math.log10(Math.min(1, level));
  return meterPositionForDb(db);
}

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
    value.addColorStop(meterPositionForDb(-12), "#50b6ff");
    value.addColorStop(meterPositionForDb(-6), "#f5c451");
    value.addColorStop(1, "#ff6577");
    gradient = { width, labelWidth, value };
    gradients.set(context, gradient);
  }
  context.fillStyle = "#7f899a";
  context.font = "500 10px system-ui";
  context.textBaseline = "bottom";
  context.textAlign = "left";
  context.fillText("dB", 0, startY - 7);
  for (const db of meterScaleDb) {
    const position = meterPositionForDb(db);
    const x = labelWidth + meterWidth * position;
    context.textAlign =
      db === METER_MIN_DB ? "left" : db === 0 ? "right" : "center";
    context.fillText(String(db), x, startY - 7);
    if (db !== METER_MIN_DB && db !== 0) {
      context.strokeStyle = "rgb(156 166 183 / 45%)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, startY - 4);
      context.lineTo(x, startY);
      context.stroke();
    }
  }

  context.font = "600 20px system-ui";
  context.textBaseline = "middle";
  context.textAlign = "left";

  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index] ?? 0;
    const y = startY + index * (barHeight + rowGap);
    context.fillStyle = "#9ca6b7";
    context.fillText(index === 0 ? "L" : "R", 0, y + barHeight / 2);
    context.fillStyle = "#242b38";
    context.fillRect(labelWidth, y, meterWidth, barHeight);
    context.fillStyle = gradient?.value ?? "#2f7dff";
    context.fillRect(
      labelWidth,
      y,
      meterWidth * linearPeakToMeterPosition(level),
      barHeight,
    );

    context.strokeStyle = "rgb(10 12 16 / 38%)";
    context.lineWidth = 1;
    for (const db of meterScaleDb.slice(1, -1)) {
      const x = labelWidth + meterWidth * meterPositionForDb(db);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, y + barHeight);
      context.stroke();
    }
  }
  return geometry;
}
