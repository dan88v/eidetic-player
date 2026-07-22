import type { CanvasSize } from "./canvas";
import { renderCompactStereoMeter } from "./meter-renderer";

export interface TechnicalValues {
  readonly crestDb: number | null;
  readonly shortTermLufs: number | null;
  readonly meterDb: ArrayLike<number>;
  readonly peakHoldDb: ArrayLike<number>;
}

export const CREST_ATTACK_MS = 125;
export const CREST_RELEASE_MS = 1_800;
const CREST_MAX_STEP_MS = 250;

export class CrestDisplaySmoother {
  private displayed: number | null = null;
  private updatedAt: number | null = null;

  update(
    sample: number | null,
    timestamp: number,
    suspended = false,
  ): number | null {
    if (!Number.isFinite(timestamp)) return this.displayed;
    if (suspended) {
      this.updatedAt = timestamp;
      return this.displayed;
    }
    if (sample === null || !Number.isFinite(sample)) {
      this.updatedAt = timestamp;
      return this.displayed;
    }
    const target = Math.max(0, Math.min(60, sample));
    if (this.displayed === null || this.updatedAt === null) {
      this.displayed = target;
      this.updatedAt = timestamp;
      return this.displayed;
    }
    const elapsed = timestamp - this.updatedAt;
    this.updatedAt = timestamp;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return this.displayed;
    const deltaTime = Math.min(elapsed, CREST_MAX_STEP_MS);
    const duration =
      target > this.displayed ? CREST_ATTACK_MS : CREST_RELEASE_MS;
    const blend = 1 - Math.exp(-deltaTime / duration);
    this.displayed += (target - this.displayed) * blend;
    return this.displayed;
  }

  reset(value: number | null = null, timestamp: number | null = null): void {
    this.displayed =
      value !== null && Number.isFinite(value)
        ? Math.max(0, Math.min(60, value))
        : null;
    this.updatedAt = Number.isFinite(timestamp) ? timestamp : null;
  }
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
  const valueSize = Math.round(
    Math.max(compact ? 48 : 56, Math.min(compact ? 50 : 58, size.width * 0.09)),
  );
  const unitOffset = compact ? 145 : 150;
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
