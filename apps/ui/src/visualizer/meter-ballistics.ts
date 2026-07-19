import { linearPeakToDb, METER_MIN_DB } from "./meter-renderer";

export const METER_ATTACK_MILLISECONDS = 10;
export const METER_RELEASE_MILLISECONDS = 350;
export const METER_PEAK_HOLD_MILLISECONDS = 900;
export const METER_PEAK_DECAY_DB_PER_SECOND = 12;

const CHANGE_EPSILON_DB = 0.02;

export class MeterBallistics {
  readonly displayedDb = new Float32Array([METER_MIN_DB, METER_MIN_DB]);
  readonly peakHoldDb = new Float32Array([METER_MIN_DB, METER_MIN_DB]);
  readonly targetDb = new Float32Array([METER_MIN_DB, METER_MIN_DB]);
  private readonly holdUntil = new Float64Array(2);
  private lastUpdateMilliseconds = 0;
  private initialized = false;
  private paused = true;

  setPeaks(left: number, right: number): void {
    this.targetDb[0] = linearPeakToDb(left);
    this.targetDb[1] = linearPeakToDb(right);
  }

  setPaused(paused: boolean, timestampMilliseconds: number): void {
    this.paused = paused;
    this.lastUpdateMilliseconds = timestampMilliseconds;
  }

  update(timestampMilliseconds: number): boolean {
    if (this.paused) {
      this.lastUpdateMilliseconds = timestampMilliseconds;
      return false;
    }
    if (!this.initialized) {
      for (let channel = 0; channel < 2; channel += 1) {
        const target = this.targetDb[channel] ?? METER_MIN_DB;
        this.displayedDb[channel] = target;
        this.peakHoldDb[channel] = target;
        this.holdUntil[channel] =
          timestampMilliseconds + METER_PEAK_HOLD_MILLISECONDS;
      }
      this.initialized = true;
      this.lastUpdateMilliseconds = timestampMilliseconds;
      return true;
    }
    const elapsedMilliseconds = Math.max(
      0,
      timestampMilliseconds - this.lastUpdateMilliseconds,
    );
    this.lastUpdateMilliseconds = timestampMilliseconds;
    let changed = false;
    for (let channel = 0; channel < 2; channel += 1) {
      const current = this.displayedDb[channel] ?? METER_MIN_DB;
      const target = this.targetDb[channel] ?? METER_MIN_DB;
      const timeConstant =
        target >= current
          ? METER_ATTACK_MILLISECONDS
          : METER_RELEASE_MILLISECONDS;
      const coefficient =
        timeConstant <= 0
          ? 1
          : 1 - Math.exp(-elapsedMilliseconds / timeConstant);
      const next = current + (target - current) * coefficient;
      if (Math.abs(next - current) >= CHANGE_EPSILON_DB) changed = true;
      this.displayedDb[channel] = next;

      const held = this.peakHoldDb[channel] ?? METER_MIN_DB;
      if (target >= held) {
        this.peakHoldDb[channel] = target;
        this.holdUntil[channel] =
          timestampMilliseconds + METER_PEAK_HOLD_MILLISECONDS;
        if (target !== held) changed = true;
      } else if (timestampMilliseconds > (this.holdUntil[channel] ?? 0)) {
        const decayed = Math.max(
          next,
          held - (METER_PEAK_DECAY_DB_PER_SECOND * elapsedMilliseconds) / 1_000,
        );
        if (Math.abs(decayed - held) >= CHANGE_EPSILON_DB) changed = true;
        this.peakHoldDb[channel] = decayed;
      }
    }
    return changed;
  }

  reset(): void {
    this.displayedDb.fill(METER_MIN_DB);
    this.peakHoldDb.fill(METER_MIN_DB);
    this.targetDb.fill(METER_MIN_DB);
    this.holdUntil.fill(0);
    this.lastUpdateMilliseconds = 0;
    this.initialized = false;
  }
}
