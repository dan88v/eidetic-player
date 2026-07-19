import type { CanvasSize } from "./canvas";

export const METER_MIN_DB = -60;

export const METER_SCALE_DB = [-60, -40, -24, -12, -6, -3, 0] as const;

const mappingSegments = [
  { minimumDb: -60, maximumDb: -24, minimumPosition: 0, maximumPosition: 0.3 },
  {
    minimumDb: -24,
    maximumDb: -12,
    minimumPosition: 0.3,
    maximumPosition: 0.6,
  },
  {
    minimumDb: -12,
    maximumDb: -6,
    minimumPosition: 0.6,
    maximumPosition: 0.8,
  },
  { minimumDb: -6, maximumDb: 0, minimumPosition: 0.8, maximumPosition: 1 },
] as const;

export interface MeterGeometry {
  readonly barHeight: number;
  readonly rowGap: number;
  readonly labelWidth: number;
  readonly startY: number;
  readonly graphicBottom: number;
}

export interface CompactMeterGeometry {
  readonly barHeight: number;
  readonly rowGap: number;
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
  const clamped = Math.max(METER_MIN_DB, Math.min(0, db));
  const segment =
    mappingSegments.find((candidate) => clamped <= candidate.maximumDb) ??
    mappingSegments.at(-1);
  if (!segment) return 0;
  const progress =
    (clamped - segment.minimumDb) / (segment.maximumDb - segment.minimumDb);
  return (
    segment.minimumPosition +
    progress * (segment.maximumPosition - segment.minimumPosition)
  );
}

export function linearPeakToDb(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return METER_MIN_DB;
  return Math.max(METER_MIN_DB, 20 * Math.log10(Math.min(1, level)));
}

export function linearPeakToMeterPosition(level: number): number {
  return meterPositionForDb(linearPeakToDb(level));
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
  levelsDb: ArrayLike<number> = [-4, -7],
  peakHoldsDb: ArrayLike<number> = levelsDb,
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
  context.font = "600 20px system-ui";
  context.textBaseline = "middle";
  context.textAlign = "left";

  for (let index = 0; index < levelsDb.length; index += 1) {
    const levelDb = levelsDb[index] ?? METER_MIN_DB;
    const y = startY + index * (barHeight + rowGap);
    context.fillStyle = "#9ca6b7";
    context.fillText(index === 0 ? "L" : "R", 0, y + barHeight / 2);
    context.fillStyle = "#242b38";
    context.fillRect(labelWidth, y, meterWidth, barHeight);
    context.fillStyle = gradient?.value ?? "#2f7dff";
    context.fillRect(
      labelWidth,
      y,
      meterWidth * meterPositionForDb(levelDb),
      barHeight,
    );

    context.strokeStyle = "rgb(10 12 16 / 38%)";
    context.lineWidth = 1;
    for (const db of METER_SCALE_DB.slice(1, -1)) {
      const x = labelWidth + meterWidth * meterPositionForDb(db);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, y + barHeight);
      context.stroke();
    }
    const peakX =
      labelWidth +
      meterWidth * meterPositionForDb(peakHoldsDb[index] ?? METER_MIN_DB);
    context.fillStyle = "#dce8ff";
    context.fillRect(Math.max(labelWidth, peakX - 1), y, 2, barHeight);
  }
  return geometry;
}

export function renderCompactStereoMeter(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  levelsDb: ArrayLike<number>,
  peakHoldsDb: ArrayLike<number>,
): CompactMeterGeometry {
  const labelWidth = 24;
  const barHeight = 14;
  const rowGap = 8;
  const startY = size.height - (barHeight * 2 + rowGap + 5);
  const meterWidth = size.width - labelWidth;
  context.fillStyle = "#7f899a";
  context.font = "500 9px system-ui";
  context.textBaseline = "bottom";
  for (const db of [-60, -24, -12, -6, 0] as const) {
    const x = labelWidth + meterWidth * meterPositionForDb(db);
    context.textAlign = db === -60 ? "left" : db === 0 ? "right" : "center";
    context.fillText(String(db), x, startY - 4);
  }
  context.font = "600 12px system-ui";
  context.textBaseline = "middle";
  context.textAlign = "left";
  for (let channel = 0; channel < 2; channel += 1) {
    const y = startY + channel * (barHeight + rowGap);
    context.fillStyle = "#9ca6b7";
    context.fillText(channel === 0 ? "L" : "R", 0, y + barHeight / 2);
    context.fillStyle = "#242b38";
    context.fillRect(labelWidth, y, meterWidth, barHeight);
    const levelPosition = meterPositionForDb(levelsDb[channel] ?? METER_MIN_DB);
    const coolEnd = Math.min(levelPosition, meterPositionForDb(-18));
    const warmEnd = Math.min(levelPosition, meterPositionForDb(-3));
    context.fillStyle = "#2f7dff";
    context.fillRect(labelWidth, y, meterWidth * coolEnd, barHeight);
    if (levelPosition > coolEnd) {
      context.fillStyle = "#f29a3f";
      context.fillRect(
        labelWidth + meterWidth * coolEnd,
        y,
        meterWidth * (warmEnd - coolEnd),
        barHeight,
      );
    }
    if (levelPosition > warmEnd) {
      context.fillStyle = "#ff4d5a";
      context.fillRect(
        labelWidth + meterWidth * warmEnd,
        y,
        meterWidth * (levelPosition - warmEnd),
        barHeight,
      );
    }
    const holdX =
      labelWidth +
      meterWidth * meterPositionForDb(peakHoldsDb[channel] ?? METER_MIN_DB);
    context.fillStyle = "#dce8ff";
    context.fillRect(Math.max(labelWidth, holdX - 1), y, 2, barHeight);
  }
  return {
    barHeight,
    rowGap,
    startY,
    graphicBottom: startY + barHeight * 2 + rowGap,
  };
}
