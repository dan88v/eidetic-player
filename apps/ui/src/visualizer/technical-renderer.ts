import type { CanvasSize } from "./canvas";
import { renderCompactStereoMeter } from "./meter-renderer";

export interface TechnicalValues {
  readonly crestDb: number | null;
  readonly shortTermLufs: number | null;
  readonly meterDb: ArrayLike<number>;
  readonly peakHoldDb: ArrayLike<number>;
}

export function crestFactorDb(
  leftPeak: number,
  leftRms: number,
  rightPeak: number,
  rightRms: number,
): number | null {
  let crest = Number.NEGATIVE_INFINITY;
  if (leftPeak > 0 && leftRms > 0)
    crest = Math.max(crest, 20 * Math.log10(leftPeak / leftRms));
  if (rightPeak > 0 && rightRms > 0)
    crest = Math.max(crest, 20 * Math.log10(rightPeak / rightRms));
  return Number.isFinite(crest) ? Math.max(0, Math.min(60, crest)) : null;
}

function numberText(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(1);
}

export function renderTechnical(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  values: TechnicalValues,
): void {
  const horizontalPadding = Math.max(20, Math.min(28, size.width * 0.035));
  const right = size.width - horizontalPadding;
  const compact = size.height < 120 || size.width < 520;
  const valueSize = compact ? 38 : 44;
  const unitOffset = compact ? 116 : 134;
  context.textBaseline = "top";
  context.font = "650 17px system-ui";
  context.fillStyle = "#9ca6b7";
  context.textAlign = "left";
  context.fillText("CREST", horizontalPadding, 4);
  context.textAlign = "right";
  context.fillText("LUFS-S", right, 4);

  context.font = `650 ${String(valueSize)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.fillStyle = "#e8edf7";
  context.textAlign = "left";
  context.fillText(numberText(values.crestDb), horizontalPadding, 25);
  context.textAlign = "right";
  context.fillText(numberText(values.shortTermLufs), right - 52, 25);

  context.font = "600 14px system-ui";
  context.fillStyle = "#7f899a";
  context.textAlign = "left";
  context.fillText("dB", horizontalPadding + unitOffset, 49);
  context.textAlign = "right";
  context.fillText("LUFS", right, 49);

  renderCompactStereoMeter(context, size, values.meterDb, values.peakHoldDb);
}
